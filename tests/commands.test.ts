import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { lstat, mkdir, mkdtemp, open, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ data, meta: { request_id: 'r1' } }), { status, headers: { 'content-type': 'application/json' } });

const bodyAbortedAtDeadline: typeof fetch = async (_url, init) => new Response(new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode('{"data":'));
    init?.signal?.addEventListener('abort', () => controller.error(new Error('body aborted')), { once: true });
  },
}), { status: 200, headers: { 'content-type': 'application/json' } });

function harness(transport: typeof fetch, token = 'tpapi_secret', extra: Record<string, unknown> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const run = (args: string[]) => runCli(args, { token, transport, stdout: s => out.push(s), stderr: s => err.push(s), sleep: async () => {}, ...extra });
  return { out, err, run };
}

describe('commands', () => {
  it('prints only JSON including the pagination cursor for sites list --json', async () => {
    const h = harness(async () => new Response(JSON.stringify({ data: [{ id: 's1', domain: 'example.test' }], meta: { request_id: 'r1', next_cursor: 'next-page' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(await h.run(['sites', 'list', '--json'])).toBe(0);
    expect(JSON.parse(h.out.join(''))).toEqual({ data: [{ id: 's1', domain: 'example.test' }], meta: { request_id: 'r1', next_cursor: 'next-page' } });
    expect(h.err).toEqual([]);
  });

  it('returns 3 for missing token and 2 for invalid arguments without exposing secrets', async () => {
    const h = harness(async () => ok([]), '');
    expect(await h.run(['sites', 'list'])).toBe(3);
    expect(await h.run(['sites', 'show', '--site', 's1', '--token', 'secret-value'])).toBe(2);
    expect(h.out.join('') + h.err.join('')).not.toContain('secret-value');
  });

  it('maps each route, uses a stable explicit idempotency key, and waits for a confirmed job', async () => {
    const seen: Array<[string, RequestInit | undefined]> = [];
    const transport: typeof fetch = async (url, init) => {
      seen.push([String(url), init]);
      if (String(url).endsWith('/operations/op1')) return ok({ id: 'op1', status: 'succeeded' });
      return ok({ operation_id: 'op1' }, 202);
    };
    const h = harness(transport);
    expect(await h.run(['backups', 'create', '--site', 's1', '--idempotency-key', 'stable-key-123456', '--wait', '--json'])).toBe(0);
    expect(seen[0]?.[0]).toBe('https://panel.turbopress.de/api/v1/sites/s1/backups');
    expect(new Headers(seen[0]?.[1]?.headers).get('Idempotency-Key')).toBe('stable-key-123456');
    expect(seen[1]?.[0]).toBe('https://panel.turbopress.de/api/v1/operations/op1');
    expect(JSON.parse(h.out.join('')).status).toBe('succeeded');
  });

  it('covers all public route commands with the expected methods', async () => {
    const cases: Array<[string[], string, string]> = [
      [['sites', 'list'], 'GET', '/sites'],
      [['sites', 'show', '--site', 's1'], 'GET', '/sites/s1'],
      [['backups', 'list', '--site', 's1'], 'GET', '/sites/s1/backups'],
      [['backups', 'create', '--site', 's1'], 'POST', '/sites/s1/backups'],
      [['cache', 'purge', '--site', 's1', '--scope', 'all'], 'POST', '/sites/s1/cache/purge'],
      [['operations', 'get', 'op1'], 'GET', '/operations/op1'],
      [['operations', 'list'], 'GET', '/operations'],
      [['token'], 'GET', '/token'],
      [['status'], 'GET', '/status'],
      [['backups', 'delete', '--site', 's1', '--backup', 'b1.zip'], 'DELETE', '/sites/s1/backups/b1.zip'],
      [['deployments', 'create', '--site', 's1'], 'POST', '/sites/s1/deployments'],
      [['deployments', 'preview', '--site', 's1', '--deployment', 'd1'], 'POST', '/sites/s1/deployments/d1/preview'],
      [['deployments', 'publish', '--site', 's1', '--deployment', 'd1'], 'POST', '/sites/s1/deployments/d1/publish'],
      [['deployments', 'list', '--site', 's1'], 'GET', '/sites/s1/deployments'],
      [['deployments', 'rollback', '--site', 's1', '--deployment', 'd1'], 'POST', '/sites/s1/deployments/d1/rollback'],
    ];
    const contract = JSON.parse(readFileSync(new URL('./fixtures/openapi.json', import.meta.url), 'utf8'));
    expect(Object.values(contract.paths).flatMap((methods: any) => Object.keys(methods))).toHaveLength(16);
    for (const [args, method, suffix] of cases) {
      const calls: Array<[string, RequestInit | undefined]> = [];
      const h = harness(async (url, init) => { calls.push([String(url), init]); return ok({ id: 'd1' }); });
      expect(await h.run(args)).toBe(0);
      expect(calls[0]?.[0]).toBe(`https://panel.turbopress.de/api/v1${suffix}`);
      expect(calls[0]?.[1]?.method).toBe(method);
      const template = suffix.replaceAll('s1', '{site_id}').replaceAll('b1.zip', '{backup_id}').replaceAll('d1', '{id}').replaceAll('op1', '{id}');
      expect(contract.paths[template]?.[method.toLowerCase()]).toBeDefined();
      if (method !== 'GET' && args[0] !== 'cache') expect(calls[0]?.[1]?.body).toBeUndefined();
    }
  });

  it('encodes a regular file and rejects remote traversal or a local symlink', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tp-cli-test-'));
    try {
      const file = join(dir, 'index.html');
      await writeFile(file, '<h1>ok</h1>');
      await symlink(file, join(dir, 'link'));
      const bodies: unknown[] = [];
      const urls: string[] = [];
      const methods: string[] = [];
      const h = harness(async (url, init) => { urls.push(String(url)); methods.push(String(init?.method)); bodies.push(JSON.parse(String(init?.body))); return ok({ path: 'site/index.html', size_bytes: 11 }); });
      expect(await h.run(['deployments', 'put-file', '--site', 's1', '--deployment', 'd1', '--path', 'site/index.html', '--file', file])).toBe(0);
      expect(urls).toEqual(['https://panel.turbopress.de/api/v1/sites/s1/deployments/d1/files']);
      expect(methods).toEqual(['PUT']);
      expect(bodies[0]).toEqual({ path: 'site/index.html', content: 'PGgxPm9rPC9oMT4=', encoding: 'base64' });
      expect(await h.run(['deployments', 'put-file', '--site', 's1', '--deployment', 'd1', '--path', '../x', '--file', file])).toBe(2);
      expect(await h.run(['deployments', 'put-file', '--site', 's1', '--deployment', 'd1', '--path', 'C:\\site\\index.html', '--file', file])).toBe(2);
      expect(await h.run(['deployments', 'put-file', '--site', 's1', '--deployment', 'd1', '--path', 'site/index.html', '--file', join(dir, 'link')])).toBe(2);
      expect(bodies).toHaveLength(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('returns operation status exit codes and exposes a resumable key on a job timeout', async () => {
    const failed = harness(async () => ok({ id: 'op1', status: 'failed' }));
    expect(await failed.run(['operations', 'get', 'op1'])).toBe(1);
    const unknown = harness(async () => ok({ id: 'op1', status: 'unknown' }));
    expect(await unknown.run(['operations', 'get', 'op1'])).toBe(4);
    const timed = harness(async url => String(url).endsWith('/operations/op1') ? ok({ id: 'op1', status: 'queued' }) : ok({ operation_id: 'op1' }, 202));
    expect(await timed.run(['backups', 'create', '--site', 's1', '--wait', '--timeout', '1', '--idempotency-key', 'stable-key-123456'])).toBe(4);
    expect(timed.err.join('')).toContain('operation_id=op1');
    expect(timed.err.join('')).toContain('idempotency_key=stable-key-123456');
  });

  it('rejects an unsupported page URL before sending a cache purge', async () => {
    const transport = vi.fn(async () => ok({ id: 'op1', status: 'queued' }, 202));
    const h = harness(transport);
    expect(await h.run(['cache', 'purge', '--site', 's1', '--scope', 'page', '--url', 'https://example.test/a'])).toBe(2);
    expect(transport).not.toHaveBeenCalled();
  });

  it('honors job Retry-After before the first operation poll', async () => {
    const events: string[] = [];
    const transport: typeof fetch = async url => {
      if (String(url).endsWith('/operations/op1')) { events.push('poll'); return ok({ id: 'op1', status: 'succeeded' }); }
      events.push('submit');
      return new Response(JSON.stringify({ data: { id: 'op1', status: 'queued' }, meta: { request_id: 'r1' } }), { status: 202, headers: { 'content-type': 'application/json', 'retry-after': '8' } });
    };
    const h = harness(transport, 'tpapi_secret', { sleep: async (ms: number) => { events.push(`sleep:${ms}`); } });
    expect(await h.run(['backups', 'create', '--site', 's1', '--wait'])).toBe(0);
    expect(events).toEqual(['submit', 'sleep:8000', 'poll']);
  });

  it('rejects options that the selected command would silently ignore', async () => {
    const transport = vi.fn(async () => ok([]));
    const h = harness(transport);
    expect(await h.run(['sites', 'list', '--site', 's1'])).toBe(2);
    expect(await h.run(['backups', 'create', '--site', 's1', '--timeout', '30'])).toBe(2);
    expect(await h.run(['sites', 'show', '--site', 's1', '--url', 'https://example.test'])).toBe(2);
    expect(transport).not.toHaveBeenCalled();
  });

  it('redacts a token echoed in successful response data', async () => {
    const h = harness(async () => ok({ note: 'tpapi_secret' }));
    expect(await h.run(['sites', 'show', '--site', 's1', '--json'])).toBe(0);
    expect(h.out.join('') + h.err.join('')).not.toContain('tpapi_secret');
  });

  it('rejects an invalid wait timeout before submitting a mutation', async () => {
    const transport = vi.fn(async () => ok({ id: 'op1', status: 'queued' }, 202));
    const h = harness(transport);
    expect(await h.run(['backups', 'create', '--site', 's1', '--wait', '--timeout', 'invalid'])).toBe(2);
    expect(transport).not.toHaveBeenCalled();
  });

  it('accepts a printable ASCII idempotency key with an interior space', async () => {
    let key: string | null = null;
    const h = harness(async (_url, init) => { key = new Headers(init?.headers).get('idempotency-key'); return ok({ id: 'op1', status: 'queued' }, 202); });
    expect(await h.run(['backups', 'create', '--site', 's1', '--idempotency-key', 'stable key 123456'])).toBe(0);
    expect(key).toBe('stable key 123456');
  });

  it('runs operations wait through the public command', async () => {
    let count = 0;
    const h = harness(async () => ok({ id: 'op1', status: ++count === 1 ? 'queued' : 'succeeded' }));
    expect(await h.run(['operations', 'wait', 'op1', '--json'])).toBe(0);
    expect(JSON.parse(h.out.join('')).status).toBe('succeeded');
    expect(count).toBe(2);
  });

  it('rejects a symlinked parent directory before reading a deployment file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tp-cli-parent-link-'));
    try {
      const privateDir = join(dir, 'private');
      const artifactDir = join(dir, 'artifact');
      await mkdir(privateDir);
      await mkdir(artifactDir);
      await writeFile(join(privateDir, 'sample.txt'), 'synthetic-private-review-value');
      await symlink(privateDir, join(artifactDir, 'assets'));
      const transport = vi.fn(async () => ok({ path: 'public.txt', size_bytes: 1 }));
      const h = harness(transport);
      expect(await h.run(['deployments', 'put-file', '--site', 's1', '--deployment', 'd1', '--path', 'public.txt', '--file', join(artifactDir, 'assets', 'sample.txt')])).toBe(2);
      expect(transport).not.toHaveBeenCalled();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('enforces --timeout on the initial mutation request', async () => {
    let time = 0;
    const calls: string[] = [];
    const transport: typeof fetch = async url => {
      calls.push(String(url));
      time = 2000;
      return ok({ id: 'op1', status: 'queued' }, 202);
    };
    const h = harness(transport, 'tpapi_secret', { now: () => time });
    expect(await h.run(['backups', 'create', '--site', 's1', '--wait', '--timeout', '1', '--idempotency-key', 'stable-key-123456'])).toBe(4);
    expect(calls).toEqual(['https://panel.turbopress.de/api/v1/sites/s1/backups']);
    expect(h.err.join('')).toContain('operation_id=op1');
    expect(h.err.join('')).toContain('idempotency_key=stable-key-123456');
  });

  it('does not submit a mutation when its absolute deadline has already elapsed', async () => {
    const transport = vi.fn(async () => ok({ id: 'op1', status: 'queued' }, 202));
    const h = harness(transport);
    expect(await h.run(['backups', 'create', '--site', 's1', '--wait', '--timeout', '0', '--idempotency-key', 'stable-key-123456'])).toBe(4);
    expect(transport).not.toHaveBeenCalled();
    expect(h.err.join('')).toContain('idempotency_key=stable-key-123456');
  });

  it('aborts a pending mutation at its one-second deadline', async () => {
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const h = harness(transport as typeof fetch);
    const started = Date.now();
    expect(await h.run(['backups', 'create', '--site', 's1', '--wait', '--timeout', '1', '--idempotency-key', 'stable-key-123456'])).toBe(4);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(h.err.join('')).toContain('idempotency_key=stable-key-123456');
  });

  it('prints the operation ID and original key when polling exhausts the shared deadline', async () => {
    let time = 0;
    const calls: string[] = [];
    const transport: typeof fetch = async url => {
      calls.push(String(url));
      return calls.length === 1
        ? ok({ id: 'op1', status: 'queued' }, 202)
        : new Response(JSON.stringify({ error: { code: 'unavailable', message: 'busy' }, meta: { request_id: 'r2' } }), { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '120' } });
    };
    const h = harness(transport, 'tpapi_secret', { now: () => time, sleep: async (ms: number) => { time += ms; } });
    expect(await h.run(['backups', 'create', '--site', 's1', '--wait', '--timeout', '9', '--idempotency-key', 'stable-key-123456'])).toBe(4);
    expect(calls).toEqual([
      'https://panel.turbopress.de/api/v1/sites/s1/backups',
      'https://panel.turbopress.de/api/v1/operations/op1',
    ]);
    expect(h.err.join('')).toContain('operation_id=op1');
    expect(h.err.join('')).toContain('idempotency_key=stable-key-123456');
  });

  it('reports a body-stream deadline during operations wait as exit 4 with the known ID', async () => {
    const h = harness(bodyAbortedAtDeadline);
    expect(await h.run(['operations', 'wait', 'op1', '--timeout', '1'])).toBe(4);
    expect(h.err.join('')).toContain('operation_id=op1');
    expect(h.err.join('')).not.toContain('Invalid API response');
  });

  it('reports a body-stream deadline during a mutation with its stable key', async () => {
    const h = harness(bodyAbortedAtDeadline);
    expect(await h.run(['backups', 'create', '--site', 's1', '--wait', '--timeout', '1', '--idempotency-key', 'stable-key-123456'])).toBe(4);
    expect(h.err.join('')).toContain('idempotency_key=stable-key-123456');
    expect(h.err.join('')).not.toContain('Invalid API response');
  });

  it('keeps five seconds between every operations get retry', async () => {
    let time = 0;
    const calls: number[] = [];
    const transport: typeof fetch = async () => {
      calls.push(time);
      if (calls.length < 3) throw new Error('network');
      return ok({ id: 'op1', status: 'succeeded' });
    };
    const h = harness(transport, 'tpapi_secret', { now: () => time, sleep: async (ms: number) => { time += ms; } });
    expect(await h.run(['operations', 'get', 'op1', '--json'])).toBe(0);
    expect(calls).toEqual([0, 5000, 10000]);
  });

  it('includes the known operation ID when operations get cannot parse the body', async () => {
    const h = harness(async () => new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(await h.run(['operations', 'get', 'op1'])).toBe(1);
    expect(h.err.join('')).toContain('operation_id=op1');
  });

  it('rejects a file replaced with a symlink immediately before opening', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tp-cli-file-swap-'));
    try {
      const file = join(dir, 'artifact.txt');
      const privateFile = join(dir, 'private.txt');
      await writeFile(file, 'safe');
      await writeFile(privateFile, 'synthetic-private-review-value');
      const transport = vi.fn(async () => ok({ path: 'public.txt', size_bytes: 1 }));
      const h = harness(transport, 'tpapi_secret', {
        files: {
          lstat,
          open: async (...args: Parameters<typeof open>) => {
            await rm(file);
            await symlink(privateFile, file);
            return open(...args);
          },
        },
      });
      expect(await h.run(['deployments', 'put-file', '--site', 's1', '--deployment', 'd1', '--path', 'public.txt', '--file', file])).toBe(2);
      expect(transport).not.toHaveBeenCalled();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('prints a retry line to stderr and keeps stdout clean while retrying a write', async () => {
    const limited = () => new Response(JSON.stringify({ error: { code: 'queue_full', message: 'secret tpapi_secret' }, meta: {} }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '5' } });
    const transport = vi.fn()
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(ok({ id: 'b1' }, 202));
    const h = harness(transport as unknown as typeof fetch);
    expect(await h.run(['backups', 'create', '--site', 's1', '--idempotency-key', 'stable-key-123456', '--json'])).toBe(0);
    expect(h.err).toEqual(['Waiting 5s before retry 1/3 (queue_full)\n']);
    expect(() => JSON.parse(h.out.join(''))).not.toThrow();
    expect(h.out.join('')).not.toContain('Waiting');
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('retries put-file with an identical body', async () => {
    const limited = () => new Response(JSON.stringify({ error: { code: 'api_draining' }, meta: {} }), { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '2' } });
    const transport = vi.fn().mockResolvedValueOnce(limited()).mockResolvedValueOnce(ok({ ok: true }));
    const dir = await mkdtemp(join(tmpdir(), 'tp-retry-'));
    await writeFile(join(dir, 'a.txt'), 'hello');
    const h = harness(transport as unknown as typeof fetch);
    expect(await h.run(['deployments', 'put-file', '--site', 's1', '--deployment', 'd1', '--path', 'a.txt', '--file', join(dir, 'a.txt'), '--idempotency-key', 'stable-key-123456', '--json'])).toBe(0);
    await rm(dir, { recursive: true, force: true });
    expect(transport).toHaveBeenCalledTimes(2);
    const [a, b] = transport.mock.calls.map(c => c[1] as RequestInit);
    expect(a!.method).toBe('PUT');
    expect(b!.body).toBe(a!.body);
    expect(new Headers(b!.headers).get('idempotency-key')).toBe('stable-key-123456');
  });
});

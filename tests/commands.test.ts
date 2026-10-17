import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ data, meta: { request_id: 'r1' } }), { status, headers: { 'content-type': 'application/json' } });

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
      [['deployments', 'create', '--site', 's1'], 'POST', '/sites/s1/deployments'],
      [['deployments', 'preview', '--site', 's1', '--deployment', 'd1'], 'POST', '/sites/s1/deployments/d1/preview'],
      [['deployments', 'publish', '--site', 's1', '--deployment', 'd1'], 'POST', '/sites/s1/deployments/d1/publish'],
      [['deployments', 'list', '--site', 's1'], 'GET', '/sites/s1/deployments'],
      [['deployments', 'rollback', '--site', 's1', '--deployment', 'd1'], 'POST', '/sites/s1/deployments/d1/rollback'],
    ];
    const contract = JSON.parse(readFileSync(new URL('./fixtures/openapi.json', import.meta.url), 'utf8'));
    expect(Object.values(contract.paths).flatMap((methods: any) => Object.keys(methods))).toHaveLength(12);
    for (const [args, method, suffix] of cases) {
      const calls: Array<[string, RequestInit | undefined]> = [];
      const h = harness(async (url, init) => { calls.push([String(url), init]); return ok({ id: 'd1' }); });
      expect(await h.run(args)).toBe(0);
      expect(calls[0]?.[0]).toBe(`https://panel.turbopress.de/api/v1${suffix}`);
      expect(calls[0]?.[1]?.method).toBe(method);
      const template = suffix.replaceAll('s1', '{site_id}').replaceAll('d1', '{id}').replaceAll('op1', '{id}');
      expect(contract.paths[template]?.[method.toLowerCase()]).toBeDefined();
      if (method === 'POST' && args[0] !== 'cache') expect(calls[0]?.[1]?.body).toBeUndefined();
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
    expect(await timed.run(['backups', 'create', '--site', 's1', '--wait', '--timeout', '0', '--idempotency-key', 'stable-key-123456'])).toBe(4);
    expect(timed.err.join('')).toContain('operation_id=op1');
    expect(timed.err.join('')).toContain('idempotency_key=stable-key-123456');
  });

  it('passes a page URL in the cache request body', async () => {
    let body: unknown;
    const h = harness(async (_url, init) => { body = JSON.parse(String(init?.body)); return ok({ id: 'op1', status: 'queued' }, 202); });
    expect(await h.run(['cache', 'purge', '--site', 's1', '--scope', 'page', '--url', 'https://example.test/a'])).toBe(0);
    expect(body).toEqual({ scope: 'page', url: 'https://example.test/a' });
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
});

import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { ApiClient } from '../src/client.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const ok = (data: unknown, status = 200) => json({ data, meta: { request_id: 'r1' } }, status);
const API = 'https://panel.turbopress.de/api/v1';
const KEY = 'stable-key-123456';

function harness(transport: typeof fetch, token = 'tpapi_secret') {
  const out: string[] = [];
  const err: string[] = [];
  const run = (args: string[]) => runCli(args, { token, transport, stdout: s => out.push(s), stderr: s => err.push(s), sleep: async () => {} });
  return { out, err, run };
}
const calls = (t: ReturnType<typeof vi.fn>) => t.mock.calls.map(c => ({ url: String(c[0]), init: c[1] as RequestInit, headers: new Headers((c[1] as RequestInit).headers) }));

describe('operations list', () => {
  it('sends filters as query and prints data with meta', async () => {
    const t = vi.fn(async () => json({ data: [{ id: 'op1' }], meta: { request_id: 'r1', next_cursor: 'c2' } }));
    const h = harness(t as unknown as typeof fetch);
    expect(await h.run(['operations', 'list', '--site', 's1', '--status', 'failed', '--limit', '5', '--cursor', 'a/b', '--json'])).toBe(0);
    const [c] = calls(t);
    expect(c!.url).toBe(`${API}/operations?site_id=s1&status=failed&limit=5&cursor=a%2Fb`);
    expect(c!.init.method).toBe('GET');
    expect(c!.headers.get('authorization')).toBe('Bearer tpapi_secret');
    expect(JSON.parse(h.out.join(''))).toEqual({ data: [{ id: 'op1' }], meta: { request_id: 'r1', next_cursor: 'c2' } });
  });

  it('rejects bad arguments with exit 2 before any request', async () => {
    const t = vi.fn(async () => ok([]));
    const h = harness(t as unknown as typeof fetch);
    for (const args of [
      ['operations', 'list', '--status', 'bogus'], ['operations', 'list', '--limit', '0'], ['operations', 'list', '--limit', '101'],
      ['operations', 'list', '--site', 'a/b'], ['operations', 'list', '--wait'], ['operations', 'list', '--unknown', 'x'],
      ['operations', 'list', 'extra'], ['operations', 'get', 'op1', '--status', 'failed'], ['sites', 'list', '--status', 'failed'],
    ]) expect(await h.run(args)).toBe(2);
    expect(t).not.toHaveBeenCalled();
  });
});

describe('token', () => {
  it('reads /token and prints data', async () => {
    const t = vi.fn(async () => ok({ id: 't1', name: 'ci', permissions: ['backups:delete'] }));
    const h = harness(t as unknown as typeof fetch);
    expect(await h.run(['token', '--json'])).toBe(0);
    expect(calls(t)[0]!.url).toBe(`${API}/token`);
    expect(JSON.parse(h.out.join(''))).toEqual({ id: 't1', name: 'ci', permissions: ['backups:delete'] });
  });
  it('rejects extra words and options, and requires a token', async () => {
    const h = harness(async () => ok({}));
    expect(await h.run(['token', 'x'])).toBe(2);
    expect(await h.run(['token', '--site', 's1'])).toBe(2);
    expect(await harness(async () => ok({}), '').run(['token'])).toBe(3);
  });
});

describe('status', () => {
  it('works without a token and sends no Authorization header', async () => {
    const t = vi.fn(async () => ok({ status: 'ok', api: 'v1' }));
    const h = harness(t as unknown as typeof fetch, '');
    expect(await h.run(['status', '--json'])).toBe(0);
    const [c] = calls(t);
    expect(c!.url).toBe(`${API}/status`);
    expect(c!.headers.has('authorization')).toBe(false);
    expect(JSON.parse(h.out.join(''))).toEqual({ status: 'ok', api: 'v1' });
  });
  it('does not send a configured token either, and exits 0 when draining', async () => {
    const t = vi.fn(async () => ok({ status: 'draining', api: 'v1' }));
    const h = harness(t as unknown as typeof fetch, 'tpapi_secret');
    expect(await h.run(['status'])).toBe(0);
    expect(calls(t)[0]!.headers.has('authorization')).toBe(false);
    expect(h.out.join('')).toContain('draining');
  });
  it('other commands still need the token (exit 3) while status does not', async () => {
    const t = vi.fn(async () => ok([]));
    const h = harness(t as unknown as typeof fetch, '');
    expect(await h.run(['sites', 'list'])).toBe(3);
    expect(await h.run(['operations', 'list'])).toBe(3);
    expect(t).not.toHaveBeenCalled();
    expect(await h.run(['status'])).toBe(0);
  });
  it('rejects extra arguments and options', async () => {
    const h = harness(async () => ok({}), '');
    expect(await h.run(['status', 'x'])).toBe(2);
    expect(await h.run(['status', '--site', 's1'])).toBe(2);
  });
  it('the client refuses anonymous use of any other route', async () => {
    const t = vi.fn();
    const client = new ApiClient('', t as unknown as typeof fetch);
    await expect(client.request('GET', '/sites')).rejects.toMatchObject({ exitCode: 3 });
    expect(t).not.toHaveBeenCalled();
  });
});

describe('backups delete', () => {
  it('sends DELETE with Idempotency-Key and the percent-encoded id', async () => {
    const t = vi.fn(async () => ok({ operation_id: 'op1' }, 202));
    const h = harness(t as unknown as typeof fetch);
    expect(await h.run(['backups', 'delete', '--site', 's1', '--backup', 'a:b+c.zip', '--idempotency-key', KEY, '--json'])).toBe(0);
    const [c] = calls(t);
    expect(c!.url).toBe(`${API}/sites/s1/backups/a%3Ab%2Bc.zip`);
    expect(c!.init.method).toBe('DELETE');
    expect(c!.init.body).toBeUndefined();
    expect(c!.headers.get('idempotency-key')).toBe(KEY);
    expect(c!.headers.has('content-type')).toBe(false);
  });
  it('generates an Idempotency-Key when none is given', async () => {
    const t = vi.fn(async () => ok({ operation_id: 'op1' }, 202));
    await harness(t as unknown as typeof fetch).run(['backups', 'delete', '--site', 's1', '--backup', 'b.zip']);
    expect(calls(t)[0]!.headers.get('idempotency-key')).toMatch(/^[\x20-\x7e]{16,128}$/);
  });
  it('--wait polls the operation until succeeded', async () => {
    const t = vi.fn(async (url: RequestInfo | URL) => String(url).endsWith('/operations/op1')
      ? ok({ id: 'op1', status: t.mock.calls.length > 2 ? 'succeeded' : 'running' }) : ok({ operation_id: 'op1' }, 202));
    const h = harness(t as unknown as typeof fetch);
    expect(await h.run(['backups', 'delete', '--site', 's1', '--backup', 'b.zip', '--wait', '--timeout', '60', '--json'])).toBe(0);
    const c = calls(t);
    expect(c.map(x => x.init.method)).toEqual(['DELETE', 'GET', 'GET']);
    expect(c[1]!.url).toBe(`${API}/operations/op1`);
    expect(JSON.parse(h.out.join('')).status).toBe('succeeded');
  });
  it('--wait exits 1 for a failed delete operation', async () => {
    const t = vi.fn(async (url: RequestInfo | URL) => String(url).endsWith('/operations/op1')
      ? ok({ id: 'op1', status: 'failed', error_code: 'backup_in_use' }) : ok({ operation_id: 'op1' }, 202));
    expect(await harness(t as unknown as typeof fetch).run(['backups', 'delete', '--site', 's1', '--backup', 'b.zip', '--wait'])).toBe(1);
  });
  it('maps server errors to exit 1 with the code', async () => {
    const h = harness(async () => json({ error: { code: 'backup_protected' }, meta: {} }, 422));
    expect(await h.run(['backups', 'delete', '--site', 's1', '--backup', 'b.zip'])).toBe(1);
    expect(h.err.join('')).toContain('backup_protected');
  });
  it('rejects bad arguments with exit 2 before any request', async () => {
    const t = vi.fn(async () => ok({}));
    const h = harness(t as unknown as typeof fetch);
    for (const args of [
      ['backups', 'delete', '--site', 's1'], ['backups', 'delete', '--backup', 'b.zip'],
      ['backups', 'delete', '--site', 's1', '--backup', 'a/b.zip'], ['backups', 'delete', '--site', 's1', '--backup', '..'],
      ['backups', 'delete', '--site', 's1', '--backup', 'a..b'], ['backups', 'delete', '--site', 's1', '--backup', '%2e%2e'],
      ['backups', 'delete', '--site', 's1', '--backup', 'a\\b'], ['backups', 'delete', '--site', 's1', '--backup', 'b.zip', '--scope', 'all'],
      ['backups', 'delete', '--site', 's1', '--backup', 'b.zip', '--idempotency-key', 'short'],
      ['backups', 'list', '--site', 's1', '--backup', 'b.zip'],
    ]) expect(await h.run(args)).toBe(2);
    expect(t).not.toHaveBeenCalled();
  });
});

describe('backup id limits and help', () => {
  it('refuses a leading dash and 121 characters, accepts 120', async () => {
    const t = vi.fn(async () => ok({ operation_id: 'op1' }, 202));
    const h = harness(t as unknown as typeof fetch);
    expect(await h.run(['backups', 'delete', '--site', 's1', '--backup', '-x'])).toBe(2);
    expect(await h.run(['backups', 'delete', '--site', 's1', '--backup', 'a'.repeat(121)])).toBe(2);
    expect(t).not.toHaveBeenCalled();
    expect(await h.run(['backups', 'delete', '--site', 's1', '--backup', 'a'.repeat(120)])).toBe(0);
    expect(t).toHaveBeenCalledTimes(1);
  });
  it('--help lists every command', async () => {
    const h = harness(async () => ok({}));
    expect(await h.run(['--help'])).toBe(0);
    const text = h.out.join('');
    for (const c of ['sites list', 'sites show', 'backups list', 'backups create', 'backups delete', 'cache purge', 'operations get', 'operations wait', 'operations list',
      'deployments create', 'deployments put-file', 'deployments preview', 'deployments publish', 'deployments list', 'deployments rollback', 'turbopress token', 'turbopress status', '--version']) {
      expect(text).toContain(c);
    }
  });
});

describe('client DELETE and path validation', () => {
  const err = (status: number, code: string, headers: Record<string, string> = {}) => json({ error: { code }, meta: {} }, status, headers);
  const mk = (t: unknown) => new ApiClient('tpapi_secret', t as typeof fetch, async () => {});
  const path = '/sites/s1/backups/a%3Ab%2Bc.zip';

  it('requires an Idempotency-Key for DELETE', async () => {
    const t = vi.fn();
    await expect(mk(t).request('DELETE', path)).rejects.toMatchObject({ exitCode: 2 });
    expect(t).not.toHaveBeenCalled();
  });
  it('retries DELETE on 429 queue_full with the same key', async () => {
    const t = vi.fn().mockResolvedValueOnce(err(429, 'queue_full', { 'retry-after': '1' })).mockResolvedValueOnce(ok({ operation_id: 'op1' }, 202));
    await mk(t).request('DELETE', path, undefined, KEY);
    const c = calls(t);
    expect(c).toHaveLength(2);
    expect(c.map(x => x.headers.get('idempotency-key'))).toEqual([KEY, KEY]);
    expect(c.every(x => x.init.method === 'DELETE' && x.url === API + path)).toBe(true);
  });
  it('retries DELETE on 429 rate_limited and 503 api_draining', async () => {
    for (const [s, code] of [[429, 'rate_limited'], [503, 'api_draining']] as const) {
      const t = vi.fn().mockResolvedValueOnce(err(s, code, { 'retry-after': '1' })).mockResolvedValueOnce(ok({}, 202));
      await mk(t).request('DELETE', path, undefined, KEY);
      expect(t).toHaveBeenCalledTimes(2);
    }
  });
  it('does not retry DELETE on other 429/503 codes, 5xx or network errors', async () => {
    for (const make of [() => err(429, 'daily_limit'), () => err(503, 'api_unavailable'), () => err(502, 'bad_gateway'), () => err(429, 'new_writes')]) {
      const t = vi.fn().mockResolvedValue(make());
      await expect(mk(t).request('DELETE', path, undefined, KEY)).rejects.toMatchObject({ exitCode: 1 });
      expect(t).toHaveBeenCalledTimes(1);
    }
    const t = vi.fn().mockRejectedValue(new Error('net'));
    await expect(mk(t).request('DELETE', path, undefined, KEY)).rejects.toMatchObject({ exitCode: 1 });
    expect(t).toHaveBeenCalledTimes(1);
  });
  it('still refuses traversal and encoded slash, backslash and dot in route segments', async () => {
    const t = vi.fn();
    for (const p of ['/sites/s1/backups/..', '/sites/../x', '/sites/s1/backups/a%2fb', '/sites/s1/backups/a%2Fb', '/sites/s1/backups/a%5cb', '/sites/s1/backups/a%5Cb', '/sites/s1/backups/%2e%2e', '/sites/s1/backups/a%2Eb', '/sites/s1/backups/a\\b']) {
      await expect(mk(t).request('DELETE', p, undefined, KEY)).rejects.toMatchObject({ exitCode: 2 });
    }
    expect(t).not.toHaveBeenCalled();
  });
  it('lets encoded colon and plus through', async () => {
    const t = vi.fn(async () => ok({}, 202));
    await mk(t).request('DELETE', '/sites/s1/backups/x%3Ay%2Bz', undefined, KEY);
    expect(t).toHaveBeenCalledTimes(1);
  });
  it('keeps rate-limit headers on the response object', async () => {
    const t = vi.fn(async () => json({ data: {}, meta: {} }, 200, { 'x-ratelimit-remaining': '59' }));
    expect((await mk(t).request('GET', '/token')).headers.get('x-ratelimit-remaining')).toBe('59');
  });
});

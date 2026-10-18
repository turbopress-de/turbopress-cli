import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { ApiClient } from '../src/client.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const ok = (data: unknown, status = 200) => json({ data, meta: { request_id: 'r1' } }, status);
const API = 'https://panel.turbopress.de/api/v1';
const KEY = 'stable-key-123456';

function harness(transport: typeof fetch) {
  const out: string[] = [];
  const err: string[] = [];
  const run = (args: string[]) => runCli(args, { token: 'tpapi_secret', transport, stdout: s => out.push(s), stderr: s => err.push(s), sleep: async () => {} });
  return { out, err, run };
}
const calls = (t: ReturnType<typeof vi.fn>) => t.mock.calls.map(c => ({ url: String(c[0]), init: c[1] as RequestInit, headers: new Headers((c[1] as RequestInit).headers) }));
const opTransport = (op: unknown) => vi.fn(async (url: RequestInfo | URL) => String(url).endsWith('/operations/op1') ? ok(op) : ok({ operation_id: 'op1' }, 202));

afterEach(() => vi.restoreAllMocks());

describe('updates list', () => {
  it('sends GET without body or idempotency key and prints data', async () => {
    const data = { core: { current: '6.8.2', available: null }, plugins: [{ slug: 'akismet', name: 'Akismet', current: '5.3', available: '5.4' }], themes: [], checked_at: 'x' };
    const t = vi.fn(async () => ok(data));
    const h = harness(t as unknown as typeof fetch);
    expect(await h.run(['updates', 'list', '--site', 's1', '--json'])).toBe(0);
    const [c] = calls(t);
    expect(c!.url).toBe(`${API}/sites/s1/updates`);
    expect(c!.init.method).toBe('GET');
    expect(c!.init.body).toBeUndefined();
    expect(c!.headers.has('idempotency-key')).toBe(false);
    expect(JSON.parse(h.out.join(''))).toEqual(data);
  });
  it('rejects wrong options and missing site with exit 2', async () => {
    const t = vi.fn(async () => ok({}));
    const h = harness(t as unknown as typeof fetch);
    for (const args of [['updates', 'list'], ['updates', 'list', '--site', 's1', '--wait'], ['updates', 'list', '--site', 's1', '--plugin', 'a'], ['updates', 'list', '--site', 's1', '--idempotency-key', KEY]]) {
      expect(await h.run(args)).toBe(2);
    }
    expect(t).not.toHaveBeenCalled();
  });
  it('uses a 110 s request timeout only for this path and retries like GET', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const client = new ApiClient('tpapi_secret', (async () => ok({})) as typeof fetch, async () => {});
    await client.request('GET', '/sites/s1/updates');
    await client.request('GET', '/sites/s1/backups');
    expect(spy.mock.calls.map(c => c[0])).toEqual([110_000, 30_000]);
    const t = vi.fn().mockResolvedValueOnce(json({ error: { code: 'x' } }, 502)).mockResolvedValueOnce(ok({ plugins: [] }));
    await new ApiClient('tpapi_secret', t as unknown as typeof fetch, async () => {}).request('GET', '/sites/s1/updates');
    expect(t).toHaveBeenCalledTimes(2);
  });
  it('still honours a shorter deadline for the updates path', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    await new ApiClient('tpapi_secret', (async () => ok({})) as typeof fetch, async () => {}).request('GET', '/sites/s1/updates', undefined, undefined, { deadlineMs: Date.now() + 20_000 });
    expect(spy.mock.calls[0]![0]).toBeLessThanOrEqual(20_000);
  });
});

describe('updates run', () => {
  it('posts the items with an Idempotency-Key', async () => {
    const t = vi.fn(async () => ok({ operation_id: 'op1' }, 202));
    const h = harness(t as unknown as typeof fetch);
    expect(await h.run(['updates', 'run', '--site', 's1', '--plugin', 'akismet', '--theme', 'twentytwentyfour', '--plugin', 'hello-dolly', '--idempotency-key', KEY, '--json'])).toBe(0);
    const [c] = calls(t);
    expect(c!.url).toBe(`${API}/sites/s1/updates`);
    expect(c!.init.method).toBe('POST');
    expect(c!.headers.get('idempotency-key')).toBe(KEY);
    expect(c!.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(c!.init.body))).toEqual({ items: [
      { type: 'plugin', slug: 'akismet' }, { type: 'plugin', slug: 'hello-dolly' }, { type: 'theme', slug: 'twentytwentyfour' },
    ] });
  });
  it('rejects invalid item sets with exit 2 before any request', async () => {
    const t = vi.fn(async () => ok({}));
    const h = harness(t as unknown as typeof fetch);
    const base = ['updates', 'run', '--site', 's1'];
    for (const extra of [
      [], ['--plugin', 'a', '--plugin', 'b', '--plugin', 'c', '--theme', 'd', '--theme', 'e', '--theme', 'f'],
      ['--plugin', 'a', '--plugin', 'a'], ['--plugin', 'Akismet'], ['--plugin', 'a_b'], ['--theme', '-x'], ['--plugin', 'a/b'],
      ['--theme', 'a'.repeat(63)], ['--plugin'], ['--plugin', '--theme'], ['--core'], ['--core', 'x', '--plugin', 'a'], ['--plugin', 'a', '--confirm', 'x.de'],
    ]) expect(await h.run([...base, ...extra])).toBe(2);
    expect(await h.run(['updates', 'run', '--plugin', 'a'])).toBe(2);
    expect(t).not.toHaveBeenCalled();
  });
  it('accepts the same slug as plugin and theme, 5 items and a 62 character slug', async () => {
    const t = vi.fn(async () => ok({ operation_id: 'op1' }, 202));
    const h = harness(t as unknown as typeof fetch);
    expect(await h.run(['updates', 'run', '--site', 's1', '--plugin', 'a', '--theme', 'a', '--plugin', 'b', '--plugin', 'c', '--plugin', 'a'.repeat(62)])).toBe(0);
    expect(JSON.parse(String(calls(t)[0]!.init.body)).items).toHaveLength(5);
  });
  it('--wait polls and prints the result; exit 0 when all items are updated', async () => {
    const t = opTransport({ id: 'op1', status: 'succeeded', result: { safety_backup: 'b.zip', items: [{ type: 'plugin', slug: 'akismet', from: '5.3', to: '5.4', status: 'updated' }] } });
    const h = harness(t as unknown as typeof fetch);
    expect(await h.run(['updates', 'run', '--site', 's1', '--plugin', 'akismet', '--wait', '--timeout', '60', '--json'])).toBe(0);
    expect(calls(t).map(c => c.init.method)).toEqual(['POST', 'GET']);
    expect(JSON.parse(h.out.join('')).result.safety_backup).toBe('b.zip');
  });
  it('--wait exits 1 on failed or partial results and still prints the result', async () => {
    const failed = opTransport({ id: 'op1', status: 'failed', error_code: 'update_failed', result: { safety_backup: 'b.zip', items: [{ type: 'plugin', slug: 'akismet', status: 'failed' }] } });
    const h = harness(failed as unknown as typeof fetch);
    expect(await h.run(['updates', 'run', '--site', 's1', '--plugin', 'akismet', '--wait', '--json'])).toBe(1);
    expect(JSON.parse(h.out.join('')).result.safety_backup).toBe('b.zip');
    expect(h.err.join('')).toContain('update_failed');
    expect(h.err.join('')).toContain('idempotency_key=');
    expect(h.out.join('') + h.err.join('')).not.toContain('tpapi_secret');
    for (const [result, code] of [[{ status: 'partial', items: [] }, 1], [{ status: 'failed', items: [] }, 1], [{ items: [{ slug: 'a', status: 'skipped' }] }, 1],
      [{ items: [{ slug: 'a', status: 'failed' }] }, 1], [{ items: [{ slug: 'a', status: 'brand_new' }] }, 1], [{ items: [{ slug: 'a', status: 'unconfirmed' }] }, 4]] as const) {
      const t = opTransport({ id: 'op1', status: 'succeeded', result });
      const hh = harness(t as unknown as typeof fetch);
      expect(await hh.run(['updates', 'run', '--site', 's1', '--plugin', 'a', '--wait', '--idempotency-key', KEY, '--json'])).toBe(code);
      expect(JSON.parse(hh.out.join('')).result).toEqual(result);
      const e = hh.err.join('');
      expect(e).toContain('operation_id=op1');
      expect(e).toContain(`idempotency_key=${KEY}`);
      if (result.items.length) expect(e).toContain('a:');
      expect(hh.out.join('') + e).not.toContain('tpapi_secret');
    }
    const ok1 = opTransport({ id: 'op1', status: 'succeeded', result: { items: [{ slug: 'a', status: 'unchanged' }, { slug: 'b', status: 'updated' }] } });
    expect(await harness(ok1 as unknown as typeof fetch).run(['updates', 'run', '--site', 's1', '--plugin', 'a', '--plugin', 'b', '--wait'])).toBe(0);
  });
  it('--wait exits 4 when the outcome is unknown', async () => {
    const t = opTransport({ id: 'op1', status: 'unknown', error_code: 'unconfirmed_result', result: { items: [] } });
    const h = harness(t as unknown as typeof fetch);
    expect(await h.run(['updates', 'run', '--site', 's1', '--plugin', 'a', '--wait', '--json'])).toBe(4);
    expect(JSON.parse(h.out.join('')).status).toBe('unknown');
    expect(h.out.join('') + h.err.join('')).not.toContain('tpapi_secret');
  });
  it('without --wait the result is not judged', async () => {
    const t = vi.fn(async () => ok({ operation_id: 'op1' }, 202));
    expect(await harness(t as unknown as typeof fetch).run(['updates', 'run', '--site', 's1', '--plugin', 'a'])).toBe(0);
  });
  it('retries only on allowed codes, with the same key and body', async () => {
    const err = (status: number, code: string) => json({ error: { code }, meta: {} }, status, { 'retry-after': '1' });
    const t = vi.fn().mockResolvedValueOnce(err(429, 'queue_full')).mockResolvedValueOnce(err(503, 'api_draining')).mockResolvedValueOnce(ok({ operation_id: 'op1' }, 202));
    const h = harness(t as unknown as typeof fetch);
    expect(await h.run(['updates', 'run', '--site', 's1', '--plugin', 'a', '--idempotency-key', KEY])).toBe(0);
    const c = calls(t);
    expect(c).toHaveLength(3);
    expect(new Set(c.map(x => x.headers.get('idempotency-key')))).toEqual(new Set([KEY]));
    expect(new Set(c.map(x => String(x.init.body))).size).toBe(1);
    for (const e of [err(429, 'daily_limit'), err(503, 'api_unavailable'), err(502, 'updates_unavailable'), err(422, 'too_many_items')]) {
      const t2 = vi.fn().mockResolvedValue(e);
      expect(await harness(t2 as unknown as typeof fetch).run(['updates', 'run', '--site', 's1', '--plugin', 'a'])).toBe(1);
      expect(t2).toHaveBeenCalledTimes(1);
    }
  });
});

describe('staging delete', () => {
  it('sends DELETE with confirm as query, lowercased and encoded, plus an Idempotency-Key', async () => {
    const t = vi.fn(async () => ok({ operation_id: 'op1' }, 202));
    const h = harness(t as unknown as typeof fetch);
    expect(await h.run(['staging', 'delete', '--site', 's1', '--confirm', 'Staging.Example-1.COM', '--idempotency-key', KEY, '--json'])).toBe(0);
    const [c] = calls(t);
    expect(c!.url).toBe(`${API}/sites/s1/staging?confirm=staging.example-1.com`);
    expect(c!.init.method).toBe('DELETE');
    expect(c!.init.body).toBeUndefined();
    expect(c!.headers.get('idempotency-key')).toBe(KEY);
  });
  it('requires --confirm and never derives it', async () => {
    const t = vi.fn(async () => ok({}));
    const h = harness(t as unknown as typeof fetch);
    expect(await h.run(['staging', 'delete', '--site', 's1'])).toBe(2);
    expect(await h.run(['staging', 'delete', '--site', 's1', '--confirm'])).toBe(2);
    expect(await h.run(['staging', 'delete', '--confirm', 'staging.example.com'])).toBe(2);
    expect(t).not.toHaveBeenCalled();
  });
  it('rejects invalid hosts with exit 2', async () => {
    const t = vi.fn(async () => ok({}));
    const h = harness(t as unknown as typeof fetch);
    for (const host of ['a/b', 'a b', 'a..b', '.a.com', 'a.com.', '-a.com', 'a_b.com', 'a.com?x=1', 'a.com&b=1', 'a%2e.com', 'a\\b', 'stäging.de', 'a'.repeat(254), '..', 'a.-b', 'a-.b', 'a.' + 'b'.repeat(64), 'b'.repeat(64) + '.de', 'staging.exam\u212Ale.de', ('a'.repeat(63) + '.').repeat(4) + 'de']) {
      expect(await h.run(['staging', 'delete', '--site', 's1', '--confirm', host])).toBe(2);
    }
    expect(t).not.toHaveBeenCalled();
    expect(await h.run(['staging', 'delete', '--site', 's1', '--confirm', 'a'.repeat(63) + '.' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(61)])).toBe(0);
    expect(await h.run(['staging', 'delete', '--site', 's1', '--confirm', 'a'.repeat(64)])).toBe(2);
  });
  it('rejects unrelated options', async () => {
    const t = vi.fn(async () => ok({}));
    const h = harness(t as unknown as typeof fetch);
    expect(await h.run(['staging', 'delete', '--site', 's1', '--confirm', 'staging.a.de', '--plugin', 'x'])).toBe(2);
    expect(await h.run(['staging', 'delete', '--site', 's1', '--confirm', 'staging.a.de', '--confirm', 'staging.a.de'])).toBe(2);
    expect(await h.run(['updates', 'list', '--site', 's1', '--confirm', 'staging.a.de'])).toBe(2);
    expect(t).not.toHaveBeenCalled();
  });
  it('--wait polls; failed job exits 1, unknown exits 4', async () => {
    const good = opTransport({ id: 'op1', status: 'succeeded', result: { staging_host: 'staging.a.de', deleted: true, subdomain_removed: true } });
    const h = harness(good as unknown as typeof fetch);
    expect(await h.run(['staging', 'delete', '--site', 's1', '--confirm', 'staging.a.de', '--wait', '--json'])).toBe(0);
    expect(calls(good).map(c => c.init.method)).toEqual(['DELETE', 'GET']);
    expect(JSON.parse(h.out.join('')).result.deleted).toBe(true);
    const bad = opTransport({ id: 'op1', status: 'failed', error_code: 'staging_delete_failed' });
    const hb = harness(bad as unknown as typeof fetch);
    expect(await hb.run(['staging', 'delete', '--site', 's1', '--confirm', 'staging.a.de', '--wait', '--json'])).toBe(1);
    expect(JSON.parse(hb.out.join('')).error_code).toBe('staging_delete_failed');
    expect(hb.out.join('') + hb.err.join('')).not.toContain('tpapi_secret');
    const unknown = opTransport({ id: 'op1', status: 'unknown', result: { deleted: false } });
    const hu = harness(unknown as unknown as typeof fetch);
    expect(await hu.run(['staging', 'delete', '--site', 's1', '--confirm', 'staging.a.de', '--wait', '--json'])).toBe(4);
    expect(JSON.parse(hu.out.join('')).status).toBe('unknown');
    expect(hu.out.join('') + hu.err.join('')).not.toContain('tpapi_secret');
  });
  it('retries only on allowed codes with the same key and URL', async () => {
    const err = (status: number, code: string) => json({ error: { code }, meta: {} }, status, { 'retry-after': '1' });
    const t = vi.fn().mockResolvedValueOnce(err(429, 'rate_limited')).mockResolvedValueOnce(ok({ operation_id: 'op1' }, 202));
    expect(await harness(t as unknown as typeof fetch).run(['staging', 'delete', '--site', 's1', '--confirm', 'staging.a.de', '--idempotency-key', KEY])).toBe(0);
    const c = calls(t);
    expect(c.map(x => x.url)).toEqual([c[0]!.url, c[0]!.url]);
    expect(c.map(x => x.headers.get('idempotency-key'))).toEqual([KEY, KEY]);
    for (const e of [err(429, 'daily_limit'), err(503, 'x'), err(422, 'confirmation_mismatch'), err(404, 'staging_not_found')]) {
      const t2 = vi.fn().mockResolvedValue(e);
      expect(await harness(t2 as unknown as typeof fetch).run(['staging', 'delete', '--site', 's1', '--confirm', 'staging.a.de'])).toBe(1);
      expect(t2).toHaveBeenCalledTimes(1);
    }
  });
});

describe('client path validation with query', () => {
  const mk = (t: unknown) => new ApiClient('tpapi_secret', t as typeof fetch, async () => {});
  it('allows dots in the query of a DELETE', async () => {
    const t = vi.fn(async () => ok({}, 202));
    await mk(t).request('DELETE', '/sites/s1/staging?confirm=staging.example.com', undefined, KEY);
    expect(calls(t)[0]!.url).toBe(`${API}/sites/s1/staging?confirm=staging.example.com`);
  });
  it('still refuses .., %2f, %5c, %2e in the route and fragments or spaces anywhere', async () => {
    const t = vi.fn();
    for (const p of ['/sites/../staging?confirm=a.de', '/sites/s1%2fx/staging?confirm=a.de', '/sites/s1%5cx/staging?confirm=a.de', '/sites/%2e%2e/staging?confirm=a.de',
      '/sites/s1/staging?confirm=a.de#x', '/sites/s1/staging?confirm=a b', '/sites/s1/staging?confirm=a\\b', '//evil/x?confirm=a.de']) {
      await expect(mk(t).request('DELETE', p, undefined, KEY)).rejects.toMatchObject({ exitCode: 2 });
    }
    expect(t).not.toHaveBeenCalled();
  });
});

describe('help and sites passthrough', () => {
  it('--help lists the new commands and notes', async () => {
    const h = harness((async () => ok({})) as typeof fetch);
    expect(await h.run(['--help'])).toBe(0);
    const text = h.out.join('');
    for (const c of ['updates list', 'updates run', 'staging delete', 'plugins and themes only', 'safety backup', 'removes the staging site permanently']) expect(text).toContain(c);
  });
  it('--version prints 0.4.0', async () => {
    const h = harness((async () => ok({})) as typeof fetch);
    expect(await h.run(['--version'])).toBe(0);
    expect(h.out.join('').trim()).toBe('0.4.0');
  });
  it('passes role and staging_of through unchanged', async () => {
    const site = { id: 's2', role: 'staging', staging_of: 's1' };
    const h = harness((async () => ok(site)) as typeof fetch);
    expect(await h.run(['sites', 'show', '--site', 's2', '--json'])).toBe(0);
    expect(JSON.parse(h.out.join(''))).toEqual(site);
  });
});

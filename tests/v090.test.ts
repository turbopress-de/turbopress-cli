import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (data: unknown, status = 200) => json({ data, meta: { request_id: 'r1' } }, status);
const API = 'https://panel.turbopress.de/api/v1';
const KEY = 'stable-key-123456';

function harness(transport: unknown) {
  const out: string[] = [];
  const errs: string[] = [];
  const run = (args: string[]) => runCli(args, { token: 'tpapi_secret', transport: transport as typeof fetch, stdout: s => out.push(s), stderr: s => errs.push(s), sleep: async () => {} });
  return { out, err: errs, run };
}
const calls = (t: ReturnType<typeof vi.fn>) => t.mock.calls.map(c => ({ url: String(c[0]), init: c[1] as RequestInit, headers: new Headers((c[1] as RequestInit).headers) }));
const opTransport = (op: unknown) => vi.fn(async (url: RequestInfo | URL) => String(url).endsWith('/operations/op1') ? ok(op) : ok({ id: 'op1', kind: 'staging:refresh', status: 'queued' }, 202));

describe('staging refresh', () => {
  it('POSTs {"scope":"db"} with the Idempotency-Key', async () => {
    const t = opTransport({});
    const h = harness(t);
    expect(await h.run(['staging', 'refresh', '--site', 's1', '--scope', 'db', '--idempotency-key', KEY, '--json'])).toBe(0);
    const c = calls(t);
    expect(c).toHaveLength(1);
    expect(c[0]!.url).toBe(`${API}/sites/s1/staging/refresh`);
    expect(c[0]!.init.method).toBe('POST');
    expect(c[0]!.init.body).toBe('{"scope":"db"}');
    expect(c[0]!.headers.get('idempotency-key')).toBe(KEY);
  });
  it('accepts all and files, refuses selected, other values, missing scope and foreign flags without a request', async () => {
    const t = opTransport({});
    const h = harness(t);
    expect(await h.run(['staging', 'refresh', '--site', 's1', '--scope', 'all', '--idempotency-key', KEY])).toBe(0);
    expect(await h.run(['staging', 'refresh', '--site', 's1', '--scope', 'files', '--idempotency-key', KEY])).toBe(0);
    expect(t).toHaveBeenCalledTimes(2);
    t.mockClear();
    for (const args of [['--scope', 'selected'], ['--scope', 'full'], [], ['--scope', 'db', '--tables', 'a'], ['--scope', 'db', '--confirm-host', 'x'], ['--scope', 'db', '--dry-run']]) {
      expect(await h.run(['staging', 'refresh', '--site', 's1', ...args])).toBe(2);
    }
    expect(t).not.toHaveBeenCalled();
  });
  it('--wait polls the operation like staging create and prints the result', async () => {
    const result = { staging_host: 'staging.example.com', scope: 'db', search_engines_hidden: true, environment_staging: true, object_cache_flushed: true, reachable: null };
    const t = opTransport({ id: 'op1', kind: 'staging:refresh', status: 'succeeded', result });
    const h = harness(t);
    expect(await h.run(['staging', 'refresh', '--site', 's1', '--scope', 'all', '--wait', '--json'])).toBe(0);
    const c = calls(t);
    expect(c[0]!.url).toBe(`${API}/sites/s1/staging/refresh`);
    expect(c[1]!.url).toBe(`${API}/operations/op1`);
    expect(JSON.parse(h.out.join('')).result).toEqual(result);
  });
  it('--wait: failed is 1 with result and hint, unknown is 4', async () => {
    const result = { staging_host: 'staging.example.com', scope: 'db', search_engines_hidden: true, environment_staging: true, object_cache_flushed: null, reachable: null };
    const hf = harness(opTransport({ id: 'op1', status: 'failed', error_code: 'staging_refresh_failed', result }));
    expect(await hf.run(['staging', 'refresh', '--site', 's1', '--scope', 'db', '--wait'])).toBe(1);
    expect(hf.out.join('')).toContain('staging.example.com');
    expect(hf.err.join('')).toContain('live site is unchanged');
    const hu = harness(opTransport({ id: 'op1', status: 'unknown', error_code: 'unconfirmed', result: null }));
    expect(await hu.run(['staging', 'refresh', '--site', 's1', '--scope', 'db', '--wait'])).toBe(4);
  });
});

describe('hints', () => {
  it('refusals carry hints', async () => {
    for (const [status, code, hint] of [[422, 'staging_in_use', 'backup or update'], [422, 'not_a_staging_copy', 'live site with --site']] as const) {
      const h = harness(vi.fn(async () => json({ error: { code, message: 'x' }, meta: { request_id: 'r9' } }, status)));
      expect(await h.run(['staging', 'refresh', '--site', 's1', '--scope', 'db', '--idempotency-key', KEY])).toBe(1);
      expect(h.err.join('')).toContain(hint);
    }
  });
});

describe('contract 0.9', () => {
  it('the pinned OpenAPI file has the refresh route and its request schema, and the CLI body fits', async () => {
    const { readFileSync } = await import('node:fs');
    const contract = JSON.parse(readFileSync(new URL('./fixtures/openapi.json', import.meta.url), 'utf8'));
    const op = contract.paths['/sites/{site_id}/staging/refresh']?.post;
    expect(op['x-permission']).toBe('staging:refresh');
    const schema = contract.components.schemas.StagingRefreshRequest;
    expect(schema.properties.scope.enum).toEqual(['all', 'db', 'files']);
    expect(schema.required).toEqual(['scope']);
    expect(schema.additionalProperties).toBe(false);
    const t = opTransport({});
    for (const scope of schema.properties.scope.enum as string[]) {
      expect(await harness(t).run(['staging', 'refresh', '--site', 's1', '--scope', scope, '--idempotency-key', KEY])).toBe(0);
    }
    const bodies = calls(t).map(c => JSON.parse(String(c.init.body)));
    expect(bodies).toEqual([{ scope: 'all' }, { scope: 'db' }, { scope: 'files' }]);
    for (const b of bodies) expect(Object.keys(b)).toEqual(Object.keys(schema.properties));
  });
});

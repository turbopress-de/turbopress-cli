import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';

const PKG_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const ok = (data: unknown, status = 200, meta: Record<string, unknown> = {}) => json({ data, meta: { request_id: 'r1', ...meta } }, status);
const err = (status: number, code: string) => json({ error: { code, message: 'secret tpapi_secret' }, meta: { request_id: 'r9' } }, status);
const API = 'https://panel.turbopress.de/api/v1';
const KEY = 'stable-key-123456';
const KIND = 'sites:profile';

function harness(transport: unknown) {
  const out: string[] = [];
  const errs: string[] = [];
  const run = (args: string[]) => runCli(args, { token: 'tpapi_secret', transport: transport as typeof fetch, stdout: s => out.push(s), stderr: s => errs.push(s), sleep: async () => {} });
  return { out, err: errs, run };
}
const calls = (t: ReturnType<typeof vi.fn>) => t.mock.calls.map(c => ({ url: String(c[0]), init: (c[1] ?? {}) as RequestInit, headers: new Headers(((c[1] ?? {}) as RequestInit).headers) }));
const queued = () => ok({ id: 'op1', kind: KIND, status: 'queued' }, 202);
const opTransport = (op: unknown) => vi.fn(async (url: RequestInfo | URL) => String(url).endsWith('/operations/op1') ? ok(op) : queued());
const RESULT = { total_ms: 812.5, memory_mb: 61.2, requests: 5, path: '/shop/', cached: false, sql_measured: true, plugins: [], queries: [], http: [],
  measured_at: '2026-11-23T13:30:00+00:00', plugin_state: 'removed' };

describe('contract 0.12', () => {
  it('site profile hits the route and the body of the pinned OpenAPI file', async () => {
    const contract = JSON.parse(readFileSync(new URL('./fixtures/openapi.json', import.meta.url), 'utf8'));
    const post = contract.paths['/sites/{site_id}/profile'].post;
    expect(post['x-permission']).toBe('sites:profile');
    const schema = contract.components.schemas.ProfileRequest;
    expect(Object.keys(schema.properties)).toEqual(['path', 'keep_plugin']);
    expect(schema.additionalProperties).toBe(false);
    expect(contract.paths['/sites/{site_id}/profile'].get['x-permission']).toBe('sites:profile');
    const t = vi.fn(async () => queued());
    expect(await harness(t).run(['site', 'profile', '--site', 's1', '--path', '/shop/', '--keep-plugin', '--idempotency-key', KEY])).toBe(0);
    const body = JSON.parse(String(calls(t)[0]!.init.body));
    expect(Object.keys(body)).toEqual(Object.keys(schema.properties));
    expect(new RegExp(schema.properties.path.pattern).test(body.path)).toBe(true);
  });
  it('--version prints the package version 0.12.0 (not published)', async () => {
    const h = harness(vi.fn());
    expect(await h.run(['--version'])).toBe(0);
    expect(h.out.join('').trim()).toBe(PKG_VERSION);
    expect(PKG_VERSION).toBe('0.12.0');
  });
  it('the help lists the command and its exit codes', async () => {
    const h = harness(vi.fn());
    expect(await h.run(['--help'])).toBe(0);
    const text = h.out.join('');
    expect(text).toContain('turbopress site profile --site SITE [--path PATH] [--keep-plugin] [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]');
    expect(text).toContain('site profile:');
    expect(text).toContain('10 measurements a day');
  });
});

describe('site profile', () => {
  it('POSTs {"path","keep_plugin"} with the Idempotency-Key', async () => {
    const t = vi.fn(async () => queued());
    const h = harness(t);
    expect(await h.run(['site', 'profile', '--site', 's1', '--path', '/shop/', '--idempotency-key', KEY])).toBe(0);
    const c = calls(t);
    expect(c).toHaveLength(1);
    expect([c[0]!.init.method, c[0]!.url, c[0]!.headers.get('idempotency-key')]).toEqual(['POST', `${API}/sites/s1/profile`, KEY]);
    expect(String(c[0]!.init.body)).toBe('{"path":"/shop/","keep_plugin":false}');
  });
  it('defaults to the home page, --keep-plugin sends true, a key is generated', async () => {
    const t = vi.fn(async () => queued());
    expect(await harness(t).run(['site', 'profile', '--site', 's1', '--keep-plugin'])).toBe(0);
    expect(String(calls(t)[0]!.init.body)).toBe('{"path":"/","keep_plugin":true}');
    expect(calls(t)[0]!.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('checks the arguments locally and sends nothing', async () => {
    const t = vi.fn(async () => queued());
    const bad = [['site', 'profile'], ['site', 'profile', '--site', 's1', '--path', 'https://evil.test/'], ['site', 'profile', '--site', 's1', '--path', '//evil.test/'],
      ['site', 'profile', '--site', 's1', '--path', 'shop'], ['site', 'profile', '--site', 's1', '--path', '/a?x=1'], ['site', 'profile', '--site', 's1', '--path', '/a b'],
      ['site', 'profile', '--site', 's1', '--path', '/' + 'a'.repeat(201)], ['site', 'profile', '--site', 's1', '--path', ''],
      ['site', 'profile', '--site', 's1', '--proposal', 'x'], ['site', 'profile', '--site', 's1', '--timeout', '60'], ['site', 'profile', '--site', 's1', '--path', '/a', '--path', '/b'],
      ['site', 'diagnose', '--site', 's1', '--keep-plugin'], ['site', 'repair', '--site', 's1', '--proposal', '1.' + '0'.repeat(64), '--keep-plugin']];
    for (const args of bad) expect(await harness(t).run(args), args.join(' ')).toBe(2);
    expect(t).not.toHaveBeenCalled();
  });
  it('--wait: succeeded 0 and prints the result, failed 1 with a hint, unknown 4', async () => {
    const good = harness(opTransport({ id: 'op1', kind: KIND, status: 'succeeded', result: RESULT }));
    expect(await good.run(['site', 'profile', '--site', 's1', '--path', '/shop/', '--wait', '--json'])).toBe(0);
    const printed = JSON.parse(good.out.join(''));
    expect(printed.result.total_ms).toBe(812.5);
    expect(printed.result.plugin_state).toBe('removed');
    const failed = harness(opTransport({ id: 'op1', kind: KIND, status: 'failed', error_code: 'loopback_failed', result: null }));
    expect(await failed.run(['site', 'profile', '--site', 's1', '--wait'])).toBe(1);
    expect(failed.err.join('')).toContain('loopback_failed');
    expect(failed.err.join('')).toContain('could not be loaded');
    const unknown = harness(opTransport({ id: 'op1', kind: KIND, status: 'unknown', error_code: 'unconfirmed_result', result: null }));
    expect(await unknown.run(['site', 'profile', '--site', 's1', '--wait'])).toBe(4);
  });
  it('failure codes carry a hint', async () => {
    for (const [code, hint] of [['plugin_outdated', 'update'], ['plugin_install_failed', 'could not be installed'], ['redirect', 'redirects'], ['bad_status', 'error status'],
      ['cached', 'cache answered'], ['profile_failed', 'try again'], ['profile_not_enabled', 'not available for this account'], ['profile_unavailable', 'temporarily']] as const) {
      const h = harness(opTransport({ id: 'op1', kind: KIND, status: 'failed', error_code: code, result: null }));
      expect(await h.run(['site', 'profile', '--site', 's1', '--wait'])).toBe(1);
      expect(h.err.join(''), code).toContain(code);
      expect(h.err.join(''), code).toContain(hint);
    }
  });
  it('refusals carry hints and never echo the server text', async () => {
    for (const [status, code, hint, exit] of [[403, 'profile_not_enabled', 'not available for this account', 3], [409, 'site_busy', 'another operation', 1], [429, 'daily_limit', 'try again tomorrow', 1], [400, 'invalid_arguments', 'rejected', 1]] as const) {
      const h = harness(vi.fn().mockResolvedValue(err(status, code)));
      expect(await h.run(['site', 'profile', '--site', 's1'])).toBe(exit);
      expect(h.err.join('')).toContain(code);
      expect(h.err.join('')).toContain(hint);
      expect(h.err.join('')).not.toContain('tpapi_secret');
    }
  });
});

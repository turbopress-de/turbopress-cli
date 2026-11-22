import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const ok = (data: unknown, status = 200) => json({ data, meta: { request_id: 'r1' } }, status);
const err = (status: number, code: string) => json({ error: { code, message: 'secret tpapi_secret' }, meta: { request_id: 'r9' } }, status);
const API = 'https://panel.turbopress.de/api/v1';
const KEY = 'stable-key-123456';

function harness(transport: unknown) {
  const out: string[] = [];
  const errs: string[] = [];
  const run = (args: string[]) => runCli(args, { token: 'tpapi_secret', transport: transport as typeof fetch, stdout: s => out.push(s), stderr: s => errs.push(s), sleep: async () => {} });
  return { out, err: errs, run };
}
const calls = (t: ReturnType<typeof vi.fn>) => t.mock.calls.map(c => ({ url: String(c[0]), init: c[1] as RequestInit, headers: new Headers((c[1] as RequestInit).headers) }));
const accepted = () => vi.fn(async () => ok({ operation_id: 'op1' }, 202));
const opTransport = (op: unknown) => vi.fn(async (url: RequestInfo | URL) => String(url).endsWith('/operations/op1') ? ok(op) : ok({ operation_id: 'op1' }, 202));

describe('contract 0.7.0', () => {
  it('the new commands hit routes that exist in the pinned OpenAPI file', () => {
    const contract = JSON.parse(readFileSync(new URL('./fixtures/openapi.json', import.meta.url), 'utf8'));
    expect(contract.paths['/sites/{site_id}/plugins'].post['x-permission']).toBe('plugins:install');
    expect(contract.paths['/sites/{site_id}/integrity'].get['x-permission']).toBe('integrity:read');
  });
});

describe('plugins install', () => {
  it('posts the slug, and activate only when asked, with an Idempotency-Key', async () => {
    const t = accepted();
    const h = harness(t);
    expect(await h.run(['plugins', 'install', '--site', 's1', '--plugin', 'wordfence', '--idempotency-key', KEY])).toBe(0);
    expect(await h.run(['plugins', 'install', '--site', 's1', '--plugin', 'wordfence', '--activate'])).toBe(0);
    const c = calls(t);
    expect(c[0]!.url).toBe(`${API}/sites/s1/plugins`);
    expect(c[0]!.init.method).toBe('POST');
    expect(c[0]!.headers.get('idempotency-key')).toBe(KEY);
    expect(JSON.parse(String(c[0]!.init.body))).toEqual({ slug: 'wordfence' });
    expect(JSON.parse(String(c[1]!.init.body))).toEqual({ slug: 'wordfence', activate: true });
  });
  it('takes only a wordpress.org slug and refuses foreign flags', async () => {
    const t = accepted();
    const h = harness(t);
    for (const args of [['plugins', 'install', '--site', 's1'], ['plugins', 'install', '--site', 's1', '--plugin', 'js_composer'], ['plugins', 'install', '--site', 's1', '--plugin', 'A'],
      ['plugins', 'install', '--site', 's1', '--plugin', 'a', '--plugin', 'b'], ['plugins', 'install', '--plugin', 'a'], ['plugins', 'enable', '--site', 's1', '--plugin', 'a', '--activate']]) {
      expect(await h.run(args)).toBe(2);
    }
    expect(t).not.toHaveBeenCalled();
  });
  it('--wait: succeeded 0, rolled back 1 with the result and a hint, unknown 4', async () => {
    const result = { slug: 'wordfence', installed: true, activated: true, checked: true, rolled_back: false, message: 'Das Plugin wurde installiert und aktiviert.' };
    const h = harness(opTransport({ id: 'op1', status: 'succeeded', result }));
    expect(await h.run(['plugins', 'install', '--site', 's1', '--plugin', 'wordfence', '--activate', '--wait', '--json'])).toBe(0);
    expect(JSON.parse(h.out.join('')).result).toEqual(result);
    const back = { ...result, activated: false, rolled_back: true, reason: 'log_fatal' };
    const hf = harness(opTransport({ id: 'op1', status: 'failed', error_code: 'activation_rolled_back', result: back }));
    expect(await hf.run(['plugins', 'install', '--site', 's1', '--plugin', 'wordfence', '--activate', '--wait', '--json'])).toBe(1);
    expect(hf.out.join('')).toContain('"rolled_back":true');
    expect(hf.err.join('')).toContain('do not activate it again before the cause');
    const hu = harness(opTransport({ id: 'op1', status: 'unknown', error_code: 'unconfirmed_result', result: { ...result, installed: null, activated: null } }));
    expect(await hu.run(['plugins', 'install', '--site', 's1', '--plugin', 'wordfence', '--wait'])).toBe(4);
  });
  it('reads API refusals with hints', async () => {
    for (const [status, code, hint] of [[409, 'plugin_already_installed', 'plugins enable'], [429, 'daily_limit', ''], [502, 'plugins_unavailable', 'plugin list']] as const) {
      const h = harness(vi.fn().mockResolvedValue(err(status, code)));
      expect(await h.run(['plugins', 'install', '--site', 's1', '--plugin', 'wordfence'])).toBe(1);
      expect(h.err.join('')).toContain(code);
      if (hint) expect(h.err.join('')).toContain(hint);
    }
  });
});

describe('plugins enable', () => {
  it('a rolled back activation exits 1 and says not to enable it again', async () => {
    const h = harness(opTransport({ id: 'op1', status: 'failed', error_code: 'activation_rolled_back',
      result: { slug: 'a', enabled: false, changed: false, checked: true, rolled_back: true, reason: 'kritischer_fehler', message: 'x' } }));
    expect(await h.run(['plugins', 'enable', '--site', 's1', '--plugin', 'a', '--wait'])).toBe(1);
    expect(h.err.join('')).toContain('activation_rolled_back');
    expect(h.err.join('')).toContain('do not activate it again');
  });
});

describe('core check', () => {
  it('reads the integrity route, no Idempotency-Key, no job', async () => {
    const data = { checkable: true, unchanged: false, counts: { modified: 1, missing: 0, extra: 0 }, modified_files: ['wp-includes/version.php'], missing_files: [], extra_files: [], checked_at: '2026-11-22T12:00:00+00:00' };
    const t = vi.fn(async () => ok(data));
    const h = harness(t);
    expect(await h.run(['core', 'check', '--site', 's1', '--json'])).toBe(0);
    const [c] = calls(t);
    expect(c!.url).toBe(`${API}/sites/s1/integrity`);
    expect(c!.init.method ?? 'GET').toBe('GET');
    expect(c!.headers.get('idempotency-key')).toBeNull();
    expect(JSON.parse(h.out.join(''))).toEqual(data);
    for (const args of [['core', 'check', '--site', 's1', '--wait'], ['core', 'check', '--site', 's1', '--idempotency-key', KEY], ['core', 'check']]) expect(await h.run(args)).toBe(2);
  });
  it('an unavailable check is an error with a hint, never clean', async () => {
    const h = harness(vi.fn().mockResolvedValue(err(502, 'integrity_unavailable')));
    expect(await h.run(['core', 'check', '--site', 's1'])).toBe(1);
    expect(h.err.join('')).toContain('not a clean result');
  });
});

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
const accepted = () => vi.fn(async () => ok({ id: 'op1', kind: 'php:write', status: 'queued' }, 202));
const opTransport = (op: unknown) => vi.fn(async (url: RequestInfo | URL) => String(url).endsWith('/operations/op1') ? ok(op) : ok({ id: 'op1' }, 202));

describe('contract 0.8 (unreleased)', () => {
  it('the new commands hit routes that exist in the pinned OpenAPI file', () => {
    const contract = JSON.parse(readFileSync(new URL('./fixtures/openapi.json', import.meta.url), 'utf8'));
    expect(contract.paths['/sites/{site_id}/php'].get['x-permission']).toBe('php:read');
    expect(contract.paths['/sites/{site_id}/php'].put['x-permission']).toBe('php:write');
    expect(contract.paths['/sites/{site_id}/php-test'].get['x-permission']).toBe('php_test:read');
    for (const [path, method] of [['/sites/{site_id}/php-test', 'post'], ['/sites/{site_id}/php-test', 'delete'], ['/sites/{site_id}/php-test/apply', 'post']]) {
      expect(contract.paths[path!][method!]['x-permission']).toBe('php_test:write');
    }
    expect(contract.paths['/sites/{site_id}/debug'].get['x-permission']).toBe('debug:read');
    expect(contract.paths['/sites/{site_id}/debug'].put['x-permission']).toBe('debug:write');
  });
});

describe('php', () => {
  it('show reads without a key, set PUTs the version as a job with a key', async () => {
    const t = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => (init?.method ?? 'GET') === 'GET'
      ? ok({ version: '8.3', full_version: '8.3.14', available_versions: ['8.3', '8.4'], host: 'example.de', applies_to: 'main_domain', checked_at: 'x' })
      : ok({ id: 'op1' }, 202));
    const h = harness(t);
    expect(await h.run(['php', 'show', '--site', 's1', '--json'])).toBe(0);
    expect(await h.run(['php', 'set', '--site', 's1', '--php-version', '8.4', '--idempotency-key', KEY])).toBe(0);
    const c = calls(t);
    expect(c[0]!.url).toBe(`${API}/sites/s1/php`);
    expect(c[0]!.headers.get('idempotency-key')).toBeNull();
    expect(c[1]!.url).toBe(`${API}/sites/s1/php`);
    expect(c[1]!.init.method).toBe('PUT');
    expect(c[1]!.headers.get('idempotency-key')).toBe(KEY);
    expect(JSON.parse(String(c[1]!.init.body))).toEqual({ version: '8.4' });
  });
  it('refuses bad versions and foreign flags before any request', async () => {
    const t = accepted();
    const h = harness(t);
    for (const args of [['php', 'set', '--site', 's1'], ['php', 'set', '--site', 's1', '--php-version', '8'], ['php', 'set', '--site', 's1', '--php-version', '8.4.1'],
      ['php', 'show', '--site', 's1', '--php-version', '8.4'], ['php', 'show', '--site', 's1', '--wait'], ['php', 'set', '--php-version', '8.4'], ['php', 'set', '--site', 's1', '--version', '8.4']]) {
      expect(await h.run(args)).toBe(2);
    }
    expect(t).not.toHaveBeenCalled();
  });
  it('--wait: succeeded 0, change_failed 1 with result and hint, unconfirmed 4', async () => {
    const result = { version: '8.4', previous_version: '8.3', changed: true, host: 'example.de', applies_to: 'main_domain' };
    const h = harness(opTransport({ id: 'op1', status: 'succeeded', result }));
    expect(await h.run(['php', 'set', '--site', 's1', '--php-version', '8.4', '--wait', '--json'])).toBe(0);
    expect(JSON.parse(h.out.join('')).result).toEqual(result);
    const hf = harness(opTransport({ id: 'op1', status: 'failed', error_code: 'php_version_change_failed', result: null }));
    expect(await hf.run(['php', 'set', '--site', 's1', '--php-version', '8.4', '--wait'])).toBe(1);
    expect(hf.err.join('')).toContain('old version is still set');
    const hu = harness(opTransport({ id: 'op1', status: 'unknown', error_code: 'php_version_unconfirmed', result: null }));
    expect(await hu.run(['php', 'set', '--site', 's1', '--php-version', '8.4', '--wait'])).toBe(4);
  });
  it('an unavailable version is refused with the hint', async () => {
    const h = harness(vi.fn().mockResolvedValue(err(422, 'php_version_not_available')));
    expect(await h.run(['php', 'set', '--site', 's1', '--php-version', '9.9'])).toBe(1);
    expect(h.err.join('')).toContain('php show lists the available versions');
  });
});

describe('php-test', () => {
  it('start, apply and discard are synchronous writes with a key; status is a read', async () => {
    const t = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const m = init?.method ?? 'GET';
      if (m === 'GET') return ok({ site_url: 'https://example.de/', test: null, available_versions: ['8.4'], package_busy: false });
      if (m === 'DELETE') return ok({ test_id: 7, result: 'discarded', from_version: '8.3', to_version: '8.4' });
      return ok({ test_id: 7, phase: String(url).endsWith('/apply') ? 'live_measure' : 'copy_create' }, 202);
    });
    const h = harness(t);
    expect(await h.run(['php-test', 'start', '--site', 's1', '--php-version', '8.4', '--idempotency-key', KEY])).toBe(0);
    expect(await h.run(['php-test', 'status', '--site', 's1'])).toBe(0);
    expect(await h.run(['php-test', 'apply', '--site', 's1'])).toBe(0);
    expect(await h.run(['php-test', 'apply', '--site', 's1', '--despite-warning'])).toBe(0);
    expect(await h.run(['php-test', 'discard', '--site', 's1'])).toBe(0);
    const c = calls(t);
    expect([c[0]!.init.method, c[0]!.url, c[0]!.headers.get('idempotency-key')]).toEqual(['POST', `${API}/sites/s1/php-test`, KEY]);
    expect(JSON.parse(String(c[0]!.init.body))).toEqual({ version: '8.4' });
    expect([c[1]!.init.method ?? 'GET', c[1]!.headers.get('idempotency-key')]).toEqual(['GET', null]);
    expect([c[2]!.init.method, c[2]!.url]).toEqual(['POST', `${API}/sites/s1/php-test/apply`]);
    expect(JSON.parse(String(c[2]!.init.body))).toEqual({});
    expect(JSON.parse(String(c[3]!.init.body))).toEqual({ despite_warning: true });
    expect(c[2]!.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect([c[4]!.init.method, c[4]!.url]).toEqual(['DELETE', `${API}/sites/s1/php-test`]);
  });
  it('is not a job: --wait and foreign flags are refused', async () => {
    const t = accepted();
    const h = harness(t);
    for (const args of [['php-test', 'start', '--site', 's1', '--php-version', '8.4', '--wait'], ['php-test', 'start', '--site', 's1'], ['php-test', 'status', '--site', 's1', '--despite-warning'],
      ['php-test', 'discard', '--site', 's1', '--despite-warning'], ['php-test', 'apply', '--site', 's1', '--php-version', '8.4'], ['php-test', 'run', '--site', 's1']]) {
      expect(await h.run(args)).toBe(2);
    }
    expect(t).not.toHaveBeenCalled();
  });
  it('refusals carry hints', async () => {
    for (const [status, code, hint] of [[409, 'php_test_running', 'php-test status'], [422, 'despite_warning_required', '--despite-warning'], [403, 'php_test_not_enabled', 'php set'],
      [429, 'daily_limit', '24 hours rolling'], [404, 'php_test_not_found', 'php-test start']] as const) {
      const h = harness(vi.fn().mockResolvedValue(err(status, code)));
      expect(await h.run(['php-test', 'apply', '--site', 's1'])).toBe(status === 403 ? 3 : 1);
      expect(h.err.join('')).toContain(code);
      expect(h.err.join('')).toContain(hint);
    }
  });
});

describe('debug', () => {
  it('show reads, on/off PUT enabled as a job', async () => {
    const t = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => (init?.method ?? 'GET') === 'GET'
      ? ok({ enabled: false, state: 'off', expires_at: null, site_url: 'https://example.de/', checked_at: 'x' }) : ok({ id: 'op1' }, 202));
    const h = harness(t);
    expect(await h.run(['debug', 'show', '--site', 's1'])).toBe(0);
    expect(await h.run(['debug', 'on', '--site', 's1'])).toBe(0);
    expect(await h.run(['debug', 'off', '--site', 's1'])).toBe(0);
    const c = calls(t);
    expect(c[0]!.url).toBe(`${API}/sites/s1/debug`);
    expect([c[1]!.init.method, JSON.parse(String(c[1]!.init.body))]).toEqual(['PUT', { enabled: true }]);
    expect(JSON.parse(String(c[2]!.init.body))).toEqual({ enabled: false });
    for (const args of [['debug', 'toggle', '--site', 's1'], ['debug', 'show', '--site', 's1', '--wait'], ['debug', 'on']]) expect(await h.run(args)).toBe(2);
  });
  it('--wait: not restorable exits 1 with the hint', async () => {
    const h = harness(opTransport({ id: 'op1', status: 'failed', error_code: 'debug_not_restorable', result: null }));
    expect(await h.run(['debug', 'on', '--site', 's1', '--wait'])).toBe(1);
    expect(h.err.join('')).toContain('change it there');
  });
});

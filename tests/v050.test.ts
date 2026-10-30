import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const ok = (data: unknown, status = 200) => json({ data, meta: { request_id: 'r1' } }, status);
const err = (status: number, code: string, headers: Record<string, string> = { 'retry-after': '1' }) => json({ error: { code, message: 'secret tpapi_secret' }, meta: { request_id: 'r9' } }, status, headers);
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

const restore = ['backups', 'restore', '--site', 's1', '--backup', 'b1.zip', '--scope', 'full', '--confirm-host', 'Example.DE'];
const push = ['staging', 'push', '--site', 's1', '--scope', 'all', '--no-delete-missing-files', '--confirm-host', 'example.de'];

describe('backups restore', () => {
  it('posts scope and the lowercased confirm_host with an Idempotency-Key and sets no defaults', async () => {
    const t = accepted();
    expect(await harness(t).run([...restore, '--idempotency-key', KEY])).toBe(0);
    const [c] = calls(t);
    expect(c!.url).toBe(`${API}/sites/s1/backups/b1.zip/restore`);
    expect(c!.init.method).toBe('POST');
    expect(c!.headers.get('idempotency-key')).toBe(KEY);
    expect(JSON.parse(String(c!.init.body))).toEqual({ scope: 'full', confirm_host: 'example.de' });
  });
  it('sends confirm_data_loss only when asked and folder only for scope folder', async () => {
    const t = accepted();
    const h = harness(t);
    expect(await h.run([...restore, '--confirm-data-loss'])).toBe(0);
    expect(JSON.parse(String(calls(t)[0]!.init.body))).toEqual({ scope: 'full', confirm_host: 'example.de', confirm_data_loss: true });
    expect(await h.run(['backups', 'restore', '--site', 's1', '--backup', 'b1.zip', '--scope', 'folder', '--folder', 'wp-content/plugins/akismet', '--confirm-host', 'example.de'])).toBe(0);
    expect(JSON.parse(String(calls(t)[1]!.init.body))).toEqual({ scope: 'folder', folder: 'wp-content/plugins/akismet', confirm_host: 'example.de' });
  });
  it('requires scope, backup, site and confirm-host and validates them before any request', async () => {
    const t = accepted();
    const h = harness(t);
    const base = ['backups', 'restore', '--site', 's1', '--backup', 'b1.zip', '--scope', 'full', '--confirm-host', 'example.de'];
    const without = (flag: string) => { const i = base.indexOf(flag); return base.filter((_, k) => k !== i && k !== i + 1); };
    for (const flag of ['--site', '--backup', '--scope', '--confirm-host']) expect(await h.run(without(flag))).toBe(2);
    for (const extra of [
      ['--scope', 'everything'], ['--confirm-host', 'a/b'], ['--confirm-host', 'example.de/x'], ['--folder', 'wp-content/uploads'],
      ['--wait', '--wait'], ['--dry-run'], ['--plugin', 'x'],
    ]) expect(await h.run([...base, ...extra])).toBe(2);
    const folder = ['backups', 'restore', '--site', 's1', '--backup', 'b1.zip', '--scope', 'folder', '--confirm-host', 'example.de'];
    expect(await h.run(folder)).toBe(2);
    for (const bad of ['wp-content', 'wp-content/uploads/2024', 'wp-content/plugins/Akismet', '../wp-content/uploads', 'wp-content/plugins/']) expect(await h.run([...folder, '--folder', bad])).toBe(2);
    expect(await h.run([...base.slice(0, 5), '--backup', 'x'])).toBe(2);
    expect(t).not.toHaveBeenCalled();
  });
  it('--wait prints the result and exits 0; failed exits 1 and unknown exits 4 with result on stdout', async () => {
    const good = opTransport({ id: 'op1', status: 'succeeded', result: { safety_backup: 's.zip', scope: 'full', restore_task: 'succeeded' } });
    const h = harness(good);
    expect(await h.run([...restore, '--wait', '--json'])).toBe(0);
    expect(calls(good).map(c => c.init.method)).toEqual(['POST', 'GET']);
    expect(JSON.parse(h.out.join('')).result.restore_task).toBe('succeeded');
    const bad = opTransport({ id: 'op1', status: 'failed', error_code: 'restore_failed', result: { safety_backup: 's.zip' } });
    const hb = harness(bad);
    expect(await hb.run([...restore, '--wait', '--idempotency-key', KEY, '--json'])).toBe(1);
    expect(JSON.parse(hb.out.join('')).result.safety_backup).toBe('s.zip');
    expect(hb.err.join('')).toContain('restore_failed');
    expect(hb.err.join('')).toContain('safety backup');
    expect(hb.err.join('')).toContain('operation_id=op1');
    expect(hb.err.join('')).toContain(`idempotency_key=${KEY}`);
    const unk = opTransport({ id: 'op1', status: 'unknown', error_code: 'restore_outcome_unknown', result: { scope: 'full' } });
    const hu = harness(unk);
    expect(await hu.run([...restore, '--wait', '--json'])).toBe(4);
    expect(JSON.parse(hu.out.join('')).status).toBe('unknown');
    expect(hu.err.join('')).toContain('unknown outcome (restore_outcome_unknown)');
    expect(hu.err.join('')).toContain('check the website');
    expect(hb.out.join('') + hb.err.join('') + hu.out.join('') + hu.err.join('')).not.toContain('tpapi_secret');
  });
  it('warns on stderr when the health check found a problem but stays exit 0', async () => {
    const t = opTransport({ id: 'op1', status: 'succeeded', result: { safety_backup: 's.zip', scope: 'database', health_check: 'issue_found' } });
    const h = harness(t);
    expect(await h.run([...restore.slice(0, 7), 'database', ...restore.slice(8), '--wait'])).toBe(0);
    expect(h.err.join('')).toContain('health check found a problem');
  });
  it('shows readable hints for API refusals and does not retry them', async () => {
    for (const [status, code, hint] of [[422, 'woo_confirmation_missing', '--confirm-data-loss'], [422, 'confirmation_mismatch', 'exact host'], [409, 'site_busy', 'another operation'],
      [503, 'delegation_unavailable', 'switched off'], [429, 'daily_limit', 'daily limit'], [422, 'service_unavailable', 'not available'], [404, 'backup_not_found', 'backups list']] as const) {
      const t = vi.fn().mockResolvedValue(err(status, code));
      const h = harness(t);
      expect(await h.run([...restore, '--idempotency-key', KEY])).toBe(1);
      expect(t).toHaveBeenCalledTimes(1);
      const e = h.err.join('');
      expect(e).toContain(`HTTP ${status}, ${code}`);
      expect(e).toContain('request_id=r9');
      expect(e).toContain(hint);
      expect(e).toContain(`idempotency_key=${KEY}`);
      expect(e).not.toContain('tpapi_secret');
    }
  });
  it('retries rate_limited/queue_full/api_draining with the same key and body', async () => {
    const t = vi.fn().mockResolvedValueOnce(err(429, 'rate_limited')).mockResolvedValueOnce(err(429, 'queue_full')).mockResolvedValueOnce(err(503, 'api_draining')).mockResolvedValueOnce(ok({ operation_id: 'op1' }, 202));
    const h = harness(t);
    expect(await h.run([...restore, '--idempotency-key', KEY])).toBe(0);
    const c = calls(t);
    expect(c).toHaveLength(4);
    expect(new Set(c.map(x => x.headers.get('idempotency-key')))).toEqual(new Set([KEY]));
    expect(new Set(c.map(x => String(x.init.body))).size).toBe(1);
    expect(h.err.join('')).toContain('Waiting 1s before retry 1/3 (rate_limited)');
  });
});

describe('core update', () => {
  it('posts {} by default and expected_version when given', async () => {
    const t = accepted();
    const h = harness(t);
    expect(await h.run(['core', 'update', '--site', 's1', '--idempotency-key', KEY])).toBe(0);
    expect(await h.run(['core', 'update', '--site', 's1', '--expected-version', '6.9.1'])).toBe(0);
    const c = calls(t);
    expect(c[0]!.url).toBe(`${API}/sites/s1/core-update`);
    expect(c[0]!.init.method).toBe('POST');
    expect(c[0]!.headers.get('idempotency-key')).toBe(KEY);
    expect(c[0]!.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(c[0]!.init.body))).toEqual({});
    expect(JSON.parse(String(c[1]!.init.body))).toEqual({ expected_version: '6.9.1' });
  });
  it('rejects bad versions, missing site and foreign options with exit 2', async () => {
    const t = accepted();
    const h = harness(t);
    for (const args of [['core', 'update'], ['core', 'update', '--site', 's1', '--expected-version', 'latest'], ['core', 'update', '--site', 's1', '--expected-version', '6'],
      ['core', 'update', '--site', 's1', '--expected-version', '6.9.1/x'], ['core', 'update', '--site', 's1', '--scope', 'all'], ['core', 'update', '--site', 's1', '--confirm-host', 'a.de'], ['core', 'show', '--site', 's1']]) {
      expect(await h.run(args)).toBe(2);
    }
    expect(t).not.toHaveBeenCalled();
    expect(await h.run(['core', 'update', '--site', 's1', '--expected-version', '6.9.1-RC1'])).toBe(0);
  });
  it('--wait: succeeded 0, failed 1 and unknown 4, with hints and the result on stdout', async () => {
    const h = harness(opTransport({ id: 'op1', status: 'succeeded', result: { safety_backup: 's.zip', from: '6.8', to: '6.9' } }));
    expect(await h.run(['core', 'update', '--site', 's1', '--wait', '--json'])).toBe(0);
    expect(JSON.parse(h.out.join('')).result.to).toBe('6.9');
    const hf = harness(opTransport({ id: 'op1', status: 'failed', error_code: 'core_update_failed', result: { safety_backup: 's.zip' } }));
    expect(await hf.run(['core', 'update', '--site', 's1', '--wait', '--json'])).toBe(1);
    expect(hf.err.join('')).toContain('core_update_failed');
    expect(JSON.parse(hf.out.join('')).result.safety_backup).toBe('s.zip');
    const hu = harness(opTransport({ id: 'op1', status: 'unknown', error_code: 'core_update_partial', result: { safety_backup: 's.zip' } }));
    expect(await hu.run(['core', 'update', '--site', 's1', '--wait', '--json'])).toBe(4);
    expect(hu.err.join('')).toContain('core_update_partial');
    expect(JSON.parse(hu.out.join('')).status).toBe('unknown');
  });
  it('reads API refusals', async () => {
    for (const [status, code, hint] of [[422, 'no_core_update', 'up to date'], [409, 'version_changed', 'expected-version'], [502, 'updates_unavailable', 'could not be read']] as const) {
      const t = vi.fn().mockResolvedValue(err(status, code));
      const h = harness(t);
      expect(await h.run(['core', 'update', '--site', 's1'])).toBe(1);
      expect(t).toHaveBeenCalledTimes(1);
      expect(h.err.join('')).toContain(code);
      expect(h.err.join('')).toContain(hint);
    }
  });
  it('retries only the safe codes', async () => {
    const t = vi.fn().mockResolvedValueOnce(err(503, 'api_draining')).mockResolvedValueOnce(ok({ operation_id: 'op1' }, 202));
    expect(await harness(t).run(['core', 'update', '--site', 's1', '--idempotency-key', KEY])).toBe(0);
    expect(calls(t).map(c => c.headers.get('idempotency-key'))).toEqual([KEY, KEY]);
    const t2 = vi.fn().mockResolvedValue(err(503, 'api_unavailable'));
    expect(await harness(t2).run(['core', 'update', '--site', 's1'])).toBe(1);
    expect(t2).toHaveBeenCalledTimes(1);
  });
});

describe('plugins enable|disable', () => {
  it('posts enabled true/false to the plugin state route', async () => {
    const t = accepted();
    const h = harness(t);
    expect(await h.run(['plugins', 'enable', '--site', 's1', '--plugin', 'akismet', '--idempotency-key', KEY])).toBe(0);
    expect(await h.run(['plugins', 'disable', '--site', 's1', '--plugin', 'wp-super_cache.v2'])).toBe(0);
    const c = calls(t);
    expect(c[0]!.url).toBe(`${API}/sites/s1/plugins/akismet/state`);
    expect(JSON.parse(String(c[0]!.init.body))).toEqual({ enabled: true });
    expect(c[0]!.headers.get('idempotency-key')).toBe(KEY);
    expect(c[1]!.url).toBe(`${API}/sites/s1/plugins/wp-super_cache.v2/state`);
    expect(JSON.parse(String(c[1]!.init.body))).toEqual({ enabled: false });
  });
  it('requires exactly one valid slug', async () => {
    const t = accepted();
    const h = harness(t);
    for (const args of [['plugins', 'enable', '--site', 's1'], ['plugins', 'enable', '--site', 's1', '--plugin', 'a', '--plugin', 'b'], ['plugins', 'enable', '--site', 's1', '--plugin', 'A'],
      ['plugins', 'enable', '--site', 's1', '--plugin', '.hidden'], ['plugins', 'enable', '--site', 's1', '--plugin', 'a..b'], ['plugins', 'enable', '--site', 's1', '--plugin', 'a/b'],
      ['plugins', 'enable', '--site', 's1', '--plugin', 'a'.repeat(63)], ['plugins', 'enable', '--plugin', 'a'], ['plugins', 'toggle', '--site', 's1', '--plugin', 'a'],
      ['plugins', 'enable', '--site', 's1', '--plugin', 'a', '--theme', 'b'], ['plugins', 'enable', 'a', '--site', 's1']]) {
      expect(await h.run(args)).toBe(2);
    }
    expect(t).not.toHaveBeenCalled();
  });
  it('--wait returns the short result; failed 1, unknown 4', async () => {
    const h = harness(opTransport({ id: 'op1', status: 'succeeded', result: { slug: 'akismet', enabled: false, changed: true } }));
    expect(await h.run(['plugins', 'disable', '--site', 's1', '--plugin', 'akismet', '--wait', '--json'])).toBe(0);
    expect(JSON.parse(h.out.join('')).result).toEqual({ slug: 'akismet', enabled: false, changed: true });
    const hf = harness(opTransport({ id: 'op1', status: 'failed', error_code: 'plugin_state_failed' }));
    expect(await hf.run(['plugins', 'disable', '--site', 's1', '--plugin', 'akismet', '--wait'])).toBe(1);
    const hu = harness(opTransport({ id: 'op1', status: 'unknown', error_code: 'plugin_state_unconfirmed' }));
    expect(await hu.run(['plugins', 'disable', '--site', 's1', '--plugin', 'akismet', '--wait'])).toBe(4);
    expect(hu.err.join('')).toContain('plugin_state_unconfirmed');
  });
  it('without --wait prints whatever the API answers, including an immediate 200', async () => {
    const h = harness(vi.fn(async () => ok({ id: 'op1', status: 'succeeded', result: { slug: 'a', enabled: true, changed: false } })));
    expect(await h.run(['plugins', 'enable', '--site', 's1', '--plugin', 'a', '--json'])).toBe(0);
    expect(JSON.parse(h.out.join('')).result.changed).toBe(false);
  });
  it('reads API refusals', async () => {
    for (const [status, code, hint] of [[404, 'plugin_not_installed', 'not installed'], [422, 'network_activated', 'network-activated'], [502, 'plugins_unavailable', 'plugin list']] as const) {
      const t = vi.fn().mockResolvedValue(err(status, code));
      const h = harness(t);
      expect(await h.run(['plugins', 'disable', '--site', 's1', '--plugin', 'a'])).toBe(1);
      expect(t).toHaveBeenCalledTimes(1);
      expect(h.err.join('')).toContain(code);
      expect(h.err.join('')).toContain(hint);
    }
  });
  it('retries a queue_full with the same key', async () => {
    const t = vi.fn().mockResolvedValueOnce(err(429, 'queue_full')).mockResolvedValueOnce(ok({ operation_id: 'op1' }, 202));
    expect(await harness(t).run(['plugins', 'enable', '--site', 's1', '--plugin', 'a', '--idempotency-key', KEY])).toBe(0);
    expect(calls(t).map(c => c.headers.get('idempotency-key'))).toEqual([KEY, KEY]);
  });
});

describe('staging create', () => {
  it('posts an empty JSON object with an Idempotency-Key', async () => {
    const t = accepted();
    expect(await harness(t).run(['staging', 'create', '--site', 's1', '--idempotency-key', KEY])).toBe(0);
    const [c] = calls(t);
    expect(c!.url).toBe(`${API}/sites/s1/staging`);
    expect(c!.init.method).toBe('POST');
    expect(c!.init.body).toBe('{}');
    expect(c!.headers.get('content-type')).toBe('application/json');
    expect(c!.headers.get('idempotency-key')).toBe(KEY);
  });
  it('rejects foreign options and missing site', async () => {
    const t = accepted();
    const h = harness(t);
    for (const args of [['staging', 'create'], ['staging', 'create', '--site', 's1', '--confirm', 'staging.a.de'], ['staging', 'create', '--site', 's1', '--scope', 'all'], ['staging', 'create', '--site', 's1', '--dry-run']]) expect(await h.run(args)).toBe(2);
    expect(t).not.toHaveBeenCalled();
  });
  it('--wait: succeeded 0, failed 1, unknown 4', async () => {
    const h = harness(opTransport({ id: 'op1', status: 'succeeded', result: { staging_host: 'staging.a.de', ssl: 'failed', staging_site_id: 'site_x' } }));
    expect(await h.run(['staging', 'create', '--site', 's1', '--wait', '--json'])).toBe(0);
    expect(JSON.parse(h.out.join('')).result.staging_site_id).toBe('site_x');
    const hf = harness(opTransport({ id: 'op1', status: 'failed', error_code: 'clone_failed', result: { staging_host: 'staging.a.de', subdomain_left: true } }));
    expect(await hf.run(['staging', 'create', '--site', 's1', '--wait', '--json'])).toBe(1);
    expect(JSON.parse(hf.out.join('')).result.subdomain_left).toBe(true);
    expect(hf.err.join('')).toContain('empty staging subdomain remains');
    const hu = harness(opTransport({ id: 'op1', status: 'unknown', error_code: 'clone_unconfirmed' }));
    expect(await hu.run(['staging', 'create', '--site', 's1', '--wait'])).toBe(4);
    expect(hu.err.join('')).toContain('locked');
  });
  it('reads API refusals', async () => {
    for (const [status, code, hint] of [[409, 'staging_exists', 'leftover'], [422, 'storage_insufficient', 'web space'], [422, 'no_live_instance', 'live WordPress'], [502, 'preparation_failed', 'nothing was changed']] as const) {
      const t = vi.fn().mockResolvedValue(err(status, code));
      const h = harness(t);
      expect(await h.run(['staging', 'create', '--site', 's1'])).toBe(1);
      expect(t).toHaveBeenCalledTimes(1);
      expect(h.err.join('')).toContain(code);
      expect(h.err.join('')).toContain(hint);
    }
  });
  it('retries api_draining with the same key', async () => {
    const t = vi.fn().mockResolvedValueOnce(err(503, 'api_draining')).mockResolvedValueOnce(ok({ operation_id: 'op1' }, 202));
    expect(await harness(t).run(['staging', 'create', '--site', 's1', '--idempotency-key', KEY])).toBe(0);
    expect(calls(t).map(c => c.headers.get('idempotency-key'))).toEqual([KEY, KEY]);
  });
});

describe('staging push', () => {
  it('posts every field explicitly with an Idempotency-Key', async () => {
    const t = accepted();
    expect(await harness(t).run([...push, '--idempotency-key', KEY])).toBe(0);
    const [c] = calls(t);
    expect(c!.url).toBe(`${API}/sites/s1/staging/push`);
    expect(c!.init.method).toBe('POST');
    expect(c!.headers.get('idempotency-key')).toBe(KEY);
    expect(JSON.parse(String(c!.init.body))).toEqual({ scope: 'all', delete_missing_files: false, confirm_host: 'example.de' });
  });
  it('sends delete_missing_files true, confirm_data_loss and selected tables', async () => {
    const t = accepted();
    const h = harness(t);
    expect(await h.run(['staging', 'push', '--site', 's1', '--scope', 'files', '--delete-missing-files', '--confirm-host', 'EXAMPLE.de', '--confirm-data-loss'])).toBe(0);
    expect(await h.run(['staging', 'push', '--site', 's1', '--scope', 'selected', '--tables', 'wp_posts,wp_options', '--no-delete-missing-files', '--confirm-host', 'example.de'])).toBe(0);
    const c = calls(t);
    expect(JSON.parse(String(c[0]!.init.body))).toEqual({ scope: 'files', delete_missing_files: true, confirm_host: 'example.de', confirm_data_loss: true });
    expect(JSON.parse(String(c[1]!.init.body))).toEqual({ scope: 'selected', tables: ['wp_posts', 'wp_options'], delete_missing_files: false, confirm_host: 'example.de' });
  });
  it('has no defaults: scope, delete flag and live host are mandatory and never derived', async () => {
    const t = accepted();
    const h = harness(t);
    const args = (...drop: string[]) => push.filter((a, i) => !drop.includes(a) && !drop.includes(push[i - 1]!));
    expect(await h.run(args('--scope'))).toBe(2);
    expect(await h.run(args('--no-delete-missing-files'))).toBe(2);
    expect(await h.run(args('--confirm-host'))).toBe(2);
    expect(await h.run(args('--site'))).toBe(2);
    expect(t).not.toHaveBeenCalled();
  });
  it('rejects invalid combinations with exit 2 before any request', async () => {
    const t = accepted();
    const h = harness(t);
    const base = ['staging', 'push', '--site', 's1', '--confirm-host', 'example.de'];
    for (const extra of [
      ['--scope', 'all', '--delete-missing-files', '--no-delete-missing-files'], ['--scope', 'all'], ['--scope', 'db', '--delete-missing-files'], ['--scope', 'selected', '--tables', 'a', '--delete-missing-files'],
      ['--scope', 'selected', '--no-delete-missing-files'], ['--scope', 'all', '--no-delete-missing-files', '--tables', 'wp_posts'], ['--scope', 'selected', '--tables', 'a,a', '--no-delete-missing-files'],
      ['--scope', 'selected', '--tables', 'a-b', '--no-delete-missing-files'], ['--scope', 'selected', '--tables', 'a,,b', '--no-delete-missing-files'], ['--scope', 'selected', '--tables', 'a'.repeat(65), '--no-delete-missing-files'],
      ['--scope', 'selected', '--tables', Array.from({ length: 1001 }, (_, i) => `t${i}`).join(','), '--no-delete-missing-files'],
      ['--scope', 'everything', '--no-delete-missing-files'], ['--scope', 'all', '--no-delete-missing-files', '--wait', '--dry-run'], ['--scope', 'all', '--no-delete-missing-files', '--confirm', 'x.de'],
    ]) expect(await h.run([...base, ...extra])).toBe(2);
    expect(await h.run(['staging', 'push', '--site', 's1', '--scope', 'all', '--no-delete-missing-files', '--confirm-host', 'a b'])).toBe(2);
    expect(t).not.toHaveBeenCalled();
    expect(await h.run([...base, '--scope', 'selected', '--tables', Array.from({ length: 1000 }, (_, i) => `t${i}`).join(','), '--no-delete-missing-files'])).toBe(0);
  });
  it('--wait: succeeded 0 (health check warning only on stderr), failed 1, unknown 4', async () => {
    const result = { safety_backup: { filename: 's.zip', created_at: null }, health_check: 'issue_found', scope: 'all', delete_missing_files: false };
    const h = harness(opTransport({ id: 'op1', status: 'succeeded', result }));
    expect(await h.run([...push, '--wait', '--json'])).toBe(0);
    expect(JSON.parse(h.out.join('')).result.safety_backup.filename).toBe('s.zip');
    expect(h.err.join('')).toContain('health check found a problem');
    const hf = harness(opTransport({ id: 'op1', status: 'failed', error_code: 'copy_failed', result: { safety_backup: { filename: 's.zip' } } }));
    expect(await hf.run([...push, '--wait', '--idempotency-key', KEY, '--json'])).toBe(1);
    expect(JSON.parse(hf.out.join('')).result.safety_backup.filename).toBe('s.zip');
    expect(hf.err.join('')).toContain('partly changed');
    expect(hf.err.join('')).toContain(`idempotency_key=${KEY}`);
    const hu = harness(opTransport({ id: 'op1', status: 'unknown', error_code: 'copy_outcome_unknown' }));
    expect(await hu.run([...push, '--wait', '--json'])).toBe(4);
    expect(JSON.parse(hu.out.join('')).status).toBe('unknown');
    expect(hu.err.join('')).toContain('check the live website');
    expect(hf.out.join('') + hf.err.join('') + hu.err.join('')).not.toContain('tpapi_secret');
  });
  it('reads API refusals and never retries them', async () => {
    for (const [status, code, hint] of [[404, 'staging_not_found', 'no staging copy'], [409, 'staging_ambiguous', 'not unique'], [422, 'unknown_table', '--dry-run'], [422, 'woo_confirmation_missing', '--confirm-data-loss'],
      [422, 'confirmation_mismatch', 'exact host'], [502, 'tables_unreadable', 'staging tables'], [503, 'delegation_unavailable', 'switched off'], [429, 'daily_limit', 'daily limit']] as const) {
      const t = vi.fn().mockResolvedValue(err(status, code));
      const h = harness(t);
      expect(await h.run([...push, '--idempotency-key', KEY])).toBe(1);
      expect(t).toHaveBeenCalledTimes(1);
      expect(h.err.join('')).toContain(`${code}`);
      expect(h.err.join('')).toContain(hint);
    }
  });
  it('retries rate_limited with the same key and body, but gives up after 3 retries', async () => {
    const t = vi.fn().mockResolvedValueOnce(err(429, 'rate_limited')).mockResolvedValueOnce(ok({ operation_id: 'op1' }, 202));
    expect(await harness(t).run([...push, '--idempotency-key', KEY])).toBe(0);
    const c = calls(t);
    expect(c.map(x => x.headers.get('idempotency-key'))).toEqual([KEY, KEY]);
    expect(c[0]!.init.body).toBe(c[1]!.init.body);
    const t2 = vi.fn(async () => err(429, 'queue_full'));
    expect(await harness(t2).run(push)).toBe(1);
    expect(t2).toHaveBeenCalledTimes(4);
  });
});

describe('staging push --dry-run', () => {
  const dry = {
    dry_run: true, scope: 'all', delete_missing_files: false, pair: { staging_host: 'staging.example.de', live_host: 'example.de' }, woocommerce_active: true,
    tables: ['wp_posts', 'wp_options'], missing_tables: [], backup_quota: { used: 2, limit: 5 }, storage_ok: true, busy: null, daily_limit_reached: false, staging_newer_than_live: null,
  };
  const dryArgs = ['staging', 'push', '--site', 's1', '--scope', 'all', '--dry-run'];
  it('sends no Idempotency-Key and only dry_run plus the given fields', async () => {
    const t = vi.fn(async () => ok(dry));
    const h = harness(t);
    expect(await h.run(dryArgs)).toBe(0);
    const [c] = calls(t);
    expect(c!.url).toBe(`${API}/sites/s1/staging/push`);
    expect(c!.init.method).toBe('POST');
    expect(c!.headers.has('idempotency-key')).toBe(false);
    expect(JSON.parse(String(c!.init.body))).toEqual({ scope: 'all', dry_run: true });
    expect(await h.run([...dryArgs, '--no-delete-missing-files', '--confirm-host', 'Example.de', '--confirm-data-loss'])).toBe(0);
    expect(JSON.parse(String(calls(t)[1]!.init.body))).toEqual({ scope: 'all', delete_missing_files: false, confirm_host: 'example.de', confirm_data_loss: true, dry_run: true });
    expect(calls(t)[1]!.headers.has('idempotency-key')).toBe(false);
  });
  it('prints readable text by default and the raw data with --json', async () => {
    const h = harness(vi.fn(async () => ok(dry)));
    expect(await h.run(dryArgs)).toBe(0);
    const text = h.out.join('');
    expect(text).toContain('Dry run: nothing was changed');
    expect(text).toContain('staging_host: staging.example.de');
    expect(text).toContain('live_host: example.de');
    expect(text).toContain('tables_in_staging: 2');
    expect(text).toContain('backup_quota: 2 of 5 used');
    expect(text).toContain('WooCommerce is active or unknown');
    expect(() => JSON.parse(text)).toThrow();
    const hj = harness(vi.fn(async () => ok(dry)));
    expect(await hj.run([...dryArgs, '--json'])).toBe(0);
    expect(JSON.parse(hj.out.join(''))).toEqual(dry);
  });
  it('reports findings (missing tables, busy, quota, storage, daily limit, null as unknown) with exit 0', async () => {
    const bad = { ...dry, scope: 'selected', woocommerce_active: null, tables: null, missing_tables: ['wp_nope\u0007'], backup_quota: { used: 5, limit: 5 }, storage_ok: false, busy: 'cockpit_busy', daily_limit_reached: true };
    const h = harness(vi.fn(async () => ok(bad)));
    expect(await h.run(['staging', 'push', '--site', 's1', '--scope', 'selected', '--tables', 'wp_nope', '--dry-run'])).toBe(0);
    const text = h.out.join('');
    for (const part of ['requested tables missing', 'wp_nope?', 'site is busy (cockpit_busy)', 'daily limit', 'not enough storage', 'no free backup slot', 'tables_in_staging: unknown', 'woocommerce_active: unknown']) expect(text).toContain(part);
    expect(text).not.toContain('\u0007');
  });
  it('does not accept --wait, --idempotency-key or --timeout and treats a job answer as an error', async () => {
    const t = vi.fn(async () => ok(dry));
    const h = harness(t);
    for (const extra of [['--wait'], ['--idempotency-key', KEY], ['--timeout', '5']]) expect(await h.run([...dryArgs, ...extra])).toBe(2);
    expect(t).not.toHaveBeenCalled();
    const job = harness(vi.fn(async () => ok({ operation_id: 'op1' }, 202)));
    expect(await job.run(dryArgs)).toBe(1);
    expect(job.err.join('')).toContain('Unexpected dry-run response');
  });
  it('validates scope and tables like a real run but does not demand the delete flag or live host', async () => {
    const t = vi.fn(async () => ok(dry));
    const h = harness(t);
    expect(await h.run(['staging', 'push', '--site', 's1', '--dry-run'])).toBe(2);
    expect(await h.run(['staging', 'push', '--site', 's1', '--scope', 'selected', '--dry-run'])).toBe(2);
    expect(await h.run([...dryArgs, '--tables', 'a'])).toBe(2);
    expect(await h.run(['staging', 'push', '--site', 's1', '--scope', 'db', '--delete-missing-files', '--dry-run'])).toBe(2);
    expect(await h.run([...dryArgs, '--confirm-host', 'a/b'])).toBe(2);
    expect(t).not.toHaveBeenCalled();
  });
  it('retries the safe codes without ever adding a key; other errors are not retried', async () => {
    const t = vi.fn().mockResolvedValueOnce(err(503, 'api_draining')).mockResolvedValueOnce(err(429, 'rate_limited')).mockResolvedValueOnce(ok(dry));
    const h = harness(t);
    expect(await h.run(dryArgs)).toBe(0);
    expect(calls(t).every(c => !c.headers.has('idempotency-key'))).toBe(true);
    expect(calls(t)).toHaveLength(3);
    const t2 = vi.fn().mockResolvedValue(err(409, 'staging_ambiguous'));
    const h2 = harness(t2);
    expect(await h2.run(dryArgs)).toBe(1);
    expect(t2).toHaveBeenCalledTimes(1);
    expect(h2.err.join('')).not.toContain('idempotency_key=');
  });
});

describe('help and version', () => {
  it('--help documents the new commands and the overwrite warnings', async () => {
    const h = harness(vi.fn());
    expect(await h.run(['--help'])).toBe(0);
    const text = h.out.join('');
    for (const part of ['backups restore', 'core update', 'plugins enable|disable', 'staging create', 'staging push', '--dry-run', 'OVERWRITES THE LIVE SITE', 'OVERWRITES the site with the backup', 'safety backup', 'never filled in automatically', 'DELETES files']) expect(text).toContain(part);
  });
  it('--version prints 0.6.0', async () => {
    const h = harness(vi.fn());
    expect(await h.run(['--version'])).toBe(0);
    expect(h.out.join('').trim()).toBe('0.6.0');
  });
  it('does not use the capitalised brand name in help text', async () => {
    const h = harness(vi.fn());
    await h.run(['--help']);
    expect(h.out.join('')).not.toMatch(/Turbopress|TurboPress/);
  });
});

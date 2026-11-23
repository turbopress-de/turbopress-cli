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
const TIME = '2026-11-20T02:00:12+01:00';
const KIND = 'server-backup:restore';

function harness(transport: unknown) {
  const out: string[] = [];
  const errs: string[] = [];
  const run = (args: string[]) => runCli(args, { token: 'tpapi_secret', transport: transport as typeof fetch, stdout: s => out.push(s), stderr: s => errs.push(s), sleep: async () => {} });
  return { out, err: errs, run };
}
const calls = (t: ReturnType<typeof vi.fn>) => t.mock.calls.map(c => ({ url: String(c[0]), init: (c[1] ?? {}) as RequestInit, headers: new Headers(((c[1] ?? {}) as RequestInit).headers) }));
const opTransport = (op: unknown) => vi.fn(async (url: RequestInfo | URL) => String(url).endsWith('/operations/op1') ? ok(op) : ok({ id: 'op1', kind: KIND, status: 'queued' }, 202));
const RESULT = {
  backup_time: TIME, scope: 'db', safety_backup: { filename: 'example.test__2026-11-23T09_00_00+0100.zip', created_at: '2026-11-23T09:00:00+01:00' },
  object_cache_flushed: true, page_cache_purged: true, reachable: true, wp_config_restored: null, dns_unchanged: true,
};
const LIST = [
  { backup_time: '2026-11-21T02:00:15+01:00', warning: true, metrics: { posts: 12, pages: 4, plugins_active: 9, comments: 3, wp_version: '6.8.3', trend: {} } },
  { backup_time: TIME, warning: false, metrics: null },
];

describe('contract 0.11', () => {
  it('the new commands hit routes that exist in the pinned OpenAPI file, and the body fits the request schema', async () => {
    const contract = JSON.parse(readFileSync(new URL('./fixtures/openapi.json', import.meta.url), 'utf8'));
    expect(contract.paths['/sites/{site_id}/server-backups'].get['x-permission']).toBe('backups:read');
    const post = contract.paths['/sites/{site_id}/server-backups/restore'].post;
    expect(post['x-permission']).toBe('backups:restore');
    const schema = contract.components.schemas.ServerBackupRestoreRequest;
    expect(Object.keys(schema.properties)).toEqual(['backup_time', 'scope']);
    expect(schema.required).toEqual(['backup_time', 'scope']);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.scope.enum).toEqual(['all', 'db', 'files']);
    const t = opTransport({});
    for (const scope of schema.properties.scope.enum as string[]) {
      expect(await harness(t).run(['backups', 'server-restore', '--site', 's1', '--time', TIME, '--scope', scope, '--idempotency-key', KEY])).toBe(0);
    }
    const bodies = calls(t).map(c => JSON.parse(String(c.init.body)));
    expect(bodies.map(b => b.scope)).toEqual(['all', 'db', 'files']);
    for (const b of bodies) expect(Object.keys(b)).toEqual(Object.keys(schema.properties));
  });
  it('--version prints the package version', async () => {
    const h = harness(vi.fn());
    expect(await h.run(['--version'])).toBe(0);
    expect(h.out.join('').trim()).toBe(PKG_VERSION);
    expect(PKG_VERSION).toMatch(/^\d+\.\d+\.\d+$/); // the exact release is pinned by the test of the current version (v0120)
  });
  it('the help lists both commands and the warning', async () => {
    const h = harness(vi.fn());
    expect(await h.run(['--help'])).toBe(0);
    const text = h.out.join('');
    expect(text).toContain('turbopress backups server-list --site SITE [--json]');
    expect(text).toContain('turbopress backups server-restore --site SITE --time BACKUP_TIME --scope all|db|files [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]');
    expect(text).toContain('backups server-restore: OVERWRITES THE LIVE SITE');
  });
});

describe('backups server-list', () => {
  it('GETs the stands without an Idempotency-Key and prints data and meta', async () => {
    const t = vi.fn(async () => ok(LIST, 200, { next_cursor: null }));
    const h = harness(t);
    expect(await h.run(['backups', 'server-list', '--site', 's1', '--json'])).toBe(0);
    const c = calls(t);
    expect(c).toHaveLength(1);
    expect(c[0]!.url).toBe(`${API}/sites/s1/server-backups`);
    expect(c[0]!.init.method ?? 'GET').toBe('GET');
    expect(c[0]!.headers.get('idempotency-key')).toBeNull();
    const printed = JSON.parse(h.out.join(''));
    expect(printed.data).toEqual(LIST);
    expect(printed.meta.next_cursor).toBeNull();
  });
  it('refuses foreign flags, a missing site and a bad site id before any request', async () => {
    const t = vi.fn();
    const h = harness(t);
    for (const args of [['backups', 'server-list'], ['backups', 'server-list', '--site', 's1', '--limit', '5'], ['backups', 'server-list', '--site', 's1', '--cursor', 'x'],
      ['backups', 'server-list', '--site', 's1', '--wait'], ['backups', 'server-list', '--site', 's1', '--idempotency-key', KEY], ['backups', 'server-list', '--site', 's1', '--time', TIME],
      ['backups', 'server-list', '--site', '../x'], ['backups', 'server-lists', '--site', 's1']]) {
      expect(await h.run(args)).toBe(2);
    }
    expect(t).not.toHaveBeenCalled();
  });
  it('refusals carry hints', async () => {
    for (const [status, code, hint, exit] of [[404, 'not_available', 'not enabled for this account', 1], [502, 'server_backups_unavailable', 'could not be read', 1], [422, 'capability_unavailable', 'not available for this site', 1]] as const) {
      const h = harness(vi.fn().mockResolvedValue(err(status, code)));
      expect(await h.run(['backups', 'server-list', '--site', 's1'])).toBe(exit);
      expect(h.err.join('')).toContain(code);
      expect(h.err.join('')).toContain(hint);
      expect(h.err.join('')).not.toContain('tpapi_secret');
    }
  });
});

describe('backups server-restore', () => {
  it('POSTs exactly {"backup_time","scope"} with the Idempotency-Key', async () => {
    const t = vi.fn(async () => ok({ id: 'op1', kind: KIND, status: 'queued' }, 202));
    const h = harness(t);
    expect(await h.run(['backups', 'server-restore', '--site', 's1', '--time', TIME, '--scope', 'db', '--idempotency-key', KEY])).toBe(0);
    const c = calls(t);
    expect(c).toHaveLength(1);
    expect([c[0]!.init.method, c[0]!.url, c[0]!.headers.get('idempotency-key')]).toEqual(['POST', `${API}/sites/s1/server-backups/restore`, KEY]);
    expect(JSON.parse(String(c[0]!.init.body))).toEqual({ backup_time: TIME, scope: 'db' });
  });
  it('accepts Z and other offsets and generates a key when none is given', async () => {
    const t = vi.fn(async () => ok({ id: 'op1' }, 202));
    const h = harness(t);
    expect(await h.run(['backups', 'server-restore', '--site', 's1', '--time', '2026-11-20T01:00:12Z', '--scope', 'files'])).toBe(0);
    expect(calls(t)[0]!.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(calls(t)[0]!.init.body)).backup_time).toBe('2026-11-20T01:00:12Z');
  });
  it('refuses a missing or malformed --time / --scope and foreign flags before any request', async () => {
    const t = vi.fn();
    const h = harness(t);
    const base = ['backups', 'server-restore', '--site', 's1'];
    for (const args of [
      [...base, '--scope', 'db'], [...base, '--time', TIME], [...base, '--time', TIME, '--scope', 'full'], [...base, '--time', TIME, '--scope', 'database'], [...base, '--time', TIME, '--scope', 'folder'],
      [...base, '--time', '2026-11-20 02:00:12', '--scope', 'db'], [...base, '--time', '2026-11-20T02:00:12', '--scope', 'db'], [...base, '--time', '2026-11-20', '--scope', 'db'],
      [...base, '--time', '2026-13-45T25:61:61+01:00', '--scope', 'db'], [...base, '--time', '2026-02-30T02:00:12Z', '--scope', 'db'],
      [...base, '--time', `${TIME}x`, '--scope', 'db'], [...base, '--time', TIME, '--scope', 'db', '--scope', 'all'], [...base, '--time', TIME, '--time', TIME, '--scope', 'db'],
      ['backups', 'server-restore', '--time', TIME, '--scope', 'db'],
      [...base, '--time', TIME, '--scope', 'db', '--confirm-host', 'example.test'], [...base, '--time', TIME, '--scope', 'db', '--backup', 'a.zip'],
      [...base, '--time', TIME, '--scope', 'db', '--folder', 'wp-content/uploads'], [...base, '--time', TIME, '--scope', 'db', '--confirm-data-loss'], [...base, '--time', TIME, '--scope', 'db', '--dry-run'],
    ]) {
      expect(await h.run(args), args.join(' ')).toBe(2);
    }
    expect(t).not.toHaveBeenCalled();
  });
  it('the old restore command is untouched', async () => {
    const t = vi.fn(async () => ok({ id: 'op1' }, 202));
    const h = harness(t);
    expect(await h.run(['backups', 'restore', '--site', 's1', '--backup', 'a.zip', '--scope', 'full', '--confirm-host', 'example.test', '--idempotency-key', KEY])).toBe(0);
    expect(calls(t)[0]!.url).toBe(`${API}/sites/s1/backups/a.zip/restore`);
    expect(await h.run(['backups', 'restore', '--site', 's1', '--backup', 'a.zip', '--scope', 'full', '--confirm-host', 'example.test', '--time', TIME])).toBe(2);
  });
  it('--wait: succeeded 0 and the result is printed', async () => {
    const h = harness(opTransport({ id: 'op1', kind: KIND, status: 'succeeded', result: RESULT }));
    expect(await h.run(['backups', 'server-restore', '--site', 's1', '--time', TIME, '--scope', 'db', '--wait', '--json'])).toBe(0);
    expect(JSON.parse(h.out.join('')).result).toEqual(RESULT);
    expect(h.err.join('')).not.toContain('Finished, but');
  });
  it('--wait: a follow-up step that did not confirm is exit 0 with a note on stderr', async () => {
    for (const flag of ['reachable', 'dns_unchanged', 'wp_config_restored'] as const) {
      const h = harness(opTransport({ id: 'op1', kind: KIND, status: 'succeeded', result: { ...RESULT, [flag]: false } }));
      expect(await h.run(['backups', 'server-restore', '--site', 's1', '--time', TIME, '--scope', 'all', '--wait'])).toBe(0);
      expect(h.err.join('')).toContain('Finished, but');
      expect(h.err.join('')).toContain(flag);
    }
  });
  it('--wait: failed 1 and unknown 4 print the result with the safety backup and the operation id', async () => {
    const failed = harness(opTransport({ id: 'op1', kind: KIND, status: 'failed', error_code: 'server_restore_failed', result: RESULT }));
    expect(await failed.run(['backups', 'server-restore', '--site', 's1', '--time', TIME, '--scope', 'db', '--wait', '--json'])).toBe(1);
    expect(JSON.parse(failed.out.join('')).result.safety_backup.filename).toContain('example.test__');
    expect(failed.err.join('')).toContain('operation_id=op1');
    for (const code of ['restore_outcome_unknown', 'restore_rollback_pending', 'restore_rollback_failed', 'backend_timeout']) {
      const unknown = harness(opTransport({ id: 'op1', kind: KIND, status: 'unknown', error_code: code, result: RESULT }));
      expect(await unknown.run(['backups', 'server-restore', '--site', 's1', '--time', TIME, '--scope', 'db', '--wait'])).toBe(4);
      expect(JSON.parse(unknown.out.join('')).result.scope).toBe('db');
      expect(unknown.err.join('')).toContain('operation_id=op1');
    }
  });
  it('--wait tolerates the long wait: it keeps polling while the operation runs', async () => {
    let polls = 0;
    const t = vi.fn(async (url: RequestInfo | URL) => String(url).endsWith('/operations/op1')
      ? ok(++polls < 4 ? { id: 'op1', kind: KIND, status: 'running' } : { id: 'op1', kind: KIND, status: 'succeeded', result: RESULT })
      : ok({ id: 'op1', kind: KIND, status: 'queued' }, 202));
    const h = harness(t);
    expect(await h.run(['backups', 'server-restore', '--site', 's1', '--time', TIME, '--scope', 'db', '--wait', '--timeout', '3600'])).toBe(0);
    expect(polls).toBe(4);
  });
  it('refusals carry hints', async () => {
    const cases: Array<[number, string, string]> = [
      [404, 'not_available', 'not enabled for this account'], [503, 'restore_locked', 'locked for maintenance'], [400, 'backup_not_offered', 'server-list'],
      [400, 'invalid_scope', 'unsupported --scope'], [422, 'backup_in_use', 'backup is running'], [409, 'site_busy', 'wait and read the state'], [429, 'daily_limit', 'try again tomorrow'],
      [422, 'capability_unavailable', 'not available for this site'],
    ];
    for (const [status, code, hint] of cases) {
      const h = harness(vi.fn().mockResolvedValue(err(status, code)));
      expect(await h.run(['backups', 'server-restore', '--site', 's1', '--time', TIME, '--scope', 'db'])).toBeGreaterThan(0);
      expect(h.err.join('')).toContain(code);
      expect(h.err.join('')).toContain(hint);
      expect(h.err.join('')).toContain('idempotency_key=');
      expect(h.err.join('')).not.toContain('tpapi_secret');
    }
  });
  it('error codes of a finished operation carry hints', async () => {
    const cases: Array<[string, string]> = [
      ['server_restore_failed', 'automatically'], ['restore_outcome_unknown', 'check the website'], ['restore_rollback_pending', 'safety backup is being put back'],
      ['restore_rollback_failed', 'contact support'], ['backup_window', 'nightly backup'], ['nested_instance', 'another WordPress installation'], ['docroot_symlink', 'symbolic link'],
      ['database_not_found', 'database'], ['wordpress_instance_not_found', 'WordPress installation'], ['restore_unavailable', 'not set up'], ['not_enabled', 'not enabled for this account'],
      ['precondition_failed', 'preparation'], ['site_changed', 'changed while'],
    ];
    for (const [code, hint] of cases) {
      const h = harness(opTransport({ id: 'op1', kind: KIND, status: 'failed', error_code: code, result: null }));
      expect(await h.run(['backups', 'server-restore', '--site', 's1', '--time', TIME, '--scope', 'db', '--wait'])).toBe(1);
      expect(h.err.join('')).toContain(code);
      expect(h.err.join('')).toContain(hint);
    }
  });
});

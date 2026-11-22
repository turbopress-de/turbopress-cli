import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';

const PKG_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const ok = (data: unknown, status = 200) => json({ data, meta: { request_id: 'r1' } }, status);
const err = (status: number, code: string) => json({ error: { code, message: 'secret tpapi_secret' }, meta: { request_id: 'r9' } }, status);
const API = 'https://panel.turbopress.de/api/v1';
const KEY = 'stable-key-123456';
const P = `1795000000.${'ab12'.repeat(16)}`;
const NEXT = `1795000100.${'cd34'.repeat(16)}`;

function harness(transport: unknown) {
  const out: string[] = [];
  const errs: string[] = [];
  const run = (args: string[]) => runCli(args, { token: 'tpapi_secret', transport: transport as typeof fetch, stdout: s => out.push(s), stderr: s => errs.push(s), sleep: async () => {} });
  return { out, err: errs, run };
}
const calls = (t: ReturnType<typeof vi.fn>) => t.mock.calls.map(c => ({ url: String(c[0]), init: (c[1] ?? {}) as RequestInit, headers: new Headers(((c[1] ?? {}) as RequestInit).headers) }));
const opTransport = (op: unknown) => vi.fn(async (url: RequestInfo | URL) => String(url).endsWith('/operations/op1') ? ok(op) : ok({ id: 'op1', kind: 'sites:repair', status: 'queued' }, 202));
const DIAGNOSIS = {
  finding: { kind: 'plugin', slug: 'broken-forms', name: 'Broken Forms', since: '2026-11-22T09:15:00+01:00', count: 4, certainty: 'certain' },
  proposal: { id: P, action: 'deactivate_plugin', target_theme: null, backup: null },
  lines: ['PHP Fatal error: ...'],
};

describe('contract 0.10', () => {
  it('the new commands hit routes that exist in the pinned OpenAPI file', () => {
    const contract = JSON.parse(readFileSync(new URL('./fixtures/openapi.json', import.meta.url), 'utf8'));
    expect(contract.paths['/sites/{site_id}/diagnosis'].get['x-permission']).toBe('sites:read');
    expect(contract.paths['/sites/{site_id}/repair'].post['x-permission']).toBe('sites:repair');
    expect(Object.keys(contract.components.schemas.RepairRequest.properties)).toEqual(['proposal_id']);
    expect(contract.components.schemas.RepairRequest.additionalProperties).toBe(false);
    expect(contract.components.schemas.RepairProposal.properties.action.enum)
      .toEqual(['rollback_plugin', 'deactivate_plugin', 'switch_theme', 'repair_core', 'memory_hint', 'support', 'none']);
  });
  it('--version prints the package version 0.10.0', async () => {
    const h = harness(vi.fn());
    expect(await h.run(['--version'])).toBe(0);
    expect(h.out.join('').trim()).toBe(PKG_VERSION);
    expect(PKG_VERSION).toBe('0.10.0');
  });
  it('the help lists both commands', async () => {
    const h = harness(vi.fn());
    expect(await h.run(['--help'])).toBe(0);
    expect(h.out.join('')).toContain('turbopress site diagnose --site SITE [--json]');
    expect(h.out.join('')).toContain('turbopress site repair --site SITE --proposal ID [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]');
  });
});

describe('site diagnose', () => {
  it('GETs the diagnosis without an Idempotency-Key and prints it', async () => {
    const t = vi.fn(async () => ok(DIAGNOSIS));
    const h = harness(t);
    expect(await h.run(['site', 'diagnose', '--site', 's1', '--json'])).toBe(0);
    const c = calls(t);
    expect(c).toHaveLength(1);
    expect(c[0]!.url).toBe(`${API}/sites/s1/diagnosis`);
    expect(c[0]!.init.method ?? 'GET').toBe('GET');
    expect(c[0]!.headers.get('idempotency-key')).toBeNull();
    expect(JSON.parse(h.out.join(''))).toEqual(DIAGNOSIS);
  });
  it('refuses foreign flags and a missing site before any request', async () => {
    const t = vi.fn();
    const h = harness(t);
    for (const args of [['site', 'diagnose'], ['site', 'diagnose', '--site', 's1', '--proposal', P], ['site', 'diagnose', '--site', 's1', '--wait'],
      ['site', 'diagnose', '--site', 's1', '--idempotency-key', KEY], ['site', 'check', '--site', 's1'], ['site', 'diagnose', '--site', '../x']]) {
      expect(await h.run(args)).toBe(2);
    }
    expect(t).not.toHaveBeenCalled();
  });
  it('refusals carry hints', async () => {
    for (const [status, code, hint, exit] of [[403, 'repair_not_enabled', 'not available for this account', 3], [502, 'diagnosis_unavailable', 'error log', 1]] as const) {
      const h = harness(vi.fn().mockResolvedValue(err(status, code)));
      expect(await h.run(['site', 'diagnose', '--site', 's1'])).toBe(exit);
      expect(h.err.join('')).toContain(code);
      expect(h.err.join('')).toContain(hint);
      expect(h.err.join('')).not.toContain('tpapi_secret');
    }
  });
});

describe('site repair', () => {
  it('POSTs exactly {"proposal_id"} with the Idempotency-Key', async () => {
    const t = vi.fn(async () => ok({ id: 'op1', kind: 'sites:repair', status: 'queued' }, 202));
    const h = harness(t);
    expect(await h.run(['site', 'repair', '--site', 's1', '--proposal', P, '--idempotency-key', KEY])).toBe(0);
    const c = calls(t);
    expect(c).toHaveLength(1);
    expect([c[0]!.init.method, c[0]!.url, c[0]!.headers.get('idempotency-key')]).toEqual(['POST', `${API}/sites/s1/repair`, KEY]);
    expect(JSON.parse(String(c[0]!.init.body))).toEqual({ proposal_id: P });
  });
  it('generates a key when none is given', async () => {
    const t = vi.fn(async () => ok({ id: 'op1' }, 202));
    const h = harness(t);
    expect(await h.run(['site', 'repair', '--site', 's1', '--proposal', P])).toBe(0);
    expect(calls(t)[0]!.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('refuses a missing or malformed --proposal and foreign flags before any request', async () => {
    const t = vi.fn();
    const h = harness(t);
    for (const args of [['site', 'repair', '--site', 's1'], ['site', 'repair', '--site', 's1', '--proposal', 'abc'], ['site', 'repair', '--site', 's1', '--proposal', `${P}0`],
      ['site', 'repair', '--site', 's1', '--proposal', P.toUpperCase()], ['site', 'repair', '--proposal', P], ['site', 'repair', '--site', 's1', '--proposal', P, '--scope', 'all'],
      ['site', 'repair', '--site', 's1', '--proposal', P, '--timeout', '60'], ['site', 'repair', '--site', 's1', '--proposal', P, '--proposal', NEXT]]) {
      expect(await h.run(args)).toBe(2);
    }
    expect(t).not.toHaveBeenCalled();
  });
  it('--wait: fixed 0, reverted 1 with the next proposal, unverifiable 4, repair_failed 1', async () => {
    const fixed = harness(opTransport({ id: 'op1', kind: 'sites:repair', status: 'succeeded', result: { outcome: 'fixed', next_proposal: null } }));
    expect(await fixed.run(['site', 'repair', '--site', 's1', '--proposal', P, '--wait', '--json'])).toBe(0);
    expect(JSON.parse(fixed.out.join('')).result.outcome).toBe('fixed');

    const next = { id: NEXT, action: 'switch_theme', target_theme: 'twentytwentyfour', backup: null };
    const reverted = harness(opTransport({ id: 'op1', kind: 'sites:repair', status: 'succeeded', result: { outcome: 'reverted', next_proposal: next } }));
    expect(await reverted.run(['site', 'repair', '--site', 's1', '--proposal', P, '--wait', '--json'])).toBe(1);
    expect(JSON.parse(reverted.out.join('')).result.next_proposal).toEqual(next);
    expect(reverted.err.join('')).toContain('did not help and was undone');
    expect(reverted.err.join('')).toContain('operation_id=op1');

    const unverifiable = harness(opTransport({ id: 'op1', kind: 'sites:repair', status: 'succeeded', result: { outcome: 'unverifiable', next_proposal: null } }));
    expect(await unverifiable.run(['site', 'repair', '--site', 's1', '--proposal', P, '--wait'])).toBe(4);
    expect(unverifiable.err.join('')).toContain('could not be checked');

    const failed = harness(opTransport({ id: 'op1', kind: 'sites:repair', status: 'failed', error_code: 'repair_failed', result: null }));
    expect(await failed.run(['site', 'repair', '--site', 's1', '--proposal', P, '--wait'])).toBe(1);
    expect(failed.err.join('')).toContain('site diagnose');
  });
  it('refusals carry hints', async () => {
    for (const [status, code, hint] of [[409, 'diagnosis_changed', 'site diagnose'], [422, 'nothing_to_repair', 'no automatic repair'], [429, 'daily_limit', 'try again tomorrow'],
      [409, 'site_busy', 'wait and read the state']] as const) {
      const h = harness(vi.fn().mockResolvedValue(err(status, code)));
      expect(await h.run(['site', 'repair', '--site', 's1', '--proposal', P])).toBe(1);
      expect(h.err.join('')).toContain(code);
      expect(h.err.join('')).toContain(hint);
      expect(h.err.join('')).toContain('idempotency_key=');
    }
  });
});

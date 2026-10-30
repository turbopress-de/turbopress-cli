import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const ok = (data: unknown, status = 200, meta: Record<string, unknown> = {}) => json({ data, meta: { request_id: 'r1', ...meta } }, status);
const err = (status: number, code: string, headers: Record<string, string> = {}) => json({ error: { code, message: 'secret tpapi_secret whsec_leak' }, meta: { request_id: 'r9' } }, status, headers);
const API = 'https://panel.turbopress.de/api/v1';
const KEY = 'stable-key-123456';
const WH = 'wh_abcdefghijklmnopqrstuvwx';

function harness(transport: unknown) {
  const out: string[] = [];
  const errs: string[] = [];
  const run = (args: string[]) => runCli(args, { token: 'tpapi_secret', transport: transport as typeof fetch, stdout: s => out.push(s), stderr: s => errs.push(s), sleep: async () => {} });
  return { out, err: errs, run };
}
const calls = (t: ReturnType<typeof vi.fn>) => t.mock.calls.map(c => ({ url: String(c[0]), init: c[1] as RequestInit, headers: new Headers((c[1] as RequestInit).headers) }));
const reply = (data: unknown, status = 200) => vi.fn(async () => ok(data, status));
const noContent = () => vi.fn(async () => new Response(null, { status: 204 }));

describe('contract', () => {
  it('every new command hits a route and method that exist in the pinned OpenAPI file', async () => {
    const contract = JSON.parse(readFileSync(new URL('./fixtures/openapi.json', import.meta.url), 'utf8'));
    const cases: Array<[string[], string, string]> = [
      [['clients', 'list'], 'GET', '/clients'],
      [['clients', 'show', '12'], 'GET', '/clients/{client_id}'],
      [['clients', 'create', '--name', 'A'], 'POST', '/clients'],
      [['clients', 'update', '12', '--note', 'x'], 'PATCH', '/clients/{client_id}'],
      [['clients', 'delete', '12', '--confirm', 'A'], 'DELETE', '/clients/{client_id}'],
      [['sites', 'set-client', 's1', '12'], 'PUT', '/sites/{site_id}/client'],
      [['plugins', 'list'], 'GET', '/plugins'],
      [['plugins', 'show', 'akismet'], 'GET', '/plugins/{slug}'],
      [['plugins', 'site', 's1'], 'GET', '/sites/{site_id}/plugins'],
      [['licenses', 'list'], 'GET', '/licenses'],
      [['licenses', 'set', 'elementor-pro', '--paid-by', 'agency'], 'PUT', '/licenses/{slug}'],
      [['work', 'list', '12'], 'GET', '/clients/{client_id}/work-entries'],
      [['work', 'add', '12', '--date', '2026-10-01', '--minutes', '30', '--text', 'x'], 'POST', '/clients/{client_id}/work-entries'],
      [['work', 'rm', '12', '7'], 'DELETE', '/clients/{client_id}/work-entries/{entry_id}'],
      [['reports', 'list', '12'], 'GET', '/clients/{client_id}/reports'],
      [['reports', 'show', '12', '2026-09'], 'GET', '/clients/{client_id}/reports/{period}'],
      [['reports', 'share', '12', '2026-09'], 'POST', '/clients/{client_id}/reports/{period}/share-links'],
      [['reports', 'send', '12', '2026Q3'], 'POST', '/clients/{client_id}/reports/{period}/send'],
      [['webhooks', 'list'], 'GET', '/webhooks'],
      [['webhooks', 'show', WH], 'GET', '/webhooks/{webhook_id}'],
      [['webhooks', 'create', '--url', 'https://example.com/hook', '--events', 'site.down'], 'POST', '/webhooks'],
      [['webhooks', 'update', WH, '--active', 'false'], 'PATCH', '/webhooks/{webhook_id}'],
      [['webhooks', 'delete', WH], 'DELETE', '/webhooks/{webhook_id}'],
      [['webhooks', 'test', WH], 'POST', '/webhooks/{webhook_id}/test'],
      [['webhooks', 'deliveries', WH], 'GET', '/webhooks/{webhook_id}/deliveries'],
      [['webhooks', 'rotate-secret', WH], 'POST', '/webhooks/{webhook_id}/rotate-secret'],
    ];
    for (const [args, method, template] of cases) {
      const t = vi.fn(async () => method === 'DELETE' && !args.includes('--confirm') ? new Response(null, { status: 204 }) : ok({}));
      expect(await harness(t).run(args), args.join(' ')).toBe(0);
      const [c] = calls(t);
      expect(c!.init.method).toBe(method);
      const url = c!.url.slice(API.length).split('?')[0]!;
      const pattern = new RegExp('^' + template.replace(/\{[a-z_]+\}/g, '[^/]+') + '$');
      expect(url).toMatch(pattern);
      expect(contract.paths[template]?.[method.toLowerCase()], `${method} ${template}`).toBeDefined();
      // Every write carries an Idempotency-Key, including PATCH and PUT.
      if (method !== 'GET') expect(c!.headers.get('idempotency-key')).toMatch(/^[\x20-\x7e]{16,128}$/);
      else expect(c!.headers.get('idempotency-key')).toBeNull();
    }
  });
});

describe('clients', () => {
  it('lists with paging and prints data and meta', async () => {
    const t = vi.fn(async () => ok([{ id: '12', name: 'A' }], 200, { next_cursor: 'c2' }));
    const h = harness(t);
    expect(await h.run(['clients', 'list', '--limit', '5', '--cursor', 'c1', '--json'])).toBe(0);
    expect(calls(t)[0]!.url).toBe(`${API}/clients?limit=5&cursor=c1`);
    expect(JSON.parse(h.out.join('')).meta.next_cursor).toBe('c2');
    expect(await h.run(['clients', 'list', '--limit', '101'])).toBe(2);
  });
  it('shows one client and rejects a bad ID before any request', async () => {
    const t = reply({ id: '12' });
    const h = harness(t);
    expect(await h.run(['clients', 'show', '12'])).toBe(0);
    expect(calls(t)[0]!.url).toBe(`${API}/clients/12`);
    for (const bad of ['0', 'abc', '12/../3', '01']) expect(await h.run(['clients', 'show', bad])).toBe(2);
    expect(await h.run(['clients', 'show'])).toBe(2);
    expect(t).toHaveBeenCalledTimes(1);
  });
  it('creates a client with typed fields and a supplied key', async () => {
    const t = reply({ id: '13' }, 201);
    expect(await harness(t).run(['clients', 'create', '--name', 'Elbtal Rösterei', '--email', 'a@b.de', '--maintenance-contract', 'true', '--send-report', 'false', '--quota-minutes', '120', '--price-month-cent', 'none', '--idempotency-key', KEY])).toBe(0);
    const [c] = calls(t);
    expect(c!.headers.get('idempotency-key')).toBe(KEY);
    expect(JSON.parse(String(c!.init.body))).toEqual({ name: 'Elbtal Rösterei', email: 'a@b.de', maintenance_contract: true, send_report: false, quota_minutes: 120, price_month_cent: null });
  });
  it('validates create and update input locally', async () => {
    const t = reply({});
    const h = harness(t);
    for (const args of [
      ['clients', 'create'], ['clients', 'create', '--name', 'x'.repeat(61)], ['clients', 'create', '--name', 'A', '--send-report', 'yes'],
      ['clients', 'create', '--name', 'A', '--quota-minutes', '70000'], ['clients', 'create', '--name', 'A', '--site', 's1'],
      ['clients', 'update', '12'], ['clients', 'update', 'x', '--note', 'n'], ['clients', 'update', '12', '--note', 'n'.repeat(281)],
    ]) expect(await h.run(args), args.join(' ')).toBe(2);
    expect(t).not.toHaveBeenCalled();
  });
  it('updates with PATCH and may clear a field with an empty value', async () => {
    const t = reply({ id: '12' });
    expect(await harness(t).run(['clients', 'update', '12', '--note', '', '--quota-minutes', 'none'])).toBe(0);
    const [c] = calls(t);
    expect(c!.init.method).toBe('PATCH');
    expect(JSON.parse(String(c!.init.body))).toEqual({ note: '', quota_minutes: null });
  });
  it('deletes only with the exact name in --confirm', async () => {
    const t = reply({ id: '12', deleted: true });
    const h = harness(t);
    expect(await h.run(['clients', 'delete', '12'])).toBe(2);
    expect(await h.run(['clients', 'delete', '12', '--confirm', ''])).toBe(2);
    expect(t).not.toHaveBeenCalled();
    expect(await h.run(['clients', 'delete', '12', '--confirm', ' Müller  & Söhne '])).toBe(0);
    const [c] = calls(t);
    expect(c!.init.method).toBe('DELETE');
    expect(JSON.parse(String(c!.init.body))).toEqual({ confirm: ' Müller  & Söhne ' });
    expect(JSON.parse(h.out.join('')).deleted).toBe(true);
  });
  it('maps confirmation_mismatch to a hint and exits 1 with the key', async () => {
    const h = harness(vi.fn(async () => err(422, 'confirmation_mismatch')));
    expect(await h.run(['clients', 'delete', '12', '--confirm', 'A', '--idempotency-key', KEY])).toBe(1);
    const text = h.err.join('');
    expect(text).toContain('confirmation_mismatch');
    expect(text).toContain('exact client name');
    expect(text).toContain(`idempotency_key=${KEY}`);
    expect(text).not.toContain('whsec_leak');
  });
});

describe('sites', () => {
  it('filters sites by client', async () => {
    const t = reply([]);
    const h = harness(t);
    expect(await h.run(['sites', 'list', '--client', '12', '--limit', '10'])).toBe(0);
    expect(calls(t)[0]!.url).toBe(`${API}/sites?limit=10&client_id=12`);
    expect(await h.run(['sites', 'list', '--client', 'none'])).toBe(0);
    expect(calls(t)[1]!.url).toBe(`${API}/sites?client_id=none`);
    for (const bad of ['0', 'all', '1;2']) expect(await h.run(['sites', 'list', '--client', bad])).toBe(2);
    expect(await h.run(['sites', 'show', '--site', 's1', '--client', '12'])).toBe(2);
  });
  it('assigns and unassigns a site with PUT and a key', async () => {
    const t = reply({ site_id: 's1', client: null, changed: true });
    const h = harness(t);
    expect(await h.run(['sites', 'set-client', 's1', '12'])).toBe(0);
    expect(await h.run(['sites', 'set-client', 's1', 'none', '--idempotency-key', KEY])).toBe(0);
    const [a, b] = calls(t);
    expect(a!.url).toBe(`${API}/sites/s1/client`);
    expect(a!.init.method).toBe('PUT');
    expect(JSON.parse(String(a!.init.body))).toEqual({ client_id: '12' });
    expect(JSON.parse(String(b!.init.body))).toEqual({ client_id: null });
    expect(b!.headers.get('idempotency-key')).toBe(KEY);
    expect(await h.run(['sites', 'set-client', 's1'])).toBe(2);
    expect(await h.run(['sites', 'set-client', 's1', 'abc'])).toBe(2);
    expect(await h.run(['sites', 'set-client', 'a/b', '12'])).toBe(2);
  });
});

describe('plugins and licenses', () => {
  it('lists plugins with filters', async () => {
    const t = reply([]);
    const h = harness(t);
    expect(await h.run(['plugins', 'list', '--state', 'vulnerable', '--premium', '--limit', '20'])).toBe(0);
    expect(calls(t)[0]!.url).toBe(`${API}/plugins?state=vulnerable&premium=1&limit=20`);
    expect(await h.run(['plugins', 'list', '--state', 'broken'])).toBe(2);
    expect(await h.run(['plugins', 'show', 'akismet', '--premium'])).toBe(2);
  });
  it('shows a plugin and the plugins of a site, and still routes enable/disable', async () => {
    const t = reply({});
    const h = harness(t);
    expect(await h.run(['plugins', 'show', 'woocommerce-payments'])).toBe(0);
    expect(await h.run(['plugins', 'site', 's1'])).toBe(0);
    expect(calls(t).map(c => c.url)).toEqual([`${API}/plugins/woocommerce-payments`, `${API}/sites/s1/plugins`]);
    expect(await h.run(['plugins', 'show', '../x'])).toBe(2);
    expect(await h.run(['plugins', 'show', 'Bad Slug'])).toBe(2);
    const enable = vi.fn(async () => ok({ operation_id: 'op1' }, 202));
    expect(await harness(enable).run(['plugins', 'enable', '--site', 's1', '--plugin', 'akismet'])).toBe(0);
    expect(calls(enable)[0]!.url).toBe(`${API}/sites/s1/plugins/akismet/state`);
  });
  it('lists licenses and sets one with PUT', async () => {
    const t = reply({});
    const h = harness(t);
    expect(await h.run(['licenses', 'list'])).toBe(0);
    expect(await h.run(['licenses', 'set', 'Elementor-Pro', '--paid-by', 'client', '--kind', 'Annual', '--expires', '2027-03-01'])).toBe(0);
    const [, put] = calls(t);
    expect(put!.url).toBe(`${API}/licenses/Elementor-Pro`);
    expect(put!.init.method).toBe('PUT');
    expect(JSON.parse(String(put!.init.body))).toEqual({ paid_by: 'client', kind: 'Annual', expires_at: '2027-03-01' });
    expect(put!.headers.get('idempotency-key')).toBeTruthy();
  });
  it('licenses set can clear the expiry and handles 204', async () => {
    const t = noContent();
    const h = harness(t);
    expect(await h.run(['licenses', 'set', 'x-plugin', '--paid-by', 'agency', '--expires', 'none'])).toBe(0);
    expect(JSON.parse(String(calls(t)[0]!.init.body))).toEqual({ paid_by: 'agency', expires_at: null });
    expect(JSON.parse(h.out.join(''))).toEqual({ ok: true });
  });
  it('validates licenses set input', async () => {
    const t = reply({});
    const h = harness(t);
    for (const args of [
      ['licenses', 'set', 'x'], ['licenses', 'set', 'x', '--paid-by', 'me'], ['licenses', 'set', 'x', '--paid-by', 'agency', '--expires', '2026-02-30'],
      ['licenses', 'set', 'x', '--paid-by', 'agency', '--expires', '1999-12-31'], ['licenses', 'set', 'x..y', '--paid-by', 'agency'],
    ]) expect(await h.run(args), args.join(' ')).toBe(2);
    expect(t).not.toHaveBeenCalled();
  });
});

describe('work log', () => {
  it('lists a month with paging', async () => {
    const t = reply([]);
    const h = harness(t);
    expect(await h.run(['work', 'list', '12', '--month', '2026-09', '--limit', '10'])).toBe(0);
    expect(calls(t)[0]!.url).toBe(`${API}/clients/12/work-entries?month=2026-09&limit=10`);
    expect(await h.run(['work', 'list', '12', '--month', '2026-13'])).toBe(2);
    expect(await h.run(['work', 'list'])).toBe(2);
  });
  it('adds an entry with all fields', async () => {
    const t = reply({ id: '7' }, 201);
    expect(await harness(t).run(['work', 'add', '12', '--date', '2026-10-02', '--minutes', '45', '--text', 'Plugin-Updates', '--site', 's1', '--external-id', 'ticket-9', '--idempotency-key', KEY])).toBe(0);
    const [c] = calls(t);
    expect(c!.headers.get('idempotency-key')).toBe(KEY);
    expect(JSON.parse(String(c!.init.body))).toEqual({ date: '2026-10-02', minutes: 45, text: 'Plugin-Updates', site_id: 's1', external_id: 'ticket-9' });
  });
  it('validates work add locally', async () => {
    const t = reply({});
    const h = harness(t);
    const ok = ['work', 'add', '12', '--date', '2026-10-02', '--minutes', '45', '--text', 'x'];
    const swap = (flag: string, value: string) => ok.map((a, i) => ok[i - 1] === flag ? value : a);
    for (const args of [
      swap('--minutes', '4'), swap('--minutes', '1441'), swap('--minutes', '1.5'), swap('--date', '2026-02-30'), swap('--date', '02.10.2026'), swap('--text', 'x'.repeat(281)),
      ok.slice(0, 5).concat(ok.slice(7)), [...ok, '--external-id', 'has space'], ok.filter((_, i) => i < 7),
    ]) expect(await h.run(args), args.join(' ')).toBe(2);
    expect(t).not.toHaveBeenCalled();
  });
  it('removes an entry (204) and prints a result', async () => {
    const t = noContent();
    const h = harness(t);
    expect(await h.run(['work', 'rm', '12', '7'])).toBe(0);
    expect(calls(t)[0]!.url).toBe(`${API}/clients/12/work-entries/7`);
    expect(calls(t)[0]!.init.body).toBeUndefined();
    expect(JSON.parse(h.out.join(''))).toEqual({ deleted: true });
    expect(await h.run(['work', 'rm', '12', 'x'])).toBe(2);
    expect(await h.run(['work', 'rm', '12'])).toBe(2);
  });
  it('reports duplicate_entry with a hint', async () => {
    const h = harness(vi.fn(async () => err(409, 'duplicate_entry')));
    expect(await h.run(['work', 'add', '12', '--date', '2026-10-02', '--minutes', '45', '--text', 'x', '--external-id', 'e1'])).toBe(1);
    expect(h.err.join('')).toContain('external-id');
  });
});

describe('reports', () => {
  it('lists and shows reports, month and quarter', async () => {
    const t = reply({});
    const h = harness(t);
    expect(await h.run(['reports', 'list', '12'])).toBe(0);
    expect(await h.run(['reports', 'show', '12', '2026-09'])).toBe(0);
    expect(await h.run(['reports', 'show', '12', '2026Q3'])).toBe(0);
    expect(calls(t).map(c => c.url)).toEqual([`${API}/clients/12/reports`, `${API}/clients/12/reports/2026-09`, `${API}/clients/12/reports/2026Q3`]);
    for (const bad of ['2026-13', '2026Q5', '2026', '../x']) expect(await h.run(['reports', 'show', '12', bad])).toBe(2);
    expect(await h.run(['reports', 'show', '12'])).toBe(2);
  });
  it('share prints the URL once on stdout with a warning on stderr and nowhere else', async () => {
    const url = 'https://panel.turbopress.de/r/SECRETTOKEN123';
    const t = reply({ id: '5', url, expires_at: '2027-01-01T00:00:00Z' }, 201);
    const h = harness(t);
    expect(await h.run(['reports', 'share', '12', '2026-09', '--json'])).toBe(0);
    expect(JSON.parse(h.out.join('')).url).toBe(url);
    expect(h.err.join('')).toContain('shown only once');
    expect(h.err.join('')).not.toContain('SECRETTOKEN123');
    const c = calls(t)[0]!;
    expect(c.init.method).toBe('POST');
    expect(c.headers.get('idempotency-key')).toBeTruthy();
    expect(JSON.parse(String(c.init.body))).toEqual({});
  });
  it('share errors never print a secret and carry a hint', async () => {
    for (const [status, code, text] of [[409, 'secret_not_replayable', 'new --idempotency-key'], [409, 'too_many_links', '20 valid'], [404, 'report_not_found', 'reports list']] as const) {
      const h = harness(vi.fn(async () => err(status, code)));
      expect(await h.run(['reports', 'share', '12', '2026-09', '--idempotency-key', KEY])).toBe(1);
      expect(h.err.join('')).toContain(code);
      expect(h.err.join('')).toContain(text);
      expect(h.err.join('') + h.out.join('')).not.toContain('whsec_leak');
    }
  });
  it('send posts {} or {resend:true}', async () => {
    const t = reply({ period: '2026-09', sent_at: 'x', email: 'a@b.de' });
    const h = harness(t);
    expect(await h.run(['reports', 'send', '12', '2026-09'])).toBe(0);
    expect(await h.run(['reports', 'send', '12', '2026-09', '--resend', '--idempotency-key', KEY])).toBe(0);
    const [a, b] = calls(t);
    expect(JSON.parse(String(a!.init.body))).toEqual({});
    expect(JSON.parse(String(b!.init.body))).toEqual({ resend: true });
    expect(b!.headers.get('idempotency-key')).toBe(KEY);
    expect(await h.run(['reports', 'show', '12', '2026-09', '--resend'])).toBe(2);
  });
  it('send maps already_sent and resend_limit and does not retry a 429 resend_limit', async () => {
    const h = harness(vi.fn(async () => err(409, 'already_sent')));
    expect(await h.run(['reports', 'send', '12', '2026-09'])).toBe(1);
    expect(h.err.join('')).toContain('--resend');
    const t = vi.fn(async () => err(429, 'resend_limit', { 'retry-after': '300' }));
    const hl = harness(t);
    expect(await hl.run(['reports', 'send', '12', '2026-09', '--resend'])).toBe(1);
    expect(t).toHaveBeenCalledTimes(1);
    expect(hl.err.join('')).toContain('resend_limit');
    expect(hl.err.join('')).toContain('5 minutes');
  });
});

describe('webhooks', () => {
  it('creates with url and events, prints the secret on stdout once and warns on stderr', async () => {
    const t = reply({ id: WH, url: 'https://example.com/hook', events: ['site.down', 'site.up'], secret: 'whsec_' + 'ab'.repeat(32) }, 201);
    const h = harness(t);
    expect(await h.run(['webhooks', 'create', '--url', 'https://example.com/hook', '--events', 'site.down,site.up', '--json'])).toBe(0);
    const c = calls(t)[0]!;
    expect(c.headers.get('idempotency-key')).toBeTruthy();
    expect(JSON.parse(String(c.init.body))).toEqual({ url: 'https://example.com/hook', events: ['site.down', 'site.up'] });
    expect(JSON.parse(h.out.join('')).secret).toMatch(/^whsec_/);
    expect(h.err.join('')).toContain('shown only once');
    expect(h.err.join('')).not.toContain('whsec_');
  });
  it('validates create and update input', async () => {
    const t = reply({});
    const h = harness(t);
    for (const args of [
      ['webhooks', 'create', '--events', 'site.down'], ['webhooks', 'create', '--url', 'https://a.de/x'],
      ['webhooks', 'create', '--url', 'http://a.de/x', '--events', 'site.down'], ['webhooks', 'create', '--url', 'https://a.de/x', '--events', 'site.down,bogus'],
      ['webhooks', 'create', '--url', 'https://a.de/x', '--events', 'site.down,site.down'],
      ['webhooks', 'update', WH], ['webhooks', 'update', WH, '--active', 'maybe'], ['webhooks', 'update', 'wh_short', '--active', 'true'],
      ['webhooks', 'show', 'nope'], ['webhooks', 'delete', WH.toUpperCase()],
    ]) expect(await h.run(args), args.join(' ')).toBe(2);
    expect(t).not.toHaveBeenCalled();
  });
  it('updates with PATCH', async () => {
    const t = reply({ id: WH });
    expect(await harness(t).run(['webhooks', 'update', WH, '--url', 'https://a.de/y', '--events', 'report.sent', '--active', 'true'])).toBe(0);
    const c = calls(t)[0]!;
    expect(c.init.method).toBe('PATCH');
    expect(c.headers.get('idempotency-key')).toBeTruthy();
    expect(JSON.parse(String(c.init.body))).toEqual({ url: 'https://a.de/y', events: ['report.sent'], active: true });
  });
  it('lists, shows, tests and reads deliveries', async () => {
    const t = reply({});
    const h = harness(t);
    expect(await h.run(['webhooks', 'list'])).toBe(0);
    expect(await h.run(['webhooks', 'show', WH])).toBe(0);
    expect(await h.run(['webhooks', 'test', WH])).toBe(0);
    expect(await h.run(['webhooks', 'deliveries', WH])).toBe(0);
    expect(calls(t).map(c => `${c.init.method} ${c.url.slice(API.length)}`)).toEqual(['GET /webhooks', `GET /webhooks/${WH}`, `POST /webhooks/${WH}/test`, `GET /webhooks/${WH}/deliveries`]);
    expect(JSON.parse(String(calls(t)[2]!.init.body))).toEqual({});
  });
  it('deletes (204)', async () => {
    const t = noContent();
    const h = harness(t);
    expect(await h.run(['webhooks', 'delete', WH])).toBe(0);
    expect(calls(t)[0]!.init.method).toBe('DELETE');
    expect(calls(t)[0]!.headers.get('idempotency-key')).toBeTruthy();
    expect(JSON.parse(h.out.join(''))).toEqual({ deleted: true });
  });
  it('rotate-secret prints the new secret once with a warning', async () => {
    const t = reply({ id: WH, secret: 'whsec_' + 'cd'.repeat(32) });
    const h = harness(t);
    expect(await h.run(['webhooks', 'rotate-secret', WH])).toBe(0);
    expect(h.out.join('')).toContain('whsec_');
    expect(h.err.join('')).toContain('shown only once');
    expect(h.err.join('')).not.toContain('whsec_');
  });
  it('maps webhook and feature errors to hints', async () => {
    for (const [status, code, text] of [
      [503, 'feature_unavailable', 'switched off'], [403, 'feature_not_enabled', 'not enabled'], [409, 'secret_not_replayable', 'rotate-secret'],
      [400, 'invalid_webhook_url', 'https only'], [409, 'webhook_limit', '10 webhooks'], [409, 'webhook_inactive', '--active true'],
    ] as const) {
      const h = harness(vi.fn(async () => err(status, code)));
      const exit = await h.run(['webhooks', 'create', '--url', 'https://a.de/x', '--events', 'site.down', '--idempotency-key', KEY]);
      expect(exit).toBe(status === 403 ? 3 : 1);
      expect(h.err.join('')).toContain(text);
      expect(h.err.join('')).toContain(`idempotency_key=${KEY}`);
      expect(h.err.join('') + h.out.join('')).not.toContain('whsec_leak');
    }
  });
});

describe('token and general rules', () => {
  it('token output includes the scope', async () => {
    const h = harness(reply({ id: 1, name: 't', permissions: ['clients:read'], scope: { type: 'client', client_id: '12' }, targets: [] }));
    expect(await h.run(['token', '--json'])).toBe(0);
    expect(JSON.parse(h.out.join('')).scope).toEqual({ type: 'client', client_id: '12' });
  });
  it('rejects --idempotency-key on reads, unknown options and wrong word counts without any request', async () => {
    const t = reply({});
    const h = harness(t);
    for (const args of [
      ['clients', 'list', '--idempotency-key', KEY], ['webhooks', 'list', '--wait'], ['clients', 'frobnicate'], ['clients', 'list', 'extra'],
      ['work', 'add'], ['reports', 'share', '12'], ['sites', 'set-client'], ['webhooks', 'create', '--url', 'https://a.de', '--events', 'site.down', '--confirm', 'x'],
      ['clients', 'list', '--limit', '5', '--limit', '6'],
    ]) expect(await h.run(args), args.join(' ')).toBe(2);
    expect(t).not.toHaveBeenCalled();
  });
  it('requires a token', async () => {
    const out: string[] = [];
    expect(await runCli(['clients', 'list'], { token: '', stdout: s => out.push(s), stderr: () => {} })).toBe(3);
  });
  it('retries a write only on the safe codes and keeps the same key (PATCH)', async () => {
    let n = 0;
    const t = vi.fn(async () => n++ === 0 ? err(429, 'rate_limited', { 'retry-after': '1' }) : ok({ id: '12' }));
    const h = harness(t);
    expect(await h.run(['clients', 'update', '12', '--note', 'x', '--idempotency-key', KEY])).toBe(0);
    expect(calls(t).map(c => c.headers.get('idempotency-key'))).toEqual([KEY, KEY]);
  });
  it('lists the new commands in --help and keeps the brand lowercase', async () => {
    const h = harness(vi.fn());
    expect(await h.run(['--help'])).toBe(0);
    const text = h.out.join('');
    for (const word of ['clients create', 'sites set-client', 'plugins site', 'licenses set', 'work add', 'reports share', 'webhooks rotate-secret']) expect(text).toContain(word);
    expect(text).not.toMatch(/Turbopress/);
  });
});

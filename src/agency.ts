import { ApiError } from './errors.js';

type Options = Record<string, string | boolean | string[]>;

// One request of an agency command (clients, plugins, licenses, work log, reports, webhooks).
export interface AgencyRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  // Every write sends an Idempotency-Key (also PATCH and PUT).
  mutation: boolean;
  // Options this command accepts besides --json and --idempotency-key.
  flags: string[];
  // List with meta.next_cursor: print { data, meta }.
  paged?: boolean;
  // Printed when the API answers 204 No Content.
  empty?: unknown;
  // Written to stderr after success (never contains the secret itself).
  notice?: string;
}

export const WEBHOOK_EVENTS = ['operation.succeeded', 'operation.failed', 'site.down', 'site.up', 'plugin.vulnerability_found', 'license.expiring', 'report.sent', 'report.failed'];
const PLUGIN_STATES = ['vulnerable', 'update', 'ok', 'inactive'];
const PAGE_FLAGS = ['limit', 'cursor'];

function text(options: Options, name: string): string {
  const value = options[name];
  if (typeof value !== 'string' || !value) throw new ApiError(`--${name} is required`, 2);
  return value;
}

// Optional value; the empty string is allowed where the API treats it as "clear".
function optional(options: Options, name: string): string | undefined {
  const value = options[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ApiError(`Invalid --${name}`, 2);
  return value;
}

function clientId(value: string | undefined): string {
  if (value === undefined || !/^[1-9][0-9]{0,9}$/.test(value)) throw new ApiError('Invalid client ID', 2);
  return value;
}

function siteId(value: string | undefined): string {
  if (value === undefined || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new ApiError('Invalid identifier', 2);
  return encodeURIComponent(value);
}

function entryId(value: string | undefined): string {
  if (value === undefined || !/^[1-9][0-9]{0,9}$/.test(value)) throw new ApiError('Invalid entry ID', 2);
  return value;
}

function period(value: string | undefined): string {
  if (value === undefined || !/^(20[0-9]{2}-(0[1-9]|1[0-2])|20[0-9]{2}Q[1-4])$/.test(value)) throw new ApiError('Invalid period (use YYYY-MM or YYYYQn)', 2);
  return value;
}

function webhookId(value: string | undefined): string {
  if (value === undefined || !/^wh_[a-z0-9]{24}$/.test(value)) throw new ApiError('Invalid webhook ID', 2);
  return value;
}

function slug(value: string | undefined, upper: boolean): string {
  const pattern = upper ? /^[A-Za-z0-9][A-Za-z0-9_.-]{0,61}$/ : /^[a-z0-9][a-z0-9_.-]{0,61}$/;
  if (value === undefined || !pattern.test(value) || value.includes('..')) throw new ApiError('Invalid plugin slug', 2);
  return encodeURIComponent(value);
}

function bool(options: Options, name: string): boolean | undefined {
  const value = optional(options, name);
  if (value === undefined) return undefined;
  if (value !== 'true' && value !== 'false') throw new ApiError(`--${name} must be true or false`, 2);
  return value === 'true';
}

function number(options: Options, name: string, min: number, max: number): number | null | undefined {
  const value = optional(options, name);
  if (value === undefined) return undefined;
  if (value === 'none') return null;
  if (!/^\d{1,10}$/.test(value) || Number(value) < min || Number(value) > max) throw new ApiError(`Invalid --${name}`, 2);
  return Number(value);
}

function date(value: string, name: string, min: string, max: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const real = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : undefined;
  if (!match || !real || real.toISOString().slice(0, 10) !== value || value < min || value > max) throw new ApiError(`Invalid --${name} (use YYYY-MM-DD)`, 2);
  return value;
}

function query(options: Options, extra: Record<string, string | undefined> = {}, paged = false): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) params.set(k, v);
  if (paged) {
    if (options.limit !== undefined) {
      const limit = optional(options, 'limit') ?? '';
      if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) throw new ApiError('Invalid --limit', 2);
      params.set('limit', limit);
    }
    if (options.cursor !== undefined) params.set('cursor', text(options, 'cursor'));
  }
  return params.size ? `?${params}` : '';
}

function clientFields(options: Options, create: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const name = optional(options, 'name');
  if (create || name !== undefined) {
    if (!name || name.length > 60) throw new ApiError('--name is required (1 to 60 characters)', 2);
    body.name = name;
  }
  const limited = (flag: string, key: string, max: number) => {
    const value = optional(options, flag);
    if (value === undefined) return;
    if (value.length > max) throw new ApiError(`--${flag} is too long (maximum ${max} characters)`, 2);
    body[key] = value;
  };
  limited('contact-name', 'contact_name', 80);
  limited('email', 'email', 255);
  limited('note', 'note', 280);
  const contract = bool(options, 'maintenance-contract');
  if (contract !== undefined) body.maintenance_contract = contract;
  const report = bool(options, 'send-report');
  if (report !== undefined) body.send_report = report;
  const quota = number(options, 'quota-minutes', 0, 65535);
  if (quota !== undefined) body.quota_minutes = quota;
  const price = number(options, 'price-month-cent', 0, 100_000_000);
  if (price !== undefined) body.price_month_cent = price;
  if (!create && Object.keys(body).length === 0) throw new ApiError('Give at least one field to change', 2);
  return body;
}

const CLIENT_FIELD_FLAGS = ['name', 'contact-name', 'email', 'note', 'maintenance-contract', 'send-report', 'quota-minutes', 'price-month-cent'];

function eventList(options: Options, required: boolean): string[] | undefined {
  const value = optional(options, 'events');
  if (value === undefined) {
    if (required) throw new ApiError('--events is required', 2);
    return undefined;
  }
  const events = value.split(',');
  if (events.length > 8 || new Set(events).size !== events.length || !events.every(event => WEBHOOK_EVENTS.includes(event))) {
    throw new ApiError(`Invalid --events (comma-separated, from: ${WEBHOOK_EVENTS.join(', ')})`, 2);
  }
  return events;
}

function webhookUrl(options: Options, required: boolean): string | undefined {
  const value = optional(options, 'url');
  if (value === undefined) {
    if (required) throw new ApiError('--url is required', 2);
    return undefined;
  }
  if (!value || value.length > 2048 || !/^https:\/\/[^\s]+$/.test(value)) throw new ApiError('Invalid --url (https:// URL, at most 2048 characters)', 2);
  return value;
}

const SECRET_NOTICE = 'The secret above is shown only once and cannot be read again. Store it now in your secret store; if you lose it, run: turbopress webhooks rotate-secret ID';

// Returns undefined when the words are not an agency command (the caller then tries the older commands).
export function agencyRoute(words: string[], options: Options): AgencyRoute | undefined {
  const [group, action] = words;
  const arity = (n: number) => { if (words.length !== n) throw new ApiError('Invalid command', 2); };
  switch (`${group} ${action}`) {
    case 'clients list': arity(2); return { method: 'GET', path: `/clients${query(options, {}, true)}`, mutation: false, flags: PAGE_FLAGS, paged: true };
    case 'clients show': arity(3); return { method: 'GET', path: `/clients/${clientId(words[2])}`, mutation: false, flags: [] };
    case 'clients create': arity(2); return { method: 'POST', path: '/clients', body: clientFields(options, true), mutation: true, flags: CLIENT_FIELD_FLAGS };
    case 'clients update': arity(3); return { method: 'PATCH', path: `/clients/${clientId(words[2])}`, body: clientFields(options, false), mutation: true, flags: CLIENT_FIELD_FLAGS };
    case 'clients delete': {
      arity(3);
      const confirm = optional(options, 'confirm');
      if (!confirm) throw new ApiError('--confirm is required: the exact customer name as shown by clients show', 2);
      if (confirm.length > 200) throw new ApiError('Invalid --confirm', 2);
      return { method: 'DELETE', path: `/clients/${clientId(words[2])}`, body: { confirm }, mutation: true, flags: ['confirm'] };
    }
    case 'sites set-client': {
      arity(4);
      const target = words[3];
      return { method: 'PUT', path: `/sites/${siteId(words[2])}/client`, body: { client_id: target === 'none' ? null : clientId(target) }, mutation: true, flags: [] };
    }
    case 'plugins list': {
      arity(2);
      const state = optional(options, 'state');
      if (state !== undefined && !PLUGIN_STATES.includes(state)) throw new ApiError(`Invalid --state (${PLUGIN_STATES.join(', ')})`, 2);
      return { method: 'GET', path: `/plugins${query(options, { state, premium: options.premium ? '1' : undefined }, true)}`, mutation: false, flags: [...PAGE_FLAGS, 'state', 'premium'], paged: true };
    }
    case 'plugins show': arity(3); return { method: 'GET', path: `/plugins/${slug(words[2], false)}`, mutation: false, flags: [] };
    case 'plugins site': arity(3); return { method: 'GET', path: `/sites/${siteId(words[2])}/plugins`, mutation: false, flags: [] };
    case 'licenses list': arity(2); return { method: 'GET', path: `/licenses${query(options, {}, true)}`, mutation: false, flags: PAGE_FLAGS, paged: true };
    case 'licenses set': {
      arity(3);
      const paidBy = text(options, 'paid-by');
      if (paidBy !== 'agency' && paidBy !== 'client') throw new ApiError('--paid-by must be agency or client', 2);
      const body: Record<string, unknown> = { paid_by: paidBy };
      const kind = optional(options, 'kind');
      if (kind !== undefined) {
        if (kind.length > 80) throw new ApiError('--kind is too long (maximum 80 characters)', 2);
        body.kind = kind;
      }
      const expires = optional(options, 'expires');
      if (expires !== undefined) body.expires_at = expires === 'none' ? null : date(expires, 'expires', '2000-01-01', '2099-12-31');
      return { method: 'PUT', path: `/licenses/${slug(words[2], true)}`, body, mutation: true, flags: ['paid-by', 'kind', 'expires'], empty: { ok: true } };
    }
    case 'work list': {
      arity(3);
      const month = optional(options, 'month');
      if (month !== undefined && !/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError('Invalid --month (use YYYY-MM)', 2);
      return { method: 'GET', path: `/clients/${clientId(words[2])}/work-entries${query(options, { month }, true)}`, mutation: false, flags: [...PAGE_FLAGS, 'month'], paged: true };
    }
    case 'work add': {
      arity(3);
      const day = date(text(options, 'date'), 'date', '2000-01-01', '2099-12-31');
      const minutes = number(options, 'minutes', 5, 1440);
      if (minutes === undefined || minutes === null) throw new ApiError('--minutes is required (5 to 1440)', 2);
      const note = text(options, 'text');
      if (note.length > 280) throw new ApiError('--text is too long (maximum 280 characters)', 2);
      const body: Record<string, unknown> = { date: day, minutes, text: note };
      if (options.site !== undefined) body.site_id = text(options, 'site');
      const external = optional(options, 'external-id');
      if (external !== undefined) {
        if (!/^[\x21-\x7e]{1,100}$/.test(external)) throw new ApiError('Invalid --external-id (1 to 100 printable ASCII characters, no spaces)', 2);
        body.external_id = external;
      }
      return { method: 'POST', path: `/clients/${clientId(words[2])}/work-entries`, body, mutation: true, flags: ['date', 'minutes', 'text', 'site', 'external-id'] };
    }
    case 'work rm': arity(4); return { method: 'DELETE', path: `/clients/${clientId(words[2])}/work-entries/${entryId(words[3])}`, mutation: true, flags: [], empty: { deleted: true } };
    case 'reports list': arity(3); return { method: 'GET', path: `/clients/${clientId(words[2])}/reports`, mutation: false, flags: [] };
    case 'reports show': arity(4); return { method: 'GET', path: `/clients/${clientId(words[2])}/reports/${period(words[3])}`, mutation: false, flags: [] };
    case 'reports share':
      arity(4);
      return { method: 'POST', path: `/clients/${clientId(words[2])}/reports/${period(words[3])}/share-links`, body: {}, mutation: true, flags: [],
        notice: 'The URL above is a secret and is shown only once (valid 90 days). Anyone with the URL can read the report. Repeating this request with the same idempotency key does not return it again.' };
    case 'reports send':
      arity(4);
      return { method: 'POST', path: `/clients/${clientId(words[2])}/reports/${period(words[3])}/send`, body: options.resend ? { resend: true } : {}, mutation: true, flags: ['resend'] };
    case 'webhooks list': arity(2); return { method: 'GET', path: '/webhooks', mutation: false, flags: [] };
    case 'webhooks show': arity(3); return { method: 'GET', path: `/webhooks/${webhookId(words[2])}`, mutation: false, flags: [] };
    case 'webhooks create':
      arity(2);
      return { method: 'POST', path: '/webhooks', body: { url: webhookUrl(options, true), events: eventList(options, true) }, mutation: true, flags: ['url', 'events'], notice: SECRET_NOTICE };
    case 'webhooks update': {
      arity(3);
      const body: Record<string, unknown> = {};
      const url = webhookUrl(options, false);
      if (url !== undefined) body.url = url;
      const events = eventList(options, false);
      if (events !== undefined) body.events = events;
      const active = bool(options, 'active');
      if (active !== undefined) body.active = active;
      if (Object.keys(body).length === 0) throw new ApiError('Give at least one of --url, --events and --active', 2);
      return { method: 'PATCH', path: `/webhooks/${webhookId(words[2])}`, body, mutation: true, flags: ['url', 'events', 'active'] };
    }
    case 'webhooks delete': arity(3); return { method: 'DELETE', path: `/webhooks/${webhookId(words[2])}`, mutation: true, flags: [], empty: { deleted: true } };
    case 'webhooks test': arity(3); return { method: 'POST', path: `/webhooks/${webhookId(words[2])}/test`, body: {}, mutation: true, flags: [] };
    case 'webhooks deliveries': arity(3); return { method: 'GET', path: `/webhooks/${webhookId(words[2])}/deliveries`, mutation: false, flags: [] };
    case 'webhooks rotate-secret':
      arity(3);
      return { method: 'POST', path: `/webhooks/${webhookId(words[2])}/rotate-secret`, body: {}, mutation: true, flags: [], notice: SECRET_NOTICE.replace('if you lose it, run: turbopress webhooks rotate-secret ID', 'the previous secret no longer works') };
    default: return undefined;
  }
}

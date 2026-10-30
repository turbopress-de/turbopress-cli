import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join, parse as parsePath, resolve, sep } from 'node:path';
import { ApiClient, type ApiResponse } from './client.js';
import { ApiError } from './errors.js';
import { waitOperation } from './operations.js';
import { formatDryRun } from './dryrun.js';
import { agencyRoute, type AgencyRoute } from './agency.js';

const VERSION = '0.6.1';
type Write = (text: string) => void;
interface Dependencies {
  token?: string;
  transport?: typeof fetch;
  stdout?: Write;
  stderr?: Write;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  files?: { lstat: typeof lstat; open: typeof open };
}
type Options = Record<string, string | boolean | string[]>;
const VALUE_FLAGS = new Set(['site', 'deployment', 'path', 'file', 'scope', 'timeout', 'idempotency-key', 'limit', 'cursor', 'status', 'backup', 'confirm', 'folder', 'confirm-host', 'expected-version', 'tables',
  'client', 'state', 'month', 'date', 'minutes', 'text', 'external-id', 'paid-by', 'kind', 'expires', 'url', 'events', 'active',
  'name', 'contact-name', 'email', 'note', 'maintenance-contract', 'send-report', 'quota-minutes', 'price-month-cent']);
// Values that may be empty because the API treats an empty string as "clear".
const EMPTY_OK_FLAGS = new Set(['email', 'note', 'contact-name', 'kind']);
const MULTI_FLAGS = new Set(['plugin', 'theme']);
const BOOL_FLAGS = new Set(['json', 'wait', 'version', 'help', 'confirm-data-loss', 'dry-run', 'delete-missing-files', 'no-delete-missing-files', 'premium', 'resend']);
const USAGE = [
  'Usage: turbopress <command> [options]',
  '',
  '  turbopress sites list [--limit 1..100] [--cursor CURSOR] [--json]',
  '  turbopress sites show --site SITE [--json]',
  '  turbopress backups list --site SITE [--limit 1..100] [--cursor CURSOR] [--json]',
  '  turbopress backups delete --site SITE --backup ID [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]',
  '  turbopress backups create --site SITE [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]',
  '  turbopress cache purge --site SITE --scope page|object|all [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]',
  '  turbopress operations list [--site SITE] [--status STATUS] [--limit 1..100] [--cursor CURSOR] [--json]',
  '  turbopress operations get ID [--json]',
  '  turbopress operations wait ID [--timeout SECONDS] [--json]',
  '  turbopress deployments create --site SITE [--idempotency-key KEY] [--json]',
  '  turbopress deployments put-file --site SITE --deployment ID --path RELATIVE_PATH --file LOCAL_FILE [--idempotency-key KEY] [--json]',
  '  turbopress deployments preview --site SITE --deployment ID [--idempotency-key KEY] [--json]',
  '  turbopress deployments publish --site SITE --deployment ID [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]',
  '  turbopress deployments list --site SITE [--limit 1..100] [--cursor CURSOR] [--json]',
  '  turbopress deployments rollback --site SITE --deployment ID [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]',
  '  turbopress updates list --site SITE [--json]',
  '  turbopress updates run --site SITE [--plugin SLUG]... [--theme SLUG]... [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]',
  '  turbopress staging delete --site LIVE_SITE --confirm STAGING_HOST [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]',
  '  turbopress backups restore --site SITE --backup ID --scope full|database|files|folder [--folder wp-content/...] --confirm-host SITE_HOST [--confirm-data-loss] [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]',
  '  turbopress core update --site SITE [--expected-version X.Y[.Z]] [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]',
  '  turbopress plugins enable|disable --site SITE --plugin SLUG [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]',
  '  turbopress staging create --site LIVE_SITE [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]',
  '  turbopress staging push --site LIVE_SITE --scope all|files|db|selected [--tables a,b] --delete-missing-files|--no-delete-missing-files --confirm-host LIVE_HOST [--confirm-data-loss] [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]',
  '  turbopress staging push --site LIVE_SITE --scope all|files|db|selected [--tables a,b] --dry-run [--json]',
  '  turbopress clients list [--limit 1..100] [--cursor CURSOR] [--json]',
  '  turbopress clients show ID [--json]',
  '  turbopress clients create --name NAME [--contact-name N] [--email MAIL] [--note TEXT] [--maintenance-contract true|false] [--send-report true|false] [--quota-minutes N|none] [--price-month-cent N|none] [--idempotency-key KEY] [--json]',
  '  turbopress clients update ID [same fields as create] [--idempotency-key KEY] [--json]',
  '  turbopress clients delete ID --confirm "EXACT CLIENT NAME" [--idempotency-key KEY] [--json]',
  '  turbopress sites list --client ID|none [--limit 1..100] [--cursor CURSOR] [--json]',
  '  turbopress sites set-client SITE_ID CLIENT_ID|none [--idempotency-key KEY] [--json]',
  '  turbopress plugins list [--state vulnerable|update|ok|inactive] [--premium] [--limit 1..100] [--cursor CURSOR] [--json]',
  '  turbopress plugins show SLUG [--json]',
  '  turbopress plugins site SITE_ID [--json]',
  '  turbopress licenses list [--limit 1..100] [--cursor CURSOR] [--json]',
  '  turbopress licenses set SLUG --paid-by agency|client [--kind TEXT] [--expires YYYY-MM-DD|none] [--idempotency-key KEY] [--json]',
  '  turbopress work list CLIENT_ID [--month YYYY-MM] [--limit 1..100] [--cursor CURSOR] [--json]',
  '  turbopress work add CLIENT_ID --date YYYY-MM-DD --minutes 5..1440 --text TEXT [--site SITE_ID] [--external-id ID] [--idempotency-key KEY] [--json]',
  '  turbopress work rm CLIENT_ID ENTRY_ID [--idempotency-key KEY] [--json]',
  '  turbopress reports list CLIENT_ID [--json]',
  '  turbopress reports show CLIENT_ID PERIOD [--json]',
  '  turbopress reports share CLIENT_ID PERIOD [--idempotency-key KEY] [--json]',
  '  turbopress reports send CLIENT_ID PERIOD [--resend] [--idempotency-key KEY] [--json]',
  '  turbopress webhooks list [--json]',
  '  turbopress webhooks show ID [--json]',
  '  turbopress webhooks create --url https://... --events a,b [--idempotency-key KEY] [--json]',
  '  turbopress webhooks update ID [--url URL] [--events a,b] [--active true|false] [--idempotency-key KEY] [--json]',
  '  turbopress webhooks delete ID [--idempotency-key KEY] [--json]',
  '  turbopress webhooks test ID [--idempotency-key KEY] [--json]',
  '  turbopress webhooks deliveries ID [--json]',
  '  turbopress webhooks rotate-secret ID [--idempotency-key KEY] [--json]',
  '  turbopress token [--json]          Show the API key you are using (metadata only)',
  '  turbopress status [--json]',
  '  turbopress --version',
  '',
  'backups delete removes the backup permanently. status needs no API key.',
  'updates run: plugins and themes only (1 to 5 items in total); creates a safety backup first.',
  'staging delete: removes the staging site permanently; --confirm must be the exact staging host.',
  'backups restore: OVERWRITES the site with the backup; everything written since is lost (with full/database also WooCommerce orders and customers).',
  '  A safety backup is created first; there is no automatic rollback. Scope and --confirm-host are mandatory, nothing is defaulted.',
  '  scope folder mirrors one folder and DELETES files there that are not in the backup; files never deletes. --confirm-data-loss is required when WooCommerce is active.',
  'core update: updates WordPress core after a safety backup; no automatic rollback. --expected-version aborts if another version is offered.',
  'plugins enable|disable: switches one installed plugin; no safety backup. Security or cache plugins and WooCommerce can be switched off too.',
  'staging create: creates the single staging copy staging.<main domain> of the live site (needs free web space); live is not changed.',
  'staging push: OVERWRITES THE LIVE SITE with its staging copy (a safety backup of live is created first, no automatic rollback).',
  '  Everything is explicit: --scope, --delete-missing-files or --no-delete-missing-files (true deletes live files missing in staging; only with all/files),',
  '  --confirm-host (exact live host, never filled in automatically), --confirm-data-loss when WooCommerce is active on live (newer orders and customers are lost).',
  '  --dry-run changes nothing, needs no Idempotency-Key and prints the checks (pair, tables, quota, storage, busy, daily limit).',
  'clients delete: removes the client with its work log, reports and share links; --confirm must be the exact client name. The sites stay and become unassigned.',
  'reports share prints a public URL ONCE (secret, valid 90 days); webhooks create and rotate-secret print the signing secret ONCE. They are never stored or logged by the CLI.',
  'reports send mails the report to the client address stored in the panel; --resend sends an already sent report again (limited).',
  'Every write sends an Idempotency-Key (generated, or --idempotency-key). Agency commands need an agency API key (clients:*, plugins:read, ... see the API docs).',
  '',
].join('\n') + '\n';
const OPERATION_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'unknown'];

function parse(args: string[]): { words: string[]; options: Options } {
  const words: string[] = [];
  const options: Options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) { words.push(arg); continue; }
    const name = arg.slice(2);
    const multi = MULTI_FLAGS.has(name);
    if (name.includes('=') || !VALUE_FLAGS.has(name) && !BOOL_FLAGS.has(name) && !multi || !multi && name in options) {
      throw new ApiError('Invalid or duplicate option', 2);
    }
    if (BOOL_FLAGS.has(name)) options[name] = true;
    else if (multi) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new ApiError(`Missing value for --${name}`, 2);
      ((options[name] ??= []) as string[]).push(value);
    }
    else {
      const value = args[++i];
      if (value === undefined || value.startsWith('--') || value === '' && !EMPTY_OK_FLAGS.has(name)) throw new ApiError(`Missing value for --${name}`, 2);
      options[name] = value;
    }
  }
  return { words, options };
}
function required(options: Options, name: string): string {
  const value = options[name];
  if (typeof value !== 'string' || !value) throw new ApiError(`--${name} is required`, 2);
  return value;
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new ApiError('Invalid identifier', 2);
  return encodeURIComponent(value);
}

function backupId(value: string): string {
  if (!/^[A-Za-z0-9._+:][A-Za-z0-9._+:-]{0,119}$/.test(value) || value.includes('..') || value.startsWith('.')) throw new ApiError('Invalid identifier', 2);
  return encodeURIComponent(value);
}

function slugs(options: Options, name: 'plugin' | 'theme'): Array<{ type: string; slug: string }> {
  const values = (options[name] as string[] | undefined) ?? [];
  const seen = new Set<string>();
  return values.map(slug => {
    if (!/^[a-z0-9][a-z0-9-]{0,61}$/.test(slug)) throw new ApiError(`Invalid ${name} slug`, 2);
    if (seen.has(slug)) throw new ApiError(`Duplicate ${name} slug`, 2);
    seen.add(slug);
    return { type: name, slug };
  });
}

function hostName(value: string, flag: string): string {
  // ASCII check first: toLowerCase() would map e.g. U+212A (Kelvin sign) to 'k'.
  if (!/^[\x21-\x7e]+$/.test(value)) throw new ApiError(`Invalid --${flag} host`, 2);
  const host = value.toLowerCase();
  if (host.length > 253 || !host.split('.').every(label => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new ApiError(`Invalid --${flag} host`, 2);
  return host;
}

function stagingHost(value: string): string {
  return encodeURIComponent(hostName(value, 'confirm'));
}

const RESTORE_SCOPES = ['full', 'database', 'files', 'folder'];
const PUSH_SCOPES = ['all', 'files', 'db', 'selected'];

function restoreBody(options: Options): Record<string, unknown> {
  const scope = required(options, 'scope');
  if (!RESTORE_SCOPES.includes(scope)) throw new ApiError('Invalid restore scope', 2);
  const folder = options.folder;
  if (scope === 'folder') {
    if (typeof folder !== 'string' || !/^wp-content\/(uploads|(plugins|themes)\/[a-z0-9-]{1,100})$/.test(folder)) throw new ApiError('--folder must be wp-content/uploads, wp-content/plugins/SLUG or wp-content/themes/SLUG', 2);
  } else if (folder !== undefined) throw new ApiError('--folder is only valid with --scope folder', 2);
  const body: Record<string, unknown> = { scope };
  if (scope === 'folder') body.folder = folder;
  body.confirm_host = hostName(required(options, 'confirm-host'), 'confirm-host');
  if (options['confirm-data-loss']) body.confirm_data_loss = true;
  return body;
}

function pushBody(options: Options, dryRun: boolean): Record<string, unknown> {
  const scope = required(options, 'scope');
  if (!PUSH_SCOPES.includes(scope)) throw new ApiError('Invalid push scope', 2);
  const body: Record<string, unknown> = { scope };
  if (scope === 'selected') {
    const tables = required(options, 'tables').split(',');
    if (tables.length > 1000 || new Set(tables).size !== tables.length || !tables.every(table => /^[A-Za-z0-9_]{1,64}$/.test(table))) throw new ApiError('Invalid --tables', 2);
    body.tables = tables;
  } else if (options.tables !== undefined) throw new ApiError('--tables is only valid with --scope selected', 2);
  if (options['delete-missing-files'] && options['no-delete-missing-files']) throw new ApiError('Give only one of --delete-missing-files and --no-delete-missing-files', 2);
  const del = options['delete-missing-files'] ? true : options['no-delete-missing-files'] ? false : undefined;
  if (del === undefined && !dryRun) throw new ApiError('--delete-missing-files or --no-delete-missing-files is required', 2);
  if (del === true && !['all', 'files'].includes(scope)) throw new ApiError('--delete-missing-files is only valid with --scope all or files', 2);
  if (del !== undefined) body.delete_missing_files = del;
  // The live host is never derived; a real push without it is refused here, a dry run takes it only for information.
  if (options['confirm-host'] !== undefined || !dryRun) body.confirm_host = hostName(required(options, 'confirm-host'), 'confirm-host');
  if (options['confirm-data-loss']) body.confirm_data_loss = true;
  if (dryRun) body.dry_run = true;
  return body;
}

function pluginSlug(options: Options): string {
  const values = (options.plugin as string[] | undefined) ?? [];
  if (values.length !== 1) throw new ApiError('Give exactly one --plugin SLUG', 2);
  const slug = values[0]!;
  if (!/^[a-z0-9][a-z0-9_.-]{0,61}$/.test(slug) || slug.includes('..')) throw new ApiError('Invalid plugin slug', 2);
  return encodeURIComponent(slug);
}

function integer(value: string | boolean | string[] | undefined, name: string, min: number, max: number): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new ApiError(`Invalid --${name}`, 2);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new ApiError(`Invalid --${name}`, 2);
  return n;
}

function key(options: Options): string {
  const supplied = options['idempotency-key'];
  if (supplied !== undefined) {
    if (typeof supplied !== 'string' || !/^[\x20-\x7e]{16,128}$/.test(supplied)) throw new ApiError('Invalid Idempotency-Key', 2);
    return supplied;
  }
  return randomUUID();
}

function listPath(path: string, options: Options): string {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set('limit', String(integer(options.limit, 'limit', 1, 100)));
  if (options.cursor !== undefined) query.set('cursor', required(options, 'cursor'));
  return path + (query.size ? `?${query}` : '');
}

function remotePath(value: string): string {
  const path = value.replaceAll('\\', '/');
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes(':') || path.split('/').some(part => !part || part === '.' || part === '..') || /[\x00-\x1f]/.test(path)) {
    throw new ApiError('Invalid remote path', 2);
  }
  return path;
}

async function fileBody(options: Options, files: { lstat: typeof lstat; open: typeof open } = { lstat, open }): Promise<unknown> {
  const path = remotePath(required(options, 'path'));
  let filename = resolve(required(options, 'file'));
  // macOS exposes these stable system roots as links into /private.
  if (process.platform === 'darwin' && ['/var', '/tmp', '/etc'].some(alias => filename === alias || filename.startsWith(`${alias}/`))) {
    filename = `/private${filename}`;
  }
  const root = parsePath(filename).root;
  const parts = filename.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  const checked: Array<{ path: string; dev: number; ino: number }> = [];
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const info = await files.lstat(current);
    if (info.isSymbolicLink() || (index === parts.length - 1 ? !info.isFile() : !info.isDirectory())) {
      throw new ApiError('File path must contain no symlinks', 2);
    }
    checked.push({ path: current, dev: info.dev, ino: info.ino });
  }
  let handle;
  try {
    handle = await files.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    throw new ApiError('File must be a regular file without symlinks', 2);
  }
  let content: Buffer;
  try {
    const opened = await handle.stat();
    for (const component of checked) {
      const currentInfo = await files.lstat(component.path);
      if (currentInfo.isSymbolicLink() || currentInfo.dev !== component.dev || currentInfo.ino !== component.ino) {
        throw new ApiError('File path changed while opening', 2);
      }
    }
    if (!opened.isFile() || opened.dev !== checked.at(-1)?.dev || opened.ino !== checked.at(-1)?.ino) {
      throw new ApiError('File changed while opening', 2);
    }
    content = await handle.readFile();
  } finally {
    await handle.close();
  }
  return { path, content: content.toString('base64'), encoding: 'base64' };
}

function operationId(reply: ApiResponse): string | undefined {
  const data = reply.data;
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const value = record.operation_id ?? record.id;
    if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)) return value;
  }
  const location = reply.headers.get('location');
  const match = location?.match(/^\/api\/v1\/operations\/([A-Za-z0-9_-]{1,128})$/);
  return match?.[1];
}

// A finished updates:run only counts as success if every item is updated or unchanged (allow-list).
// Returns the exit code (0, 1 or 4) and the offending items as 'slug:status' (slugs and statuses only).
function judgeUpdates(data: unknown): { code: number; bad: string[] } {
  const result = (data as { result?: { status?: unknown; items?: unknown } } | null)?.result;
  if (!result || typeof result !== 'object') return { code: 0, bad: [] };
  const items = Array.isArray(result.items) ? result.items as Array<{ slug?: unknown; status?: unknown }> : [];
  const bad = items.filter(item => item?.status !== 'updated' && item?.status !== 'unchanged')
    .map(item => `${String(item?.slug ?? '?').replace(/[^a-z0-9-]/g, '?').slice(0, 62)}:${String(item?.status ?? '?').replace(/[^a-z_]/g, '?').slice(0, 20)}`);
  const unconfirmed = items.some(item => item?.status === 'unconfirmed');
  if (unconfirmed) return { code: 4, bad };
  if (bad.length || result.status === 'failed' || result.status === 'partial') return { code: 1, bad };
  return { code: 0, bad };
}

async function executeAgency(route: AgencyRoute, options: Options, client: ApiClient): Promise<unknown> {
  const allowed = new Set(['json', ...route.flags]);
  if (route.mutation) allowed.add('idempotency-key');
  if (Object.keys(options).some(option => !allowed.has(option))) throw new ApiError('Option not valid for this command', 2);
  if (options['idempotency-key'] && !route.mutation) throw new ApiError('--idempotency-key requires a mutation', 2);
  const mutationKey = route.mutation ? key(options) : undefined;
  let reply: ApiResponse;
  try { reply = await client.request(route.method, route.path, route.body, mutationKey); }
  catch (error) {
    if (mutationKey && error instanceof ApiError && !error.idempotencyKey) throw new ApiError(error.message, error.exitCode, mutationKey);
    throw error;
  }
  if (reply.status === 204) return route.empty ?? { ok: true };
  return route.paged ? { data: reply.data, meta: reply.meta } : reply.data;
}

async function execute(words: string[], options: Options, client: ApiClient, deps: Dependencies, notes: string[]): Promise<unknown> {
  const agency = agencyRoute(words, options);
  if (agency) {
    const result = await executeAgency(agency, options, client);
    if (agency.notice) notes.push(agency.notice);
    return result;
  }
  const single = words[0] === 'token' || words[0] === 'status';
  if (words.length !== (single ? 1 : words[0] === 'operations' && words[1] !== 'list' ? 3 : 2)) throw new ApiError('Invalid command', 2);
  const [group, action] = words;
  const site = () => safeId(required(options, 'site'));
  const deployment = () => safeId(required(options, 'deployment'));
  let method = 'GET';
  let path: string;
  let body: unknown;
  let mutation = false;
  let job = false;
  let dryRun = false;

  switch (action === undefined ? group : `${group} ${action}`) {
    case 'sites list': {
      path = listPath('/sites', options);
      if (options.client !== undefined) {
        const filter = required(options, 'client');
        if (!/^([1-9][0-9]{0,9}|none)$/.test(filter)) throw new ApiError('Invalid --client (client ID or none)', 2);
        path += `${path.includes('?') ? '&' : '?'}client_id=${filter}`;
      }
      break;
    }
    case 'sites show': path = `/sites/${site()}`; break;
    case 'backups list': path = listPath(`/sites/${site()}/backups`, options); break;
    case 'backups create': method = 'POST'; path = `/sites/${site()}/backups`; mutation = job = true; break;
    case 'cache purge': {
      const scope = required(options, 'scope');
      if (!['page', 'object', 'all'].includes(scope)) throw new ApiError('Invalid cache scope', 2);
      method = 'POST'; path = `/sites/${site()}/cache/purge`; body = { scope }; mutation = job = true; break;
    }
    case 'backups delete': method = 'DELETE'; path = `/sites/${site()}/backups/${backupId(required(options, 'backup'))}`; mutation = job = true; break;
    case 'updates list': path = `/sites/${site()}/updates`; break;
    case 'updates run': {
      const items = [...slugs(options, 'plugin'), ...slugs(options, 'theme')];
      if (items.length < 1 || items.length > 5) throw new ApiError('Give 1 to 5 items with --plugin and --theme', 2);
      method = 'POST'; path = `/sites/${site()}/updates`; body = { items }; mutation = job = true; break;
    }
    case 'staging delete': method = 'DELETE'; path = `/sites/${site()}/staging?confirm=${stagingHost(required(options, 'confirm'))}`; mutation = job = true; break;
    case 'backups restore': {
      const id = backupId(required(options, 'backup'));
      method = 'POST'; path = `/sites/${site()}/backups/${id}/restore`; body = restoreBody(options); mutation = job = true; break;
    }
    case 'core update': {
      const expected = options['expected-version'];
      if (expected !== undefined && (typeof expected !== 'string' || !/^\d+(\.\d+){1,3}(-[A-Za-z0-9.]{1,20})?$/.test(expected))) throw new ApiError('Invalid --expected-version', 2);
      method = 'POST'; path = `/sites/${site()}/core-update`; body = expected === undefined ? {} : { expected_version: expected }; mutation = job = true; break;
    }
    case 'plugins enable': case 'plugins disable':
      method = 'POST'; path = `/sites/${site()}/plugins/${pluginSlug(options)}/state`; body = { enabled: action === 'enable' }; mutation = job = true; break;
    case 'staging create': method = 'POST'; path = `/sites/${site()}/staging`; body = {}; mutation = job = true; break;
    case 'staging push':
      dryRun = options['dry-run'] === true;
      method = 'POST'; path = `/sites/${site()}/staging/push`; body = pushBody(options, dryRun); mutation = job = !dryRun; break;
    case 'operations list': {
      const query = new URLSearchParams();
      if (options.site !== undefined) { site(); query.set('site_id', options.site as string); }
      if (options.status !== undefined) {
        const status = required(options, 'status');
        if (!OPERATION_STATUSES.includes(status)) throw new ApiError('Invalid --status', 2);
        query.set('status', status);
      }
      if (options.limit !== undefined) query.set('limit', String(integer(options.limit, 'limit', 1, 100)));
      if (options.cursor !== undefined) query.set('cursor', required(options, 'cursor'));
      path = '/operations' + (query.size ? `?${query}` : ''); break;
    }
    case 'token': path = '/token'; break;
    case 'status': path = '/status'; break;
    case 'operations get': path = `/operations/${safeId(words[2]!)}`; break;
    case 'operations wait': path = `/operations/${safeId(words[2]!)}`; break;
    case 'deployments create': method = 'POST'; path = `/sites/${site()}/deployments`; mutation = true; break;
    case 'deployments put-file': method = 'PUT'; path = `/sites/${site()}/deployments/${deployment()}/files`; body = await fileBody(options, deps.files); mutation = true; break;
    case 'deployments preview': method = 'POST'; path = `/sites/${site()}/deployments/${deployment()}/preview`; mutation = true; break;
    case 'deployments publish': method = 'POST'; path = `/sites/${site()}/deployments/${deployment()}/publish`; mutation = job = true; break;
    case 'deployments list': path = listPath(`/sites/${site()}/deployments`, options); break;
    case 'deployments rollback': method = 'POST'; path = `/sites/${site()}/deployments/${deployment()}/rollback`; mutation = job = true; break;
    default: throw new ApiError('Invalid command', 2);
  }
  const command = action === undefined ? group! : `${group} ${action}`;
  const allowed = new Set(['json']);
  if (group !== 'operations' && command !== 'sites list' && !single || command === 'operations list') allowed.add('site');
  if (command === 'backups delete') allowed.add('backup');
  if (command === 'operations list') allowed.add('status');
  if (group === 'deployments' && !['deployments create', 'deployments list'].includes(command)) allowed.add('deployment');
  if (['sites list', 'backups list', 'deployments list', 'operations list'].includes(command)) { allowed.add('limit'); allowed.add('cursor'); }
  if (command === 'sites list') allowed.add('client');
  if (['cache purge', 'backups restore', 'staging push'].includes(command)) allowed.add('scope');
  if (command === 'backups restore') { allowed.add('backup'); allowed.add('folder'); allowed.add('confirm-host'); allowed.add('confirm-data-loss'); }
  if (command === 'core update') allowed.add('expected-version');
  if (group === 'plugins') allowed.add('plugin');
  if (command === 'staging push') for (const flag of ['tables', 'delete-missing-files', 'no-delete-missing-files', 'confirm-host', 'confirm-data-loss', 'dry-run']) allowed.add(flag);
  if (command === 'updates run') { allowed.add('plugin'); allowed.add('theme'); }
  if (command === 'staging delete') allowed.add('confirm');
  if (command === 'deployments put-file') { allowed.add('path'); allowed.add('file'); }
  if (mutation) allowed.add('idempotency-key');
  if (job) allowed.add('wait');
  if (command === 'operations wait' || job && options.wait) allowed.add('timeout');
  if (Object.keys(options).some(option => !allowed.has(option))) throw new ApiError('Option not valid for this command', 2);
  if (options.wait && !job) throw new ApiError('--wait requires a job command', 2);
  if (options['idempotency-key'] && !mutation) throw new ApiError('--idempotency-key requires a mutation', 2);
  const waitTimeout = options.timeout === undefined ? 600 : integer(options.timeout, 'timeout', 0, 86_400);
  if (command === 'operations wait') return waitOperation(client, safeId(words[2]!), waitTimeout, { sleep: deps.sleep, now: deps.now });
  const now = deps.now ?? Date.now;
  const deadlineMs = options.wait ? now() + waitTimeout * 1000 : undefined;
  const mutationKey = mutation ? key(options) : undefined;
  let reply: ApiResponse;
  try { reply = await client.request(method, path, body, mutationKey, { deadlineMs, now, keyless: dryRun }); }
  catch (error) {
    if (command === 'operations get' && error instanceof ApiError) throw new ApiError(error.message, error.exitCode, error.idempotencyKey, safeId(words[2]!));
    if (mutationKey && error instanceof ApiError && !error.idempotencyKey) throw new ApiError(error.message, error.exitCode, mutationKey);
    throw error;
  }
  if (dryRun && (reply.status !== 200 || (reply.data as { dry_run?: unknown } | null)?.dry_run !== true)) throw new ApiError('Unexpected dry-run response', 1);
  if (options.wait) {
    const id = operationId(reply);
    if (!id) throw new ApiError('Job response has no operation ID', 1, mutationKey);
    if (now() >= deadlineMs!) throw new ApiError(`Operation ${id} timed out`, 4, mutationKey, id);
    const retry = Number(reply.headers.get('retry-after'));
    const initialDelayMs = Math.max(5000, Number.isFinite(retry) && retry > 0 ? retry * 1000 : 0);
    try {
      const done = await waitOperation(client, id, waitTimeout, { sleep: deps.sleep, now, initialDelayMs, deadlineMs });
      if (command === 'updates run') {
        const verdict = judgeUpdates(done);
        if (verdict.code) throw new ApiError(`Operation ${id} finished with items not updated${verdict.bad.length ? ` (${verdict.bad.join(', ')})` : ''}`, verdict.code, mutationKey, id, done);
      }
      return done;
    }
    catch (error) {
      if (error instanceof ApiError) throw new ApiError(error.message, error.exitCode, mutationKey, id, error.details);
      throw error;
    }
  }
  return ['sites list', 'backups list', 'deployments list', 'operations list'].includes(`${group} ${action}`) ? { data: reply.data, meta: reply.meta } : reply.data;
}

export async function runCli(args: string[], deps: Dependencies = {}): Promise<number> {
  const stdout = deps.stdout ?? (text => process.stdout.write(text));
  const stderr = deps.stderr ?? (text => process.stderr.write(text));
  const token = deps.token ?? process.env.TURBOPRESS_API_TOKEN ?? '';
  const redact = (text: string) => token ? text.replaceAll(token, '[REDACTED]') : text;
  let words: string[] = [];
  try {
    const parsed = parse(args);
    words = parsed.words;
    const options = parsed.options;
    if (options.version && words.length === 0) { stdout(`${VERSION}\n`); return 0; }
    if (options.help && words.length === 0) { stdout(USAGE); return 0; }
    if (!words.length) throw new ApiError('Command required', 2);
    const anonymous = words[0] === 'status';
    if (!token && !anonymous) throw new ApiError('API key is required (set TURBOPRESS_API_TOKEN)', 3);
    const client = new ApiClient(anonymous ? '' : token, deps.transport, deps.sleep, deps.now, info => {
      stderr(`Waiting ${info.waitSeconds}s before retry ${info.attempt}/${info.max} (${info.code})\n`);
    });
    const notes: string[] = [];
    const data = await execute(words, options, client, deps, notes);
    const text = words[0] === 'staging' && words[1] === 'push' && options['dry-run'] && !options.json ? formatDryRun(data) : JSON.stringify(data, null, options.json ? 0 : 2) + '\n';
    stdout(redact(text));
    for (const note of notes) stderr(`${note}\n`);
    const check = (data as { result?: { health_check?: unknown } } | null)?.result?.health_check;
    if (check === 'issue_found') stderr('Finished, but the health check found a problem afterwards; the safety backup in the result is the way back\n');
    if (words[0] === 'operations' && words[1] === 'get' && data && typeof data === 'object') {
      const status = (data as Record<string, unknown>).status;
      if (status === 'failed') return 1;
      if (status === 'unknown') return 4;
    }
    return 0;
  } catch (error) {
    const safe = error instanceof ApiError ? error : new ApiError('Local I/O or unexpected error', 1);
    // A failed or unknown update/staging/restore/core/plugin job still carries a result (items, safety backup); show it on stdout.
    if (safe.details && (['updates', 'staging', 'core', 'plugins'].includes(words[0] ?? '') || words[0] === 'backups' && words[1] === 'restore')) stdout(redact(JSON.stringify(safe.details, null, args.includes('--json') ? 0 : 2) + '\n'));
    stderr(redact(`${safe.message}\n`));
    if (safe.operationId) stderr(redact(`operation_id=${safe.operationId}\n`));
    if (safe.idempotencyKey) stderr(redact(`idempotency_key=${safe.idempotencyKey}\n`));
    return safe.exitCode;
  }
}

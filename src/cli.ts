import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join, parse as parsePath, resolve, sep } from 'node:path';
import { ApiClient, type ApiResponse } from './client.js';
import { ApiError } from './errors.js';
import { waitOperation } from './operations.js';

const VERSION = '0.4.0';
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
const VALUE_FLAGS = new Set(['site', 'deployment', 'path', 'file', 'scope', 'timeout', 'idempotency-key', 'limit', 'cursor', 'status', 'backup', 'confirm']);
const MULTI_FLAGS = new Set(['plugin', 'theme']);
const BOOL_FLAGS = new Set(['json', 'wait', 'version', 'help']);
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
  '  turbopress token [--json]',
  '  turbopress status [--json]',
  '  turbopress --version',
  '',
  'backups delete removes the backup permanently. status needs no token.',
  'updates run: plugins and themes only (1 to 5 items in total); creates a safety backup first.',
  'staging delete: removes the staging site permanently; --confirm must be the exact staging host.',
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
      if (!value || value.startsWith('--')) throw new ApiError(`Missing value for --${name}`, 2);
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

function stagingHost(value: string): string {
  // ASCII check first: toLowerCase() would map e.g. U+212A (Kelvin sign) to 'k'.
  if (!/^[\x21-\x7e]+$/.test(value)) throw new ApiError('Invalid --confirm host', 2);
  const host = value.toLowerCase();
  if (host.length > 253 || !host.split('.').every(label => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new ApiError('Invalid --confirm host', 2);
  return encodeURIComponent(host);
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

async function execute(words: string[], options: Options, client: ApiClient, deps: Dependencies): Promise<unknown> {
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

  switch (action === undefined ? group : `${group} ${action}`) {
    case 'sites list': path = listPath('/sites', options); break;
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
  if (command === 'cache purge') allowed.add('scope');
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
  try { reply = await client.request(method, path, body, mutationKey, { deadlineMs, now }); }
  catch (error) {
    if (command === 'operations get' && error instanceof ApiError) throw new ApiError(error.message, error.exitCode, error.idempotencyKey, safeId(words[2]!));
    if (mutationKey && error instanceof ApiError && !error.idempotencyKey) throw new ApiError(error.message, error.exitCode, mutationKey);
    throw error;
  }
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
    if (!token && !anonymous) throw new ApiError('TURBOPRESS_API_TOKEN is required', 3);
    const client = new ApiClient(anonymous ? '' : token, deps.transport, deps.sleep, deps.now, info => {
      stderr(`Waiting ${info.waitSeconds}s before retry ${info.attempt}/${info.max} (${info.code})\n`);
    });
    const data = await execute(words, options, client, deps);
    stdout(redact(JSON.stringify(data, null, options.json ? 0 : 2) + '\n'));
    if (words[0] === 'operations' && words[1] === 'get' && data && typeof data === 'object') {
      const status = (data as Record<string, unknown>).status;
      if (status === 'failed') return 1;
      if (status === 'unknown') return 4;
    }
    return 0;
  } catch (error) {
    const safe = error instanceof ApiError ? error : new ApiError('Local I/O or unexpected error', 1);
    // A failed or unknown update/staging job still carries a result (items, safety backup); show it on stdout.
    if (safe.details && ['updates', 'staging'].includes(words[0] ?? '')) stdout(redact(JSON.stringify(safe.details, null, args.includes('--json') ? 0 : 2) + '\n'));
    stderr(redact(`${safe.message}\n`));
    if (safe.operationId) stderr(redact(`operation_id=${safe.operationId}\n`));
    if (safe.idempotencyKey) stderr(redact(`idempotency_key=${safe.idempotencyKey}\n`));
    return safe.exitCode;
  }
}

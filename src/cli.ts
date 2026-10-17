import { randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ApiClient, type ApiResponse } from './client.js';
import { ApiError } from './errors.js';
import { waitOperation } from './operations.js';

const VERSION = '0.1.0';
type Write = (text: string) => void;
interface Dependencies {
  token?: string;
  transport?: typeof fetch;
  stdout?: Write;
  stderr?: Write;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}
type Options = Record<string, string | boolean>;
const VALUE_FLAGS = new Set(['site', 'deployment', 'path', 'file', 'scope', 'url', 'timeout', 'idempotency-key', 'limit', 'cursor']);
const BOOL_FLAGS = new Set(['json', 'wait', 'version', 'help']);
const USAGE = 'Usage: turbopress <sites|backups|cache|operations|deployments> <command> [options]\n';

function parse(args: string[]): { words: string[]; options: Options } {
  const words: string[] = [];
  const options: Options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) { words.push(arg); continue; }
    const name = arg.slice(2);
    if (name.includes('=') || !VALUE_FLAGS.has(name) && !BOOL_FLAGS.has(name) || name in options) {
      throw new ApiError('Invalid or duplicate option', 2);
    }
    if (BOOL_FLAGS.has(name)) options[name] = true;
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

function integer(value: string | boolean | undefined, name: string, min: number, max: number): number {
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

async function fileBody(options: Options): Promise<unknown> {
  const path = remotePath(required(options, 'path'));
  const filename = resolve(required(options, 'file'));
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) throw new ApiError('File must be a regular file', 2);
  const content = await readFile(filename);
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

async function execute(words: string[], options: Options, client: ApiClient, deps: Dependencies): Promise<unknown> {
  if (words.length !== (words[0] === 'operations' ? 3 : 2)) throw new ApiError('Invalid command', 2);
  const [group, action] = words;
  const site = () => safeId(required(options, 'site'));
  const deployment = () => safeId(required(options, 'deployment'));
  let method = 'GET';
  let path: string;
  let body: unknown;
  let mutation = false;
  let job = false;

  switch (`${group} ${action}`) {
    case 'sites list': path = listPath('/sites', options); break;
    case 'sites show': path = `/sites/${site()}`; break;
    case 'backups list': path = listPath(`/sites/${site()}/backups`, options); break;
    case 'backups create': method = 'POST'; path = `/sites/${site()}/backups`; mutation = job = true; break;
    case 'cache purge': {
      const scope = required(options, 'scope');
      if (!['page', 'object', 'all'].includes(scope)) throw new ApiError('Invalid cache scope', 2);
      method = 'POST'; path = `/sites/${site()}/cache/purge`; body = { scope, ...(options.url ? { url: required(options, 'url') } : {}) }; mutation = job = true; break;
    }
    case 'operations get': path = `/operations/${safeId(words[2]!)}`; break;
    case 'operations wait': path = `/operations/${safeId(words[2]!)}`; break;
    case 'deployments create': method = 'POST'; path = `/sites/${site()}/deployments`; mutation = true; break;
    case 'deployments put-file': method = 'PUT'; path = `/sites/${site()}/deployments/${deployment()}/files`; body = await fileBody(options); mutation = true; break;
    case 'deployments preview': method = 'POST'; path = `/sites/${site()}/deployments/${deployment()}/preview`; mutation = true; break;
    case 'deployments publish': method = 'POST'; path = `/sites/${site()}/deployments/${deployment()}/publish`; mutation = job = true; break;
    case 'deployments list': path = listPath(`/sites/${site()}/deployments`, options); break;
    case 'deployments rollback': method = 'POST'; path = `/sites/${site()}/deployments/${deployment()}/rollback`; mutation = job = true; break;
    default: throw new ApiError('Invalid command', 2);
  }
  const command = `${group} ${action}`;
  const allowed = new Set(['json']);
  if (group !== 'operations' && command !== 'sites list') allowed.add('site');
  if (group === 'deployments' && !['deployments create', 'deployments list'].includes(command)) allowed.add('deployment');
  if (['sites list', 'backups list', 'deployments list'].includes(command)) { allowed.add('limit'); allowed.add('cursor'); }
  if (command === 'cache purge') { allowed.add('scope'); allowed.add('url'); }
  if (command === 'deployments put-file') { allowed.add('path'); allowed.add('file'); }
  if (mutation) allowed.add('idempotency-key');
  if (job) allowed.add('wait');
  if (command === 'operations wait' || job && options.wait) allowed.add('timeout');
  if (Object.keys(options).some(option => !allowed.has(option))) throw new ApiError('Option not valid for this command', 2);
  if (options.wait && !job) throw new ApiError('--wait requires a job command', 2);
  if (options['idempotency-key'] && !mutation) throw new ApiError('--idempotency-key requires a mutation', 2);
  const waitTimeout = options.timeout === undefined ? 600 : integer(options.timeout, 'timeout', 0, 86_400);
  if (command === 'operations wait') return waitOperation(client, safeId(words[2]!), waitTimeout, { sleep: deps.sleep, now: deps.now });
  const mutationKey = mutation ? key(options) : undefined;
  let reply: ApiResponse;
  try { reply = await client.request(method, path, body, mutationKey); }
  catch (error) {
    if (mutationKey && error instanceof ApiError && !error.idempotencyKey) throw new ApiError(error.message, error.exitCode, mutationKey);
    throw error;
  }
  if (options.wait) {
    const id = operationId(reply);
    if (!id) throw new ApiError('Job response has no operation ID', 1, mutationKey);
    const retry = Number(reply.headers.get('retry-after'));
    const initialDelayMs = Math.max(5000, Number.isFinite(retry) && retry > 0 ? retry * 1000 : 0);
    try { return await waitOperation(client, id, waitTimeout, { sleep: deps.sleep, now: deps.now, initialDelayMs }); }
    catch (error) {
      if (error instanceof ApiError) throw new ApiError(error.message, error.exitCode, mutationKey, id);
      throw error;
    }
  }
  return ['sites list', 'backups list', 'deployments list'].includes(`${group} ${action}`) ? { data: reply.data, meta: reply.meta } : reply.data;
}

export async function runCli(args: string[], deps: Dependencies = {}): Promise<number> {
  const stdout = deps.stdout ?? (text => process.stdout.write(text));
  const stderr = deps.stderr ?? (text => process.stderr.write(text));
  const token = deps.token ?? process.env.TURBOPRESS_API_TOKEN ?? '';
  const redact = (text: string) => token ? text.replaceAll(token, '[REDACTED]') : text;
  try {
    const { words, options } = parse(args);
    if (options.version && words.length === 0) { stdout(`${VERSION}\n`); return 0; }
    if (options.help && words.length === 0) { stdout(USAGE); return 0; }
    if (!words.length) throw new ApiError('Command required', 2);
    if (!token) throw new ApiError('TURBOPRESS_API_TOKEN is required', 3);
    const client = new ApiClient(token, deps.transport);
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
    stderr(redact(`${safe.message}\n`));
    if (safe.operationId) stderr(redact(`operation_id=${safe.operationId}\n`));
    if (safe.idempotencyKey) stderr(redact(`idempotency_key=${safe.idempotencyKey}\n`));
    return safe.exitCode;
  }
}

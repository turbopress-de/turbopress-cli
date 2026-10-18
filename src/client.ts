import { ApiError } from './errors.js';
import { hintFor } from './hints.js';

const BASE = 'https://panel.turbopress.de/api/v1';
const RETRYABLE = new Set([429, 502, 503, 504]);
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export interface ApiResponse<T = unknown> {
  data: T;
  meta: Record<string, unknown>;
  headers: Headers;
  status: number;
  requestId?: string;
}

export interface RetryInfo {
  attempt: number;
  max: number;
  code: string;
  waitSeconds: number;
}

const WRITE_RETRIES = 3;
const MAX_TOTAL_WAIT_MS = 600_000;
const SAFE_RETRY_CODES: Record<number, readonly string[]> = {
  429: ['rate_limited', 'queue_full'],
  503: ['api_draining'],
};

export interface RequestOptions {
  deadlineMs?: number;
  minRetryDelayMs?: number;
  // POST without Idempotency-Key for a dry run that the API answers at once and never records.
  keyless?: boolean;
  now?: () => number;
}

function safeRetryCode(status: number, envelope: unknown): string | undefined {
  const code = (envelope as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' && SAFE_RETRY_CODES[status]?.includes(code) ? code : undefined;
}

export class ApiClient {
  constructor(
    private readonly token: string,
    private readonly transport: typeof fetch = fetch,
    private readonly delay: (ms: number) => Promise<void> = sleep,
    private readonly now: () => number = Date.now,
    private readonly onRetry?: (info: RetryInfo) => void,
  ) {}

  async request<T = unknown>(method: string, path: string, body?: unknown, idempotencyKey?: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const route = path.split('?', 1)[0]!;
    if (!/^\/(?!\/)[^#\s\\]*$/.test(path) || route.includes('..') || /%2f|%5c|%2e/i.test(route)) {
      throw new ApiError('Invalid API path', 2);
    }
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) throw new ApiError('Invalid method', 2);
    if (method !== 'GET' && !(options.keyless && method === 'POST' && !idempotencyKey) && (!idempotencyKey || !/^[\x20-\x7e]{16,128}$/.test(idempotencyKey))) {
      throw new ApiError('A valid Idempotency-Key is required', 2);
    }
    // Only the anonymous status route may be called without a token; it never carries an Authorization header.
    const anonymous = !this.token;
    if (anonymous && (method !== 'GET' || route !== '/status')) throw new ApiError('TURBOPRESS_API_TOKEN is required', 3);
    const url = BASE + path;
    const headers = new Headers({ accept: 'application/json' });
    if (!anonymous) headers.set('authorization', `Bearer ${this.token}`);
    if (body !== undefined) headers.set('content-type', 'application/json');
    if (idempotencyKey) headers.set('idempotency-key', idempotencyKey);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const now = options.now ?? this.now;
    const deadline = options.deadlineMs ?? Infinity;
    const minRetryDelayMs = method === 'GET' && /^\/operations\/[^/?]+$/.test(route)
      ? Math.max(5000, options.minRetryDelayMs ?? 0) : options.minRetryDelayMs ?? 0;
    // Only the synchronous updates scan may take longer than the usual 30 s per attempt (server: up to ~100 s).
    const perRequestMs = method === 'GET' && /^\/sites\/[^/?]+\/updates$/.test(route) ? 110_000 : 30_000;
    const timedOut = () => new ApiError('Request deadline exceeded', 4, idempotencyKey);
    const retryDelay = async (ms: number) => {
      const remaining = deadline - now();
      if (remaining <= 0) throw timedOut();
      const duration = Math.min(ms, remaining);
      await this.delay(duration);
      if (ms >= remaining || now() >= deadline) throw timedOut();
    };

    let writeRetries = 0;
    let totalWaitMs = 0;
    let preRead: { ok: true; value: unknown } | { ok: false } | undefined;
    for (let attempt = 0; attempt < (method === 'GET' ? 3 : WRITE_RETRIES + 1); attempt++) {
      const remaining = deadline - now();
      if (remaining <= 0) throw timedOut();
      let response: Response;
      const signal = AbortSignal.timeout(Math.max(1, Math.min(perRequestMs, remaining)));
      try {
        response = await this.transport(url, {
          method, headers, body: payload,
          redirect: 'manual', signal,
        });
      } catch {
        if (now() >= deadline || signal.aborted && remaining <= perRequestMs && Number.isFinite(deadline)) throw timedOut();
        if (method === 'GET' && attempt < 2) { await retryDelay(Math.max(minRetryDelayMs, 1000 * (attempt + 1))); continue; }
        throw new ApiError('Network error; mutation result may be unknown', 1, idempotencyKey);
      }
      if (response.status >= 300 && response.status < 400) {
        throw new ApiError('API redirect refused', 1, idempotencyKey);
      }
      if (method === 'GET' && RETRYABLE.has(response.status) && attempt < 2) {
        const retry = Number(response.headers.get('retry-after'));
        await retryDelay(Math.max(minRetryDelayMs, 1000 * (attempt + 1), Number.isFinite(retry) && retry > 0 ? retry * 1000 : 0));
        continue;
      }
      if (method !== 'GET' && writeRetries < WRITE_RETRIES && SAFE_RETRY_CODES[response.status]) {
        // Only these server codes guarantee that no job and no idempotency entry was created.
        // The body is read once and reused by the normal error path below.
        let value: unknown;
        try { value = JSON.parse(await response.text()); preRead = { ok: true, value }; } catch { preRead = { ok: false }; }
        const code = preRead.ok ? safeRetryCode(response.status, value) : undefined;
        if (code) {
          const header = response.headers.get('retry-after')?.trim() ?? '';
          const fallback = response.status === 429 ? 60 : 120;
          const seconds = Math.min(300, Math.max(1, /^\d{1,9}$/.test(header) ? Number(header) : fallback));
          const waitMs = seconds * 1000;
          if (Number.isFinite(deadline) && waitMs >= deadline - now()) throw timedOut();
          // Without a deadline the total retry wait is capped; beyond it the normal error path runs.
          if (Number.isFinite(deadline) || totalWaitMs + waitMs <= MAX_TOTAL_WAIT_MS) {
            writeRetries++;
            totalWaitMs += waitMs;
            this.onRetry?.({ attempt: writeRetries, max: WRITE_RETRIES, code, waitSeconds: seconds });
            await retryDelay(waitMs);
            preRead = undefined;
            continue;
          }
        }
      }
      if (now() >= deadline && !response.ok) throw timedOut();
      let envelope: unknown;
      try {
        if (preRead) { if (!preRead.ok) throw new Error('unreadable'); envelope = preRead.value; } else envelope = await response.json();
      } catch {
        if (now() >= deadline || signal.aborted && remaining <= perRequestMs && Number.isFinite(deadline)) throw timedOut();
        throw new ApiError(`Invalid API response (HTTP ${response.status})`, 1, idempotencyKey);
      }
      if (!envelope || typeof envelope !== 'object') throw new ApiError('Invalid API response', 1, idempotencyKey);
      const record = envelope as Record<string, unknown>;
      const meta = record.meta && typeof record.meta === 'object' ? record.meta as Record<string, unknown> : {};
      const requestId = typeof meta.request_id === 'string' ? meta.request_id : undefined;
      if (!response.ok) {
        // Server messages are untrusted and can echo credentials or request bodies.
        const exitCode = response.status === 401 || response.status === 403 ? 3 : 1;
        const err = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {};
        const code = typeof err.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(err.code) ? err.code : undefined;
        const rid = requestId && /^[A-Za-z0-9._-]{1,64}$/.test(requestId) ? requestId : undefined;
        const hint = hintFor(code);
        throw new ApiError(`API error (HTTP ${response.status}${code ? `, ${code}` : ''}${rid ? `, request_id=${rid}` : ''})${hint}`, exitCode, idempotencyKey);
      }
      if (!('data' in record)) throw new ApiError('Invalid API response: missing data', 1, idempotencyKey);
      return { data: record.data as T, meta, headers: response.headers, status: response.status, requestId };
    }
    throw new ApiError('Read retry limit exceeded', 1);
  }
}

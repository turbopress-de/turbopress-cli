import { ApiError } from './errors.js';

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

export class ApiClient {
  constructor(
    private readonly token: string,
    private readonly transport: typeof fetch = fetch,
    private readonly delay: (ms: number) => Promise<void> = sleep,
  ) {}

  async request<T = unknown>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<ApiResponse<T>> {
    const route = path.split('?', 1)[0]!;
    if (!/^\/(?!\/)[^#\s\\]*$/.test(path) || route.includes('..') || /%2f|%5c|%2e/i.test(route)) {
      throw new ApiError('Invalid API path', 2);
    }
    if (!['GET', 'POST', 'PUT'].includes(method)) throw new ApiError('Invalid method', 2);
    if (method !== 'GET' && (!idempotencyKey || !/^[\x20-\x7e]{16,128}$/.test(idempotencyKey))) {
      throw new ApiError('A valid Idempotency-Key is required', 2);
    }
    const url = BASE + path;
    const headers = new Headers({ authorization: `Bearer ${this.token}`, accept: 'application/json' });
    if (body !== undefined) headers.set('content-type', 'application/json');
    if (idempotencyKey) headers.set('idempotency-key', idempotencyKey);

    for (let attempt = 0; attempt < (method === 'GET' ? 3 : 1); attempt++) {
      let response: Response;
      try {
        response = await this.transport(url, {
          method, headers, body: body === undefined ? undefined : JSON.stringify(body),
          redirect: 'manual', signal: AbortSignal.timeout(30_000),
        });
      } catch {
        if (method === 'GET' && attempt < 2) { await this.delay(1000 * (attempt + 1)); continue; }
        throw new ApiError('Network error; mutation result may be unknown', 1, idempotencyKey);
      }
      if (response.status >= 300 && response.status < 400) {
        throw new ApiError('API redirect refused', 1, idempotencyKey);
      }
      if (method === 'GET' && RETRYABLE.has(response.status) && attempt < 2) {
        const retry = Number(response.headers.get('retry-after'));
        await this.delay(Math.max(1000 * (attempt + 1), Number.isFinite(retry) && retry > 0 ? retry * 1000 : 0));
        continue;
      }
      let envelope: unknown;
      try { envelope = await response.json(); } catch { throw new ApiError(`Invalid API response (HTTP ${response.status})`, 1, idempotencyKey); }
      if (!envelope || typeof envelope !== 'object') throw new ApiError('Invalid API response', 1, idempotencyKey);
      const record = envelope as Record<string, unknown>;
      const meta = record.meta && typeof record.meta === 'object' ? record.meta as Record<string, unknown> : {};
      const requestId = typeof meta.request_id === 'string' ? meta.request_id : undefined;
      if (!response.ok) {
        // Server messages are untrusted and can echo credentials or request bodies.
        const exitCode = response.status === 401 || response.status === 403 ? 3 : 1;
        throw new ApiError(`API error (HTTP ${response.status})`, exitCode, idempotencyKey);
      }
      if (!('data' in record)) throw new ApiError('Invalid API response: missing data', 1, idempotencyKey);
      return { data: record.data as T, meta, headers: response.headers, status: response.status, requestId };
    }
    throw new ApiError('Read retry limit exceeded', 1);
  }
}

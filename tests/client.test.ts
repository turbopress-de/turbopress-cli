import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/client.js';
import { ApiError } from '../src/errors.js';

const response = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('ApiClient', () => {
  it('sends the environment token only to the fixed API host and refuses redirects', async () => {
    const transport = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/collect' } }));
    const client = new ApiClient('tpapi_secret', transport);
    await expect(client.request('GET', '/sites')).rejects.toMatchObject({ exitCode: 1 });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toBe('https://panel.turbopress.de/api/v1/sites');
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('maps authorization failures to exit 3 without leaking the token', async () => {
    const client = new ApiClient('tpapi_secret', async () => response(403, { error: { code: 'forbidden', message: 'Denied tpapi_secret' }, meta: { request_id: 'r1' } }));
    try {
      await client.request('GET', '/sites');
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).exitCode).toBe(3);
      expect((error as Error).message).not.toContain('tpapi_secret');
    }
  });

  it('surfaces safe error codes and request ids for new API errors', async () => {
    for (const [status, code, exit] of [[403, 'account_not_enabled', 3], [413, 'payload_too_large', 1], [415, 'unsupported_media_type', 1], [422, 'not_ai_launch', 1], [409, 'site_busy', 1], [500, 'invalid_context', 1]] as const) {
      const client = new ApiClient('tpapi_secret', async () => response(status, { error: { code, message: 'x tpapi_secret' }, meta: { request_id: 'req-1' } }));
      await expect(client.request('GET', '/sites')).rejects.toMatchObject({ exitCode: exit, message: expect.stringContaining(`HTTP ${status}, ${code}, request_id=req-1`) });
    }
    const evil = new ApiClient('tpapi_secret', async () => response(422, { error: { code: 'bad code tpapi_secret' }, meta: {} }));
    await expect(evil.request('GET', '/sites')).rejects.toMatchObject({ message: 'API error (HTTP 422)' });
  });

  it('retries reads at most twice and never retries a mutation with another key', async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce(response(503, { error: { code: 'unavailable', message: 'busy' }, meta: { request_id: 'r1' } }))
      .mockResolvedValueOnce(response(200, { data: [], meta: { request_id: 'r2' } }));
    const client = new ApiClient('tpapi_secret', transport, async () => {});
    expect((await client.request('GET', '/sites')).data).toEqual([]);
    expect(transport).toHaveBeenCalledTimes(2);

    const failedMutation = vi.fn(async () => { throw new Error('timeout'); });
    const secondClient = new ApiClient('tpapi_secret', failedMutation);
    await expect(secondClient.request('POST', '/sites/s1/backups', {}, 'stable-key-123456')).rejects.toMatchObject({ exitCode: 1, idempotencyKey: 'stable-key-123456' });
    expect(failedMutation).toHaveBeenCalledTimes(1);
  });

  it('rejects paths that could move a request off the API endpoint', async () => {
    const transport = vi.fn();
    const client = new ApiClient('tpapi_secret', transport);
    await expect(client.request('GET', '//evil.example')).rejects.toMatchObject({ exitCode: 2 });
    expect(transport).not.toHaveBeenCalled();
  });

  it('accepts an opaque encoded cursor without treating query bytes as a route', async () => {
    const transport = vi.fn(async () => response(200, { data: [], meta: { request_id: 'r1', next_cursor: null } }));
    const client = new ApiClient('tpapi_secret', transport);
    await client.request('GET', '/sites?cursor=part..%2Fnext');
    expect(transport.mock.calls[0]?.[0]).toBe('https://panel.turbopress.de/api/v1/sites?cursor=part..%2Fnext');
  });

  describe('safe write retries', () => {
    const err = (status: number, code: string, headers: Record<string, string> = {}) =>
      response(status, { error: { code, message: 'server text tpapi_secret' }, meta: { request_id: 'r1' } }, headers);
    const KEY = 'stable-key-123456';
    const mk = (transport: typeof fetch, extra: { now?: () => number; onRetry?: (i: any) => void } = {}) => {
      const waits: number[] = [];
      let time = 0;
      const now = extra.now ?? (() => time);
      const client = new ApiClient('tpapi_secret', transport, async ms => { waits.push(ms); time += ms; }, now, extra.onRetry);
      return { client, waits };
    };
    const sent = (t: ReturnType<typeof vi.fn>) => t.mock.calls.map(c => ({
      key: new Headers((c[1] as RequestInit).headers).get('idempotency-key'), body: (c[1] as RequestInit).body,
    }));

    it('retries a POST after 429 queue_full with the same key and body and waits Retry-After', async () => {
      const t = vi.fn().mockResolvedValueOnce(err(429, 'queue_full', { 'retry-after': '7' })).mockResolvedValueOnce(response(200, { data: { ok: 1 }, meta: {} }));
      const infos: unknown[] = [];
      const { client, waits } = mk(t, { onRetry: i => infos.push(i) });
      expect((await client.request('POST', '/sites/s1/backups', { a: 1 }, KEY)).data).toEqual({ ok: 1 });
      expect(t).toHaveBeenCalledTimes(2);
      const [a, b] = sent(t);
      expect(a).toEqual({ key: KEY, body: '{"a":1}' });
      expect(b).toEqual(a);
      expect(waits).toEqual([7000]);
      expect(infos).toEqual([{ attempt: 1, max: 3, code: 'queue_full', waitSeconds: 7 }]);
    });

    it('retries a PUT after 503 api_draining', async () => {
      const t = vi.fn().mockResolvedValueOnce(err(503, 'api_draining', { 'retry-after': '3' })).mockResolvedValueOnce(response(200, { data: {}, meta: {} }));
      const { client, waits } = mk(t);
      await client.request('PUT', '/sites/s1/deployments/d1/files', { f: 'x' }, KEY);
      expect(t).toHaveBeenCalledTimes(2);
      expect(sent(t)[1]).toEqual(sent(t)[0]);
      expect(waits).toEqual([3000]);
    });

    it('does not retry 429 daily_limit', async () => {
      const t = vi.fn(async () => err(429, 'daily_limit', { 'retry-after': '1' }));
      const { client, waits } = mk(t);
      await expect(client.request('POST', '/sites/s1/backups', {}, KEY)).rejects.toMatchObject({ exitCode: 1, idempotencyKey: KEY });
      expect(t).toHaveBeenCalledTimes(1);
      expect(waits).toEqual([]);
    });

    it('does not retry other 503 codes, 5xx, unreadable bodies or network errors', async () => {
      for (const res of [() => err(503, 'api_unavailable'), () => err(503, 'hosting_unavailable'), () => err(500, 'queue_full'), () => err(502, 'api_draining'),
        () => new Response('not json', { status: 503 }), () => response(503, { error: { code: 42 } })]) {
        const t = vi.fn(async () => res());
        const { client } = mk(t);
        await expect(client.request('POST', '/sites/s1/backups', {}, KEY)).rejects.toMatchObject({ exitCode: 1, idempotencyKey: KEY });
        expect(t).toHaveBeenCalledTimes(1);
      }
      const net = vi.fn(async () => { throw new Error('reset'); });
      await expect(mk(net).client.request('POST', '/sites/s1/backups', {}, KEY)).rejects.toMatchObject({ exitCode: 1, idempotencyKey: KEY });
      expect(net).toHaveBeenCalledTimes(1);
    });

    it('fails with exit 1 and the key after 4 failed attempts', async () => {
      const t = vi.fn(async () => err(429, 'rate_limited', { 'retry-after': '2' }));
      const { client, waits } = mk(t);
      const failure = client.request('POST', '/sites/s1/backups', {}, KEY);
      await expect(failure).rejects.toMatchObject({ exitCode: 1, idempotencyKey: KEY, message: 'API error (HTTP 429, rate_limited, request_id=r1)' });
      expect(t).toHaveBeenCalledTimes(4);
      expect(waits).toEqual([2000, 2000, 2000]);
    });

    it('exits 4 without another request when the deadline is shorter than Retry-After', async () => {
      const t = vi.fn(async () => err(429, 'queue_full', { 'retry-after': '30' }));
      const { client } = mk(t);
      await expect(client.request('POST', '/sites/s1/backups', {}, KEY, { deadlineMs: 10_000 })).rejects.toMatchObject({ exitCode: 4, idempotencyKey: KEY });
      expect(t).toHaveBeenCalledTimes(1);
    });

    it('caps Retry-After at 300 s, enforces 1 s minimum and defaults to 60/120 s', async () => {
      const run = async (status: number, code: string, headers: Record<string, string>) => {
        const t = vi.fn().mockResolvedValueOnce(err(status, code, headers)).mockResolvedValueOnce(response(200, { data: {}, meta: {} }));
        const { client, waits } = mk(t);
        await client.request('POST', '/sites/s1/backups', {}, KEY);
        return waits[0];
      };
      expect(await run(429, 'queue_full', { 'retry-after': '99999' })).toBe(300_000);
      expect(await run(429, 'queue_full', { 'retry-after': '0' })).toBe(1000);
      expect(await run(429, 'rate_limited', {})).toBe(60_000);
      expect(await run(429, 'rate_limited', { 'retry-after': 'soon' })).toBe(60_000);
      expect(await run(503, 'api_draining', {})).toBe(120_000);
    });

    it('keeps GET behaviour unchanged', async () => {
      const t = vi.fn(async () => err(503, 'api_draining'));
      const { client } = mk(t);
      await expect(client.request('GET', '/sites')).rejects.toMatchObject({ exitCode: 1 });
      expect(t).toHaveBeenCalledTimes(3);
    });
  });
});

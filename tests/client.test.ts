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
});

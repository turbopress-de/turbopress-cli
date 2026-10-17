import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/client.js';
import { waitOperation } from '../src/operations.js';

const operation = (status: string, retryAfter = '5') => new Response(
  JSON.stringify({ data: { id: 'op1', status }, meta: { request_id: 'r1' } }),
  { status: 200, headers: { 'content-type': 'application/json', 'retry-after': retryAfter } },
);

describe('waitOperation', () => {
  it('waits at least five seconds and honors a longer Retry-After', async () => {
    const sleep = vi.fn(async () => {});
    const transport = vi.fn().mockResolvedValueOnce(operation('queued', '8')).mockResolvedValueOnce(operation('succeeded'));
    const client = new ApiClient('tpapi_secret', transport);
    const result = await waitOperation(client, 'op1', 600, { sleep, now: (() => { let n = 0; return () => (n += 1000); })() });
    expect(result.status).toBe('succeeded');
    expect(sleep).toHaveBeenCalledWith(8000);
  });

  it('returns exit 4 for unknown and timeout', async () => {
    const unknown = new ApiClient('tpapi_secret', async () => operation('unknown'));
    await expect(waitOperation(unknown, 'op1', 600)).rejects.toMatchObject({ exitCode: 4 });
    const queued = new ApiClient('tpapi_secret', async () => operation('queued'));
    await expect(waitOperation(queued, 'op1', 0)).rejects.toMatchObject({ exitCode: 4 });
  });

  it('returns exit 1 for a failed operation', async () => {
    const client = new ApiClient('tpapi_secret', async () => operation('failed'));
    await expect(waitOperation(client, 'op1', 600)).rejects.toMatchObject({ exitCode: 1 });
  });

  it('does not accept a success returned after the wait deadline', async () => {
    let time = 0;
    const client = new ApiClient('tpapi_secret', async () => { time = 2000; return operation('succeeded'); });
    await expect(waitOperation(client, 'op1', 1, { now: () => time })).rejects.toMatchObject({ exitCode: 4 });
  });
});

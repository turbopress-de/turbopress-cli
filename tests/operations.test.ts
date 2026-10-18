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

  it('includes a safe job error_code for failed and unknown operations', async () => {
    const mk = (status: string, error_code: string) => new Response(JSON.stringify({ data: { id: 'op1', status, error_code }, meta: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    await expect(waitOperation(new ApiClient('t', async () => mk('failed', 'job_expired')), 'op1', 600)).rejects.toMatchObject({ exitCode: 1, message: expect.stringMatching(/^Operation op1 failed \(job_expired\)(; .+)?$/) });
    await expect(waitOperation(new ApiClient('t', async () => mk('unknown', 'blocking')), 'op1', 600)).rejects.toMatchObject({ exitCode: 4, message: 'Operation op1 has unknown outcome (blocking)' });
  });

  it('does not accept a success returned after the wait deadline', async () => {
    let time = 0;
    const client = new ApiClient('tpapi_secret', async () => { time = 2000; return operation('succeeded'); });
    await expect(waitOperation(client, 'op1', 1, { now: () => time })).rejects.toMatchObject({ exitCode: 4 });
  });

  it('caps a 120-second Retry-After at a one-second absolute deadline', async () => {
    let time = 0;
    const calls: number[] = [];
    const sleeps: number[] = [];
    const delay = async (ms: number) => { sleeps.push(ms); time += ms; };
    const client = new ApiClient('tpapi_secret', async () => {
      calls.push(time);
      return calls.length === 1
        ? new Response(JSON.stringify({ error: { code: 'unavailable', message: 'busy' }, meta: { request_id: 'r1' } }), { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '120' } })
        : operation('succeeded');
    }, delay, () => time);
    await expect(waitOperation(client, 'op1', 1, { sleep: delay, now: () => time })).rejects.toMatchObject({ exitCode: 4, operationId: 'op1' });
    expect(calls).toEqual([0]);
    expect(sleeps).toEqual([1000]);
  });

  it('keeps five seconds between operation GET retries even after transport failures', async () => {
    let time = 0;
    const calls: number[] = [];
    const delay = async (ms: number) => { time += ms; };
    const client = new ApiClient('tpapi_secret', async () => {
      calls.push(time);
      if (calls.length < 3) throw new Error('network');
      return operation('succeeded');
    }, delay, () => time);
    const result = await waitOperation(client, 'op1', 20, { sleep: delay, now: () => time });
    expect(result.status).toBe('succeeded');
    expect(calls).toEqual([0, 5000, 10000]);
  });

  it('keeps five seconds between operation GETs when a 429 says Retry-After one second', async () => {
    let time = 0;
    const calls: number[] = [];
    const delay = async (ms: number) => { time += ms; };
    const client = new ApiClient('tpapi_secret', async () => {
      calls.push(time);
      return calls.length === 1
        ? new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'busy' }, meta: { request_id: 'r1' } }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '1' } })
        : operation('succeeded');
    }, delay, () => time);
    expect((await waitOperation(client, 'op1', 20, { sleep: delay, now: () => time })).status).toBe('succeeded');
    expect(calls).toEqual([0, 5000]);
  });

  it('stops repeated network errors at the deadline without a third GET', async () => {
    let time = 0;
    const calls: number[] = [];
    const sleeps: number[] = [];
    const delay = async (ms: number) => { sleeps.push(ms); time += ms; };
    const client = new ApiClient('tpapi_secret', async () => { calls.push(time); throw new Error('network'); }, delay, () => time);
    await expect(waitOperation(client, 'op1', 9, { sleep: delay, now: () => time })).rejects.toMatchObject({ exitCode: 4, operationId: 'op1' });
    expect(calls).toEqual([0, 5000]);
    expect(sleeps).toEqual([5000, 4000]);
  });

  it('uses remaining wait time as the fetch abort deadline', async () => {
    const client = new ApiClient('tpapi_secret', async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const started = Date.now();
    await expect(waitOperation(client, 'op1', 0.05)).rejects.toMatchObject({ exitCode: 4, operationId: 'op1' });
    expect(Date.now() - started).toBeLessThan(500);
  });
});

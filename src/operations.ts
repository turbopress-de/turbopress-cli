import { ApiClient } from './client.js';
import { ApiError } from './errors.js';

export interface Operation { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown'; [key: string]: unknown }
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function waitOperation(
  client: ApiClient, id: string, timeoutSeconds = 600,
  clock: { sleep?: (ms: number) => Promise<void>; now?: () => number; initialDelayMs?: number; deadlineMs?: number } = {},
): Promise<Operation> {
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0) throw new ApiError('Invalid timeout', 2);
  const now = clock.now ?? Date.now;
  const delay = clock.sleep ?? sleep;
  const deadline = clock.deadlineMs ?? now() + timeoutSeconds * 1000;
  const timedOut = () => new ApiError(`Operation ${id} timed out`, 4, undefined, id);
  const waitWithinDeadline = async (ms: number) => {
    const remaining = deadline - now();
    if (remaining <= 0) throw timedOut();
    await delay(Math.min(ms, remaining));
    if (ms >= remaining || now() >= deadline) throw timedOut();
  };
  if (clock.initialDelayMs) {
    await waitWithinDeadline(clock.initialDelayMs);
  }
  while (true) {
    if (now() >= deadline) throw timedOut();
    let reply;
    try {
      reply = await client.request<Operation>('GET', `/operations/${encodeURIComponent(id)}`, undefined, undefined, { deadlineMs: deadline, minRetryDelayMs: 5000, now });
    } catch (error) {
      if (error instanceof ApiError && error.exitCode === 4) throw timedOut();
      if (error instanceof ApiError) throw new ApiError(error.message, error.exitCode, error.idempotencyKey, id);
      throw error;
    }
    if (now() >= deadline) throw timedOut();
    const operation = reply.data;
    if (!operation || typeof operation !== 'object' || !['queued', 'running', 'succeeded', 'failed', 'unknown'].includes(operation.status)) {
      throw new ApiError('Invalid operation response', 1, undefined, id);
    }
    if (operation.status === 'succeeded') return operation;
    if (operation.status === 'failed') throw new ApiError(`Operation ${id} failed`, 1, undefined, id);
    if (operation.status === 'unknown') throw new ApiError(`Operation ${id} has unknown outcome`, 4, undefined, id);
    const retry = Number(reply.headers.get('retry-after'));
    const interval = Math.max(5000, Number.isFinite(retry) && retry > 0 ? retry * 1000 : 0);
    await waitWithinDeadline(interval);
  }
}

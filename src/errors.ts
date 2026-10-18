export class ApiError extends Error {
  constructor(message: string, public readonly exitCode: number, public readonly idempotencyKey?: string, public readonly operationId?: string, public readonly details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

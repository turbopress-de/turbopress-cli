export class ApiError extends Error {
  constructor(message: string, public readonly exitCode: number, public readonly idempotencyKey?: string, public readonly operationId?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

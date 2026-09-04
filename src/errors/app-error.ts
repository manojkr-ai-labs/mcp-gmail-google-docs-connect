export type ErrorCode =
  | 'INVALID_PARAMS'
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'INSUFFICIENT_SCOPE'
  | 'DOCUMENT_NOT_FOUND'
  | 'ACCESS_DENIED'
  | 'GMAIL_API_ERROR'
  | 'DOCS_API_ERROR'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly cause?: unknown;

  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }
  return new AppError('INTERNAL_ERROR', 'An unexpected error occurred.', err);
}

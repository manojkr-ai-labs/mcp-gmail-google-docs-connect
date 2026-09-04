import { AppError } from './app-error.js';

const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

export function sanitizeErrorMessage(message: string): string {
  let sanitized = message
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '[REDACTED]')
    .replace(/1\/\/[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/client_secret[=:]\s*[^\s&]+/gi, 'client_secret=[REDACTED]')
    .replace(/client_id[=:]\s*[^\s&]+/gi, 'client_id=[REDACTED]');

  const home = process.env.USERPROFILE || process.env.HOME;
  if (home) {
    sanitized = sanitized.split(home).join('~');
  }

  return sanitized;
}

export function mapGoogleError(err: unknown, api: 'gmail' | 'docs'): AppError {
  if (err instanceof AppError) {
    return err;
  }

  const status = getStatus(err);
  const reason = getReason(err);
  const rawMessage = getErrorMessage(err);
  const message = sanitizeErrorMessage(rawMessage);

  if (isNetworkError(err)) {
    const uncertain =
      api === 'gmail'
        ? 'A network error occurred while calling Gmail. The operation may or may not have completed; do not retry send_email automatically.'
        : 'A network error occurred while calling Google Docs. The append may or may not have completed; do not retry append_to_google_doc automatically.';
    return new AppError('NETWORK_ERROR', uncertain, err);
  }

  if (
    status === 401 ||
    reason === 'authError' ||
    /invalid_grant/i.test(rawMessage) ||
    /invalid_token/i.test(rawMessage)
  ) {
    return new AppError(
      'AUTH_EXPIRED',
      'Google authorization has expired or is invalid. Run npm run auth to re-authorize.',
      err,
    );
  }

  if (
    status === 403 &&
    (reason === 'insufficientPermissions' ||
      reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' ||
      /insufficient/i.test(rawMessage))
  ) {
    return new AppError(
      'INSUFFICIENT_SCOPE',
      'The authorized Google account lacks the required OAuth scope. Run npm run auth to re-consent.',
      err,
    );
  }

  if (status === 403) {
    return new AppError(
      'ACCESS_DENIED',
      api === 'docs'
        ? 'Access to the Google Doc was denied. Check that the authorized account can edit the document.'
        : 'Gmail denied this operation for the authorized account.',
      err,
    );
  }

  if (status === 404 && api === 'docs') {
    return new AppError(
      'DOCUMENT_NOT_FOUND',
      'The requested Google Doc could not be found or is not accessible.',
      err,
    );
  }

  if (status === 429) {
    return new AppError(
      'RATE_LIMITED',
      'Google API rate limit exceeded. Wait before trying again. Do not immediately retry send_email or append_to_google_doc.',
      err,
    );
  }

  if (api === 'gmail') {
    return new AppError('GMAIL_API_ERROR', message || 'The Gmail API request failed.', err);
  }

  return new AppError('DOCS_API_ERROR', message || 'The Google Docs API request failed.', err);
}

function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && NETWORK_CODES.has(code)) {
    return true;
  }
  const message = getErrorMessage(err).toLowerCase();
  return (
    message.includes('fetch failed') ||
    message.includes('network error') ||
    message.includes('socket hang up') ||
    message.includes('econnreset')
  );
}

function getStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') {
    return undefined;
  }
  const record = err as Record<string, unknown>;
  if (typeof record.status === 'number') {
    return record.status;
  }
  if (typeof record.code === 'number') {
    return record.code;
  }
  const response = record.response;
  if (response && typeof response === 'object') {
    const status = (response as { status?: unknown }).status;
    if (typeof status === 'number') {
      return status;
    }
  }
  return undefined;
}

function getReason(err: unknown): string | undefined {
  const data = getErrorData(err);
  if (!data) {
    return undefined;
  }
  if (typeof data.status === 'string') {
    return data.status;
  }
  const errors = data.errors;
  if (Array.isArray(errors) && errors[0] && typeof errors[0] === 'object') {
    const reason = (errors[0] as { reason?: unknown }).reason;
    if (typeof reason === 'string') {
      return reason;
    }
  }
  return undefined;
}

function getErrorMessage(err: unknown): string {
  const data = getErrorData(err);
  if (data && typeof data.message === 'string' && data.message.trim()) {
    return data.message;
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return '';
}

function getErrorData(err: unknown): { message?: unknown; errors?: unknown; status?: unknown } | undefined {
  if (!err || typeof err !== 'object') {
    return undefined;
  }
  const record = err as Record<string, unknown>;
  const response = record.response;
  if (response && typeof response === 'object') {
    const data = (response as { data?: unknown }).data;
    if (data && typeof data === 'object') {
      const nested = (data as { error?: unknown }).error;
      if (nested && typeof nested === 'object') {
        return nested as { message?: unknown; errors?: unknown; status?: unknown };
      }
    }
  }
  return undefined;
}

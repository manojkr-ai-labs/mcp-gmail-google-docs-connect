import { AppError } from '../errors/app-error.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_SUBJECT_LENGTH = 998;
export const MAX_BODY_LENGTH = 1_000_000;

export interface EmailInput {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  threadId?: string;
  inReplyTo?: string;
}

export interface NormalizedEmailRequest {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
}

export function validateEmailRequest(input: EmailInput): NormalizedEmailRequest {
  const to = normalizeAddresses(input.to, 'to');
  if (to.length < 1) {
    throw new AppError('INVALID_PARAMS', 'At least one recipient is required in "to".');
  }

  const subject = input.subject.trim();
  if (!subject) {
    throw new AppError('INVALID_PARAMS', 'subject is required.');
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new AppError(
      'INVALID_PARAMS',
      `subject exceeds the maximum length of ${MAX_SUBJECT_LENGTH} characters.`,
    );
  }

  if (typeof input.body !== 'string') {
    throw new AppError('INVALID_PARAMS', 'body must be a string.');
  }
  if (!input.body.trim()) {
    throw new AppError('INVALID_PARAMS', 'body is required.');
  }
  if (input.body.length > MAX_BODY_LENGTH) {
    throw new AppError(
      'INVALID_PARAMS',
      `body exceeds the maximum length of ${MAX_BODY_LENGTH} characters.`,
    );
  }

  const cc = input.cc ? normalizeAddresses(input.cc, 'cc') : [];
  const bcc = input.bcc ? normalizeAddresses(input.bcc, 'bcc') : [];

  const threadId = optionalString(input.threadId, 'threadId');
  const inReplyTo = optionalString(input.inReplyTo, 'inReplyTo');

  return {
    to,
    cc,
    bcc,
    subject,
    body: input.body,
    ...(threadId ? { threadId } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
  };
}

export function isValidEmailAddress(value: string): boolean {
  return EMAIL_RE.test(value);
}

function normalizeAddresses(values: string[], field: string): string[] {
  if (!Array.isArray(values)) {
    throw new AppError('INVALID_PARAMS', `${field} must be an array of email addresses.`);
  }

  return values.map((value, index) => {
    if (typeof value !== 'string') {
      throw new AppError('INVALID_PARAMS', `${field}[${index}] must be a string.`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new AppError('INVALID_PARAMS', `${field}[${index}] must not be empty.`);
    }
    if (!isValidEmailAddress(trimmed)) {
      throw new AppError('INVALID_PARAMS', `${field}[${index}] is not a valid email address.`);
    }
    return trimmed;
  });
}

function optionalString(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppError('INVALID_PARAMS', `${field} must not be empty when provided.`);
  }
  return trimmed;
}

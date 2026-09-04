import { AppError } from '../errors/app-error.js';

const DOC_ID_RE = /^[a-zA-Z0-9_-]{10,128}$/;
export const MAX_APPEND_CONTENT_LENGTH = 100_000;

export function validateDocumentId(documentId: string): string {
  if (typeof documentId !== 'string') {
    throw new AppError('INVALID_PARAMS', 'documentId must be a string.');
  }
  const trimmed = documentId.trim();
  if (!DOC_ID_RE.test(trimmed)) {
    throw new AppError(
      'INVALID_PARAMS',
      'documentId must be a Google Doc ID (10-128 characters: letters, digits, underscore, hyphen). Extract it from /document/d/{id}/ in the Doc URL.',
    );
  }
  return trimmed;
}

export function validateAppendContent(content: string): string {
  if (typeof content !== 'string') {
    throw new AppError('INVALID_PARAMS', 'content must be a string.');
  }
  if (content.length < 1) {
    throw new AppError('INVALID_PARAMS', 'content must be a non-empty string.');
  }
  if (content.length > MAX_APPEND_CONTENT_LENGTH) {
    throw new AppError(
      'INVALID_PARAMS',
      `content exceeds the maximum length of ${MAX_APPEND_CONTENT_LENGTH} characters.`,
    );
  }
  return content;
}

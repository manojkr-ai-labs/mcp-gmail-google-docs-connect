import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../src/errors/app-error.js';
import {
  MAX_APPEND_CONTENT_LENGTH,
  validateAppendContent,
  validateDocumentId,
} from '../../src/validation/document.js';

describe('validateDocumentId', () => {
  it('accepts a typical Google Doc ID', () => {
    assert.equal(
      validateDocumentId('  1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms  '),
      '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
    );
  });

  it('rejects empty, short, or malformed IDs', () => {
    assert.throws(
      () => validateDocumentId(''),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_PARAMS',
    );
    assert.throws(
      () => validateDocumentId('short'),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_PARAMS',
    );
    assert.throws(
      () => validateDocumentId('id with spaces!!!!'),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_PARAMS',
    );
  });
});

describe('validateAppendContent', () => {
  it('accepts non-empty content', () => {
    assert.equal(validateAppendContent('Meeting notes'), 'Meeting notes');
  });

  it('rejects empty content', () => {
    assert.throws(
      () => validateAppendContent(''),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_PARAMS',
    );
  });

  it('rejects overlong content', () => {
    assert.throws(
      () => validateAppendContent('x'.repeat(MAX_APPEND_CONTENT_LENGTH + 1)),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_PARAMS',
    );
  });
});

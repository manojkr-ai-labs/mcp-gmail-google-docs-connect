import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../src/errors/app-error.js';
import {
  isValidEmailAddress,
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  validateEmailRequest,
} from '../../src/validation/email.js';

describe('isValidEmailAddress', () => {
  it('accepts practical addresses', () => {
    assert.equal(isValidEmailAddress('ada@example.com'), true);
    assert.equal(isValidEmailAddress('user.name+tag@sub.example.co.uk'), true);
  });

  it('rejects malformed addresses', () => {
    assert.equal(isValidEmailAddress(''), false);
    assert.equal(isValidEmailAddress('not-an-email'), false);
    assert.equal(isValidEmailAddress('missing-domain@'), false);
    assert.equal(isValidEmailAddress('whitespace @example.com'), false);
  });
});

describe('validateEmailRequest', () => {
  const base = {
    to: ['ada@example.com'],
    subject: 'Hello',
    body: 'Body text',
  };

  it('accepts a valid draft/send request and trims addresses', () => {
    const result = validateEmailRequest({
      ...base,
      to: ['  ada@example.com  '],
      cc: ['  grace@example.com '],
      bcc: ['  alan@example.com '],
    });
    assert.deepEqual(result.to, ['ada@example.com']);
    assert.deepEqual(result.cc, ['grace@example.com']);
    assert.deepEqual(result.bcc, ['alan@example.com']);
    assert.equal(result.subject, 'Hello');
  });

  it('rejects an empty to list', () => {
    assert.throws(
      () => validateEmailRequest({ ...base, to: [] }),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_PARAMS',
    );
  });

  it('rejects an invalid recipient', () => {
    assert.throws(
      () => validateEmailRequest({ ...base, to: ['not-an-email'] }),
      (err: unknown) =>
        err instanceof AppError &&
        err.code === 'INVALID_PARAMS' &&
        /valid email address/.test(err.message),
    );
  });

  it('rejects empty strings inside cc/bcc', () => {
    assert.throws(
      () => validateEmailRequest({ ...base, cc: [''] }),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_PARAMS',
    );
    assert.throws(
      () => validateEmailRequest({ ...base, bcc: ['   '] }),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_PARAMS',
    );
  });

  it('rejects missing subject and body', () => {
    assert.throws(
      () => validateEmailRequest({ ...base, subject: '   ' }),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_PARAMS',
    );
    assert.throws(
      () => validateEmailRequest({ ...base, body: '   ' }),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_PARAMS',
    );
  });

  it('rejects overlong subject and body', () => {
    assert.throws(
      () => validateEmailRequest({ ...base, subject: 's'.repeat(MAX_SUBJECT_LENGTH + 1) }),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_PARAMS',
    );
    assert.throws(
      () => validateEmailRequest({ ...base, body: 'b'.repeat(MAX_BODY_LENGTH + 1) }),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_PARAMS',
    );
  });
});

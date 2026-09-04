import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapGoogleError, sanitizeErrorMessage } from '../../src/errors/google-errors.js';

describe('sanitizeErrorMessage', () => {
  it('redacts bearer tokens and client secrets', () => {
    const message = sanitizeErrorMessage(
      'Authorization Bearer ya29.a0SECRET failed client_secret=abc123',
    );
    assert.doesNotMatch(message, /ya29/);
    assert.doesNotMatch(message, /abc123/);
    assert.match(message, /REDACTED/);
  });
});

describe('mapGoogleError', () => {
  it('maps network failures to NETWORK_ERROR', () => {
    const err = Object.assign(new Error('connect failed'), { code: 'ENOTFOUND' });
    const mapped = mapGoogleError(err, 'gmail');
    assert.equal(mapped.code, 'NETWORK_ERROR');
    assert.match(mapped.message, /do not retry send_email/i);
  });

  it('maps 429 to RATE_LIMITED', () => {
    const err = Object.assign(new Error('quota'), {
      response: { status: 429, data: { error: { message: 'quota' } } },
    });
    assert.equal(mapGoogleError(err, 'docs').code, 'RATE_LIMITED');
  });
});

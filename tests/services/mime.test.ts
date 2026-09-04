import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMimeMessage, buildRawMessage, encodeSubject, toBase64Url } from '../../src/services/mime.js';
import type { NormalizedEmailRequest } from '../../src/validation/email.js';

const request: NormalizedEmailRequest = {
  to: ['ada@example.com', 'grace@example.com'],
  cc: ['alan@example.com'],
  bcc: ['secret@example.com'],
  subject: 'Hello',
  body: 'The body',
};

function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (data.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

describe('encodeSubject', () => {
  it('leaves ASCII subjects unchanged', () => {
    assert.equal(encodeSubject('Hello world'), 'Hello world');
  });

  it('RFC 2047-encodes non-ASCII subjects', () => {
    const encoded = encodeSubject('Hello café');
    assert.match(encoded, /^=\?UTF-8\?B\?/);
    const b64 = encoded.slice('=?UTF-8?B?'.length, -'?='.length);
    assert.equal(Buffer.from(b64, 'base64').toString('utf8'), 'Hello café');
  });
});

describe('buildMimeMessage', () => {
  it('includes To, Cc, Bcc, Subject, and body', () => {
    const mime = buildMimeMessage(request);
    assert.match(mime, /^To: ada@example.com, grace@example.com\r\n/);
    assert.match(mime, /\r\nCc: alan@example.com\r\n/);
    assert.match(mime, /\r\nBcc: secret@example.com\r\n/);
    assert.match(mime, /\r\nSubject: Hello\r\n/);
    assert.match(mime, /\r\nContent-Type: text\/plain; charset=UTF-8\r\n/);
    assert.match(mime, /\r\n\r\nThe body$/);
  });

  it('sets In-Reply-To and References when inReplyTo is present', () => {
    const mime = buildMimeMessage({ ...request, inReplyTo: 'abc@mail.gmail.com' });
    assert.match(mime, /\r\nIn-Reply-To: <abc@mail.gmail.com>\r\n/);
    assert.match(mime, /\r\nReferences: <abc@mail.gmail.com>\r\n/);
  });
});

describe('buildRawMessage', () => {
  it('round-trips through base64url', () => {
    const raw = buildRawMessage(request);
    const decoded = decodeBase64Url(raw);
    assert.equal(decoded, buildMimeMessage(request));
    assert.equal(raw, toBase64Url(decoded));
    assert.doesNotMatch(raw, /[+/=]/);
  });
});

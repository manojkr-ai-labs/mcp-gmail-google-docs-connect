import type { NormalizedEmailRequest } from '../validation/email.js';

export function buildMimeMessage(request: NormalizedEmailRequest): string {
  const headers: string[] = [
    `To: ${request.to.join(', ')}`,
  ];

  if (request.cc.length > 0) {
    headers.push(`Cc: ${request.cc.join(', ')}`);
  }
  if (request.bcc.length > 0) {
    headers.push(`Bcc: ${request.bcc.join(', ')}`);
  }

  headers.push(`Subject: ${encodeSubject(request.subject)}`);

  if (request.inReplyTo) {
    const messageId = normalizeMessageId(request.inReplyTo);
    headers.push(`In-Reply-To: ${messageId}`);
    headers.push(`References: ${messageId}`);
  }

  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset=UTF-8');
  headers.push('Content-Transfer-Encoding: 8bit');

  return `${headers.join('\r\n')}\r\n\r\n${request.body}`;
}

export function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function buildRawMessage(request: NormalizedEmailRequest): string {
  return toBase64Url(buildMimeMessage(request));
}

export function encodeSubject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) {
    return subject;
  }
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

function normalizeMessageId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed;
  }
  return `<${trimmed}>`;
}

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GmailService } from '../../src/services/gmail-service.js';
import { GoogleDocsService } from '../../src/services/google-docs-service.js';
import { handler as draftHandler, inputSchema as draftSchema, name as draftName } from '../../src/tools/gmail/draft-email.js';
import { handler as sendHandler, inputSchema as sendSchema, name as sendName } from '../../src/tools/gmail/send-email.js';
import {
  handler as appendHandler,
  inputSchema as appendSchema,
  name as appendName,
} from '../../src/tools/google-docs/append-to-google-doc.js';

function parsePayload(result: { content: Array<{ text: string }>; isError?: boolean }): {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
} {
  return JSON.parse(result.content[0]?.text ?? '{}') as {
    success: boolean;
    data?: unknown;
    error?: { code: string; message: string };
  };
}

describe('tool schemas', () => {
  it('exposes the three tool names', () => {
    assert.deepEqual([draftName, sendName, appendName], [
      'draft_email',
      'send_email',
      'append_to_google_doc',
    ]);
  });

  it('rejects invalid email invocations at the schema layer', () => {
    const parsed = draftSchema.safeParse({ to: [], subject: 'Hi', body: 'Body' });
    assert.equal(parsed.success, false);
  });

  it('rejects empty document content at the schema layer', () => {
    const parsed = appendSchema.safeParse({
      documentId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
      content: '',
    });
    assert.equal(parsed.success, false);
  });

  it('accepts a valid send_email schema including clientRequestId', () => {
    const parsed = sendSchema.safeParse({
      to: ['ada@example.com'],
      subject: 'Hi',
      body: 'Body',
      clientRequestId: 'req-1',
    });
    assert.equal(parsed.success, true);
  });
});

describe('draft_email handler', () => {
  it('returns a success envelope and does not send', async () => {
    let drafted = 0;
    let sent = 0;
    const gmail = {
      draftEmail: async () => {
        drafted += 1;
        return { draftId: 'd1', messageId: 'm1', threadId: 't1' };
      },
      sendEmail: async () => {
        sent += 1;
        return { messageId: 'm2', threadId: 't2', labelIds: ['SENT'] };
      },
    } as unknown as GmailService;

    const result = await draftHandler(
      { to: ['ada@example.com'], subject: 'Hi', body: 'Body' },
      gmail,
    );
    const payload = parsePayload(result);
    assert.equal(payload.success, true);
    assert.deepEqual(payload.data, { draftId: 'd1', messageId: 'm1', threadId: 't1' });
    assert.equal(drafted, 1);
    assert.equal(sent, 0);
    assert.equal(Boolean(result.isError), false);
  });

  it('returns INVALID_PARAMS without calling Gmail for a bad address', async () => {
    let called = 0;
    const gmail = {
      draftEmail: async () => {
        called += 1;
        return { draftId: 'd1', messageId: 'm1', threadId: 't1' };
      },
    } as unknown as GmailService;

    const result = await draftHandler(
      { to: ['not-an-email'], subject: 'Hi', body: 'Body' },
      gmail,
    );
    const payload = parsePayload(result);
    assert.equal(result.isError, true);
    assert.equal(payload.success, false);
    assert.equal(payload.error?.code, 'INVALID_PARAMS');
    assert.equal(called, 0);
  });
});

describe('send_email handler', () => {
  it('returns a success envelope from sendEmail', async () => {
    const gmail = {
      sendEmail: async () => ({ messageId: 'm2', threadId: 't2', labelIds: ['SENT'] }),
    } as unknown as GmailService;

    const result = await sendHandler(
      { to: ['ada@example.com'], subject: 'Hi', body: 'Body' },
      gmail,
    );
    const payload = parsePayload(result);
    assert.equal(payload.success, true);
    assert.deepEqual(payload.data, { messageId: 'm2', threadId: 't2', labelIds: ['SENT'] });
  });
});

describe('append_to_google_doc handler', () => {
  it('returns a success envelope', async () => {
    const docs = {
      appendText: async () => ({
        documentId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
        title: 'Notes',
        appendedCharacterCount: 5,
      }),
    } as unknown as GoogleDocsService;

    const result = await appendHandler(
      {
        documentId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
        content: 'Hello',
      },
      docs,
    );
    const payload = parsePayload(result);
    assert.equal(payload.success, true);
    assert.equal((payload.data as { title: string }).title, 'Notes');
  });

  it('returns INVALID_PARAMS for a malformed document id without calling Docs', async () => {
    let called = 0;
    const docs = {
      appendText: async () => {
        called += 1;
        return { documentId: 'x', title: '', appendedCharacterCount: 0 };
      },
    } as unknown as GoogleDocsService;

    const result = await appendHandler({ documentId: 'bad id', content: 'Hello' }, docs);
    const payload = parsePayload(result);
    assert.equal(result.isError, true);
    assert.equal(payload.error?.code, 'INVALID_PARAMS');
    assert.equal(called, 0);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../src/errors/app-error.js';
import { GmailService, type GmailApi } from '../../src/services/gmail-service.js';
import { buildRawMessage } from '../../src/services/mime.js';
import type { NormalizedEmailRequest } from '../../src/validation/email.js';

const request: NormalizedEmailRequest = {
  to: ['ada@example.com'],
  cc: ['grace@example.com'],
  bcc: ['alan@example.com'],
  subject: 'Hello',
  body: 'The body',
};

function googleError(status: number, extra?: { reason?: string; message?: string }): Error {
  return Object.assign(new Error(extra?.message ?? 'google error'), {
    response: {
      status,
      data: {
        error: {
          message: extra?.message ?? 'google error',
          errors: extra?.reason ? [{ reason: extra.reason }] : [],
        },
      },
    },
  });
}

function createMockGmail(overrides: {
  create?: GmailApi['users']['drafts']['create'];
  send?: GmailApi['users']['messages']['send'];
} = {}): { api: GmailApi; calls: { create: number; send: number } } {
  const calls = { create: 0, send: 0 };
  const api: GmailApi = {
    users: {
      drafts: {
        create: async (params) => {
          calls.create += 1;
          if (overrides.create) {
            return overrides.create(params);
          }
          return {
            data: {
              id: 'draft-1',
              message: { id: 'msg-1', threadId: 'thread-1' },
            },
          };
        },
      },
      messages: {
        send: async (params) => {
          calls.send += 1;
          if (overrides.send) {
            return overrides.send(params);
          }
          return {
            data: {
              id: 'msg-2',
              threadId: 'thread-2',
              labelIds: ['SENT'],
            },
          };
        },
      },
    },
  };
  return { api, calls };
}

describe('GmailService.draftEmail', () => {
  it('creates a draft with MIME raw and does not send', async () => {
    const { api, calls } = createMockGmail();
    const service = new GmailService(api);
    const result = await service.draftEmail(request);

    assert.equal(calls.create, 1);
    assert.equal(calls.send, 0);
    assert.deepEqual(result, {
      draftId: 'draft-1',
      messageId: 'msg-1',
      threadId: 'thread-1',
    });
  });

  it('includes CC and BCC in the MIME payload', async () => {
    let raw: string | undefined;
    const { api } = createMockGmail({
      create: async (params) => {
        raw = params.requestBody.message.raw;
        return { data: { id: 'd', message: { id: 'm', threadId: 't' } } };
      },
    });
    await new GmailService(api).draftEmail(request);
    assert.equal(raw, buildRawMessage(request));
  });

  it('maps Gmail API failures', async () => {
    const { api } = createMockGmail({
      create: async () => {
        throw googleError(500, { message: 'backend exploded' });
      },
    });
    await assert.rejects(
      () => new GmailService(api).draftEmail(request),
      (err: unknown) => err instanceof AppError && err.code === 'GMAIL_API_ERROR',
    );
  });

  it('maps authentication failures', async () => {
    const { api } = createMockGmail({
      create: async () => {
        throw googleError(401, { message: 'invalid_token' });
      },
    });
    await assert.rejects(
      () => new GmailService(api).draftEmail(request),
      (err: unknown) => err instanceof AppError && err.code === 'AUTH_EXPIRED',
    );
  });
});

describe('GmailService.sendEmail', () => {
  it('sends via messages.send and does not create a draft', async () => {
    const { api, calls } = createMockGmail();
    const service = new GmailService(api);
    const result = await service.sendEmail(request);

    assert.equal(calls.send, 1);
    assert.equal(calls.create, 0);
    assert.deepEqual(result, {
      messageId: 'msg-2',
      threadId: 'thread-2',
      labelIds: ['SENT'],
    });
  });

  it('maps 403 insufficient permissions', async () => {
    const { api } = createMockGmail({
      send: async () => {
        throw googleError(403, { reason: 'insufficientPermissions', message: 'insufficient' });
      },
    });
    await assert.rejects(
      () => new GmailService(api).sendEmail(request),
      (err: unknown) => err instanceof AppError && err.code === 'INSUFFICIENT_SCOPE',
    );
  });
});

import { mapGoogleError } from '../errors/google-errors.js';
import type { NormalizedEmailRequest } from '../validation/email.js';
import { buildRawMessage } from './mime.js';

export interface GmailDraftResult {
  draftId: string;
  messageId: string;
  threadId: string;
}

export interface GmailSendResult {
  messageId: string;
  threadId: string;
  labelIds: string[];
}

export interface GmailApi {
  users: {
    drafts: {
      create: (params: {
        userId: string;
        requestBody: { message: { raw: string; threadId?: string } };
      }) => Promise<{ data: { id?: string | null; message?: { id?: string | null; threadId?: string | null } | null } }>;
    };
    messages: {
      send: (params: {
        userId: string;
        requestBody: { raw: string; threadId?: string };
      }) => Promise<{ data: { id?: string | null; threadId?: string | null; labelIds?: string[] | null } }>;
    };
  };
}

export class GmailService {
  constructor(private readonly client: GmailApi) {}

  async draftEmail(request: NormalizedEmailRequest): Promise<GmailDraftResult> {
    const raw = buildRawMessage(request);
    try {
      const res = await this.client.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: {
            raw,
            ...(request.threadId ? { threadId: request.threadId } : {}),
          },
        },
      });
      return {
        draftId: res.data.id ?? '',
        messageId: res.data.message?.id ?? '',
        threadId: res.data.message?.threadId ?? request.threadId ?? '',
      };
    } catch (err) {
      throw mapGoogleError(err, 'gmail');
    }
  }

  async sendEmail(request: NormalizedEmailRequest): Promise<GmailSendResult> {
    const raw = buildRawMessage(request);
    try {
      const res = await this.client.users.messages.send({
        userId: 'me',
        requestBody: {
          raw,
          ...(request.threadId ? { threadId: request.threadId } : {}),
        },
      });
      return {
        messageId: res.data.id ?? '',
        threadId: res.data.threadId ?? request.threadId ?? '',
        labelIds: res.data.labelIds ?? [],
      };
    } catch (err) {
      throw mapGoogleError(err, 'gmail');
    }
  }
}

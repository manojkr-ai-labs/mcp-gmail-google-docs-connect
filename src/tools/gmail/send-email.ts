import { z } from 'zod';
import { GmailService } from '../../services/gmail-service.js';
import { validateEmailRequest } from '../../validation/email.js';
import { runTool, type ToolResult } from '../result.js';

export const name = 'send_email';

export const description = [
  'Sends an email immediately through Gmail for the authenticated user. This cannot be undone.',
  'Use this only when the user (or a confirmed workflow) explicitly asked to send the email.',
  'Do not use this tool to create a draft; use draft_email instead.',
  'Required: to (one or more email addresses), subject, body (plain text).',
  'Optional: cc, bcc, threadId, inReplyTo, clientRequestId (accepted for future idempotency; ignored in v1 except logging).',
  'Side effect: irreversible delivery via Gmail. Duplicate calls can send duplicate messages. Do not retry if the result is NETWORK_ERROR or otherwise uncertain.',
].join(' ');

export const inputSchema = z.object({
  to: z
    .array(z.string())
    .min(1)
    .describe('Recipient email addresses. At least one is required.'),
  subject: z.string().min(1).max(998).describe('Email subject line.'),
  body: z.string().min(1).max(1_000_000).describe('Plain-text email body.'),
  cc: z.array(z.string()).optional().describe('Optional CC recipients.'),
  bcc: z.array(z.string()).optional().describe('Optional BCC recipients.'),
  threadId: z.string().optional().describe('Optional Gmail thread id when sending a reply in-thread.'),
  inReplyTo: z
    .string()
    .optional()
    .describe('Optional RFC Message-ID to set In-Reply-To and References headers.'),
  clientRequestId: z
    .string()
    .optional()
    .describe('Optional client-generated id reserved for future idempotency. Ignored in v1 except for logging.'),
});

export type SendEmailInput = z.infer<typeof inputSchema>;

export async function handler(input: SendEmailInput, gmailService: GmailService): Promise<ToolResult> {
  return runTool(
    name,
    'messages.send',
    {
      recipientCount: input.to.length,
      hasClientRequestId: Boolean(input.clientRequestId),
    },
    async () => {
      const request = validateEmailRequest(input);
      return gmailService.sendEmail(request);
    },
  );
}

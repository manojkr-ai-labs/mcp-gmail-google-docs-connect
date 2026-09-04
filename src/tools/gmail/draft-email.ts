import { z } from 'zod';
import { GmailService } from '../../services/gmail-service.js';
import { validateEmailRequest } from '../../validation/email.js';
import { runTool, type ToolResult } from '../result.js';

export const name = 'draft_email';

export const description = [
  'Creates a Gmail draft for the authenticated user. The message is saved as a draft only and is NOT sent.',
  'Use this when the user asked to draft, compose, or prepare an email for later review.',
  'Do not use this tool when the user asked to send an email; use send_email instead.',
  'Required: to (one or more email addresses), subject, body (plain text).',
  'Optional: cc, bcc, threadId (Gmail thread id), inReplyTo (RFC Message-ID for replies).',
  'Side effect: writes a draft in Gmail. This does not deliver mail to recipients.',
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
  threadId: z.string().optional().describe('Optional Gmail thread id when drafting a reply in-thread.'),
  inReplyTo: z
    .string()
    .optional()
    .describe('Optional RFC Message-ID to set In-Reply-To and References headers.'),
});

export type DraftEmailInput = z.infer<typeof inputSchema>;

export async function handler(input: DraftEmailInput, gmailService: GmailService): Promise<ToolResult> {
  return runTool(name, 'drafts.create', { recipientCount: input.to.length }, async () => {
    const request = validateEmailRequest(input);
    return gmailService.draftEmail(request);
  });
}

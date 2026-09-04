import { z } from 'zod';
import { GoogleDocsService } from '../../services/google-docs-service.js';
import { validateAppendContent, validateDocumentId } from '../../validation/document.js';
import { runTool, type ToolResult } from '../result.js';

export const name = 'append_to_google_doc';

export const description = [
  'Appends plain text to the end of an existing Google Doc. Existing document content is preserved; this tool never replaces or deletes text.',
  'Use this when the user asked to add, append, or write content at the end of a document they already have.',
  'Do not use this to create a new document or to edit a specific section.',
  'Required: documentId (the ID from /document/d/{id}/ in the Google Docs URL), content (non-empty string).',
  'Optional: prependNewline (default true) so appended text starts on a new line instead of merging with the last line.',
  'Side effect: mutates the document. Retrying after an uncertain error may append the same content twice. Do not retry on NETWORK_ERROR.',
].join(' ');

export const inputSchema = z.object({
  documentId: z
    .string()
    .min(1)
    .describe('Google Doc ID from the document URL path /document/d/{documentId}/.'),
  content: z
    .string()
    .min(1)
    .max(100_000)
    .describe('Plain text to append. Maximum 100000 characters. Length is enforced on this field before any newline is added.'),
  prependNewline: z
    .boolean()
    .optional()
    .describe('If true (default), insert a newline before the content so it does not glue onto the last existing line.'),
});

export type AppendToGoogleDocInput = z.infer<typeof inputSchema>;

export async function handler(
  input: AppendToGoogleDocInput,
  docsService: GoogleDocsService,
): Promise<ToolResult> {
  return runTool(
    name,
    'documents.batchUpdate',
    { documentIdLength: input.documentId.length },
    async () => {
      const documentId = validateDocumentId(input.documentId);
      const content = validateAppendContent(input.content);
      return docsService.appendText({
        documentId,
        content,
        prependNewline: input.prependNewline ?? true,
      });
    },
  );
}

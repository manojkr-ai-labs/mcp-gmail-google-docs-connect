import { McpServer } from '@modelcontextprotocol/server';
import { createDocsClient, createGmailClient } from '../auth/google-auth.js';
import { GmailService } from '../services/gmail-service.js';
import { GoogleDocsService } from '../services/google-docs-service.js';
import * as draftEmail from '../tools/gmail/draft-email.js';
import * as sendEmail from '../tools/gmail/send-email.js';
import * as appendToGoogleDoc from '../tools/google-docs/append-to-google-doc.js';

export const SERVER_NAME = 'gmail-docs-mcp';
export const SERVER_VERSION = '1.0.0';

export interface ServerDeps {
  getGmailService?: () => Promise<GmailService>;
  getDocsService?: () => Promise<GoogleDocsService>;
}

let defaultGmailService: GmailService | undefined;
let defaultDocsService: GoogleDocsService | undefined;

async function defaultGetGmailService(): Promise<GmailService> {
  if (!defaultGmailService) {
    defaultGmailService = new GmailService(await createGmailClient());
  }
  return defaultGmailService;
}

async function defaultGetDocsService(): Promise<GoogleDocsService> {
  if (!defaultDocsService) {
    defaultDocsService = new GoogleDocsService(await createDocsClient());
  }
  return defaultDocsService;
}

export function createServer(deps: ServerDeps = {}): McpServer {
  const getGmailService = deps.getGmailService ?? defaultGetGmailService;
  const getDocsService = deps.getDocsService ?? defaultGetDocsService;

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    draftEmail.name,
    {
      title: 'Draft Email',
      description: draftEmail.description,
      inputSchema: draftEmail.inputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => draftEmail.handler(args, await getGmailService()),
  );

  server.registerTool(
    sendEmail.name,
    {
      title: 'Send Email',
      description: sendEmail.description,
      inputSchema: sendEmail.inputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => sendEmail.handler(args, await getGmailService()),
  );

  server.registerTool(
    appendToGoogleDoc.name,
    {
      title: 'Append to Google Doc',
      description: appendToGoogleDoc.description,
      inputSchema: appendToGoogleDoc.inputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => appendToGoogleDoc.handler(args, await getDocsService()),
  );

  return server;
}

export const REGISTERED_TOOL_NAMES = [draftEmail.name, sendEmail.name, appendToGoogleDoc.name] as const;

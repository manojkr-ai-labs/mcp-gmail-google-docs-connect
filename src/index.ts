import 'dotenv/config';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './config/env.js';
import { log } from './logging/logger.js';
import { createServer } from './server/create-server.js';

try {
  loadConfig();
} catch (err) {
  const message = err instanceof Error ? err.message : 'Invalid configuration.';
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

void serveStdio(() => createServer());
log('info', { msg: 'gmail-docs MCP server running on stdio' });

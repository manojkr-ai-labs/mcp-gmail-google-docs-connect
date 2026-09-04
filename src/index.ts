import 'dotenv/config';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './config/env.js';
import { startHttpServer } from './http.js';
import { log } from './logging/logger.js';
import { createServer } from './server/create-server.js';

try {
  loadConfig();
} catch (err) {
  const message = err instanceof Error ? err.message : 'Invalid configuration.';
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (shouldServeHttp()) {
  startHttpServer();
} else {
  void serveStdio(() => createServer());
  log('info', { msg: 'gmail-docs MCP server running on stdio' });
}

function shouldServeHttp(): boolean {
  const transport = process.env.MCP_TRANSPORT?.trim().toLowerCase();
  if (transport === 'http') {
    return true;
  }
  if (transport === 'stdio') {
    return false;
  }
  return Boolean(process.env.PORT);
}

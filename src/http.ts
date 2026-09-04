import 'dotenv/config';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express, NextFunction, Request, Response } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { loadConfig } from './config/env.js';
import { log } from './logging/logger.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server/create-server.js';

const LISTEN_HOST = '0.0.0.0';

export function createHttpApp(): Express {
  const config = loadConfig();
  if (!config.mcpAuthToken) {
    throw new Error('MCP_AUTH_TOKEN is required for the HTTP MCP endpoint.');
  }

  const app = createMcpExpressApp({ host: LISTEN_HOST });

  app.get('/', (_req, res) => {
    res.status(200).json({
      ok: true,
      name: SERVER_NAME,
      version: SERVER_VERSION,
      health: '/health',
      mcp: '/mcp',
    });
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use('/mcp', requireMcpBearer);

  app.all('/mcp', (req, res, next) => {
    void handleMcpRequest(req, res).catch(next);
  });

  return app;
}

export function startHttpServer(): void {
  const port = parseListenPort(process.env.PORT);
  const app = createHttpApp();
  app.listen(port, LISTEN_HOST, () => {
    log('info', {
      msg: 'gmail-docs MCP server listening',
      transport: 'http',
      host: LISTEN_HOST,
      port,
    });
  });
}

function requireMcpBearer(req: Request, res: Response, next: NextFunction): void {
  const expected = loadConfig().mcpAuthToken;
  if (!bearerMatches(req.headers.authorization, expected)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

export function bearerMatches(header: string | undefined, expected: string | undefined): boolean {
  if (!expected) {
    return false;
  }
  if (!header || !header.startsWith('Bearer ')) {
    return false;
  }
  const provided = header.slice('Bearer '.length);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const server = createServer();
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

export function parseListenPort(value: string | undefined): number {
  const port = Number(value);
  if (Number.isInteger(port) && port > 0 && port < 65536) {
    return port;
  }
  return 3000;
}

function isExecutedAsMain(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return path.normalize(fileURLToPath(import.meta.url)) === path.normalize(path.resolve(entry));
  } catch {
    return false;
  }
}

if (isExecutedAsMain()) {
  try {
    loadConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid configuration.';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
  startHttpServer();
}

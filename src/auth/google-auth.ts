import { createServer as createHttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { google } from 'googleapis';
import type { Auth } from 'googleapis';
import { loadConfig, type Config } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { mapGoogleError } from '../errors/google-errors.js';
import type { DocsApi } from '../services/google-docs-service.js';
import type { GmailApi } from '../services/gmail-service.js';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/documents',
] as const;

type OAuth2Client = Auth.OAuth2Client;
type Credentials = Auth.Credentials;

export type TokenSource =
  | { kind: 'env'; credentials: Credentials }
  | { kind: 'file'; path: string }
  | { kind: 'missing' };

export function resolveTokenSource(config: Config): TokenSource {
  if (config.googleRefreshToken) {
    return { kind: 'env', credentials: { refresh_token: config.googleRefreshToken } };
  }
  if (existsSync(config.googleTokenPath)) {
    return { kind: 'file', path: config.googleTokenPath };
  }
  return { kind: 'missing' };
}

export function createOAuth2Client(): OAuth2Client {
  const config = loadConfig();
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri,
  );
}

export async function getAuthorizedClient(): Promise<OAuth2Client> {
  const config = loadConfig();
  const source = resolveTokenSource(config);
  const oauth2Client = createOAuth2Client();
  let tokens: Credentials;
  let persistToFile = false;

  if (source.kind === 'missing') {
    throw new AppError(
      'AUTH_REQUIRED',
      'Google authorization is required. Set GOOGLE_REFRESH_TOKEN or run npm run auth, then retry the tool.',
    );
  }

  if (source.kind === 'env') {
    tokens = source.credentials;
  } else {
    persistToFile = true;
    try {
      const raw = await readFile(source.path, 'utf8');
      tokens = JSON.parse(raw) as Credentials;
    } catch (err) {
      throw new AppError(
        'AUTH_EXPIRED',
        'The stored Google token file is unreadable or invalid. Run npm run auth to re-authorize.',
        err,
      );
    }
  }

  oauth2Client.setCredentials(tokens);
  if (persistToFile) {
    oauth2Client.on('tokens', (newTokens) => {
      void persistTokens({ ...tokens, ...newTokens }).catch(() => {
        // Refresh persistence is best-effort; never log token contents.
      });
    });
  }

  try {
    const accessToken = await oauth2Client.getAccessToken();
    if (!accessToken.token) {
      throw new AppError(
        'AUTH_EXPIRED',
        'Google authorization has expired or is invalid. Run npm run auth to re-authorize.',
      );
    }
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    const mapped = mapGoogleError(err, 'gmail');
    if (mapped.code === 'GMAIL_API_ERROR' || mapped.code === 'ACCESS_DENIED') {
      throw new AppError(
        'AUTH_EXPIRED',
        'Google authorization has expired or is invalid. Run npm run auth to re-authorize.',
        err,
      );
    }
    throw mapped;
  }

  return oauth2Client;
}

export async function createGmailClient(): Promise<GmailApi> {
  const auth = await getAuthorizedClient();
  return google.gmail({ version: 'v1', auth });
}

export async function createDocsClient(): Promise<DocsApi> {
  const auth = await getAuthorizedClient();
  return google.docs({ version: 'v1', auth });
}

export async function runAuthFlow(): Promise<void> {
  const config = loadConfig();
  const redirect = new URL(config.googleRedirectUri);
  const host = redirect.hostname || '127.0.0.1';
  const port = redirect.port ? Number(redirect.port) : redirect.protocol === 'https:' ? 443 : 80;
  const pathname = redirect.pathname || '/';

  const oauth2Client = createOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [...GOOGLE_SCOPES],
  });

  const { codePromise } = await listenForAuthorizationCode({ host, port, pathname });

  process.stderr.write('Open this URL if the browser does not open:\n');
  process.stderr.write(`${authUrl}\n`);
  openBrowser(authUrl);

  const code = await codePromise;
  const { tokens } = await oauth2Client.getToken(code);
  await persistTokens(tokens);

  if (!tokens.refresh_token) {
    process.stderr.write(
      'Warning: Google did not return a refresh_token. Revoke app access at https://myaccount.google.com/permissions and run npm run auth again.\n',
    );
  }

  process.stderr.write(`Google authorization saved to ${config.googleTokenPath}\n`);
}

async function persistTokens(tokens: Credentials): Promise<void> {
  const config = loadConfig();
  await mkdir(dirname(config.googleTokenPath), { recursive: true });
  await writeFile(config.googleTokenPath, JSON.stringify(tokens, null, 2), { encoding: 'utf8' });
  try {
    await chmod(config.googleTokenPath, 0o600);
  } catch {
    // Windows may ignore POSIX modes; the file is still gitignored.
  }
}

async function listenForAuthorizationCode(opts: {
  host: string;
  port: number;
  pathname: string;
}): Promise<{ codePromise: Promise<string> }> {
  const server = createHttpServer();

  const listenHost = opts.host === 'localhost' ? '127.0.0.1' : opts.host;
  const expectedPath = opts.pathname === '' ? '/' : opts.pathname;

  const codePromise = new Promise<string>((resolve, reject) => {
    server.on('request', (req, res) => {
      const requestUrl = new URL(req.url ?? '/', `http://${opts.host}:${opts.port}`);
      if (requestUrl.pathname === '/favicon.ico') {
        res.statusCode = 204;
        res.end();
        return;
      }

      const errorParam = requestUrl.searchParams.get('error');
      const code = requestUrl.searchParams.get('code');
      const pathMatches = requestUrl.pathname === expectedPath || requestUrl.pathname === '/';
      if (!pathMatches && !code && !errorParam) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');

      if (errorParam || !code) {
        res.end('<html><body>Authorization failed. You can close this tab.</body></html>');
        server.close();
        reject(
          new AppError(
            'AUTH_REQUIRED',
            `Google authorization was not completed (${errorParam ?? 'missing code'}).`,
          ),
        );
        return;
      }

      res.end(
        '<html><body>Authorization successful. You can close this tab and return to the terminal.</body></html>',
      );
      server.close(() => resolve(code));
    });

    server.on('error', (err) => {
      reject(
        new AppError(
          'INTERNAL_ERROR',
          `Could not listen on ${opts.host}:${opts.port} for the OAuth redirect. Set GOOGLE_REDIRECT_URI to a free loopback port.`,
          err,
        ),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, listenHost, () => resolve());
  });

  return { codePromise };
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: true,
      }).unref();
      return;
    }
    if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // The URL is already printed to stderr.
  }
}

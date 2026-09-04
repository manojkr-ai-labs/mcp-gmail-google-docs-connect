import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  googleTokenPath: string;
  logLevel: LogLevel;
}

export const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:3000/oauth2callback';
export const DEFAULT_TOKEN_PATH = path.join('.tokens', 'google-token.json');

let cached: Config | undefined;

export function loadConfig(): Config {
  if (cached) {
    return cached;
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '';

  if (!googleClientId || !googleClientSecret) {
    throw new Error(
      'Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET. Copy .env.example to .env and fill in your OAuth credentials.',
    );
  }

  cached = {
    googleClientId,
    googleClientSecret,
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI,
    googleTokenPath: process.env.GOOGLE_TOKEN_PATH?.trim()
      ? path.resolve(process.env.GOOGLE_TOKEN_PATH.trim())
      : path.resolve(process.cwd(), DEFAULT_TOKEN_PATH),
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
  };

  return cached;
}

export function resetConfigCache(): void {
  cached = undefined;
}

export function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = (value ?? 'info').trim().toLowerCase();
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
    return normalized;
  }
  return 'info';
}

import { parseLogLevel, type LogLevel } from '../config/env.js';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface ToolLogEvent {
  tool: string;
  outcome: 'success' | 'failure';
  durationMs: number;
  googleOperation: string;
  errorCode?: string;
  recipientCount?: number;
  documentIdLength?: number;
  hasClientRequestId?: boolean;
}

export function log(level: LogLevel, event: Record<string, unknown>): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[currentLevel()]) {
    return;
  }
  const payload = {
    ts: new Date().toISOString(),
    level,
    ...event,
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
}

export function logTool(event: ToolLogEvent): void {
  log(event.outcome === 'failure' ? 'error' : 'info', {
    msg: 'tool_invocation',
    ...event,
  });
}

function currentLevel(): LogLevel {
  return parseLogLevel(process.env.LOG_LEVEL);
}

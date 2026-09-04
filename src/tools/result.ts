import type { CallToolResult } from '@modelcontextprotocol/server';
import { toAppError, type AppError } from '../errors/app-error.js';
import { logTool } from '../logging/logger.js';

export type ToolResult = CallToolResult;

export function successResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, data }) }],
  };
}

export function errorResult(error: AppError): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        }),
      },
    ],
  };
}

export async function runTool<T>(
  name: string,
  googleOperation: string,
  extra: {
    recipientCount?: number;
    documentIdLength?: number;
    hasClientRequestId?: boolean;
  },
  fn: () => Promise<T>,
): Promise<CallToolResult> {
  const started = Date.now();
  try {
    const data = await fn();
    logTool({
      tool: name,
      outcome: 'success',
      durationMs: Date.now() - started,
      googleOperation,
      ...extra,
    });
    return successResult(data);
  } catch (err) {
    const appErr = toAppError(err);
    logTool({
      tool: name,
      outcome: 'failure',
      durationMs: Date.now() - started,
      googleOperation,
      errorCode: appErr.code,
      ...extra,
    });
    return errorResult(appErr);
  }
}

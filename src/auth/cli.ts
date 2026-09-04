import 'dotenv/config';
import { AppError } from '../errors/app-error.js';
import { runAuthFlow } from './google-auth.js';

try {
  await runAuthFlow();
} catch (err) {
  const message = err instanceof AppError || err instanceof Error ? err.message : 'Authorization failed.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

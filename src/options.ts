import { Command } from 'commander';
import { positive } from './data.js';

export function outputOptions(command: Command): Command {
  return command.option('--json', 'Output the full JSON response').option('-o, --output <file>', 'Write output to a file');
}

export function requestOptions(command: Command): Command {
  return outputOptions(command).option('--data <json|@file>', 'JSON request body; explicit flags override these values');
}

export function pollingOptions(command: Command): Command {
  return command
    .option('--timeout <seconds>', 'Maximum time to poll a task', positive, 300)
    .option('--interval <seconds>', 'Polling interval', positive, 5);
}

export function milliseconds(value: number): number {
  const ms = Math.round(value * 1000);
  if (!Number.isSafeInteger(ms) || ms < 1 || ms > 2_147_483_647) throw new Error('Duration must be between 0.001 and 2147483 seconds.');
  return ms;
}

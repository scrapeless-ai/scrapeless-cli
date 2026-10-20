import { setTimeout as sleep } from 'node:timers/promises';
import { object, type JsonObject } from './data.js';

export interface PollResult { result: JsonObject; timedOut: boolean }

export async function poll(
  read: (signal: AbortSignal) => Promise<unknown>,
  complete: readonly string[],
  timeout = 300_000,
  interval = 5_000,
): Promise<PollResult> {
  const deadline = AbortSignal.timeout(timeout);
  let last: JsonObject = { status: 'pending' };
  try {
    while (!deadline.aborted) {
      last = object(await read(deadline), 'Task response');
      if (complete.includes(String(last.status))) return { result: last, timedOut: false };
      await sleep(interval, undefined, { signal: deadline });
    }
  } catch (error) { if (!deadline.aborted) throw error; }
  return { result: last, timedOut: true };
}

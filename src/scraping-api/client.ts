import { setTimeout as sleep } from 'node:timers/promises';
import { isObject, type JsonObject } from '../data.js';
import { type ApiClient } from '../http.js';

export interface ScrapingPollOptions { timeout: number; interval: number }

function completed(response: { status: number; data: unknown }): boolean {
  if (response.status === 200) return true;
  if (response.status === 201) return false;
  throw new Error(`Unexpected HTTP ${response.status}: ${JSON.stringify(response.data)}`);
}

export async function scrapingResult(api: ApiClient, id: string, options: ScrapingPollOptions): Promise<unknown> {
  const deadline = AbortSignal.timeout(options.timeout);
  let last: unknown;
  try {
    while (!deadline.aborted) {
      const response = await api.requestResponse(`/api/v1/scraper/result/${encodeURIComponent(id)}`, undefined, deadline);
      last = response.data;
      if (completed(response)) return response.data;
      await sleep(options.interval, undefined, { signal: deadline });
    }
  } catch (error) {
    if (!deadline.aborted) throw error;
  }
  throw new Error(`Scraping API polling timed out. Task ID: ${id}. Last response: ${JSON.stringify(last ?? null)}. Continue with: scrapeless scraping-api result ${id}`);
}

export async function runScrapingApi(api: ApiClient, payload: JsonObject, options: ScrapingPollOptions): Promise<unknown> {
  const response = await api.requestResponse('/api/v1/scraper/request', payload);
  if (completed(response)) return response.data;
  const id = isObject(response.data) ? response.data.taskId : undefined;
  if (typeof id !== 'string' || !id.trim()) throw new Error(`HTTP 201 response is missing taskId: ${JSON.stringify(response.data)}`);
  console.error(`Scraping API task: ${id}`);
  return scrapingResult(api, id, options);
}

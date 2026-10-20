import { apiToken } from './config.js';
import { isObject } from './data.js';

export class ApiClient {
  constructor(private token: string, private base = 'https://api.scrapeless.com', private timeout = 60_000) {
    const parsed = new URL(base);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('Invalid API base URL.');
    }
  }

  async request(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.timeout);
    try {
      const response = await fetch(`${this.base.replace(/\/$/, '')}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-api-token': this.token, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
        redirect: 'error',
      });
      const text = await response.text();
      let data: unknown;
      try { data = JSON.parse(text); } catch {
        throw new Error(response.ok ? 'API returned invalid JSON.' : `HTTP ${response.status}: ${text.slice(0, 500)}`);
      }
      if (!response.ok || (isObject(data) && (data.success === false || (typeof data.code === 'number' && data.code >= 400)))) {
        const detail = isObject(data) ? data.message ?? data.error ?? data : data;
        throw new Error(`HTTP ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
      }
      return data;
    } catch (error) {
      const message = timeout.aborted ? `Request timed out after ${this.timeout}ms.` : (error as Error).message;
      throw new Error(message.split(this.token).join('********'));
    }
  }
}

export async function client(): Promise<ApiClient> {
  return new ApiClient((await apiToken())!, process.env.SCRAPELESS_API_BASE_URL);
}

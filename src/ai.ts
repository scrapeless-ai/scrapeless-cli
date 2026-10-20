import { Command } from 'commander';
import { body, boolean, isObject, merge, object, url, type JsonObject } from './data.js';
import { client } from './http.js';
import { output } from './output.js';
import { milliseconds, outputOptions, pollingOptions, requestOptions } from './options.js';
import { poll } from './poll.js';

export const platforms: Record<string, { actor: string; markdown: string; mode?: string; options: readonly string[] }> = {
  chatgpt: { actor: 'scraper.chatgpt', markdown: 'result_text', options: ['web_search', 'shopping', 'should_fetch_share_link'] },
  gemini: { actor: 'scraper.gemini', markdown: 'result_text', options: ['shopping'] },
  copilot: { actor: 'scraper.copilot', markdown: 'result_text', mode: 'search', options: ['mode', 'should_fetch_share_link'] },
  perplexity: { actor: 'scraper.perplexity', markdown: 'result_text', options: ['web_search', 'should_fetch_share_link'] },
  grok: { actor: 'scraper.grok', markdown: 'full_response', mode: 'MODEL_MODE_AUTO', options: ['mode', 'should_fetch_share_link'] },
  alexa: { actor: 'scraper.alexa', markdown: 'md_text', options: [] },
  'google-ai-mode': { actor: 'scraper.aimode', markdown: 'result_md', options: ['shopping', 'location', 'uule', 'url', 'should_fetch_share_link'] },
  'google-ai-overview': { actor: 'scraper.overview', markdown: 'content', options: ['shopping', 'location', 'uule', 'should_fetch_share_link'] },
};

export function platform(name: string) {
  const canonical = ({ aimode: 'google-ai-mode', overview: 'google-ai-overview' } as Record<string, string>)[name] ?? name;
  const found = platforms[canonical];
  if (!found) throw new Error(`Unknown AI platform: ${name}. Choose ${Object.keys(platforms).join(', ')}.`);
  return found;
}

export function markdown(result: JsonObject, name?: string): string {
  let payload = result.task_result;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return payload as string; }
  }
  const data = object(payload, 'task_result');
  const keys = name ? [platform(name).markdown] : ['result_md', 'result_text', 'md_text', 'full_response', 'content'];
  for (const key of keys) if (typeof data[key] === 'string') return data[key];
  throw new Error('Task succeeded but its Markdown field is missing. Use --json to inspect the response.');
}

async function show(result: JsonObject, opts: { json?: boolean; output?: string; platform?: string }, name?: string): Promise<void> {
  if (result.status === 'failed') throw new Error(`AI task failed: ${result.message ?? result.error ?? 'Unknown error'}`);
  await output(opts.json || result.status !== 'success' ? result : markdown(result, name ?? opts.platform), opts);
}

export function registerAI(program: Command): void {
  const command = pollingOptions(requestOptions(program.command('ai [platform] [prompt]').enablePositionalOptions().description('Run an AI scraper; defaults to Markdown output')))
    .option('--no-wait', 'Return the task ID immediately')
    .option('--country <code>', 'Country (default US)')
    .option('--mode <mode>', 'Copilot or Grok mode')
    .option('--web-search <boolean>', 'Enable web search', boolean)
    .option('--shopping <boolean>', 'Fetch shopping data', boolean)
    .option('--should-fetch-share-link <boolean>', 'Fetch sharing link', boolean)
    .option('--location <name>', 'Google canonical location')
    .option('--uule <value>', 'Google UULE location')
    .option('--url <url>', 'Google AI Mode URL (used alone)')
    .option('--webhook <url>', 'Result webhook URL')
    .action(async (name, prompt, opts) => {
      if (!name) throw new Error(`Choose an AI platform: ${Object.keys(platforms).join(', ')}`);
      const spec = platform(name);
      const supplied = await body(opts.data);
      const input = merge({ country: 'US', mode: spec.mode }, supplied.input === undefined ? {} : object(supplied.input, 'input'), {
        prompt, country: opts.country, mode: opts.mode, web_search: opts.webSearch, shopping: opts.shopping,
        should_fetch_share_link: opts.shouldFetchShareLink, location: opts.location, uule: opts.uule, url: opts.url,
      });
      if (input.url !== undefined) {
        if (spec.actor !== 'scraper.aimode') throw new Error('--url is supported only by google-ai-mode.');
        url(input.url);
        for (const key of Object.keys(input)) if (key !== 'url') delete input[key];
      } else {
        if (typeof input.prompt !== 'string' || !input.prompt.trim()) throw new Error('A prompt is required.');
        if (input.location && input.uule) throw new Error('location and uule are mutually exclusive.');
        for (const key of Object.keys(input)) {
          if (!['prompt', 'country'].includes(key) && !spec.options.includes(key)) throw new Error(`${key} is not supported by ${name}.`);
        }
        if (spec.actor === 'scraper.copilot' && !['search', 'smart', 'chat', 'reasoning', 'study'].includes(String(input.mode))) throw new Error('Invalid Copilot mode.');
        if (spec.actor === 'scraper.grok' && !['MODEL_MODE_FAST', 'MODEL_MODE_EXPERT', 'MODEL_MODE_AUTO'].includes(String(input.mode))) throw new Error('Invalid Grok mode.');
      }
      // Replace input after merging: AI Mode URL requests must not retain prompt/country.
      const payload = { ...supplied, actor: spec.actor, input, ...(opts.webhook ? { webhook: { url: url(opts.webhook) } } : {}) };
      const timeout = milliseconds(opts.timeout), interval = milliseconds(opts.interval);
      const api = await client();
      const response = object(await api.request('/api/v2/scraper/request', payload));
      const created = isObject(response.data) ? response.data : response;
      const id = created.task_id ?? created.id;
      if (typeof id !== 'string' || !id) throw new Error('AI response is missing the task ID.');
      if (!opts.wait) { await output({ ...response, task_id: id }, opts); return; }
      console.error(`AI task: ${id}`);
      const { result, timedOut } = await poll(signal => api.request(`/api/v2/scraper/result/${encodeURIComponent(id)}`, undefined, signal), ['success', 'failed'], timeout, interval);
      await show({ ...result, task_id: id }, opts, name);
      if (timedOut) console.error(`Polling timed out. Continue with: scrapeless ai result ${id} --platform ${name} --wait`);
    });
  command.command('platforms').description('List supported AI platforms').action(() => output(platforms));
  pollingOptions(outputOptions(command.command('result <id>').description('Get an existing AI task')))
    .option('--platform <name>', 'Platform used to select its Markdown field')
    .option('--wait', 'Poll until success or failure')
    .action(async (id, opts) => {
      if (opts.platform) platform(opts.platform);
      const api = await client();
      const read = (signal?: AbortSignal) => api.request(`/api/v2/scraper/result/${encodeURIComponent(id)}`, undefined, signal);
      const { result, timedOut } = opts.wait ? await poll(read, ['success', 'failed'], milliseconds(opts.timeout), milliseconds(opts.interval)) : { result: object(await read()), timedOut: false };
      await show({ ...result, task_id: id }, opts);
      if (timedOut) console.error(`Polling timed out. Task ID: ${id}`);
    });
}

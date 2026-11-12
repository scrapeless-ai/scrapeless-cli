import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram } from '../src/program.js';
import { type JsonObject } from '../src/data.js';

let temporary: string, stdout: string, stderr: string;
let requests: { url: string; options?: RequestInit; body?: JsonObject }[];
let responses: { body: unknown; status?: number }[];
const originalEnv = { ...process.env };

beforeEach(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'scrapeless-test-'));
  process.env.SCRAPELESS_CONFIG_PATH = join(temporary, 'config.json');
  process.env.SCRAPELESS_API_KEY = 'test-key';
  delete process.env.SCRAPELESS_API_TOKEN;
  delete process.env.SCRAPELESS_API_BASE_URL;
  stdout = ''; stderr = ''; requests = []; responses = [];
  mock.method(process.stdout, 'write', (value: string) => { stdout += String(value); return true; });
  mock.method(process.stderr, 'write', (value: string) => { stderr += String(value); return true; });
  mock.method(globalThis, 'fetch', async (value: string, options?: RequestInit) => {
    requests.push({ url: String(value), options, body: options?.body ? JSON.parse(String(options.body)) : undefined });
    const response = responses.shift();
    if (!response) throw new Error('Unexpected HTTP request');
    return new Response(JSON.stringify(response.body), { status: response.status ?? 200 });
  });
});

afterEach(async () => {
  mock.restoreAll();
  process.env = { ...originalEnv };
  await rm(temporary, { recursive: true, force: true });
});

const run = (...args: string[]) => {
  const program = createProgram();
  // Commander copies exit handlers at command creation, so configure each child.
  const override = (command: typeof program) => {
    command.exitOverride();
    command.commands.forEach(override);
  };
  override(program);
  return program.parseAsync(args, { from: 'user' });
};

test('configuration aliases, permissions and masked list', async () => {
  await run('config', 'set', 'api_token', 'saved-key');
  assert.equal(JSON.parse(await readFile(process.env.SCRAPELESS_CONFIG_PATH!, 'utf8')).apiKey, 'saved-key');
  if (process.platform !== 'win32') assert.equal((await stat(process.env.SCRAPELESS_CONFIG_PATH!)).mode & 0o777, 0o600);
  await run('config', 'get', 'apiKey');
  assert.equal(stdout, 'saved-key\n');
  stdout = '';
  await run('config', 'list');
  assert.ok(!stdout.includes('saved-key'));
  await run('config', 'remove', 'apiKey');
  assert.deepEqual(JSON.parse(await readFile(process.env.SCRAPELESS_CONFIG_PATH!, 'utf8')), {});
});

test('unlock alias sends the documented request and outputs data only', async () => {
  responses.push({ body: { code: 200, data: '# Hello' } });
  await run('scrape', 'https://example.com', '--type', 'markdown', '--country', 'JP', '--js-render', 'false');
  const request = requests[0]!;
  assert.equal(request.url, 'https://api.scrapeless.com/api/v2/unlocker/request');
  assert.equal(new Headers(request.options?.headers).get('x-api-token'), 'test-key');
  assert.deepEqual(request.body?.proxy, { country: 'JP' });
  assert.equal((request.body?.input as JsonObject).url, 'https://example.com');
  assert.equal(((request.body?.input as JsonObject).jsRender as JsonObject).enabled, false);
  assert.equal(stdout, '# Hello\n');
});

test('request files preserve nested parameters and explicit flags win', async () => {
  const file = join(temporary, 'request.json');
  await writeFile(file, JSON.stringify({ input: { url: 'https://example.com', cookies: [{ name: 'a', value: 'b' }], jsRender: { response: { type: 'content', options: { outputs: ['links'] } } } }, proxy: { country: 'US' } }));
  responses.push({ body: { code: 200, data: 'result' } });
  await run('unlock', '--data', `@${file}`, '--country', 'GB', '--json');
  assert.deepEqual(requests[0]!.body?.proxy, { country: 'GB' });
  assert.deepEqual((requests[0]!.body?.input as JsonObject).cookies, [{ name: 'a', value: 'b' }]);
  assert.deepEqual(JSON.parse(stdout), { code: 200, data: 'result' });
});

test('crawl polls to completion and maps API acronym fields correctly', async () => {
  responses.push({ body: { success: true, id: 'crawl-id' } }, { body: { status: 'scraping', completed: 1 } }, { body: { status: 'completed', data: [{ markdown: '# page' }] } });
  await run('crawl', 'https://example.com', '--interval', '0.001', '--max-depth', '2', '--deduplicate-similar-urls', 'false', '--regex-on-full-url', 'true', '--formats', 'markdown,html');
  assert.equal(requests[0]!.body?.deduplicateSimilarURLs, false);
  assert.equal(requests[0]!.body?.regexOnFullURL, true);
  assert.deepEqual(requests[0]!.body?.scrapeOptions, { formats: ['markdown', 'html'] });
  assert.equal(requests[2]!.url, 'https://api.scrapeless.com/api/v2/crawler/crawl/crawl-id');
  assert.equal(JSON.parse(stdout).id, 'crawl-id');
  assert.equal(JSON.parse(stdout).status, 'completed');
});

test('crawl timeout returns latest response and a resumable task ID', async () => {
  responses.push({ body: { id: 'later', success: true } }, { body: { status: 'scraping', completed: 7 } });
  await run('crawl', 'https://example.com', '--timeout', '0.02', '--interval', '1');
  assert.equal(JSON.parse(stdout).completed, 7);
  assert.equal(JSON.parse(stdout).id, 'later');
  assert.match(stderr, /scrapeless crawl result later --wait/);
});

test('crawl result retrieves existing task without creating another', async () => {
  responses.push({ body: { status: 'completed', data: [] } });
  await run('crawl', 'result', 'id/with?chars');
  assert.equal(requests[0]!.options?.method, 'GET');
  assert.match(requests[0]!.url, /id%2Fwith%3Fchars$/);
});

test('crawl no-wait creates just one task', async () => {
  responses.push({ body: { id: 'background', success: true } });
  await run('crawl', 'https://example.com', '--no-wait');
  assert.equal(requests.length, 1);
  assert.equal(JSON.parse(stdout).id, 'background');
});

for (const [name, actor, field] of [
  ['chatgpt', 'chatgpt', 'result_text'], ['gemini', 'gemini', 'result_text'], ['copilot', 'copilot', 'result_text'],
  ['perplexity', 'perplexity', 'result_text'], ['grok', 'grok', 'full_response'], ['alexa', 'alexa', 'md_text'],
  ['google-ai-mode', 'aimode', 'result_md'], ['google-ai-overview', 'overview', 'content'],
] as const) {
  test(`${name} maps actor, defaults and Markdown field`, async () => {
    responses.push({ body: { task_id: 'ai-id' } }, { body: { status: 'running' } }, { body: { status: 'success', task_result: { [field]: '# answer' } } });
    await run('ai', name, 'a prompt', '--interval', '0.001');
    assert.equal(requests[0]!.body?.actor, `scraper.${actor}`);
    const input = requests[0]!.body?.input as JsonObject;
    assert.equal(input.country, 'US');
    assert.equal(input.prompt, 'a prompt');
    if (name === 'copilot') assert.equal(input.mode, 'search');
    if (name === 'grok') assert.equal(input.mode, 'MODEL_MODE_AUTO');
    assert.equal(stdout, '# answer\n');
  });
}

test('AI Mode URL excludes all other input parameters', async () => {
  responses.push({ body: { task_id: 'url-task' } });
  await run('ai', 'google-ai-mode', '--url', 'https://google.com/search?q=test', '--no-wait');
  assert.deepEqual(requests[0]!.body?.input, { url: 'https://google.com/search?q=test' });
});

test('AI flags map snake_case, false, mode and webhook', async () => {
  responses.push({ body: { data: { task_id: 'test' } } });
  await run('ai', 'chatgpt', 'hello', '--web-search', 'false', '--shopping', 'false', '--should-fetch-share-link', 'true', '--webhook', 'https://example.com/hook', '--no-wait');
  assert.deepEqual(requests[0]!.body, { actor: 'scraper.chatgpt', input: { country: 'US', prompt: 'hello', web_search: false, shopping: false, should_fetch_share_link: true }, webhook: { url: 'https://example.com/hook' } });
});

test('AI failure reports reason; timeout exposes task ID and latest response', async () => {
  responses.push({ body: { status: 'failed', message: 'Provider unavailable' } });
  await assert.rejects(run('ai', 'result', 'failed'), /Provider unavailable/);
  responses.push({ body: { task_id: 'later' } }, { body: { status: 'pending' } });
  await run('ai', 'alexa', 'hello', '--timeout', '0.02', '--interval', '1');
  assert.equal(JSON.parse(stdout).task_id, 'later');
  assert.match(stderr, /scrapeless ai result later/);
});

test('AI empty overview is valid and JSON result output preserves metadata', async () => {
  responses.push({ body: { status: 'success', task_result: { content: '' } } });
  await run('ai', 'result', 'empty', '--platform', 'google-ai-overview');
  assert.equal(stdout, '\n');
  stdout = '';
  responses.push({ body: { status: 'success', task_result: { result_text: 'body', citations: [1] } } });
  await run('ai', 'result', 'full', '--json');
  assert.deepEqual(JSON.parse(stdout).task_result.citations, [1]);
});

test('auth summarizes account and uses persisted token ahead of environment', async () => {
  await run('config', 'set', 'apiKey', 'saved-key');
  responses.push({ body: { credits: '42', excessCredits: '3', status: 1, userId: 'private-id', plan: { status: 1, credits: '10', endAt: '2027-01-01' } } });
  await run('auth', 'status');
  assert.match(stdout, /Balance: 42/);
  assert.ok(!stdout.includes('private-id'));
  assert.equal(new Headers(requests[0]!.options?.headers).get('x-api-token'), 'saved-key');
});

test('proxy creates regional URL with encoded credentials without an HTTP request', async () => {
  process.env.SCRAPELESS_API_KEY = 'key:p@ss';
  await run('proxy', 'create', '--gateway', 'ap', '--country', 'US', '--state', 'AL', '--city', 'foley', '--session-id', 'sid');
  assert.equal(stdout, 'http://CHANNEL-proxy.residential-country_US-state_AL-city_foley-r_10m-s_sid:key%3Ap%40ss@gw-ap.scrapeless.io:8789\n');
  assert.equal(requests.length, 0);
});

test('malformed input is rejected before HTTP', async () => {
  for (const args of [
    ['unlock', 'ftp://example.com'], ['unlock', '--data', '[]'],
    ['crawl', 'https://example.com', '--limit', '-1'],
    ['ai', 'unknown', 'prompt'], ['ai', 'chatgpt'],
    ['ai', 'google-ai-mode', 'test', '--location', 'NY', '--uule', 'abc'],
    ['ai', 'gemini', 'prompt', '--web-search', 'true'],
    ['proxy', 'create', '--session-duration', '0'],
    ['api', 'google'],
  ]) await assert.rejects(run(...args));
  assert.equal(requests.length, 0);
});

test('HTTP errors do not expose the token or retry task creation', async () => {
  responses.push({ body: { message: 'Invalid token test-key' }, status: 401 });
  await assert.rejects(run('unlock', 'https://example.com'), error => {
    assert.match((error as Error).message, /401/);
    assert.ok(!(error as Error).message.includes('test-key'));
    return true;
  });
  assert.equal(requests.length, 1);
});

test('file output contains data and stdout remains clean', async () => {
  responses.push({ body: { data: '# document' } });
  const file = join(temporary, 'page.md');
  await run('unlock', 'https://example.com', '--output', file);
  assert.equal(await readFile(file, 'utf8'), '# document\n');
  assert.equal(stdout, '');
});

test('Scraping API immediate result preserves full JSON and maps all Google fields', async () => {
  const result = { organic_results: [{ title: 'Coffee' }], metadata: { id: 'search' }, data: { untouched: true } };
  responses.push({ body: result });
  await run('scraping-api', 'google-search', '--q', 'coffee', '--location', 'Seattle',
    '--ludocid', '12345678901234567890', '--lsig', 'ls', '--kgmid', '/m/1', '--si', 'cached',
    '--ibp', 'gwp;0,7', '--uds', 'filter-string', '--google-domain', 'google.co.uk',
    '--gl', 'uk', '--hl', 'en', '--cr', 'countryFR|countryDE', '--lr', 'lang_fr|lang_de',
    '--tbs', 'qdr:d', '--safe', 'active', '--nfpr', '1', '--filter', '0', '--tbm', 'nws',
    '--start', '10', '--device', 'desktop', '--country', 'US');
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, 'https://api.scrapeless.com/api/v1/scraper/request');
  assert.equal(new Headers(requests[0]!.options?.headers).get('x-api-token'), 'test-key');
  assert.deepEqual(requests[0]!.body, {
    actor: 'scraper.google.search', proxy: { country: 'US' }, input: {
      q: 'coffee', location: 'Seattle', ludocid: '12345678901234567890', lsig: 'ls', kgmid: '/m/1', si: 'cached',
      ibp: 'gwp;0,7', uds: 'filter-string', google_domain: 'google.co.uk', gl: 'uk', hl: 'en',
      cr: 'countryFR|countryDE', lr: 'lang_fr|lang_de', tbs: 'qdr:d', safe: 'active', nfpr: 1, filter: 0,
      tbm: 'nws', start: 10, device: 'desktop',
    },
  });
  assert.deepEqual(JSON.parse(stdout), result);
});

test('Scraping API alias, request file, overrides, proxy precedence and file output', async () => {
  const file = join(temporary, 'search.json'), out = join(temporary, 'result.json');
  await writeFile(file, JSON.stringify({ actor: 'ignored', input: { q: 'old', uule: 'encoded', as_eq: 'ads', num: 20 }, proxy: { country: 'US' } }));
  responses.push({ body: { organic_results: [] } });
  await run('api', 'google-search', '--data', `@${file}`, '--q', 'new', '--proxy-url', 'http://user:pass@proxy:8080', '--json', '-o', out);
  assert.deepEqual(requests[0]!.body, { actor: 'scraper.google.search', input: { q: 'new', uule: 'encoded', as_eq: 'ads', num: 20 }, proxy: { url: 'http://user:pass@proxy:8080' } });
  assert.deepEqual(JSON.parse(await readFile(out, 'utf8')), { organic_results: [] });
  assert.equal(stdout, '');
});

test('Scraping API polls only GET after 201 and preserves the original task ID', async () => {
  responses.push({ status: 201, body: { taskId: 'id/with?chars' } }, { status: 201, body: {} }, { body: { organic_results: [1] } });
  await run('api', 'google-search', '--q', 'coffee', '--interval', '0.001');
  assert.deepEqual(requests.map(r => r.options?.method), ['POST', 'GET', 'GET']);
  assert.equal(requests[1]!.url, 'https://api.scrapeless.com/api/v1/scraper/result/id%2Fwith%3Fchars');
  assert.equal(requests[2]!.url, requests[1]!.url);
  assert.deepEqual(JSON.parse(stdout), { organic_results: [1] });
  assert.match(stderr, /Scraping API task/);
});

test('Scraping API result resumes without submitting; JSON primitives remain JSON', async () => {
  responses.push({ status: 201, body: { taskId: 'existing' } }, { body: 'result' });
  await run('scraping-api', 'result', 'existing', '--interval', '0.001');
  assert.ok(requests.every(r => r.options?.method === 'GET'));
  assert.equal(stdout, '"result"\n');
});

test('Scraping API validates flags and request-body values before making requests', async () => {
  for (const input of [ {}, { q: ' ' }, { q: 1 }, { q: 'x', location: 'a', uule: 'b' },
    { q: 'x', start: -1 }, { q: 'x', start: 1.2 }, { q: 'x', filter: 2 },
    { q: 'x', nfpr: true }, { q: 'x', safe: 'invalid' }, { q: 'x', device: 'mobile' },
    { q: 'x', tbm: 'lcl', start: 10 },
  ]) {
    await assert.rejects(run('api', 'google-search', '--data', JSON.stringify({ input })));
  }
  for (const proxy of ['US', [], null, { country: 1 }, { url: false }]) {
    await assert.rejects(run('api', 'google-search', '--q', 'x', '--data', JSON.stringify({ proxy })));
  }
  await assert.rejects(run('api', 'google-search', '--q', 'x', '--location', 'a', '--uule', 'b'), /mutually exclusive/);
  assert.equal(requests.length, 0);
});

test('Scraping API 4xx and 5xx failures preserve full error JSON without retries', async () => {
  for (const status of [400, 401, 429, 500]) {
    for (const polling of [false, true]) {
      const error = { message: 'denied', details: { reason: 'quota' }, code: 'EXAMPLE' };
      if (polling) responses.push({ status: 201, body: { taskId: 'failed' } });
      responses.push({ status, body: error });
      const before = requests.length;
      await assert.rejects(run('api', 'google-search', '--q', 'x'), e => {
        assert.equal((e as Error).message, `HTTP ${status}: ${JSON.stringify(error)}`);
        return true;
      });
      assert.equal(requests.length - before, polling ? 2 : 1);
    }
  }
  assert.equal(stdout, '');
});

test('Scraping API rejects missing task IDs and unexpected success statuses', async () => {
  responses.push({ status: 201, body: { unexpected: 'value' } });
  await assert.rejects(run('api', 'google-search', '--q', 'x'), /missing taskId/);
  responses.push({ status: 202, body: { pending: true } });
  await assert.rejects(run('api', 'google-search', '--q', 'x'), /Unexpected HTTP 202/);
  assert.equal(stdout, '');
});

test('Scraping API timeout fails with a resumable ID and does not output pending data as success', async () => {
  responses.push({ status: 201, body: { taskId: 'later' } }, { status: 201, body: { progress: 3 } });
  await assert.rejects(run('api', 'google-search', '--q', 'x', '--timeout', '0.02', '--interval', '1'), /timed out.*later.*progress.*scrapeless scraping-api result later/);
  assert.equal(stdout, '');
  assert.equal(requests.length, 2);
});

import { Command } from 'commander';
import { body, boolean, csv, integer, json, merge, numeric, object, url } from './data.js';
import { client } from './http.js';
import { output } from './output.js';
import { milliseconds, outputOptions, pollingOptions, requestOptions } from './options.js';
import { poll } from './poll.js';

export function registerCrawl(program: Command): void {
  const command = pollingOptions(requestOptions(program.command('crawl [url]').enablePositionalOptions().description('Create a crawl and wait for results')))
    .option('--no-wait', 'Return the task ID immediately')
    .option('--limit <number>', 'Maximum pages', integer)
    .option('--max-depth <number>', 'Maximum URL depth', integer)
    .option('--max-discovery-depth <number>', 'Maximum discovery depth', integer)
    .option('--include-paths <patterns>', 'Included paths, comma separated', csv)
    .option('--exclude-paths <patterns>', 'Excluded paths, comma separated', csv)
    .option('--delay <seconds>', 'Delay between scrapes', numeric)
    .option('--scrape-options <json>', 'Full scrape options object', json)
    .option('--browser-options <json>', 'Full browser options object', json)
    .option('--formats <formats>', 'markdown,html,json,links,rawHtml,screenshot,screenshot@fullPage', csv)
    .option('--only-main-content <boolean>', 'Extract only main content', boolean)
    .option('--include-tags <tags>', 'HTML tags to include', csv)
    .option('--exclude-tags <tags>', 'HTML tags to exclude', csv)
    .option('--headers <json>', 'Target page HTTP headers', json)
    .option('--wait-for <ms>', 'Wait before scraping', integer)
    .option('--scrape-timeout <ms>', 'Per-page scrape timeout', integer);
  for (const flag of ['ignore-sitemap', 'ignore-query-parameters', 'deduplicate-similar-urls', 'regex-on-full-url', 'allow-backward-links', 'allow-external-links']) {
    command.option(`--${flag} <boolean>`, flag.replaceAll('-', ' '), boolean);
  }
  command.action(async (target, opts) => {
    const payload = merge(await body(opts.data), {
      url: target, limit: opts.limit, maxDepth: opts.maxDepth, maxDiscoveryDepth: opts.maxDiscoveryDepth,
      includePaths: opts.includePaths, excludePaths: opts.excludePaths, delay: opts.delay,
      ignoreSitemap: opts.ignoreSitemap, ignoreQueryParameters: opts.ignoreQueryParameters,
      deduplicateSimilarURLs: opts.deduplicateSimilarUrls, regexOnFullURL: opts.regexOnFullUrl,
      allowBackwardLinks: opts.allowBackwardLinks, allowExternalLinks: opts.allowExternalLinks,
      browserOptions: opts.browserOptions === undefined ? undefined : object(opts.browserOptions),
      scrapeOptions: merge(opts.scrapeOptions === undefined ? {} : object(opts.scrapeOptions), {
        formats: opts.formats, onlyMainContent: opts.onlyMainContent, includeTags: opts.includeTags,
        excludeTags: opts.excludeTags, headers: opts.headers, waitFor: opts.waitFor, timeout: opts.scrapeTimeout,
      }),
    });
    url(payload.url);
    const timeout = milliseconds(opts.timeout), interval = milliseconds(opts.interval);
    const api = await client();
    const created = object(await api.request('/api/v2/crawler/crawl', payload));
    if (typeof created.id !== 'string' || !created.id) throw new Error('Crawl response is missing the task ID.');
    if (!opts.wait) { await output(created, opts); return; }
    console.error(`Crawl task: ${created.id}`);
    const { result, timedOut } = await poll(signal => api.request(`/api/v2/crawler/crawl/${encodeURIComponent(created.id as string)}`, undefined, signal), ['completed', 'failed'], timeout, interval);
    await output({ ...result, id: created.id }, opts);
    if (timedOut) console.error(`Polling timed out. Continue with: scrapeless crawl result ${created.id} --wait`);
    if (result.status === 'failed') throw new Error(`Crawl ${created.id} failed: ${result.message ?? result.error ?? 'See the task result.'}`);
  });
  pollingOptions(outputOptions(command.command('result <id>').description('Get the result of an existing crawl')))
    .option('--wait', 'Poll until completed or failed')
    .action(async (id, opts) => {
      const api = await client();
      const read = (signal?: AbortSignal) => api.request(`/api/v2/crawler/crawl/${encodeURIComponent(id)}`, undefined, signal);
      const { result, timedOut } = opts.wait
        ? await poll(read, ['completed', 'failed'], milliseconds(opts.timeout), milliseconds(opts.interval))
        : { result: object(await read()), timedOut: false };
      await output({ ...result, id }, opts);
      if (timedOut) console.error(`Polling timed out. Task ID: ${id}`);
      if (result.status === 'failed') throw new Error(`Crawl ${id} failed: ${result.message ?? result.error ?? 'See the task result.'}`);
    });
}

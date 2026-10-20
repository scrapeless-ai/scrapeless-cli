import { Command, Option } from 'commander';
import { body, boolean, csv, json, merge, object, url } from './data.js';
import { client } from './http.js';
import { output } from './output.js';
import { requestOptions } from './options.js';

export function registerUnlock(program: Command): void {
  requestOptions(program.command('unlock [url]').alias('scrape').description('Extract a page using Web Unlocker'))
    .option('--country <code>', 'Proxy country (default ANY)')
    .option('--proxy-url <url>', 'Custom proxy URL')
    .option('--method <method>', 'Target HTTP method')
    .option('--redirect <boolean>', 'Follow redirects', boolean)
    .option('--js-render <boolean>', 'Enable JavaScript rendering (default true)', boolean)
    .option('--headless <boolean>', 'Use headless rendering', boolean)
    .addOption(new Option('--wait-until <event>', 'Navigation completion event').choices(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']))
    .addOption(new Option('--type <type>', 'Response format (default html)').choices(['html', 'plaintext', 'markdown', 'png', 'jpeg', 'network', 'content']))
    .option('--selector <css>', 'Response CSS selector')
    .option('--outputs <names>', 'Content filters, comma separated', csv)
    .option('--full-page <boolean>', 'Full-page screenshot', boolean)
    .option('--response-options <json>', 'Additional response options: methods, status, urls', json)
    .option('--instructions <json>', 'JavaScript interaction instruction array', json)
    .option('--cookies <json>', 'Cookie array', json)
    .option('--block-resources <types>', 'Resource types to block, comma separated', csv)
    .option('--block-urls <urls>', 'URLs to block, comma separated', csv)
    .action(async (target, opts) => {
      const payload = merge(
        { actor: 'unlocker.webunlocker', proxy: { country: 'ANY' }, input: { jsRender: { enabled: true, response: { type: 'html' } } } },
        await body(opts.data),
        { actor: 'unlocker.webunlocker', proxy: { country: opts.country, url: opts.proxyUrl }, input: {
          url: target, method: opts.method, redirect: opts.redirect, cookies: opts.cookies,
          jsRender: { enabled: opts.jsRender, headless: opts.headless, waitUntil: opts.waitUntil, instructions: opts.instructions,
            block: { resources: opts.blockResources, urls: opts.blockUrls },
            response: { type: opts.type, options: merge(opts.responseOptions === undefined ? {} : object(opts.responseOptions), {
              selector: opts.selector, outputs: opts.outputs, fullPage: opts.fullPage,
            }) },
          },
        } },
      );
      url(object(payload.input).url);
      const result = object(await (await client()).request('/api/v2/unlocker/request', payload));
      await output(opts.json ? result : result.data, opts);
    });
}

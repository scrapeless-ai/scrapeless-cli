import { Command } from 'commander';
import { body, integer, merge, object, type JsonObject } from './data.js';
import { client } from './http.js';
import { milliseconds, outputOptions, pollingOptions, requestOptions } from './options.js';
import { output } from './output.js';
import { runScrapingApi, scrapingResult } from './scraping-api/client.js';
import { scrapingApis, validateInput } from './scraping-api/definitions.js';

export function registerScrapingApi(program: Command): void {
  const root = program.command('scraping-api').alias('api').description('Structured scraping APIs').enablePositionalOptions();
  for (const spec of scrapingApis) {
    const command = pollingOptions(requestOptions(root.command(spec.name).description(spec.description)))
      .option('--country <code>', 'Proxy country code')
      .option('--proxy-url <url>', 'Custom proxy URL (takes precedence over country)');
    for (const field of spec.fields) {
      const flag = `--${field.name.replaceAll('_', '-')} <value>`;
      if (field.type === 'integer') command.option(flag, field.description, integer);
      else command.option(flag, field.description);
    }
    command.action(async opts => {
      const supplied = await body(opts.data);
      const overrides: JsonObject = {};
      for (const field of spec.fields) {
        const key = field.name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
        overrides[field.name] = opts[key];
      }
      const input = merge(supplied.input === undefined ? {} : object(supplied.input, 'input'), overrides);
      validateInput(spec, input);
      const proxy = merge(supplied.proxy === undefined ? {} : object(supplied.proxy, 'proxy'), { country: opts.country, url: opts.proxyUrl });
      for (const key of ['country', 'url']) {
        if (proxy[key] !== undefined && typeof proxy[key] !== 'string') throw new Error(`proxy.${key} must be a string.`);
      }
      if (typeof proxy.url === 'string' && proxy.url.trim()) delete proxy.country;
      const payload = { ...supplied, actor: spec.actor, input, ...(Object.keys(proxy).length ? { proxy } : {}) };
      const timing = { timeout: milliseconds(opts.timeout), interval: milliseconds(opts.interval) };
      await output(await runScrapingApi(await client(), payload, timing), { ...opts, json: true });
    });
  }
  pollingOptions(outputOptions(root.command('result <id>').description('Resume polling an existing Scraping API task')))
    .action(async (id, opts) => {
      const timing = { timeout: milliseconds(opts.timeout), interval: milliseconds(opts.interval) };
      await output(await scrapingResult(await client(), id, timing), { ...opts, json: true });
    });
}

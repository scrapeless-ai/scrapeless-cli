import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { registerAI } from './ai.js';
import { registerCommon } from './common.js';
import { registerCrawl } from './crawl.js';
import { registerProxy } from './proxy.js';
import { registerUnlock } from './unlock.js';
import { registerScrapingApi } from './scraping-api.js';

export function createProgram(): Command {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  const program = new Command().name('scrapeless').description('Scrapeless unified CLI').version(pkg.version).enablePositionalOptions().showHelpAfterError();
  registerCommon(program);
  registerUnlock(program);
  registerCrawl(program);
  registerAI(program);
  registerProxy(program);
  program.command('browser [args...]').description('Forward all arguments to the automatically installed Scrapeless browser');
  registerScrapingApi(program);
  return program;
}

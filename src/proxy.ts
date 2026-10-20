import { randomUUID } from 'node:crypto';
import { Command, Option } from 'commander';
import { apiToken } from './config.js';
import { integer } from './data.js';
import { output } from './output.js';
import { outputOptions } from './options.js';

export const gateways: Record<string, string> = { us: 'gw-us.scrapeless.io:8789', eu: 'gw-eu.scrapeless.io:8789', ap: 'gw-ap.scrapeless.io:8789' };

export interface ProxyOptions {
  type: string; country: string; state?: string; city?: string;
  sessionDuration: number; sessionId: string; gateway: string;
}

export function proxyUrl(options: ProxyOptions, token: string): string {
  if (!['residential', 'ipv6', 'datacenter'].includes(options.type)) throw new Error('Invalid proxy type.');
  if (!Number.isSafeInteger(options.sessionDuration) || options.sessionDuration < 1) throw new Error('Session duration must be a positive integer.');
  for (const part of [options.country, options.state, options.city, options.sessionId]) {
    if (part !== undefined && !/^[a-zA-Z0-9]+$/.test(part)) throw new Error('Proxy country, state, city and session ID must contain only letters and digits.');
  }
  const gateway = gateways[options.gateway] ?? options.gateway;
  if (!/^[a-zA-Z0-9.-]+:\d+$/.test(gateway)) throw new Error('Gateway must be a region (us/eu/ap) or hostname:port.');
  const port = Number(gateway.split(':')[1]);
  if (port < 1 || port > 65535) throw new Error('Invalid gateway port.');
  let username = `CHANNEL-proxy.${options.type}-country_${options.country}`;
  if (options.state) username += `-state_${options.state}`;
  if (options.city) username += `-city_${options.city}`;
  username += `-r_${options.sessionDuration}m-s_${options.sessionId}`;
  return `http://${username}:${encodeURIComponent(token)}@${gateway}`;
}

export function registerProxy(program: Command): void {
  const command = program.command('proxy').description('Generate authenticated proxy URLs');
  command.command('gateways').description('List regional gateways').action(() => output(gateways));
  outputOptions(command.command('create').description('Create a proxy URL locally'))
    .addOption(new Option('--type <type>', 'Proxy type').choices(['residential', 'ipv6', 'datacenter']).default('residential'))
    .option('--country <code>', 'Country', 'US').option('--state <state>', 'State').option('--city <city>', 'City')
    .option('--session-duration <minutes>', 'Session duration', integer, 10)
    .option('--session-id <id>', 'Session ID (default random)')
    .option('--gateway <region|host:port>', 'Regional or custom gateway', 'us')
    .action(async opts => {
      const value = proxyUrl({ ...opts, sessionId: opts.sessionId ?? randomUUID().replaceAll('-', '') }, (await apiToken())!);
      await output(opts.json ? { url: value } : value, opts);
    });
}

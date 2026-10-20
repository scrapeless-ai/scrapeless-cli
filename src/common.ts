import { Command } from 'commander';
import { apiToken, configKey, configPath, readConfig, redact, updateConfig } from './config.js';
import { isObject, object } from './data.js';
import { client } from './http.js';
import { output } from './output.js';
import { outputOptions } from './options.js';

export function registerCommon(program: Command): void {
  const config = program.command('config').description('Manage ~/.scrapeless/config.json');
  config.command('set <key> <value>').description('Set a value; api_token and apiKey are aliases').action(async (key, value) => {
    if (!value.trim()) throw new Error('Configuration value must not be empty.');
    await updateConfig(key, value);
    console.error(`Saved ${configKey(key)} to ${configPath()}`);
  });
  config.command('get <key>').description('Get a stored value (API token is shown in full)').action(async key => {
    const normalized = configKey(key);
    const value = normalized === 'apiKey' ? await apiToken(false) : (await readConfig())[normalized];
    if (value === undefined) throw new Error(`Configuration key not set: ${key}`);
    await output(value);
  });
  config.command('list').description('List configuration with secrets masked').action(async () => output(redact(await readConfig())));
  config.command('remove <key>').alias('unset').description('Remove a stored value').action(async key => updateConfig(key));
  config.command('path').description('Show configuration file path').action(() => output(configPath()));
  const auth = program.command('auth').description('Inspect account authentication');
  outputOptions(auth.command('status').description('Show account balance, status and subscription'))
    .action(async opts => {
      const response = object(await (await client()).request('/api/v1/me'));
      const me = isObject(response.data) ? response.data : response;
      if (opts.json) { await output(me, opts); return; }
      const plan = isObject(me.plan) ? me.plan : {};
      await output([
        `Account status: ${me.status === 1 ? 'active' : me.status ?? 'unknown'}`,
        `Balance: ${me.credits ?? 'unknown'}`,
        `Remaining credits: ${me.excessCredits ?? 'unknown'}`,
        `Plan status: ${plan.status ?? 'none'}`,
        `Plan balance: ${plan.credits ?? 'unknown'}`,
        `Plan price: ${plan.price ?? 'unknown'}`,
        `Plan usage: ${plan.usage ?? 'unknown'}`,
        `Plan expires: ${plan.endAt ?? 'unknown'}`,
      ].join('\n'), opts);
    });
}

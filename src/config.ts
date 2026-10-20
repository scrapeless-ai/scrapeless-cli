import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { object, type JsonObject } from './data.js';

export function configPath(): string {
  return process.env.SCRAPELESS_CONFIG_PATH || join(homedir(), '.scrapeless', 'config.json');
}

export function configKey(key: string): string {
  if (['api_token', 'apiToken', 'api_key', 'apiKey'].includes(key)) return 'apiKey';
  if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid configuration key.');
  return key;
}

export async function readConfig(path = configPath()): Promise<JsonObject> {
  try { return object(JSON.parse(await readFile(path, 'utf8')), 'Configuration'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Cannot read configuration at ${path}: ${(error as Error).message}`);
  }
}

export async function updateConfig(key: string, value?: string, path = configPath()): Promise<void> {
  const config = await readConfig(path);
  key = configKey(key);
  if (value === undefined) delete config[key]; else config[key] = value;
  if (key === 'apiKey') for (const alias of ['api_token', 'apiToken', 'api_key']) delete config[alias];
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
    if (process.platform !== 'win32') await chmod(path, 0o600);
  } finally { await rm(temporary, { force: true }); }
}

export async function apiToken(required = true): Promise<string | undefined> {
  const config = await readConfig();
  const token = config.apiKey ?? config.api_token ?? process.env.SCRAPELESS_API_TOKEN ?? process.env.SCRAPELESS_API_KEY;
  if (typeof token === 'string' && token.trim()) return token;
  if (required) throw new Error('Missing API token. Run scrapeless config set api_token <token> or set SCRAPELESS_API_KEY.');
  return undefined;
}

export function redact(config: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(config).map(([key, value]) => [key,
    /token|key|password|secret/i.test(key) ? '********' : value]));
}

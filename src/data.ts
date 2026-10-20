import { readFile } from 'node:fs/promises';

export type JsonObject = Record<string, unknown>;

export function object(value: unknown, label = 'Value'): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonObject;
}

export function merge(...values: JsonObject[]): JsonObject {
  const result: JsonObject = {};
  for (const value of values) {
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`Invalid key: ${key}`);
      if (item === undefined) continue;
      result[key] = item && typeof item === 'object' && !Array.isArray(item)
        ? merge(isObject(result[key]) ? result[key] : {}, object(item)) : item;
    }
  }
  return result;
}

export function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function json(value: string): unknown {
  try { return JSON.parse(value); } catch { throw new Error('Invalid JSON. Use a quoted JSON value or --data @file.json.'); }
}

export async function body(value?: string): Promise<JsonObject> {
  if (!value) return {};
  const text = value.startsWith('@') ? await readFile(value.slice(1), 'utf8') : value;
  return object(json(text), 'Request body');
}

export function boolean(value: string | boolean): boolean {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error('Expected true or false.');
}

export function numeric(value: string): number {
  const n = Number(value);
  if (!value.trim() || !Number.isFinite(n) || n < 0) throw new Error('Expected a non-negative number.');
  return n;
}

export function positive(value: string): number {
  const n = numeric(value);
  if (n === 0) throw new Error('Expected a positive number.');
  return n;
}

export function integer(value: string): number {
  const n = numeric(value);
  if (!Number.isSafeInteger(n)) throw new Error('Expected a non-negative integer.');
  return n;
}

export function csv(value: string): string[] { return value.split(',').map(s => s.trim()).filter(Boolean); }

export function url(value: unknown): string {
  if (typeof value !== 'string') throw new Error('An HTTP(S) URL is required.');
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch { throw new Error(`Invalid HTTP(S) URL: ${value}`); }
  return value;
}

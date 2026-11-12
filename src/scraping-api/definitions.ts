import { type JsonObject } from '../data.js';

export interface InputField {
  name: string;
  description: string;
  type?: 'integer';
  required?: boolean;
  choices?: readonly (string | number)[];
}

export interface ScrapingApiDefinition {
  name: string;
  actor: string;
  description: string;
  fields: readonly InputField[];
  validate?: (input: JsonObject) => void;
}

// New APIs only need a definition; transport, proxy, output and polling are shared.
export const scrapingApis: readonly ScrapingApiDefinition[] = [{
  name: 'google-search',
  actor: 'scraper.google.search',
  description: 'Get structured Google Search results',
  fields: [
    { name: 'q', description: 'Google search query', required: true },
    { name: 'location', description: 'Canonical search location (prefer a city)' },
    { name: 'uule', description: 'Google encoded location' },
    { name: 'ludocid', description: 'Google My Business listing CID' },
    { name: 'lsig', description: 'ID to force the knowledge graph map view' },
    { name: 'kgmid', description: 'Google Knowledge Graph ID' },
    { name: 'si', description: 'Cached Google search parameters' },
    { name: 'ibp', description: 'Google layout and expansion parameters' },
    { name: 'uds', description: 'Google search filter string' },
    { name: 'google_domain', description: 'Google domain (server default: google.com)' },
    { name: 'gl', description: 'Search country code, e.g. us' },
    { name: 'hl', description: 'Search language code, e.g. en' },
    { name: 'cr', description: 'Country restriction, e.g. countryFR|countryDE' },
    { name: 'lr', description: 'Language restriction, e.g. lang_fr|lang_de' },
    { name: 'tbs', description: 'Advanced search parameters' },
    { name: 'safe', description: 'Adult content filtering', choices: ['active', 'off'] },
    { name: 'nfpr', description: 'Exclude auto-corrected results (0 or 1)', type: 'integer', choices: [0, 1] },
    { name: 'filter', description: 'Filter similar and omitted results (0 or 1)', type: 'integer', choices: [0, 1] },
    { name: 'tbm', description: 'Search type, e.g. isch, lcl, vid, nws, shop, pts' },
    { name: 'start', description: 'Result offset (non-negative integer)', type: 'integer' },
    { name: 'device', description: 'Device (desktop only)', choices: ['desktop'] },
  ],
  validate(input) {
    if (input.location !== undefined && input.uule !== undefined) throw new Error('location and uule are mutually exclusive.');
    if (input.tbm === 'lcl' && input.start !== undefined && Number(input.start) % 20 !== 0) {
      throw new Error('Google Local start must be a multiple of 20.');
    }
  },
}];

export function validateInput(spec: ScrapingApiDefinition, input: JsonObject): void {
  for (const field of spec.fields) {
    const value = input[field.name];
    if (value === undefined && !field.required) continue;
    if (field.type === 'integer') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${field.name} must be a non-negative integer.`);
    } else if (typeof value !== 'string' || (field.required && !value.trim())) {
      throw new Error(`${field.name} must be ${field.required ? 'a non-empty' : 'a'} string.`);
    }
    if (field.choices && !field.choices.includes(value as string | number)) throw new Error(`${field.name} must be one of: ${field.choices.join(', ')}.`);
  }
  // Preserve additional API input fields supplied via --data for advanced queries.
  spec.validate?.(input);
}

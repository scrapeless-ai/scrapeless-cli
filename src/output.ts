import { writeFile } from 'node:fs/promises';

export interface OutputOptions { json?: boolean; output?: string }

export async function output(value: unknown, options: OutputOptions = {}): Promise<void> {
  const text = typeof value === 'string' && !options.json ? value : JSON.stringify(value, null, 2);
  if (text === undefined) throw new Error('No result returned.');
  const content = text.endsWith('\n') ? text : `${text}\n`;
  if (options.output) await writeFile(options.output, content, { mode: 0o600 });
  else process.stdout.write(content);
}

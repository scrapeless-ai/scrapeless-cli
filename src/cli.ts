#!/usr/bin/env node
import { runBrowser } from './browser.js';
import { createProgram } from './program.js';

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

try {
  const args = process.argv.slice(2);
  // Intercept before parsing: even --help, --version and -- must reach upstream unchanged.
  if (args[0] === 'browser') process.exitCode = await runBrowser(args.slice(1));
  else await createProgram().parseAsync(process.argv);
} catch (error) {
  console.error(`Error: ${(error as Error).message}`);
  process.exitCode = 1;
}

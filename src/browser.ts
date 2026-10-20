import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { apiToken } from './config.js';

// Repository name differs from the npm package/bin name in upstream v0.1.1.
export const browserVersion = '0.1.1';
export const browserPackage = 'scrapeless-scraping-browser';
const repository = 'scrapeless-ai/scrapeless-agent-browser';
export const checksums: Record<string, string> = {
  'darwin-arm64': '5987c814dd0ee5fa20ad805ea48c90067e1ad52c307d310916f5f5acab5484fe',
  'darwin-x64': '90d3f37ca6bf728dd0c2814cfcb2f00fc1065e30b29627e745b1de319ba63581',
  'linux-arm64': '4aa038d189a18b5e2bae321b58e2cbef8b350175eb2fe745c00cb7c2a41d341a',
  'linux-x64': '27517d031b70a325eff5562701eeaa582f0ec1a4d77ec106d53dd816f9ddc7d0',
  'win32-x64': 'c7a07e98f8d9d50171c4dc427110887246c1e80dc36ce1a0064a0e1fad53ad15',
};

export function binaryName(platform = process.platform, arch = process.arch): string {
  if (!checksums[`${platform}-${arch}`]) throw new Error(`Upstream has no browser binary for ${platform}-${arch}. Set SCRAPELESS_BROWSER_BIN to a compatible executable.`);
  return `${browserPackage}-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`;
}

function digest(buffer: Uint8Array): string { return createHash('sha256').update(buffer).digest('hex'); }

export async function runProcess(file: string, args: string[], options: { env?: NodeJS.ProcessEnv; install?: boolean } = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      env: options.env ?? process.env,
      stdio: options.install ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,
      timeout: options.install ? 300_000 : undefined,
    });
    // npm progress must never contaminate command results on stdout.
    child.stdout?.pipe(process.stderr, { end: false });
    child.stderr?.pipe(process.stderr, { end: false });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    const cleanup = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (code, signal) => {
      cleanup();
      resolve(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1));
    });
  });
}

async function npmCommand(): Promise<{ file: string; args: string[] }> {
  if (process.platform !== 'win32') return { file: 'npm', args: [] };
  // Invoke npm's JS entry directly: .cmd files require shell parsing on Windows.
  const dirs = [dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)];
  for (const dir of dirs) {
    const script = join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    try { await access(script); return { file: process.execPath, args: [script] }; } catch { /* Try the next Node installation. */ }
  }
  throw new Error('Cannot find npm. Install Node.js with npm, or set SCRAPELESS_BROWSER_BIN.');
}

export interface BrowserInstallDependencies {
  install: (directory: string) => Promise<void>;
  download: (url: string) => Promise<Uint8Array>;
}

const dependencies: BrowserInstallDependencies = {
  async install(directory) {
    const npm = await npmCommand();
    // Skip upstream lifecycle scripts, which may rewrite a global bin symlink.
    const code = await runProcess(npm.file, [...npm.args, 'install', '--prefix', directory,
      '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--registry=https://registry.npmjs.org',
      `${browserPackage}@${browserVersion}`], { install: true });
    if (code !== 0) throw new Error(`Browser dependency installation failed (exit ${code}). Check npm/network access and retry.`);
  },
  async download(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Browser download failed: HTTP ${response.status}. Retry when GitHub is reachable.`);
    return new Uint8Array(await response.arrayBuffer());
  },
};

export async function ensureBrowser(
  root = process.env.SCRAPELESS_CACHE_DIR || join(homedir(), '.cache', 'scrapeless'),
  deps = dependencies,
): Promise<string> {
  const name = binaryName();
  const checksum = checksums[`${process.platform}-${process.arch}`]!;
  const destination = join(root, 'browser', `${browserVersion}-${process.platform}-${process.arch}`);
  const relative = join('node_modules', browserPackage);
  const binary = join(destination, relative, 'bin', name);
  const ready = async () => {
    try {
      await access(join(destination, '.ready'));
      await access(join(destination, relative, 'dist', 'daemon.js'));
      return digest(await readFile(binary)) === checksum;
    } catch { return false; }
  };
  if (await ready()) return binary;
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(dirname(destination), '.install-'));
  console.error(`Installing ${browserPackage}@${browserVersion} for ${process.platform}-${process.arch}…`);
  try {
    await deps.install(staging);
    const packageDir = join(staging, relative);
    await access(join(packageDir, 'dist', 'daemon.js'));
    const executable = join(packageDir, 'bin', name);
    let bytes: Uint8Array | undefined;
    try { bytes = await readFile(executable); } catch { /* Fetch missing binary. */ }
    if (!bytes || digest(bytes) !== checksum) {
      bytes = await deps.download(`https://github.com/${repository}/releases/download/v${browserVersion}/${name}`);
      if (digest(bytes) !== checksum) throw new Error('Browser binary SHA-256 verification failed. The download was not installed.');
      await mkdir(dirname(executable), { recursive: true });
      await writeFile(executable, bytes, { mode: 0o755 });
    }
    if (process.platform !== 'win32') await chmod(executable, 0o755);
    await writeFile(join(staging, '.ready'), browserVersion);
    // Another process may have completed the same first-use installation.
    if (await ready()) return binary;
    // Never remove a competing valid installation; fail with a repair instruction.
    try { await rename(staging, destination); }
    catch (error) {
      if (!(await ready())) throw new Error(`Cannot activate browser cache at ${destination}. Move that directory aside and retry. ${(error as Error).message}`);
    }
    return binary;
  } finally { await rm(staging, { recursive: true, force: true }); }
}

export async function runBrowser(args: string[]): Promise<number> {
  const binary = process.env.SCRAPELESS_BROWSER_BIN || await ensureBrowser();
  await access(binary, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
  const token = await apiToken(false);
  const env = { ...process.env, ...(token ? { SCRAPELESS_API_KEY: token } : {}) };
  return runProcess(binary, args, { env });
}

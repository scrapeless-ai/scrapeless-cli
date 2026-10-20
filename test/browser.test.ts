import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { binaryName, browserPackage, browserVersion, checksums, ensureBrowser, runProcess, type BrowserInstallDependencies } from '../src/browser.js';

const exec = promisify(execFile);
const platformKey = `${process.platform}-${process.arch}`;
const originalChecksum = checksums[platformKey]!;
const bytes = Buffer.from('test-native-binary');
let root: string;
let installed: number, downloaded: number;
let deps: BrowserInstallDependencies;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scrapeless-browser-test-'));
  checksums[platformKey] = createHash('sha256').update(bytes).digest('hex');
  installed = 0; downloaded = 0;
  mock.method(process.stderr, 'write', () => true);
  deps = {
    async install(directory) {
      installed++;
      const daemon = join(directory, 'node_modules', browserPackage, 'dist', 'daemon.js');
      await mkdir(dirname(daemon), { recursive: true });
      await writeFile(daemon, '// daemon fixture');
    },
    async download(url) {
      downloaded++;
      assert.equal(url, `https://github.com/scrapeless-ai/scrapeless-agent-browser/releases/download/v${browserVersion}/${binaryName()}`);
      return bytes;
    },
  };
});

afterEach(async () => {
  checksums[platformKey] = originalChecksum;
  mock.restoreAll();
  await rm(root, { recursive: true, force: true });
});

test('first use installs runtime and verified binary; next use needs no network', async () => {
  const first = await ensureBrowser(root, deps);
  assert.deepEqual(await readFile(first), bytes);
  const second = await ensureBrowser(root, deps);
  assert.equal(first, second);
  assert.equal(installed, 1);
  assert.equal(downloaded, 1);
  assert.equal((await readdir(join(root, 'browser'))).some(name => name.startsWith('.install-')), false);
});

test('binary integrity failure leaves no completed cache or staging files', async () => {
  deps.download = async () => Buffer.from('corrupt');
  await assert.rejects(ensureBrowser(root, deps), /SHA-256 verification failed/);
  assert.deepEqual(await readdir(join(root, 'browser')), []);
});

test('failed dependency installation is retryable', async () => {
  const install = deps.install;
  deps.install = async () => { throw new Error('network unavailable'); };
  await assert.rejects(ensureBrowser(root, deps), /network unavailable/);
  deps.install = install;
  assert.ok(await ensureBrowser(root, deps));
});

test('concurrent installs activate only complete caches', async () => {
  const binaries = await Promise.all([ensureBrowser(root, deps), ensureBrowser(root, deps)]);
  assert.equal(binaries[0], binaries[1]);
  assert.deepEqual(await readFile(binaries[0]!), bytes);
  assert.equal((await readdir(join(root, 'browser'))).length, 1);
});

test('all upstream platforms are mapped and unsupported platforms fail clearly', () => {
  assert.equal(binaryName('win32', 'x64'), 'scrapeless-scraping-browser-win32-x64.exe');
  assert.equal(binaryName('linux', 'arm64'), 'scrapeless-scraping-browser-linux-arm64');
  assert.throws(() => binaryName('win32', 'arm64'), /no browser binary/);
});

test('child exit code and termination signal propagate', async () => {
  assert.equal(await runProcess(process.execPath, ['-e', 'process.exit(7)']), 7);
  if (process.platform !== 'win32') {
    assert.equal(await runProcess(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")']), 143);
  }
});

test('CLI forwards raw arguments, environment, help and exit code without shell parsing', async () => {
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const config = join(root, 'config.json');
  await writeFile(config, JSON.stringify({ apiKey: 'browser-secret' }));
  const forwarded = ['--help', '--version', '--unknown=value', 'text with spaces', '$(echo unsafe)', '@e1', '--', '-x'];
  const env = { ...process.env, SCRAPELESS_BROWSER_BIN: process.execPath, SCRAPELESS_CONFIG_PATH: config };
  const result = await exec(process.execPath, ['--import', 'tsx', cli, 'browser', '-e', 'console.log(JSON.stringify({args:process.argv.slice(1), token:process.env.SCRAPELESS_API_KEY}));', '--', ...forwarded], { env });
  assert.deepEqual(JSON.parse(result.stdout), { args: forwarded, token: 'browser-secret' });
  assert.equal(result.stderr, '');
  await assert.rejects(exec(process.execPath, ['--import', 'tsx', cli, 'browser', '-e', 'process.exit(9)'], { env }), error => (error as { code: number }).code === 9);
});

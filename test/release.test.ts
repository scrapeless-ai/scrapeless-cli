import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/release.mjs', import.meta.url));

for (const [tag, version, channel] of [
  ['v1.2.3', '1.2.3', 'latest'], ['2.0.0', '2.0.0', 'latest'],
  ['v2.0.0-beta.1', '2.0.0-beta.1', 'beta'], ['v2.0.0-rc.2', '2.0.0-rc.2', 'rc'],
  ['v2.0.0-0', '2.0.0-0', 'next'], ['v2.0.0-latest.1', '2.0.0-latest.1', 'next'],
]) {
  test(`release ${tag} publishes ${version} on ${channel}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scrapeless-release-test-'));
    try {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'scrapeless', version: '0.0.0' }));
      const outputs = join(dir, 'outputs');
      await exec(process.execPath, [script], { cwd: dir, env: { ...process.env, RELEASE_TAG: tag, GITHUB_OUTPUT: outputs } });
      assert.equal(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version, version);
      assert.match(await readFile(outputs, 'utf8'), new RegExp(`dist_tag=${channel}\\n`));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}

test('release rejects malformed tags before changing package version', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scrapeless-release-test-'));
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'scrapeless', version: '0.0.0' }));
    for (const tag of ['v1', 'v01.2.3', 'v1.2.3+build', 'v1.2.3\nmalicious', '$(echo bad)']) {
      await assert.rejects(exec(process.execPath, [script], { cwd: dir, env: { ...process.env, RELEASE_TAG: tag } }));
      assert.equal(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version, '0.0.0');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import semver from 'semver';

const tag = process.env.RELEASE_TAG;
const version = tag?.replace(/^v/, '');
if (!version || semver.valid(version) !== version || semver.parse(version).build.length) {
  throw new Error('Release tag must be a SemVer version such as v1.2.3 or v1.2.3-beta.1 (no build metadata).');
}
const prerelease = semver.prerelease(version);
const channel = prerelease && typeof prerelease[0] === 'string' && /^[a-z][a-z0-9-]*$/.test(prerelease[0]) && prerelease[0] !== 'latest'
  ? prerelease[0] : prerelease ? 'next' : 'latest';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg.name !== 'scrapeless') throw new Error('Unexpected npm package name.');
pkg.version = version;
writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ndist_tag=${channel}\n`);
console.log(`Publishing scrapeless@${version} with npm dist-tag ${channel}`);

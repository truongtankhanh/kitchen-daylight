// Manifest level of the dependency matrix (decision 0003, section 6). Checks the `@kd/*`
// dependencies of every workspace package.json, then proves the check on the manifest fixtures:
// each fixture under fixtures/manifests/ lists in `expect` exactly the dependencies that must be
// rejected (the manifest's own name when the package itself is not in the matrix).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { forbiddenDependencies } from '../src/index.js';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageDir, '../..');
const manifestFixturesDir = path.join(packageDir, 'fixtures', 'manifests');

// The package globs of pnpm-workspace.yaml (`apps/*`, `packages/*`, `tools/*`).
const WORKSPACE_DIRS = ['apps', 'packages', 'tools'];

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

function workspaceManifests() {
  return WORKSPACE_DIRS.flatMap((dir) => {
    const absolute = path.join(repoRoot, dir);
    if (!existsSync(absolute)) return [];
    return readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name, 'package.json'))
      .filter((file) => existsSync(path.join(repoRoot, file)));
  }).sort();
}

let failed = 0;
const fail = (label, lines) => {
  failed += 1;
  console.error(`FAIL ${label}`);
  for (const line of lines) console.error(`  ${line}`);
};

const workspace = workspaceManifests();
for (const file of workspace) {
  const problems = forbiddenDependencies(readJson(path.join(repoRoot, file)));
  if (problems.length > 0) {
    fail(
      file,
      problems.map((p) => `${p.dependency}: ${p.reason}`),
    );
  } else {
    console.log(`ok   ${file}`);
  }
}

const fixtures = readdirSync(manifestFixturesDir)
  .filter((file) => file.endsWith('.json'))
  .sort();
if (fixtures.length === 0) {
  console.error('check-manifests: no manifest fixtures found');
  process.exit(1);
}

let expectedTotal = 0;
for (const file of fixtures) {
  const manifest = readJson(path.join(manifestFixturesDir, file));
  const expected = [...(manifest.expect ?? [])].sort();
  const rejected = [...new Set(forbiddenDependencies(manifest).map((p) => p.dependency))].sort();
  expectedTotal += expected.length;
  const missing = expected.filter((name) => !rejected.includes(name));
  const unexpected = rejected.filter((name) => !expected.includes(name));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(`fixtures/manifests/${file}`, [
      ...missing.map((name) => `expected ${name} to be rejected, it was not`),
      ...unexpected.map((name) => `unexpected rejection of ${name}`),
    ]);
  } else {
    console.log(`ok   fixtures/manifests/${file} (${expected.length} expected rejections)`);
  }
}

if (failed > 0) {
  console.error(`check-manifests: ${failed} manifests failed`);
  process.exit(1);
}
console.log(
  `check-manifests: ${workspace.length} workspace manifests clean, ` +
    `${fixtures.length} fixtures with ${expectedTotal} rejections as expected`,
);

// Lints every fixture with the config layer it targets and passes only when each line marked
// `// expect: <rule-id>` is reported with that rule, and nothing else is reported.
// Fixtures under fixtures/boundaries/<importer>.ts use that importer's preset and boundary layer;
// fixtures under fixtures/rules/ use the base preset.
import { readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

import { angular, base, IMPORTERS, node, reactNative } from '../src/index.js';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = path.join(packageDir, 'fixtures');
const EXPECT = /\/\/ expect: (\S+)\s*$/;

const PRESET_BY_IMPORTER = {
  api: node,
  admin: angular,
  mobile: reactNative,
  seed: node,
  'seed-data': node,
};

function configFor(relativePath) {
  const [group, file] = relativePath.split(path.sep);
  if (group !== 'boundaries') return base();
  const importer = path.basename(file, path.extname(file));
  if (!IMPORTERS.includes(importer))
    throw new Error(`No boundary layer for fixture ${relativePath}`);
  const preset = PRESET_BY_IMPORTER[importer] ?? base;
  return preset({ importer });
}

function expectations(source) {
  const expected = new Map();
  source.split('\n').forEach((line, index) => {
    const match = EXPECT.exec(line);
    if (match) expected.set(index + 1, match[1]);
  });
  return expected;
}

async function checkFile(relativePath) {
  const filePath = path.join(fixturesDir, relativePath);
  const eslint = new ESLint({
    cwd: packageDir,
    overrideConfigFile: true,
    overrideConfig: configFor(relativePath),
    ignore: false,
  });
  const [result] = await eslint.lintFiles([filePath]);
  const expected = expectations(readFileSync(filePath, 'utf8'));
  const problems = [];

  for (const [line, ruleId] of expected) {
    if (!result.messages.some((m) => m.line === line && m.ruleId === ruleId)) {
      problems.push(`line ${line}: expected ${ruleId}, not reported`);
    }
  }
  for (const m of result.messages) {
    if (expected.get(m.line) !== m.ruleId) {
      problems.push(`line ${m.line}: unexpected ${m.ruleId ?? 'parse error'}: ${m.message}`);
    }
  }
  return { relativePath, expectedCount: expected.size, problems };
}

const files = (await readdir(fixturesDir, { recursive: true }))
  .filter((file) => /\.tsx?$/.test(file))
  .sort();

if (files.length === 0) {
  console.error('check-fixtures: no fixtures found');
  process.exit(1);
}

let failed = 0;
let expectedTotal = 0;
for (const file of files) {
  const { relativePath, expectedCount, problems } = await checkFile(file);
  expectedTotal += expectedCount;
  if (problems.length > 0) {
    failed += 1;
    console.error(`FAIL ${relativePath}`);
    for (const problem of problems) console.error(`  ${problem}`);
  } else {
    console.log(`ok   ${relativePath} (${expectedCount} expected violations)`);
  }
}

if (failed > 0) {
  console.error(`check-fixtures: ${failed} of ${files.length} fixture files failed`);
  process.exit(1);
}
console.log(
  `check-fixtures: ${files.length} files, ${expectedTotal} violations rejected as expected`,
);

// Catalogue check (`check`): every locale must have every key of the default locale.
// Step 1 checks the built registry (dist/). Step 2 runs the same check on a fixture with a missing
// key and fails unless exactly the expected keys are reported, so a check that stops matching is
// caught. Writes nothing.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIST_ENTRY = new URL('../dist/index.js', import.meta.url);
const FIXTURE = new URL('./fixtures/missing-key.mjs', import.meta.url);

const isGroup = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Dot paths of every message, plus every empty group, so a missing empty namespace is caught. */
function keyPaths(catalogue, prefix = '') {
  const paths = [];
  for (const [key, value] of Object.entries(catalogue)) {
    const path = `${prefix}${key}`;
    if (isGroup(value) && Object.keys(value).length > 0) paths.push(...keyPaths(value, `${path}.`));
    else paths.push(path);
  }
  return paths;
}

/** Returns `<locale>: <key>` for every key of the default locale that another locale lacks. */
function missingKeys(catalogues, defaultLocale) {
  const reference = catalogues[defaultLocale];
  if (!reference) return [`${defaultLocale}: default locale is not in the registry`];
  const expected = keyPaths(reference);
  const problems = [];
  for (const [locale, catalogue] of Object.entries(catalogues)) {
    if (locale === defaultLocale) continue;
    const present = new Set(keyPaths(catalogue));
    for (const path of expected) if (!present.has(path)) problems.push(`${locale}: ${path}`);
  }
  return problems;
}

let failed = false;

if (!existsSync(fileURLToPath(DIST_ENTRY))) {
  console.error('dist/index.js is missing: run the package build first.');
  process.exit(1);
}
const registry = await import(DIST_ENTRY.href);
const problems = missingKeys(registry.catalogues, registry.DEFAULT_LOCALE);
if (problems.length > 0) {
  failed = true;
  console.error(`Locales lack keys of "${registry.DEFAULT_LOCALE}":`);
  for (const problem of problems) console.error(`  ${problem}`);
} else {
  console.log(
    `ok   ${registry.LOCALES.join(', ')}: every locale has every key of "${registry.DEFAULT_LOCALE}"`,
  );
}

const fixture = await import(FIXTURE.href);
const reported = missingKeys(fixture.catalogues, fixture.DEFAULT_LOCALE).sort();
const expected = [...fixture.expect].sort();
if (reported.join('\n') === expected.join('\n')) {
  console.log(`ok   fixture rejected as expected (${reported.join('; ')})`);
} else {
  failed = true;
  console.error('Fixture not rejected as expected.');
  console.error(`  expected: ${expected.join('; ') || '(nothing)'}`);
  console.error(`  reported: ${reported.join('; ') || '(nothing)'}`);
}

process.exitCode = failed ? 1 : 0;

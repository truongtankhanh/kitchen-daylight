// Generates `src/generated/openapi.ts` (the `paths` and `components` types) from the committed
// snapshot `openapi.json` with openapi-typescript (decision 0004 sections 4 and 5).
//   node scripts/client.mjs generate   writes the file
//   node scripts/client.mjs check      regenerates into a temporary file, fails on any byte difference
// The snapshot is read as JSON and passed as an object, so nothing is fetched or resolved.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript';

const SNAPSHOT = fileURLToPath(new URL('../openapi.json', import.meta.url));
const OUTPUT = fileURLToPath(new URL('../src/generated/openapi.ts', import.meta.url));

// The generator config: changing it changes every generated type.
const OPTIONS = { alphabetize: true, emptyObjectsUnknown: true, silent: true };

async function generate() {
  const document = JSON.parse(await readFile(SNAPSHOT, 'utf8'));
  return COMMENT_HEADER + astToString(await openapiTS(document, OPTIONS));
}

async function check(generated) {
  const directory = await mkdtemp(join(tmpdir(), 'kd-client-'));
  const freshPath = join(directory, 'openapi.ts');
  await writeFile(freshPath, generated, 'utf8');

  const committed = await readFile(OUTPUT).catch(() => undefined);
  if (committed?.equals(await readFile(freshPath))) {
    await rm(directory, { recursive: true, force: true });
    console.log(`client:check: ${OUTPUT} is up to date`);
    return 0;
  }
  console.error(
    committed === undefined
      ? `client:check: ${OUTPUT} is missing`
      : `client:check: ${OUTPUT} differs from the types generated from openapi.json`,
  );
  console.error(`generated types kept at ${freshPath}`);
  console.error('run `pnpm openapi:generate` and commit the result');
  return 1;
}

async function main(mode) {
  if (mode !== 'generate' && mode !== 'check') {
    console.error('usage: node scripts/client.mjs (generate | check)');
    return 2;
  }
  const generated = await generate();
  if (mode === 'check') {
    return check(generated);
  }
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, generated, 'utf8');
  console.log(`client:generate: wrote ${OUTPUT}`);
  return 0;
}

try {
  process.exitCode = await main(process.argv[2]);
} catch (error) {
  console.error(
    `client: unexpected error${error instanceof Error ? ` (${error.name}: ${error.message})` : ''}`,
  );
  process.exitCode = 1;
}

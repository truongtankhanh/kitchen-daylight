// Entry point of `dist/openapi/generate.js` (decision 0004 sections 1 to 3a). Needs no database,
// no network and no `.env`.
//   --out <path>    writes the snapshot
//   --check <path>  regenerates into a temporary file and fails on any byte difference
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { EXIT } from '../cli/exit-codes.js';
import type { ExitCode } from '../cli/exit-codes.js';
import { buildOpenApiDocument, serializeDocument } from './document.js';

const USAGE = 'usage: node dist/openapi/generate.js (--out | --check) <path>';

function firstDifferentLine(expected: string, actual: string): string {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const length = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < length; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return [
        `first difference at line ${index + 1}:`,
        `  committed: ${expectedLines[index] ?? '<end of file>'}`,
        `  generated: ${actualLines[index] ?? '<end of file>'}`,
      ].join('\n');
    }
  }
  return 'the files differ only in their bytes (encoding or line endings)';
}

async function check(snapshotPath: string, generated: string): Promise<ExitCode> {
  const directory = await mkdtemp(join(tmpdir(), 'kd-openapi-'));
  const freshPath = join(directory, 'openapi.json');
  await writeFile(freshPath, generated, 'utf8');

  const committed = await readFile(snapshotPath).catch(() => undefined);
  const fresh = await readFile(freshPath);
  if (committed?.equals(fresh)) {
    await rm(directory, { recursive: true, force: true });
    console.log(`openapi:check: ${snapshotPath} is up to date`);
    return EXIT.OK;
  }

  console.error(
    committed === undefined
      ? `openapi:check: ${snapshotPath} is missing`
      : `openapi:check: ${snapshotPath} differs from the generated document\n${firstDifferentLine(
          committed.toString('utf8'),
          generated,
        )}`,
  );
  console.error(`generated document kept at ${freshPath}`);
  console.error('run `pnpm openapi:generate` and commit the result');
  return EXIT.FAILURE;
}

async function main(argv: readonly string[]): Promise<ExitCode> {
  const [mode, target] = argv;
  if (argv.length !== 2 || (mode !== '--out' && mode !== '--check') || !target) {
    console.error(USAGE);
    return EXIT.USAGE;
  }

  const snapshotPath = resolve(target);
  const generated = serializeDocument(await buildOpenApiDocument());

  if (mode === '--check') {
    return check(snapshotPath, generated);
  }
  await writeFile(snapshotPath, generated, 'utf8');
  console.log(`openapi:generate: wrote ${snapshotPath}`);
  return EXIT.OK;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(
    `openapi: unexpected error${error instanceof Error ? ` (${error.name}: ${error.message})` : ''}`,
  );
  process.exitCode = EXIT.FAILURE;
}

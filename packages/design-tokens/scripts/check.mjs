// Drift check (`tokens:check`): regenerates the outputs in memory from tokens.json and fails when
// a committed file under src/ differs or is missing. Writes nothing.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PACKAGE_DIR, generate, readTokens } from './build.mjs';

const drift = [];
for (const [path, expected] of generate(readTokens())) {
  const target = join(PACKAGE_DIR, path);
  const actual = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (actual === null) drift.push(`${path} (missing)`);
  else if (actual !== expected) drift.push(path);
}

if (drift.length > 0) {
  console.error('Generated token files are out of date:');
  for (const path of drift) console.error(`  ${path}`);
  console.error('Run `pnpm --filter @kd/design-tokens build` and commit the result.');
  process.exitCode = 1;
} else {
  console.log('Generated token files match tokens.json.');
}

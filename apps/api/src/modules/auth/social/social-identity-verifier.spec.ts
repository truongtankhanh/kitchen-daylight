import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// A2-T6: the test double of `SocialIdentityVerifier` lives under `apps/api/test/support/` and is
// bound only through the test module's provider override. No file under `apps/api/src/` may import
// it, so it can never be chosen at run time. The name is assembled here so that this spec does not
// match the search itself.

const FAKE_MODULE = ['fake', 'social', 'identity', 'verifier'].join('-');
const SRC_DIR = fileURLToPath(new URL('../../../', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(?:ts|mts|cts|js|mjs|cjs)$/.test(entry.name) ? [path] : [];
  });
}

describe('the social verifier test double', () => {
  it('is reached from src/ through nothing but this check', () => {
    const files = sourceFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.endsWith('social-identity-verifier.ts'))).toBe(true);

    const offenders = files
      .filter((file) => readFileSync(file, 'utf8').includes(FAKE_MODULE))
      .map((file) => relative(SRC_DIR, file));

    expect(offenders).toEqual([]);
  });
});

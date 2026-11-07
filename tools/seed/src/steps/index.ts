import { readFile } from 'node:fs/promises';

import { createGeographyStep, PROVINCES_FILE, WARDS_FILE } from './geography.js';
import type { SeedStep } from './step.js';

/** Reads a JSON file of `@kd/seed-data` through the package's `exports` (decision 0003 section 6). */
async function readSeedData(specifier: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(import.meta.resolve(specifier)), 'utf8')) as unknown;
}

/**
 * The ordered steps of `seed reference`. Still to come, each as its own step: amenities (A5-T1),
 * tags (A6-T4), default settings, consent documents and the first ADMIN (A4-T5).
 */
export function referenceSteps(): readonly SeedStep[] {
  return [
    createGeographyStep(async () => ({
      provinces: await readSeedData(PROVINCES_FILE),
      wards: await readSeedData(WARDS_FILE),
    })),
  ];
}

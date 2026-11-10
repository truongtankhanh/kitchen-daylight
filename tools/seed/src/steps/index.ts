import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import type { FirstAdmin } from '../environment.js';
import { APP_SETTINGS_FILE, createAppSettingsStep } from './app-settings.js';
import {
  CONSENT_DOCUMENTS_FILE,
  createConsentDocumentsStep,
  createPublishedDocumentsStep,
} from './consent-documents.js';
import { createFirstAdminStep } from './first-admin.js';
import { createGeographyStep, PROVINCES_FILE, WARDS_FILE } from './geography.js';
import type { SeedStep } from './step.js';
import { createVocabularyStep, VOCABULARY_FILE } from './vocabulary.js';

/** Reads a JSON file of `@kd/seed-data` through the package's `exports` (decision 0003 section 6). */
export async function readSeedData(specifier: string): Promise<unknown> {
  return readJson(new URL(import.meta.resolve(specifier)));
}

/** Reads a JSON file of this package's `data/` folder. */
export async function readJson(file: URL): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

export interface ReferenceOptions {
  /** `readFirstAdmin` of the environment; `null` skips the `first-admin` step. */
  readonly firstAdmin: FirstAdmin | null;
  /**
   * `readConsentDocumentsFile` of the environment: the owner's real documents. `null` uses the
   * committed placeholders.
   */
  readonly consentDocumentsFile: string | null;
}

/**
 * The ordered steps of `seed reference`. Still to come, as its own step added here by its task:
 * the email templates (A12-T3) (api-divergences D-125). Amenities and tags are the `vocabulary`
 * step (A6-T5).
 */
export function referenceSteps(options: ReferenceOptions): readonly SeedStep[] {
  const ownerFile = options.consentDocumentsFile;
  return [
    createGeographyStep(async () => ({
      provinces: await readSeedData(PROVINCES_FILE),
      wards: await readSeedData(WARDS_FILE),
    })),
    createAppSettingsStep(() => readJson(APP_SETTINGS_FILE)),
    ownerFile === null
      ? createConsentDocumentsStep(() => readJson(CONSENT_DOCUMENTS_FILE))
      : createPublishedDocumentsStep(() => readJson(pathToFileURL(ownerFile))),
    createVocabularyStep(() => readJson(VOCABULARY_FILE)),
    createFirstAdminStep(options.firstAdmin),
  ];
}

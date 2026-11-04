import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import type { Environment } from './load-config.js';

/**
 * The env file's values overlaid by the process environment, which wins (decision 0005,
 * section 3). A missing file is not an error: containers have none.
 */
export function readEnvironment(envFile: URL | string, processEnv: Environment): Environment {
  let fromFile: Environment = {};
  try {
    fromFile = parseEnv(readFileSync(envFile, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  return { ...fromFile, ...processEnv };
}

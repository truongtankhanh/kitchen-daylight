// Staged-file checks for the pre-commit hook (decision 0002). Commands run in order per glob.
// `--no-warn-ignored` keeps ignored files (for example the boundary fixtures) from failing
// `--max-warnings 0`; `--ignore-unknown` lets Prettier skip files it cannot parse.
//
// ESLint runs once per workspace package, as `turbo run lint` does: typescript-eslint infers
// `tsconfigRootDir` from the config file and refuses to parse when one process loads the
// `eslint.config.mjs` of several packages. Files outside a package with its own config use
// the root config.
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const PACKAGE_DIR = /^(apps|packages|tools)\/[^/]+/;

const quote = (file) => `"${file}"`;

function eslintGroup(file) {
  const match = PACKAGE_DIR.exec(relative(ROOT, file).split(sep).join('/'));
  if (match && existsSync(join(ROOT, match[0], 'eslint.config.mjs'))) {
    return match[0];
  }
  return '.';
}

function eslintPerPackage(files) {
  const groups = new Map();
  for (const file of files) {
    const group = eslintGroup(file);
    groups.set(group, [...(groups.get(group) ?? []), file]);
  }
  return [...groups.values()].map(
    (group) => `eslint --fix --max-warnings 0 --no-warn-ignored ${group.map(quote).join(' ')}`,
  );
}

export default {
  '*.{ts,tsx,js,mjs,cjs}': (files) => [
    ...eslintPerPackage(files),
    `prettier --write --ignore-unknown ${files.map(quote).join(' ')}`,
  ],
  '*.{json,md,yml,yaml,css,scss,html}': 'prettier --write --ignore-unknown',
};

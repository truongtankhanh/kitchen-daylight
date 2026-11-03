// Staged-file checks for the pre-commit hook (decision 0002). Commands run in order per glob.
// `--no-warn-ignored` keeps ignored files (for example the boundary fixtures) from failing
// `--max-warnings 0`; `--ignore-unknown` lets Prettier skip files it cannot parse.
export default {
  '*.{ts,tsx,js,mjs,cjs}': [
    'eslint --fix --max-warnings 0 --no-warn-ignored',
    'prettier --write --ignore-unknown',
  ],
  '*.{json,md,yml,yaml,css,scss,html}': 'prettier --write --ignore-unknown',
};

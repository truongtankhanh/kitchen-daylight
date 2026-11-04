// ESLint layer of @kd/seed-data: shared rules plus its boundary row (decision 0003).
import { base } from '@kd/eslint-config';

export default [
  ...base({ importer: 'seed-data' }),
  {
    // Command-line scripts: printing their result is their output.
    name: 'kd/seed-data/cli-scripts',
    files: ['admin-units/fetch.mjs', 'admin-units/verify.mjs'],
    rules: { 'no-console': 'off' },
  },
];

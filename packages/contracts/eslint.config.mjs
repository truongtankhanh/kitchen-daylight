// ESLint layer of @kd/contracts: shared rules plus its boundary row (decision 0003).
import { base } from '@kd/eslint-config';

export default [
  { name: 'kd/contracts/ignores', ignores: ['dist/'] },
  ...base({ importer: 'contracts' }),
];

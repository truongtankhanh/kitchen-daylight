// ESLint layer of @kd/admin: Angular preset plus its boundary row (decision 0003).
// Template linting (angular-eslint) is not added yet (P4-T6 report).
import { angular } from '@kd/eslint-config';

export default [
  { name: 'kd/admin/ignores', ignores: ['dist/', '.angular/'] },
  ...angular({ importer: 'admin' }),
];

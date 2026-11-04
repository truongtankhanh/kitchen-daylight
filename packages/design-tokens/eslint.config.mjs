// ESLint layer of @kd/design-tokens: shared rules plus its boundary row (decision 0003).
import { base } from '@kd/eslint-config';

export default [
  { name: 'kd/design-tokens/ignores', ignores: ['dist/'] },
  ...base({ importer: 'design-tokens' }),
];

// ESLint layer of @kd/i18n: shared rules plus its boundary row (decision 0003).
import { base } from '@kd/eslint-config';

export default [{ name: 'kd/i18n/ignores', ignores: ['dist/'] }, ...base({ importer: 'i18n' })];

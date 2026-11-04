// ESLint layer of @kd/api: Node preset plus its boundary row (decision 0003).
import { node } from '@kd/eslint-config';

export default [{ name: 'kd/api/ignores', ignores: ['dist/'] }, ...node({ importer: 'api' })];

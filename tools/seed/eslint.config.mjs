// ESLint layer of @kd/seed: Node preset plus its boundary row (decision 0003).
import { node } from '@kd/eslint-config';

export default [{ name: 'kd/seed/ignores', ignores: ['dist/'] }, ...node({ importer: 'seed' })];

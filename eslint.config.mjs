// Root ESLint config: root files and packages without their own eslint.config.
// Apps and packages with code add their own config from @kd/eslint-config (decision 0002).
import { base, boundaries } from './packages/eslint-config/src/index.js';

export default [
  {
    name: 'kd/global-ignores',
    ignores: [
      '**/dist/',
      '**/coverage/',
      '**/.turbo/',
      'designs/',
      'docs/',
      'packages/eslint-config/fixtures/',
      'packages/contracts/src/generated/',
    ],
  },
  ...base(),
  {
    ...boundaries('eslint-config'),
    files: ['packages/eslint-config/**'],
  },
];

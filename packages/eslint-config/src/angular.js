import { base } from './base.js';

/** Angular admin. The Angular template plugin is chosen and added in P4-T6 (decision 0002). */
export function angular(options = {}) {
  return [
    ...base(options),
    {
      name: 'kd/angular',
      files: ['**/*.ts'],
      languageOptions: {
        parserOptions: { experimentalDecorators: true },
      },
    },
  ];
}

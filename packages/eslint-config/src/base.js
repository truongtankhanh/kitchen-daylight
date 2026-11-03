import js from '@eslint/js';
import tseslint from 'typescript-eslint';

import { boundaries } from './boundaries.js';

// Command-line entry points are the only application files that may print to the console.
export const CLI_ENTRY_FILES = [
  '**/src/cli.ts',
  '**/src/cli/**',
  '**/src/openapi/generate.ts',
  '**/scripts/**',
];

/** Shared rules for every runtime. Pass `importer` to add that package's boundary layer. */
export function base({ importer } = {}) {
  return [
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      name: 'kd/base',
      files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
      rules: {
        // TypeScript checks undefined names; typescript-eslint advises against no-undef.
        'no-undef': 'off',
        'no-console': 'error',
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
        ],
      },
    },
    {
      name: 'kd/cli-entry-points',
      files: CLI_ENTRY_FILES,
      rules: { 'no-console': 'off' },
    },
    ...(importer ? [boundaries(importer)] : []),
  ];
}

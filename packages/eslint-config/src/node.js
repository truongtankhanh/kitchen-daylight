import { base } from './base.js';

/** NestJS and Node tools. Decorator metadata matches `@kd/tsconfig/node.json`. */
export function node(options = {}) {
  return [
    ...base(options),
    {
      name: 'kd/node',
      files: ['**/*.{ts,mts,cts}'],
      languageOptions: {
        // Without type information, consistent-type-imports needs these to leave
        // classes used in decorator metadata as value imports.
        parserOptions: { experimentalDecorators: true, emitDecoratorMetadata: true },
      },
    },
  ];
}

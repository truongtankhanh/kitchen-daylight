import { Options } from './options.js'; // expect: @typescript-eslint/consistent-type-imports

export function describe(options: Options): string {
  return JSON.stringify(options);
}

import { describe, expect, it } from 'vitest';

import { parseCliArgs, USAGE, UsageError } from './args.js';

describe('parseCliArgs', () => {
  it('parses migrate', () => {
    expect(parseCliArgs(['migrate'])).toEqual({ kind: 'migrate' });
  });

  it.each([['--help'], ['-h'], ['migrate', '--help']])('returns help for %s', (...argv) => {
    expect(parseCliArgs(argv)).toEqual({ kind: 'help' });
  });

  it.each([
    [[], 'missing command'],
    [['seed'], 'unknown command: seed'],
    [['migrate', 'extra'], 'unexpected argument: extra'],
  ])('rejects %j', (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(new UsageError(message));
  });

  it('rejects an unknown option as a usage error', () => {
    expect(() => parseCliArgs(['migrate', '--force'])).toThrow(UsageError);
  });

  it('documents every exit code', () => {
    for (const code of ['0', '1', '2', '3', '4']) {
      expect(USAGE).toMatch(new RegExp(`^ {2}${code} {2}`, 'm'));
    }
  });
});

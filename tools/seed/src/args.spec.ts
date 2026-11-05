import { describe, expect, it } from 'vitest';

import { MODES, parseSeedArgs, USAGE, UsageError } from './args.js';

describe('parseSeedArgs', () => {
  it.each([
    [['reference'], { kind: 'run', mode: 'reference', commit: false }],
    [['business'], { kind: 'run', mode: 'business', commit: false }],
    [['demo'], { kind: 'run', mode: 'demo', commit: false }],
    [['reference', '--commit'], { kind: 'run', mode: 'reference', commit: true }],
    [['--commit', 'business'], { kind: 'run', mode: 'business', commit: true }],
    [['demo', '--commit'], { kind: 'run', mode: 'demo', commit: true }],
    [['--help'], { kind: 'help' }],
    [['-h'], { kind: 'help' }],
    [['demo', '--commit', '--help'], { kind: 'help' }],
  ])('parses %j', (argv, expected) => {
    expect(parseSeedArgs(argv)).toEqual(expected);
  });

  it.each([
    [[], 'missing mode'],
    [['--commit'], 'missing mode'],
    [['images'], 'unknown mode: images'],
    [['verify'], 'unknown mode: verify'],
    [['seed'], 'unknown mode: seed'],
    [['reference', 'business'], 'unexpected argument: business'],
    [['reference', '--force'], "Unknown option '--force'"],
    [['reference', '--commit=yes'], '--commit'],
    [['reference', '--file', 'menu.json'], "Unknown option '--file'"],
  ])('rejects %j with a usage error', (argv, message) => {
    expect(() => parseSeedArgs(argv)).toThrow(UsageError);
    expect(() => parseSeedArgs(argv)).toThrow(message);
  });

  it('is a dry run unless --commit is given', () => {
    expect(parseSeedArgs(['reference'])).toMatchObject({ commit: false });
  });
});

describe('MODES and USAGE', () => {
  it('lists exactly the three modes of the shell', () => {
    expect(Object.keys(MODES)).toEqual(['reference', 'business', 'demo']);
  });

  it('refuses demo in prod only', () => {
    expect(MODES.demo.appEnvs).toEqual(['dev', 'test', 'demo']);
    expect(MODES.reference.appEnvs).toContain('prod');
    expect(MODES.business.appEnvs).toContain('prod');
  });

  it('names every mode, --commit and the five exit codes', () => {
    for (const mode of Object.keys(MODES)) {
      expect(USAGE).toContain(mode);
    }
    expect(USAGE).toContain('--commit');
    for (const code of ['0', '1', '2', '3', '4']) {
      expect(USAGE).toMatch(new RegExp(`^  ${code}  `, 'm'));
    }
  });
});

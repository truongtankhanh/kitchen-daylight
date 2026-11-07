import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { BranchScoped, branchScopeMarkerOf, NotBranchScoped } from './branch-scope.decorator.js';
import type { BranchScopedOptions } from './branch-scope.decorator.js';

const reflector = new Reflector();

@BranchScoped({ param: 'branchId' })
@Controller('branches/:branchId/things')
class ScopedController {
  @Get()
  inherited(): void {}

  @BranchScoped({ query: 'branchIds' })
  @Get('list')
  list(): void {}

  @NotBranchScoped('Reads no branch data.')
  @Get('global')
  global(): void {}
}

@Controller('plain')
class PlainController {
  @Get()
  unmarked(): void {}

  @BranchScoped({ param: 'id' })
  @NotBranchScoped('Contradiction.')
  @Get('both')
  both(): void {}
}

describe('branchScopeMarkerOf', () => {
  it('reads the controller marker when the handler has none', () => {
    expect(
      branchScopeMarkerOf(reflector, ScopedController.prototype.inherited, ScopedController),
    ).toEqual({ kind: 'SCOPED', options: { param: 'branchId' } });
  });

  it('lets the handler marker win over the controller marker', () => {
    expect(
      branchScopeMarkerOf(reflector, ScopedController.prototype.list, ScopedController),
    ).toEqual({ kind: 'SCOPED', options: { query: 'branchIds' } });
    expect(
      branchScopeMarkerOf(reflector, ScopedController.prototype.global, ScopedController),
    ).toEqual({ kind: 'NOT_SCOPED', reason: 'Reads no branch data.' });
  });

  it('is undefined without a marker', () => {
    expect(
      branchScopeMarkerOf(reflector, PlainController.prototype.unmarked, PlainController),
    ).toBeUndefined();
  });

  it('throws when one handler carries both markers', () => {
    expect(() =>
      branchScopeMarkerOf(reflector, PlainController.prototype.both, PlainController),
    ).toThrow(/both/);
  });
});

describe('@NotBranchScoped', () => {
  it.each(['', '   '])('refuses an empty reason (%j)', (reason) => {
    expect(() => NotBranchScoped(reason)).toThrow(/reason/);
  });
});

describe('@BranchScoped', () => {
  it('refuses options naming both a query and a param', () => {
    const options = { query: 'branchIds', param: 'id' } as unknown as BranchScopedOptions;

    expect(() => BranchScoped(options)).toThrow(/exactly one/);
  });

  it('refuses options naming neither', () => {
    expect(() => BranchScoped({} as unknown as BranchScopedOptions)).toThrow(/exactly one/);
  });
});

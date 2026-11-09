import { QueryFailedError } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../common/errors/api-error.js';
import {
  freeOverKeepsAboveMinOrder,
  isForeignKeyViolation,
  mergeZoneValues,
  radiusKeepsRingOrder,
  removesLastActiveZone,
  zoneAuditLabel,
  zoneConstraintError,
  zoneDiff,
  zoneInUseError,
} from './delivery-zones.service.js';
import type { DeliveryZoneValues, ZoneRing } from './delivery-zones.service.js';

const INNER = '01930000-0000-7000-8000-0000000054c1';
const MIDDLE = '01930000-0000-7000-8000-0000000054c2';
const OUTER = '01930000-0000-7000-8000-0000000054c3';

/** Rings of 500, 1000 and 2000 m, listed out of order on purpose. */
const RINGS: ZoneRing[] = [
  { id: OUTER, radiusM: 2000 },
  { id: INNER, radiusM: 500 },
  { id: MIDDLE, radiusM: 1000 },
];

function violation(fields: { code?: string; constraint?: string }): QueryFailedError {
  const driverError = Object.assign(new Error('violation'), fields);
  return new QueryFailedError('DELETE …', [], driverError);
}

const VALUES: DeliveryZoneValues = {
  name: 'Vòng trong',
  radiusM: 500,
  fee: 10_000,
  minOrder: 50_000,
  freeOver: 200_000,
  etaMinutes: 25,
  isActive: true,
};

describe('radiusKeepsRingOrder: a new ring', () => {
  it('accepts the first ring of a branch', () => {
    expect(radiusKeepsRingOrder([], 300)).toBe(true);
  });

  it('accepts a radius larger than the outermost ring', () => {
    expect(radiusKeepsRingOrder(RINGS, 2001)).toBe(true);
  });

  it('refuses a radius inside or between existing rings', () => {
    expect(radiusKeepsRingOrder(RINGS, 1500)).toBe(false);
    expect(radiusKeepsRingOrder(RINGS, 100)).toBe(false);
  });

  it('refuses a radius equal to the outermost ring', () => {
    expect(radiusKeepsRingOrder(RINGS, 2000)).toBe(false);
  });
});

describe('radiusKeepsRingOrder: an edited ring', () => {
  it('accepts a radius strictly between its neighbours', () => {
    expect(radiusKeepsRingOrder(RINGS, 501, MIDDLE)).toBe(true);
    expect(radiusKeepsRingOrder(RINGS, 1999, MIDDLE)).toBe(true);
  });

  it('refuses a radius that passes a neighbour', () => {
    expect(radiusKeepsRingOrder(RINGS, 2500, MIDDLE)).toBe(false);
    expect(radiusKeepsRingOrder(RINGS, 400, MIDDLE)).toBe(false);
  });

  it('refuses a radius equal to a neighbour', () => {
    expect(radiusKeepsRingOrder(RINGS, 500, MIDDLE)).toBe(false);
    expect(radiusKeepsRingOrder(RINGS, 2000, MIDDLE)).toBe(false);
  });

  it('lets the innermost ring shrink and the outermost ring grow freely', () => {
    expect(radiusKeepsRingOrder(RINGS, 1, INNER)).toBe(true);
    expect(radiusKeepsRingOrder(RINGS, 999, INNER)).toBe(true);
    expect(radiusKeepsRingOrder(RINGS, 1000, INNER)).toBe(false);
    expect(radiusKeepsRingOrder(RINGS, 50_000, OUTER)).toBe(true);
    expect(radiusKeepsRingOrder(RINGS, 1000, OUTER)).toBe(false);
  });

  it('accepts any radius for the only ring', () => {
    expect(radiusKeepsRingOrder([{ id: INNER, radiusM: 500 }], 7000, INNER)).toBe(true);
  });

  it('throws for a ring that is not in the list (programmer error)', () => {
    expect(() => radiusKeepsRingOrder(RINGS, 700, '01930000-0000-7000-8000-0000000054cf')).toThrow(
      Error,
    );
  });
});

describe('radiusKeepsRingOrder: inactive rings still count', () => {
  // The service passes every ring of the branch, active or not (brief C19); the rule never filters
  // on `isActive`. Here the 1000 m and 2000 m rings are switched off.
  const withInactive = [
    { id: INNER, radiusM: 500, isActive: true },
    { id: MIDDLE, radiusM: 1000, isActive: false },
    { id: OUTER, radiusM: 2000, isActive: false },
  ];

  it('refuses a new ring inside an inactive outermost ring, or equal to it', () => {
    expect(radiusKeepsRingOrder(withInactive, 1800)).toBe(false);
    expect(radiusKeepsRingOrder(withInactive, 2000)).toBe(false);
    expect(radiusKeepsRingOrder(withInactive, 2001)).toBe(true);
  });

  it('bounds an edit by an inactive neighbour', () => {
    expect(radiusKeepsRingOrder(withInactive, 1200, INNER)).toBe(false);
    expect(radiusKeepsRingOrder(withInactive, 1000, INNER)).toBe(false);
    expect(radiusKeepsRingOrder(withInactive, 999, INNER)).toBe(true);
  });
});

describe('removesLastActiveZone', () => {
  const zones = [
    { id: INNER, isActive: true },
    { id: MIDDLE, isActive: false },
    { id: OUTER, isActive: false },
  ];

  it('is true for the only active zone of a branch that accepts delivery', () => {
    expect(removesLastActiveZone(zones, INNER, true)).toBe(true);
  });

  it('is false when the branch does not accept delivery', () => {
    expect(removesLastActiveZone(zones, INNER, false)).toBe(false);
  });

  it('is false for an inactive zone or while another zone is active', () => {
    expect(removesLastActiveZone(zones, MIDDLE, true)).toBe(false);
    const twoActive = [
      { id: INNER, isActive: true },
      { id: MIDDLE, isActive: true },
    ];
    expect(removesLastActiveZone(twoActive, INNER, true)).toBe(false);
  });
});

describe('freeOverKeepsAboveMinOrder', () => {
  it('accepts no free-over amount or one above the minimum', () => {
    expect(freeOverKeepsAboveMinOrder({ minOrder: 50_000, freeOver: null })).toBe(true);
    expect(freeOverKeepsAboveMinOrder({ minOrder: 50_000, freeOver: 50_001 })).toBe(true);
  });

  it('refuses a free-over amount at or below the minimum', () => {
    expect(freeOverKeepsAboveMinOrder({ minOrder: 50_000, freeOver: 50_000 })).toBe(false);
    expect(freeOverKeepsAboveMinOrder({ minOrder: 50_000, freeOver: 1 })).toBe(false);
  });
});

describe('mergeZoneValues', () => {
  it('keeps the current values for fields not sent', () => {
    expect(mergeZoneValues(VALUES, { fee: 15_000 })).toEqual({ ...VALUES, fee: 15_000 });
  });

  it('clears freeOver with null and keeps it when absent', () => {
    expect(mergeZoneValues(VALUES, { freeOver: null }).freeOver).toBeNull();
    expect(mergeZoneValues(VALUES, {}).freeOver).toBe(200_000);
  });
});

describe('zoneDiff', () => {
  it('lists every field on create and delete', () => {
    const created = zoneDiff(null, VALUES);
    expect(created['radiusM']).toEqual({ from: null, to: 500 });
    expect(Object.keys(created)).toHaveLength(7);
    expect(zoneDiff(VALUES, null)['isActive']).toEqual({ from: true, to: null });
  });

  it('lists only the changed fields on update', () => {
    expect(zoneDiff(VALUES, { ...VALUES, fee: 12_000, isActive: false })).toEqual({
      fee: { from: 10_000, to: 12_000 },
      isActive: { from: true, to: false },
    });
  });
});

describe('zoneAuditLabel', () => {
  it('is the zone name, or the radius when the name looks like an email', () => {
    expect(zoneAuditLabel('Vòng ngoài', 2000)).toBe('Vòng ngoài');
    expect(zoneAuditLabel('giao@vung.example', 2000)).toBe('2000 m');
  });
});

describe('IN_USE and constraint errors', () => {
  it('builds IN_USE with usage { count, sample, filter }', () => {
    const error = zoneInUseError(INNER, 3);
    expect(error.code).toBe('IN_USE');
    expect(error.status).toBe(409);
    expect(error.extras).toEqual({
      usage: { count: 3, sample: [], filter: { deliveryZoneId: INNER } },
    });
  });

  it('recognises SQLSTATE 23503 only', () => {
    expect(isForeignKeyViolation(violation({ code: '23503' }))).toBe(true);
    expect(isForeignKeyViolation(violation({ code: '23505' }))).toBe(false);
    expect(isForeignKeyViolation(new Error('23503'))).toBe(false);
  });

  it('maps the active radius index to RADIUS_ORDER and the free-over CHECK to OUT_OF_RANGE', () => {
    const radius = zoneConstraintError(
      violation({ code: '23505', constraint: 'delivery_zones_branch_radius_active_key' }),
    );
    expect(radius).toBeInstanceOf(ApiError);
    expect(radius?.errors).toEqual([
      expect.objectContaining({ field: 'radiusM', code: 'RADIUS_ORDER' }),
    ]);
    const freeOver = zoneConstraintError(
      violation({ code: '23514', constraint: 'delivery_zones_free_over_above_min_order' }),
    );
    expect(freeOver?.errors).toEqual([
      expect.objectContaining({ field: 'freeOver', code: 'OUT_OF_RANGE' }),
    ]);
    expect(zoneConstraintError(violation({ constraint: 'other' }))).toBeNull();
  });
});

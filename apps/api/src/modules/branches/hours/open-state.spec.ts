import { describe, expect, it } from 'vitest';

import { BUSINESS_TIME_ZONE } from '../../../common/time/vietnam-time.js';
import type { BranchService } from '../entities/branch-opening-period.entity.js';
import {
  getOpenState,
  getServiceState,
  getSessionsForDate,
  isoDayOfWeek,
  LOOK_AHEAD_DAYS,
} from './open-state.js';
import type { OpenStateInput, SpecialDay, WeeklyPeriod } from './open-state.js';

// testing-strategy "Branches, menu and search", open-now bullet: periods crossing midnight, the
// previous day's session, special hours overriding weekly periods, `DELIVERY` falling back to
// `STORE`; plus the A5-T3 cases (cutoff, switches, pause, no periods, the 00:00 to 23:59 day).
//
// Calendar used: Monday 2026-11-09 to Sunday 2026-11-15, then Monday 2026-11-16.

/** Vietnam wall clock → instant (UTC+7, no daylight saving). */
function vn(wallClock: string): Date {
  return new Date(`${wallClock}+07:00`);
}

function period(
  service: BranchService,
  dayOfWeek: number,
  openTime: string,
  closeTime: string,
): WeeklyPeriod {
  return { service, dayOfWeek, openTime, closeTime };
}

function everyDay(service: BranchService, openTime: string, closeTime: string): WeeklyPeriod[] {
  return [1, 2, 3, 4, 5, 6, 7].map((day) => period(service, day, openTime, closeTime));
}

function special(
  service: BranchService,
  startsOn: string,
  endsOn: string,
  times: { openTime: string; closeTime: string } | 'closed',
): SpecialDay {
  return times === 'closed'
    ? { service, startsOn, endsOn, isClosed: true, openTime: null, closeTime: null }
    : { service, startsOn, endsOn, isClosed: false, ...times };
}

function branch(overrides: Partial<OpenStateInput> = {}): OpenStateInput {
  return {
    timeZone: BUSINESS_TIME_ZONE,
    status: 'ACTIVE',
    acceptsPickup: true,
    acceptsDelivery: true,
    acceptsReservations: false,
    orderCutoffMinutes: 0,
    periods: [],
    specialDays: [],
    ...overrides,
  };
}

function hoursOf(input: OpenStateInput, date: string, service: BranchService): string[] {
  return getSessionsForDate(input, date, service).map(
    (session) =>
      `${session.openTime}-${session.closeTime}${session.closesNextDay ? ' (next day)' : ''}`,
  );
}

describe('isoDayOfWeek', () => {
  it('numbers Monday 1 to Sunday 7', () => {
    expect(
      ['2026-11-09', '2026-11-12', '2026-11-14', '2026-11-15', '2026-11-16'].map(isoDayOfWeek),
    ).toEqual([1, 4, 6, 7, 1]);
  });
});

describe('getServiceState and getSessionsForDate (open now)', () => {
  describe('a session crossing midnight', () => {
    const input = branch({ periods: [period('STORE', 6, '22:00', '02:00')] });

    it('belongs to Saturday, the date it starts on', () => {
      expect(hoursOf(input, '2026-11-14', 'STORE')).toEqual(['22:00-02:00 (next day)']);
      expect(hoursOf(input, '2026-11-15', 'STORE')).toEqual([]);
    });

    it('is open on Sunday 01:00 and changes at 02:00', () => {
      expect(getServiceState(input, vn('2026-11-15T01:00:00'), 'STORE')).toEqual({
        isOpen: true,
        acceptingOrders: true,
        acceptingUntil: vn('2026-11-15T02:00:00'),
        nextChangeAt: vn('2026-11-15T02:00:00'),
      });
    });

    it('is closed at 02:00 sharp, the next change being the next Saturday 22:00', () => {
      expect(getServiceState(input, vn('2026-11-15T02:00:00'), 'STORE')).toEqual({
        isOpen: false,
        acceptingOrders: false,
        acceptingUntil: null,
        nextChangeAt: vn('2026-11-21T22:00:00'),
        reason: 'CLOSED',
      });
    });

    it('runs from Sunday night into Monday across the week boundary', () => {
      const sunday = branch({ periods: [period('STORE', 7, '22:00', '02:00')] });

      const state = getServiceState(sunday, vn('2026-11-16T01:30:00'), 'STORE');

      expect(state.isOpen).toBe(true);
      expect(state.nextChangeAt).toEqual(vn('2026-11-16T02:00:00'));
    });

    it('joins a 02:00 close and a 02:00 open into one session', () => {
      const joined = branch({
        periods: [period('STORE', 6, '22:00', '02:00'), period('STORE', 7, '02:00', '10:00')],
      });

      expect(getServiceState(joined, vn('2026-11-15T01:00:00'), 'STORE').nextChangeAt).toEqual(
        vn('2026-11-15T10:00:00'),
      );
    });
  });

  describe('two shifts in a day', () => {
    const input = branch({
      periods: [period('STORE', 1, '10:00', '14:00'), period('STORE', 1, '17:00', '22:00')],
    });

    it('lists both shifts in order', () => {
      expect(hoursOf(input, '2026-11-09', 'STORE')).toEqual(['10:00-14:00', '17:00-22:00']);
    });

    it('is open in a shift until its end', () => {
      const state = getServiceState(input, vn('2026-11-09T13:00:00'), 'STORE');

      expect(state.isOpen).toBe(true);
      expect(state.nextChangeAt).toEqual(vn('2026-11-09T14:00:00'));
    });

    it('is closed in the gap, at 14:00 sharp included, until 17:00', () => {
      for (const wallClock of ['2026-11-09T14:00:00', '2026-11-09T15:30:00']) {
        const state = getServiceState(input, vn(wallClock), 'STORE');

        expect(state.isOpen).toBe(false);
        expect(state.reason).toBe('CLOSED');
        expect(state.nextChangeAt).toEqual(vn('2026-11-09T17:00:00'));
      }
    });
  });

  describe('special days', () => {
    it('a closed special day keeps the previous night session running to its end', () => {
      const input = branch({
        periods: [period('STORE', 6, '22:00', '02:00'), period('STORE', 7, '10:00', '20:00')],
        specialDays: [special('STORE', '2026-11-15', '2026-11-15', 'closed')],
      });

      expect(hoursOf(input, '2026-11-15', 'STORE')).toEqual([]);
      const night = getServiceState(input, vn('2026-11-15T01:00:00'), 'STORE');
      expect(night.isOpen).toBe(true);
      expect(night.nextChangeAt).toEqual(vn('2026-11-15T02:00:00'));
      const noon = getServiceState(input, vn('2026-11-15T12:00:00'), 'STORE');
      expect(noon.isOpen).toBe(false);
      expect(noon.nextChangeAt).toEqual(vn('2026-11-21T22:00:00'));
    });

    it('a three-day range replaces the weekly hours of every date it covers, and only those', () => {
      const input = branch({
        periods: everyDay('STORE', '08:00', '22:00'),
        specialDays: [
          special('STORE', '2026-11-10', '2026-11-12', { openTime: '10:00', closeTime: '14:00' }),
        ],
      });

      expect(
        ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((date) =>
          hoursOf(input, date, 'STORE'),
        ),
      ).toEqual([
        ['08:00-22:00'],
        ['10:00-14:00'],
        ['10:00-14:00'],
        ['10:00-14:00'],
        ['08:00-22:00'],
      ]);
      expect(getServiceState(input, vn('2026-11-11T09:00:00'), 'STORE')).toMatchObject({
        isOpen: false,
        nextChangeAt: vn('2026-11-11T10:00:00'),
      });
      expect(getServiceState(input, vn('2026-11-12T15:00:00'), 'STORE')).toMatchObject({
        isOpen: false,
        nextChangeAt: vn('2026-11-13T08:00:00'),
      });
    });

    it('a special day opens a weekday that is normally closed', () => {
      const weekdays = [1, 2, 3, 4, 5, 6].map((day) => period('STORE', day, '10:00', '22:00'));
      const input = branch({
        periods: weekdays,
        specialDays: [
          special('STORE', '2026-11-15', '2026-11-15', { openTime: '09:00', closeTime: '12:00' }),
        ],
      });

      expect(hoursOf(input, '2026-11-15', 'STORE')).toEqual(['09:00-12:00']);
      expect(hoursOf(input, '2026-11-22', 'STORE')).toEqual([]);
      expect(getServiceState(input, vn('2026-11-15T10:00:00'), 'STORE')).toMatchObject({
        isOpen: true,
        nextChangeAt: vn('2026-11-15T12:00:00'),
      });
    });

    it('a special day of one service leaves the other service on its weekly hours', () => {
      const input = branch({
        periods: [
          ...everyDay('STORE', '08:00', '22:00'),
          ...everyDay('DELIVERY', '10:00', '20:00'),
        ],
        specialDays: [special('DELIVERY', '2026-11-11', '2026-11-11', 'closed')],
      });

      expect(hoursOf(input, '2026-11-11', 'STORE')).toEqual(['08:00-22:00']);
      expect(hoursOf(input, '2026-11-11', 'DELIVERY')).toEqual([]);
    });
  });

  describe('delivery hours (brief C12)', () => {
    it('narrower delivery hours are used inside the store hours', () => {
      const input = branch({
        periods: [
          ...everyDay('STORE', '08:00', '22:00'),
          ...everyDay('DELIVERY', '10:00', '20:00'),
        ],
      });

      expect(hoursOf(input, '2026-11-09', 'DELIVERY')).toEqual(['10:00-20:00']);
      expect(getServiceState(input, vn('2026-11-09T09:00:00'), 'STORE').isOpen).toBe(true);
      expect(getServiceState(input, vn('2026-11-09T09:00:00'), 'DELIVERY')).toMatchObject({
        isOpen: false,
        reason: 'CLOSED',
        nextChangeAt: vn('2026-11-09T10:00:00'),
      });
      expect(getServiceState(input, vn('2026-11-09T21:00:00'), 'DELIVERY').nextChangeAt).toEqual(
        vn('2026-11-10T10:00:00'),
      );
    });

    it('wider delivery hours are cut to the store hours', () => {
      const input = branch({
        periods: [
          ...everyDay('STORE', '10:00', '20:00'),
          ...everyDay('DELIVERY', '08:00', '23:00'),
        ],
      });

      expect(hoursOf(input, '2026-11-09', 'DELIVERY')).toEqual(['10:00-20:00']);
    });

    it('delivery hours on a day the store is closed give no delivery', () => {
      const input = branch({
        periods: [
          ...[1, 2, 3, 4, 5, 6].map((day) => period('STORE', day, '10:00', '22:00')),
          ...everyDay('DELIVERY', '10:00', '22:00'),
        ],
      });

      expect(hoursOf(input, '2026-11-15', 'DELIVERY')).toEqual([]);
      expect(getServiceState(input, vn('2026-11-15T12:00:00'), 'DELIVERY')).toMatchObject({
        isOpen: false,
        nextChangeAt: vn('2026-11-16T10:00:00'),
      });
    });

    it('a closed special store day closes delivery too', () => {
      const input = branch({
        periods: [
          ...everyDay('STORE', '08:00', '22:00'),
          ...everyDay('DELIVERY', '10:00', '20:00'),
        ],
        specialDays: [special('STORE', '2026-11-11', '2026-11-11', 'closed')],
      });

      expect(hoursOf(input, '2026-11-11', 'DELIVERY')).toEqual([]);
      expect(getServiceState(input, vn('2026-11-11T12:00:00'), 'DELIVERY').isOpen).toBe(false);
    });

    it('without delivery rows, delivery follows the store', () => {
      const input = branch({
        periods: [period('STORE', 1, '10:00', '14:00'), period('STORE', 6, '22:00', '02:00')],
      });

      for (const date of ['2026-11-09', '2026-11-14', '2026-11-15']) {
        expect(hoursOf(input, date, 'DELIVERY')).toEqual(hoursOf(input, date, 'STORE'));
      }
      for (const wallClock of [
        '2026-11-09T12:00:00',
        '2026-11-09T15:00:00',
        '2026-11-15T01:00:00',
      ]) {
        expect(getServiceState(input, vn(wallClock), 'DELIVERY')).toEqual(
          getServiceState(input, vn(wallClock), 'STORE'),
        );
      }
    });

    it('a delivery session crossing midnight keeps its next-day end inside the store hours', () => {
      const input = branch({
        periods: [period('STORE', 6, '18:00', '02:00'), period('DELIVERY', 6, '20:00', '01:00')],
      });

      expect(hoursOf(input, '2026-11-14', 'DELIVERY')).toEqual(['20:00-01:00 (next day)']);
      expect(hoursOf(input, '2026-11-15', 'DELIVERY')).toEqual([]);
    });
  });

  describe('order cutoff and switches', () => {
    const input = branch({
      orderCutoffMinutes: 30,
      periods: [period('STORE', 1, '10:00', '22:00')],
    });

    it('accepts orders until 21:30 of a 22:00 close', () => {
      expect(getServiceState(input, vn('2026-11-09T21:00:00'), 'STORE')).toEqual({
        isOpen: true,
        acceptingOrders: true,
        acceptingUntil: vn('2026-11-09T21:30:00'),
        nextChangeAt: vn('2026-11-09T22:00:00'),
      });
    });

    it('refuses with PAST_CUTOFF at 21:45 (and at 21:30 sharp) while still open', () => {
      for (const wallClock of ['2026-11-09T21:30:00', '2026-11-09T21:45:00']) {
        expect(getServiceState(input, vn(wallClock), 'STORE')).toEqual({
          isOpen: true,
          acceptingOrders: false,
          acceptingUntil: vn('2026-11-09T21:30:00'),
          nextChangeAt: vn('2026-11-09T22:00:00'),
          reason: 'PAST_CUTOFF',
        });
      }
    });

    it('gives SERVICE_OFF when accepts_pickup is false', () => {
      const state = getServiceState(
        { ...input, acceptsPickup: false },
        vn('2026-11-09T12:00:00'),
        'STORE',
      );

      expect(state).toEqual({
        isOpen: true,
        acceptingOrders: false,
        acceptingUntil: null,
        nextChangeAt: vn('2026-11-09T22:00:00'),
        reason: 'SERVICE_OFF',
      });
    });

    it('gives SERVICE_OFF when accepts_delivery is false, inside or outside the hours', () => {
      const off = { ...input, acceptsDelivery: false };

      expect(getServiceState(off, vn('2026-11-09T12:00:00'), 'DELIVERY').reason).toBe(
        'SERVICE_OFF',
      );
      expect(getServiceState(off, vn('2026-11-09T23:00:00'), 'DELIVERY').reason).toBe(
        'SERVICE_OFF',
      );
      expect(getServiceState(off, vn('2026-11-09T12:00:00'), 'STORE').acceptingOrders).toBe(true);
    });

    it('gives PAUSED with no next change when the branch is TEMPORARILY_CLOSED', () => {
      expect(
        getServiceState(
          { ...input, status: 'TEMPORARILY_CLOSED' },
          vn('2026-11-09T12:00:00'),
          'STORE',
        ),
      ).toEqual({
        isOpen: false,
        acceptingOrders: false,
        acceptingUntil: null,
        nextChangeAt: null,
        reason: 'PAUSED',
      });
    });

    it('gives CLOSED with no next change when the branch is CLOSED', () => {
      expect(
        getServiceState({ ...input, status: 'CLOSED' }, vn('2026-11-09T12:00:00'), 'DELIVERY'),
      ).toEqual({
        isOpen: false,
        acceptingOrders: false,
        acceptingUntil: null,
        nextChangeAt: null,
        reason: 'CLOSED',
      });
    });
  });

  describe('edges', () => {
    it('no periods at all: closed, nothing opens', () => {
      expect(getServiceState(branch(), vn('2026-11-09T12:00:00'), 'STORE')).toEqual({
        isOpen: false,
        acceptingOrders: false,
        acceptingUntil: null,
        nextChangeAt: null,
        reason: 'CLOSED',
      });
      expect(hoursOf(branch(), '2026-11-09', 'DELIVERY')).toEqual([]);
    });

    it('the 00:00 to 23:59 day closes for the last minute (brief C11 open)', () => {
      const input = branch({ periods: everyDay('STORE', '00:00', '23:59') });

      expect(hoursOf(input, '2026-11-09', 'STORE')).toEqual(['00:00-23:59']);
      expect(getServiceState(input, vn('2026-11-09T12:00:00'), 'STORE')).toMatchObject({
        isOpen: true,
        nextChangeAt: vn('2026-11-09T23:59:00'),
      });
      expect(getServiceState(input, vn('2026-11-09T23:59:30'), 'STORE')).toMatchObject({
        isOpen: false,
        nextChangeAt: vn('2026-11-10T00:00:00'),
      });
    });

    it(`looks ahead at most ${String(LOOK_AHEAD_DAYS)} days for the next opening`, () => {
      const input = branch({
        periods: [period('STORE', 1, '10:00', '22:00')],
        specialDays: [special('STORE', '2026-11-10', '2026-11-30', 'closed')],
      });

      expect(getServiceState(input, vn('2026-11-09T23:00:00'), 'STORE').nextChangeAt).toBeNull();
      expect(getServiceState(input, vn('2026-11-24T00:00:00'), 'STORE').nextChangeAt).toEqual(
        vn('2026-12-07T10:00:00'),
      );
    });

    it('reads the periods in the zone it is given, not the machine zone', () => {
      const input = branch({ timeZone: 'UTC', periods: [period('STORE', 1, '10:00', '12:00')] });

      expect(getServiceState(input, new Date('2026-11-09T11:00:00Z'), 'STORE').isOpen).toBe(true);
      expect(getServiceState(input, new Date('2026-11-09T13:00:00Z'), 'STORE').isOpen).toBe(false);
    });
  });
});

describe('getOpenState (BranchSummary openState)', () => {
  const input = branch({
    orderCutoffMinutes: 30,
    periods: [...everyDay('STORE', '08:00', '22:00'), ...everyDay('DELIVERY', '10:00', '20:00')],
  });

  it('is OPEN with the later cutoff of pickup and delivery', () => {
    expect(getOpenState(input, vn('2026-11-09T12:00:00'))).toEqual({
      state: 'OPEN',
      nextChangeAt: vn('2026-11-09T22:00:00'),
      acceptingOrders: true,
      acceptingUntil: vn('2026-11-09T21:30:00'),
      delivery: { state: 'OPEN', nextChangeAt: vn('2026-11-09T20:00:00') },
    });
  });

  it('shows delivery closed while the store is open', () => {
    expect(getOpenState(input, vn('2026-11-09T09:00:00'))).toEqual({
      state: 'OPEN',
      nextChangeAt: vn('2026-11-09T22:00:00'),
      acceptingOrders: true,
      acceptingUntil: vn('2026-11-09T21:30:00'),
      delivery: { state: 'CLOSED', nextChangeAt: vn('2026-11-09T10:00:00') },
    });
  });

  it('keeps delivery CLOSED with no next change while accepts_delivery is off', () => {
    const state = getOpenState({ ...input, acceptsDelivery: false }, vn('2026-11-09T12:00:00'));

    expect(state.delivery).toEqual({ state: 'CLOSED', nextChangeAt: null });
    expect(state.acceptingOrders).toBe(true);
  });

  it('accepts no order when both services are off, though the store is open', () => {
    const state = getOpenState(
      { ...input, acceptsPickup: false, acceptsDelivery: false },
      vn('2026-11-09T12:00:00'),
    );

    expect(state).toMatchObject({ state: 'OPEN', acceptingOrders: false, acceptingUntil: null });
  });

  it('is CLOSED with the next opening outside the hours', () => {
    expect(getOpenState(input, vn('2026-11-09T23:00:00'))).toEqual({
      state: 'CLOSED',
      nextChangeAt: vn('2026-11-10T08:00:00'),
      acceptingOrders: false,
      acceptingUntil: null,
      delivery: { state: 'CLOSED', nextChangeAt: vn('2026-11-10T10:00:00') },
    });
  });

  it.each([
    ['TEMPORARILY_CLOSED', 'TEMPORARILY_CLOSED'],
    ['CLOSED', 'CLOSED'],
  ] as const)('a %s branch has state %s and no next change', (status, state) => {
    expect(getOpenState({ ...input, status }, vn('2026-11-09T12:00:00'))).toEqual({
      state,
      nextChangeAt: null,
      acceptingOrders: false,
      acceptingUntil: null,
      delivery: { state, nextChangeAt: null },
    });
  });
});

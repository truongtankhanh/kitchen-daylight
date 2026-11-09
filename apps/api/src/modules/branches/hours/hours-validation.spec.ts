import { describe, expect, it } from 'vitest';

import {
  historyOverlapErrors,
  SPECIAL_DISPLAY_NOTE_MAX_LENGTH,
  SPECIAL_NOTE_MAX_LENGTH,
  validateHours,
} from './hours-validation.js';
import type { HoursInput } from './hours-validation.js';

// `PUT /admin/branches/{id}/hours` rules (brief C14, C15, C16; api-outline field-level codes
// `OVERLAP`, `EQUAL_TIMES`, `INVALID_TIME`, `RANGE_INVALID`). Today is Monday 2026-11-09.

const TODAY = '2026-11-09';

function codes(input: Partial<HoursInput>): { field: string; code: string }[] {
  return validateHours({ periods: [], special: [], ...input }, TODAY).errors.map(
    ({ field, code }) => ({ field, code }),
  );
}

function storePeriod(dayOfWeek: number, openTime: string, closeTime: string): object {
  return { service: 'STORE', dayOfWeek, openTime, closeTime };
}

function openDay(startsOn: string, endsOn: string, extra: object = {}): object {
  return {
    startsOn,
    endsOn,
    service: 'STORE',
    isClosed: false,
    openTime: '10:00',
    closeTime: '14:00',
    ...extra,
  };
}

function closedDay(startsOn: string, endsOn: string, extra: object = {}): object {
  return { startsOn, endsOn, service: 'STORE', isClosed: true, ...extra };
}

describe('validateHours', () => {
  it('accepts a valid week and special days, deriving closesNextDay and trimming notes', () => {
    const result = validateHours(
      {
        periods: [
          storePeriod(1, '10:00', '14:00'),
          storePeriod(1, '17:00', '22:00'),
          storePeriod(6, '22:00', '02:00'),
          storePeriod(7, '02:00', '23:59'),
          { service: 'DELIVERY', dayOfWeek: 1, openTime: '10:00', closeTime: '13:00' },
        ],
        special: [
          closedDay('2026-11-09', '2026-11-11', { note: '  Sửa bếp  ', displayNote: 'Nghỉ' }),
          openDay('2026-11-20', '2026-11-20', { note: '   ', displayNote: null }),
        ],
      },
      TODAY,
    );

    expect(result.errors).toEqual([]);
    expect(result.periods.map((period) => period.closesNextDay)).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
    expect(result.special).toEqual([
      {
        startsOn: '2026-11-09',
        endsOn: '2026-11-11',
        service: 'STORE',
        isClosed: true,
        openTime: null,
        closeTime: null,
        closesNextDay: null,
        note: 'Sửa bếp',
        displayNote: 'Nghỉ',
      },
      {
        startsOn: '2026-11-20',
        endsOn: '2026-11-20',
        service: 'STORE',
        isClosed: false,
        openTime: '10:00',
        closeTime: '14:00',
        closesNextDay: false,
        note: null,
        displayNote: null,
      },
    ]);
  });

  it('accepts empty lists (no hours at all)', () => {
    expect(codes({})).toEqual([]);
  });

  describe('INVALID_TIME, REQUIRED and EQUAL_TIMES', () => {
    it.each(['24:00', '9:00', '12:60', '12:00:00', ' 12:00', '', 900])(
      'refuses %j as a time',
      (value) => {
        expect(
          codes({
            periods: [storePeriod(1, '10:00', '14:00'), storePeriod(2, '10:00', value as string)],
          }),
        ).toEqual([{ field: 'periods[1].closeTime', code: 'INVALID_TIME' }]);
      },
    );

    it('requires both times of a period', () => {
      expect(codes({ periods: [{ service: 'STORE', dayOfWeek: 1 }] })).toEqual([
        { field: 'periods[0].openTime', code: 'REQUIRED' },
        { field: 'periods[0].closeTime', code: 'REQUIRED' },
      ]);
    });

    it('requires both times on a special day that is not closed', () => {
      expect(
        codes({ special: [openDay(TODAY, TODAY, { openTime: undefined, closeTime: null })] }),
      ).toEqual([
        { field: 'special[0].openTime', code: 'REQUIRED' },
        { field: 'special[0].closeTime', code: 'REQUIRED' },
      ]);
    });

    it('refuses equal open and close times, on a period and on a special day', () => {
      expect(
        codes({
          periods: [storePeriod(3, '10:00', '10:00')],
          special: [openDay(TODAY, TODAY, { openTime: '09:00', closeTime: '09:00' })],
        }),
      ).toEqual([
        { field: 'periods[0].closeTime', code: 'EQUAL_TIMES' },
        { field: 'special[0].closeTime', code: 'EQUAL_TIMES' },
      ]);
    });

    it('accepts the 24-hour day stored as 00:00 to 23:59 (brief C11)', () => {
      expect(codes({ periods: [storePeriod(1, '00:00', '23:59')] })).toEqual([]);
    });
  });

  describe('OVERLAP of weekly periods', () => {
    it('refuses two periods of one day that share a minute, on the later one', () => {
      expect(
        codes({ periods: [storePeriod(1, '10:00', '14:00'), storePeriod(1, '13:00', '18:00')] }),
      ).toEqual([{ field: 'periods[1].openTime', code: 'OVERLAP' }]);
    });

    it('accepts periods that only touch (14:00 close, 14:00 open)', () => {
      expect(
        codes({ periods: [storePeriod(1, '10:00', '14:00'), storePeriod(1, '14:00', '18:00')] }),
      ).toEqual([]);
    });

    it('refuses a period crossing midnight into the next day’s first period', () => {
      expect(
        codes({ periods: [storePeriod(2, '06:00', '10:00'), storePeriod(1, '22:00', '07:00')] }),
      ).toEqual([{ field: 'periods[1].openTime', code: 'OVERLAP' }]);
    });

    it('refuses Sunday night running into Monday morning', () => {
      expect(
        codes({ periods: [storePeriod(7, '22:00', '02:00'), storePeriod(1, '01:00', '05:00')] }),
      ).toEqual([{ field: 'periods[1].openTime', code: 'OVERLAP' }]);
    });

    it('accepts the same hours for STORE and DELIVERY', () => {
      expect(
        codes({
          periods: [
            storePeriod(1, '10:00', '14:00'),
            { service: 'DELIVERY', dayOfWeek: 1, openTime: '10:00', closeTime: '14:00' },
          ],
        }),
      ).toEqual([]);
    });
  });

  describe('special days', () => {
    it('refuses RANGE_INVALID when startsOn is after endsOn', () => {
      expect(codes({ special: [closedDay('2026-11-12', '2026-11-10')] })).toEqual([
        { field: 'special[0].endsOn', code: 'RANGE_INVALID' },
      ]);
    });

    it('refuses a range that ended before today (history is read-only)', () => {
      expect(codes({ special: [closedDay('2026-11-01', '2026-11-08')] })).toEqual([
        { field: 'special[0].endsOn', code: 'OUT_OF_RANGE' },
      ]);
    });

    it('accepts a range that started before today and ends today or later', () => {
      expect(codes({ special: [closedDay('2026-11-01', TODAY)] })).toEqual([]);
    });

    it('refuses two ranges of one service that share a day, on the later one', () => {
      expect(
        codes({
          special: [closedDay('2026-11-10', '2026-11-12'), openDay('2026-11-12', '2026-11-12')],
        }),
      ).toEqual([{ field: 'special[1].startsOn', code: 'OVERLAP' }]);
    });

    it('accepts back-to-back ranges and the same range for the other service', () => {
      expect(
        codes({
          special: [
            closedDay('2026-11-10', '2026-11-12'),
            openDay('2026-11-13', '2026-11-13'),
            { ...closedDay('2026-11-10', '2026-11-12'), service: 'DELIVERY' },
          ],
        }),
      ).toEqual([]);
    });

    it('refuses times on a closed day', () => {
      expect(
        codes({ special: [closedDay(TODAY, TODAY, { openTime: '10:00', closeTime: '12:00' })] }),
      ).toEqual([
        { field: 'special[0].openTime', code: 'INVALID' },
        { field: 'special[0].closeTime', code: 'INVALID' },
      ]);
    });

    it('requires dates, service and isClosed, and refuses a date that does not exist', () => {
      expect(codes({ special: [{ startsOn: '2026-02-30' }] })).toEqual([
        { field: 'special[0].startsOn', code: 'INVALID' },
        { field: 'special[0].endsOn', code: 'REQUIRED' },
        { field: 'special[0].service', code: 'REQUIRED' },
        { field: 'special[0].isClosed', code: 'REQUIRED' },
      ]);
    });

    it('limits note to 200 and displayNote to 80 characters (code points)', () => {
      const fits = { note: 'n'.repeat(SPECIAL_NOTE_MAX_LENGTH), displayNote: '🎉'.repeat(80) };
      const tooLong = {
        note: 'n'.repeat(SPECIAL_NOTE_MAX_LENGTH + 1),
        displayNote: 'd'.repeat(SPECIAL_DISPLAY_NOTE_MAX_LENGTH + 1),
      };

      expect(SPECIAL_DISPLAY_NOTE_MAX_LENGTH).toBe(80);
      expect(codes({ special: [closedDay(TODAY, TODAY, fits)] })).toEqual([]);
      expect(codes({ special: [closedDay(TODAY, TODAY, tooLong)] })).toEqual([
        { field: 'special[0].note', code: 'TOO_LONG' },
        { field: 'special[0].displayNote', code: 'TOO_LONG' },
      ]);
    });
  });

  describe('item shape', () => {
    it('refuses closesNextDay from the client and any other unknown key', () => {
      expect(
        codes({
          periods: [{ ...storePeriod(1, '22:00', '02:00'), closesNextDay: true }],
          special: [closedDay(TODAY, TODAY, { id: 'x' })],
        }),
      ).toEqual([
        { field: 'periods[0].closesNextDay', code: 'INVALID' },
        { field: 'special[0].id', code: 'INVALID' },
      ]);
    });

    it('refuses an item that is not an object', () => {
      expect(codes({ periods: ['10:00-14:00'], special: [null] })).toEqual([
        { field: 'periods[0]', code: 'INVALID' },
        { field: 'special[0]', code: 'INVALID' },
      ]);
    });

    it('checks service and dayOfWeek', () => {
      expect(
        codes({
          periods: [
            { service: 'PICKUP', dayOfWeek: 0, openTime: '10:00', closeTime: '12:00' },
            { service: 'STORE', dayOfWeek: 1.5, openTime: '10:00', closeTime: '12:00' },
            { dayOfWeek: 8, openTime: '10:00', closeTime: '12:00' },
          ],
        }),
      ).toEqual([
        { field: 'periods[0].service', code: 'INVALID' },
        { field: 'periods[0].dayOfWeek', code: 'OUT_OF_RANGE' },
        { field: 'periods[1].dayOfWeek', code: 'INVALID' },
        { field: 'periods[2].service', code: 'REQUIRED' },
        { field: 'periods[2].dayOfWeek', code: 'OUT_OF_RANGE' },
      ]);
    });

    it('reports every invalid item at once', () => {
      expect(
        codes({
          periods: [storePeriod(1, '10:00', '14:00'), storePeriod(2, '25:00', '12:00')],
          special: [closedDay('2026-11-12', '2026-11-10')],
        }),
      ).toEqual([
        { field: 'periods[1].openTime', code: 'INVALID_TIME' },
        { field: 'special[0].endsOn', code: 'RANGE_INVALID' },
      ]);
    });
  });
});

describe('historyOverlapErrors', () => {
  const sent = validateHours(
    {
      periods: [],
      special: [closedDay('2026-11-05', '2026-11-10'), closedDay('2026-11-20', '2026-11-21')],
    },
    TODAY,
  ).special;

  it('refuses a range that overlaps a kept past range of the same service', () => {
    expect(
      historyOverlapErrors(sent, [
        { service: 'STORE', startsOn: '2026-11-01', endsOn: '2026-11-06' },
      ]),
    ).toEqual([
      { field: 'special[0].startsOn', code: 'OVERLAP', message: 'overlaps a past special day' },
    ]);
  });

  it('ignores past ranges of the other service or that end before the range starts', () => {
    expect(
      historyOverlapErrors(sent, [
        { service: 'DELIVERY', startsOn: '2026-11-01', endsOn: '2026-11-06' },
        { service: 'STORE', startsOn: '2026-11-01', endsOn: '2026-11-04' },
      ]),
    ).toEqual([]);
  });
});

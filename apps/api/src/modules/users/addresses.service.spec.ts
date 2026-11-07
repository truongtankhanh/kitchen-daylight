import type { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../common/errors/api-error.js';
import {
  AddressesService,
  addressLimitError,
  buildAddressUpdate,
  CLEAR_DEFAULT_SQL,
  COUNT_ACTIVE_SQL,
  INSERT_ADDRESS_SQL,
  LOCK_OWNER_SQL,
  LOOKUP_UNITS_SQL,
  MAX_SAVED_ADDRESSES,
  mustClearPreviousDefault,
  planAddressInput,
  toAddressView,
  unitFieldErrors,
} from './addresses.service.js';
import type { AddressInput, AddressRow } from './addresses.service.js';

// Fictional values only; the phone numbers are well-formed but made up, the codes are not official.

const USER_ID = '01930000-0000-7000-8000-00000000a001';
const ADDRESS_ID = '01930000-0000-7000-8000-00000000a101';

const VALID_INPUT: AddressInput = {
  label: 'Nhà',
  recipientName: 'Người Nhận Mẫu',
  phone: '090 123 4567',
  addressLine: '1 Đường Mẫu',
  provinceCode: '90',
  wardCode: '90001',
  location: { lat: 10.7769, lng: 106.7009 },
};

const ROW: AddressRow = {
  id: ADDRESS_ID,
  label: 'Nhà',
  recipient_name: 'Người Nhận Mẫu',
  phone: '+84901234567',
  address_line: '1 Đường Mẫu',
  province_code: '90',
  ward_code: '90001',
  lat: 10.7769,
  lng: 106.7009,
  note: null,
  is_default: false,
  created_at: new Date('2026-11-07T03:00:00.000Z'),
  updated_at: new Date('2026-11-07T03:00:00.000Z'),
};

interface Call {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

/**
 * A `DataSource` whose transaction runs the work on a recording manager. The answers mimic the
 * TypeORM postgres driver: rows for `SELECT` and `INSERT`, `[rows, rowCount]` for `UPDATE`.
 */
function fakeDataSource(options: {
  activeCount?: number;
  current?: AddressRow;
  provinceFound?: boolean;
  wardFound?: boolean;
}) {
  const calls: Call[] = [];
  const query = (sql: string, parameters: unknown[] = []): Promise<unknown> => {
    calls.push({ sql, parameters });
    if (sql === LOCK_OWNER_SQL) return Promise.resolve([{ id: USER_ID }]);
    if (sql === LOOKUP_UNITS_SQL) {
      return Promise.resolve([
        {
          province_found: options.provinceFound ?? true,
          ward_found: options.wardFound ?? true,
        },
      ]);
    }
    if (sql === COUNT_ACTIVE_SQL) return Promise.resolve([{ total: options.activeCount ?? 0 }]);
    if (sql === CLEAR_DEFAULT_SQL) return Promise.resolve([[], 1]);
    if (sql === INSERT_ADDRESS_SQL) return Promise.resolve([ROW]);
    if (sql.trimStart().startsWith('SELECT')) {
      return Promise.resolve(options.current === undefined ? [] : [options.current]);
    }
    if (sql.trimStart().startsWith('UPDATE')) return Promise.resolve([[ROW], 1]);
    return Promise.reject(new Error(`unexpected SQL: ${sql}`));
  };
  const manager = { query };
  const dataSource = {
    manager,
    query,
    transaction: <T>(work: (em: typeof manager) => Promise<T>): Promise<T> => work(manager),
  } as unknown as DataSource;
  return { dataSource, calls };
}

async function expectApiError(
  work: Promise<unknown>,
  code: string,
  errors?: readonly unknown[],
): Promise<void> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe(code);
  if (errors !== undefined) {
    expect((error as ApiError).errors).toEqual(errors);
  }
}

describe('planAddressInput', () => {
  it('normalises a full body: trimmed text, E.164 phone, the note in `note`', () => {
    const { changes, errors } = planAddressInput(
      { ...VALID_INPUT, label: '  Nhà  ', deliveryNote: '  Gọi trước  ', isDefault: true },
      { requireAll: true },
    );

    expect(errors).toEqual([]);
    expect(changes).toEqual({
      label: 'Nhà',
      recipientName: 'Người Nhận Mẫu',
      phone: '+84901234567',
      addressLine: '1 Đường Mẫu',
      provinceCode: '90',
      wardCode: '90001',
      location: { lat: 10.7769, lng: 106.7009 },
      note: 'Gọi trước',
      isDefault: true,
    });
  });

  it('reports every missing required field when creating', () => {
    expect(planAddressInput({}, { requireAll: true }).errors.map((error) => error.field)).toEqual([
      'label',
      'recipientName',
      'addressLine',
      'phone',
      'provinceCode',
      'location',
    ]);
  });

  it('changes nothing for an empty patch', () => {
    expect(planAddressInput({}, { requireAll: false })).toEqual({ changes: {}, errors: [] });
  });

  it('refuses blank text with REQUIRED and a non-mobile phone with INVALID_PHONE, never echoing it', () => {
    const { changes, errors } = planAddressInput(
      { label: '   ', phone: '0281234567' },
      { requireAll: false },
    );

    expect(changes).toEqual({});
    expect(errors).toEqual([
      { field: 'label', code: 'REQUIRED', message: 'is required' },
      { field: 'phone', code: 'INVALID_PHONE', message: 'must be a Vietnamese mobile number' },
    ]);
    expect(JSON.stringify(errors)).not.toContain('0281234567');
  });

  it('clears the ward and the note with null, and stores a blank note as none', () => {
    expect(planAddressInput({ wardCode: null, deliveryNote: null }, { requireAll: false })).toEqual(
      { changes: { wardCode: null, note: null }, errors: [] },
    );
    expect(planAddressInput({ deliveryNote: '   ' }, { requireAll: false }).changes).toEqual({
      note: null,
    });
  });
});

describe('mustClearPreviousDefault', () => {
  it.each([
    [true, false, true],
    [true, true, false],
    [false, false, false],
    [false, true, false],
    [undefined, false, false],
    [undefined, true, false],
  ] as const)('requested %j on a default=%j address → clear first: %j', (requested, now, clear) => {
    expect(mustClearPreviousDefault(requested, now)).toBe(clear);
  });
});

describe('addressLimitError', () => {
  it(`allows up to ${MAX_SAVED_ADDRESSES} addresses`, () => {
    expect(MAX_SAVED_ADDRESSES).toBe(10);
    expect(addressLimitError(0)).toBeNull();
    expect(addressLimitError(MAX_SAVED_ADDRESSES - 1)).toBeNull();
  });

  it('refuses the next one with LIMIT_REACHED on the field `address`', () => {
    expect(addressLimitError(MAX_SAVED_ADDRESSES)).toEqual({
      field: 'address',
      code: 'LIMIT_REACHED',
      message: 'at most 10 saved addresses',
    });
    expect(addressLimitError(MAX_SAVED_ADDRESSES + 3)?.code).toBe('LIMIT_REACHED');
  });
});

describe('unitFieldErrors', () => {
  it('reports an unknown province on provinceCode only', () => {
    expect(unitFieldErrors({ provinceFound: false, wardFound: false })).toEqual([
      { field: 'provinceCode', code: 'NOT_FOUND', message: 'does not exist' },
    ]);
  });

  it('reports an unknown ward, or one outside the province, on wardCode', () => {
    expect(unitFieldErrors({ provinceFound: true, wardFound: false })).toEqual([
      { field: 'wardCode', code: 'NOT_FOUND', message: 'does not exist in this province' },
    ]);
    expect(unitFieldErrors({ provinceFound: true, wardFound: true })).toEqual([]);
  });
});

describe('toAddressView', () => {
  it('returns the note as deliveryNote and the pin as { lat, lng }', () => {
    expect(toAddressView({ ...ROW, note: 'Gọi trước' })).toEqual({
      id: ADDRESS_ID,
      label: 'Nhà',
      recipientName: 'Người Nhận Mẫu',
      phone: '+84901234567',
      addressLine: '1 Đường Mẫu',
      provinceCode: '90',
      wardCode: '90001',
      location: { lat: 10.7769, lng: 106.7009 },
      deliveryNote: 'Gọi trước',
      isDefault: false,
      createdAt: '2026-11-07T03:00:00.000Z',
      updatedAt: '2026-11-07T03:00:00.000Z',
    });
  });
});

describe('buildAddressUpdate', () => {
  it('numbers the parameters after the id and the user, the pin as lng then lat', () => {
    const { sets, parameters } = buildAddressUpdate(
      { label: 'Công ty', location: { lat: 10.5, lng: 106.5 }, note: null },
      { is_default: false },
    );

    expect(sets).toEqual([
      'label = $3',
      'location = ST_SetSRID(ST_MakePoint($4::double precision, $5::double precision), 4326)::geography',
      'note = $6',
    ]);
    expect(parameters).toEqual(['Công ty', 106.5, 10.5, null]);
  });

  it('leaves is_default out when it does not change', () => {
    expect(buildAddressUpdate({ isDefault: true }, { is_default: true }).sets).toEqual([]);
    expect(buildAddressUpdate({ isDefault: false }, { is_default: true }).sets).toEqual([
      'is_default = $3',
    ]);
  });
});

describe('AddressesService default switch and limit', () => {
  it('clears the previous default before inserting a new default, after the lock', async () => {
    const { dataSource, calls } = fakeDataSource({ activeCount: 2 });

    await new AddressesService(dataSource).create(USER_ID, { ...VALID_INPUT, isDefault: true });

    expect(calls.map((call) => call.sql)).toEqual([
      LOCK_OWNER_SQL,
      LOOKUP_UNITS_SQL,
      COUNT_ACTIVE_SQL,
      CLEAR_DEFAULT_SQL,
      INSERT_ADDRESS_SQL,
    ]);
    expect(calls[3]?.parameters).toEqual([USER_ID]);
    // The insert writes lng ($8) before lat ($9) and is_default ($11).
    expect(calls[4]?.parameters).toEqual([
      USER_ID,
      'Nhà',
      'Người Nhận Mẫu',
      '+84901234567',
      '1 Đường Mẫu',
      '90',
      '90001',
      106.7009,
      10.7769,
      null,
      true,
    ]);
  });

  it('does not make the first address the default on its own, nor clear anything', async () => {
    const { dataSource, calls } = fakeDataSource({ activeCount: 0 });

    await new AddressesService(dataSource).create(USER_ID, VALID_INPUT);

    expect(calls.map((call) => call.sql)).not.toContain(CLEAR_DEFAULT_SQL);
    expect(calls.at(-1)?.parameters.at(-1)).toBe(false);
  });

  it(`refuses address number ${MAX_SAVED_ADDRESSES + 1} with LIMIT_REACHED and writes nothing`, async () => {
    const { dataSource, calls } = fakeDataSource({ activeCount: MAX_SAVED_ADDRESSES });

    await expectApiError(
      new AddressesService(dataSource).create(USER_ID, { ...VALID_INPUT, isDefault: true }),
      'VALIDATION_FAILED',
      [{ field: 'address', code: 'LIMIT_REACHED', message: 'at most 10 saved addresses' }],
    );
    expect(calls.map((call) => call.sql)).not.toContain(CLEAR_DEFAULT_SQL);
    expect(calls.map((call) => call.sql)).not.toContain(INSERT_ADDRESS_SQL);
  });

  it('accepts address number 10', async () => {
    const { dataSource, calls } = fakeDataSource({ activeCount: MAX_SAVED_ADDRESSES - 1 });

    await new AddressesService(dataSource).create(USER_ID, VALID_INPUT);

    expect(calls.at(-1)?.sql).toBe(INSERT_ADDRESS_SQL);
  });

  it('collects the body and province errors before the limit is looked at', async () => {
    const { dataSource, calls } = fakeDataSource({
      activeCount: MAX_SAVED_ADDRESSES,
      provinceFound: false,
    });

    await expectApiError(
      new AddressesService(dataSource).create(USER_ID, { ...VALID_INPUT, phone: '12345' }),
      'VALIDATION_FAILED',
      [
        { field: 'phone', code: 'INVALID_PHONE', message: 'must be a Vietnamese mobile number' },
        { field: 'provinceCode', code: 'NOT_FOUND', message: 'does not exist' },
      ],
    );
    expect(calls.map((call) => call.sql)).not.toContain(COUNT_ACTIVE_SQL);
  });

  it('clears the previous default before setting it on an existing address', async () => {
    const { dataSource, calls } = fakeDataSource({ current: ROW });

    await new AddressesService(dataSource).update(USER_ID, ADDRESS_ID, { isDefault: true });

    const sql = calls.map((call) => call.sql);
    const clearAt = sql.indexOf(CLEAR_DEFAULT_SQL);
    expect(clearAt).toBeGreaterThan(-1);
    expect(sql[clearAt + 1]).toMatch(/^UPDATE public\.customer_addresses SET is_default = \$3/u);
  });

  it('neither clears nor writes when the address is already the default', async () => {
    const { dataSource, calls } = fakeDataSource({ current: { ...ROW, is_default: true } });

    await new AddressesService(dataSource).update(USER_ID, ADDRESS_ID, { isDefault: true });

    expect(calls.map((call) => call.sql)).toEqual([LOCK_OWNER_SQL, expect.any(String)]);
  });

  it('unsets the default with isDefault false and chooses no other one', async () => {
    const { dataSource, calls } = fakeDataSource({ current: { ...ROW, is_default: true } });

    await new AddressesService(dataSource).update(USER_ID, ADDRESS_ID, { isDefault: false });

    expect(calls.map((call) => call.sql)).not.toContain(CLEAR_DEFAULT_SQL);
    expect(calls.at(-1)?.parameters).toEqual([ADDRESS_ID, USER_ID, false]);
  });

  it('answers NOT_FOUND for an address the user does not own, before any check', async () => {
    const { dataSource, calls } = fakeDataSource({});

    await expectApiError(
      new AddressesService(dataSource).update(USER_ID, ADDRESS_ID, { wardCode: '90001' }),
      'NOT_FOUND',
    );
    expect(calls.map((call) => call.sql)).not.toContain(LOOKUP_UNITS_SQL);
  });

  it('checks a kept ward against a new province', async () => {
    const { dataSource, calls } = fakeDataSource({ current: ROW, wardFound: false });

    await expectApiError(
      new AddressesService(dataSource).update(USER_ID, ADDRESS_ID, { provinceCode: '93' }),
      'VALIDATION_FAILED',
      [{ field: 'wardCode', code: 'NOT_FOUND', message: 'does not exist in this province' }],
    );
    expect(calls.find((call) => call.sql === LOOKUP_UNITS_SQL)?.parameters).toEqual([
      '93',
      '90001',
    ]);
  });
});

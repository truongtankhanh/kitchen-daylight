import { describe, expect, it } from 'vitest';

import { storageKeyRule } from './ports/storage.port.js';
import {
  MEDIA_STORAGE_KEY,
  mediaObjectKeys,
  mediaStorageKey,
  mediaVariantKey,
  newMediaId,
} from './media-key.js';

const ID = '01930000-0000-7000-8000-000000006301';
const CREATED_AT = new Date('2026-11-10T03:04:05.000Z');

describe('media keys', () => {
  it('builds media/<yyyy>/<mm>/<id> from the id and the UTC month', () => {
    expect(mediaStorageKey(ID, CREATED_AT)).toBe(`media/2026/11/${ID}`);
  });

  it('uses the UTC month, not the Vietnam one', () => {
    // 2026-11-30T20:00Z is already 1 December in Asia/Ho_Chi_Minh.
    expect(mediaStorageKey(ID, new Date('2026-11-30T20:00:00.000Z'))).toBe(`media/2026/11/${ID}`);
  });

  it('builds one key per variant under the storage key', () => {
    const storageKey = mediaStorageKey(ID, CREATED_AT);

    expect(mediaVariantKey(storageKey, 'large')).toBe(`media/2026/11/${ID}/large.webp`);
    expect(mediaObjectKeys(storageKey)).toEqual([
      `media/2026/11/${ID}/thumb.webp`,
      `media/2026/11/${ID}/medium.webp`,
      `media/2026/11/${ID}/large.webp`,
      `media/2026/11/${ID}/master.webp`,
    ]);
  });

  it('produces keys the storage port accepts', () => {
    for (const key of mediaObjectKeys(mediaStorageKey(newMediaId(), CREATED_AT))) {
      expect(storageKeyRule(key)).toBeUndefined();
    }
  });

  it('generates UUIDv7 ids that make valid keys', () => {
    const id = newMediaId();

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(mediaStorageKey(id, CREATED_AT)).toMatch(MEDIA_STORAGE_KEY);
  });

  it.each([
    '../../x.jpg',
    'ảnh món phở.jpg',
    'Bánh mì Đà Nẵng.png',
    `${ID}/../../etc`,
    `${ID}.jpg`,
    // Upper-case hex: not the canonical form PostgreSQL prints.
    '0193ABCD-0000-7000-8000-00000000ABCD',
    '',
  ])('refuses %j as a media id, so a file name can never become a key', (hostile) => {
    expect(() => mediaStorageKey(hostile, CREATED_AT)).toThrow(/canonical UUID/u);
  });

  it('builds the same key whatever the uploaded file was called', () => {
    // The builder takes no name: two uploads named differently get keys from their ids only.
    const key = mediaStorageKey(ID, CREATED_AT);
    for (const name of ['../../x.jpg', 'ảnh món phở.jpg', 'a\u0000b.png']) {
      expect(key).not.toContain(name);
      expect(key).not.toContain('..');
      expect(key).not.toContain('ả');
      expect(key).not.toContain('\u0000');
    }
    expect(key).toMatch(MEDIA_STORAGE_KEY);
  });

  it('refuses a variant key under anything but a media storage key', () => {
    expect(() => mediaVariantKey('media/2026/11/../../x', 'large')).toThrow();
    expect(() => mediaVariantKey(`exports/2026/11/${ID}`, 'large')).toThrow();
    expect(() => mediaVariantKey(`media/2026/13/${ID}`, 'large')).toThrow();
  });

  it('refuses an invalid date', () => {
    expect(() => mediaStorageKey(ID, new Date(Number.NaN))).toThrow(/invalid creation date/u);
  });
});

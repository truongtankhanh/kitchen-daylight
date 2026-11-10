import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { IMAGE_CONTENT_TYPES, sniffImageType } from './image-sniffer.js';

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function tinyImage(format: 'jpeg' | 'png' | 'webp' | 'gif'): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: '#336699' } })
    .toFormat(format)
    .toBuffer();
}

describe('sniffImageType', () => {
  const real: Partial<Record<'jpeg' | 'png' | 'webp' | 'gif', Buffer>> = {};

  beforeAll(async () => {
    for (const format of ['jpeg', 'png', 'webp', 'gif'] as const) {
      real[format] = await tinyImage(format);
    }
  });

  it('accepts JPEG, PNG and WebP from their magic bytes', () => {
    expect(sniffImageType(real.jpeg as Buffer)).toBe('jpeg');
    expect(sniffImageType(real.png as Buffer)).toBe('png');
    expect(sniffImageType(real.webp as Buffer)).toBe('webp');
  });

  it('accepts the bare signatures', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff))).toBe('jpeg');
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png');
    expect(
      sniffImageType(Buffer.from([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')])),
    ).toBe('webp');
  });

  it('refuses SVG, also with an XML declaration', () => {
    expect(
      sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    ).toBeNull();
    expect(sniffImageType(Buffer.from('<?xml version="1.0"?><svg></svg>'))).toBeNull();
  });

  it('refuses GIF', () => {
    expect(sniffImageType(real.gif as Buffer)).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeNull();
  });

  it('refuses a HEIC header', () => {
    // ISO BMFF: a 4-byte box size, then `ftyp` and the brand `heic`.
    const heic = Buffer.from([0, 0, 0, 0x18, ...Buffer.from('ftypheic'), 0, 0, 0, 0]);
    expect(sniffImageType(heic)).toBeNull();
  });

  it('refuses AVIF, TIFF and BMP headers', () => {
    expect(sniffImageType(Buffer.from([0, 0, 0, 0x1c, ...Buffer.from('ftypavif')]))).toBeNull();
    expect(sniffImageType(bytes(0x49, 0x49, 0x2a, 0x00))).toBeNull();
    expect(sniffImageType(Buffer.from('BM\u0000\u0000'))).toBeNull();
  });

  it('refuses a text file whatever its name would say', () => {
    expect(sniffImageType(Buffer.from('Thực đơn hôm nay: phở, bún chả\n'))).toBeNull();
  });

  it('refuses an empty file', () => {
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it('refuses a truncated header', () => {
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a))).toBeNull();
    expect(sniffImageType(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEB'))).toBeNull();
  });

  it('refuses a RIFF file that is not WebP (WAV)', () => {
    expect(sniffImageType(Buffer.from('RIFF\u0000\u0000\u0000\u0000WAVE'))).toBeNull();
  });

  it('maps every accepted type to its content type', () => {
    expect(IMAGE_CONTENT_TYPES).toEqual({
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
    });
  });
});

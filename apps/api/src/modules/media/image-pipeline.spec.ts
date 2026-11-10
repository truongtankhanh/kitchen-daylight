import { crc32, deflateSync } from 'node:zlib';

import { isBlurhashValid } from 'blurhash';
import sharp from 'sharp';
import type { Sharp } from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  ImageDecodeError,
  ImagePixelLimitError,
  probeImage,
  processImage,
  VARIANT_SPECS,
} from './image-pipeline.js';
import { MEDIA_VARIANTS } from './media-key.js';

// Tiny images generated with sharp in the spec: no fixture file, nothing personal.

function solid(width: number, height: number, background = '#c0392b'): Sharp {
  return sharp({ create: { width, height, channels: 3, background } });
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/**
 * A 66-byte PNG whose header claims `width` x `height` (RGB, 8 bits): a decompression bomb as far as
 * the header goes, without allocating the image in the spec.
 */
function pngHeaderOf(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.alloc(1))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A 40 x 20 JPEG with EXIF orientation 6 (rotate 90°) and fictional EXIF text. */
function orientedJpeg(): Promise<Buffer> {
  return solid(40, 20)
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({ IFD0: { Copyright: 'Fictional', Artist: 'Kitchen Daylight' } })
    .toBuffer();
}

describe('probeImage', () => {
  it('reads the oriented dimensions from the header', async () => {
    const jpeg = await orientedJpeg();

    await expect(probeImage(jpeg, 'jpeg')).resolves.toEqual({
      type: 'jpeg',
      width: 20,
      height: 40,
    });
  });

  it('refuses a format that does not match the sniffed type', async () => {
    const png = await solid(8, 8).png().toBuffer();

    await expect(probeImage(png, 'jpeg')).rejects.toBeInstanceOf(ImageDecodeError);
  });

  it('refuses an unreadable header', async () => {
    const jpeg = await orientedJpeg();

    await expect(probeImage(jpeg.subarray(0, 40), 'jpeg')).rejects.toBeInstanceOf(ImageDecodeError);
  });

  it('refuses an image over the pixel limit without decoding it', async () => {
    // 10000 x 10000 = 100 MP, over the 50 MP limit; 7072 x 7070 is just under it.
    await expect(probeImage(pngHeaderOf(10_000, 10_000), 'png')).rejects.toBeInstanceOf(
      ImagePixelLimitError,
    );
    await expect(probeImage(pngHeaderOf(7072, 7070), 'png')).resolves.toMatchObject({
      width: 7072,
      height: 7070,
    });
  });
});

describe('processImage', () => {
  it('writes every variant as WebP, never upscaled', async () => {
    const processed = await processImage(await solid(64, 48).png().toBuffer());

    for (const variant of MEDIA_VARIANTS) {
      const metadata = await sharp(processed.variants[variant]).metadata();
      expect(metadata.format).toBe('webp');
      expect([metadata.width, metadata.height]).toEqual([64, 48]);
    }
    expect([processed.width, processed.height]).toEqual([64, 48]);
  });

  it('fits each variant inside its longest edge', async () => {
    const processed = await processImage(await solid(2000, 1000).jpeg().toBuffer());

    const sizes: Record<string, [number | undefined, number | undefined]> = {};
    for (const variant of MEDIA_VARIANTS) {
      const { width, height } = await sharp(processed.variants[variant]).metadata();
      sizes[variant] = [width, height];
    }
    expect(sizes).toEqual({
      thumb: [VARIANT_SPECS.thumb.edge, 160],
      medium: [VARIANT_SPECS.medium.edge, 400],
      large: [VARIANT_SPECS.large.edge, 800],
      master: [2000, 1000],
    });
  });

  it('applies the EXIF orientation and leaves no EXIF in any output', async () => {
    const processed = await processImage(await orientedJpeg());

    expect([processed.width, processed.height]).toEqual([20, 40]);
    for (const variant of MEDIA_VARIANTS) {
      const metadata = await sharp(processed.variants[variant]).metadata();
      expect([metadata.width, metadata.height]).toEqual([20, 40]);
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.iptc).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
    }
  });

  it('keeps the alpha channel (logos)', async () => {
    const transparent = await sharp({
      create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();

    const processed = await processImage(transparent);

    expect((await sharp(processed.variants.large).metadata()).hasAlpha).toBe(true);
  });

  it('computes a valid blurhash, 4 x 3 for landscape and 3 x 4 for portrait', async () => {
    const landscape = await processImage(await solid(60, 30).png().toBuffer());
    const portrait = await processImage(await solid(30, 60).png().toBuffer());

    expect(isBlurhashValid(landscape.blurhash)).toEqual({ result: true });
    expect(isBlurhashValid(portrait.blurhash)).toEqual({ result: true });
    // The first character encodes (componentX - 1) + (componentY - 1) * 9 in base 83.
    expect(landscape.blurhash[0]).toBe('L');
    expect(portrait.blurhash[0]).toBe('T');
    expect(landscape.blurhash).toHaveLength(28);
  });

  it('refuses a truncated file whose header still reads', async () => {
    const png = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: '#808080',
        noise: { type: 'gaussian', mean: 128, sigma: 40 },
      },
    })
      .png()
      .toBuffer();

    await expect(processImage(png.subarray(0, Math.floor(png.length / 2)))).rejects.toBeInstanceOf(
      ImageDecodeError,
    );
  });
});

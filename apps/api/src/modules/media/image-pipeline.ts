import { encode } from 'blurhash';
import sharp from 'sharp';
import type { Metadata, OutputInfo, Sharp, SharpOptions } from 'sharp';

import type { ImageType } from './image-sniffer.js';
import type { MediaVariant } from './media-key.js';
import { PIXEL_LIMIT } from './media-rules.js';

// Decision 0009 sections 1 and 3: `sharp` with a pixel limit, `failOn: 'warning'`, EXIF orientation
// applied, every metadata block stripped (the output default), first frame only, WebP variants.

/** The bytes cannot be read as the detected type (or not at all): `415 UNSUPPORTED_TYPE`. */
export class ImageDecodeError extends Error {
  constructor(reason: string) {
    super(`image cannot be decoded: ${reason}`);
    this.name = 'ImageDecodeError';
  }
}

/** Width x height over `PIXEL_LIMIT`: `413 TOO_LARGE`. */
export class ImagePixelLimitError extends Error {
  constructor() {
    super('image exceeds the pixel limit');
    this.name = 'ImagePixelLimitError';
  }
}

/** Longest edge and WebP quality of each variant (decision 0009 section 3). */
export const VARIANT_SPECS: Readonly<
  Record<MediaVariant, { readonly edge: number; readonly quality: number }>
> = Object.freeze({
  thumb: { edge: 320, quality: 75 },
  medium: { edge: 800, quality: 80 },
  large: { edge: 1600, quality: 82 },
  master: { edge: 2560, quality: 90 },
});

/** The box the blurhash is computed in (decision 0009 section 3). */
const BLURHASH_BOX = 32;

/** Decoding options for untrusted input: pixel limit, warnings fatal, oriented, first frame. */
const DECODE_OPTIONS: SharpOptions = Object.freeze({
  limitInputPixels: PIXEL_LIMIT,
  failOn: 'warning',
  autoOrient: true,
  pages: 1,
});

let sharpConfigured = false;

/** `sharp.cache(false)`: a long-running server uses each input once (decision 0009 section 1). */
function configureSharp(): void {
  if (!sharpConfigured) {
    sharp.cache(false);
    sharpConfigured = true;
  }
}

/** What the header says, the dimensions already oriented (EXIF orientation 5 to 8 swaps them). */
export interface ProbedImage {
  readonly type: ImageType;
  readonly width: number;
  readonly height: number;
}

/**
 * Reads the header only (no pixel is decoded) and checks it against the sniffed type and the pixel
 * limit. The header is read without `sharp`'s own pixel limit, so an oversized image is told apart
 * from a broken one by this function rather than by an error message.
 */
export async function probeImage(bytes: Buffer, sniffed: ImageType): Promise<ProbedImage> {
  configureSharp();
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: false, failOn: 'warning' }).metadata();
  } catch {
    throw new ImageDecodeError('unreadable header');
  }
  if (metadata.format !== sniffed) {
    throw new ImageDecodeError('format does not match the file signature');
  }
  const width = metadata.autoOrient.width;
  const height = metadata.autoOrient.height;
  if (!(width > 0 && height > 0)) {
    throw new ImageDecodeError('no dimensions');
  }
  if (width * height > PIXEL_LIMIT) {
    throw new ImagePixelLimitError();
  }
  return { type: sniffed, width, height };
}

export interface ProcessedImage {
  /** WebP bytes of every variant, metadata-free. */
  readonly variants: Readonly<Record<MediaVariant, Buffer>>;
  /** Of the oriented `master`. */
  readonly width: number;
  readonly height: number;
  readonly blurhash: string;
}

/** Components 4 x 3 for landscape and square, 3 x 4 for portrait (decision 0009 section 3). */
function blurhashComponents(width: number, height: number): [number, number] {
  return height > width ? [3, 4] : [4, 3];
}

async function encodeVariant(
  source: Sharp,
  variant: MediaVariant,
): Promise<{ data: Buffer; info: OutputInfo }> {
  const { edge, quality } = VARIANT_SPECS[variant];
  return source
    .clone()
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toBuffer({ resolveWithObject: true });
}

async function computeBlurhash(source: Sharp): Promise<string> {
  const { data, info } = await source
    .clone()
    .resize({ width: BLURHASH_BOX, height: BLURHASH_BOX, fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const [componentX, componentY] = blurhashComponents(info.width, info.height);
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  return encode(pixels, info.width, info.height, componentX, componentY);
}

/**
 * Decodes once and writes the four WebP variants and the blurhash. Never upscales; keeps alpha;
 * strips EXIF (GPS included), XMP, IPTC and ICC by not opting back in. The original bytes are not
 * kept. Any decoder failure is an `ImageDecodeError`.
 */
export async function processImage(bytes: Buffer): Promise<ProcessedImage> {
  configureSharp();
  const source = sharp(bytes, DECODE_OPTIONS);
  try {
    // One at a time: each output holds a decoded copy in memory (2 GB instance, ADR-0004).
    const master = await encodeVariant(source, 'master');
    const large = await encodeVariant(source, 'large');
    const medium = await encodeVariant(source, 'medium');
    const thumb = await encodeVariant(source, 'thumb');
    const blurhash = await computeBlurhash(source);
    return {
      variants: { thumb: thumb.data, medium: medium.data, large: large.data, master: master.data },
      width: master.info.width,
      height: master.info.height,
      blurhash,
    };
  } catch {
    // `probeImage` already checked the pixel limit on the same header.
    throw new ImageDecodeError('decoding failed');
  }
}

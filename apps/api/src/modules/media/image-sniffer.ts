/** The accepted source types (decision 0009 section 2), named as `sharp` names its formats. */
export const IMAGE_TYPES = ['jpeg', 'png', 'webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** `media.content_type` of each accepted type: the detected type, never the client's `mimetype`. */
export const IMAGE_CONTENT_TYPES: Readonly<Record<ImageType, string>> = Object.freeze({
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});

const JPEG = [0xff, 0xd8, 0xff] as const;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** `RIFF` at offset 0 and `WEBP` at offset 8; the four bytes between are the chunk size. */
const RIFF = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP = [0x57, 0x45, 0x42, 0x50] as const;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) {
    return false;
  }
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * The real type of an upload from its magic bytes (decision 0009 section 2): JPEG `FF D8 FF`, PNG
 * `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF....WEBP`. Anything else, an empty file and a header cut
 * short, is `null`: SVG, GIF, HEIC/HEIF, AVIF, TIFF, BMP and text are refused here, before any
 * decoder sees the bytes. The file name and the client's `mimetype` are never read.
 */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, JPEG)) {
    return 'jpeg';
  }
  if (startsWith(bytes, PNG)) {
    return 'png';
  }
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) {
    return 'webp';
  }
  return null;
}

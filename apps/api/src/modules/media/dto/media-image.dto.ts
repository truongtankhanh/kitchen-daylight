import { ApiProperty, ApiSchema } from '@nestjs/swagger';

import type {
  MediaImageVariantsView,
  MediaImageView,
  UploadedImageView,
} from '../media.service.js';

/** Full URLs of the client variants (decision 0009 section 7). */
@ApiSchema({ name: 'MediaImageVariants' })
export class MediaImageVariantsDto implements MediaImageVariantsView {
  /** Longest edge 320 px: list rows, chips, admin tables. */
  @ApiProperty({ format: 'uri' })
  thumb!: string;

  /** Longest edge 800 px: cards, mobile detail. */
  @ApiProperty({ format: 'uri' })
  medium!: string;

  /** Longest edge 1600 px: detail and full screen. */
  @ApiProperty({ format: 'uri' })
  large!: string;
}

/**
 * The image object of every response that carries an image (decision 0009 section 7; api-outline
 * Conventions "Images": full URLs plus `blurhash` and `alt`, never raw keys).
 */
@ApiSchema({ name: 'MediaImage' })
export class MediaImageDto implements MediaImageView {
  /** The media id; the admin sends it back as `mediaId`. */
  @ApiProperty({ format: 'uuid' })
  id!: string;

  /** Equal to `variants.large`. */
  @ApiProperty({ format: 'uri' })
  url!: string;

  @ApiProperty({ type: MediaImageVariantsDto })
  variants!: MediaImageVariantsDto;

  @ApiProperty()
  blurhash!: string;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 200 })
  alt!: string | null;

  /** Of the oriented master, for the aspect ratio. */
  @ApiProperty({ type: 'integer', minimum: 1 })
  width!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  height!: number;
}

/** `POST /admin/uploads/images`: the image object plus `duplicate` (brief B16). */
@ApiSchema({ name: 'UploadedImage' })
export class UploadedImageDto extends MediaImageDto implements UploadedImageView {
  /** `true` when the same bytes were already stored: the existing row, unchanged, with `200`. */
  @ApiProperty()
  duplicate!: boolean;
}

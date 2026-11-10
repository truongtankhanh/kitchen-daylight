/// <reference types="multer" />
import {
  Body,
  Controller,
  HttpStatus,
  Inject,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { RequestUser } from '../../common/auth/request-user.js';
import { MANAGER_ROLES, Roles } from '../../common/auth/roles.decorator.js';
import { NotBranchScoped } from '../../common/branch-scope/branch-scope.decorator.js';
import { ApiError } from '../../common/errors/api-error.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../common/errors/validation.pipe.js';
import { UploadedImageDto } from './dto/media-image.dto.js';
import { UPLOAD_IMAGE_BODY_SCHEMA, UploadImageDto } from './dto/upload-image.dto.js';
import { DEFAULT_MEDIA_PURPOSE, UPLOAD_MULTER_LIMITS } from './media-rules.js';
import { MediaService } from './media.service.js';
import type { UploadedImageView } from './media.service.js';

/**
 * The global validation pipe with the DTO class named here instead of read from emitted decorator
 * metadata (as `ValidatedAs` in `admin-users.controller.ts`; decision 0007 section 2).
 */
class ValidatedAs implements PipeTransform {
  private readonly pipe = createValidationPipe();

  constructor(private readonly type: Type<unknown>) {}

  transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    return this.pipe.transform(value, { ...metadata, metatype: this.type }) as Promise<unknown>;
  }
}

/** The part of the Express response the handler uses. */
interface StatusResponse {
  status(code: number): unknown;
}

/**
 * `POST /admin/uploads/images` (api-outline "Menu", brief B16, L5; decision 0009; A6-T3). `MANAGER`
 * and `ADMIN` upload photos, `ADMIN` only a logo (`purpose=LOGO`); `STAFF` and customers get `403`
 * from `RolesGuard`, which runs before multer reads the body. The acting user comes from the token.
 */
@Roles(...MANAGER_ROLES)
@Controller('admin/uploads')
export class AdminUploadsController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  /**
   * Multipart upload of one image. `201` with a new row; `200` with `duplicate: true` and the
   * existing row, unchanged, when the same bytes are already stored.
   */
  @Post('images')
  @NotBranchScoped(
    'Images are brand-wide: an upload names no branch and is linked to one by a later request.',
  )
  @UseInterceptors(FileInterceptor('file', { limits: UPLOAD_MULTER_LIMITS }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: UPLOAD_IMAGE_BODY_SCHEMA })
  @ApiCreatedResponse({ type: UploadedImageDto, description: 'A new image (`duplicate: false`).' })
  @ApiOkResponse({
    type: UploadedImageDto,
    description: 'The same bytes were already stored: the existing image (`duplicate: true`).',
  })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'TOO_LARGE',
    'UNSUPPORTED_TYPE',
    'RATE_LIMITED',
  )
  async upload(
    @CurrentUser() actor: RequestUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ValidatedAs(UploadImageDto)) body: UploadImageDto,
    @Res({ passthrough: true }) response: StatusResponse,
  ): Promise<UploadedImageView> {
    if (file === undefined) {
      throw new ApiError('VALIDATION_FAILED', {
        errors: [{ field: 'file', code: 'REQUIRED', message: 'is required' }],
      });
    }
    const { image, created } = await this.media.upload(actor, {
      bytes: file.buffer,
      purpose: body.purpose ?? DEFAULT_MEDIA_PURPOSE,
      alt: body.alt,
    });
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return image;
  }
}

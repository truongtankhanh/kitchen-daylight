import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { RequestUser } from '../../common/auth/request-user.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../common/errors/validation.pipe.js';
import { AddressesService } from './addresses.service.js';
import { AddressCreateDto, AddressUpdateDto } from './dto/address-input.dto.js';
import { AddressDto, AddressPageDto } from './dto/address.dto.js';
import { AddressesQueryDto } from './dto/addresses-query.dto.js';

/**
 * The global validation pipe with the DTO class named here instead of read from emitted decorator
 * metadata, which the test transformer may not emit (decision 0007 section 2). The same small pipe
 * as `ValidatedAs` in `me.controller.ts`; a shared copy belongs in `common/errors` once a task may
 * change that file.
 */
class ValidatedAs implements PipeTransform {
  private readonly pipe = createValidationPipe();

  constructor(private readonly type: Type<unknown>) {}

  transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    return this.pipe.transform(value, { ...metadata, metatype: this.type }) as Promise<unknown>;
  }
}

/**
 * The signed-in customer's delivery address book (api-outline "Current user", `/me/addresses`;
 * A2-T5). Every route needs an access token and no `@Roles`: any signed-in user. The owner comes
 * from the token only (`@CurrentUser()`); no body, path or query names a user, and an address of
 * another user is `NOT_FOUND`. No address search or reverse geocoding (mobile G48).
 */
@Controller('me/addresses')
export class AddressesController {
  constructor(@Inject(AddressesService) private readonly addresses: AddressesService) {}

  /** The default address first, then the newest (mobile G99). */
  @Get()
  @ApiOkResponse({ type: AddressPageDto })
  @ApiProblemResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'TOKEN_EXPIRED', 'RATE_LIMITED')
  list(
    @CurrentUser() user: RequestUser,
    @Query(new ValidatedAs(AddressesQueryDto)) query: AddressesQueryDto,
  ): Promise<AddressPageDto> {
    return this.addresses.list(user.id, query);
  }

  /**
   * More than the saved-address cap is `VALIDATION_FAILED` with `LIMIT_REACHED` on the field
   * `address`; an unknown province or ward is `NOT_FOUND` on `provinceCode` or `wardCode`.
   */
  @Post()
  @ApiCreatedResponse({ type: AddressDto })
  @ApiProblemResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'TOKEN_EXPIRED', 'RATE_LIMITED')
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ValidatedAs(AddressCreateDto)) body: AddressCreateDto,
  ): Promise<AddressDto> {
    return this.addresses.create(user.id, body);
  }

  @Get(':id')
  @ApiOkResponse({ type: AddressDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'NOT_FOUND',
    'RATE_LIMITED',
  )
  get(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AddressDto> {
    return this.addresses.get(user.id, id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: AddressDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'NOT_FOUND',
    'RATE_LIMITED',
  )
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidatedAs(AddressUpdateDto)) body: AddressUpdateDto,
  ): Promise<AddressDto> {
    return this.addresses.update(user.id, id, body);
  }

  /**
   * Soft delete. Deleting the default chooses no other one (mobile G101); there is no restore, the
   * app holds the call for "Hoàn tác" (mobile G100).
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'NOT_FOUND',
    'RATE_LIMITED',
  )
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.addresses.remove(user.id, id);
  }
}

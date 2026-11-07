import { ApiProperty, ApiSchema } from '@nestjs/swagger';

import type { MySession, MySessionPage } from '../sessions.service.js';

/** One signed-in device: a live refresh-token family. */
@ApiSchema({ name: 'MySession' })
export class MeSessionDto implements MySession {
  /** The family id: the path parameter of `DELETE /me/sessions/{id}`. */
  @ApiProperty({ format: 'uuid' })
  id!: string;

  /** The label the device sent at sign-in, or `unknown`; display only. */
  deviceLabel!: string;

  /** When the device signed in. */
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  lastUsedAt!: string;

  /** The session of the access token that made this request. */
  isCurrent!: boolean;
}

/** `GET /api/v1/me/sessions`: an offset page (decision 0007 section 6). */
@ApiSchema({ name: 'MySessionPage' })
export class MeSessionPageDto implements MySessionPage {
  @ApiProperty({ type: MeSessionDto, isArray: true })
  items!: MeSessionDto[];

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  pageSize!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number;
}

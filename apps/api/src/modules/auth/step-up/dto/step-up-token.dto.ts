import { ApiProperty } from '@nestjs/swagger';

/** The answer of `POST /admin/auth/step-up`. */
export class StepUpTokenDto {
  /** Sent back in the `X-Step-Up-Token` header of the protected request; keep it in memory only. */
  @ApiProperty({ format: 'password' })
  stepUpToken!: string;

  /** When the token stops being accepted (ISO 8601). */
  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

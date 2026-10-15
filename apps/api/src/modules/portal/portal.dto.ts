import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNumber,
  IsOptional,
  IsPositive,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsCalendarDate } from '../../common/http/dates.js';
import { trim } from '../../common/http/transforms.js';

export class LinkAccountDto {
  @ApiProperty({
    nullable: true,
    description: 'Email of the portal user to link, or null to remove the link.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @ValidateIf((_, value) => value !== null)
  @IsEmail()
  @MaxLength(254)
  email: string | null;
}

export class PortalRangeQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to 90 days before `to`.' })
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({ description: 'Defaults to today.' })
  @IsOptional()
  @IsCalendarDate()
  to?: string;
}

export class PortalStkPushDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @ApiProperty({ example: '0712345678' })
  @Transform(trim)
  @Matches(/^(?:\+?254|0)(?:7|1)\d{8}$/, { message: 'phone must be a Kenyan mobile number' })
  phone: string;

  @ApiProperty({ description: 'Whole shillings.' })
  @IsNumber({ maxDecimalPlaces: 0 }, { message: 'amount must be a whole number of shillings' })
  @IsPositive()
  @Max(250_000)
  amount: number;
}

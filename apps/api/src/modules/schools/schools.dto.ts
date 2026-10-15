import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { trim, trimToNull } from '../../common/http/transforms.js';

/** Every field is optional; send `null` (or an empty string) to clear one. */
export class UpdateSchoolDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  motto?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  addressLine?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  county?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  country?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @Matches(/^\+?[0-9 ()-]{7,20}$/, { message: 'phone must be a valid phone number' })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(200)
  website?: string | null;
}

export const RANKING_POLICIES = ['COMPETITION', 'DENSE'] as const;

export class UpdateSchoolSettingsDto {
  @ApiPropertyOptional({ example: 50, description: 'Average (percent) needed to pass.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  passMark?: number;

  @ApiPropertyOptional({ enum: RANKING_POLICIES, description: 'How tied learners are positioned.' })
  @IsOptional()
  @IsIn(RANKING_POLICIES)
  rankingPolicy?: (typeof RANKING_POLICIES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showClassPosition?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showStreamPosition?: boolean;

  @ApiPropertyOptional({ example: 'KES', description: 'ISO 4217 currency code.' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a three-letter ISO 4217 code' })
  currency?: string;
}

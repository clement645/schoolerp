import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { normalizeEmail } from '../auth/auth.dto.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/password.service.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const TENANT_PLANS = ['STANDARD', 'PROFESSIONAL', 'ENTERPRISE'] as const;
export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;

export class TenantAdminDto {
  @ApiProperty()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @ApiProperty({
    description: 'Temporary password; the administrator must replace it at first sign-in.',
    minLength: PASSWORD_MIN_LENGTH,
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  temporaryPassword: string;
}

export class CreateTenantDto {
  @ApiProperty({ description: 'Name of the customer account.' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @ApiProperty({ description: 'Name of the first school in the account.' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  schoolName: string;

  @ApiPropertyOptional({ enum: TENANT_PLANS, default: 'STANDARD' })
  @IsOptional()
  @IsIn(TENANT_PLANS)
  plan?: (typeof TENANT_PLANS)[number];

  @ApiProperty({ type: TenantAdminDto })
  @ValidateNested()
  @Type(() => TenantAdminDto)
  admin: TenantAdminDto;
}

export class UpdateTenantStatusDto {
  @ApiProperty({ enum: TENANT_STATUSES })
  @IsIn(TENANT_STATUSES)
  status: (typeof TENANT_STATUSES)[number];
}

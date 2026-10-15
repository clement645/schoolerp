import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/http/pagination.js';
import { normalizeEmail } from '../auth/auth.dto.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/password.service.js';
import { ROLE_KEYS, type RoleKey } from '../rbac/rbac.catalogue.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches name or email.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CreateUserDto {
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
    description: 'Temporary password; the user must replace it at first sign-in.',
    minLength: PASSWORD_MIN_LENGTH,
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  temporaryPassword: string;

  @ApiProperty({ enum: ROLE_KEYS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ROLE_KEYS.length)
  @ArrayUnique()
  @IsIn(ROLE_KEYS, { each: true })
  roles: RoleKey[];
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];
}

export class SetUserRolesDto {
  @ApiProperty({ enum: ROLE_KEYS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ROLE_KEYS.length)
  @ArrayUnique()
  @IsIn(ROLE_KEYS, { each: true })
  roles: RoleKey[];
}

export class ResetUserPasswordDto {
  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  temporaryPassword: string;
}

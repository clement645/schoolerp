import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { trim, upperTrim } from '../../common/http/transforms.js';

const CODE = /^[A-Z0-9][A-Z0-9/-]{0,11}$/;
const CODE_MESSAGE = 'code must be 1–12 letters, digits, "-" or "/"';

export class CreateSubjectDto {
  @ApiProperty({ example: 'Mathematics' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'MAT', description: 'Short code printed on mark sheets.' })
  @Transform(upperTrim)
  @Matches(CODE, { message: CODE_MESSAGE })
  code: string;
}

export class UpdateSubjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(upperTrim)
  @Matches(CODE, { message: CODE_MESSAGE })
  code?: string;

  @ApiPropertyOptional({ description: 'Inactive subjects cannot be added to classes.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

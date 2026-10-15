import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { trim, trimToNull } from '../../common/http/transforms.js';
import { MAX_BOUNDARIES, MIN_BOUNDARIES } from './grading.rules.js';

export const SCHEME_TYPES = ['PERCENTAGE', 'COMPETENCY'] as const;

export class GradeBoundaryDto {
  @ApiProperty({ example: 'A-' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  label: string;

  @ApiPropertyOptional({ example: 'Very good', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  descriptor?: string | null;

  @ApiPropertyOptional({
    example: 75,
    nullable: true,
    description: 'Lowest percentage that earns this grade. The next grade up sets the upper limit.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  minScore?: number | null;

  @ApiPropertyOptional({ example: 11, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999)
  points?: number | null;
}

export class SaveGradingSchemeDto {
  @ApiProperty({ example: 'Upper primary percentage scale' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: SCHEME_TYPES })
  @IsIn(SCHEME_TYPES)
  type: (typeof SCHEME_TYPES)[number];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiProperty({ type: [GradeBoundaryDto] })
  @IsArray()
  @ArrayMinSize(MIN_BOUNDARIES)
  @ArrayMaxSize(MAX_BOUNDARIES)
  @ValidateNested({ each: true })
  @Type(() => GradeBoundaryDto)
  boundaries: GradeBoundaryDto[];
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { IsCalendarDate } from '../../common/http/dates.js';
import { trim } from '../../common/http/transforms.js';

export class CreateAcademicYearDto {
  @ApiProperty({ example: '2026' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @ApiProperty({ example: '2026-01-05' })
  @IsCalendarDate()
  startDate: string;

  @ApiProperty({ example: '2026-11-20' })
  @IsCalendarDate()
  endDate: string;
}

export class UpdateAcademicYearDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsCalendarDate()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsCalendarDate()
  endDate?: string;
}

export class CreateTermDto {
  @ApiProperty({ example: 'Term 1' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @ApiProperty({ example: 1, description: 'Position within the year.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  sequence: number;

  @ApiProperty({ example: '2026-01-05' })
  @IsCalendarDate()
  startDate: string;

  @ApiProperty({ example: '2026-04-03' })
  @IsCalendarDate()
  endDate: string;
}

export class UpdateTermDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  sequence?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsCalendarDate()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsCalendarDate()
  endDate?: string;
}

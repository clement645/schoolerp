import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDate } from '../../common/http/dates.js';
import { trim } from '../../common/http/transforms.js';

export const EXAM_TYPES = [
  'OPENING',
  'MID_TERM',
  'END_TERM',
  'MOCK',
  'CONTINUOUS_ASSESSMENT',
  'CUSTOM',
] as const;
export const EXAM_STATUSES = ['DRAFT', 'OPEN', 'COMPILED', 'APPROVED', 'PUBLISHED'] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

export class CreateExaminationDto {
  @ApiProperty({ example: 'End Term Exam' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: EXAM_TYPES })
  @IsIn(EXAM_TYPES)
  type: (typeof EXAM_TYPES)[number];

  @ApiProperty()
  @IsUUID()
  termId: string;

  @ApiProperty({ example: '2026-07-20' })
  @IsCalendarDate()
  startDate: string;

  @ApiProperty({ example: '2026-07-31' })
  @IsCalendarDate()
  endDate: string;

  @ApiProperty({ type: [String], description: 'Classes that sit the examination.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  classIds: string[];

  @ApiPropertyOptional({
    default: 100,
    description: 'Maximum mark for every subject; adjustable per subject afterwards.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1000)
  maxMarks?: number;
}

export class UpdateExaminationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ enum: EXAM_TYPES })
  @IsOptional()
  @IsIn(EXAM_TYPES)
  type?: (typeof EXAM_TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsCalendarDate()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsCalendarDate()
  endDate?: string;
}

export class SetMaxMarksDto {
  @ApiProperty({ example: 50 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1000)
  maxMarks: number;
}

export class ListExaminationsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  termId?: string;

  @ApiPropertyOptional({ enum: EXAM_STATUSES })
  @IsOptional()
  @IsIn(EXAM_STATUSES)
  status?: ExamStatus;
}

export class MarksSheetQueryDto {
  @ApiProperty()
  @IsUUID()
  classId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  streamId?: string;
}

export class ImportMarksQueryDto extends MarksSheetQueryDto {
  @ApiPropertyOptional({
    description: 'Check the file and report its effect without saving anything.',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : (value as unknown),
  )
  @IsBoolean()
  dryRun?: boolean;
}

export class MarkEntryDto {
  @ApiProperty()
  @IsUUID()
  studentId: string;

  @ApiProperty()
  @IsUUID()
  subjectId: string;

  @ApiPropertyOptional({ nullable: true, description: 'Raw score; null clears it.' })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  score?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Performance level, for level-based grading.',
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(10)
  level?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isAbsent?: boolean;

  @ApiProperty({
    description: 'The version of the mark this change is based on; 0 when there was none.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version: number;
}

export class SaveMarksDto {
  @ApiProperty()
  @IsUUID()
  classId: string;

  @ApiProperty({ type: [MarkEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => MarkEntryDto)
  entries: MarkEntryDto[];
}

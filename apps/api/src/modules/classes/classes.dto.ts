import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
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
import { trim } from '../../common/http/transforms.js';

export class CreateClassDto {
  @ApiProperty({ example: 'Grade 7' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @ApiProperty({ example: 7, description: 'Orders classes from youngest to oldest.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  level: number;

  @ApiPropertyOptional({
    nullable: true,
    description: "Grading scheme for this class; the school's default applies when omitted.",
  })
  @IsOptional()
  @IsUUID()
  gradingSchemeId?: string | null;
}

export class UpdateClassDto {
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
  @Min(0)
  @Max(99)
  level?: number;

  @ApiPropertyOptional({ nullable: true, description: 'Send null to use the school default.' })
  // `null` is meaningful here, so only `undefined` skips validation.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  gradingSchemeId?: string | null;

  @ApiPropertyOptional({ description: 'Inactive classes are hidden from day-to-day work.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SaveStreamDto {
  @ApiProperty({ example: 'East' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ example: 45, nullable: true })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number | null;
}

export class ClassSubjectDto {
  @ApiProperty()
  @IsUUID()
  subjectId: string;

  @ApiProperty({ description: 'False for electives that only some learners take.' })
  @IsBoolean()
  isCompulsory: boolean;
}

export class SetClassSubjectsDto {
  @ApiProperty({ type: [ClassSubjectDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((entry: ClassSubjectDto) => entry.subjectId)
  @ValidateNested({ each: true })
  @Type(() => ClassSubjectDto)
  subjects: ClassSubjectDto[];
}

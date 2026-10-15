import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDate } from '../../common/http/dates.js';
import { trimToNull } from '../../common/http/transforms.js';

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export class RegisterQueryDto {
  @ApiProperty()
  @IsUUID()
  classId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  streamId?: string;

  @ApiProperty({ example: '2026-10-13' })
  @IsCalendarDate()
  date: string;
}

export class AttendanceEntryDto {
  @ApiProperty()
  @IsUUID()
  studentId: string;

  @ApiProperty({ enum: ATTENDANCE_STATUSES })
  @IsIn(ATTENDANCE_STATUSES)
  status: AttendanceStatus;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  note?: string | null;
}

export class MarkRegisterDto {
  @ApiProperty()
  @IsUUID()
  classId: string;

  @ApiPropertyOptional({ description: 'Limits the returned register to one stream.' })
  @IsOptional()
  @IsUUID()
  streamId?: string;

  @ApiProperty({ example: '2026-10-13' })
  @IsCalendarDate()
  date: string;

  @ApiProperty({ type: [AttendanceEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  records: AttendanceEntryDto[];
}

export class AttendanceRangeQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  streamId?: string;

  @ApiProperty({ example: '2026-09-01' })
  @IsCalendarDate()
  from: string;

  @ApiProperty({ example: '2026-09-30' })
  @IsCalendarDate()
  to: string;
}

export class MonthlyQueryDto {
  @ApiProperty()
  @IsUUID()
  classId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  streamId?: string;

  @ApiProperty({ example: '2026-10' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be in YYYY-MM format' })
  month: string;
}

export class StudentRangeQueryDto {
  @ApiProperty({ example: '2026-09-01' })
  @IsCalendarDate()
  from: string;

  @ApiProperty({ example: '2026-09-30' })
  @IsCalendarDate()
  to: string;
}

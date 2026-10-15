import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { trimToNull } from '../../common/http/transforms.js';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class SaveSlotDto {
  @ApiProperty()
  @IsUUID()
  classId: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Omit when the whole class is taught together.',
  })
  @IsOptional()
  @IsUUID()
  streamId?: string | null;

  @ApiProperty({ minimum: 1, maximum: 7, description: 'ISO weekday: 1 is Monday.' })
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek: number;

  @ApiProperty({ example: '08:00' })
  @Matches(TIME, { message: 'startTime must be a time in HH:MM format' })
  startTime: string;

  @ApiProperty({ example: '08:40' })
  @Matches(TIME, { message: 'endTime must be a time in HH:MM format' })
  endTime: string;

  @ApiProperty()
  @IsUUID()
  subjectId: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  teacherId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(40)
  room?: string | null;
}

export class TimetableQueryDto {
  @ApiPropertyOptional({ description: 'A class’s timetable.' })
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  streamId?: string;

  @ApiPropertyOptional({ description: 'A teacher’s timetable.' })
  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @ApiPropertyOptional({ description: 'The caller’s own lessons, if they are a teacher.' })
  @IsOptional()
  @Type(() => String)
  @Matches(/^true$/)
  mine?: string;
}

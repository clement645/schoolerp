import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { IsCalendarDate } from '../../common/http/dates.js';
import { trim, trimToNull } from '../../common/http/transforms.js';

export const CALENDAR_CATEGORIES = [
  'ACADEMIC',
  'EXAMINATION',
  'HOLIDAY',
  'MEETING',
  'SPORTS',
  'OTHER',
] as const;
export const EVENT_VISIBILITIES = ['EVERYONE', 'STAFF'] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class SaveEventDto {
  @ApiProperty({ example: 'Parents’ day' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiProperty({ enum: CALENDAR_CATEGORIES })
  @IsIn(CALENDAR_CATEGORIES)
  category: (typeof CALENDAR_CATEGORIES)[number];

  @ApiProperty({ enum: EVENT_VISIBILITIES })
  @IsIn(EVENT_VISIBILITIES)
  visibility: (typeof EVENT_VISIBILITIES)[number];

  @ApiProperty({ example: '2026-11-06' })
  @IsCalendarDate()
  startDate: string;

  @ApiPropertyOptional({ description: 'Defaults to the start date.' })
  @IsOptional()
  @IsCalendarDate()
  endDate?: string;

  @ApiPropertyOptional({
    nullable: true,
    example: '09:00',
    description: 'Omit for an all-day event.',
  })
  @IsOptional()
  @Transform(trimToNull)
  @Matches(TIME, { message: 'startTime must be a time in HH:MM format' })
  startTime?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '13:00' })
  @IsOptional()
  @Transform(trimToNull)
  @Matches(TIME, { message: 'endTime must be a time in HH:MM format' })
  endTime?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(120)
  location?: string | null;
}

export class EventsQueryDto {
  @ApiProperty({ example: '2026-11-01' })
  @IsCalendarDate()
  from: string;

  @ApiProperty({ example: '2026-11-30' })
  @IsCalendarDate()
  to: string;
}

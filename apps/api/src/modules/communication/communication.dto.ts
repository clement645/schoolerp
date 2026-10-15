import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsCalendarDate } from '../../common/http/dates.js';
import { PaginationQueryDto } from '../../common/http/pagination.js';
import { trim } from '../../common/http/transforms.js';

export const AUDIENCES = ['EVERYONE', 'STAFF', 'PARENTS', 'STUDENTS'] as const;

export class SaveAnnouncementDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  body: string;

  @ApiProperty({ enum: AUDIENCES })
  @IsIn(AUDIENCES)
  audience: (typeof AUDIENCES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Last day the announcement is shown.' })
  @IsOptional()
  @IsCalendarDate()
  expiresOn?: string | null;
}

export class NotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  unreadOnly?: boolean;
}

export class StartThreadDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  recipientIds: string[];

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  subject: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;
}

export class ReplyDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;
}

export class RecipientsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  search?: string;
}

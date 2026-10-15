import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { trim, trimToNull } from '../../common/http/transforms.js';

export const REMARK_MAX_LENGTH = 500;

export class ReportCardsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional({ description: 'Stream name, as recorded when results were compiled.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  stream?: string;
}

export class UpdateRemarksDto {
  @ApiPropertyOptional({ nullable: true, maxLength: REMARK_MAX_LENGTH })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(REMARK_MAX_LENGTH)
  classTeacherRemarks?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: REMARK_MAX_LENGTH })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(REMARK_MAX_LENGTH)
  principalRemarks?: string | null;
}

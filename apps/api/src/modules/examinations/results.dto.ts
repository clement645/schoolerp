import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { trim } from '../../common/http/transforms.js';

export class ResultsQueryDto {
  @ApiProperty()
  @IsUUID()
  examinationId: string;

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

import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { trim } from '../../common/http/transforms.js';

export const DOCUMENT_CATEGORIES = [
  'BIRTH_CERTIFICATE',
  'MEDICAL',
  'PREVIOUS_SCHOOL',
  'IDENTIFICATION',
  'OTHER',
] as const;

export class UploadDocumentDto {
  @ApiProperty({ example: 'Birth certificate' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title: string;

  @ApiProperty({ enum: DOCUMENT_CATEGORIES })
  @IsIn(DOCUMENT_CATEGORIES)
  category: (typeof DOCUMENT_CATEGORIES)[number];
}

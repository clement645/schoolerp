import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/http/pagination.js';

export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Action name or prefix, e.g. `auth.` or `user.roles.changed`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z_.]+$/, {
    message: 'action may only contain lowercase letters, dots and underscores',
  })
  action?: string;
}

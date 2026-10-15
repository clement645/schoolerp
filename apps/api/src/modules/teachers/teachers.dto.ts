import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { IsCalendarDate } from '../../common/http/dates.js';
import { PaginationQueryDto } from '../../common/http/pagination.js';
import { trim, trimToNull } from '../../common/http/transforms.js';
import { normalizeEmail } from '../auth/auth.dto.js';
import { GENDERS, PHONE } from '../students/students.dto.js';

export const TEACHER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export const ASSIGNMENT_KINDS = ['SUBJECT_TEACHER', 'CLASS_TEACHER'] as const;

const STAFF_NUMBER = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,29}$/;
const STAFF_NUMBER_MESSAGE =
  'staffNumber may contain letters, digits and / . _ - (up to 30 characters)';
const optionalNullable = () => ValidateIf((_, value) => value !== undefined && value !== null);

export class CreateTeacherDto {
  @ApiProperty({ example: 'T-014', description: 'Unique within the school.' })
  @Transform(trim)
  @Matches(STAFF_NUMBER, { message: STAFF_NUMBER_MESSAGE })
  staffNumber: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional({ enum: GENDERS, nullable: true })
  @optionalNullable()
  @IsIn(GENDERS)
  gender?: (typeof GENDERS)[number] | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimToNull)
  @optionalNullable()
  @Matches(PHONE, { message: 'phone must be a valid phone number' })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }) => trimToNull({ value: normalizeEmail({ value }) }))
  @optionalNullable()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'e.g. TSC number.' })
  @Transform(trimToNull)
  @optionalNullable()
  @IsString()
  @MaxLength(50)
  registrationNumber?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2022-01-10' })
  @optionalNullable()
  @IsCalendarDate()
  employmentDate?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Login account of this teacher. Their access to classes follows their assignments.',
  })
  @optionalNullable()
  @IsUUID()
  userId?: string | null;
}

export class UpdateTeacherDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @Matches(STAFF_NUMBER, { message: STAFF_NUMBER_MESSAGE })
  staffNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ enum: GENDERS, nullable: true })
  @optionalNullable()
  @IsIn(GENDERS)
  gender?: (typeof GENDERS)[number] | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimToNull)
  @optionalNullable()
  @Matches(PHONE, { message: 'phone must be a valid phone number' })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }) => trimToNull({ value: normalizeEmail({ value }) }))
  @optionalNullable()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimToNull)
  @optionalNullable()
  @IsString()
  @MaxLength(50)
  registrationNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @optionalNullable()
  @IsCalendarDate()
  employmentDate?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Send null to unlink the login account.' })
  @optionalNullable()
  @IsUUID()
  userId?: string | null;

  @ApiPropertyOptional({ enum: TEACHER_STATUSES })
  @IsOptional()
  @IsIn(TEACHER_STATUSES)
  status?: (typeof TEACHER_STATUSES)[number];
}

export class TeacherFilterDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches name or staff number.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: TEACHER_STATUSES })
  @IsOptional()
  @IsIn(TEACHER_STATUSES)
  status?: (typeof TEACHER_STATUSES)[number];
}

export class CreateAssignmentDto {
  @ApiProperty({ enum: ASSIGNMENT_KINDS })
  @IsIn(ASSIGNMENT_KINDS)
  kind: (typeof ASSIGNMENT_KINDS)[number];

  @ApiPropertyOptional({ description: 'Defaults to the current academic year.' })
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @ApiProperty()
  @IsUUID()
  classId: string;

  @ApiPropertyOptional({ nullable: true, description: 'Omit for the whole class.' })
  @optionalNullable()
  @IsUUID()
  streamId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Required for a subject teacher.' })
  @optionalNullable()
  @IsUUID()
  subjectId?: string | null;
}

export class WorkloadQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to the current academic year.' })
  @IsOptional()
  @IsUUID()
  academicYearId?: string;
}

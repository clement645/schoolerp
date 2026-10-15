import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDate } from '../../common/http/dates.js';
import { PaginationQueryDto } from '../../common/http/pagination.js';
import { normalizeEmail } from '../auth/auth.dto.js';
import { trim, trimToNull } from '../../common/http/transforms.js';

export const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
export const STUDENT_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'TRANSFERRED',
  'WITHDRAWN',
  'GRADUATED',
] as const;
export const RELATIONSHIPS = [
  'FATHER',
  'MOTHER',
  'GUARDIAN',
  'GRANDPARENT',
  'SIBLING',
  'OTHER',
] as const;
export const STUDENT_SORTS = ['name', 'admissionNumber', 'admissionDate', 'class'] as const;

export type StudentStatusValue = (typeof STUDENT_STATUSES)[number];

export const PHONE = /^\+?[0-9 ()-]{7,20}$/;
const PHONE_MESSAGE = '$property must be a valid phone number';
const ADMISSION_NUMBER = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,29}$/;

const optionalNullable = () => ValidateIf((_, value) => value !== undefined && value !== null);

export class GuardianDetailsDto {
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

  @ApiProperty({ example: '+254 700 000 000' })
  @Transform(trim)
  @Matches(PHONE, { message: PHONE_MESSAGE })
  phone: string;

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
  @MaxLength(100)
  occupation?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimToNull)
  @optionalNullable()
  @IsString()
  @MaxLength(200)
  address?: string | null;
}

export class NewGuardianDto extends GuardianDetailsDto {
  @ApiProperty({ enum: RELATIONSHIPS })
  @IsIn(RELATIONSHIPS)
  relationship: (typeof RELATIONSHIPS)[number];

  @ApiPropertyOptional({ description: 'The first person the school contacts.' })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class LinkGuardianDto {
  @ApiPropertyOptional({ description: 'Link a guardian already on record (e.g. of a sibling).' })
  @IsOptional()
  @IsUUID()
  guardianId?: string;

  @ApiPropertyOptional({ type: GuardianDetailsDto, description: 'Or register a new guardian.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => GuardianDetailsDto)
  details?: GuardianDetailsDto;

  @ApiProperty({ enum: RELATIONSHIPS })
  @IsIn(RELATIONSHIPS)
  relationship: (typeof RELATIONSHIPS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateGuardianLinkDto {
  @ApiPropertyOptional({ type: GuardianDetailsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GuardianDetailsDto)
  details?: GuardianDetailsDto;

  @ApiPropertyOptional({ enum: RELATIONSHIPS })
  @IsOptional()
  @IsIn(RELATIONSHIPS)
  relationship?: (typeof RELATIONSHIPS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

class StudentPersonalDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimToNull)
  @optionalNullable()
  @IsString()
  @MaxLength(100)
  middleName?: string | null;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: '2013-04-17' })
  @IsCalendarDate()
  dateOfBirth: string;

  @ApiProperty({ enum: GENDERS })
  @IsIn(GENDERS)
  gender: (typeof GENDERS)[number];

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimToNull)
  @optionalNullable()
  @IsString()
  @MaxLength(100)
  nationality?: string | null;

  @ApiProperty({ example: '2026-01-05' })
  @IsCalendarDate()
  admissionDate: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimToNull)
  @optionalNullable()
  @IsString()
  @MaxLength(200)
  emergencyContactName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimToNull)
  @optionalNullable()
  @Matches(PHONE, { message: PHONE_MESSAGE })
  emergencyContactPhone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimToNull)
  @optionalNullable()
  @IsString()
  @MaxLength(100)
  emergencyContactRelationship?: string | null;
}

export class CreateStudentDto extends StudentPersonalDto {
  @ApiProperty({ example: 'ADM-0001', description: 'Unique within the school.' })
  @Transform(trim)
  @Matches(ADMISSION_NUMBER, {
    message: 'admissionNumber may contain letters, digits and / . _ - (up to 30 characters)',
  })
  admissionNumber: string;

  @ApiProperty({ description: 'Class the student joins in the current academic year.' })
  @IsUUID()
  classId: string;

  @ApiPropertyOptional({ nullable: true })
  @optionalNullable()
  @IsUUID()
  streamId?: string | null;

  @ApiPropertyOptional({ type: [NewGuardianDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => NewGuardianDto)
  guardians?: NewGuardianDto[];
}

/** Every field optional; `null` clears an optional one. */
export class UpdateStudentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @Matches(ADMISSION_NUMBER, {
    message: 'admissionNumber may contain letters, digits and / . _ - (up to 30 characters)',
  })
  admissionNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimToNull)
  @optionalNullable()
  @IsString()
  @MaxLength(100)
  middleName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsCalendarDate()
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: GENDERS })
  @IsOptional()
  @IsIn(GENDERS)
  gender?: (typeof GENDERS)[number];

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimToNull)
  @optionalNullable()
  @IsString()
  @MaxLength(100)
  nationality?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsCalendarDate()
  admissionDate?: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimToNull)
  @optionalNullable()
  @IsString()
  @MaxLength(200)
  emergencyContactName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimToNull)
  @optionalNullable()
  @Matches(PHONE, { message: PHONE_MESSAGE })
  emergencyContactPhone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimToNull)
  @optionalNullable()
  @IsString()
  @MaxLength(100)
  emergencyContactRelationship?: string | null;
}

export class StudentFilterDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches name or admission number.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  streamId?: string;

  @ApiPropertyOptional({ enum: STUDENT_STATUSES, description: 'Defaults to all statuses.' })
  @IsOptional()
  @IsIn(STUDENT_STATUSES)
  status?: StudentStatusValue;

  @ApiPropertyOptional({ enum: GENDERS })
  @IsOptional()
  @IsIn(GENDERS)
  gender?: (typeof GENDERS)[number];

  @ApiPropertyOptional({ enum: STUDENT_SORTS, default: 'name' })
  @IsOptional()
  @IsIn(STUDENT_SORTS)
  sort: (typeof STUDENT_SORTS)[number] = 'name';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'asc';
}

export class TransferStudentDto {
  @ApiProperty()
  @IsUUID()
  classId: string;

  @ApiPropertyOptional({ nullable: true })
  @optionalNullable()
  @IsUUID()
  streamId?: string | null;

  @ApiPropertyOptional({ description: 'Defaults to today.' })
  @IsOptional()
  @IsCalendarDate()
  effectiveDate?: string;
}

export class ChangeStudentStatusDto {
  @ApiProperty({ enum: STUDENT_STATUSES })
  @IsIn(STUDENT_STATUSES)
  status: StudentStatusValue;

  @ApiPropertyOptional({ description: 'Defaults to today.' })
  @IsOptional()
  @IsCalendarDate()
  effectiveDate?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Why the student is leaving.' })
  @Transform(trimToNull)
  @optionalNullable()
  @IsString()
  @MaxLength(300)
  reason?: string | null;

  @ApiPropertyOptional({ description: 'Required when re-admitting a student who had left.' })
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional({ nullable: true })
  @optionalNullable()
  @IsUUID()
  streamId?: string | null;
}

export class PromoteStudentsDto {
  @ApiProperty({ description: 'Class the students are currently in.' })
  @IsUUID()
  fromClassId: string;

  @ApiProperty({ description: 'Academic year they move into.' })
  @IsUUID()
  toAcademicYearId: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Class they move to. The same class means repeating. Omit to graduate them.',
  })
  @optionalNullable()
  @IsUUID()
  toClassId?: string | null;

  @ApiProperty({
    type: [String],
    description: 'The students to move; others are left as they are.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  studentIds: string[];
}

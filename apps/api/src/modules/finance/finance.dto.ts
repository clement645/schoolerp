import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDate } from '../../common/http/dates.js';
import { PaginationQueryDto } from '../../common/http/pagination.js';
import { trim, trimToNull, upperTrim } from '../../common/http/transforms.js';

/** The largest single amount accepted, well inside DECIMAL(14,2). */
export const MAX_AMOUNT = 999_999_999;

/** A positive amount of money with at most two decimal places. */
const IsMoney = () => (target: object, key: string) => {
  IsNumber(
    { maxDecimalPlaces: 2 },
    { message: '$property must be an amount with at most 2 decimal places' },
  )(target, key);
  IsPositive({ message: '$property must be greater than zero' })(target, key);
  Max(MAX_AMOUNT)(target, key);
};

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'MPESA', 'CARD'] as const;
export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];
export const INVOICE_FILTERS = [
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'VOID',
  'OUTSTANDING',
  'OVERDUE',
] as const;
export const DISCOUNT_KINDS = ['PERCENTAGE', 'FIXED'] as const;
export const DISCOUNT_CATEGORIES = ['DISCOUNT', 'SCHOLARSHIP'] as const;
export const MPESA_STATUSES = ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT'] as const;

// ── Fee items and structures ─────────────────────────────────────────────────

export class CreateFeeItemDto {
  @ApiProperty({ example: 'Tuition' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  description?: string | null;
}

export class UpdateFeeItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class FeeStructureLineDto {
  @ApiProperty()
  @IsUUID()
  feeItemId: string;

  @ApiProperty({ example: 25000 })
  @IsMoney()
  amount: number;
}

export class SaveFeeStructureDto {
  @ApiProperty({ example: 'Grade 7 — Term 3 fees' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty()
  @IsUUID()
  termId: string;

  @ApiPropertyOptional({ nullable: true, description: 'Omit or null for every class.' })
  @IsOptional()
  @IsUUID()
  classId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ type: [FeeStructureLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FeeStructureLineDto)
  lines: FeeStructureLineDto[];
}

// ── Discounts and scholarships ───────────────────────────────────────────────

export class CreateDiscountDto {
  @ApiProperty()
  @IsUUID()
  studentId: string;

  @ApiProperty({ example: 'Sibling discount' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiProperty({ enum: DISCOUNT_CATEGORIES })
  @IsIn(DISCOUNT_CATEGORIES)
  category: (typeof DISCOUNT_CATEGORIES)[number];

  @ApiProperty({ enum: DISCOUNT_KINDS })
  @IsIn(DISCOUNT_KINDS)
  kind: (typeof DISCOUNT_KINDS)[number];

  @ApiProperty({ description: 'A percentage (up to 100) or a fixed amount.' })
  @IsMoney()
  value: number;

  @ApiPropertyOptional({ nullable: true, description: 'Limit the discount to one fee item.' })
  @IsOptional()
  @IsUUID()
  feeItemId?: string | null;
}

export class UpdateDiscountDto {
  @ApiProperty()
  @IsBoolean()
  isActive: boolean;
}

export class DiscountsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

// ── Invoices ─────────────────────────────────────────────────────────────────

export class InvoiceLineDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  feeItemId?: string | null;

  @ApiProperty({ example: 'Tuition — Term 3' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  description: string;

  @ApiProperty()
  @IsMoney()
  amount: number;
}

export class CreateInvoiceDto {
  @ApiProperty()
  @IsUUID()
  studentId: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  termId?: string | null;

  @ApiPropertyOptional({ description: 'Defaults to today.' })
  @IsOptional()
  @IsCalendarDate()
  issueDate?: string;

  @ApiProperty()
  @IsCalendarDate()
  dueDate: string;

  @ApiPropertyOptional({ default: true, description: 'Apply the learner’s standing discounts.' })
  @IsOptional()
  @IsBoolean()
  applyDiscounts?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  notes?: string | null;

  @ApiProperty({ type: [InvoiceLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines: InvoiceLineDto[];
}

export class GenerateInvoicesDto {
  @ApiProperty()
  @IsUUID()
  feeStructureId: string;

  @ApiPropertyOptional({ description: 'Defaults to today.' })
  @IsOptional()
  @IsCalendarDate()
  issueDate?: string;

  @ApiProperty()
  @IsCalendarDate()
  dueDate: string;
}

export class InvoicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: INVOICE_FILTERS })
  @IsOptional()
  @IsIn(INVOICE_FILTERS)
  status?: (typeof INVOICE_FILTERS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  termId?: string;

  @ApiPropertyOptional({ description: 'Invoice number, learner name or admission number.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  search?: string;
}

export class ReasonDto {
  @ApiProperty({ description: 'Why this is being done; kept on the record.' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;
}

export class CreateCreditNoteDto extends ReasonDto {
  @ApiProperty()
  @IsMoney()
  amount: number;
}

// ── Payments and refunds ─────────────────────────────────────────────────────

export class RecordPaymentDto {
  @ApiProperty()
  @IsUUID()
  studentId: string;

  @ApiProperty()
  @IsMoney()
  amount: number;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  method: PaymentMethodValue;

  @ApiPropertyOptional({ nullable: true, description: 'Required for every method except cash.' })
  @IsOptional()
  @Transform(upperTrim)
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9/_-]{2,49}$/, {
    message: 'reference must be 3–50 letters, digits, dashes or slashes',
  })
  reference?: string | null;

  @ApiPropertyOptional({ description: 'Defaults to today.' })
  @IsOptional()
  @IsCalendarDate()
  paidOn?: string;

  @ApiPropertyOptional({ description: 'Settle this invoice first; the rest goes to the oldest.' })
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  notes?: string | null;
}

export class PaymentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional({ enum: PAYMENT_METHODS })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethodValue;

  @ApiPropertyOptional({ enum: ['COMPLETED', 'REVERSED'] })
  @IsOptional()
  @IsIn(['COMPLETED', 'REVERSED'])
  status?: 'COMPLETED' | 'REVERSED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsCalendarDate()
  to?: string;

  @ApiPropertyOptional({
    description: 'Receipt number, reference, learner name or admission number.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  search?: string;
}

export class CreateRefundDto extends ReasonDto {
  @ApiProperty()
  @IsMoney()
  amount: number;

  @ApiProperty({ enum: PAYMENT_METHODS, description: 'How the money is returned.' })
  @IsIn(PAYMENT_METHODS)
  method: PaymentMethodValue;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(upperTrim)
  @IsString()
  @MaxLength(50)
  reference?: string | null;
}

// ── Reports ──────────────────────────────────────────────────────────────────

export class StatementQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsCalendarDate()
  to?: string;
}

export class FinanceSummaryQueryDto {
  @ApiPropertyOptional({ description: 'Limit invoicing figures to one term.' })
  @IsOptional()
  @IsUUID()
  termId?: string;
}

// ── M-Pesa ───────────────────────────────────────────────────────────────────

export class StkPushDto {
  @ApiProperty()
  @IsUUID()
  studentId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @ApiProperty({ example: '0712345678', description: 'Safaricom number that will be prompted.' })
  @Transform(trim)
  @Matches(/^(?:\+?254|0)(?:7|1)\d{8}$/, { message: 'phone must be a Kenyan mobile number' })
  phone: string;

  @ApiProperty({ description: 'Whole shillings; M-Pesa does not accept cents.' })
  @IsNumber({ maxDecimalPlaces: 0 }, { message: 'amount must be a whole number of shillings' })
  @IsPositive()
  @Max(250_000)
  amount: number;
}

export class MpesaQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MPESA_STATUSES })
  @IsOptional()
  @IsIn(MPESA_STATUSES)
  status?: (typeof MPESA_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

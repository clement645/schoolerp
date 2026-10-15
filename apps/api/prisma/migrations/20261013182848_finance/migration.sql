-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "InvoiceLineKind" AS ENUM ('CHARGE', 'DISCOUNT');

-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "DiscountCategory" AS ENUM ('DISCOUNT', 'SCHOLARSHIP');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'MPESA', 'CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('COMPLETED', 'REVERSED');

-- CreateEnum
CREATE TYPE "MpesaStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT');

-- AlterTable
ALTER TABLE "school_settings" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'KES';

-- CreateTable
CREATE TABLE "fee_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fee_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structures" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "term_id" UUID NOT NULL,
    "class_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fee_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structure_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "fee_structure_id" UUID NOT NULL,
    "fee_item_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "fee_structure_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_discounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "DiscountCategory" NOT NULL DEFAULT 'DISCOUNT',
    "kind" "DiscountKind" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "fee_item_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "student_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_counters" (
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "finance_counters_pkey" PRIMARY KEY ("school_id","kind","year")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "student_id" UUID NOT NULL,
    "term_id" UUID,
    "fee_structure_id" UUID,
    "class_name" TEXT,
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discount_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "paid_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "created_by_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "kind" "InvoiceLineKind" NOT NULL DEFAULT 'CHARGE',
    "fee_item_id" UUID,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "student_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "paid_on" DATE NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "allocated_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refunded_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "received_by_id" UUID,
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by_id" UUID,
    "reversal_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "invoice_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "payment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "reason" TEXT NOT NULL,
    "refunded_on" DATE NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mpesa_transactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "invoice_id" UUID,
    "phone" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "account_reference" TEXT NOT NULL,
    "merchant_request_id" TEXT NOT NULL,
    "checkout_request_id" TEXT NOT NULL,
    "status" "MpesaStatus" NOT NULL DEFAULT 'PENDING',
    "result_code" INTEGER,
    "result_description" TEXT,
    "mpesa_receipt_number" TEXT,
    "payment_id" UUID,
    "initiated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "mpesa_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fee_items_tenant_id_idx" ON "fee_items"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_items_school_id_name_key" ON "fee_items"("school_id", "name");

-- CreateIndex
CREATE INDEX "fee_structures_tenant_id_idx" ON "fee_structures"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structures_school_id_term_id_name_key" ON "fee_structures"("school_id", "term_id", "name");

-- CreateIndex
CREATE INDEX "fee_structure_lines_tenant_id_idx" ON "fee_structure_lines"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structure_lines_fee_structure_id_fee_item_id_key" ON "fee_structure_lines"("fee_structure_id", "fee_item_id");

-- CreateIndex
CREATE INDEX "student_discounts_tenant_id_idx" ON "student_discounts"("tenant_id");

-- CreateIndex
CREATE INDEX "student_discounts_student_id_idx" ON "student_discounts"("student_id");

-- CreateIndex
CREATE INDEX "finance_counters_tenant_id_idx" ON "finance_counters"("tenant_id");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_idx" ON "invoices"("tenant_id");

-- CreateIndex
CREATE INDEX "invoices_student_id_idx" ON "invoices"("student_id");

-- CreateIndex
CREATE INDEX "invoices_school_id_status_idx" ON "invoices"("school_id", "status");

-- CreateIndex
CREATE INDEX "invoices_school_id_due_date_idx" ON "invoices"("school_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_school_id_number_key" ON "invoices"("school_id", "number");

-- CreateIndex
CREATE INDEX "invoice_lines_tenant_id_idx" ON "invoice_lines"("tenant_id");

-- CreateIndex
CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines"("invoice_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_idx" ON "payments"("tenant_id");

-- CreateIndex
CREATE INDEX "payments_student_id_idx" ON "payments"("student_id");

-- CreateIndex
CREATE INDEX "payments_school_id_paid_on_idx" ON "payments"("school_id", "paid_on");

-- CreateIndex
CREATE UNIQUE INDEX "payments_school_id_receipt_number_key" ON "payments"("school_id", "receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "payments_school_id_method_reference_key" ON "payments"("school_id", "method", "reference");

-- CreateIndex
CREATE INDEX "payment_allocations_tenant_id_idx" ON "payment_allocations"("tenant_id");

-- CreateIndex
CREATE INDEX "payment_allocations_invoice_id_idx" ON "payment_allocations"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_payment_id_invoice_id_key" ON "payment_allocations"("payment_id", "invoice_id");

-- CreateIndex
CREATE INDEX "credit_notes_tenant_id_idx" ON "credit_notes"("tenant_id");

-- CreateIndex
CREATE INDEX "credit_notes_student_id_idx" ON "credit_notes"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_school_id_number_key" ON "credit_notes"("school_id", "number");

-- CreateIndex
CREATE INDEX "refunds_tenant_id_idx" ON "refunds"("tenant_id");

-- CreateIndex
CREATE INDEX "refunds_student_id_idx" ON "refunds"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_school_id_number_key" ON "refunds"("school_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_transactions_checkout_request_id_key" ON "mpesa_transactions"("checkout_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_transactions_mpesa_receipt_number_key" ON "mpesa_transactions"("mpesa_receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_transactions_payment_id_key" ON "mpesa_transactions"("payment_id");

-- CreateIndex
CREATE INDEX "mpesa_transactions_tenant_id_idx" ON "mpesa_transactions"("tenant_id");

-- CreateIndex
CREATE INDEX "mpesa_transactions_school_id_status_idx" ON "mpesa_transactions"("school_id", "status");

-- CreateIndex
CREATE INDEX "mpesa_transactions_student_id_idx" ON "mpesa_transactions"("student_id");

-- AddForeignKey
ALTER TABLE "fee_items" ADD CONSTRAINT "fee_items_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_fee_structure_id_fkey" FOREIGN KEY ("fee_structure_id") REFERENCES "fee_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_fee_item_id_fkey" FOREIGN KEY ("fee_item_id") REFERENCES "fee_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_discounts" ADD CONSTRAINT "student_discounts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_discounts" ADD CONSTRAINT "student_discounts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_discounts" ADD CONSTRAINT "student_discounts_fee_item_id_fkey" FOREIGN KEY ("fee_item_id") REFERENCES "fee_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_fee_structure_id_fkey" FOREIGN KEY ("fee_structure_id") REFERENCES "fee_structures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_fee_item_id_fkey" FOREIGN KEY ("fee_item_id") REFERENCES "fee_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_transactions" ADD CONSTRAINT "mpesa_transactions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_transactions" ADD CONSTRAINT "mpesa_transactions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_transactions" ADD CONSTRAINT "mpesa_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Amounts are positive, and derived totals can never go out of range.
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_amount_check" CHECK ("amount" > 0);
ALTER TABLE "student_discounts" ADD CONSTRAINT "student_discounts_value_check"
  CHECK ("value" > 0 AND ("kind" <> 'PERCENTAGE' OR "value" <= 100));
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_amount_check" CHECK ("amount" > 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_totals_check" CHECK (
  "subtotal" >= 0 AND "discount_total" >= 0 AND "total" >= 0 AND "paid_total" >= 0
  AND "credit_total" >= 0 AND "balance" >= 0
  AND "total" = "subtotal" - "discount_total"
  AND ("status" = 'VOID' OR "balance" = "total" - "paid_total" - "credit_total")
);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_dates_check" CHECK ("due_date" >= "issue_date");
ALTER TABLE "payments" ADD CONSTRAINT "payments_amounts_check" CHECK (
  "amount" > 0 AND "allocated_total" >= 0 AND "refunded_total" >= 0
  AND "allocated_total" + "refunded_total" <= "amount"
);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount_check" CHECK ("amount" > 0);
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_amount_check" CHECK ("amount" > 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_check" CHECK ("amount" > 0);
ALTER TABLE "mpesa_transactions" ADD CONSTRAINT "mpesa_transactions_amount_check" CHECK ("amount" > 0);

-- A learner is invoiced at most once for a fee structure, unless the earlier
-- invoice was voided.
CREATE UNIQUE INDEX "invoices_student_structure_key" ON "invoices"("student_id", "fee_structure_id")
  WHERE "fee_structure_id" IS NOT NULL AND "status" <> 'VOID';

-- Tenant isolation (see docs/adr/0002). No DELETE on financial records.
GRANT SELECT, INSERT, UPDATE ON "fee_items" TO edumaster_app;
ALTER TABLE "fee_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "fee_items"
  TO edumaster_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON "fee_structures" TO edumaster_app;
ALTER TABLE "fee_structures" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "fee_structures"
  TO edumaster_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "fee_structure_lines" TO edumaster_app;
ALTER TABLE "fee_structure_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "fee_structure_lines"
  TO edumaster_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON "student_discounts" TO edumaster_app;
ALTER TABLE "student_discounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "student_discounts"
  TO edumaster_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON "finance_counters" TO edumaster_app;
ALTER TABLE "finance_counters" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "finance_counters"
  TO edumaster_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON "invoices" TO edumaster_app;
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "invoices"
  TO edumaster_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

GRANT SELECT, INSERT ON "invoice_lines" TO edumaster_app;
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "invoice_lines"
  TO edumaster_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON "payments" TO edumaster_app;
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "payments"
  TO edumaster_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_allocations" TO edumaster_app;
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "payment_allocations"
  TO edumaster_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

GRANT SELECT, INSERT ON "credit_notes" TO edumaster_app;
ALTER TABLE "credit_notes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "credit_notes"
  TO edumaster_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

GRANT SELECT, INSERT ON "refunds" TO edumaster_app;
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "refunds"
  TO edumaster_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON "mpesa_transactions" TO edumaster_app;
ALTER TABLE "mpesa_transactions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mpesa_transactions"
  TO edumaster_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());


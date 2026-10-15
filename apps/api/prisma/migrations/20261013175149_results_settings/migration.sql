-- CreateEnum
CREATE TYPE "RankingPolicy" AS ENUM ('COMPETITION', 'DENSE');

-- AlterTable
ALTER TABLE "results" ADD COLUMN     "passed" BOOLEAN;

-- CreateTable
CREATE TABLE "school_settings" (
    "school_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pass_mark" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "ranking_policy" "RankingPolicy" NOT NULL DEFAULT 'COMPETITION',
    "show_class_position" BOOLEAN NOT NULL DEFAULT true,
    "show_stream_position" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "school_settings_pkey" PRIMARY KEY ("school_id")
);

-- CreateIndex
CREATE INDEX "school_settings_tenant_id_idx" ON "school_settings"("tenant_id");

-- AddForeignKey
ALTER TABLE "school_settings" ADD CONSTRAINT "school_settings_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "school_settings"
  ADD CONSTRAINT "school_settings_pass_mark_check" CHECK ("pass_mark" >= 0 AND "pass_mark" <= 100);

-- Tenant isolation (see docs/adr/0002)
GRANT SELECT, INSERT, UPDATE ON "school_settings" TO edumaster_app;
ALTER TABLE "school_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "school_settings"
  TO edumaster_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

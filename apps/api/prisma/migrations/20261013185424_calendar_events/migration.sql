-- CreateEnum
CREATE TYPE "CalendarCategory" AS ENUM ('ACADEMIC', 'EXAMINATION', 'HOLIDAY', 'MEETING', 'SPORTS', 'OTHER');

-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('EVERYONE', 'STAFF');

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "CalendarCategory" NOT NULL DEFAULT 'ACADEMIC',
    "visibility" "EventVisibility" NOT NULL DEFAULT 'EVERYONE',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "start_time" TEXT,
    "end_time" TEXT,
    "location" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_events_tenant_id_idx" ON "calendar_events"("tenant_id");

-- CreateIndex
CREATE INDEX "calendar_events_school_id_start_date_idx" ON "calendar_events"("school_id", "start_date");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_dates_check" CHECK ("end_date" >= "start_date");

-- Tenant isolation (see docs/adr/0002)
GRANT SELECT, INSERT, UPDATE, DELETE ON "calendar_events" TO edumaster_app;
ALTER TABLE "calendar_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "calendar_events"
  TO edumaster_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

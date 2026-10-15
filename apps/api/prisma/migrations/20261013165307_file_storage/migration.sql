-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('BIRTH_CERTIFICATE', 'MEDICAL', 'PREVIOUS_SCHOOL', 'IDENTIFICATION', 'OTHER');

-- AlterTable
ALTER TABLE "schools" ADD COLUMN     "logo_content_type" TEXT,
ADD COLUMN     "logo_key" TEXT;

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "photo_content_type" TEXT,
ADD COLUMN     "photo_key" TEXT;

-- CreateTable
CREATE TABLE "student_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_documents_storage_key_key" ON "student_documents"("storage_key");

-- CreateIndex
CREATE INDEX "student_documents_tenant_id_idx" ON "student_documents"("tenant_id");

-- CreateIndex
CREATE INDEX "student_documents_student_id_created_at_idx" ON "student_documents"("student_id", "created_at");

-- AddForeignKey
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "student_documents"
  ADD CONSTRAINT "student_documents_size_check" CHECK ("size_bytes" > 0);

-- Tenant isolation (see docs/adr/0002)
GRANT SELECT, INSERT, DELETE ON "student_documents" TO edumaster_app;
ALTER TABLE "student_documents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "student_documents"
  TO edumaster_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

-- CreateEnum
CREATE TYPE "ExaminationType" AS ENUM ('OPENING', 'MID_TERM', 'END_TERM', 'MOCK', 'CONTINUOUS_ASSESSMENT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ExaminationStatus" AS ENUM ('DRAFT', 'OPEN', 'COMPILED', 'APPROVED', 'PUBLISHED');

-- CreateTable
CREATE TABLE "examinations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ExaminationType" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "ExaminationStatus" NOT NULL DEFAULT 'DRAFT',
    "compile_version" INTEGER NOT NULL DEFAULT 0,
    "compiled_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "published_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "examinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "examination_subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "examination_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "max_marks" DECIMAL(6,2) NOT NULL,
    "is_compulsory" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "examination_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "examination_subject_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "score" DECIMAL(6,2),
    "level" TEXT,
    "is_absent" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "results" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "examination_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "compile_version" INTEGER NOT NULL,
    "class_name" TEXT NOT NULL,
    "stream_name" TEXT,
    "grading_scheme" TEXT NOT NULL,
    "total_score" DECIMAL(8,2) NOT NULL,
    "max_total" DECIMAL(8,2) NOT NULL,
    "average" DECIMAL(6,2) NOT NULL,
    "grade" TEXT,
    "grade_descriptor" TEXT,
    "points" DECIMAL(5,2),
    "subjects_sat" INTEGER NOT NULL,
    "is_complete" BOOLEAN NOT NULL,
    "class_position" INTEGER,
    "class_size" INTEGER NOT NULL,
    "stream_position" INTEGER,
    "stream_size" INTEGER,
    "class_teacher_remarks" TEXT,
    "principal_remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "subject_name" TEXT NOT NULL,
    "subject_code" TEXT NOT NULL,
    "max_marks" DECIMAL(6,2) NOT NULL,
    "score" DECIMAL(6,2),
    "percentage" DECIMAL(6,2),
    "grade" TEXT,
    "points" DECIMAL(5,2),
    "is_absent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "result_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "examinations_tenant_id_idx" ON "examinations"("tenant_id");

-- CreateIndex
CREATE INDEX "examinations_school_id_status_idx" ON "examinations"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "examinations_term_id_name_key" ON "examinations"("term_id", "name");

-- CreateIndex
CREATE INDEX "examination_subjects_tenant_id_idx" ON "examination_subjects"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "examination_subjects_examination_id_class_id_subject_id_key" ON "examination_subjects"("examination_id", "class_id", "subject_id");

-- CreateIndex
CREATE INDEX "marks_tenant_id_idx" ON "marks"("tenant_id");

-- CreateIndex
CREATE INDEX "marks_student_id_idx" ON "marks"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "marks_examination_subject_id_student_id_key" ON "marks"("examination_subject_id", "student_id");

-- CreateIndex
CREATE INDEX "results_tenant_id_idx" ON "results"("tenant_id");

-- CreateIndex
CREATE INDEX "results_examination_id_class_id_idx" ON "results"("examination_id", "class_id");

-- CreateIndex
CREATE INDEX "results_student_id_idx" ON "results"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "results_examination_id_student_id_key" ON "results"("examination_id", "student_id");

-- CreateIndex
CREATE INDEX "result_subjects_tenant_id_idx" ON "result_subjects"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "result_subjects_result_id_subject_id_key" ON "result_subjects"("result_id", "subject_id");

-- AddForeignKey
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examination_subjects" ADD CONSTRAINT "examination_subjects_examination_id_fkey" FOREIGN KEY ("examination_id") REFERENCES "examinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examination_subjects" ADD CONSTRAINT "examination_subjects_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examination_subjects" ADD CONSTRAINT "examination_subjects_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_examination_subject_id_fkey" FOREIGN KEY ("examination_subject_id") REFERENCES "examination_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_examination_id_fkey" FOREIGN KEY ("examination_id") REFERENCES "examinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_subjects" ADD CONSTRAINT "result_subjects_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Integrity constraints Prisma cannot express
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "examinations"
  ADD CONSTRAINT "examinations_date_order_check" CHECK ("start_date" <= "end_date");
ALTER TABLE "examination_subjects"
  ADD CONSTRAINT "examination_subjects_max_marks_check" CHECK ("max_marks" > 0);
ALTER TABLE "marks"
  ADD CONSTRAINT "marks_score_check" CHECK ("score" IS NULL OR "score" >= 0),
  -- An absent learner has neither a score nor a level.
  ADD CONSTRAINT "marks_absent_check" CHECK (NOT "is_absent" OR ("score" IS NULL AND "level" IS NULL)),
  ADD CONSTRAINT "marks_version_check" CHECK ("version" >= 1);

-- ─────────────────────────────────────────────────────────────────────────────
-- Tenant isolation (see docs/adr/0002)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'examinations', 'examination_subjects', 'marks', 'results', 'result_subjects'
  ]
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO edumaster_app', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO edumaster_app '
      'USING (tenant_id = app_current_tenant_id()) '
      'WITH CHECK (tenant_id = app_current_tenant_id())', t);
  END LOOP;
END
$$;

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TRANSFERRED', 'WITHDRAWN', 'GRADUATED');

-- CreateEnum
CREATE TYPE "EnrollmentReason" AS ENUM ('ADMISSION', 'READMISSION', 'PROMOTION', 'TRANSFER', 'REPEAT');

-- CreateEnum
CREATE TYPE "GuardianRelationship" AS ENUM ('FATHER', 'MOTHER', 'GUARDIAN', 'GRANDPARENT', 'SIBLING', 'OTHER');

-- CreateEnum
CREATE TYPE "TeacherStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TeacherAssignmentKind" AS ENUM ('SUBJECT_TEACHER', 'CLASS_TEACHER');

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "admission_number" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "last_name" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "nationality" TEXT,
    "admission_date" DATE NOT NULL,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_class_id" UUID,
    "current_stream_id" UUID,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "emergency_contact_relationship" TEXT,
    "left_on" DATE,
    "leaving_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "stream_id" UUID,
    "reason" "EnrollmentReason" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "occupation" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_guardians" (
    "student_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "relationship" "GuardianRelationship" NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_guardians_pkey" PRIMARY KEY ("student_id","guardian_id")
);

-- CreateTable
CREATE TABLE "teachers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "user_id" UUID,
    "staff_number" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "gender" "Gender",
    "phone" TEXT,
    "email" TEXT,
    "registration_number" TEXT,
    "employment_date" DATE,
    "status" "TeacherStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "stream_id" UUID,
    "subject_id" UUID,
    "kind" "TeacherAssignmentKind" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "students_tenant_id_idx" ON "students"("tenant_id");

-- CreateIndex
CREATE INDEX "students_school_id_status_idx" ON "students"("school_id", "status");

-- CreateIndex
CREATE INDEX "students_school_id_current_class_id_current_stream_id_idx" ON "students"("school_id", "current_class_id", "current_stream_id");

-- CreateIndex
CREATE INDEX "students_school_id_last_name_first_name_idx" ON "students"("school_id", "last_name", "first_name");

-- CreateIndex
CREATE UNIQUE INDEX "students_school_id_admission_number_key" ON "students"("school_id", "admission_number");

-- CreateIndex
CREATE INDEX "enrollments_tenant_id_idx" ON "enrollments"("tenant_id");

-- CreateIndex
CREATE INDEX "enrollments_student_id_start_date_idx" ON "enrollments"("student_id", "start_date");

-- CreateIndex
CREATE INDEX "enrollments_academic_year_id_class_id_stream_id_idx" ON "enrollments"("academic_year_id", "class_id", "stream_id");

-- CreateIndex
CREATE INDEX "guardians_tenant_id_idx" ON "guardians"("tenant_id");

-- CreateIndex
CREATE INDEX "guardians_school_id_phone_idx" ON "guardians"("school_id", "phone");

-- CreateIndex
CREATE INDEX "student_guardians_tenant_id_idx" ON "student_guardians"("tenant_id");

-- CreateIndex
CREATE INDEX "student_guardians_guardian_id_idx" ON "student_guardians"("guardian_id");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_user_id_key" ON "teachers"("user_id");

-- CreateIndex
CREATE INDEX "teachers_tenant_id_idx" ON "teachers"("tenant_id");

-- CreateIndex
CREATE INDEX "teachers_school_id_last_name_first_name_idx" ON "teachers"("school_id", "last_name", "first_name");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_school_id_staff_number_key" ON "teachers"("school_id", "staff_number");

-- CreateIndex
CREATE INDEX "teacher_assignments_tenant_id_idx" ON "teacher_assignments"("tenant_id");

-- CreateIndex
CREATE INDEX "teacher_assignments_teacher_id_academic_year_id_idx" ON "teacher_assignments"("teacher_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "teacher_assignments_academic_year_id_class_id_stream_id_idx" ON "teacher_assignments"("academic_year_id", "class_id", "stream_id");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_current_class_id_fkey" FOREIGN KEY ("current_class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_current_stream_id_fkey" FOREIGN KEY ("current_stream_id") REFERENCES "streams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "streams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "streams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Integrity constraints Prisma cannot express
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "students"
  ADD CONSTRAINT "students_dates_check" CHECK ("date_of_birth" < "admission_date"),
  ADD CONSTRAINT "students_left_on_check" CHECK ("left_on" IS NULL OR "left_on" >= "admission_date"),
  -- A stream only makes sense within a class.
  ADD CONSTRAINT "students_stream_needs_class_check"
    CHECK ("current_stream_id" IS NULL OR "current_class_id" IS NOT NULL);

ALTER TABLE "enrollments"
  ADD CONSTRAINT "enrollments_date_order_check" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");

ALTER TABLE "teacher_assignments"
  ADD CONSTRAINT "teacher_assignments_subject_check" CHECK (
    ("kind" = 'SUBJECT_TEACHER' AND "subject_id" IS NOT NULL)
    OR ("kind" = 'CLASS_TEACHER' AND "subject_id" IS NULL)
  );

-- A student is in one place at a time.
CREATE UNIQUE INDEX "enrollments_one_open_per_student"
  ON "enrollments" ("student_id") WHERE "end_date" IS NULL;

-- One primary guardian per student.
CREATE UNIQUE INDEX "student_guardians_one_primary_per_student"
  ON "student_guardians" ("student_id") WHERE "is_primary";

-- The same subject is not assigned twice to the same teacher for the same
-- class/stream, and a class or stream has one class teacher per year.
-- (NULL stream = whole class; COALESCE makes NULLs comparable.)
CREATE UNIQUE INDEX "teacher_assignments_no_duplicate_subject"
  ON "teacher_assignments" (
    "teacher_id", "academic_year_id", "class_id",
    COALESCE("stream_id", '00000000-0000-0000-0000-000000000000'::uuid), "subject_id"
  ) WHERE "kind" = 'SUBJECT_TEACHER';

CREATE UNIQUE INDEX "teacher_assignments_one_class_teacher"
  ON "teacher_assignments" (
    "academic_year_id", "class_id",
    COALESCE("stream_id", '00000000-0000-0000-0000-000000000000'::uuid)
  ) WHERE "kind" = 'CLASS_TEACHER';

-- ─────────────────────────────────────────────────────────────────────────────
-- Tenant isolation (see docs/adr/0002)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'students', 'enrollments', 'guardians', 'student_guardians', 'teachers', 'teacher_assignments'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO edumaster_app '
      'USING (tenant_id = app_current_tenant_id()) '
      'WITH CHECK (tenant_id = app_current_tenant_id())', t);
  END LOOP;
END
$$;

-- Students and enrolments are a permanent record: never deleted by tenants.
GRANT SELECT, INSERT, UPDATE ON "students", "enrollments" TO edumaster_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "guardians", "student_guardians", "teachers", "teacher_assignments" TO edumaster_app;

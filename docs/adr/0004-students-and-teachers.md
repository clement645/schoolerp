# ADR 0004 — Students, guardians and teachers

- **Status:** Accepted
- **Date:** 2026-10-13
- **Phase:** 6 (Student and teacher management)

## Context

Student records are the school's permanent register: they outlive the years a
learner attends, and marks, attendance and fees will all hang off them. They
are also the most sensitive data in the system, so who may see which student
has to be decided by the server, not by which screen a user happens to open.

## Decisions

### Enrolments are the history; the student row holds the present

Each placement of a student in a class for an academic year is an `enrollments`
row with a start date, an end date once it is over, and a reason (admission,
promotion, transfer, repeat, re-admission). A partial unique index allows at
most one open enrolment per student. Moving, promoting or leaving closes the
open row and, where applicable, opens a new one in the same transaction, so
the register can always answer "where was this learner on a given date".

`students.current_class_id` / `current_stream_id` duplicate the open enrolment
for fast filtering. For a student who has left they keep the last class.

### Students are never deleted

Leaving is a status (`TRANSFERRED`, `WITHDRAWN`, `GRADUATED`) with a date and a
reason, and a student who left can be re-admitted. The application's database
role has no `DELETE` privilege on `students` or `enrollments` at all.

### Promotion is an explicit, per-class bulk action

An administrator chooses a class, the academic year to move into, and an
outcome: another class, the same class (repeat), or graduation. Everyone in
the class is selected by default and individuals can be held back. Old
enrolments end with their academic year and new ones begin with the target
year. A student keeps the stream of the same name where the next class has
one; otherwise they are left without a stream for the school to place. The
whole batch succeeds or fails together, and each student gets an audit record.

### Guardians are people, shared between siblings

A guardian is one record linked to any number of students, each link carrying
the relationship and whether they are that student's primary contact (at most
one, enforced by a partial unique index). Editing contact details therefore
updates them for every child. Removing the last link deletes the guardian,
since personal data with no purpose should not be kept.

### A teacher's access follows their assignments

`teacher_assignments` records what a teacher does in an academic year: teach a
subject to a class or stream, or be its class teacher. A staff profile can be
linked to a login account.

Roles that work across the school (administrators, principal, deputy,
examination officer, accountant) hold the `records:all_classes` permission.
Everyone else — teachers and class teachers — is restricted by
`ClassScopeService` to the classes and streams they are assigned to in the
current academic year. A student outside that scope is reported as "not
found", whether reached by list, search, export or direct link. A teacher
account with no linked or active staff profile sees no students.

This is enforced in the API. The interface hides what a user cannot do, but
that is presentation only.

### Import is all-or-nothing, and checked before it is committed

CSV import validates the entire file — format, required fields, dates,
duplicate admission numbers, and that each class and stream exists — and
reports every problem with its line number. Nothing is created unless the
whole file is clean. The same check runs as a dry run, which the interface
always performs first.

Uploads are limited to 1 MB and 1,000 rows, must have a `.csv` name and
contain no NUL bytes; the browser-reported MIME type is not trusted.

### Exports are neutralised and audited

Exported cells that a spreadsheet would execute as a formula (starting with
`=`, `+`, `-` or `@`) are prefixed with an apostrophe. Every export is written
to the audit log with the filters used and the number of rows, since it is how
personal data leaves the system. Exports respect the caller's class scope.

## Deferred

| Item                                         | When / why                                   |
| -------------------------------------------- | -------------------------------------------- |
| Excel (`.xlsx`) import and export            | With the marks spreadsheet work in Phase 7   |
| Academic, attendance and fee tabs on profile | Added by the phases that create that data    |
| Teacher timetables and lessons per week      | Phase 14 (timetable)                         |
| Parent and student portal accounts           | Phase 13                                     |
| Trigram index for name search                | Phase 15, if profiling at scale calls for it |

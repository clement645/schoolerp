# ADR 0008 — Attendance

- **Status:** Accepted
- **Date:** 2026-10-13
- **Phase:** 11 (Attendance)

## Decisions

### One register per class per day; one mark per learner per day

`attendance_sessions` is unique on `(class_id, date)` — streams share their
class's session, so two stream teachers marking the same day never create two
registers. `attendance_records` is unique on `(student_id, date)`, so the
database itself refuses a duplicate mark, whatever the application does.

### Marking again corrects

Saving a register upserts: a learner already marked is corrected, not marked
twice. Only real changes are written and audited, each with its before and
after. Records are never deleted (the application role has no `DELETE`).

### Bulk by default

A register is saved in one request and one transaction. If any learner in it
is not an active member of the class, or is outside the caller's classes, the
whole register is refused.

### What "attended" means

Rate = (present + late) ÷ days marked. A late learner attended; an excused one
did not, though the absence is recorded as excused. A learner with nothing
marked has **no** rate, which is shown as a dash, never as 0%.

### No future registers

Attendance cannot be recorded ahead of time. The server works in UTC and has
no per-school time zone, so "today" is allowed to run one day ahead of the
server's date; a school east of UTC can mark from midnight local time.

## Consequences

- Past registers read as they were taken: a learner who has since moved class
  stays on the register of the day they were marked.
- Reports are limited to 366 days per request.

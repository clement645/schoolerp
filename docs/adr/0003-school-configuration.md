# ADR 0003 — School configuration

- **Status:** Accepted
- **Date:** 2026-10-13
- **Phase:** 5 (School configuration)

## Context

Before any student, mark or fee can be recorded, a school has to describe
itself: its profile, its academic years and terms, its classes and streams,
the subjects it teaches, and how it turns marks into grades. Later phases hang
their records off these tables, so their rules have to be right from the start.

## Decisions

### Records belong to a school, selected per request

Every configuration table carries `school_id` (the owner) and `tenant_id`
(for row-level security, see ADR 0002). The client names the school it is
working in with an `X-School-Id` header; a tenant with exactly one school may
omit it. `SchoolScopeService.run` resolves the school _inside_ the tenant
transaction, so another tenant's school id is simply not found, and every
service then filters by that school. Records of one school cannot be reached
or referenced through another, even within the same tenant.

Additional schools for a tenant are not yet creatable through the API; a
tenant gets its first school when it is provisioned.

### Academic years and terms

- Years of a school may not overlap. Terms must lie within their year and may
  not overlap each other. Dates are calendar dates (`DATE`), exchanged as
  `YYYY-MM-DD`, with no time zone to shift them.
- "Current" is a singleton: at most one current year and one current term per
  school, enforced by partial unique indexes rather than by convention.
  Choosing a current term makes its year current; choosing a year clears a
  current term from any other year. The first year created is current.
- A year cannot be shortened so that an existing term falls outside it.

### Grading schemes store only the lowest score of each grade

A grade is defined by its **minimum score**; its upper limit is wherever the
next grade begins. A scheme therefore cannot have gaps or overlaps, and a
score such as 79.5 always has exactly one grade — which is not true of the
familiar "75–79, 80–100" notation. The only structural rule left to check is
that the lowest grade starts at 0.

Two scheme types exist:

- `PERCENTAGE` — every grade has a minimum score.
- `COMPETENCY` — performance levels (for example EE / ME / AE / BE) with
  descriptors, awarded directly by the teacher. Score ranges are optional and
  all-or-nothing, so competency-based assessment never depends on a percentage.

A school has one default scheme; a class may be given its own, which lets one
school grade junior classes by competency and others by percentage. Nothing is
assumed about any national curriculum: the two templates offered in the UI are
labelled as examples and are fully editable.

Grade resolution (`resolveGrade`) is a pure function in the API. Results are
computed on the server from stored boundaries and are never taken from the
client.

Editing a scheme replaces its grades wholesale. That is safe because compiled
results (Phase 8) will store the grade they were awarded, not a reference to a
boundary, so published results cannot be changed by a later edit to the scheme.

### Deleting configuration

A record is deleted only when nothing depends on it; foreign keys are
`RESTRICT`, and the API answers `409` with an explanation. Where history must
survive, classes and subjects are marked inactive instead: an inactive subject
stays on the classes that already teach it but cannot be added to another.

### Auditing

Every change to configuration is recorded with before/after values and the
school it belongs to, in the same transaction as the change.

## Deferred

| Item                                            | When                          |
| ----------------------------------------------- | ----------------------------- |
| Creating additional schools; school switcher UI | With the first group customer |
| School logo upload                              | Object storage (Phase 6)      |
| Class teachers, subject teachers                | Phase 6                       |
| Subject weights, assessment components          | Phase 7 (examinations)        |
| Ranking and tie-handling policies               | Phase 8 (results)             |

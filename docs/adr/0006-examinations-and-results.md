# ADR 0006 — Examinations, marks and results

- **Status:** Accepted
- **Date:** 2026-10-13
- **Phases:** 7 (Examination management), 8 (Results and analytics)

## Context

Marks entry is the busiest screen in the product: several teachers type into
the same class's sheet in the same week. Results decide promotions and are
shown to parents, so they must be reproducible and must not change once
released.

## Decisions

### An examination moves through explicit states

`DRAFT → OPEN → COMPILED → APPROVED → PUBLISHED`, with `reopen` from
`COMPILED` or `APPROVED` back to `OPEN`. Marks can be entered only while
`OPEN`. Each transition is a conditional update on the state that was read, so
two people cannot both move the same examination, and each is audited.
Publishing is final: marks, results and remarks are locked.

### Results are computed on the server, from stored marks only

The client sends marks and nothing else. Totals, percentages, grades, points
and positions are computed in `results.calc.ts` (pure functions, unit-tested)
and any totals a client sends are rejected by validation. The marks sheet
shows running figures, but they too come back from the server after each save.

### Optimistic concurrency per mark

Every mark has a `version`. A save names the version it was based on; if any
mark in the batch has moved on, the whole batch is refused with `409
MARKS_CONFLICT` and the current values, and nothing is written. The interface
then shows whose value is there and lets the person choose. A batch is also
atomic for validation: one invalid mark rejects all of them.

### Results are a snapshot

Compiling writes `results` and `result_subjects` rows that copy the names,
maximum marks, grades and the grading scheme's name as they were. Renaming a
subject or editing a scheme afterwards does not alter a compiled result.
Recompiling replaces the snapshot under a new `compileVersion` and carries
remarks over. Reading results never recalculates anything; views of a
reopened examination's stale snapshot are refused (`RESULTS_NOT_COMPILED`).

### Ranking and pass rules are school policy, fixed at compilation

`school_settings` holds the pass mark, the tie rule (competition `1,2,2,4` or
dense `1,2,2,3`) and which positions appear on report cards. They are applied
when an examination is compiled; results already compiled keep the rules they
were compiled under. Level-based (competency) schemes have no percentage, so a
result passes when its overall level is in the upper half of the scheme's
levels.

### Teachers see and edit only what they teach

`ClassScopeService` narrows every query to the classes and streams a teacher
is assigned to in the current academic year; within a sheet only the subjects
they teach are editable. Staff with `records:all_classes` are unrestricted.
The same narrowing applies to results, analytics and report cards.

### Charts are drawn in the browser from aggregated figures

The API returns aggregates (subject means, grade distribution, class and
stream comparisons, trend); ECharts renders them. ECharts is registered
piecemeal and loaded only when a results view opens.

## Consequences

- A compiled result can always be explained from the snapshot alone.
- Changing a policy needs a recompile to take effect, by design.
- Excel import/export exists for marks only; students use CSV (ADR 0004).

## Not done

- **AI Compare** is not implemented. Its tab is shown disabled and labelled
  "Not available"; no endpoint exists for it.

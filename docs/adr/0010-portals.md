# ADR 0010 — Parent and student portals

- **Status:** Accepted
- **Date:** 2026-10-13
- **Phase:** 13 (Parent and student portals)

## Decisions

### Accounts are linked explicitly, by staff

A guardian record gains portal access when an administrator links it to a
user holding the Parent role; a student record, to a user holding the Student
role. One account can be linked to one guardian (or student) only. The link is
looked up inside the tenant, so another school's account is simply not found.
Removing the link removes access at once.

### One gate decides whose records are reachable

`PortalAccessService` is the only place that answers "which learners may this
person see": a parent, the learners their guardian record is linked to; a
student, themselves. Every portal endpoint calls `requireChild` with the id
from the URL and the caller's identity from the session. The answer comes
from the database on each request — never from anything the client sends, and
never cached.

### "Not yours" and "does not exist" are the same answer

A learner outside the caller's family returns `404 STUDENT_NOT_FOUND`, byte
for byte the response for an invented id, so the portal cannot be used to
discover who is enrolled. The same holds for unpublished report cards.

### Published results only

The portal lists and renders results of `PUBLISHED` examinations only. A
compiled-but-unpublished examination is indistinguishable from one that does
not exist.

### Portal users hold no staff permissions

The Parent and Student roles carry portal permissions and a few read-only
ones (calendar, announcements; messages for parents; timetable for students).
The staff API refuses them everywhere else, which the tests check route by
route. The web application also hides staff pages, but that is convenience,
not the control.

### Parents can pay; students cannot

A parent can start an M-Pesa payment for their own child's invoice. The
learner and the invoice are both checked against the caller's family.

## Tests

`portal.e2e-spec.ts` covers cross-family access by every route, a sibling
versus a student's own record, an unlinked parent, another tenant's parent,
staff routes, unpublished results and immediate loss of access on unlinking.

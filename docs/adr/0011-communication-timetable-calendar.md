# ADR 0011 — Notifications, announcements, messages, timetable and calendar

- **Status:** Accepted
- **Date:** 2026-10-13
- **Phase:** 14 (Communication and scheduling)

## Decisions

### Notifications are in-app and transactional

A notification is written in the same database transaction as the event that
causes it (an announcement, a message, results being published), so it never
refers to something that did not happen. Each belongs to one user; reading
and marking read are conditioned on the user id, so nobody can touch
another's. Links in notifications are followed only when they are same-site
paths.

### Announcements are addressed to an audience

Everyone, staff, parents or students. A person sees only what is addressed to
them; expired announcements disappear for readers but remain visible to those
who manage them. Publishing notifies exactly the audience.

### Conversations are visible only to their participants

Every read and write of a thread requires the caller to be a participant;
anyone else — including administrators — gets `404`. Staff may write to anyone
in the school. Parents may write to staff only, and are only offered staff as
recipients, so the portal cannot be used to contact other families. Students
have no messaging.

### Timetable clashes are refused

A lesson is refused when it overlaps another for the same learners (the same
stream, or a whole-class lesson against any of its streams) or for the same
teacher. Back-to-back lessons and parallel streams are allowed. The rules are
pure functions with unit tests.

### Calendar events can be staff-only

Events marked staff-only are hidden from parents and students, including on
the dashboard.

## Not done

- **No email or SMS.** Notifications are delivered in the application only;
  no provider is integrated.
- **No background jobs.** Redis is used for rate limiting and health checks.
  BullMQ, named in the original stack, is not used: nothing in the product
  currently needs deferred work. Notification fan-out happens inline.
- No attachments in messages; no recurring calendar events; the timetable has
  no automatic generation.

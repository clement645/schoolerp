# ADR 0005 — File storage

- **Status:** Accepted
- **Date:** 2026-10-13
- **Phase:** 6 (Student and teacher management)

## Context

Student photographs, documents such as birth certificates and medical notes,
and the school logo have to be stored. Documents are among the most sensitive
data the system holds, and any file a user uploads is later sent to other
users' browsers, which makes uploads an attack surface in their own right.

## Decisions

### S3-compatible object storage, never the database or local disk

Files go to an S3-compatible bucket through `StorageService`. Locally that is
Versity Gateway, an open-source S3 gateway over a directory, run by Docker
Compose; in production `S3_ENDPOINT` points at any S3-compatible service. (The
MinIO image originally planned is no longer published on Docker Hub.) The API
creates its bucket on start-up and refuses to start if storage is unreachable;
storage is also part of the readiness probe.

### Files are private and served only through the API

The bucket is never exposed and no pre-signed URLs are issued. Every file is
streamed by an API endpoint that has already authenticated and authorised the
request, so the access rules for a file are exactly the rules for the record
it belongs to and live in one place:

| File             | Who can read it                                                  |
| ---------------- | ---------------------------------------------------------------- |
| Student photo    | Anyone who can see that student (so teachers: their own classes) |
| Student document | Holders of `students:documents` only; not teachers               |
| School logo      | Any signed-in member of the school                               |

Because an `<img>` cannot send the access token, the web app fetches images
with it and displays them from short-lived object URLs.

### The content decides the type; the client is not believed

An upload's type is determined from its leading bytes. The file name and the
type the browser reports are attacker-controlled and are ignored. Accepted:
JPEG, PNG and WebP for images (2 MB); PDF, JPEG and PNG for documents (5 MB).
SVG and HTML are never accepted, since they can carry scripts. The stored
content type and the extension in the storage key both come from detection.

Files are served with the detected type, `X-Content-Type-Options: nosniff`,
and a `Cache-Control` that is always `private` or `no-store`. Documents are
always sent as `attachment`, so one is never rendered inside the application's
origin. Original file names are reduced to letters, digits and a few
punctuation marks before being stored or echoed in a header.

### Storage keys are opaque and stay on the server

Keys have the form `tenants/<tenant>/<folder>/<random uuid>.<ext>`: namespaced
by tenant, unguessable, and free of anything from the original name. They are
never included in API responses; clients see only `hasPhoto` / `hasLogo` and
document ids.

### Ordering between storage and the database

A new file is stored first and recorded second; if recording fails, the stored
object is removed. A replaced or deleted file is removed from storage only
after the database no longer refers to it. A record therefore never points at
a missing file. The reverse failure, an orphaned object, is unreachable and
harmless, so failed clean-up is logged rather than failing the request.

### Auditing

Uploading, deleting and — because it is how personal data leaves the system —
downloading a document are all written to the audit log, as are photo and
logo changes.

## Deferred

| Item                                    | When / why                                  |
| --------------------------------------- | ------------------------------------------- |
| Malware scanning of uploads             | Phase 15, alongside production hardening    |
| Image resizing and thumbnails           | If photo sizes become a performance problem |
| Sweeping orphaned objects               | Phase 15 (operational tooling)              |
| Teacher photographs and staff documents | Not requested; same mechanism when needed   |

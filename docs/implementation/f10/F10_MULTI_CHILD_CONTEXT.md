# F10 — Multi-Child Context

## Principle (INV-F10-13/14/15)

"Active child" is a UI convenience only. It is never itself an authorization decision — every read-model call re-resolves and re-validates the relationship for the specific `studentId` requested, regardless of what the client believes is "active." A client-supplied `studentId` is never trusted without that server-side check (this is already true of the one existing route, `child-overview`, and is now true uniformly across every new route too).

## Client-side switcher

`localStorage`-backed "last active child" (a per-viewer UI convenience only, per this app's own artifact/browser-storage conventions elsewhere — never authoritative). Switching:
1. Sets the new `studentId` as active in local UI state.
2. Issues fresh requests to the read-model routes with the new `studentId` — no client-side cache of the previous child's data is reused or merged.
3. Every response is keyed (in any client cache, e.g. a query-library cache) by `studentId` explicitly, so a revoked or switched-away child's cached entry is never served under the new child's key.

## Server-side: no cache to invalidate

The read-model service performs no server-side caching of learner data (each call re-queries F5/F8/F9 sources live). This sidesteps the stale-cache-after-revoke risk (task §8/§28) entirely — there is no cache whose invalidation could be forgotten. If a future phase adds server-side caching, it must key on `(actorUserId, studentId)` and must be invalidated on any `parent_student_relationships` status change for that pair; this is documented here as a constraint on that future work, not implemented now (no evidence a cache is needed yet — task's own "don't build for hypothetical future requirements" default).

## Isolation test (task §39 case F/G)

Real-Postgres certification proves: Parent P with accepted relationships to Child A and Child C, switching context A -> C returns only C's data (subjects, activity, readiness all distinct from A's), and a request for Child B (to which P has no relationship) is denied regardless of P's "active child" UI state.

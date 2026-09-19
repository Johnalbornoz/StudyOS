# F10 — Parent Relationship Flow

Reuses F2's `parent_student_relationships` exactly. No new table, no new status vocabulary.

## States

`pending -> accepted | declined`, `accepted -> revoked` (parent-initiated via `unlinkChild` or student-initiated via `revokeRelationshipByStudent`), and now (F10 fix) `declined -> pending` / `revoked -> pending` via re-request.

## Transitions and actors

| Transition | Actor | Function | Notes |
|---|---|---|---|
| (none) -> pending | Parent | `linkChildByEmail` (fixed: upsert, generic response) | Enumeration-safe: response identical whether or not the email matched a student |
| pending -> accepted | Student | `respondToRequest(accept=true)` | Unchanged |
| pending -> declined | Student | `respondToRequest(accept=false)` | Unchanged |
| accepted -> revoked | Parent | `unlinkChild` | Unchanged, soft-revoke |
| accepted -> revoked | Student | `revokeRelationshipByStudent` | Unchanged, soft-revoke, immediate |
| declined/revoked -> pending | Parent | `linkChildByEmail` (fixed) | NEW: previously permanently blocked by `ON CONFLICT DO NOTHING` |

`accepted -> pending` and `pending -> pending` are explicitly **not** transitions the upsert performs — the `WHERE status IN ('declined','revoked')` clause on the `ON CONFLICT` guarantees an already-active or already-pending relationship is never reset or duplicated.

## Enumeration fix, concretely

`link-child/route.ts` returns `{ success: true }` (HTTP 200) in both of these cases:
- Email matches a real student -> real `pending` row is created/updated, real notification sent.
- Email matches no student -> no DB write, no notification, same response body/status.

The distinguishing information (`NO_STUDENT_FOUND`) is logged server-side for operational visibility only; it is never part of the HTTP response.

## Consent and revocation semantics (INV-F10-02/03/04)

`canAccessLearner`/`isActiveParentOf` and `verifyParentAccess` both count only `status = 'accepted'` rows — `pending`, `declined`, and `revoked` all grant zero access, with no code path that special-cases any of them differently. Revocation is a synchronous `UPDATE`; the very next read (no cache layer sits between the relationship table and any authorization check — see F10_MULTI_CHILD_CONTEXT.md for the separate, client-side-only cache) reflects it.

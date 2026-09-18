# F4 — Private Content Safety Report

## Invariant under test

INV-F4-07 / INV-F4-08 / AC-F4-06: mapping a private learner concept (and any content attached to
it) to a shared canonical concept must never change who can read that content, and must never
publish it.

## Why this is structurally true, not just tested

`concept_catalog_mapping` only ever stores a **pointer** from `concepts.id` (private, owned via
the `subjects.student_id` chain) to `canonical_concepts.id` (shared, ownerless). No F4 code path:

- writes to `content_sources` or `content_chunks`,
- reads `content_sources`/`content_chunks` without going through the existing
  `verifyContentSourceAccess` gate (F4 doesn't read these tables at all — see the
  non-interference test's table-write guard, which also covers reads by inspection),
- exposes a `student_id` or any learner-identifying field on any canonical catalog table or API
  response (`canonical_subjects`, `canonical_concepts`, `skills`, `competencies`, `contexts`, and
  their junction tables have no `student_id`/`user_id` column at all — structurally incapable of
  leaking whose content maps to them).

## Live proof (real PostgreSQL, `f4-lifecycle-cert-runner.ts`)

1. Learner 1 uploads private content (`content_sources`/`content_chunks`) referencing their
   "Linear Functions" concept.
2. That concept is mapped to a canonical concept via `ensureCatalogMapping` (status `MATCHED`).
3. `verifyContentSourceAccess(learner1Id, contentSourceId)` → **true** (unchanged).
4. `verifyContentSourceAccess(learner2Id, contentSourceId)` → **false** (unchanged) — even though
   Learner 2 has their *own*, independently-created concept mapped to the exact same canonical
   concept in the same run.

This is the direct, real-database demonstration that shared canonical identity never becomes an
authorization shortcut: two learners' concepts can point at the same canonical concept while
their private content remains completely mutually inaccessible.

## What F4's admin API exposes (and what it doesn't)

`/api/admin/catalog/*` (task §19) exposes only canonical catalog objects (subjects, concepts,
skills, competencies, contexts) and mapping status/candidates. It never returns a learner's
`content_sources`, `content_chunks`, `learning_evidence`, or any other private table — the
mapping endpoints return `learner_concept_id` (an opaque id) but never resolve or expose which
student owns it, matching the minimal-tooling scope in task §19.

## Conclusion

Private content isolation is preserved both structurally (F4 code cannot reach these tables) and
empirically (real-Postgres cross-learner access check). No residual risk identified here.

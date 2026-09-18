# F4 — Residual Risk Register

| ID | Risk | Severity | Status | Notes |
|---|---|---|---|---|
| RR-F4-01 | `/api/concepts/extract` (legacy, parallel concept-extraction endpoint) checks only that the caller is authenticated, never that they own the `subjectId` in the request body | Medium | Pre-existing, discovered during F4 inspection, not introduced by F4 | Out of scope for a data-architecture phase to fix, but disclosed rather than silently left. Candidate for a focused security-fix session; likely dead/legacy code sitting alongside the primary `content/extract-concepts` pipeline — worth confirming it is unused before either fixing or removing it. |
| RR-F4-02 | `src/app/api/content/extract-concepts/route.ts` has a literal `// TODO: Verify authorization` and performs no ownership check on `sourceId`/`subjectId` before creating concepts | Medium | Pre-existing, discovered during F4 inspection, not introduced by F4 | Same disposition as RR-F4-01 — a real gap, not something F4's own scope covers fixing. |
| RR-F4-03 | No production canonical catalog exists yet | Low | Expected, not a defect | The migration's backfill will resolve the overwhelming majority of real concepts to `UNRESOLVED` on first real application — this is the correct, disclosed outcome of introducing a catalog where none existed, not something to mask by force-matching. |
| RR-F4-04 | `misconception_signatures` has the same per-student-duplication architecture gap as `concepts` did, but is not addressed by this phase | Low | Deferred, explicitly out of F4's named scope | Documented in the current-architecture assessment as a candidate for the same treatment (a canonical misconception catalog) in a later phase — not started here to avoid scope creep beyond the task's own domain list. |
| RR-F4-05 | `concept_relationships` (the existing per-student prerequisite table) is empty in production and was not backfilled into the new `canonical_concept_prerequisites` graph | Low | Intentional | Per the assessment, the existing table is AI-inferred-only and already documented elsewhere as unpopulated/unreliable; backfilling zero real rows would add no value and risks importing unreviewed AI inferences into the new canonical graph without human review. |
| RR-F4-06 | Remote (Preview database) migration application is deferred | Medium | Deferred, matches F1/F2/F3's own precedent | See Preview certification doc — no proven Preview/Production database isolation exists from this environment. Schema-level certification instead ran against real, ephemeral, local-only PostgreSQL. An authorized operator with confirmed remote isolation should run `npm run db:migrate` before any learner-facing feature depends on the new tables existing remotely. |
| RR-F4-07 | The admin catalog API (task §19) has no rate limiting or audit logging beyond `reviewed_by`/`reviewed_at` on confirmed mappings | Low | Accepted for this phase | Matches the minimal-tooling scope explicitly requested (task explicitly defers full editorial workflow, versioning, and publish pipeline to F6). |

## Explicitly NOT a risk (verified, not assumed)

- Historical Evidence, Mastery, Knowledge State, Retention (`concept_memory_state`), and Transfer
  (`concept_transfer_state`) data loss or duplication — verified with real-row-count assertions
  across the full adversarial certification; zero rows lost or duplicated at any point.
- Private content exposure via canonical mapping — verified negative against real Postgres using
  the existing, unmodified `verifyContentSourceAccess` gate.
- Name-based concept merging — verified negative in both the mocked unit tests and the real-
  Postgres adversarial matrix (same-name/different-scope produces `AMBIGUOUS`, never an auto-pick).
- Prerequisite cycles — verified rejected via a real 3-edge cycle against real Postgres.
- Cross-import between F2 authorization, F3 entitlements, and F4's catalog — verified structurally
  absent in all directions.
- Canonical V2 interference — verified structurally absent, and the full 36-file/806-test
  Canonical V2 suite passes unmodified.

## Recommendation

None of the above blocks proceeding to F5. RR-F4-01/02 (both pre-existing authorization gaps,
not introduced by this phase) and RR-F4-06 (deferred remote migration) should be tracked and
closed by whoever owns security remediation and Preview-database operations respectively, but do
not affect the canonical catalog foundation F5 will build on.

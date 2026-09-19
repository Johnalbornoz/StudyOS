# F10 — Integrated Verification Gate (IVG) Deferred Test Register

Reconciles and continues `F9_IVG_DEFERRED_TEST_REGISTER.md` (task §55). No prior entry is silently removed — each is either carried forward unchanged, extended, or explicitly superseded with a reason. New F10-specific deferrals are appended.

## Carried forward from F1–F9

| ID | Phase origin | Requirement | Status | Notes |
|---|---|---|---|---|
| IVG-F7-01 | F7 | Remote Preview database's actual migration state should be confirmed before pilot use | **STILL OPEN** | Unchanged. F10 introduces no new migration, so it adds no new schema-state risk here, but does not resolve the pre-existing one either. |
| IVG-F8-01 | F8 | AI_REAL_PROVIDER certification | **SUPERSEDED by IVG-F9-01** (unchanged) | F10 adds zero new AI call sites (see below) — nothing to consolidate or extend here. |
| IVG-F8-02 | F8 | Remote authenticated E2E matrix against live Preview | **STILL OPEN, EXTENDED (by F9, now also by F10)** | Now also covers F10's 6 new `/api/parent/learners/*` routes, which share the exact same `canAccessLearner` primitive F8/F9's routes already used — no new authorization mechanism was introduced that would need a separate remote-E2E deferral of its own. |
| IVG-F8-03 | F8 | Live Preview admin accept-path exercised as authenticated ADMIN requests | **STILL OPEN** | Unaffected by F10 — F10 adds no admin routes. |
| IVG-F9-01 | F9 | AI_REAL_PROVIDER certification for simulation item generation/grading | **STILL OPEN** | Unaffected by F10. |
| IVG-F9-02 | F9 | Confirm F9's own migration applies cleanly to the real Preview database | **STILL OPEN** | Unaffected by F10 (F10 adds no migration of its own to also verify). |
| IVG-F9-03 | F9 | Idempotency conflict-recovery under real network-level retry | **STILL OPEN** | Unaffected by F10. |

## AI_REAL_PROVIDER: not applicable to F10

Unlike F7/F8/F9, F10 introduces **zero new AI call sites** — every Parent-facing number/status is a direct pass-through or simple count/count ratio over an existing certified source (task §56, see `F10_PARENT_PROGRESS_MODEL.md`). There is no F10-specific AI_REAL_PROVIDER item to add; `IVG-F9-01` remains the only open AI-provider deferral, and it is unrelated to F10's code paths.

## REMOTE_MIGRATION: not applicable to F10

F10 adds no migration (task §36/§37 — F2's existing table is reused as-is). There is nothing new for a future `IVG-F10-xx` remote-migration entry to cover.

## New in F10

| ID | Requirement | Why deferred | Dependency | Risk if not executed | Planned IVG execution | Pass criteria |
|---|---|---|---|---|---|---|
| IVG-F10-01 | Live Preview Parent relationship lifecycle (request → accept/decline → revoke, and re-request after decline/revoke) exercised as two real, authenticated Clerk browser sessions (one parent, one student) against the live Preview deployment | No mechanism to authenticate as two distinct real Clerk users against Preview from this environment (same limitation as `IVG-F8-03`'s admin accept-path) | Two real Preview-environment Clerk test accounts, one browser session each | Low-medium — the full lifecycle (including the BUG #2 re-request fix) is proven for real against real Postgres via `f10-lifecycle-cert-runner.ts`, at the service layer; this item would add proof at the HTTP+session layer only | At IVG time, script or manually drive the two-session flow against live Preview, asserting the same state transitions the local certification already proved | Every transition (request/accept/decline/revoke/re-request) matches the locally-certified outcome exactly |
| IVG-F10-02 | Remote authenticated E2E for the Parent read-model surface specifically: two real parent identities, one with an accepted relationship to a real learner, one without, both hitting the live Preview `/api/parent/learners/*` routes | Same remote-authentication limitation as `IVG-F8-02`; called out separately here because F10's own matrix (multi-child isolation, payer/relationship decoupling) is broader than what `IVG-F8-02`'s original scope described | Real Preview-environment Clerk identities with a pre-seeded `parent_student_relationships` row | Low — the full matrix (11 sections, including multi-child isolation and Parent/Payer decoupling) is proven for real against real Postgres locally; this item would add proof only that Preview's deployed code path matches, not new logic risk | At IVG time, run the anonymous-401 smoke (already done, see `F10_PREVIEW_CERTIFICATION.md`) plus an authenticated pass with real sessions | Matches the locally-certified authorization outcomes exactly, with zero cross-child leakage over the real network |

## Discipline

No entry above is silently upgraded to PASS anywhere in this phase's reports. `F10_QA_REPORT.md`'s test-layer matrix marks `REMOTE_AUTHENTICATED_E2E` as `DEFERRED`, never `PASS`. Every prior open item's status is stated plainly, not re-labeled to look resolved by association with F10's unrelated work.

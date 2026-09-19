# F11 — Integrated Certification

Date: 2026-09-19
Certified branch: `f11/integrated-certification`
Certified base: `f11c4/exam-reinforcement-execution@3d867202e3f80fcc1a82268b425d041ddbe4b58f`

## Decision

**PASS — F11 integrated execution layer.**

F11-C1 through F11-C4 use one Student pending-intervention surface and one start dispatcher while retaining the established F2 authorization boundary and the F5/F7/F8/F9 engines as the sole owners of their domains.

## Independent rerun evidence

| Check | Result |
|---|---|
| Full automated suite | 347 files, 5,589 tests passed |
| Type check | `tsc --noEmit` passed |
| F11-C4 local real-Postgres certification | passed against an ephemeral local instance |
| F11-C4 migration | full ledger applied; reapplication passed |
| Exam execution safeguards | supported Topic/Domain/Mini Mock passed; genuinely unready PAA Full Mock rejected |
| Isolation and safety | PAA/Cambridge isolation, authorization matrix, idempotency race, double finalization, and failure recovery passed |

The local database used by the certification was created under `/tmp`, had no network listener, and was torn down by the runner. No Preview, Neon, or Production data was used or changed.

## Scope boundary retained

This certification does not merge to `main`, deploy Production, build the final Teacher or Institution interface, assign classes in batch, or generate interventions automatically. F12 begins as architecture discovery for institution-level intelligence and its aggregate-only privacy model.

## Known tooling note

`next build` began but did not produce a complete build artifact in this sandbox after Turbopack startup. This is recorded as an environment/tooling limitation; it does not invalidate the successful TypeScript, unit, or real-Postgres certification results. A normal CI/Preview build remains required before release promotion.

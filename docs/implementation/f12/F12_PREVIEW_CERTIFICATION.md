# F12 — Preview Certification

## Status: BLOCKED (tooling), deferred to IVG — not falsely reported as PASS

This environment has no Vercel CLI installed and no `.vercel` project linkage available to this session (confirmed: `vercel` is not an available command in this sandbox). Per task section 60's own safety requirement ("Before deploy: verify `.vercel` project linkage... Never use `--prod`"), a deployment cannot be safely attempted without that verification step succeeding first — attempting one blind would risk creating a stray project or deploying without confirming environment/target, which task section 60 explicitly prohibits. No remote deployment was attempted.

## What WAS certified (local, real Postgres — the actual substance of this phase)

- Full migration ledger (through F12's own new migration) applies cleanly and idempotently against a real, ephemeral, local-only Postgres instance.
- 38 real-Postgres assertions covering authorization, cross-institution isolation, unique-learner counting, learning/evidence-sufficiency intelligence, curriculum coverage (FULL/PARTIAL/UNMAPPED), F9 readiness (never legacy), F8 diagnostic aggregation, F11 intervention aggregation, small-cohort suppression, time-window labeling, zero-write verification, and privacy payload minimization.
- 15 independently re-run prior-phase real-Postgres certifications (F2, F5, F6, F7, F8, F9, F10 + multi-role, F11-A, F11-B, F11-C1, F11-C2, F11-C3, F11-C4, F11 Integrated) — all pass unchanged.
- Full automated suite (348 files / 5597 tests), `tsc --noEmit`, and `next build` all clean in this worktree.

## What is deferred to IVG (never claimed as PASS here)

- `IVG-F12-01`: remote authenticated E2E for the 11 new institution-intelligence routes.
- `IVG-F12-02`: confirm F12's migration applies cleanly to the real Preview database (remote migration policy: never apply until Preview DB isolation from Production is independently proven — unchanged standing policy from F7 onward).
- Any REMOTE_PREVIEW_SMOKE check (environment=preview, target=null, correct final SHA) — not run, since no deployment was attempted.

## Why this does not block PASS_TO_F13 (task section 66's own explicit allowance)

Per the task's own "Important Pass Interpretation": F12 may `PASS_TO_F13` while some operational tests remain IVG-deferred if local/ephemeral real-Postgres authorization and aggregation are proven (they are, exhaustively), remote Preview DB isolation remains unproven (it does, honestly stated here), deferred remote tests are explicitly registered (`F12_IVG_DEFERRED_TEST_REGISTER.md`), and no deferred test is falsely reported as PASS (none is — this document states BLOCKED/DEFERRED plainly, not PASS).

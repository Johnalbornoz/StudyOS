LANE: L2 — ASSESSMENT ENGINE / QUESTION BANK (named L1_ASSESSMENT in the control-plane files this lane can see)
STATE: RUNNING
LAST_UPDATE: 2026-10-11 (QB-R2E started, phase 1)
BASE_SHA: 6ebab9a
CURRENT_SHA: see `git log -1` on feat/ea1a-learning-approach (the commit carrying this file)

CURRENT_PHASE: QB-R2E — phase 1 generator/specification fixes, phase 2 validator freeze, phase 3 fresh out-of-sample live batch. Branch feat/qb-r2e-frozen-validators.

NOW_DOING: Phase 1 fixes (no provider call until the validator freeze commit exists).

COMPLETED: EA-1A closure (7a62edf). QB-R2D: 35 live calls to OpenAI gpt-5.6-luna, 26 candidates over 20 adaptations, eight validators, offline replay, proofs, rights record. Nothing ingested.

CURRENT_FINDINGS: QB-R2D STATUS = PARTIAL. LIVE_PROVIDER = PASS; spend 1.55 USD (assumed basis) of 20; no wrong key; first-attempt full pass 8/20; GENERATOR_READY_FOR_DEV_SCALE = NO; same-family proof FAIL on the pre-set criterion (substance holds); validators were revised once after first results (disclosed in the report).

FILES_READ: see report

FILES_MODIFIED: see report

TESTS: tsc clean; 519 files / 9,339 tests, 0 failures; next build exit 0; five ephemeral DB certifications exit 0; 82 migration files, none added

BLOCKERS: NONE

LOCK_REQUESTS: NONE (holding ASSESSMENT_ADAPTATION)

CROSS_LANE_DEPENDENCIES: PRE_CONTROL_PLANE_MERGE_EXCEPTION — EA-1 merged locally into integration/q1-paa-bank-readiness (59f518a, 3031e03) before the control plane was known; kept by Orchestrator decision; no self-merges since. Lane naming: the Orchestrator now calls this lane L2; control-plane files still assign L2 to STAGE_B5 — this file was renamed from L1_STATUS.md inside the lane worktree only. B5_CANONICAL_RUNTIME_DEPENDENCY = RESOLVED_EXTERNALLY_BY_L13 (Orchestrator ruling; this lane no longer touches Stage).

NEXT: Orchestrator review; suggested QB-R2E (generator fixes + fresh batch with frozen validators)

PROGRESS: 5%

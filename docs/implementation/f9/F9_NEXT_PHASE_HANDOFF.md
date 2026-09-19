# F9 — Exam Readiness & Simulation — Next Phase Handoff

Date: 2026-09-19
Branch: `f9/exam-readiness-simulation` (pushed to `origin`)

## What F9 delivered

An explainable, multidimensional Readiness Engine (7 dimensions, never a single opaque percentage) that invokes F8's real diagnostic engine per blueprint-evidenced target rather than re-deriving classification logic. A Blueprint Evidence Coverage classifier that correctly excludes platform-unsupported and curriculum-unmapped targets from every percentage's denominator. Four distinct, separately-eligible simulation levels (Topic/Domain/Mini Mock/Full Mock), with Full Mock eligibility extending (never duplicating) F7's `canFullMockBeOffered` by determining "mandatory domain" from what the published blueprint actually references. A deterministic, frozen Simulation Plan and a Simulation Attempt lifecycle with genuinely new pause/resume/navigation support, wrapping F7's real attempt machinery rather than widening its certified schema. Scoring via the existing graders and F7's evaluation contract, now with real database-enforced idempotency. Post-exam diagnosis and a next-action recommendation contract, both reusing F8's real classification rather than introducing a second one. A real, honest score-projection gate that correctly reports "no calibration" in this environment rather than fabricating one. And a truthful PAA Full Mock certification result (`NOT_READY`, with the specific missing domain named) — a correct, not a failed, outcome per the task's own explicit framing.

## What the next phase should NOT re-litigate

- The 7-dimension readiness model and its combiner logic — certified against the full adversarial matrix; extend via new policy versions, never new hardcoded thresholds.
- The decision to exclude `UNSUPPORTED_BY_PLATFORM`/`UNMAPPED`/`NOT_REQUIRED` targets from every coverage denominator — this is INV-F9-05 made concrete, not an implementation detail to "simplify" later.
- The `simulation_attempts` 1:1-wrapper-around-`exam_attempts` design — deliberately additive, never an `ALTER TABLE` on F7's certified status enum.
- The PROVE-equivalent boundary: F9 never builds the actual Full Mock simulator's own UI/UX (that's F10+'s job per task §69) — it only makes the eligibility/plan/attempt/scoring architecture real and correct.
- The legacy `exam-readiness.service.ts` — still untouched, still live, still serving its own unrelated subject/date-driven feature. Do not attempt to "unify" it with F9's Readiness Engine without a deliberate, separately-scoped decision.

## Recommended next-phase candidates (not a commitment — for the user's review)

1. **Real item generation/grading wired into the simulation-response endpoint** (R3) — the natural completion of F9's own "minimal flow," using F7's existing generation contract, never new AI logic.
2. **PAA content completion** (R2) — adding real Reading/Writing/English domain modeling (F6/F7-level curriculum and assessment-component work) is the actual path to a real PAA Full Mock — not another F9 code change.
3. **AI real-provider certification** (`IVG-F9-01`) — the highest-priority deferred item, since it gates any real pilot use of the simulation-generation flow.
4. **A calibration study for at least one exam version's `score_conversion_models`** — would let `CAN_PROJECT_OFFICIAL_SCORE` return `AVAILABLE` for real, not just in the certification fixture.
5. **F10+ experience/dashboard layers** consuming F9's readiness snapshots and simulation results — explicitly out of F9's own scope (task §69).

## Explicit constraints carried forward (per task §76 and this session's standing rules)

- Do not merge `f9/exam-readiness-simulation` to `main` without the user's explicit instruction.
- Do not deploy to Production, and do not modify Production environment variables, under any future phase's certification process.
- Do not apply F9's (or any future phase's) migration to the remote Preview database without first proving isolation from Production (`IVG-F7-01`/`IVG-F9-02`, unchanged standing policy).
- Do not begin F10 or F11 automatically.
- Any future phase must re-run the full non-interference test pattern extended to cover its own new files, and must separate its test evidence into the same layered format F8/F9 established (task §52/§73) — never a generic "all tests pass" statement.

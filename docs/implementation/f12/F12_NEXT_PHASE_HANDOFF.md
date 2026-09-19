# F12 — Next Phase Handoff

## What F12 delivered

- A single, centralized Institution Intelligence read module (`src/lib/institution-intelligence/`) covering roster/population, learning intelligence (Concept/Skill/Competency kept separate), evidence sufficiency, curriculum coverage (F6), readiness (F9 exclusively), diagnostic aggregation (F8), and intervention aggregation (F11) — every entry point resolving authorization server-side via F2's own, unmodified `canAccessInstitution`/`canAccessClass`.
- A versioned, governance-ready small-cohort suppression policy (`institution_analytics_policy_versions`), seeded with zero rows so no production privacy threshold is silently invented.
- 11 thin API routes, real-Postgres certification (38 assertions), zero-write proofs, and privacy payload minimization — all local, all honestly reported; remote Preview verification explicitly deferred to IVG, never fabricated.

## What F13 (final UX consolidation) should know

1. **The read model is the API surface — build UI against `src/lib/institution-intelligence/index.ts`'s exports (or the 11 existing routes), never new raw joins.** Any dashboard work should treat the `MetricEnvelope` shape as the contract to render (metric name, population, numerator/denominator, limitations) rather than re-deriving a simpler shape that drops that context.
2. **Small-cohort suppression must resolve before any real institution can use this.** `IVG-F12-04` (a real, approved `minimumCohortSize` decision) is a genuine product/privacy gate, not a formality — without it, every learner-population aggregate fails closed in Production.
3. **Intervention status can be stale until a Student's own dashboard reconciles it.** If F13's UI shows "last updated" timing for intervention counts, it should account for this (e.g., a visible `calculatedAt` timestamp, which `MetricEnvelope` already carries) rather than implying real-time truth.
4. **The Attention Areas thresholds are illustrative, not calibrated.** Before surfacing them prominently in a UI, consider whether they need their own versioned policy (mirroring the small-cohort pattern) rather than remaining hard-coded constants.
5. **Coverage requires a `structureVersionId` and readiness requires an `examVersionId` — F13's UI needs a real selector for these**, since F12 deliberately never infers or defaults them (doing so risked exactly the kind of silent averaging/conflation the task explicitly forbade).

## What F14 (specification work referenced by F2's own transitional-governance carry-forward) should know

Per task section 7, F2's current Institution Admin assignment/approval mechanism was inspected and found secure enough for Preview but still transitional (its own residual governance limitations are documented in F2's own prior handoff, unchanged by F12). F12 did not alter this mechanism. If F14 revisits institution governance (e.g., a narrower analytics-only role, multi-admin workflows, or delegation), it should build on `canAccessInstitution`'s existing contract rather than introduce a parallel one.

## What F13/F14 should NOT do

- Do not grant Teacher role institution-wide intelligence access — the task's own explicit boundary (Teacher retains only F11's scoped class/intervention view).
- Do not compute a Teacher quality/ranking score from this data — no methodology for that exists or is approved.
- Do not average readiness/coverage across incompatible exam versions or curriculum structures merely because a UI would look simpler that way.
- Do not silently promote the TEST POLICY's `minimumCohortSize: 3` to a product default — it must be a real, separately-approved decision.
- Do not deploy to Production or merge to `main` from this phase's own work — explicitly out of scope per the STOP condition.

# F15 — Rollback & Containment Model

## Application release rollback

Real and safe: `vercel deploy` (this phase's own mechanism) produces an immutable, independently-addressable deployment (`dpl_B2xeHtPKgeMcZyfPoDQGDFxnqax3`, this phase's own real example). Vercel retains every prior deployment's own URL — rolling back a Preview/Pilot release means re-promoting or re-pointing traffic at a prior deployment ID, never a destructive action against the current one. This phase performed zero Production deployments, so there is nothing to roll back in Production.

## Database migration rollback

**Not safe to claim, and not claimed.** `scripts/db-migrate.ts` applies forward-only migrations with no corresponding `down`/rollback script anywhere in this codebase (grep-confirmed: no `*_rollback.sql`/`*_down.sql` file exists in `database/migrations/`). F15's own migration (`20261010_1000_f15_min_cohort_policy.sql`) is a pure `INSERT`, trivially reversible by hand (`DELETE FROM institution_analytics_policy_versions WHERE version = 1`) if ever needed, but this is true of THIS specific migration, not a general guarantee this codebase's migration system provides. Per the task's own explicit instruction ("Do not claim database rollback is safe unless migration design supports it"): **database rollback is not a general, supported capability of this system** — each migration's own reversibility must be assessed individually by whoever operates a rollback.

## AI/provider regression rollback

The existing `AI_ENABLED` feature flag (`src/lib/ai/operational-limits.ts`, unchanged) already provides a real kill switch: setting it to anything other than `true` makes `reserveAIRequest` refuse every AI call outright, without a code deploy. This is a genuine, already-existing containment mechanism — not something F15 built, but confirmed real and reusable for exactly this purpose (a provider outage, a runaway cost incident, or a quality regression in generated content).

## Auth/config issue rollback

Environment-variable changes on Vercel (Preview or Production) can be reverted through the Vercel dashboard/CLI (`vercel env rm`/`vercel env add`) independent of any code deploy — this phase did not change any Production or Preview environment variable, so there is nothing to revert from F15's own work specifically. The Preview Clerk misconfiguration found this phase (F15_PREVIEW_CERTIFICATION.md) is itself an example of exactly this class of issue, awaiting operator correction.

## Critical Exam bug containment

No dedicated feature flag exists for "disable Exam Prep" or "disable the new item-by-item exam-taking flow" specifically (a real, disclosed gap — see F15_FEATURE_FLAGS note below). The closest real containment mechanism available today: `AI_ENABLED=false` would stop new question GENERATION (since `getNextSimulationItem` calls `generatePracticeQuestions`, which is gated by the AI operational limiter) — but would not stop a Student from opening the Exam Prep pages themselves, only from generating new items within them, degrading to `ITEM_UNAVAILABLE`/skip rather than a hard failure. This is a real, if partial, containment path — not a clean on/off switch for the whole feature.

## Feature flags / kill switches — inspected, not newly built

No feature-flag platform (LaunchDarkly, a custom flags table, etc.) exists anywhere in this codebase. The one real, working containment mechanism found is `AI_ENABLED` (above). Building a broader flag system was judged out of scope for this phase (task's own explicit "do not add a complex flag platform unless necessary" — no concrete incident this phase surfaced required one). Registered as a real, disclosed gap: `IVG-F15-12` — a dedicated "disable Exam Prep"/"disable Teacher assignments"/"disable Institution Intelligence" flag set, if a future incident demonstrates the need.

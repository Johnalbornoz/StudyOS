# F14 — Student Exam Prep Experience (Workstream A)

## What was built

- `/dashboard/exam-prep` — lists the Student's own Exam Profiles (`listStudentExamProfiles`, a new thin reader added to the existing `student-exam-profile.service.ts`, mirroring the exact SQL the existing `GET /api/exam-profiles` route already runs inline). Each row shows the exam definition's real name (`getExamDefinition`, a new small reader added to `exam-definition.service.ts` — no getter for a single definition existed before) and the latest F9 `overallStatus` via the existing `StatusBadge`/`toneForReadinessStatus`.
- `/dashboard/exam-prep/[examProfileId]` — the real F9 `ReadinessSnapshot` rendered verbatim: overall status, every dimension (`KNOWLEDGE_READINESS`/`SKILL_READINESS`/`EXAM_TECHNIQUE_READINESS`/`SPEED_FLUENCY_READINESS`/`BLUEPRINT_EVIDENCE_COVERAGE`/`SIMULATION_PERFORMANCE`/`EVIDENCE_SUFFICIENCY`) with its own status, `unsupportedPlatformAreas`, and `whatWouldImproveConfidence`, plus `scoreProjectionAvailability` shown honestly (never a fabricated number) and `limitations`. Simulation eligibility for MINI_MOCK/FULL_MOCK is pre-computed server-side (`getSimulationEligibility`) and shown before the student even opens the start form.
- `StartSimulationPanel` (`'use client'`) — a real self-service "start a simulation" form (TOPIC_EXAM/DOMAIN_EXAM/MINI_MOCK/FULL_MOCK + timing mode), POSTing to the real, unmodified `POST /api/simulation/attempts`. A rejection surfaces the server's own `eligibility.reasons` verbatim.
- `/dashboard/exam-prep/attempt/[attemptId]` + `AttemptControls` — a real simulation-attempt status page (Pause/Resume/Abandon), backed by the real, unmodified F9 attempt lifecycle.
- One new API route: `POST /api/simulation/attempts/[id]/abandon` — `abandonSimulationAttempt` (F9) existed with no route exposing it; this route mirrors the existing pause/resume routes exactly (same auth, same permission).

## Platform-not-ready vs. learner-not-ready (task's own explicit requirement)

F9 has no literal `PLATFORM_NOT_READY` enum value (verified by direct inspection — see F14_CURRENT_STATE_ASSESSMENT.md). The distinction is real and is rendered through two already-certified fields, never invented by this phase:
- A dimension's `unsupportedPlatformAreas` (non-empty) → rendered as a distinct, visible line ("The platform cannot yet assess this: ...") separate from the dimension's own STRONG/DEVELOPING/WEAK/INSUFFICIENT_EVIDENCE status.
- `SimulationEligibility.reasons` (e.g. `NO_BLUEPRINT_FOR_EXAM_VERSION`, `OBJECTIVE_COMPONENT_UNSUPPORTED`) surfaced verbatim on a rejected start attempt.

`INSUFFICIENT_EVIDENCE` is never styled as a failure (reused `toneForReadinessStatus`'s existing `neutral` mapping, unchanged from F13).

## Deliberately NOT built (disclosed scope decision, not an oversight)

Full item-by-item exam-taking UI (rendering the frozen `SimulationPlan`'s selected targets as real assessment items, per-item timing, `POST /api/simulation/attempts/[id]/responses`) is a genuinely large, separate surface — there is no existing UI anywhere in this codebase that renders a `SimulationPlan`'s items, and building one blind, in an environment where a live authenticated check cannot safely be performed (see F14_ENVIRONMENT_PROVENANCE_REPORT.md), was judged too high-risk to attempt this phase. The attempt-status page therefore deliberately does **not** expose a "Complete" action: completing an attempt with zero real item responses recorded would produce a truthful-but-hollow score rather than a fabricated one, but still not something to expose silently. Pause/Resume/Abandon are fully real and safe regardless. Registered as `IVG-F14-01`.

## Verification

`tsc --noEmit` clean; `next build` clean; new/modified files covered by `tests/unit/f14-experience-completion-source-guard.test.ts` (confirms: no legacy `exam-readiness.service` import, no `computeReadinessSnapshot`/mastery/diagnosis calculation in any new page, no direct SQL write in any new page).

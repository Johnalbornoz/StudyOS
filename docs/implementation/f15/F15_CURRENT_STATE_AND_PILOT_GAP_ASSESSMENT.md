# F15 — Current State & Pilot Gap Assessment

Baseline: `origin/f14/experience-completion-readiness@e3d23a44d0657b6ccf9fedf08aa8e8d454839d41`, verified via `git rev-parse origin/f14/experience-completion-readiness` before any implementation. Isolated worktree created from that exact SHA; `git rev-parse HEAD` confirmed the match; local `main` untouched throughout.

## Reconciling F14's 8 listed blockers against real evidence

| # | F14's listed blocker | Reconciliation |
|---|---|---|
| 1 | Full Student item-by-item exam-taking UX incomplete (`IVG-F14-01`) | **Confirmed and fixed this phase.** Real inspection (not assumed) found the gap was deeper than "missing UI": `SimulationPlanTarget` never had ANY wiring to real question content anywhere in the codebase — no generation, no item bank connection. Fixed via a new orchestration layer reusing three already-certified systems (F6 curriculum mapping, the existing AI question generator, F9's own grading/scoring). See F15_EXAM_TAKING_EXPERIENCE.md. |
| 2 | MIN_COHORT_POLICY unresolved (`IVG-F12-04`) | **Resolved.** See ADR-F15-MIN-COHORT-POLICY.md. Also found two MORE metrics (Diagnostics, Interventions) that should have been cohort-suppressed and weren't — fixed alongside. |
| 3 | Official remote Preview unavailable/unverified | **Resolved — a real, working Preview now exists.** `.vercel/project.json` (gitignored, present only in the original checkout, not copied into any worktree by `git worktree add`) links this repo to a real Vercel project (`study-so/study-os`) with separate Preview/Production environment variables already configured. A real Preview deployment was produced this phase. See F15_PREVIEW_CERTIFICATION.md. |
| 4 | Authenticated E2E deferred | **Partially resolved, one new hard blocker found.** The Preview environment itself is now real and reachable, but its Clerk authentication is misconfigured (see below and F15_AUTHENTICATED_E2E_REPORT.md) — a genuine, newly-discovered Preview-config defect, not the "no safe environment exists" reason F13/F14 cited. Separately, this agent is categorically prohibited from creating accounts or entering credentials on the user's behalf, regardless of environment safety — so even with a corrected Clerk config, fully automated authenticated E2E requires either operator-supplied test credentials or the operator's own hands-on-keyboard execution. |
| 5 | Live visual/responsive validation deferred | Partially executed against the real Preview's unauthenticated surface this phase; authenticated pages remain blocked by #4. |
| 6 | Live accessibility validation deferred | Same constraint as #5. |
| 7 | Live performance measurement deferred | Partially executed (unauthenticated page load only); authenticated flows blocked by #4. |
| 8 | Real credential-bearing `.env.local` in `f0s-security` sibling worktree | **Investigated further, not resolvable by this agent.** See F15_SECRET_AND_ENVIRONMENT_HARDENING.md — rotation/liveness verification requires actual provider console access this agent does not have, and this environment's own safety controls explicitly block even prefix-level credential inspection. Remains `OPERATOR_ACTION_REQUIRED`, now a documented hard Pilot gate. |

## The one major NEW finding this phase's own inspection surfaced

The Preview deployment's sign-in page renders **"Sign in to PMO OWN"** — not StudyUS — strongly indicating the Preview environment's Clerk publishable key is misconfigured to point at an unrelated Clerk application (a separate personal project, "own-pmo", visible in the same Vercel account's other projects). This was discovered by actually opening the real Preview URL in a browser and reading the rendered page — exactly the kind of "repository evidence wins over assumption" discipline this phase's own instructions demanded. No further interaction (no sign-in attempt, no credential entry) was performed once this was observed. See F15_PREVIEW_CERTIFICATION.md and F15_SECURITY_HARDENING_REPORT.md.

## Inspection performed before implementation (real files read, not summaries trusted)

- F9 readiness/simulation architecture: `src/lib/readiness/*`, `src/lib/simulation/*` — confirmed `SimulationPlanTarget` carries only a question-type SPEC, never generated content; confirmed `recordSimulationItemResponse` already resolves a concept for evidence-writing via `resolveActivityMetadataForObjective`/`resolveStudentConceptForCanonicalConcept` — the exact bridge reused for generation.
- F10 Parent preparation model: unchanged this phase, `getParentExamPreparation` remains the sole F9-sourced consumer.
- F11 Teacher/intervention/student execution: `teacher-intervention-execution.service.ts` re-read in full; confirmed the Student execution dispatcher and reconciliation mechanics this phase's exam-session-integrity tests now cover with real IDOR assertions.
- F12 Institution Intelligence: every metric function in `src/lib/institution-intelligence/` re-read; classified which are cohort-aggregates (Learning/Readiness/Diagnostics/Interventions) vs. structural counts (Overview/roster) vs. institution-independent (Coverage) vs. individually-authorized (drill-down, Teacher operational summary) — see ADR-F15-MIN-COHORT-POLICY.md.
- Current Exam/Quiz/Simulation routes: `/api/quizzes/generate-and-take`, `/api/simulation/attempts*`, `src/lib/quiz/client-question.ts` (the answer-key-stripping sanitizer reused for the new exam-taking UI).
- Package scripts (`package.json`): confirmed no `lint` script/ESLint config exists in this repository (a real, disclosed gap, not fixed this phase — out of scope, no lint convention to conform to).
- Deployment configuration: `next.config.js` (3 lines, only `serverExternalPackages`), `.vercel/project.json` (real, gitignored, present in the original checkout).
- Logging/observability: one real structured logger exists (`src/lib/ai/logging.ts`, AI-scoped only); no correlation-id mechanism anywhere; extended this phase via `src/lib/observability/pilot-events.ts` in the same style.
- Rate-limiting/AI gateway: a real, working AI gateway (`src/lib/ai/gateway.ts`, `operational-limits.ts`) with timeouts/cost caps/allowlists already exists and needed no changes; a real but narrowly-applied `checkRateLimit` helper (`src/lib/auth.ts`) existed with exactly one caller — extended to 3 more high-cost routes this phase.
- DB/runtime configuration: `src/lib/db.ts`'s connection pool (2s connection timeout, 15s statement timeout, default pool size) reviewed — no change needed, reasonable for pilot scale.

## Scope discipline

No architecture rewrite was performed or considered necessary. The one place a genuine "architectural blocker" was found (item-content generation for simulations) was resolved by wiring three EXISTING, already-certified systems together in a new, bounded orchestrator (`src/lib/simulation/item-resolution.service.ts`) — not a new exam engine, not a rewrite of any existing service.

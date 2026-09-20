# F15 — Target Pilot Architecture

No architecture rewrite was performed or is proposed — this document records the architecture AS IT NOW STANDS after F15's own additive changes, for pilot-readiness traceability.

## Unchanged from F1–F14 (the vast majority of the system)

Identity/workspace (F1), institutions/relationships (F2), entitlements (F3), learning architecture (F4), evidence/learner state (F5), curriculum mapping (F6), assessment framework (F7), teaching/exam skills (F8), readiness/simulation (F9), Parent experience (F10), Teacher/intervention/student execution (F11), Institution Intelligence (F12), UX consolidation (F13), Experience Completion (F14) — all unchanged in their own domain logic. F15 added no new identity, authorization, or academic-computation primitive anywhere.

## New in F15

```
Teacher Intervention (EXAM) / Student Self-Service Exam Prep
                    │
                    ▼
        POST /api/simulation/attempts  (F9, unchanged)
                    │
                    ▼
        GET/POST /api/simulation/attempts/[id]/next-item   ← NEW (F15)
                    │
        ┌───────────┴────────────────────────────────┐
        ▼                                              ▼
  item-resolution.service.ts (NEW, F15)         recordSimulationItemResponse
        │  orchestrates, generates nothing itself       (F9, unchanged -- grading)
        ▼
  F6 objective_concept_mappings → F9 concept-resolution → existing AI question generator
  (all three already certified; item-resolution.service.ts is the NEW, thin glue)
                    │
                    ▼
        POST /api/simulation/attempts/[id]/complete  (F9, unchanged)
                    │
                    ▼
  Institution Intelligence: getInstitutionDiagnosticSummary /
  getInstitutionInterventionSummary now cohort-suppressed
  (ADR-F15-MIN-COHORT-POLICY.md -- real product policy, was OPEN_DECISION)
```

## Deployment topology (confirmed real this phase, not assumed)

```
GitHub-independent Vercel CLI deploy (this phase's own mechanism)
        │
        ▼
Vercel project: study-so/study-os
        │
   ┌────┴────┐
   ▼         ▼
Preview   Production (www.studyus.pro)
(separate DATABASE_URL, separate CLERK_SECRET_KEY/PUBLISHABLE_KEY --
 confirmed via `vercel env ls`; ANTHROPIC_API_KEY/OPENAI_API_KEY
 shared across both -- a disclosed, unresolved-this-phase choice)
```

**Known defect**: Preview's Clerk publishable/secret key currently resolves to an unrelated Clerk application ("PMO OWN") — see F15_PREVIEW_CERTIFICATION.md. This is a configuration defect in the Vercel project's own environment variables, not an architectural one.

## Config schema validation

No dedicated config-schema validator (e.g., a Zod schema for `process.env`) exists in this codebase — environment variables are read ad hoc (`process.env.X`) wherever needed, matching this codebase's existing convention (unchanged, not modified this phase — no concrete pilot blocker found that required one).

## Health checks

No dedicated `/api/health` or `/api/healthz` route exists in this codebase (grep-confirmed). A real, disclosed gap for release-checklist/uptime-monitoring purposes — registered as `IVG-F15-13`, not built this phase (no concrete pilot blocker demonstrated the need, but a real, cheap, low-risk addition a near-future phase should make).

## Release checklist (draft, informed by this phase's own findings)

1. Confirm the target database has the full migration history applied (`npm run db:migrate -- --dry-run`).
2. Fix and re-verify the Preview Clerk configuration (`IVG-F15-02`).
3. Rotate/remove the `f0s-security` credential exposure (`IVG-F14-06`/`IVG-F15-01`).
4. Re-run the full real-Postgres regression suite (16 scripts) and the full unit suite against the target commit.
5. Execute the authenticated E2E matrix (`IVG-F15-03`) once #2 is resolved.
6. Confirm `AI_ENABLED` and rate-limit thresholds are set appropriately for the pilot's expected real traffic.

# F15 — Data Consistency Report

## The propagation chain (task's own explicit requirement)

```
Exam submission (POST .../next-item, action=submit)
      ↓ recordSimulationItemResponse (F9, unmodified) writes exam_attempt_item_responses
      ↓ AND real learning_evidence via updateMastery (when a concept was resolved)
      ↓
Exam completion (POST .../complete, F9, unmodified)
      ↓ runPostExamDiagnosis (F8) + computeReadinessSnapshot (F9) -- BOTH re-run synchronously,
        in the same request, before the response is returned
      ↓
Student view (Exam Prep page, /dashboard/exam-prep/[examProfileId])
      ↓ reads getLatestReadinessSnapshot -- the NEXT page load already sees the fresh snapshot
        (no caching layer, no eventual-consistency delay -- Server Component, fetched fresh)
      ↓
Teacher intervention (if this attempt was Teacher-assigned)
      ↓ reconcileCompletionsForStudent (F11-C1, unmodified) -- LAZY, read-triggered (see below)
      ↓
Parent canonical progress/readiness (getParentExamPreparation, F10, unmodified)
      ↓ reads the SAME getLatestReadinessSnapshot -- same freshness as the Student's own view
      ↓
Institution aggregates (getInstitutionReadiness, F12, unmodified)
      ↓ reads readiness_snapshots directly -- same freshness, cohort-suppressed per ADR-F15-MIN-COHORT-POLICY
```

## Synchronous vs. eventual (both real, both disclosed — not assumed)

- **Readiness recomputation is synchronous**: `POST /api/simulation/attempts/[id]/complete` calls `computeReadinessSnapshot` in the same request before responding — the Student's next page load (Exam Prep, Parent's exam-prep card, Institution Readiness) sees the fresh snapshot immediately. No delay, no refresh mechanism needed, no eventual-consistency window for readiness specifically.
- **Teacher intervention completion is intentionally LAZY (eventual, by design — unchanged from F11-C1)**: `reconcileCompletionsForStudent` only runs when the Student's own pending-interventions list is READ (e.g., the Student opens `/dashboard/assignments`, or the nav badge count is computed) — never on a background job, never synchronously from the exam-completion request itself. This is F11-C1's own original, already-certified design (documented in its own source comments), unchanged by F15.
  - **Expected delay**: until the Student (or the layout's own nav-badge query) next reads their intervention list — typically the Student's very next page navigation, since `getStudentPendingTeacherInterventions` runs reconciliation on every call.
  - **Refresh mechanism**: none needed beyond a normal page load — no polling, no websocket, no manual refresh button.
  - **Source of truth**: `teacher_interventions.status` (updated only by the reconciliation read) is authoritative for the intervention's own lifecycle; `readiness_snapshots`/`exam_attempt_item_responses` (updated synchronously at completion) are authoritative for the academic outcome itself — these are two separate concerns, never conflated (matching F12's own explicit "Completed means operationally finalized, never a mastery/passing claim" distinction).
  - **Failure behavior**: if reconciliation is never triggered (the Student never revisits Assignments), the intervention row remains stuck at `IN_PROGRESS` indefinitely — a real, disclosed, PRE-EXISTING characteristic of F11-C1's design, not introduced or worsened by F15. A Teacher viewing `getInstitutionInterventionSummary`/`getTeacherOperationalSummary` would see this specific intervention as still `IN_PROGRESS` even though the Student's own exam is `COMPLETED` — until the Student's own next relevant page load.

## What was NOT tested live

This entire chain is verified by code reading (this phase) and by F9/F11/F12's own real-Postgres regression scripts (verifying pieces of it — e.g., F11-C4's own cert script exercises the EXAM intervention completion path end-to-end against a real Postgres instance, re-run this phase, PASS) — not by a live, authenticated, multi-role browser session watching data propagate in real time. Registered under the same `IVG-F15-03` (authenticated E2E) umbrella.

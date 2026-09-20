# F13 — Student Experience

## Scope decision: consolidate the SHELL integration, preserve the mature internals

The Student experience (Today/My Path/Progress/Study Plan/Debt/Tutor/Quiz/Remediation/Cognitive tasks) was already the one fully-built, certified-by-usage journey in this codebase (task's own framing: "Preserve existing pedagogical sequence... F13 may improve presentation and routing. It must NOT alter the certified progression authority," task section 9). F13 makes exactly ONE change to the Student experience itself: the shell now resolves the Student workspace through F1's real `resolveAvailableWorkspaces`/`getActiveWorkspace` (previously the Student path was the unconditional default with no workspace concept at all) — every existing Student page, route, and pedagogical sequence (Explain → Worked Example → Guided Practice → Contextual Help → Independent Practice → Prove) is untouched.

## Student Interventions (task section 10) — not built as a new surface this phase

Teacher-assigned interventions ARE visible to the Student today via the existing, certified F11 routes (`GET /api/student/teacher-interventions`, `POST /api/student/teacher-interventions/[id]/start`) — but no dedicated Student-facing PAGE consolidates them into the Student's own dashboard (confirmed: no page under `src/app/dashboard` calls these routes). This is a real, disclosed gap: F13 did not build a "My Assignments" Student page distinguishing Teacher-assigned from self-service activity in the UI layer this phase, given the scope already covered building the Teacher/Institution workspaces from nothing. Documented as a priority next step (`F13_NEXT_PHASE_HANDOFF.md`) — the backend distinction (Concept/Skill/Competency/Exam, Teacher-assigned vs. self-service) is already fully real and certified (F11-C1 through C4, F11 Integrated); only the Student-facing presentation is missing.

## Exam Prep self-service independence (task section 11/45, INV-F13-16)

Verified structurally and by regression: the Student's own self-service exam flow (`/api/simulation/attempts`, `/api/readiness/*`) has zero dependency on `teacher_intervention_executions` — re-confirmed by re-running F11 Integrated's own certification (`Section 1: F9 STUDENT SELF-SERVICE NON-REGRESSION`) in this phase's regression pass. No new Student-facing Exam Prep UI was built this phase (same scope-prioritization reason as above) — this remains an F9 API-only surface from the Student's perspective, same as before F13.

## What was NOT changed, verified by re-running the full domain regression matrix

Zero domain behavior changed for any Student journey — F5/F6/F7/F8/F9/F11's own real-Postgres certifications all re-ran unchanged in this phase (see `F13_QA_REPORT.md`).

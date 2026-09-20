# F13 — Journey Certification

Task sections 45-49. Certified at the LEVEL the environment safely allowed: real-Postgres domain-logic re-certification (full), structural/compile-time verification of every new page (full), and one honest, safe, unauthenticated live-browser boot check (limited). Authenticated, live, multi-role visual journey walkthroughs were NOT performed — see `F13_PREVIEW_CERTIFICATION.md` for why, and `F13_IVG_DEFERRED_TEST_REGISTER.md` for the registered follow-up.

## Student Journey (task section 45)

Login/role-workspace/home/learning/progress/settings: **unchanged by F13** (verified: zero Student page file was modified except the shared shell, which was extended additively). Teacher assignment visibility and Exam Prep self-service: real, certified backend (F11/F9), no new Student-facing UI built this phase (see `F13_STUDENT_EXPERIENCE.md`). Self-service exam independence from F11: **re-certified**, F11 Integrated's own real-Postgres section 1 re-ran unchanged.

## Parent Journey (task section 46)

Zero-child/pending/accepted/multi-child/revoked: **unchanged, re-certified** via F10's own real-Postgres regression (multi-child isolation, revocation). Read-only: **verified structurally** (no academic-write CTA exists in the Parent page, unchanged). Workspace integration (Parent as a first-class switchable workspace): **new this phase**, verified by code reading (`buildParentNav` wired into `dashboard/layout.tsx`) — not live-tested with a real multi-role Parent+other-role account.

## Teacher Journey (task section 47)

Teacher role / classes / students / student detail: **new this phase**, verified via `tsc`/`next build` success and direct code reading of the authorization chain (every page re-verifies server-side). Assign Concept/Skill/Competency/Exam: **new this phase**, the form and the underlying route (with its EXAM-schema fix) both compile and the underlying `assignTeacherIntervention`/`startTeacherInterventionExecution` chain is independently re-certified by F11's own real-Postgres regressions (unchanged, re-run this phase). Observe intervention lifecycle/outcome: **new this phase** (StatusBadge rendering of real `TeacherIntervention.status`). Wrong class remains DENY: **re-certified** via F11-A's own real-Postgres regression.

## Institution Journey (task section 48)

Overview/learners/interventions/attention: **new this phase**, same verification level as Teacher above. Grade/class/teacher/coverage/readiness pages: **not built this phase** (see `F13_INSTITUTION_EXPERIENCE.md`/`F13_INFORMATION_ARCHITECTURE.md` for the exact, disclosed reasons). Cross-institution remains DENY: **re-certified** via F12's own real-Postgres regression (unchanged, re-run this phase).

## Multi-Role Certification (task section 49)

PARENT+TEACHER / other combinations: **backend re-certified** (F11 Integrated's and F12's own multi-role adversarial cases re-ran unchanged this phase, proving no permission-merging exists at the domain layer). **UI-level** multi-role switching (does the WorkspaceSwitcher correctly offer both workspaces and render the correct nav for each) was verified by code reading (`available.length <= 1` branch, the `HOME_HREF` map, `router.refresh()`) but not exercised with a live, real PARENT+TEACHER fixture account in a browser session.

## No Domain Write Certification (task section 50)

**Re-certified, not merely inherited**: every new page/route this phase added was checked by the new `f13-ux-consolidation-source-guard.test.ts` for direct writes to Evidence/Learner State/Readiness/Diagnostic/Canonical tables (zero found) — and F11/F12's own real-Postgres zero-write proofs (which exercise the underlying services these pages call) re-ran unchanged this phase.

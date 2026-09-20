# F13 — Legacy UX Containment

Task section 23 — critical. Every caller of legacy readiness/predicted-score/old-progress UI was inventoried by direct grep + code reading (not assumed).

## Inventory

### 1. `src/services/exam-readiness.service.ts` (legacy predicted score + risk level + opaque overall percentage)

**Consumers found**: `src/app/api/exam-readiness/score/route.ts` (API-only), `src/app/api/quizzes/generate-and-take/route.ts`, `src/services/assessment-verification.service.ts`. **Zero UI/page consumers** — confirmed by grep across `src/app/**/*.tsx` and `src/components/**/*.tsx`; no page renders this service's output.

**Classification: `HIDE_FROM_NAV`** (already true — it was never in the nav to begin with) **+ `RETAIN_TEMPORARILY`** for its existing non-UI callers (the two routes above are outside this phase's scope to re-plumb; removing the service would require re-verifying those two callers' own real dependencies first, which is F14 work). **New consolidated UX MUST NOT use it** — enforced structurally (`f13-ux-consolidation-source-guard.test.ts` fails the build if any new F13 file imports `exam-readiness.service` or calls `calculateExamReadiness`/`getMultiSubjectReadiness`/`getOverallExamReadiness`).

### 2. `assessment_occurrences.exam_readiness` (a manually-set legacy percentage, pre-F9, on the "Assessment Calendar" feature)

**Consumer found**: `dashboard/parent/page.tsx` — renders `upcomingExam.examReadiness` as a bare `{Math.round(examReadiness)}%` next to an upcoming exam date, sourced through `parent.service.ts` → `assessment.service.ts`'s `AssessmentOccurrence.examReadiness` field.

**Classification: `REQUIRES_F14_MIGRATION`.** This is real, live, user-facing legacy readiness UI, currently shown to real Parents today. It is NOT removed in this phase (task's own explicit instruction: "do not remove a legacy route if that could break an existing production flow without migration strategy" — the Parent page's upcoming-exam feature has no F9-based replacement built yet, and removing the field without one would regress a real, working feature for no user-facing gain). It is also NOT extended or reused anywhere new — every NEW F13 surface (Teacher Student Detail, Institution pages) reads F9's `readiness_snapshots` exclusively, never this field (structurally guarded, verified by real-Postgres regression that F9 remains the sole readiness source for anything new).

**Migration path for F14**: replace `assessment_occurrences.exam_readiness` in the Parent page's upcoming-exam card with a real F9 `readiness_snapshots` lookup for that child's active exam profile (the SAME pattern `getTeacherStudentOverview`'s `latestReadinessStatus` already establishes this phase) — this requires the Parent-facing read model to gain an F9-aware summary function (does not exist yet; F10's own Parent overview predates F9's certification) and a decision about whether/how to deprecate the `assessment_occurrences.exam_readiness` column and its manual-entry workflow (out of scope to decide unilaterally here).

## No other legacy UI found

No other component or page anywhere in `src/app`/`src/components` references a predicted-score, opaque readiness percentage, or duplicate/legacy dashboard — confirmed by direct inspection (`F13_CURRENT_UX_ARCHITECTURE_ASSESSMENT.md`'s own findings).

## Legacy `UserRole`/`sessionClaims.role` (src/lib/auth.ts) — a related but distinct legacy surface

Not a "readiness" concern, but a related identity-legacy finding: `UserRole = 'student'|'teacher'|'admin'` (Clerk `sessionClaims.role`-based) coexists with F1's real `Role`/`Workspace` model. **Classification: `RETAIN_TEMPORARILY`** — `verifyStudentAccess` (built on it) has 54 real callers across the existing Student API surface; F13's own new workspace-aware layout uses ONLY the real F1 functions, never this older type, but replacing `verifyStudentAccess` itself is out of this phase's scope (a Student-domain authorization primitive, not a UX concern) and is called out here only so F14 has the full picture rather than discovering it independently.

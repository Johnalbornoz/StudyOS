# F13 — Current UX Architecture Assessment (inspect-first)

Real inspection of the current frontend before any source change, per task §3. An initial broad-exploration pass via a research subagent returned several materially FALSE claims (e.g. "no `src/lib/authorization` module exists," "no `institutions`/`teacher` API routes exist," "no workspace concept exists") — every finding below was independently re-verified by directly reading the actual files in this worktree before being relied upon. This is itself a documented finding: broad automated exploration of this codebase produced confident-sounding but incorrect claims, and every claim in this document (and everything built on it) was cross-checked against real files, not trusted from that pass.

## Global shell / layout (verified directly)

One authenticated shell: `src/app/dashboard/layout.tsx` (server component) resolves the actor, notification/debt/streak counts, and interface locale, then renders `LearnerShell` (`src/app/dashboard/LearnerShell.tsx`, client component) — a real, already well-built responsive shell: fixed sidebar ≥1024px, sticky top bar + slide-in drawer below it, with genuine accessibility work already in place (focus trap, Escape/backdrop close, focus restore, `aria-modal`, `aria-current`, landmark `aria-label`s). Navigation content is a pure, serializable data module (`src/lib/lx/learner-navigation.ts`, `buildLearnerNav`) resolved to labels server-side via the existing i18n system — genuinely good architecture to extend, not replace. A separate, unrelated marketing shell exists at `src/app/[locale]/layout.tsx` for the public site.

## Route map (verified directly)

**Student** (`src/app/dashboard/*`): mature, many pages — `page.tsx` (Progress V2), `today`, `path` (My Path), `subjects/*`, `quiz`, `study-plan`, `learning-debt`, `remediation/[pathId]`, `cognitive/explain`, `cognitive/transfer`, `tutor`, `notifications`, `profile` (academic profile, not account settings), `billing`.
**Parent**: exactly one page, `dashboard/parent/page.tsx` — client component, calls `/api/parent/children` + `/api/parent/child-overview`, includes a child-link form, per-child subject/mastery/debt/upcoming-exam display, and an unlink action.
**Admin**: `dashboard/admin/page.tsx` (student list) + `dashboard/admin/[studentId]/page.tsx`, gated by `isAdminEmail` (an email allow-list, `src/services/admin.service.ts`), unrelated to the F1 role/workspace model.
**Teacher / Institution**: **zero UI pages exist** — confirmed directly (`find src/app/dashboard -name page.tsx` has no teacher/institution entries) — but the BACKEND API surface for both is fully built and certified: `src/app/api/teacher/{classes,students,interventions}/*` (F11-A/B) and `src/app/api/institutions/[id]/{assignments,membership,memberships,intelligence}/*` (F2/F12). This is the actual, verified gap F13 closes for these two roles: not "no backend," but "no frontend consuming an already-real backend."

## Role/workspace resolution — a real, ALREADY-CERTIFIED system exists (the key correction to the unreliable initial pass)

`src/lib/identity/` (F1) has a complete, real workspace model:
- `Role` = `STUDENT | PARENT | TEACHER | INSTITUTION_ADMIN | STUDYUS_ADMIN`; `Workspace` = `STUDENT | PARENT | TEACHER | INSTITUTION | ADMIN` (`src/lib/identity/types.ts`).
- `resolveAvailableWorkspaces(userId)` / `resolveDefaultWorkspace(userId)` / `getActiveWorkspace(userId)` / `setActiveWorkspace(userId, workspace)` (`src/lib/identity/workspace.service.ts`) — already documents its own invariant: "switching workspace only ever changes which UI context is presented — it never touches, grants, or widens any resource-level authorization."
- `GET /api/identity/me` and `POST /api/identity/workspace` already exist, fully wired to this real service, with `setActiveWorkspace` failing closed (`WORKSPACE_UNAVAILABLE`, 403) for an unavailable workspace.

**Separately**, `src/lib/auth.ts` retains an older `UserRole = 'student' | 'teacher' | 'admin'` type read from Clerk `sessionClaims.role`, used by `verifyStudentAccess` and a stubbed, non-functional `canTeacherAccessStudent` (`return false`, marked TODO) — this is legacy, pre-F1 scaffolding that coexists with, but does not replace, the real F1 model. It is not removed by F13 (no evidence it is dead — `verifyStudentAccess` has real callers), but F13's own new workspace-aware layout uses ONLY the real F1 functions, never this older type.

## Existing dashboards per role (verified)

Student: full, mature. Parent: one page, functional but not workspace-integrated (Parent access today is just another nav link inside the STUDENT shell, `nav.parent` → `/dashboard/parent` — Parent is not yet a first-class WORKSPACE the shell renders distinctly, even though F1's backend already models it as one). Teacher/Institution: real backend, zero frontend (see above).

## A real, load-bearing gap found and fixed during inspection

`POST /api/teacher/interventions`'s Zod schema (`src/app/api/teacher/interventions/route.ts`) was never updated when F11-C4 added the `EXAM` target branch to `assignTeacherIntervention`'s own real `TeacherInterventionTarget` union — the route only accepted `CONCEPT/SKILL/COMPETENCY/LEARNING_OBJECTIVE`. This meant Exam Reinforcement, despite being fully certified at the service/domain layer (F11-C4), had **no real HTTP path** a Teacher UI could ever call. Fixed as part of this phase (see `F13_TEACHER_EXPERIENCE.md`).

## Legacy readiness / predicted-score usage found (the critical F13 §23 finding)

The EXISTING Parent page (`dashboard/parent/page.tsx`) renders `upcomingExam.examReadiness` as a bare percentage next to an exam date. Traced to `assessment_occurrences.exam_readiness` (a manually-set `numeric(5,2)` column on the pre-F9 "Assessment Calendar" feature, `src/services/assessment.service.ts`) — a genuinely different, legacy concept from F9's real Readiness Engine, predating it entirely. This is real, live, user-facing legacy readiness exactly as task §23 describes. See `F13_LEGACY_UX_CONTAINMENT.md` for its classification; it is NOT removed in this phase (removing it risks the one fully-working Parent experience without a migration plan) but every NEW surface F13 builds uses F9's `readiness_snapshots` exclusively (verified by source guard).

The separate, still-live `src/services/exam-readiness.service.ts` (predicted score + risk level + opaque overall percentage) has zero UI callers today (confirmed by grep) — its only consumers are `/api/exam-readiness/score`, the quiz-generation route, and `assessment-verification.service.ts`. No page renders it. It remains a live API-only surface, unused by any UI, old or new.

## Design system (verified)

A real, coherent CSS custom-property/utility-class design system already exists in `src/app/globals.css` (~940 lines): color tokens with `prefers-color-scheme: dark` support, spacing/radius/shadow scale, `.card`/`.card-link`, `.chip`/`.chip-good`/`.chip-warn`/`.chip-critical`, `.mastery-bar`/`.fill-good`/`.fill-warn`/`.fill-critical`, `.list-card`/`.list-row`, `.empty-state`, `.accordion-header`. No component-library dependency exists (no shadcn/Radix/Chakra/MUI) — `lucide-react` for icons, hand-written CSS otherwise. This is a real, usable foundation; F13's design-system work wraps it in React components rather than replacing it (see `F13_DESIGN_SYSTEM_CONSOLIDATION.md`).

## i18n (verified)

Real, working 5-locale system (`es/en/de/fr/pt`, not just "ES/EN/DE" as the task's own framing assumed) — `src/lib/i18n/messages.ts` (a flat `MessageKey → string` dictionary per locale) + `src/lib/i18n/language.ts` (`getInterfaceLanguage`/`setInterfaceLanguage`, keyed by `user_language_preferences.user_id`, populated today only with `students.id` values — see `F13_ROLE_WORKSPACE_MODEL.md` for how F13 extends this safely for non-Student workspaces without touching existing Student rows). Activity/content language (`resolveQuizLanguage`) is fully automatic per-subject, not a user-facing control — confirmed no UI sets `quiz_language_mode`.

## Duplicated surfaces / dead paths

None found — `dashboard/page.tsx` and `dashboard/today/page.tsx` both explicitly document in their own comments that prior logic was fully removed, not left running in parallel (no live duplicate Student dashboards). No legacy Teacher/Institution UI exists to duplicate (there was never a first one).

## Authorization risks in routing (verified)

None found beyond the well-known, already-accepted pattern this entire platform uses: every route resolves the actor server-side (`verifyAuth`) and re-checks authorization inside its own service call — UI route presence/absence was never treated as the security boundary anywhere inspected. F13's own new pages follow this identically (see `F13_TEACHER_EXPERIENCE.md`/`F13_INSTITUTION_EXPERIENCE.md`).

## Mobile/responsive and accessibility gaps

The Student shell already has real responsive/accessibility behavior (see above). The Parent page and Admin pages are plain, unresponsive HTML/inline-style layouts with no special mobile handling — not broken, but not deliberately certified for small viewports either. F13's new Teacher/Institution pages inherit the SAME responsive shell (no separate layout), so their chrome is responsive by construction; their own content uses CSS grid `auto-fit`/`minmax` for card layouts, which reflows on narrow viewports without a separate mobile stylesheet.

# Full role E2E matrix — Friday pilot

Prepared 2026-10-14 (overnight run). This matrix covers DEV and the morning immutable candidate. It does **not** apply to the frozen PAA Preview (`preview.studyus.pro` = `610d3c6`), and nothing in it moves an alias or touches Stage or Production.

The matrix has five parts:
- the personas and the fixtures that back them;
- every isolation rule, with the automated test that already enforces it;
- the browser flows still to run;
- the exact morning steps;
- the gaps that remain open.

No secret appears in this document. Credentials are short-lived Clerk sign-in tickets, minted by the fixture tool. They are never passwords and never written here.

## 1. Personas

The fixture tool is `scripts/operations/track-a-fixtures.ts` (DEV only).
- It refuses to run unless both checks pass: the database fingerprint is the DEV one (`2a29b99ee14a22b4`), and the Clerk keys belong to the Clerk DEV instance.
- Identities use the `+clerk_test@example.com` addresses and carry no password.

| Persona | Required behaviour | Fixture tag | Status |
|---|---|---|---|
| Student A, Learning only | Learning plan; no exam profile | `student-a` (one subject and concept, matched to the catalogue) | EXISTS |
| Student B, Exam Prep only | Exam profile (PAA or Cambridge 9709 P1); no Learning plan entries | **missing**; see gap G1 | TO_ADD |
| Student C, Learning + Exam Prep | Learning plan and an exam profile | `student-c` (it also carries the STUDYUS_ADMIN capability; see G2) | EXISTS, needs a clean variant |
| Parent linked to one Student | Sees only the linked child | `parent-a` (linked to student-a and student-c) and `parent-b` | EXISTS |
| Teacher with an authorised class | Sees only their own classes and students | `teacher-a`; `teacher-b` (class B, approved) | EXISTS |
| Institution user | Sees only their institution's aggregate and scope | `inst-a`, `inst-b` | EXISTS |
| Admin | Privileged StudyUs scope | StudyUs admin allow-list (`src/lib/admin/admin-identity.ts`) plus `student-c` capability | EXISTS (capability); see G2 |

## 2. Isolation and ownership

All tests below are automated and pass in the full unit suite of the convergence line, run on 2026-10-14.

| Rule | Enforced by | Automated test(s) |
|---|---|---|
| Student A cannot see Student B | `verifyStudentAccess`, `requireStudentId` (`src/lib/auth.ts`); `isOwner` / `canAccessLearner` (`src/lib/authorization/index.ts`) | `f2-multi-role-isolation`, `e2e-object-authorization`, `f0s-quiz-submission-ownership`, `b5r-form-ownership-independence` |
| Parent only sees the linked Student | `isActiveParentOf`; parent relationship lifecycle | `f10-parent-multi-role-isolation`, `f10-parent-identity-fix`, `f2-parent-relationship-lifecycle`, `l10-cr-l7-01-parent-invitation` |
| Teacher only sees permitted classes and students | `canTeacherAccessLearner`, `resolveTeacherClassScope`, `teacher-exam-scope.ts`, `teacher-subject-scope.ts` | `f11-teacher-api-routes-security`, `f11-teacher-read-model-source-guard`, `f11b-teacher-intervention-api-routes-security`, `l10-cr-l8-01-teacher-exam-subject-scope`, `l10-r2-teacher-whole-learner-scope` |
| Institution only sees its permitted aggregate and scope | `canAccessInstitution`, `requireInstitutionAdminActor` (`src/lib/institution/route-guard.ts`) | `f2-institution-membership`, `f12-institution-intelligence-source-guard`, `l10-guards-and-scope` |
| Admin has the proper privileged scope (and only through the allow-list) | `requireStudyUSAdmin`, `guardAdminUsersRoute` | `admin-authorization`, `admin-users-routes`, `admin-self-approval`, `admin-membership-console`, `f1-role-assignment-security` |
| A role is not inferred from another role | role-assignment service | `f3-role-independence`, `dashboard-layout-role-redirect` |
| Exam results respect Student ownership | `learner-result-scope.ts`; exam instance owner check | `e2e-object-authorization`, `b5r-form-ownership-independence`, `adhoc-concept-exam-start-authority` |
| Learning evidence respects Student ownership | `learner-data-scope.ts`; quiz submission owner check | `f0s-quiz-submission-ownership`, `g6-exam-evidence-isolation` |
| Exam Readiness respects Student ownership | `recordExamReadinessEvidence` reads only the attempt's own responses (`sa.student_id = $2`); `examReadinessOf(studentId)` is owner-scoped by its caller | `exam-readiness-evidence-separation` (contract). **No route exposes it yet**; see G3 |
| Cross-role routes fail closed | `src/lib/auth/protected-routes.ts`; every role route guard | `e2e-object-authorization`, `canon-r5r1b-zero-gap-authority-bypass`, `audit-canon-v2-ui-authority-closure` |

There are also HTTP E2E suites against a live DEV deployment. They use real sessions and real routes.

| Suite | Coverage |
|---|---|
| `scripts/operations/track-a-e2e-http.ts` | Roles, all four personas |
| `-teacher-` | Teacher |
| `-institution-` | Institution |
| `-institution-operational-` | Institution operations |
| `-learning-plan-` | Learning plan |
| `-class-progress-` | Class progress |
| `-curriculum-v2-` | Curriculum V2 |
| `scripts/operations/f10-multi-role-authorization-check.sh` | Multi-role authorisation, on an ephemeral database |

## 3. Browser flows (Friday)

The harness is Playwright (`tests/e2e/roles.spec.ts`). Sessions come from `E2E_STORAGE_STATE_DIR`, which holds `student.json`, `parent.json`, `teacher.json` and `institution.json`. The harness refuses Production hosts.

| Flow | Student A | Student B | Student C | Parent | Teacher | Institution | Admin |
|---|---|---|---|---|---|---|---|
| Login, then land in own workspace | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (G2) |
| Dashboard | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Learning: plan, activity, evidence | ✓ | must be absent | ✓ | read-only view of the child | class view | aggregate | — |
| Internal Assessment (AD_HOC, timed, scheduled) | ✓ | — | ✓ | sees the result | assigns | — | — |
| Exam Prep: catalogue, form, attempt, result | must be absent | ✓ | ✓ | sees the result | scope-limited | aggregate | — |
| Results and Exam Readiness | Learning results only | exam results only | both | linked child only | permitted students | aggregate | privileged |
| Logout and login; session persistence | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Responsive (375 / 768 / desktop) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Error state: cross-role URL means deny, no data | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

The Exam Prep cells for Student B and Student C use the converged candidate. The exams are PAA (frozen fallback behaviour), Cambridge 9709 Paper 1 (`v2.cambridge.9709-as`), and the IB covered sections.

## 4. Morning steps (operator)

1. **Fixtures.** Clerk DEV identities can only be created by the operator; Claude does not create accounts on external services. Always pass the DEV env file explicitly. Never use `.env.local`, which points at PROD.
   ```bash
   npx tsx --env-file=/Users/jalbornoz/PROYECTOS/studyos-dev/.env.neon-dev scripts/operations/track-a-fixtures.ts provision
   ```
2. **Add Student B (Exam Prep only)** — gap G1. Either extend the fixture tool with a `student-e` persona (an exam profile, no plan entries), or create it by hand in the candidate UI and record its tag.
3. **Sessions for the browser harness.**
   ```bash
   npx tsx --env-file=/Users/jalbornoz/PROYECTOS/studyos-dev/.env.neon-dev scripts/operations/track-a-fixtures.ts tokens /tmp/track-a-tokens.json
   ```
   Then sign in on the **immutable candidate host** and save each storage state into `E2E_STORAGE_STATE_DIR`.
4. **Run the browser harness against the candidate.**
   ```bash
   E2E_BASE_URL=https://<immutable-candidate-host> E2E_STORAGE_STATE_DIR=/tmp/e2e-sessions npm run test:browser
   ```
5. **Run the HTTP suites** against the same candidate, in the documented run order (memory: Track A roles E2E).
6. **Cleanup.**
   ```bash
   npx tsx --env-file=/Users/jalbornoz/PROYECTOS/studyos-dev/.env.neon-dev scripts/operations/track-a-fixtures.ts cleanup
   ```

## 5. Open gaps

| Gap | Description | Blocks Friday? |
|---|---|---|
| G1 | No Exam-Prep-only Student fixture. | Yes, for the Student B row. It is a small extension of the fixture tool. |
| G2 | `ROLES` in the Playwright harness has no `admin`. The only admin fixture is a capability on `student-c`. A dedicated admin session plus an `admin.json` storage state is needed. | Partially: the admin browser row only. |
| G3 | Exam Readiness has a reader (`examReadinessOf`) but no Student route or UI yet. Ownership is enforced by the writer's student check and by the caller. A route must call it with the authenticated Student id only. | No for the pilot E2E; yes before Exam Readiness is shown in the UI. |
| G4 | The HTTP suites predate Cambridge 9709 P1 and IB extensions; exam-prep cases cover PAA. | No. Cambridge and IB are proven by `governed-form-scenario.ts` on DEV. |

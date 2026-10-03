# Institution workspace (operational) + canonical domain vs curriculum — DEV readiness report

Status: **DEV candidate, ready for the manual E2E. Not certified.**

| | |
|---|---|
| Branch | `track-a/roles-e2e` (local, not pushed) |
| Commits | `5270ad7` domain vs curriculum · `d98d309` E2E expectations · `2bb1290` institution operations |
| Immutable URL | https://study-o7aaklw4x-study-so.vercel.app (`dpl_5WJyazHC9maxC1SWkxgD6nGsfw6U`, target dev) |
| Earlier immutable URL (domain fix only) | https://study-r43ek6ku2-study-so.vercel.app (`5270ad7`) |
| DB | DEV `2a29b99ee14a22b4`; 55 migrations, 0 pending, 0 drift. New: `20261018_1600` (academic domains) and `20261018_1700` (institution operations) |
| Shared DEV alias | not moved (`dpl_7fKYQ13t5…`) |
| Untouched | Stage, Production, main, Track B code, ALBO |
| Manual package | `docs/institution/INSTITUTION_ADMIN_MANUAL_E2E.md` |

## 1. Canonical academic domain vs curriculum subject

Matemáticas and Mathematics may share the **MATHEMATICS** domain. SEP · Matemáticas, Cambridge · Mathematics 9709 · A Level and IB · Mathematics AA · HL remain distinct curriculum subjects.

- **Model:**
  - `canonical_academic_domains`, plus `canonical_subjects.academic_domain_code`: a governed mapping by exact name;
  - `classes.academic_domain_code`.

  A class has three separate things: a display name, an academic area, and an explicit `institution_curriculum_id`.
- **Removed implicit bindings:**
  - auto-association when a curriculum is created;
  - the subject/grade fallback in `curriculumForClass` and in supplemental suggestions;
  - the "only option" preselection (selector and create form);
  - Class Progress borrowing another curriculum's structure for a bound class.
- **Candidates:** every active curriculum, same-domain first. The rest are shown as other area or grade and cannot be selected. Labels give authority · programme · subject (code) · level · grade · version / year.
- **Binding:**
  - only an explicit choice binds a class;
  - another domain is refused (`DOMAIN_MISMATCH`);
  - re-binding or removing a binding requires `confirmImpact`, with an impact preview (active students, plan concepts outside the new curriculum);
  - it is audited (ASSIGNED / CHANGED / REMOVED);
  - enrollments, the class plan and learner state are never touched.
- **Knowledge reuse:** curriculum content may include a canonical concept of the same domain (governed equivalence). One Student + one canonical concept = one learner state. Objectives, components, structure nodes and versions are never merged.
- **ALBO:** untouched. Its `Math` class row is identical before and after (verified on DEV); it stays unbound until a coordinator chooses.
- **Track A E2E suites updated:** the LP world binds its class explicitly; the curriculum V2 suite asserts an explicit, audited binding instead of auto-association.

## 2. Institution workspace: core administration

| Area | Before | After |
|---|---|---|
| Grades | create (name only) | create / edit (level, programme, academic year) / archive / reactivate / delete when nothing depends on it; detail page |
| Classes | create (name, grade, curriculum or subject) | create with grade required, academic area, explicit curriculum, period, teacher; edit; archive / reactivate (history kept); atomic teacher change; duplicate active names refused; ⋯ menu; detail with edit, teacher, roster, move, plan and assignments |
| Teachers | approve requests, assign, revoke | invite an existing teacher account (Invitado → teacher accepts → Aprobado), approve / reject, assign / unassign, suspend / reactivate (assignments kept, no access while suspended); every state shown; ⋯ menu; detail page; teacher-side accept / decline |
| Students | analytics only + invite to one class | Students tab: roster, add by email (institution students enrolled directly, others invited — never creates a Student), enroll in another class, move (old enrollment ended, history kept), remove; detail (classes, academic profile, permitted aggregate) |
| Coordinators | invite, remove | + reactivate a removed coordinator (last-coordinator and no-self rules unchanged) |
| Summary | metrics | Acciones rápidas + «Configura tu institución» wizard with progress (shown until complete) |
| Empty states | some | every tab has a CTA (Crear primer grado, Crear primera clase, Invitar docente, Añadir estudiante) |
| Audit | partial | every change in `academic_governance_events`: GRADE_*, CLASS_*, CLASS_CURRICULUM_*, TEACHER_*, STUDENT_*, COORDINATOR_REACTIVATED |

Institution assignments (§10) and curriculum configuration (§9) already existed. They are now reachable from the quick actions and the wizard.

## 3. Evidence

- **Unit tests:** 6843/6843 (424 files). New:
  - `track-a-domain-vs-curriculum.test.ts` (7);
  - `track-a-institution-operations.test.ts` (45): error mapping, guards on 17 routes, service rules, UI contract, additive migration.

  Existing route tests were updated to the new services: a foreign grade is now **404** (never revealed) instead of 422.
- **Typecheck:** clean. **Build:** OK.
- **DEV scenarios (real services, real DEV DB):**
  - `track-a-domain-curriculum-scenarios.ts`: **19/19**, covering:
    - same domain, distinct subjects; context labels; separate candidates; no automatic binding;
    - explicit Cambridge and SEP bindings; other domain refused;
    - re-binding needs confirmation; learner history preserved; audited;
    - class plan content follows the binding;
    - one learner state across both curricula; other-domain concept refused;
    - no structure contamination; cross-tenant curriculum and class denied;
    - ALBO untouched.
  - `track-a-institution-admin-scenarios.ts`: **50/50**, covering the full §18 flow 1–15 plus:
    - validation: no grade, foreign grade / curriculum / teacher / student, duplicate class name / enrollment, other-domain binding, archive or delete with dependencies, archived class locked;
    - suspend / reactivate; move with history;
    - coordinator rules; permissions; cross-tenant ids;
    - audit of every change.
- **Not run in this session:** Track A's HTTP E2E suites (they mint Clerk session tokens, which is credential handling done by the team). Their expectations were updated where the rule changed.
- **Migrations:** `20261018_1600` and `20261018_1700` applied to DEV through the governed runner (dry-run first). Both are additive, with documented rollbacks; `1700` widens one CHECK.

## 4. Verdicts

| Verdict | Result |
|---|---|
| CANONICAL_DOMAIN_VS_CURRICULUM_SUBJECT | PASS |
| EXPLICIT_CLASS_CURRICULUM_BINDING | PASS |
| CROSS_CURRICULUM_KNOWLEDGE_REUSE | PASS |
| CROSS_CURRICULUM_STRUCTURE_ISOLATION | PASS |
| INSTITUTION_GRADE_MANAGEMENT | PASS |
| INSTITUTION_CLASS_MANAGEMENT | PASS |
| INSTITUTION_TEACHER_MANAGEMENT | PASS |
| INSTITUTION_STUDENT_MANAGEMENT | PASS |
| INSTITUTION_COORDINATOR_MANAGEMENT | PASS |
| INSTITUTION_CURRICULUM_CONFIGURATION | PASS (existing V2 + explicit binding; reachable from quick actions and wizard) |
| INSTITUTION_CLASS_CURRICULUM_BINDING | PASS |
| INSTITUTION_ENROLLMENT_MANAGEMENT | PASS |
| INSTITUTION_QUICK_ACTIONS | PASS |
| INSTITUTION_FIRST_TIME_SETUP | PASS |
| INSTITUTION_OPERATIONAL_SECURITY | PASS |
| HOSTED_DEV_READY_FOR_INSTITUTION_ADMIN_MANUAL_E2E | PASS |

No manual E2E was run.

## 5. Open items

| # | Item | Severity |
|---|---|---|
| P1 | The visual and mobile pass of the new screens has not been done in a signed-in browser (part of the manual package). | P1 (manual E2E) |
| P2 | Inviting a teacher or student requires an existing StudyUS account; there is no email invitation for new people yet. | P2 |
| P2 | Institution assignments can still only edit the due date in the UI (the API accepts more fields); there is no archive for them. | P2 |
| P2 | Curriculum: no un-archive of an archived curriculum subject. | P2 |
| P2 | Track A HTTP E2E suites need a re-run by the team with fresh tokens (expectations already updated). | P2 |
| P3 | The domain mapping covers the current catalog subjects; new catalog subjects need a governed domain. | P3 |

No P0 is open.

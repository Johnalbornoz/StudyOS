# Roles E2E + Exam Core — Shared Foundation

- **Baseline:** `92e3509256804d261796da11e27c649aaffa3b39`, the Student release certified in Production (frozen).
- **Branch:** `foundation/roles-exams-shared`.
- **Purpose:** this is the common base for Track A (Roles E2E) and Track B (Exam Core and verticals).
- **Outcome of the audit:** the existing architecture already supports both tracks. The foundation therefore adds **no new architecture and no migration**. It hardens seven shared invariants that both tracks depend on (§14), and pins the contracts with tests.

## Product amendment PA-01 (2026-10-01) — single primary persona

**Decision (product owner):** the principle *"One canonical User, multiple functional roles"* is REPLACED by:

> **One canonical User, one primary functional persona; administrative and institutional privileges are separate capabilities.**

| Concept | Values | How it is obtained |
|---|---|---|
| Primary persona (exactly one per account) | STUDENT · PARENT · TEACHER | Chosen once, self-service, at first entry. Stable across sessions. Changing it is a deliberate account-management action (an administrator revokes the current persona, then assigns another), never "add another role". |
| Capability (zero or more) | INSTITUTION_ADMIN · STUDYUS_ADMIN | Invitation / allowlist / audited admin console, as before. Never offered for selection, never counted as a persona, reached by route (`/dashboard/institution/**`, `/dashboard/admin/**`). |

**What changed (Track A, branch `track-a/roles-e2e`):**
- `assignSelfServiceRole` refuses a second persona (`PERSONA_EXISTS`, 409), in one transaction serialized on the user row. A capability does not count as a persona.
- The admin console assigns a persona only when the account has no active one (`PersonaExistsError`, 409).
- The "add another role" link and the persona switcher are removed. The shell shows the account's persona; capabilities are plain navigation links; non-capability pages always render in the persona's workspace.
- Accepting a parent invitation grants PARENT only to an account with no persona (`PERSONA_CONFLICT` otherwise).
- DEV accounts created under the additive model were normalized deterministically (soft revoke, audited; `scripts/operations/track-a-single-persona-normalize.ts`). Preview / Production were not touched; promoting this amendment requires the same normalization first.

**What is preserved unchanged:** the canonical identity model (one `users` row per person, no duplicates), authorization boundaries, ownership fixes (F2, F7), audit logging, revoked-role handling (a revoked persona is never re-granted and still counts as the account's persona), cross-tenant security (F3), Student route protections, Institution protections, Exam protections (F1, F4, F5).

Sections §3, §14-F6, §15-F01 and §17-A1 below are superseded where they describe additive personas; they are kept for history and annotated.

## 1. System context

StudyUS ("No estudies más. Estudia mejor.") keeps the Student at the centre. The Learning Engine stays the only authority on cognition: mastery, provisional mastery, retention, transfer, misconceptions, learning readiness, and the next learning step.

Every other layer is a **client** of that engine. Parent, Teacher, Institution and Exam may only do the following:
- present
- assign
- organize
- observe
- report
- deliver and score exams
- emit evidence through the canonical contract (§9)

```
            ┌──────────── Identity (users · user_roles · workspaces) ────────────┐
Student ─┐  │  Authorization (default-deny: owner · accepted parent · scoped     │
Parent  ─┼─▶│  teacher · institution admin · explicit StudyUS admin)             │
Teacher ─┤  └──────────────────────────────────┬──────────────────────────────────┘
Inst.   ─┘                                     │
             Assignment layer (teacher_interventions) ──▶ activity / exam launch (owner only)
             Exam Core (F7 catalog · F9 simulation/readiness) ──▶ scoring ──┐
                                                                            ▼
                                  updateMastery()  ← the ONE evidence writer (Learning Engine)
                                  → learning_evidence → mastery/memory/transfer/knowledge projectors
```

## 2. Existing architecture reused (from the audit)

| Area | Reused | Status |
|---|---|---|
| Identity | `users`, `user_roles` (UNIQUE `user_id, role`), `users.active_workspace`, `getOrCreateCanonicalUser`, `hasRole`, `getUserRoles` | KEEP |
| Workspaces | `resolveAvailableWorkspaces`, `resolveDefaultWorkspace`, `setActiveWorkspace` (fail-closed), `WORKSPACE_PRIORITY`, `/role-select` (can add roles), `/api/identity/roles/select`, `/api/identity/workspace` | KEEP / EXTEND |
| Student identity | `students` + `profiles` (same UUID), `requireStudentId`, `linkStudentToCanonicalUser` | KEEP |
| Parent | `parent_student_relationships` (pending / accepted / declined / revoked), `parent_invitations` (student-initiated), `isActiveParentOf` | KEEP |
| Institution | `institutions`, `institution_memberships` (PENDING / APPROVED / REJECTED / REVOKED), `grades`, `classes`, `class_enrollments`, `teacher_assignments` | KEEP / EXTEND (no create or roster UI yet) |
| Authorization | `canAccessLearner`, `isOwner`, `canTeacherAccessLearner`, `canAccessInstitution`, `canAccessClass`, `canTeacherManageIntervention`, F12 `requireInstitutionAccess` / `requireClassInInstitution` / `requireLearnerInInstitution` | KEEP |
| Assignment | `teacher_interventions` (ASSIGNED → IN_PROGRESS → COMPLETED / CANCELLED / EXPIRED; targets CONCEPT / SKILL / COMPETENCY / LO / EXAM), `teacher_intervention_executions` | KEEP / EXTEND |
| Exam Core | F6 `academic_programmes` / `qualifications` / `subjects` / `learning_objectives`; F7 `exam_definitions`, `exam_versions` (DRAFT → PUBLISHED → SUPERSEDED / RETIRED), `scoring_models`, `assessment_components`, `assessment_blueprints` + allocations + objective targets, `command_terms`, item bank, `exam_attempts` (frozen configuration), `institution_exam_policies`; F9 `simulation_plans`, `simulation_attempts`, `readiness_snapshots`, `score_conversion_models` | KEEP / EXTEND |
| Learning boundary | `updateMastery` (sole `learning_evidence` writer, idempotent via `operation_key`), projectors, `validation_cycles` | KEEP |
| Entitlements | `canUseCapability`, `resolveLearningAccess` (separate from authorization), per-learner `subscriptions` + `subscription_events` | KEEP / EXTEND |
| Audit | `admin_audit_log` (`recordAdminAction`), `subscription_events`, `decision_events`, `ai_execution_events` | KEEP |

**DEPRECATE_LATER** (do not build on these):

| Item | Reason |
|---|---|
| `verifyParentAccess` | Duplicates `isActiveParentOf` |
| Parent-initiated `linkChildByEmail`, `/api/parent/requests` | Superseded by student-initiated invitations |
| `services/exam-readiness.service.ts` | Legacy heuristic, superseded by F9 |
| `lib/assessment/evidence-bridge.service.ts` | Test-only; no idempotency identity; duplicates the scoring path |
| `/api/learning/record-evidence` | Free-text `sourceType`, no telemetry. It is now owner-only (§14) |
| Concept-extraction mastery seeding | Writes zero-value rows outside the engine |
| Pilot seed scripts labelling PAA under "ICFES" | Wrong organization, inconsistent `exam_family` |
| `profiles.user_type` | Legacy duplicate of the role |
| Direct `getOrCreateStudentId` call sites | 25 routes. They are now safe (§14), but should migrate to `requireStudentId` |

## 3. Identity and multi-role model (superseded by PA-01: one persona + capabilities)

These five concepts stay separate:

| Concept | Question it answers | Where it lives |
|---|---|---|
| Authentication | Who is this person? | Clerk session, mapped to exactly one `users` row (`clerk_id` UNIQUE) |
| Role | In what capacity may they act? | `user_roles` (additive, UNIQUE `user_id, role`; status ACTIVE / REVOKED; `granted_via`) |
| Workspace | Which context are they acting in now? | `users.active_workspace`, always derived from active roles (fail-closed) |
| Authorization | May they act on *this* object? | `src/lib/authorization` (default-deny, relationship- and tenant-scoped) |
| Entitlement | Which paid capabilities may they use? | `src/lib/entitlements` (`canUseCapability`), per learner |

**Contract:**
- One person maps to one `users` row. ~~With N roles in any combination.~~ **PA-01:** with exactly ONE primary persona (Student, Parent or Teacher) plus optional capabilities (INSTITUTION_ADMIN, STUDYUS_ADMIN).
- Adding a role never creates a second `users` row or a second `students` row.
- ~~**Roles are additive.**~~ **PA-01:** personas are NOT additive. Holding a capability (including STUDYUS_ADMIN) never prevents choosing the one persona; holding a persona prevents choosing another (409 `PERSONA_EXISTS`). There is no "add another role".
- A role an administrator **REVOKED** is never silently re-granted by self-service (409 `ROLE_REVOKED`).
- Privileged roles (INSTITUTION_ADMIN, STUDYUS_ADMIN) are never self-service. INSTITUTION_ADMIN comes from an invitation; STUDYUS_ADMIN comes from the server-side allowlist bootstrap or the audited admin console.
- **Default landing** follows `WORKSPACE_PRIORITY` (STUDENT > PARENT > TEACHER > INSTITUTION > ADMIN). A stored active workspace wins while it is still available. Zero roles redirect to `/role-select`.
- **Switching** goes through `POST /api/identity/workspace`, which is fail-closed, followed by a full server round-trip so nothing stale from the prior role is shown. **PA-01:** there is no persona switching; capability contexts are entered by route and non-capability pages always render in the persona's workspace.

## 4. Workspace model

- `Workspace = STUDENT | PARENT | TEACHER | INSTITUTION | ADMIN`, produced by `workspaceForRole`.
- The workspace is the *acting context*. It is never an authorization grant.
- Every route still authorizes the object through `src/lib/authorization` (§10). This holds whatever workspace the user is in.
- Data-bearing contexts inside a workspace use **authorized path or query ids only**, re-validated on every request: the child in Parent, the institution or class in Teacher / Institution.

## 5. Parent model

- **Flow:** Student invites the parent's email (`parent_invitations`, pending). The parent signs in with that *verified* email and accepts (transactional, email must match). This creates `parent_student_relationships` with status `accepted`. Either side can revoke; revocation is soft.
- **Before acceptance:** `isActiveParentOf` returns false, so there is no learner access at all.
- **After acceptance:** the parent may use `LEARNER_PROGRESS_VIEW` and `LEARNER_PROFILE_VIEW` for **that child only**.
- **Never allowed:** `LEARNER_INTERVENTION_CREATE`, which is owner-only. A parent never reads through the Student learning-route guard, never through a teacher relationship, and never by entitlement.
- Parent access does **not** require a paid license.

## 6. Teacher and Institution model

**Institution:** created by StudyUS admin. It is `ACTIVE` before it can be listed. Its admin is invited (auto-APPROVED INSTITUTION_ADMIN membership).

**Teacher:**
- Self-selects TEACHER, then requests membership of an ACTIVE institution (PENDING).
- An institution admin or StudyUS admin decides: APPROVED or REJECTED. Revoking later also ends assignments.

**Teacher access to a learner** requires all of the following:
- an APPROVED TEACHER membership;
- an ACTIVE `teacher_assignment` (class or grade);
- an ACTIVE `class_enrollment` of that learner;
- a class that belongs to the **same institution**.

**Teacher access to a class** requires an approved membership with an active assignment in the same institution.

**Institution admin:** scoped to exactly its own `institution_id`. Learner-level data is reachable only through the cohort-suppressed F12 read models (`minimumCohortSize = 10`). Admin status never grants per-learner access by itself.

**Independent Student stays first-class.** Nothing requires an institution, and a learner may be enrolled in classes of more than one institution.

**Lifecycles (reused, not duplicated):**

| Entity | States |
|---|---|
| Membership | PENDING → APPROVED / REJECTED → REVOKED |
| Parent relationship | pending → accepted / declined → revoked |
| Institution | DRAFT / ACTIVE / SUSPENDED / ARCHIVED |
| Enrollment and teacher assignment | ACTIVE / ENDED |

## 7. Assignment model

**Generic assignment = `teacher_interventions`.**
- It references a target: CONCEPT, SKILL, COMPETENCY, LEARNING_OBJECTIVE, or **EXAM** (`exam_profile_id`, `simulation_type`, subject).
- Lifecycle: ASSIGNED → IN_PROGRESS → COMPLETED / CANCELLED / EXPIRED.

**An assignment schedules or requests; it never owns cognitive truth.**
- Only the learner (owner) can execute it.
- Execution launches a normal quiz session or simulation attempt, recorded in `teacher_intervention_executions`.
- Performance flows through the normal Learning or Exam pipeline into `updateMastery`.
- Source guards assert that no teacher or institution module writes `mastery_records`, `concept_knowledge_state`, `learning_evidence`, memory state or transfer state.

**Track A extensions:**
- Class-level batch assignment, as N per-learner interventions.
- A DRAFT / PUBLISHED authoring state, if the product needs one.
- Assignment of a published exam version. This is already representable through `EXAM` + profile.

## 8. Exam Core model (one core, configured per vertical)

```
academic_programmes (CURRICULUM | ASSESSMENT_FRAMEWORK | ADMISSION_EXAM)
  → academic_qualifications → academic_subjects → learning_objectives / command_terms
exam_definitions (exam_family, programme, domains)
  → exam_versions (DRAFT → PUBLISHED → SUPERSEDED | RETIRED; one PUBLISHED; navigation_rules; scoring_model_id; modalities)
    → assessment_components (SECTION | PAPER | WRITTEN | ORAL | PRACTICAL | COURSEWORK; timing / tool rules; support status)
    → assessment_blueprints → component allocations (items, weight) → objective targets (LO, command term, skill, question type, difficulty)
    → scoring_models (BINARY | PARTIAL_CREDIT | RUBRIC | MARK_SCHEME | MULTI_PART + config)
    → institution_exam_policies (verified thresholds) · score_conversion_models (calibration)
  → student_exam_profiles (owner) → simulation_plans → exam_attempts (frozen configuration) ⇄ simulation_attempts (timing mode, pause rules)
    → item responses (server-held pending question, graded) → completion → score summary → diagnosis → readiness_snapshots
```

**The Exam Core decides:** structure, section order, delivery and navigation, allowed question types, timing, scoring, attempt completion, the exam result, and exam readiness and coverage presentation.

**The Exam Core never decides:** mastery, retention, transfer, the cognitive next step, or misconception resolution.

**Attempt integrity:**
- An attempt starts only on a **PUBLISHED version of the profile's own exam definition** (§14-F5).
- The configuration is frozen on the attempt.
- Every attempt route authorizes against `attempt.studentId`. Writes are owner-only; reads allow `LEARNER_PROGRESS_VIEW`.
- Responses are graded only against the **server-held** question (§14-F1).

## 9. Exam → Learning Engine boundary (the actual pathway in code)

```
simulation next-item POST (owner) → recordSimulationItemResponse (scoring.service)
  → grade against server-held pendingQuestion → exam_attempt_item_responses (idempotency key)
  → objective → PUBLISHED concept mapping → the ATTEMPT OWNER's own concept (resolveStudentConceptForCanonicalConcept)
  → updateMastery({ sourceType: 'EXAM_SIMULATION', aiAssistanceType: 'NONE', identity: EXAM_SIMULATION_RESPONSE::<key>::<concept> })
  → learning_evidence (UNIQUE operation_key) → mastery / memory / transfer / skill / competency projectors → recalculateConceptKnowledgeState
```

- Completing an attempt writes **no** evidence. It writes diagnoses and a readiness snapshot, both read-only with respect to cognition.
- No exam module writes cognitive tables directly. Source guards cover this.
- Real school exams follow the same contract: `exam-result.service` → `updateMastery(REAL_SCHOOL_EXAM)`.
- **Rule for every new vertical:** reach cognition only through `updateMastery`. Use a real `EvidenceSourceType` (`EXAM_SIMULATION` / `REAL_SCHOOL_EXAM`), an idempotency identity, telemetry, and a concept resolved for the owner.

## 10. Security and tenancy model

**Default-deny.**
- Never authorize because a UUID exists.
- Every route resolves the object's owner or tenant, then calls the single canonical check.
- Direct API calls get exactly the same checks as the UI.

**Permission sets:**

| Actor | Permissions |
|---|---|
| Owner | PROGRESS_VIEW, PROFILE_VIEW, INTERVENTION_CREATE (the only write-capable set) |
| Accepted parent | PROGRESS_VIEW, PROFILE_VIEW |
| Scoped teacher | PROGRESS_VIEW, PROFILE_VIEW |
| Institution | INSTITUTION_MEMBER_APPROVE / TEACHER_ASSIGNMENT_MANAGE / INSTITUTION_INTELLIGENCE_VIEW for its own `institution_id` |
| StudyUS admin | Explicit admin capability (`requireStudyUSAdmin`: canonical role + allowlist), never ownership |

The Student's own learning-route guard (`verifyStudentAccess`) is **owner-only**. It used to honour a session-claim `admin` / `teacher` role (§14-F2).

The per-entity owner, readers, writers, tenant key and check are in [FOUNDATION_SECURITY_MATRIX.md](FOUNDATION_SECURITY_MATRIX.md).

## 11. Entitlements

- **Role ≠ Subscription ≠ Permission.** Membership is not an entitlement either.
- `canUseCapability` (`LEARNING_FULL_ACCESS`, `LEARNING_HISTORY_VIEW`, `BILLING_MANAGE`, `SUBSCRIPTION_REACTIVATE`) never imports authorization, and authorization never imports entitlements.
- Parent dashboards need **no** license. The parent read model never consults entitlements.
- Student premium learning and exam features keep the existing per-learner `subscriptions`. Sources: INDIVIDUAL_PAYMENT, PARENT_PAYMENT, INSTITUTIONAL_LICENSE, ADMIN_PROMOTION, TRIAL.
- Institutional entitlement is today a `source` on the learner's own subscription. A seat or contract model is a Track A decision (§16).

## 12. Data model

**Migrations required: 0.** Every requirement in §3–§11 maps onto existing tables (§2).

Schema gaps that the tracks may need are additive and belong to their tracks, not this foundation:

| Track | Possible additive need |
|---|---|
| B | `exam_versions` session or year column |
| B | Constrained `exam_family` taxonomy |
| B | RETIRE transition and scoring-model admin API |
| A | Institution seat or licence entity |
| A | Assignment authoring state |
| Both | `learning_evidence.source_type` CHECK constraint |

## 13. API and service contracts (the existing functions to use)

| Contract | Implementation |
|---|---|
| IdentityContext | `verifyAuth` (Clerk) → `getOrCreateCanonicalUser` |
| ActiveRoleContext / WorkspaceContext | `getUserRoles`, `resolveAvailableWorkspaces`, `getActiveWorkspace`, `setActiveWorkspace`; `assignSelfServiceRole` → `GRANTED` / `ALREADY_ACTIVE` / `REVOKED` |
| StudentAccessPolicy | `isOwner`, `requireStudentId`; `verifyStudentAccess` (owner-only, legacy learning routes) |
| ParentStudentAccessPolicy | `isActiveParentOf` / `canAccessLearner` |
| InstitutionAccessPolicy | `canAccessInstitution`, F12 `require*` gates |
| TeacherClassAccessPolicy | `canTeacherAccessLearner`, `canAccessClass`, `canTeacherManageIntervention` |
| AssignmentService | `teacher-intervention.service` (assign / cancel), `teacher-intervention-execution.service` (owner execution), `createTeacherAssignment` (tenant-guarded scope) |
| ExamDefinitionService | `exam-definition.service` (create, version, publish, published lookup) |
| ExamAttemptService | `simulation/attempt.service`, `item-resolution.service`, `isExamProfileOwnedByStudent`, `isExamVersionStartableForProfile` |
| ExamScoringService | `simulation/scoring.service` (grading + response record), `getSimulationScoreSummary` |
| ExamEvidenceBridge | `recordSimulationItemResponse` → `updateMastery` (§9). Not `evidence-bridge.service` (deprecated) |
| Audit | `recordAdminAction` (`admin_audit_log`), `subscription_events`, `decision_events` |

## 14. Foundation changes in this release (all shared, all tested)

| # | Change | Why it is shared |
|---|---|---|
| F1 | `/api/simulation/attempts/[id]/responses` retired. Auth and ownership are unchanged; it now returns 410 and **never grades a client-supplied question**. | The question carried its own answer key, so a student could forge a correct grade and write independent EXAM_SIMULATION evidence. The UI uses `next-item` (server-held question). |
| F2 | `verifyStudentAccess` is **owner-only**. The session-claim role grants nothing, and the dead `canTeacherAccessStudent` was removed. | A second, non-canonical admin/teacher model on 30 Student learning routes. A teacher could read and **write independent evidence** (`record-evidence`). |
| F3 | `createTeacherAssignment`: the grade or class must belong to the membership's institution (guarded atomic INSERT). The route returns 422 `SCOPE_OUTSIDE_INSTITUTION`. | Cross-tenant scope row. |
| F4 | `POST /api/exam-profiles` is owner-only (`LEARNER_INTERVENTION_CREATE`). | A read permission (parent / teacher) gated a write. |
| F5 | `isExamVersionStartableForProfile`: attempts start only on a PUBLISHED version of the profile's exam (409 `EXAM_VERSION_NOT_STARTABLE`). | Exam Core attempt integrity, for every vertical. |
| F6 | *(Amended by PA-01: the "add another role" offer is removed; outcome, audit and revoked-role handling are kept.)* Multi-role: `assignSelfServiceRole` returns its outcome and audits real grants (`ROLE_ADDED`, `SELF_SERVICE`). A revoked role gets 409, not a silent 200. The STUDYUS_ADMIN allowlist grant is audited. The workspace switcher always offers "add another role" (new i18n key `workspace.addRole`, 5 locales). | An admin-only account (observed in Production) could not discover the Student workspace. Role grants were unaudited. |
| F7 | `getOrCreateStudentId` creates a **new** `students` row only for an ACTIVE STUDENT role. The existing-row path is untouched. | Through 25 ungated Student routes, a Parent-only, Teacher-only or admin-only identity could silently become a Student. |

## 15. Architecture decisions (ADR summary)

| ADR | Decision |
|---|---|
| F01 | **Amended by PA-01:** one canonical User, one primary functional persona; administrative and institutional privileges are separate capabilities. Never a second identity per persona. *(Was: many additive roles.)* |
| F02 | Role ≠ Workspace ≠ Entitlement ≠ Authorization. They are separate modules and separate questions. |
| F03 | The independent Student stays first-class. Institution membership is optional and may be plural. |
| F04 | Parent access requires an **accepted**, student-consented relationship, scoped to that child, read-only. |
| F05 | Teacher access requires an approved membership plus an active assignment plus an active enrollment, in one institution. |
| F06 | Default-deny tenant isolation. Ownership or tenancy is resolved per request, and session claims or UUIDs never grant access. |
| F07 | One shared Exam Core (F6 / F7 / F9). No per-vertical engines. |
| F08 | The Exam Core never decides cognition. |
| F09 | Exam results reach mastery only through `updateMastery` with an idempotency identity and an owner-resolved concept. |
| F10 | Verticals are configuration (definition, version, blueprint, components, scoring model, policies) over the same core. |

## 16. Open decisions

| Decision | Class |
|---|---|
| Institution entitlement model (seats or contract vs. per-learner `INSTITUTIONAL_LICENSE` source) | NON_BLOCKING (Track A builds on the source attribute; seats can come later) |
| Assignment authoring states (DRAFT / PUBLISHED) on top of ASSIGNED | NON_BLOCKING |
| Class or roster creation UX owner (institution admin vs. teacher) | BLOCKING_BEFORE_TRACK_A **A4 only**. Product needs to name who creates classes. Default if silent: institution admin. |
| `exam_family` taxonomy and exam session or year column | BLOCKING_BEFORE_TRACK_B **B2** (choose the enum; additive migration in Track B) |
| Execute `scoring_models.config` (weights, partial credit, mark schemes) | BLOCKING_BEFORE_TRACK_B **B1** (core work, not a decision) |
| Official specs and content for PISA / IB / Cambridge / AICE / ICFES | DEFERRED (content population; the core only needs configuration) |
| Retire `evidence-bridge.service`, `verifyParentAccess`, the parent-request flow, legacy exam-readiness | NON_BLOCKING (cleanup inside the tracks) |

## 17. Track A contract (Roles E2E)

All work packages reuse §13. Schema changes: none expected, except an optional seat model.

| WP | Scope and reuse | Functional acceptance | Security acceptance | Gate |
|---|---|---|---|---|
| **A1 Identity / single persona** (PA-01) | `/role-select` (first-time choice + account page), persona indicator, `assignSelfServiceRole` (single persona), workspace APIs; migrate the 25 `getOrCreateStudentId` sites to `requireStudentId` | Choose one persona once; capabilities by route; revoked persona explained; no "add another role" | Revoked role never re-granted; privileged roles never self-service | Scenarios S1 / S2 in hosted DEV |
| **A2 Parent E2E** | Invitations, `isActiveParentOf`, parent read model; retire `verifyParentAccess` | Invite → accept → child dashboard → revoke | Parent A ↛ child B; pending gets nothing; no write permission | Matrix rows P1–P4 |
| **A3 Teacher E2E** | Membership request and decision, `canTeacherAccessLearner`, teacher read model, `teacher_interventions` (incl. EXAM) | Request → approval → classes → assign → learner executes | Teacher ↛ other class or institution; never writes cognition | Matrix rows T1–T4 |
| **A4 Institution E2E** | Admin invite, memberships console, grades / classes / enrollments **create APIs (new)** via `createGrade` / `createClass` / `enrollStudent` behind `canAccessInstitution`, F12 intelligence | Set up institution → approve teacher → roster → reports | Inst A ↛ Inst B; cohort suppression | Matrix rows I1–I4 |
| **A5 Integrated flow** | One person as Student + Parent + Teacher | Switch without stale data; one identity | No cross-workspace leakage | Real multi-account smoke |
| **A6 Roles DEV certification** | `foundation-scenarios.ts` extended, full suite | All green | Full matrix | Exact SHA |

## 18. Track B contract (Exam Core and verticals)

| WP | Exists | Extend | Must not duplicate | Acceptance / gates |
|---|---|---|---|---|
| **B1 Exam Core** | F7 / F9 tables, attempt services, readiness | Execute `scoring_models` (type + config, weights) in the score summary; RETIRE transitions; scoring-model admin API; use the `approved_items` bank in item resolution | Attempt, response or evidence tables | Scores reproducible from the frozen configuration; idempotent responses |
| **B2 Configuration layer** | definition / version / components / blueprint / command terms / policies | `exam_family` enum, session or year, admin build APIs for components and blueprints | Per-vertical tables | A vertical is configured with no code fork |
| **B3 PAA** | Pilot catalog (College Board → PAA Mathematics) | Fix seed mislabel (PAA ≠ ICFES); calibration via `score_conversion_models` | — | Honest "no calibration" until data exists |
| **B4 PISA** | — | ASSESSMENT_FRAMEWORK programme + domains + proficiency-level scoring model | — | Configuration only |
| **B5 IB** | `lib/ib.ts`, student academic profile, command terms | Papers as components, MARK_SCHEME / RUBRIC scoring, IB command-term interpretations (F8) | — | Configuration only |
| **B6 Cambridge** | Seed IGCSE definition (MARK_SCHEME) | Qualification layer (IGCSE / AS / A Level), papers and tiers | — | Configuration only |
| **B7 AICE** | — | A Cambridge **qualification** configuration (diploma = group of Cambridge subjects), not a separate engine | Cambridge structures | Configuration only |
| **B8 ICFES / Saber** | — | ADMISSION_EXAM programme, Saber areas as components, its own scoring model | — | Configuration only |
| **B9 Exam Prep UX** | F14 exam-prep pages, ItemRunner | Vertical-aware labels, results | Student learning UX | No raw codes; a11y |
| **B10 Simulation / results** | `next-item` (server-held), completion, diagnosis, readiness | Per-section timing and navigation from `navigation_rules`, results reporting | The forgeable `/responses` path (retired, F1) | Integrity: no client-supplied answer keys |
| **B11 Exams DEV certification** | `foundation-scenarios.ts` S5 / S6 | Per-vertical scenarios | — | Exact SHA |

**Scoring and integrity contract for all of Track B:**
- Grade only server-held items.
- An attempt is bound to a PUBLISHED version of the profile's definition.
- Every write is owner-only.
- Evidence is written only via `updateMastery` with `EXAM_SIMULATION_RESPONSE` identity, telemetry `NONE`, and an owner concept.
- The result never writes mastery directly.

**Vertical compatibility (architecture mapping only — no official specifications are asserted):**

| Vertical | Definition | Sections | Blueprint | Command terms | Scoring | Timing | Special policy | Core extension |
|---|---|---|---|---|---|---|---|---|
| PAA | `exam_definitions` (ADMISSION_EXAM) | components | LO targets | optional | BINARY + conversion model | per component | calibration required for projection | none (seed fix) |
| PISA | ASSESSMENT_FRAMEWORK | domains as components | LO targets | — | proficiency scale via config | per component | no individual high-stakes score | scoring-model execution (B1) |
| IB | CURRICULUM / qualification | papers | LO + command term | IB set (F8 interpretations) | MARK_SCHEME / RUBRIC | per paper | HL / SL subject level | none beyond B1 |
| Cambridge | qualification layer | papers / tiers | LO targets | Cambridge set | MARK_SCHEME / MULTI_PART | per paper | tiers | none beyond B1 |
| AICE | Cambridge qualification config | (Cambridge papers) | (Cambridge) | (Cambridge) | (Cambridge) | (Cambridge) | diploma = subject group | configuration only |
| ICFES / Saber | ADMISSION_EXAM | areas | LO targets | optional | config scale | per session | session or year | session column (B2) |

## 19. Risks

| Risk | Status / mitigation |
|---|---|
| 25 Student routes still call `getOrCreateStudentId` directly | Creation is now role-gated (F7). Migrating them to `requireStudentId` is A1. |
| Simulation items are AI-generated, not drawn from the approved bank | B1 / B10 |
| `scoring_models.config` not executed (unweighted raw sum) | B1 |
| F11c4 teacher exam execution is not fully transactional (attempt may orphan on rollback) | A3 / B10 |
| `/api/learning/record-evidence` accepts a free-text `sourceType` (owner-only now) | Add a source-type CHECK in a track migration |
| Clerk session claims still present in `verifyAuth().role` | They no longer grant anything (F2). Remove in A1. |

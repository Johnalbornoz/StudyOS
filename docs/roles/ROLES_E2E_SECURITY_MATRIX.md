# Roles E2E (Track A) — Security Matrix

**Model.** Default-deny. Every protected object is resolved per request to its owner or tenant, then checked once.

**What never grants access:**
- a session claim
- the selected workspace
- a URL / path id
- a pending relationship, request or enrollment

**How it was proven.** Real HTTP against hosted DEV at `ab6e558` (and locally), using real Clerk DEV sessions for 9 test identities. Each case was run as the actor shown. Spoofed ids are real ids belonging to another tenant or learner.

Proof ids are the check names in `scripts/operations/track-a-e2e-http.ts`. Unit coverage is in `tests/unit/track-a-*.test.ts`.

## Required DENY cases

| # | Attempt | Expected | Observed (hosted DEV) | Proof |
|---|---|---|---|---|
| D1 | Parent A → Student B (read model + legacy overview) | DENY | 403 / 403 | `SEC.parentA-not-studentB`, `SEC.parentA-not-studentB-legacy` |
| D2 | Parent with a **pending** request → Student protected data | DENY | 403. Not listed. Not in the children list. | `A2.pending-no-overview`, `A2.pending-no-legacy-overview`, `A2.pending-not-listed`, `A2.pending-not-in-children` |
| D3 | Declined / revoked parent → Student | DENY | 403 | `A2.declined-no-access`, `A2.revoked-no-access` |
| D4 | Teacher with **pending** membership → institution student data | DENY | 403 | `SEC.pending-teacher-no-roster`, `SEC.pending-teacher-no-student` |
| D5 | Approved teacher, no scope → any class | DENY | empty class list | `A3.approved-no-scope-no-classes` |
| D6 | Student enrolled **pending** → teacher roster / learner data | DENY | empty roster, 403 | `SEC.pending-enrollment-no-roster`, `SEC.pending-enrollment-no-student` |
| D7 | Teacher A → Class B | DENY | 403 | `SEC.teacherA-not-classB`, `SEC.teacherB-not-classA-assignments`, `SEC.teacherB-cannot-publish-classA` |
| D8 | Teacher A → Institution B | DENY | 403 | `SEC.teacherA-not-instB`, `SEC.teacherA-not-studentB` |
| D9 | Institution A → Institution B (requests, create, roster, intelligence) | DENY | 403 ×4 | `SEC.instA-not-instB-*` |
| D10 | Teacher → direct Student evidence write (valid payload, real concept) | DENY | 403 | `SEC.teacher-no-evidence-write` |
| D11 | Teacher / Parent → submit the Student's practice (the evidence-producing path) | DENY | 403 / 403 | `SEC.teacher-cannot-submit-for-student`, `SEC.parent-cannot-submit-for-student` |
| D12 | Teacher → direct mastery write | DENY (no route exists) | none: 0 non-engine writes; source guard: role modules never write cognitive tables | `DATA.mastery-only-via-engine`, `track-a-source-guards` |
| D13 | Parent → direct Student write (evidence, exam profile) | DENY | 403 / 403 | `SEC.parent-no-evidence-write`, `SEC.parent-no-exam-profile-write` |
| D14 | Spoofed `student_id` (Student B writes evidence for A) | DENY | 403 | `SEC.spoofed-student-id-evidence-write` |
| D15 | Spoofed `institution_id` (Inst A path + Inst B class) | DENY | 404 | `SEC.spoofed-institution-id-classB` |
| D16 | Spoofed `class_id` (teacher scope pointed at Inst B's class; class under Inst B's grade) | DENY | 422 / 422 | `SEC.spoofed-class-id-cross-tenant`, `SEC.class-under-foreign-grade` |
| D17 | Spoofed `membership_id` (Inst B teacher's membership on an Inst A route) | DENY | 404 | `SEC.spoofed-membership-id` |
| D18 | Spoofed `assignment_id`: teacher / parent / other student starts it; other teacher cancels it; other student lists it | DENY | 403 ×4, not listed | `SEC.spoofed-assignment-start-*`, `SEC.teacherB-cannot-cancel`, `SEC.studentB-not-assignment` |
| D19 | Teacher attaches self / other teacher to a class (own or other institution) | DENY | 403 / 403 | `SEC.teacher-cannot-attach-self`, `SEC.teacherB-cannot-attach-to-instA` |
| D20 | Teacher creates an institutional class; teacher self-approves | DENY | 403 / 403 | `SEC.teacher-cannot-create-class`, `SEC.teacher-cannot-self-approve` |
| D21 | Institution admin → per-learner data, or publishes learner work | DENY | 403 / 403 | `SEC.inst-admin-not-learner`, `SEC.inst-admin-cannot-publish` |
| D22 | Another student accepts someone's parent request or class invitation | DENY | 404 / 404 | `A2.other-student-cannot-accept`, `SEC.other-student-cannot-accept-enrollment` |
| D23 | Revoked persona re-entered, or replaced by another persona (self-service, workspace switch, parent request) | DENY | 409 ROLE_REVOKED / 409 PERSONA_EXISTS / 403 / 403 | `A1.revoked-*`, `A1.revoked-persona-blocks-other` |
| D23b | Second persona by self-service (PA-01): Student→Parent, Student→Teacher, Parent→Student, Parent→Teacher, Teacher→Student, Teacher→Parent | DENY | 409 ×6, 0 rows written | `A1.*-cannot-add-*`, `A1.no-role-rows-written` |
| D23c | A capability used to obtain a second persona (StudyUS admin + Student → Parent) | DENY | 409 | `A1.admin-capability-cannot-add-persona` |
| D23d | Switch into a persona the account does not hold | DENY | 403 | `A1.switch-to-foreign-persona-denied` |
| D24 | Privileged role by self-service (INSTITUTION_ADMIN, STUDYUS_ADMIN) | DENY | 400 / 400 | `A1.privileged-not-self-service*` |
| D25 | Removed student → teacher access | DENY | 403 | `SEC.removed-student-no-teacher-access` |
| D26 | Teacher opens the Student's in-progress activity | DENY | 403 | `SEC.teacher-cannot-open-quiz` |
| D27 | Account-existence oracle via parent request | none | byte-identical response for existing / non-existing email | `A2.no-existence-oracle` |
| D28 | Unauthenticated | DENY | 401 | `A1.unauthenticated-401` |

## Required ALLOW cases

| # | Attempt | Observed | Proof |
|---|---|---|---|
| L1 | Accepted parent → linked Student permitted reads (overview, subjects, activity, attention, exam-prep) | 200 ×5 | `A2.accepted-reads-*` |
| L2 | Approved, scoped teacher → assigned class (roster, learner overview, assignments, publish) | 200 | `A3.roster-has-student`, `A3.teacher-reads-student`, `A5.publish` |
| L3 | Institution admin → own institution (grades, classes, requests, decide, scope, roster) | 200 / 201 | `A4.*` |
| L4 | Student → own assignment and activity (list, start, recover, open, submit) | 200 | `A5.student-*` |

## Identity exposure (manual-gate fix)

| Case | Result | Proof |
|---|---|---|
| StudyUS admin sees the requester of every pending membership (name · email), resolved server-side | ALLOW | `track-a-admin-identity.test.ts` |
| Institution admin sees requester identities of ITS OWN institution only; the route gate (`canAccessInstitution`) runs before any read | DENY for other institutions | `track-a-admin-identity.test.ts`, D9 |
| Identity never taken from the client | — | resolved from `institution_memberships.user_id` |

## Writes

**Unauthorized writes: 0.**
- Fixture students other than the one that practised have 0 `learning_evidence` and 0 mastery rows.
- All evidence came from the Student's own submission through `updateMastery` (`DATA.*`).
- A failed AI generation writes nothing (`A5.generation-retry-1-wrote-nothing`, observed on hosted DEV).

## Entitlements

Role, subscription and entitlement stay separate.
- A Parent with no licence sees the full summary.
- The demo-licence banner on the Student is the unchanged Student entitlement rule.
- No role module imports entitlements.

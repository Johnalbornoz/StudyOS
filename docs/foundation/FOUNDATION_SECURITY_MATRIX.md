# Foundation Security Matrix

- **Default-deny.** Every protected object resolves its owner or tenant per request and calls one canonical check.
- **What never grants access:** a session claim, workspace selection, or the mere existence of a UUID.
- **Where it was proven:** `REAL` rows ran against real services and the real DEV DB (`scripts/operations/foundation-scenarios.ts`). `UNIT` rows are covered by `tests/unit/foundation-shared-invariants.test.ts` plus the existing F2 / F7 / F9 / F11 / F12 suites.

## 1. Entity ownership

| Entity | Owner | Authorized readers | Authorized writers | Tenant key | Check |
|---|---|---|---|---|---|
| Student (learning data) | the learner (`students.user_id`) | owner; accepted parent; scoped teacher | owner only | `student_id` | `canAccessLearner`, `verifyStudentAccess` (owner-only) |
| Parent relationship | student (consent) | the student; the parent | student invites or revokes; parent accepts or declines (verified email) | `student_id` + `parent_id` | `isActiveParentOf` (accepted only) |
| Institution | institution | its approved admins; StudyUS admin | StudyUS admin (create); its admins | `institution_id` | `canAccessInstitution` |
| Membership | institution | the member; that institution's admins | member (request); that institution's admin (decide / revoke) | `institution_id` | `canAccessInstitution` + membership ∈ institution |
| Grade / class | institution | its admins; teachers with an active assignment there | its admins | `institution_id` | `canAccessClass`, `requireClassInInstitution` |
| Enrollment | institution | its admins; assigned teachers | its admins | `class.institution_id` | `requireLearnerInInstitution` |
| Teacher assignment (scope) | institution | its admins; the teacher | its admins; grade or class must be in the same institution (F3) | `institution_id` | `createTeacherAssignment` guarded INSERT |
| Assignment (`teacher_interventions`) | institution / teacher | the learner; the assigning teacher (scoped) | teacher (assign / cancel, scoped); learner (execute) | learner + class scope | `canTeacherManageIntervention`, `isOwner` |
| Exam definition / version | StudyUS catalog | everyone (PUBLISHED / ACTIVE only) | StudyUS admin | — | `requireStudyUSAdmin`; `listAvailableExamOptions` |
| Exam profile | learner | owner; parent; teacher (VIEW) | owner only (F4) | `student_id` | `canAccessLearner(…INTERVENTION_CREATE)` on POST |
| Exam / simulation attempt | learner | owner; parent; teacher (PROGRESS_VIEW) | owner only | `attempt.studentId` | `canAccessLearner(…, attempt.studentId, …)`, `isOwner` (`next-item`); PUBLISHED version of the profile's exam (F5) |
| Result / readiness snapshot | learner | owner; parent; teacher | system (attempt completion) | `student_id` + `exam_profile_id` | `isExamProfileOwnedByStudent` |
| Evidence (`learning_evidence`) | learner | owner (via engine read models) | **`updateMastery` only**, invoked for the owner | `student_id` + `operation_key` | owner-only guards; idempotency key |
| Learning state (mastery / knowledge / memory / transfer) | learner | owner; parent / teacher via read models | Learning Engine projectors only | `student_id` | no non-engine writer (source guards) |

## 2. Authorization matrix (expected / observed)

| # | Attempt | Expected | Observed | Proof |
|---|---|---|---|---|
| S1 | Student A → Student B data | DENY | DENY | REAL `S3.student-B-not-A` |
| P1 | Parent with a *pending* invitation → child | DENY | DENY | REAL `S3.pending-no-access` |
| P2 | Wrong email accepting an invitation | DENY | DENY | REAL `S3.wrong-email-cannot-accept` |
| P3 | Accepted parent → own child (read) | ALLOW | ALLOW | REAL `S3.accepted-reads-A` |
| P4 | Accepted parent → own child (write / start) | DENY | DENY | REAL `S3.parent-cannot-write-A` |
| P5 | Parent A → Student B | DENY | DENY | REAL `S3.parent-A-not-B` |
| T1 | Teacher with PENDING membership → learner | DENY | DENY | REAL `S4.pending-no-access` |
| T2 | Approved teacher, no assignment → learner | DENY | DENY | REAL `S4.approved-no-assignment-no-access` |
| T3 | Teacher → learner in own assigned class | ALLOW (read) | ALLOW | REAL `S4.authorized-class-A` |
| T4 | Teacher → learner outside the class (other institution) | DENY | DENY | REAL `S4.not-student-outside-class` |
| T5 | Teacher → Class B / Institution B | DENY | DENY | REAL `S4.class-A-yes-class-B-no`, `S4.teacher-not-inst-B` |
| T6 | Teacher writes evidence for a taught learner (`record-evidence` guard) | DENY | DENY | REAL `S4.teacher-cannot-write-evidence` (was ALLOW before F2) |
| T7 | Teacher starts an attempt or activity for a learner | DENY | DENY | REAL `S4.teacher-cannot-start-for-learner` |
| I1 | Institution A admin → Institution B | DENY | DENY | REAL `S4.inst-A-not-inst-B` |
| I2 | Institution admin → per-learner data directly | DENY | DENY | REAL `S4.inst-admin-no-learner-access` |
| I3 | Spoofed `institution_id`: teacher scope pointed at Inst B's class / grade | DENY | DENY | REAL `S4.cross-tenant-assignment-refused`, `S4.cross-tenant-grade-refused`, `S4.no-cross-rows` |
| I4 | Membership id of Inst B used on Inst A route | DENY (404) | DENY | existing route check (`belongs`) + F2 tests |
| E1 | Student B → Student A's exam profile | DENY | DENY | REAL `S5.profile-not-B` |
| E2 | Student B read / write / submit Student A's attempt (spoofed `attempt_id`) | DENY | DENY | REAL `S5.B-cannot-act-on-A-attempt`; UNIT 15+16 (every attempt route) |
| E3 | Attempt on a DRAFT / other-exam version | DENY (409) | DENY | REAL `S5.draft-not-startable`, `S5.other-exam-not-startable`; UNIT f9 route test |
| E4 | Client-supplied question / answer key graded | DENY (410) | DENY | UNIT 17+18 (route retired) |
| E5 | Spoofed `student_id` on evidence-writing routes (student / teacher / session-admin / parent) | DENY | DENY ×4 | REAL `S6.spoofed-evidence-writers-refused` |
| E6 | Exam layer writes mastery directly | impossible | none | UNIT 18b + f7 / f9 non-interference guards; REAL `S6.no-cognitive-writes` |
| R1 | Self-service re-grant of a REVOKED role | DENY (409) | DENY | REAL `S1.revoked-not-regranted` |
| R2 | Non-STUDENT identity silently provisioned as Student | DENY | DENY | REAL `S1.no-silent-student` |
| R3 | Session-claim `admin` reading another learner's data | DENY | DENY | REAL `S2.admin-not-owner-of-others` (was ALLOW before F2) |
| A1 | Owner → own data, own attempt, own profile | ALLOW | ALLOW | REAL `S2.owner-still-owner`, `S5.A-owns-A`, `S5.profile-owned-by-A` |

**Unauthorized writes observed: 0.**
- No evidence or mastery rows exist for the scenario learners.
- No cross-tenant `teacher_assignments` rows.
- All fixtures were removed afterwards (`CLEANUP.no-fixtures-left`).

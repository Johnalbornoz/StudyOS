/**
 * F2 -- the fixed permission vocabulary. Deliberately small (see
 * F2_PERMISSION_MATRIX.md for what each one means and what remains
 * deferred to F10/F11/F12) -- this is not a general-purpose RBAC
 * platform, it is the minimum set F2 needs to exist so later phases
 * extend it rather than hardcode role checks throughout the app.
 *
 * L10 SF-4 adds the three learner-data scopes of the D-1 visibility ruling:
 *
 *  - LEARNER_GAPS_VIEW               per-learner gaps (what needs attention).
 *  - LEARNER_ASSESSMENT_SUMMARY_VIEW a RELEASED assessment result as a
 *                                    summary: scores, sections, objectives.
 *                                    Never the questions or the answers.
 *  - LEARNER_ASSESSMENT_DETAIL_VIEW  raw item-level detail: each question,
 *                                    the learner's own response, the key.
 */
export type LearnerPermission =
  | 'LEARNER_PROGRESS_VIEW'
  | 'LEARNER_PROFILE_VIEW'
  | 'LEARNER_INTERVENTION_CREATE'
  | 'LEARNER_GAPS_VIEW'
  | 'LEARNER_ASSESSMENT_SUMMARY_VIEW'
  | 'LEARNER_ASSESSMENT_DETAIL_VIEW';

/** The relationship through which an actor reaches a learner. */
export type LearnerRelationship = 'OWNER' | 'PARENT' | 'TEACHER' | 'COORDINATOR';

/**
 * L10 SF-4 -- THE documented read scope per relationship (D-1 ruling,
 * 2026-10-11). `canAccessLearner` and `resolveLearnerReadScope` are the only
 * readers; no route or read model keeps a second copy of this table.
 *
 *  STUDENT (OWNER)  own data, everything.
 *  PARENT           linked child only: progress, gaps, released assessment
 *                   summaries. No raw item-level answers.
 *  TEACHER          students of the classes the teacher is authorized for:
 *                   per-student gaps and the assessment detail teaching
 *                   needs. The permission below is necessary, NOT
 *                   sufficient (D-1 final ruling, L10-R1): item-level
 *                   detail is returned to a Teacher only for data inside
 *                   the academic subject of an authorized class the learner
 *                   is enrolled in, and only for a submitted attempt -- see
 *                   ./learner-data-scope and ./teacher-exam-scope. Data
 *                   that cannot be attributed to that subject is withheld.
 *  COORDINATOR      learners enrolled in the coordinator's own ACTIVE
 *                   institution: gaps and released results as summaries.
 *                   No raw item-level attempt detail. NOT granted
 *                   LEARNER_PROGRESS_VIEW / LEARNER_PROFILE_VIEW (ruled,
 *                   L10-R1): the eleven older whole-learner routes behind
 *                   those two stay closed to coordinators until an
 *                   institution-scoped payload has been reviewed;
 *                   coordinators use the explicit Institution read models.
 *
 * "Released" (ruled, L10-R1): a Parent or Coordinator sees a result only
 * when that same result is visible to the Student under the assessment's own
 * publication rules -- see `isAttemptResultVisibleToStudent`.
 *
 * LEARNER_INTERVENTION_CREATE (acting inside the learner's own work) is
 * the owner's alone.
 */
export const LEARNER_READ_SCOPE: Readonly<Record<LearnerRelationship, readonly LearnerPermission[]>> = {
  OWNER: [
    'LEARNER_PROGRESS_VIEW',
    'LEARNER_PROFILE_VIEW',
    'LEARNER_INTERVENTION_CREATE',
    'LEARNER_GAPS_VIEW',
    'LEARNER_ASSESSMENT_SUMMARY_VIEW',
    'LEARNER_ASSESSMENT_DETAIL_VIEW',
  ],
  PARENT: ['LEARNER_PROGRESS_VIEW', 'LEARNER_PROFILE_VIEW', 'LEARNER_GAPS_VIEW', 'LEARNER_ASSESSMENT_SUMMARY_VIEW'],
  TEACHER: [
    'LEARNER_PROGRESS_VIEW',
    'LEARNER_PROFILE_VIEW',
    'LEARNER_GAPS_VIEW',
    'LEARNER_ASSESSMENT_SUMMARY_VIEW',
    'LEARNER_ASSESSMENT_DETAIL_VIEW',
  ],
  COORDINATOR: ['LEARNER_GAPS_VIEW', 'LEARNER_ASSESSMENT_SUMMARY_VIEW'],
};

/**
 * Institution-scoped permissions. Until L10 SF-4 the guards ignored this
 * argument; they now honour it (see INSTITUTION_ADMIN_PERMISSIONS and
 * TEACHER_CLASS_PERMISSIONS).
 */
export type InstitutionPermission = 'INSTITUTION_MEMBER_APPROVE' | 'TEACHER_ASSIGNMENT_MANAGE' | 'INSTITUTION_INTELLIGENCE_VIEW';

/**
 * What an APPROVED INSTITUTION_ADMIN of an ACTIVE institution holds. There
 * are no coordinator tiers (none was adopted), so today this is every
 * institution permission -- but it is now an explicit, closed grant: a value
 * outside this list is refused instead of silently passing.
 */
export const INSTITUTION_ADMIN_PERMISSIONS: readonly InstitutionPermission[] = ['INSTITUTION_MEMBER_APPROVE', 'TEACHER_ASSIGNMENT_MANAGE', 'INSTITUTION_INTELLIGENCE_VIEW'];

/**
 * What a class TEACHER holds on their own class through `canAccessClass`
 * (publishing work to the class). A teacher never approves members and never
 * reads institution intelligence.
 */
export const TEACHER_CLASS_PERMISSIONS: readonly InstitutionPermission[] = ['TEACHER_ASSIGNMENT_MANAGE'];

/**
 * F11-B -- deliberately its OWN type, never added to LearnerPermission.
 * LearnerPermission is exactly what canAccessLearner composes over
 * (Owner/Parent/Teacher treated as equivalent); adding a
 * Teacher-intervention permission there would let a Parent or Owner
 * relationship satisfy it through that generic composition -- the
 * exact class of bug found in F10 and deliberately avoided from the
 * start in F11-A. Teacher Interventions are gated exclusively through
 * canTeacherManageIntervention, which never composes with Parent/Owner.
 */
export type TeacherInterventionPermission = 'TEACHER_INTERVENTION_VIEW' | 'TEACHER_INTERVENTION_ASSIGN' | 'TEACHER_INTERVENTION_CANCEL';

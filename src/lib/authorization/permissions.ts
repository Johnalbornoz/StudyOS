/**
 * F2 -- the fixed permission vocabulary. Deliberately small (see
 * F2_PERMISSION_MATRIX.md for what each one means and what remains
 * deferred to F10/F11/F12) -- this is not a general-purpose RBAC
 * platform, it is the minimum set F2 needs to exist so later phases
 * extend it rather than hardcode role checks throughout the app.
 */
export type LearnerPermission = 'LEARNER_PROGRESS_VIEW' | 'LEARNER_PROFILE_VIEW' | 'LEARNER_INTERVENTION_CREATE';
/** F12 adds INSTITUTION_INTELLIGENCE_VIEW for call-site clarity only -- canAccessInstitution/canAccessClass's actual check (an APPROVED INSTITUTION_ADMIN membership, or for canAccessClass an ACTIVE TEACHER assignment) is unchanged and does not branch on this value, mirroring TeacherInterventionPermission's own precedent. */
export type InstitutionPermission = 'INSTITUTION_MEMBER_APPROVE' | 'TEACHER_ASSIGNMENT_MANAGE' | 'INSTITUTION_INTELLIGENCE_VIEW';

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

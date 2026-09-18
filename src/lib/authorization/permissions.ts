/**
 * F2 -- the fixed permission vocabulary. Deliberately small (see
 * F2_PERMISSION_MATRIX.md for what each one means and what remains
 * deferred to F10/F11/F12) -- this is not a general-purpose RBAC
 * platform, it is the minimum set F2 needs to exist so later phases
 * extend it rather than hardcode role checks throughout the app.
 */
export type LearnerPermission = 'LEARNER_PROGRESS_VIEW' | 'LEARNER_PROFILE_VIEW' | 'LEARNER_INTERVENTION_CREATE';
export type InstitutionPermission = 'INSTITUTION_MEMBER_APPROVE' | 'TEACHER_ASSIGNMENT_MANAGE';

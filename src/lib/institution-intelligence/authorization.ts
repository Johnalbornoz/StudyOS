/**
 * F12 -- Institution Intelligence authorization. Every read entry point
 * in this module resolves authorization SERVER-SIDE, from the actor's
 * own canonical identity -- never from a client-supplied institutionId
 * alone (INV-F12-01/02/03, task section 6). This file introduces NO new
 * authorization primitive: it composes F2's own, already-certified
 * `canAccessInstitution`/`canAccessClass` unchanged (INV-F12-22). An
 * "Institution role" (an APPROVED INSTITUTION_ADMIN membership) alone
 * proves identity, never access by itself -- `canAccessInstitution`
 * already encodes the real requirement (active, APPROVED membership to
 * THIS exact institution), and this module never substitutes a weaker
 * check.
 */
import { db } from '@/lib/db';
import { canAccessInstitution, canAccessClass } from '@/lib/authorization';

export class InstitutionIntelligenceAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstitutionIntelligenceAccessDeniedError';
  }
}

/**
 * The ONLY institution-wide gate. Reuses F2's `canAccessInstitution`
 * (APPROVED INSTITUTION_ADMIN membership to this EXACT institution)
 * unchanged -- never the generic composed learner-access check, never
 * inferred from any other role. A revoked or merely-requested
 * membership fails this exactly as it fails F2's own certified
 * behavior (INV-F12-01/02).
 */
export async function requireInstitutionAccess(actorUserId: string, institutionId: string): Promise<void> {
  const allowed = await canAccessInstitution(actorUserId, institutionId, 'INSTITUTION_INTELLIGENCE_VIEW');
  if (!allowed) {
    throw new InstitutionIntelligenceAccessDeniedError(`actor is not an approved INSTITUTION_ADMIN of institution ${institutionId}`);
  }
}

/**
 * A child scope (grade/class) is authorized only when it ACTUALLY
 * belongs to the institution the actor is authorized for -- never
 * inferred from the id alone (task section 8's own worked example:
 * "Institution A admin -> Class in Institution B = DENY"). Filters
 * narrow data; they never grant access (task section 28) -- this
 * function is the enforcement point for that rule whenever a
 * class/grade id arrives as a filter.
 */
export async function requireClassInInstitution(actorUserId: string, institutionId: string, classId: string): Promise<void> {
  await requireInstitutionAccess(actorUserId, institutionId);
  const classRow = await db.query(`SELECT institution_id FROM classes WHERE id = $1`, [classId]);
  if (classRow.rows.length === 0 || classRow.rows[0].institution_id !== institutionId) {
    throw new InstitutionIntelligenceAccessDeniedError(`class ${classId} does not belong to institution ${institutionId}`);
  }
  // canAccessClass is re-verified too (defense in depth, matching this
  // codebase's convention of never trusting a single check alone for a
  // security-relevant boundary) -- an institution admin already passes
  // it by definition once the institution match above holds, but a
  // TEACHER actor calling institution-scoped class summaries (if ever
  // extended) would need this to hold independently.
  const canAccess = await canAccessClass(actorUserId, classId, 'INSTITUTION_INTELLIGENCE_VIEW');
  if (!canAccess) {
    throw new InstitutionIntelligenceAccessDeniedError(`actor cannot access class ${classId}`);
  }
}

/**
 * Learner drill-down (task section 25): server verifies the learner
 * belongs to an ACTIVE enrollment in a class within the authorized
 * institution -- never inferred merely from knowing a learnerId. A
 * learner with no active enrollment anywhere in this institution (e.g.
 * enrolled only elsewhere, or their enrollment ended) is denied even if
 * the raw student row exists.
 */
export async function requireLearnerInInstitution(actorUserId: string, institutionId: string, studentId: string): Promise<void> {
  await requireInstitutionAccess(actorUserId, institutionId);
  const enrollment = await db.query(
    `
    SELECT 1 FROM class_enrollments ce
    JOIN classes c ON c.id = ce.class_id
    WHERE ce.student_id = $1 AND c.institution_id = $2 AND ce.status = 'ACTIVE'
    LIMIT 1
    `,
    [studentId, institutionId]
  );
  if (enrollment.rows.length === 0) {
    throw new InstitutionIntelligenceAccessDeniedError(`student ${studentId} has no ACTIVE enrollment in institution ${institutionId}`);
  }
}

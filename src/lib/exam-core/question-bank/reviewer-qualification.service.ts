/**
 * QB-R1A -- reviewer qualifications: who may approve Question Bank content (governance, not convenience).
 *
 * An approving review needs a reviewer who is a person, is not the author, and holds a qualification valid at
 * the time of the review for the item's canonical subject AND exam family. The database enforces that rule
 * when the review is recorded (migration 20261110_1500); this module is the application side of the same rule:
 *
 *   - `resolveReviewScope`            what subject(s) and exam family an item version is reviewed under
 *   - `requireReviewerQualification`  the typed refusal an approval gets BEFORE anything is written
 *   - `grantReviewerQualification`    the one way a qualification comes to exist: an explicit grant
 *   - `revokeReviewerQualification`   the one way it ends early
 *
 * What does not exist, on purpose: a wildcard (all subjects, all exams), an automatic or implied grant, a
 * qualification derived from a platform role, from another subject or from another exam family, an override
 * for administrators, and a legacy exemption. A person may hold several explicit qualifications.
 *
 * Every write takes the caller's executor and belongs to the caller's transaction.
 */
import type { DbExecutor } from '@/lib/db';

export type QualificationRefusal =
  | 'REVIEWER_NOT_FOUND'
  | 'REVIEWER_IS_SYSTEM_ACCOUNT'
  | 'REVIEWER_NOT_ACTIVE'
  | 'REVIEW_SCOPE_UNDETERMINED'
  | 'REVIEWER_NOT_QUALIFIED'
  | 'GRANTOR_NOT_FOUND'
  | 'GRANTOR_IS_SYSTEM_ACCOUNT'
  | 'GRANTOR_NOT_AUTHORIZED'
  | 'SELF_GRANT'
  | 'SUBJECT_NOT_FOUND'
  | 'EXAM_FAMILY_NOT_FOUND'
  | 'WILDCARD_NOT_ALLOWED'
  | 'VALIDITY_INVALID'
  | 'QUALIFICATION_ALREADY_HELD'
  | 'QUALIFICATION_NOT_FOUND'
  | 'QUALIFICATION_ALREADY_REVOKED'
  | 'REVOKE_REASON_REQUIRED';

export class ReviewerQualificationError extends Error {
  constructor(public readonly code: QualificationRefusal, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ReviewerQualificationError';
  }
}

/** The platform role whose holder may grant or revoke a qualification. Holding it is not a qualification. */
export const QUALIFICATION_GRANT_AUTHORITY_ROLE = 'STUDYUS_ADMIN' as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Values a caller might pass hoping for "everything". None of them is a subject or an exam family. */
const WILDCARDS = new Set(['*', 'ALL', 'ANY', 'ALL_SUBJECTS', 'ALL_EXAMS', 'ALL SUBJECTS', 'ALL EXAMS', '%']);
const isWildcard = (v: string): boolean => WILDCARDS.has(v.trim().toUpperCase());

export interface ReviewScope {
  examFamily: string | null;
  /** Canonical subjects the version may be reviewed under: its PRIMARY concept's, else its objective's published mappings'. */
  canonicalSubjectIds: string[];
  basis: 'PRIMARY_CONCEPT' | 'OBJECTIVE_MAPPING' | 'NONE';
  authorUserId: string;
}

/** Same derivation as the database rule: nothing is guessed, and an item with no subject has no scope. */
export async function resolveReviewScope(client: DbExecutor, approvedItemId: string): Promise<ReviewScope | null> {
  const item = await client.query(
    `SELECT ai.created_by, ai.learning_objective_id, ed.exam_family
       FROM approved_items ai
       LEFT JOIN question_bank_items qi ON qi.id = ai.bank_item_id
       LEFT JOIN exam_versions ev ON ev.id = qi.exam_version_id
       LEFT JOIN exam_definitions ed ON ed.id = ev.exam_definition_id
      WHERE ai.id = $1`,
    [approvedItemId]
  );
  const row = item.rows[0];
  if (!row) return null;
  const primary = await client.query(
    `SELECT DISTINCT cc.canonical_subject_id AS id FROM question_bank_item_concepts ic JOIN canonical_concepts cc ON cc.id = ic.canonical_concept_id WHERE ic.approved_item_id = $1 AND ic.role = 'PRIMARY' ORDER BY 1`,
    [approvedItemId]
  );
  if (primary.rows.length > 0) return { examFamily: row.exam_family ?? null, canonicalSubjectIds: primary.rows.map((r: any) => r.id as string), basis: 'PRIMARY_CONCEPT', authorUserId: row.created_by };
  const mapped = await client.query(
    `SELECT DISTINCT cc.canonical_subject_id AS id FROM objective_concept_mappings m JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id WHERE m.learning_objective_id = $1 AND m.status = 'PUBLISHED' ORDER BY 1`,
    [row.learning_objective_id]
  );
  const ids = mapped.rows.map((r: any) => r.id as string);
  return { examFamily: row.exam_family ?? null, canonicalSubjectIds: ids, basis: ids.length > 0 ? 'OBJECTIVE_MAPPING' : 'NONE', authorUserId: row.created_by };
}

async function person(client: DbExecutor, userId: string): Promise<{ isSystem: boolean; status: string } | null> {
  const r = await client.query(`SELECT is_system, status FROM users WHERE id = $1`, [userId]);
  return r.rows[0] ? { isSystem: r.rows[0].is_system === true, status: r.rows[0].status } : null;
}

/** Is the reviewer-governance schema present? Environments that have not received migration 20261110_1500 have no qualifications at all. */
export async function reviewerGovernanceActive(client: DbExecutor): Promise<boolean> {
  const r = await client.query(`SELECT to_regclass('public.question_bank_reviewer_qualifications') IS NOT NULL AS ready`);
  return r.rows[0]?.ready === true;
}

/**
 * The qualification under which `reviewerUserId` may approve this item version now. Throws the reason when
 * there is none. It never creates one and has no alternative path: a system account, an administrator
 * without a qualification and an item with no determinable subject are all refused.
 */
export async function requireReviewerQualification(client: DbExecutor, p: { approvedItemId: string; reviewerUserId: string }): Promise<{ qualificationId: string; canonicalSubjectId: string; examFamily: string }> {
  const reviewer = await person(client, p.reviewerUserId);
  if (!reviewer) throw new ReviewerQualificationError('REVIEWER_NOT_FOUND', p.reviewerUserId);
  if (reviewer.isSystem) throw new ReviewerQualificationError('REVIEWER_IS_SYSTEM_ACCOUNT', 'a system account is never a qualified reviewer');
  if (reviewer.status !== 'ACTIVE') throw new ReviewerQualificationError('REVIEWER_NOT_ACTIVE', reviewer.status);
  const scope = await resolveReviewScope(client, p.approvedItemId);
  if (!scope || !scope.examFamily || scope.canonicalSubjectIds.length === 0) {
    throw new ReviewerQualificationError('REVIEW_SCOPE_UNDETERMINED', 'the item has no exam family or no canonical subject (no PRIMARY concept and no published objective mapping); it cannot be approved until that is repaired');
  }
  const q = await client.query(
    `SELECT id, canonical_subject_id FROM question_bank_reviewer_qualifications
      WHERE user_id = $1 AND exam_family = $2 AND canonical_subject_id = ANY($3::uuid[])
        AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now()) AND revoked_at IS NULL
      ORDER BY valid_from, id LIMIT 1`,
    [p.reviewerUserId, scope.examFamily, scope.canonicalSubjectIds]
  );
  if (!q.rows[0]) throw new ReviewerQualificationError('REVIEWER_NOT_QUALIFIED', `no valid qualification for exam family ${scope.examFamily} and the item's canonical subject`);
  return { qualificationId: q.rows[0].id, canonicalSubjectId: q.rows[0].canonical_subject_id, examFamily: scope.examFamily };
}

export interface QualificationGrantInput {
  reviewerUserId: string;
  canonicalSubjectId: string;
  examFamily: string;
  grantedByUserId: string;
  /** ISO timestamp. The grant is explicit about when it starts. */
  validFrom: string;
  validTo?: string | null;
  notes?: string | null;
}

/** Everything a grant must satisfy, checked before the insert. Returns the refusals; empty = the grant may be written. */
export async function grantRefusals(client: DbExecutor, g: QualificationGrantInput): Promise<QualificationRefusal[]> {
  const out: QualificationRefusal[] = [];
  if (isWildcard(g.canonicalSubjectId) || isWildcard(g.examFamily) || !UUID.test(g.canonicalSubjectId)) out.push('WILDCARD_NOT_ALLOWED');
  const from = Date.parse(g.validFrom);
  const to = g.validTo ? Date.parse(g.validTo) : null;
  if (Number.isNaN(from) || (to !== null && (Number.isNaN(to) || to <= from))) out.push('VALIDITY_INVALID');
  if (g.reviewerUserId === g.grantedByUserId) out.push('SELF_GRANT');
  const reviewer = UUID.test(g.reviewerUserId) ? await person(client, g.reviewerUserId) : null;
  if (!reviewer) out.push('REVIEWER_NOT_FOUND');
  else if (reviewer.isSystem) out.push('REVIEWER_IS_SYSTEM_ACCOUNT');
  else if (reviewer.status !== 'ACTIVE') out.push('REVIEWER_NOT_ACTIVE');
  const grantor = UUID.test(g.grantedByUserId) ? await person(client, g.grantedByUserId) : null;
  if (!grantor) out.push('GRANTOR_NOT_FOUND');
  else if (grantor.isSystem) out.push('GRANTOR_IS_SYSTEM_ACCOUNT');
  else {
    const role = await client.query(`SELECT 1 FROM user_roles WHERE user_id = $1 AND role = $2 AND status = 'ACTIVE'`, [g.grantedByUserId, QUALIFICATION_GRANT_AUTHORITY_ROLE]);
    if (role.rows.length === 0 || grantor.status !== 'ACTIVE') out.push('GRANTOR_NOT_AUTHORIZED');
  }
  if (out.includes('WILDCARD_NOT_ALLOWED')) return [...new Set(out)];
  const subject = await client.query(`SELECT 1 FROM canonical_subjects WHERE id = $1 AND status = 'ACTIVE'`, [g.canonicalSubjectId]);
  if (subject.rows.length === 0) out.push('SUBJECT_NOT_FOUND');
  // An exam family is one the catalogue actually has: a typo cannot create a qualification nobody can use.
  const family = await client.query(`SELECT 1 FROM exam_definitions WHERE exam_family = $1 LIMIT 1`, [g.examFamily]);
  if (family.rows.length === 0) out.push('EXAM_FAMILY_NOT_FOUND');
  if (reviewer && !Number.isNaN(from)) {
    const held = await client.query(
      `SELECT 1 FROM question_bank_reviewer_qualifications WHERE user_id = $1 AND canonical_subject_id = $2 AND exam_family = $3 AND revoked_at IS NULL AND (valid_to IS NULL OR valid_to > $4::timestamptz)`,
      [g.reviewerUserId, g.canonicalSubjectId, g.examFamily, g.validFrom]
    );
    if (held.rows.length > 0) out.push('QUALIFICATION_ALREADY_HELD');
  }
  return [...new Set(out)];
}

/** Grants ONE qualification: one person, one canonical subject, one exam family. */
export async function grantReviewerQualification(tx: DbExecutor, g: QualificationGrantInput): Promise<{ qualificationId: string }> {
  const refusals = await grantRefusals(tx, g);
  if (refusals.length > 0) throw new ReviewerQualificationError(refusals[0], refusals.join(','));
  const r = await tx.query(
    `INSERT INTO question_bank_reviewer_qualifications (user_id, canonical_subject_id, exam_family, granted_by, valid_from, valid_to, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [g.reviewerUserId, g.canonicalSubjectId, g.examFamily, g.grantedByUserId, g.validFrom, g.validTo ?? null, g.notes?.trim() || null]
  );
  return { qualificationId: r.rows[0].id };
}

export async function revokeReviewerQualification(tx: DbExecutor, p: { qualificationId: string; revokedByUserId: string; reason: string }): Promise<void> {
  if (p.reason.trim().length < 5) throw new ReviewerQualificationError('REVOKE_REASON_REQUIRED');
  const q = await tx.query(`SELECT revoked_at FROM question_bank_reviewer_qualifications WHERE id = $1`, [p.qualificationId]);
  if (!q.rows[0]) throw new ReviewerQualificationError('QUALIFICATION_NOT_FOUND', p.qualificationId);
  if (q.rows[0].revoked_at) throw new ReviewerQualificationError('QUALIFICATION_ALREADY_REVOKED', p.qualificationId);
  const by = await person(tx, p.revokedByUserId);
  if (!by) throw new ReviewerQualificationError('GRANTOR_NOT_FOUND', p.revokedByUserId);
  if (by.isSystem) throw new ReviewerQualificationError('GRANTOR_IS_SYSTEM_ACCOUNT');
  const role = await tx.query(`SELECT 1 FROM user_roles WHERE user_id = $1 AND role = $2 AND status = 'ACTIVE'`, [p.revokedByUserId, QUALIFICATION_GRANT_AUTHORITY_ROLE]);
  if (role.rows.length === 0 || by.status !== 'ACTIVE') throw new ReviewerQualificationError('GRANTOR_NOT_AUTHORIZED');
  await tx.query(`UPDATE question_bank_reviewer_qualifications SET revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE id = $1`, [p.qualificationId, p.revokedByUserId, p.reason.trim()]);
}

export interface QualificationRow {
  id: string;
  userId: string;
  canonicalSubjectId: string;
  canonicalSubject: string;
  examFamily: string;
  grantedBy: string;
  validFrom: string;
  validTo: string | null;
  revokedAt: string | null;
  inForce: boolean;
}

export async function listReviewerQualifications(client: DbExecutor): Promise<QualificationRow[]> {
  const r = await client.query(
    `SELECT q.id, q.user_id, q.canonical_subject_id, cs.name AS subject, q.exam_family, q.granted_by, q.valid_from, q.valid_to, q.revoked_at,
            (q.valid_from <= now() AND (q.valid_to IS NULL OR q.valid_to > now()) AND q.revoked_at IS NULL) AS in_force
       FROM question_bank_reviewer_qualifications q JOIN canonical_subjects cs ON cs.id = q.canonical_subject_id ORDER BY q.exam_family, cs.name, q.valid_from, q.id`
  );
  const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string).toISOString());
  return (r.rows as any[]).map((x) => ({ id: x.id, userId: x.user_id, canonicalSubjectId: x.canonical_subject_id, canonicalSubject: x.subject, examFamily: x.exam_family, grantedBy: x.granted_by, validFrom: iso(x.valid_from)!, validTo: iso(x.valid_to), revokedAt: iso(x.revoked_at), inForce: x.in_force === true }));
}

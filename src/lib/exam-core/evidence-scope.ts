/**
 * G6 -- the exam evidence scoping contract.
 *
 * Two kinds of evidence live in the same `learning_evidence` table:
 *
 *   LONGITUDINAL LEARNING EVIDENCE   Learning OS activity (study, practice, quizzes -- including the
 *                                    Learning OS "exam_simulation" quiz mode, activity_type 'quiz').
 *                                    It feeds the one Knowledge State per concept and stays valid for
 *                                    every exam, as knowledge.
 *   EXAM-SPECIFIC EVIDENCE           a response inside an exam attempt (practice / diagnostic / mock of
 *                                    a governed exam). It also feeds the Knowledge State (KNOWLEDGE_MASTERY),
 *                                    but it may decide EXAM_REQUIREMENT_SATISFACTION -- readiness, gaps,
 *                                    diagnostic need, blueprint coverage, next action -- ONLY for its own
 *                                    exam target.
 *
 * Identity of exam-specific evidence (captured when the evidence is written, never inferred later):
 *   examTargetId   student_exam_profiles.id of the attempt (exam_attempts.student_exam_profile_id, NOT NULL)
 *   examVersionId  exam_versions.id of the attempt
 *   examAttemptId  exam_attempts.id (the source)
 * The TARGET is the decision key: exam-requirement satisfaction is target-scoped (two targets of the same
 * exam do not complete each other). examVersionId is carried for provenance and version-scoped stats.
 *
 * Where the identity lives on a row (all written at creation time):
 *   - metadata.examScope = { examTargetId, examVersionId, examAttemptId, source: 'EXAM_ATTEMPT' }  (G6 onwards)
 *   - metadata.context.examAttemptId (+ metadata.framework.examVersionId)                          (F9 writer before G6)
 *     -> the target is the attempt's own NOT NULL foreign key: a deterministic join, not a similarity guess.
 *
 * UNSCOPED_LEGACY: an EXAM_SIMULATION row written by an exam-attempt writer that recorded no identity
 * (the F7 evidence bridge: activity_type NULL, no context). It stays in the Knowledge State, but it never
 * satisfies an exam-specific requirement of any target. Nothing is backfilled or rewritten.
 *
 * No exam-family branching; no concept / subject / domain overlap is ever used to decide an exam.
 */

export type EvidenceScope = 'LONGITUDINAL' | 'EXAM_TARGET' | 'OTHER_EXAM_TARGET' | 'UNSCOPED_LEGACY';

export interface ExamEvidenceScopeMetadata {
  examTargetId: string;
  examVersionId: string;
  examAttemptId: string;
  source: 'EXAM_ATTEMPT';
}

const UUID_RE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const isUuid = (v: unknown): v is string => typeof v === 'string' && new RegExp(UUID_RE).test(v);

/** The `metadata.examScope` an exam-attempt evidence row carries. */
export function examEvidenceScopeMetadata(p: { examTargetId: string; examVersionId: string; examAttemptId: string }): ExamEvidenceScopeMetadata {
  return { examTargetId: p.examTargetId, examVersionId: p.examVersionId, examAttemptId: p.examAttemptId, source: 'EXAM_ATTEMPT' };
}

/* ------------------------------------------------------------------ */
/* Pure classification (mirrors the SQL below)                          */
/* ------------------------------------------------------------------ */

export interface EvidenceScopeRow {
  sourceType: string | null;
  activityType: string | null;
  metadata: Record<string, any> | null;
  /** The target of `metadata.context.examAttemptId` as stored on exam_attempts (null when absent / unknown). */
  attemptTargetId?: string | null;
}

/** True when the row was produced inside an exam attempt (with or without a recorded identity). */
export function isExamAttemptEvidence(r: EvidenceScopeRow): boolean {
  const m = r.metadata ?? {};
  if (m.examScope && typeof m.examScope === 'object') return true;
  if (m.context && typeof m.context === 'object' && 'examAttemptId' in m.context) return true;
  return r.sourceType === 'EXAM_SIMULATION' && (r.activityType === null || r.activityType === 'EXAM_SIMULATION');
}

/** The exam target an exam-attempt row belongs to, from its own recorded identity only. */
export function evidenceExamTargetId(r: EvidenceScopeRow): string | null {
  const scoped = r.metadata?.examScope?.examTargetId;
  if (isUuid(scoped)) return scoped;
  return isUuid(r.attemptTargetId) ? r.attemptTargetId : null;
}

export function classifyEvidenceScope(r: EvidenceScopeRow, examTargetId: string): EvidenceScope {
  if (!isExamAttemptEvidence(r)) return 'LONGITUDINAL';
  const target = evidenceExamTargetId(r);
  if (!target) return 'UNSCOPED_LEGACY';
  return target === examTargetId ? 'EXAM_TARGET' : 'OTHER_EXAM_TARGET';
}

/** May this row decide an exam-specific requirement of `examTargetId`? (longitudinal knowledge or its own exam). */
export const isInExamScope = (r: EvidenceScopeRow, examTargetId: string) => {
  const s = classifyEvidenceScope(r, examTargetId);
  return s === 'LONGITUDINAL' || s === 'EXAM_TARGET';
};

/* ------------------------------------------------------------------ */
/* SQL (constants and aliases only; the target is always a bound param) */
/* ------------------------------------------------------------------ */

/** SQL boolean: the learning_evidence row `a` was produced inside an exam attempt. */
export function examAttemptEvidenceSql(a = 'le'): string {
  return `(COALESCE(${a}.metadata ? 'examScope', false) OR COALESCE((${a}.metadata->'context') ? 'examAttemptId', false)`
    + ` OR (${a}.source_type = 'EXAM_SIMULATION' AND (${a}.activity_type IS NULL OR ${a}.activity_type = 'EXAM_SIMULATION')))`;
}

/** SQL uuid (or NULL): the exam target of the row `a`, from its recorded identity only. */
export function evidenceExamTargetSql(a = 'le'): string {
  return `COALESCE(CASE WHEN ${a}.metadata->'examScope'->>'examTargetId' ~ '${UUID_RE}' THEN (${a}.metadata->'examScope'->>'examTargetId')::uuid END,`
    + ` (SELECT es_ea.student_exam_profile_id FROM exam_attempts es_ea WHERE es_ea.id = CASE WHEN ${a}.metadata->'context'->>'examAttemptId' ~ '${UUID_RE}' THEN (${a}.metadata->'context'->>'examAttemptId')::uuid END))`;
}

/**
 * SQL boolean: the row `a` may decide an exam-specific requirement of the target bound at `targetParam`
 * (e.g. '$3'): longitudinal knowledge, or exam evidence of THIS target. Another target's evidence and
 * UNSCOPED_LEGACY exam evidence are excluded.
 */
export function inExamScopeSql(a: string, targetParam: string): string {
  return `(NOT ${examAttemptEvidenceSql(a)} OR COALESCE(${evidenceExamTargetSql(a)} = ${targetParam}::uuid, false))`;
}

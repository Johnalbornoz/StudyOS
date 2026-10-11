/**
 * B5 -- the ONE start authority and the execution-authority rule (IO).
 *
 * EXECUTION AUTHORITY. Every attempt is executed by exactly one engine, and the attempt itself says which:
 *
 *   CANONICAL   its record carries a frozen assessment snapshot (it was started here)
 *   LEGACY      it does not
 *
 * The authority is a property of the record, not of a flag: a flag decides how NEW attempts start, and an
 * attempt keeps the engine it started with for its whole life. That is what makes a rollback safe -- turning
 * the flag off sends new starts to the legacy path and leaves every canonical attempt canonical. The legacy
 * evidence writers ask this module and stand down for a canonical attempt, so the two paths can never both
 * write for the same attempt, whatever their operation keys are.
 *
 * START. `startLearningAssessment` decides "resume or new" in one place:
 *   resume   an active, unexpired canonical session of the same Student for the same intent, depth and
 *            targets -> the same session, the same snapshot, the same questions in the same order
 *   new      Blueprint Core -> freeze -> ONE insert that creates the session already frozen
 * No route selects questions, recomputes a blueprint, regenerates a snapshot or decides an attempt type.
 *
 * It is OFF unless ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED is exactly "true". No route calls it yet.
 */
import { randomUUID } from 'crypto';
import { db, type DbExecutor } from '@/lib/db';
import { QUIZ_SESSION_TTL_MINUTES } from '@/services/quiz-persistence.service';
import { recordBankDeliveries } from '@/services/question-bank.service';
import { solveLearningForStudent, type LearningSelectionRequest } from '@/lib/assessment-blueprint/assessment-blueprint.service';
import { freezeAssessment, readFrozenAssessment, type FrozenAssessment } from './frozen-assessment';
import { learningActivityFor } from './assessment-execution.service';

/** Owner: the assessment runtime adoption (B5). Default OFF in every environment; set per environment, DEV first. */
export const ASSESSMENT_SNAPSHOT_EXECUTION_FLAG = 'ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED' as const;
export const isSnapshotExecutionEnabled = (): boolean => process.env[ASSESSMENT_SNAPSHOT_EXECUTION_FLAG] === 'true';

export type ExecutionAuthority = 'LEGACY' | 'CANONICAL';

/** Postgres "undefined column": the snapshot migration is not applied here, so no canonical attempt can exist. */
const isMissingSnapshotColumn = (e: unknown): boolean => (e as { code?: string } | null)?.code === '42703';

export async function executionAuthorityOfQuizSession(quizSessionId: string, client: DbExecutor = db): Promise<ExecutionAuthority> {
  try {
    const r = await client.query(`SELECT 1 FROM quiz_sessions WHERE id = $1 AND assessment_snapshot IS NOT NULL`, [quizSessionId]);
    return r.rows.length > 0 ? 'CANONICAL' : 'LEGACY';
  } catch (e) {
    if (isMissingSnapshotColumn(e)) return 'LEGACY';
    throw e;
  }
}

/** The authority of an exam attempt: its instance's, reached through the attempt's own simulation attempt. */
export async function executionAuthorityOfExamAttempt(examAttemptId: string, client: DbExecutor = db): Promise<ExecutionAuthority> {
  try {
    const r = await client.query(
      `SELECT 1 FROM exam_instances ei JOIN simulation_attempts sa ON sa.id = ei.simulation_attempt_id WHERE sa.exam_attempt_id = $1 AND ei.assessment_snapshot IS NOT NULL`,
      [examAttemptId]
    );
    return r.rows.length > 0 ? 'CANONICAL' : 'LEGACY';
  } catch (e) {
    if (isMissingSnapshotColumn(e)) return 'LEGACY';
    throw e;
  }
}

export interface StartLearningInput {
  studentId: string;
  request: Omit<LearningSelectionRequest, 'asOf'>;
  /** Explicit "now" (ISO): the evidence projection and the snapshot are stamped with it. */
  asOf: string;
  language?: string;
}

export type StartRefusal = 'DISABLED' | 'CONTEXT_UNAVAILABLE' | 'NOT_STARTABLE' | 'CONTENT_UNAVAILABLE' | 'SUBJECT_UNRESOLVED';

export type StartResult =
  | { ok: true; resumed: boolean; record: { kind: 'QUIZ_SESSION'; id: string }; snapshotId: string; questions: number; executionAuthority: 'CANONICAL' }
  | { ok: false; reason: StartRefusal };

export interface StartDeps {
  solve: typeof solveLearningForStudent;
  enabled: () => boolean;
  log?: (event: Record<string, unknown>) => void;
}

const sameTargets = (frozen: FrozenAssessment, intent: string, depth: string, canonicalConceptIds: readonly string[]) =>
  frozen.intent === intent && frozen.depth === depth && JSON.stringify(frozen.targets.canonicalConceptIds) === JSON.stringify([...new Set(canonicalConceptIds)].sort());

export async function startLearningAssessment(input: StartLearningInput, overrides: Partial<StartDeps> = {}): Promise<StartResult> {
  const deps: StartDeps = { solve: solveLearningForStudent, enabled: isSnapshotExecutionEnabled, ...overrides };
  const log = deps.log ?? ((event) => console.info('[b5-assessment-start]', JSON.stringify(event)));
  if (!deps.enabled()) return { ok: false, reason: 'DISABLED' };

  /* ---- resume: an open canonical session for the same request is the same assessment ---- */
  const wanted = [...new Set(input.request.canonicalConceptIds ?? [])].sort();
  if (wanted.length > 0) {
    const open = await db.query(
      `SELECT id, assessment_snapshot FROM quiz_sessions
        WHERE student_id = $1 AND status = 'active' AND expires_at > now() AND assessment_snapshot IS NOT NULL
        ORDER BY created_at DESC, id LIMIT 20`,
      [input.studentId]
    );
    for (const row of open.rows as Array<{ id: string; assessment_snapshot: unknown }>) {
      const read = readFrozenAssessment(row.assessment_snapshot);
      if (read.ok && read.frozen.studentId === input.studentId && sameTargets(read.frozen, input.request.intent, input.request.depth, wanted)) {
        log({ event: 'RESUMED', sessionId: row.id, snapshotId: read.frozen.snapshotId, family: read.frozen.family, executionAuthority: 'CANONICAL' });
        return { ok: true, resumed: true, record: { kind: 'QUIZ_SESSION', id: row.id }, snapshotId: read.frozen.snapshotId, questions: read.frozen.items.length, executionAuthority: 'CANONICAL' };
      }
    }
  }

  /* ---- new: Blueprint Core -> freeze ---- */
  const solved = await deps.solve(input.studentId, { ...input.request, asOf: input.asOf });
  if (!solved.ok) return { ok: false, reason: 'CONTEXT_UNAVAILABLE' };
  const { solution } = solved;
  if (solution.outcome.selected.length === 0 || !solution.requirement?.evidence || !solved.coverages) {
    log({ event: 'NOT_STARTABLE', family: solution.family, solverStatus: solution.outcome.status });
    return { ok: false, reason: 'NOT_STARTABLE' };
  }
  const frozen = freezeAssessment({
    solution,
    coverages: solved.coverages,
    studentId: input.studentId,
    createdAt: input.asOf,
    path: 'LEARNING_ACTIVITY',
    intent: input.request.intent,
    activity: learningActivityFor(solution.requirement.evidence.activityType, input.request.intent),
  });

  /* ---- the frozen questions' content, in the frozen order ---- */
  const ids = frozen.items.map((i) => i.question.id);
  const content = await db.query(
    `SELECT qc.id, qc.question, qc.concept_id, c.subject_id
       FROM question_bank_candidates qc JOIN concepts c ON c.id = qc.concept_id
      WHERE qc.id = ANY($1::uuid[]) AND qc.student_id = $2 AND qc.validation_status = 'VALIDATED'`,
    [ids, input.studentId]
  );
  const byId = new Map((content.rows as Array<{ id: string; question: Record<string, unknown>; concept_id: string; subject_id: string }>).map((r) => [r.id, r]));
  if (ids.some((id) => !byId.has(id))) return { ok: false, reason: 'CONTENT_UNAVAILABLE' };
  const subjects = [...new Set(ids.map((id) => byId.get(id)!.subject_id))];
  if (subjects.length !== 1) return { ok: false, reason: 'SUBJECT_UNRESOLVED' };
  const questions = frozen.items.map((item) => {
    const row = byId.get(item.question.id)!;
    // the frozen item key travels with the question, so a response is tied to the snapshot item it answers
    return { ...row.question, conceptId: row.concept_id, assessmentItemKey: item.key };
  });
  const learnerConcepts = [...new Set(ids.map((id) => byId.get(id)!.concept_id))];

  /* ---- ONE insert: the session exists frozen or does not exist ---- */
  const sessionId = `quiz-b5-${frozen.snapshotId.slice(0, 12)}-${randomUUID().slice(0, 8)}`;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO quiz_sessions (id, student_id, concept_id, subject_id, questions, language, status, created_at, expires_at, quiz_mode, concept_ids, activity_type, evidence_mode, delivery_source, assessment_snapshot)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'active', now(), now() + make_interval(mins => $7), $8, $9::uuid[], $10, $11, 'BANK', $12::jsonb)`,
      [sessionId, input.studentId, learnerConcepts.length === 1 ? learnerConcepts[0] : null, subjects[0], JSON.stringify(questions), input.language ?? 'es', QUIZ_SESSION_TTL_MINUTES, frozen.activity!.quizMode, learnerConcepts, frozen.activity!.activityType, frozen.activity!.evidenceMode, JSON.stringify(frozen)]
    );
    // the existing delivery ledger: the questions are now exposed to this Student
    await recordBankDeliveries(ids, sessionId, input.studentId, client);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  log({ event: 'STARTED', sessionId, snapshotId: frozen.snapshotId, family: frozen.family, solverStatus: solution.outcome.status, questions: questions.length, executionAuthority: 'CANONICAL' });
  return { ok: true, resumed: false, record: { kind: 'QUIZ_SESSION', id: sessionId }, snapshotId: frozen.snapshotId, questions: questions.length, executionAuthority: 'CANONICAL' };
}

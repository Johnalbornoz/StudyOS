/**
 * B3 -- assessment execution and evidence loop (IO). The orchestration of existing authorities:
 *
 *   BlueprintSolution (B2)
 *     -> freeze + persist the snapshot on the existing record (quiz session / exam instance), write-once
 *     -> the attempt serves exactly the frozen references (nothing re-selects)
 *     -> responses are scored by the existing graders (not here)
 *     -> evidence attribution (evidence-plan.ts)
 *     -> `updateMastery` -- the one evidence writer, idempotent on its operation key; in the same transaction
 *        it recalculates the Knowledge State and runs the memory and transfer projectors
 *     -> PostAssessmentState, with the Learning Decision authority's own next decision when asked for
 *
 * It writes two things only: the snapshot column of the record, once, and -- through the canonical writer --
 * learning evidence. It never touches learning_evidence, mastery_records or concept_knowledge_state itself.
 *
 * No route calls this module: it is the execution boundary a later cutover adopts. Until then the delivered
 * runtime keeps its current paths.
 */
import { db, type DbExecutor } from '@/lib/db';
import { updateMastery as canonicalUpdateMastery, type MasteryUpdateInput, type MasteryUpdateResult } from '@/services/mastery.service';
import { getConceptKnowledgeState } from '@/services/knowledge-state.service';
import { activityTypeForQuizMode, evidenceModeForQuizMode, type QuizMode } from '@/services/quiz-persistence.service';
import { QUIZ_MODE_CONFIG } from '@/lib/quiz/quiz-mode-config';
import { resolveCanonicalImplementation } from '@/lib/pedagogical-decision/canonical-implementation-registry';
import { buildOperationKey } from '@/lib/algorithms/evidence-idempotency';
import { resolveStudentConceptIdentities } from '@/lib/catalog/concept-identity.service';
import { deriveExamGaps } from '@/lib/learning-plan/exam-bridge.service';
import { examGapCandidatesFrom, type ExamGapCandidate, type ExamGapFacts } from '@/lib/assessment-foundation/exam-gap-candidate';
import type { ConceptIdentity } from '@/lib/catalog/concept-identity';
import { formPositionsOf, readFrozenAssessment, snapshotMatchesForm, type FrozenActivity, type FrozenAssessment } from './frozen-assessment';
import { planEvidence, type AttemptContext, type ScoredResponse } from './evidence-plan';
import { buildPostAssessmentState, type AssessmentRecord, type ConceptStateChange, type EvidenceApplication, type NextDecisionRef, type PostAssessmentState } from './post-assessment';

/* ------------------------------------------------------------------ */
/* Activity binding (LEARNING) -- every value comes from an existing registry */
/* ------------------------------------------------------------------ */

/**
 * The session a B2 learning blueprint runs as. `canonicalActivity` is the requirement's own
 * `evidence.activityType`; a cumulative practice is the existing cumulative assessment mode.
 */
export function learningActivityFor(canonicalActivity: string, intent?: string | null): FrozenActivity {
  const quizMode: QuizMode | null =
    intent === 'MIXED_CUMULATIVE'
      ? 'cumulative_assessment'
      : canonicalActivity === 'DIAGNOSTIC_CHECK'
        ? 'diagnostic_check'
        : canonicalActivity === 'PRACTICE' || canonicalActivity === 'PROVE' || canonicalActivity === 'RETENTION_CHECK' || canonicalActivity === 'TRANSFER' || canonicalActivity === 'LEARN_CHECK'
          ? resolveCanonicalImplementation(canonicalActivity)?.quizMode ?? null
          : null;
  if (!quizMode) throw new Error(`CANONICAL_IMPLEMENTATION_MISSING: ${canonicalActivity}`);
  return { quizMode, activityType: activityTypeForQuizMode(quizMode), evidenceMode: evidenceModeForQuizMode(quizMode), evidenceSource: QUIZ_MODE_CONFIG[quizMode].evidenceSource };
}

/* ------------------------------------------------------------------ */
/* Snapshot persistence                                                 */
/* ------------------------------------------------------------------ */

const TABLE: Record<AssessmentRecord['kind'], 'quiz_sessions' | 'exam_instances'> = { QUIZ_SESSION: 'quiz_sessions', EXAM_INSTANCE: 'exam_instances' };

const recordKindFor = (frozen: FrozenAssessment): AssessmentRecord['kind'] => (frozen.family === 'LEARNING' ? 'QUIZ_SESSION' : 'EXAM_INSTANCE');

export type PersistSnapshotResult = { ok: true; stored: 'NEW' | 'ALREADY_STORED' } | { ok: false; reason: 'RECORD_NOT_FOUND' | 'RECORD_KIND_MISMATCH' | 'ALREADY_FROZEN_DIFFERENTLY' | 'STUDENT_MISMATCH' | 'FORM_NOT_FROZEN' | 'FORM_MISMATCH' };

/**
 * Stores the snapshot on its record, once. A second call with the same snapshot is a no-op; a different
 * snapshot for a record that already has one is refused -- an existing assessment is never reinterpreted.
 */
export async function persistAssessmentSnapshot(record: AssessmentRecord, frozen: FrozenAssessment, client: DbExecutor = db): Promise<PersistSnapshotResult> {
  if (record.kind !== recordKindFor(frozen)) return { ok: false, reason: 'RECORD_KIND_MISMATCH' };
  const table = TABLE[record.kind];
  if (record.kind === 'EXAM_INSTANCE') {
    // The frozen form is the authority for what the attempt serves. The snapshot is stored only for the form
    // it was frozen for; this statement never writes the form.
    const instance = await client.query(`SELECT form FROM exam_instances WHERE id = $1`, [record.id]);
    if (!instance.rows[0]) return { ok: false, reason: 'RECORD_NOT_FOUND' };
    const positions = formPositionsOf(instance.rows[0].form);
    if (positions.length === 0) return { ok: false, reason: 'FORM_NOT_FROZEN' };
    if (!snapshotMatchesForm(frozen, positions)) return { ok: false, reason: 'FORM_MISMATCH' };
  }
  const written = await client.query(`UPDATE ${table} SET assessment_snapshot = $2::jsonb WHERE id = $1 AND student_id = $3 AND assessment_snapshot IS NULL RETURNING id`, [record.id, JSON.stringify(frozen), frozen.studentId]);
  if ((written.rowCount ?? written.rows.length) > 0) return { ok: true, stored: 'NEW' };
  const existing = await client.query(`SELECT student_id, assessment_snapshot FROM ${table} WHERE id = $1`, [record.id]);
  const row = existing.rows[0];
  if (!row) return { ok: false, reason: 'RECORD_NOT_FOUND' };
  if (row.student_id !== frozen.studentId) return { ok: false, reason: 'STUDENT_MISMATCH' };
  return row.assessment_snapshot?.snapshotId === frozen.snapshotId ? { ok: true, stored: 'ALREADY_STORED' } : { ok: false, reason: 'ALREADY_FROZEN_DIFFERENTLY' };
}

export type LoadSnapshotResult = { ok: true; frozen: FrozenAssessment; technicalDemo: boolean } | { ok: false; reason: 'RECORD_NOT_FOUND' | 'NO_SNAPSHOT' | 'MALFORMED' | 'DIGEST_MISMATCH' | 'FORM_NOT_FROZEN' | 'FORM_MISMATCH' };

/** The snapshot an attempt executes from. Read as stored; an edited or malformed one is refused. */
export async function loadAssessmentSnapshot(record: AssessmentRecord, client: DbExecutor = db): Promise<LoadSnapshotResult> {
  const audience = record.kind === 'EXAM_INSTANCE' ? ', content_audience, form' : '';
  const r = await client.query(`SELECT assessment_snapshot${audience} FROM ${TABLE[record.kind]} WHERE id = $1`, [record.id]);
  const row = r.rows[0];
  if (!row) return { ok: false, reason: 'RECORD_NOT_FOUND' };
  if (!row.assessment_snapshot) return { ok: false, reason: 'NO_SNAPSHOT' };
  const read = readFrozenAssessment(row.assessment_snapshot);
  if (!read.ok) return { ok: false, reason: read.issue };
  if (record.kind === 'EXAM_INSTANCE') {
    // exam form items = executed exam items: the attempt runs `exam_instances.form`, and a snapshot that does
    // not describe exactly that form is not this attempt's provenance.
    const positions = formPositionsOf(row.form);
    if (positions.length === 0) return { ok: false, reason: 'FORM_NOT_FROZEN' };
    if (!snapshotMatchesForm(read.frozen, positions)) return { ok: false, reason: 'FORM_MISMATCH' };
  }
  // The record's own audience wins: a technical-demo instance is a demo whatever its snapshot says.
  return { ok: true, frozen: read.frozen, technicalDemo: read.frozen.contentAudience === 'TECHNICAL_DEMO' || row.content_audience === 'TECHNICAL_DEMO' };
}

/* ------------------------------------------------------------------ */
/* The evidence loop                                                    */
/* ------------------------------------------------------------------ */

export interface EvidenceLoopDeps {
  updateMastery: (input: MasteryUpdateInput) => Promise<MasteryUpdateResult>;
  loadIdentities: (studentId: string) => Promise<ConceptIdentity[]>;
  loadSubjects: (learnerConceptIds: readonly string[]) => Promise<Map<string, string>>;
  readMasteryState: (studentId: string, learnerConceptId: string) => Promise<string | null>;
  /** The attempt's own exam target, and proof that the attempt belongs to the record. null = not bound. */
  resolveExamAttempt: (instanceId: string, examAttemptId: string) => Promise<{ examTargetId: string } | null>;
  readExamGaps: (studentId: string, examTargetId: string) => Promise<ExamGapFacts[]>;
  /** The Learning Decision authority. Omitted = not requested. B3 never computes a decision itself. */
  nextDecision?: (studentId: string) => Promise<unknown | null>;
  log?: (event: Record<string, unknown>) => void;
}

const defaultDeps: EvidenceLoopDeps = {
  updateMastery: canonicalUpdateMastery,
  loadIdentities: (studentId) => resolveStudentConceptIdentities(studentId),
  loadSubjects: async (ids) => {
    if (ids.length === 0) return new Map();
    const r = await db.query(`SELECT id, subject_id FROM concepts WHERE id = ANY($1::uuid[])`, [[...new Set(ids)]]);
    return new Map(r.rows.map((row: any) => [row.id as string, row.subject_id as string]));
  },
  readMasteryState: async (studentId, learnerConceptId) => (await getConceptKnowledgeState(studentId, learnerConceptId))?.masteryState ?? null,
  resolveExamAttempt: async (instanceId, examAttemptId) => {
    const r = await db.query(
      `SELECT ea.student_exam_profile_id FROM exam_instances ei JOIN simulation_attempts sa ON sa.id = ei.simulation_attempt_id JOIN exam_attempts ea ON ea.id = sa.exam_attempt_id WHERE ei.id = $1 AND ea.id = $2`,
      [instanceId, examAttemptId]
    );
    return r.rows[0] ? { examTargetId: r.rows[0].student_exam_profile_id as string } : null;
  },
  readExamGaps: (studentId, examTargetId) => deriveExamGaps([studentId], null, { examProfileId: examTargetId }),
};

export interface EvidenceLoopInput {
  record: AssessmentRecord;
  /** The Student the caller is authorised for. Must be the snapshot's own. */
  studentId: string;
  /** LEARNING: the quiz session id (= record id). Exam families: the exam attempt id. */
  attemptRef: string;
  /** Scores from the existing graders. */
  responses: readonly ScoredResponse[];
  learningMode?: AttemptContext['learningMode'];
  transferGrading?: AttemptContext['transferGrading'];
}

export type EvidenceLoopRefusal = 'RECORD_NOT_FOUND' | 'NO_SNAPSHOT' | 'MALFORMED' | 'DIGEST_MISMATCH' | 'FORM_NOT_FROZEN' | 'FORM_MISMATCH' | 'STUDENT_MISMATCH' | 'ATTEMPT_NOT_BOUND_TO_SNAPSHOT';

export type EvidenceLoopResult = { ok: true; state: PostAssessmentState } | { ok: false; reason: EvidenceLoopRefusal };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/**
 * Turns the scored responses of one attempt into controlled evidence, exactly once.
 *
 * Call it when the attempt's responses are final (the existing completion boundary). Calling it again --
 * a retry, a second worker, a later completion of the same attempt -- applies nothing twice: the writer's
 * operation key (session / attempt + frozen position + concept) is enforced by the database.
 *
 * A failed or impossible attribution never touches a score: scores are inputs here and are not rewritten.
 */
export async function completeAssessmentEvidence(input: EvidenceLoopInput, overrides: Partial<EvidenceLoopDeps> = {}): Promise<EvidenceLoopResult> {
  const deps: EvidenceLoopDeps = { ...defaultDeps, ...overrides };
  const loaded = await loadAssessmentSnapshot(input.record);
  if (!loaded.ok) return loaded;
  const { technicalDemo } = loaded;
  const frozen: FrozenAssessment = technicalDemo ? { ...loaded.frozen, contentAudience: 'TECHNICAL_DEMO' } : loaded.frozen;
  if (frozen.studentId !== input.studentId) return { ok: false, reason: 'STUDENT_MISMATCH' };

  let examTargetId: string | null = null;
  if (input.record.kind === 'QUIZ_SESSION') {
    if (input.attemptRef !== input.record.id) return { ok: false, reason: 'ATTEMPT_NOT_BOUND_TO_SNAPSHOT' };
  } else {
    const bound = await deps.resolveExamAttempt(input.record.id, input.attemptRef);
    if (!bound) return { ok: false, reason: 'ATTEMPT_NOT_BOUND_TO_SNAPSHOT' };
    examTargetId = bound.examTargetId;
  }

  const identities = technicalDemo ? [] : await deps.loadIdentities(frozen.studentId);
  const subjectByLearnerConcept = technicalDemo ? new Map<string, string>() : await deps.loadSubjects(identities.map((i) => i.learnerConceptId));
  const plan = planEvidence(frozen, { assessmentRef: input.attemptRef, examTargetId, learningMode: input.learningMode, transferGrading: input.transferGrading ?? null }, input.responses, { identities, subjectByLearnerConcept });

  // State is read around the writes only to REPORT the change; the projector inside the writer computes it.
  const before = new Map<string, string | null>();
  for (const w of plan.writes) before.set(w.learnerConceptId, await deps.readMasteryState(frozen.studentId, w.learnerConceptId));

  const evidence: EvidenceApplication[] = [];
  for (const w of plan.writes) {
    const operationKey = buildOperationKey(w.identity);
    const base = { canonicalConceptId: w.canonicalConceptId, learnerConceptId: w.learnerConceptId, operationKey, sourceItemKeys: w.sourceItemKeys };
    try {
      const result = await deps.updateMastery({ studentId: frozen.studentId, conceptId: w.learnerConceptId, subjectId: w.subjectId, evidence: w.evidence, telemetry: w.telemetry, metadata: w.metadata, identity: w.identity });
      evidence.push({ ...base, status: result.duplicate ? 'DUPLICATE_IDEMPOTENT' : 'APPLIED', mastery: { before: result.oldMastery, after: result.newMastery }, masteryEventId: result.eventId ?? null, retentionCheckQualified: result.retentionCheckQualified ?? null, error: null });
    } catch (e) {
      // One concept's failure does not stop the others, and never the score.
      evidence.push({ ...base, status: 'WRITE_FAILED', mastery: null, masteryEventId: null, retentionCheckQualified: null, error: message(e) });
    }
  }

  const conceptStateChanges: ConceptStateChange[] = [];
  for (const [learnerConceptId, prior] of before) {
    const after = await deps.readMasteryState(frozen.studentId, learnerConceptId);
    const canonicalConceptId = plan.writes.find((w) => w.learnerConceptId === learnerConceptId)!.canonicalConceptId;
    conceptStateChanges.push({ canonicalConceptId, learnerConceptId, before: prior, after, changed: prior !== after });
  }

  let examGaps: ExamGapCandidate[] | null = null;
  if (frozen.family !== 'LEARNING' && examTargetId && !technicalDemo) {
    // The existing gap read, restated through the B1 boundary. Publishing only: nothing is placed or ranked here.
    try {
      examGaps = examGapCandidatesFrom(await deps.readExamGaps(frozen.studentId, examTargetId));
    } catch {
      examGaps = null;
    }
  }

  let nextDecision: NextDecisionRef = { status: 'NOT_REQUESTED' };
  if (deps.nextDecision && !technicalDemo) {
    try {
      const decision = await deps.nextDecision(frozen.studentId);
      nextDecision = decision === null || decision === undefined ? { status: 'NONE' } : { status: 'AVAILABLE', decision };
    } catch (e) {
      nextDecision = { status: 'UNAVAILABLE', error: message(e) };
    }
  }

  const state = buildPostAssessmentState({
    assessment: { snapshotId: frozen.snapshotId, family: frozen.family, path: frozen.path, intent: frozen.intent, record: input.record, policy: frozen.policy },
    attemptRef: input.attemptRef,
    studentId: frozen.studentId,
    technicalDemo,
    plan,
    responseCount: input.responses.length,
    evidence,
    conceptStateChanges,
    examGaps,
    nextDecision,
  });
  // Counts and identifiers only: no answer text, no question content.
  (deps.log ?? ((event) => console.info('[b3-evidence-loop]', JSON.stringify(event))))(state.diagnostics as unknown as Record<string, unknown>);
  return { ok: true, state };
}

/** The Learning Decision authority's current answer for the Student (the existing Learning OS snapshot). */
export async function canonicalNextDecision(studentId: string): Promise<unknown | null> {
  const { getLearningOSSnapshot } = await import('@/services/learning-os-snapshot.service');
  const snapshot = await getLearningOSSnapshot(studentId);
  return snapshot.nextExecutableItem ? { item: snapshot.nextExecutableItem, waiting: snapshot.nextExecutableItemWaiting } : null;
}

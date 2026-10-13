/**
 * B4 -- the setup read model of a learning practice (IO, read-only). The launch adapter a surface calls
 * BEFORE a start: "for this Student and this scope, what would each depth be?".
 *
 * It asks the Blueprint Core once per depth (the same pipeline a launch would freeze) and turns the answers
 * into the setup view. It creates no session, freezes nothing and starts nothing: starting an assessment
 * from a frozen snapshot is the runtime adoption step, which is not part of this block.
 *
 * A curriculum node (a topic, a unit, a strand ... of any framework) is resolved to its canonical concepts
 * through the universal CurriculumScope; nothing here knows a framework by name.
 */
import { loadCurriculumScope } from '@/lib/curriculum/curriculum-scope.service';
import { conceptsUnderNode } from '@/lib/curriculum/cross-curriculum';
import { evaluateExamVersionReadiness, solveLearningForStudent } from '@/lib/assessment-blueprint/assessment-blueprint.service';
import { PRACTICE_DEPTHS, type PracticeDepth } from '@/lib/assessment-blueprint/policy/practice-depth';
import type { BlueprintSolution } from '@/lib/assessment-blueprint/result';
import type { AssessmentLaunchRequest } from './launch';
import { db } from '@/lib/db';
import { readFrozenAssessment } from '@/lib/assessment-execution/frozen-assessment';
import { loadDraftAnswers } from '@/lib/assessment-execution/assessment-draft.service';
import { toClientQuestion } from '@/lib/quiz/client-question';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';
import { examAttemptOptions, learningSetupView, runViewOf, singleSetupView, type AssessmentRunView, type AssessmentSetupView, type ExamAttemptOption } from './views';

export type SetupUnavailable = 'CONTEXT_UNAVAILABLE' | 'SCOPE_NOT_FOUND' | 'NOTHING_TO_PRACTISE';

export type LearningSetupResult = { ok: true; view: AssessmentSetupView; canonicalConceptIds: string[] } | { ok: false; reason: SetupUnavailable };

export interface SetupDeps {
  solve: typeof solveLearningForStudent;
  loadScope: typeof loadCurriculumScope;
}

const defaults: SetupDeps = { solve: solveLearningForStudent, loadScope: loadCurriculumScope };

/** Intents with a depth choice. A diagnostic or a mastery / retention check has one shape, whatever the depth. A Student's own partial exam has a size. */
const DEPTH_INTENTS: ReadonlySet<string> = new Set(['CONCEPT_PRACTICE', 'TOPIC_PRACTICE', 'CUSTOM_CONCEPT_PRACTICE', 'MIXED_CUMULATIVE', 'AD_HOC_CONCEPT_EXAM']);

export async function learningSetupForStudent(studentId: string, request: Extract<AssessmentLaunchRequest, { family: 'LEARNING' }>, asOf: string, overrides: Partial<SetupDeps> = {}): Promise<LearningSetupResult> {
  const deps = { ...defaults, ...overrides };
  const canonical = new Set(request.scope.canonicalConceptIds);
  if (request.scope.node) {
    const scope = await deps.loadScope(request.scope.node.structureVersionId);
    if (!scope || !scope.nodes.some((n) => n.id === request.scope.node!.nodeId)) return { ok: false, reason: 'SCOPE_NOT_FOUND' };
    for (const id of conceptsUnderNode(scope, request.scope.node.nodeId)) canonical.add(id);
  }
  const canonicalConceptIds = [...canonical].sort();
  if (canonicalConceptIds.length === 0 && request.scope.learnerConceptIds.length === 0) return { ok: false, reason: 'NOTHING_TO_PRACTISE' };

  const depths: readonly PracticeDepth[] = DEPTH_INTENTS.has(request.intent) ? PRACTICE_DEPTHS : [request.depth];
  const byDepth: Partial<Record<PracticeDepth, BlueprintSolution>> = {};
  for (const depth of depths) {
    const solved = await deps.solve(studentId, { intent: request.intent, depth, canonicalConceptIds, learnerConceptIds: request.scope.learnerConceptIds, availableMinutes: request.availableMinutes, difficultyBand: request.intent === 'AD_HOC_CONCEPT_EXAM' ? request.difficultyBand : null, asOf });
    if (!solved.ok) return { ok: false, reason: 'CONTEXT_UNAVAILABLE' };
    byDepth[depth] = solved.solution;
  }
  const view = depths.length > 1 ? learningSetupView(byDepth) : singleSetupView(byDepth[depths[0]] as BlueprintSolution);
  // B5-D: a scope given as the Student's own concepts is resolved by the Blueprint Core (B1 identity rule);
  // the canonical targets it resolved are what the start will be asked for, so a resume finds the same assessment.
  const resolved = new Set(canonicalConceptIds);
  if (request.scope.learnerConceptIds.length > 0) for (const solution of Object.values(byDepth)) if (solution?.plan.mode === 'TARGETS') for (const target of solution.plan.targets) if (target.kind === 'CONCEPT') resolved.add(target.id);
  return { ok: true, view, canonicalConceptIds: [...resolved].sort() };
}

/* ------------------------------------------------------------------ */
/* B5-R: the read models of the mounted experience                      */
/* ------------------------------------------------------------------ */

/** The names of canonical concepts, for a scope line or a result row. An unknown id simply has no label. */
export async function canonicalConceptLabels(canonicalConceptIds: readonly string[]): Promise<Record<string, string>> {
  if (canonicalConceptIds.length === 0) return {};
  const r = await db.query(`SELECT id, name FROM canonical_concepts WHERE id::text = ANY($1::text[])`, [[...canonicalConceptIds]]);
  return Object.fromEntries((r.rows as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
}

export type RunQuestion = ReturnType<typeof toClientQuestion> & { itemKey: string };

export type LearningRunResult =
  | { ok: true; status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED'; run: AssessmentRunView; questions: RunQuestion[]; conceptLabels: Record<string, string>; canonicalConceptIds: string[]; /** Answers in progress, encoded, by item key. Not evidence. */ savedAnswers: Record<string, string> }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_CANONICAL' };

/**
 * The active shell of a canonical learning assessment: the FROZEN questions, in the frozen order, with every
 * answer stripped. It is the same on every load (a resume shows the same assessment); nothing is selected,
 * counted or reordered here. A session without a snapshot belongs to the existing runtime and is not served.
 */
export async function learningRunForStudent(studentId: string, sessionId: string): Promise<LearningRunResult> {
  const r = await db
    .query(`SELECT student_id, status, questions, assessment_snapshot, (expires_at <= now()) AS expired FROM quiz_sessions WHERE id = $1`, [sessionId])
    .catch((e: { code?: string }) => {
      if (e?.code === '42703') return { rows: [] as any[] };
      throw e;
    });
  const row = r.rows[0];
  if (!row || row.student_id !== studentId) return { ok: false, reason: 'NOT_FOUND' };
  const read = readFrozenAssessment(row.assessment_snapshot);
  if (!read.ok || read.frozen.family !== 'LEARNING') return { ok: false, reason: 'NOT_CANONICAL' };
  const frozenKeys = new Set(read.frozen.items.map((i) => i.key));
  const stored = (Array.isArray(row.questions) ? row.questions : []) as Array<GeneratedQuestion & { assessmentItemKey?: string }>;
  const questions = stored
    .filter((q) => !!q.assessmentItemKey && frozenKeys.has(q.assessmentItemKey))
    // the stored option order is kept, so a reload shows the same question the same way
    .map((q, index) => ({ ...toClientQuestion(q, index, { optionOrder: q.options?.map((o) => o.id) }), itemKey: q.assessmentItemKey as string }));
  const canonicalConceptIds = [...read.frozen.targets.canonicalConceptIds];
  const status = row.status === 'active' ? (row.expired ? 'EXPIRED' : 'ACTIVE') : 'COMPLETED';
  const savedAnswers = status === 'ACTIVE' ? await loadDraftAnswers(sessionId, studentId, stored) : {};
  return {
    ok: true,
    status,
    savedAnswers,
    run: runViewOf(read.frozen, Object.keys(savedAnswers)),
    questions,
    conceptLabels: await canonicalConceptLabels(canonicalConceptIds),
    canonicalConceptIds,
  };
}

/* ------------------------------------------------------------------ */
/* B5-D: canonical availability of exam attempts                        */
/* ------------------------------------------------------------------ */

export interface ExamAvailability {
  options: ExamAttemptOption[];
  /** Student-eligible reviewed questions for this exam version, as the Blueprint Core's readiness counts them. */
  eligibleQuestions: number;
  evaluated: boolean;
}

/**
 * What the canonical feasibility says a Student can be offered for one exam version. Read-only. It starts
 * nothing and fabricates nothing: with no student-eligible reviewed content every option is unavailable, and
 * a mock is offered only when its official form has been shown buildable -- which this read does not
 * establish, so a mock is never offered from here on content counts alone. A failed read is "unavailable",
 * never a crash and never an optimistic default.
 */
/**
 * Does this exam version hold deliverable content whose difficulty is CALIBRATED against the real exam (a difficulty
 * index)? A challenge is defined by that index; a 1-5 item difficulty is not a calibration. Read-only; a failed read is "no".
 */
export async function examVersionHasCalibratedDifficulty(examVersionId: string): Promise<boolean> {
  try {
    const r = await db.query(
      `SELECT EXISTS (SELECT 1 FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id AND qi.current_version_id = ai.id
                       WHERE qi.exam_version_id = $1 AND ai.status = 'PUBLISHED' AND (ai.difficulty_index IS NOT NULL OR ai.content ? 'difficultyIndex')) AS calibrated`,
      [examVersionId]);
    return r.rows[0]?.calibrated === true;
  } catch {
    return false;
  }
}

export async function examAvailabilityForVersion(examVersionId: string | null, evaluate: typeof evaluateExamVersionReadiness = evaluateExamVersionReadiness, calibrated: (examVersionId: string) => Promise<boolean> = examVersionHasCalibratedDifficulty): Promise<ExamAvailability> {
  const none = (evaluated: boolean, eligibleQuestions = 0): ExamAvailability => ({ options: examAttemptOptions({ officialForm: null, fidelity: null, difficultyBandMet: null, practiceContentAvailable: false }), eligibleQuestions, evaluated });
  if (!examVersionId) return none(false);
  try {
    const report = await evaluate(examVersionId);
    if (report.eligibleQuestions === 0) return none(true);
    return { options: examAttemptOptions({ officialForm: null, fidelity: null, difficultyBandMet: null, practiceContentAvailable: true, challengeDifficultyCalibrated: await calibrated(examVersionId) }), eligibleQuestions: report.eligibleQuestions, evaluated: true };
  } catch {
    return none(false);
  }
}

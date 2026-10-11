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
import { solveLearningForStudent } from '@/lib/assessment-blueprint/assessment-blueprint.service';
import { PRACTICE_DEPTHS, type PracticeDepth } from '@/lib/assessment-blueprint/policy/practice-depth';
import type { BlueprintSolution } from '@/lib/assessment-blueprint/result';
import type { AssessmentLaunchRequest } from './launch';
import { db } from '@/lib/db';
import { readFrozenAssessment } from '@/lib/assessment-execution/frozen-assessment';
import { toClientQuestion } from '@/lib/quiz/client-question';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';
import { learningSetupView, runViewOf, singleSetupView, type AssessmentRunView, type AssessmentSetupView } from './views';

export type SetupUnavailable = 'CONTEXT_UNAVAILABLE' | 'SCOPE_NOT_FOUND' | 'NOTHING_TO_PRACTISE';

export type LearningSetupResult = { ok: true; view: AssessmentSetupView; canonicalConceptIds: string[] } | { ok: false; reason: SetupUnavailable };

export interface SetupDeps {
  solve: typeof solveLearningForStudent;
  loadScope: typeof loadCurriculumScope;
}

const defaults: SetupDeps = { solve: solveLearningForStudent, loadScope: loadCurriculumScope };

/** Intents with a depth choice. A diagnostic or a mastery / retention check has one shape, whatever the depth. */
const DEPTH_INTENTS: ReadonlySet<string> = new Set(['CONCEPT_PRACTICE', 'TOPIC_PRACTICE', 'CUSTOM_CONCEPT_PRACTICE', 'MIXED_CUMULATIVE']);

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
    const solved = await deps.solve(studentId, { intent: request.intent, depth, canonicalConceptIds, learnerConceptIds: request.scope.learnerConceptIds, availableMinutes: request.availableMinutes, asOf });
    if (!solved.ok) return { ok: false, reason: 'CONTEXT_UNAVAILABLE' };
    byDepth[depth] = solved.solution;
  }
  const view = depths.length > 1 ? learningSetupView(byDepth) : singleSetupView(byDepth[depths[0]] as BlueprintSolution);
  return { ok: true, view, canonicalConceptIds };
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
  | { ok: true; status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED'; run: AssessmentRunView; questions: RunQuestion[]; conceptLabels: Record<string, string>; canonicalConceptIds: string[] }
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
  return {
    ok: true,
    status: row.status === 'active' ? (row.expired ? 'EXPIRED' : 'ACTIVE') : 'COMPLETED',
    run: runViewOf(read.frozen, []),
    questions,
    conceptLabels: await canonicalConceptLabels(canonicalConceptIds),
    canonicalConceptIds,
  };
}

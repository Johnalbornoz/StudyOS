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
import { learningSetupView, singleSetupView, type AssessmentSetupView } from './views';

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

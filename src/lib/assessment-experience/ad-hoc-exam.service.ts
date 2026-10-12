/**
 * A Student's own partial exam -- the authoritative check before a start, and what the setup shows.
 *
 * One function decides whether THIS exam can start:
 *   1. the Subject is the Student's own and every selected concept is one of its concepts (whole selection
 *      refused otherwise);
 *   2. the Blueprint Core, over content that is ALREADY eligible, can meet every selected concept in full.
 *
 * It reads. It never asks for content to be produced, never widens or narrows the selection, and creates
 * nothing. With anything unmet the answer is INSUFFICIENT_CERTIFIED_CONTENT, naming the concepts.
 */
import { solveLearningForStudent } from '@/lib/assessment-blueprint/assessment-blueprint.service';
import type { PracticeDepth } from '@/lib/assessment-blueprint/policy/practice-depth';
import type { RequestedDifficultyBand } from '@/lib/exam-core/question-bank/requested-difficulty';
import { canonicalConceptIdForAssessment } from '@/lib/catalog/concept-identity';
import { resolveStudentConceptIdentities } from '@/lib/catalog/concept-identity.service';
import { resolveAdHocExamScope, type AdHocScopeRefusal } from '@/services/ad-hoc-exam.service';
import { AD_HOC_EXAM_INTENT } from './ad-hoc-exam';

export type AdHocExamReadiness =
  | { ok: true; subjectId: string; learnerConceptIds: string[]; canonicalConceptIds: string[]; /** the Student's own concept each canonical target stands for, within this Subject */ learnerConceptByCanonical: Record<string, string>; questions: number }
  | { ok: false; reason: 'DISABLED' }
  | { ok: false; reason: 'SCOPE_REJECTED'; detail: AdHocScopeRefusal }
  | { ok: false; reason: 'CONTEXT_UNAVAILABLE' }
  | { ok: false; reason: 'INSUFFICIENT_CERTIFIED_CONTENT'; unmetConceptIds: string[] };

export interface AdHocReadinessDeps {
  solve: typeof solveLearningForStudent;
}

/** Whether the frozen-assessment runtime is on, as read by the caller from the one flag. Not stated => closed. */
export interface AdHocRuntime {
  enabled: boolean;
}

export interface AdHocExamRequest {
  subjectId: unknown;
  learnerConceptIds: readonly unknown[];
  depth: PracticeDepth;
  availableMinutes?: number | null;
  /** The difficulty the Student chose, or null. Part of what must be met: it is never relaxed to find questions. */
  difficultyBand?: RequestedDifficultyBand | null;
}

export async function adHocExamReadiness(studentId: string, request: AdHocExamRequest, asOf: string, runtime: AdHocRuntime, overrides: Partial<AdHocReadinessDeps> = {}): Promise<AdHocExamReadiness> {
  const deps: AdHocReadinessDeps = { solve: solveLearningForStudent, ...overrides };
  // fail closed: without the frozen-assessment runtime there is no other path for this exam
  if (runtime?.enabled !== true) return { ok: false, reason: 'DISABLED' };

  const scope = await resolveAdHocExamScope(studentId, request.subjectId, request.learnerConceptIds);
  if (!scope.ok) return { ok: false, reason: 'SCOPE_REJECTED', detail: scope.reason };

  const solved = await deps.solve(studentId, { intent: AD_HOC_EXAM_INTENT, depth: request.depth, canonicalConceptIds: [], learnerConceptIds: scope.conceptIds, availableMinutes: request.availableMinutes ?? null, difficultyBand: request.difficultyBand ?? null, asOf });
  if (!solved.ok) return { ok: false, reason: 'CONTEXT_UNAVAILABLE' };
  const { solution } = solved;

  // Which canonical target each selected concept stands for, by the SAME identity rule the Blueprint Core applies.
  const identities = await resolveStudentConceptIdentities(studentId);
  const canonicalOfLearner = new Map<string, string>();
  for (const identity of identities) {
    if (!scope.conceptIds.includes(identity.learnerConceptId)) continue;
    const canonical = canonicalConceptIdForAssessment(identity);
    if (canonical) canonicalOfLearner.set(identity.learnerConceptId, canonical);
  }
  const targets = new Set(solution.requirement?.targets.canonicalConceptIds ?? []);
  const unmetTargets = new Set(solution.outcome.unmet.map((u) => u.subject.slice(u.subject.indexOf(':') + 1)));

  // A selected concept is met only when it has a canonical target, that target is in the requirement, and the
  // eligible content satisfies it in full. Anything else is unmet -- and one unmet concept refuses the exam.
  const unmetConceptIds = scope.conceptIds.filter((id) => {
    const canonical = canonicalOfLearner.get(id);
    return !canonical || !targets.has(canonical) || unmetTargets.has(canonical);
  });
  const expected = new Set(scope.conceptIds.map((id) => canonicalOfLearner.get(id)).filter((id): id is string => !!id));
  const exact = expected.size === targets.size && [...expected].every((id) => targets.has(id));
  if (unmetConceptIds.length > 0 || !exact || solution.outcome.status !== 'READY' || solution.outcome.selected.length === 0) {
    // when nothing names a concept, the selection as a whole is what could not be met
    return { ok: false, reason: 'INSUFFICIENT_CERTIFIED_CONTENT', unmetConceptIds: unmetConceptIds.length > 0 ? unmetConceptIds : [...scope.conceptIds] };
  }
  const learnerConceptByCanonical: Record<string, string> = {};
  for (const id of scope.conceptIds) {
    const canonical = canonicalOfLearner.get(id)!;
    if (!(canonical in learnerConceptByCanonical)) learnerConceptByCanonical[canonical] = id;
  }
  return { ok: true, subjectId: scope.subjectId, learnerConceptIds: scope.conceptIds, canonicalConceptIds: [...targets].sort(), learnerConceptByCanonical, questions: solution.outcome.selected.length };
}

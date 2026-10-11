/**
 * B4 -- Unified Student Assessment Experience: view contracts, shared components and authority guardrails.
 *
 * The contracts are exercised with REAL Blueprint Core solutions and REAL B3 results (pure pipelines, no
 * database); the components are server-rendered with the governed messages of every locale.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => createElement('a', { href, ...rest }, children) }));
vi.mock('@/lib/db', () => ({ db: { query: async () => ({ rows: [] }) } }));
vi.mock('@/lib/assessment-blueprint/assessment-blueprint.service', () => ({ solveLearningForStudent: async () => ({ ok: false, issues: [] }) }));
vi.mock('@/lib/curriculum/curriculum-scope.service', () => ({ loadCurriculumScope: async () => null }));

import { coverageOfLearningCacheItem, coverageOfReviewedBankItem, type LearningCacheItemRow, type QuestionCoverage } from '@/lib/assessment-foundation/question-coverage';
import type { ConceptIdentity } from '@/lib/catalog/concept-identity';
import type { FormPosition } from '@/lib/exam-core/form-assembly';
import { projectEvidenceNeeds, solveLearningBlueprint, solveOfficialBlueprint, type EvidenceCountPolicy } from '@/lib/assessment-blueprint';
import type { BlueprintSolution } from '@/lib/assessment-blueprint/result';
import { freezeAssessment, planEvidence, buildPostAssessmentState, type FrozenAssessment, type ScoredResponse, type PostAssessmentState } from '@/lib/assessment-execution';
import { AssessmentLaunchRequestSchema, CANONICAL_EXECUTION_ENABLED, executionPathFor, parseLaunchRequest } from '@/lib/assessment-experience/launch';
import { examAttemptOptions, learningSetupView, previewOf, resultViewOf, runViewOf, singleSetupView, type AssessmentSetupView } from '@/lib/assessment-experience/views';
import { continuationViewOf } from '@/lib/assessment-experience/continuation';
import { learningSetupForStudent } from '@/lib/assessment-experience/assessment-experience.service';
import { ASSESSMENT_EXPERIENCE_MESSAGES } from '@/lib/i18n/assessment-experience-messages';
import { getMessages, LOCALES } from '@/lib/i18n/messages';
import { IB, PROVIDER_IB_COURSE, SCHOOL_PLAN, FORCE, GRAVITY, MOMENTUM, LINEAR } from '../fixtures/universal-curriculum';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const POLICY: EvidenceCountPolicy = { version: 1, minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2 };
const AS_OF = '2026-10-10T12:00:00.000Z';
const STUDENT = 'stu-1';
const canonical = (c: string): ConceptIdentity => ({ status: 'CANONICAL', learnerConceptId: `lc-${c}`, canonicalConceptId: c, basis: 'CREATED_FROM_CANONICAL' });

function cached(id: string, concept: string, over: Partial<LearningCacheItemRow> = {}, also: Array<[string, 'PRIMARY' | 'SUPPORTING']> = [], seconds: number | null = null): QuestionCoverage {
  const c = coverageOfLearningCacheItem({ candidateId: id, studentId: STUDENT, learnerConceptId: `lc-${concept}`, activityType: 'PRACTICE', questionType: 'multiple_choice', difficulty: 3, language: 'es', validationStatus: 'VALIDATED', identity: canonical(concept), ...over });
  return { ...c, concepts: [...c.concepts, ...also.map(([canonicalConceptId, role]) => ({ canonicalConceptId, role, basis: 'ITEM_ATTRIBUTION' as const }))], estimatedSeconds: seconds === null ? c.estimatedSeconds : { state: 'KNOWN', value: seconds } };
}
function bank(id: string, objective: string, concepts: string[]): QuestionCoverage {
  return coverageOfReviewedBankItem({
    approvedItemId: id, learningObjectiveId: objective, questionType: 'multiple_choice', content: { difficulty: 3, marks: 2, language: 'es' }, status: 'PUBLISHED', bankLifecycleStatus: 'ACTIVE',
    usageEligibility: ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK'], examAlignment: 'MOCK_READY', calibrationConfidence: 'INSUFFICIENT_DATA', contentOrigin: 'GENERATED', sourceIds: null,
    bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: 'ev-1', assessmentComponentId: 'comp-1', currentVersionId: id, retired: false, language: 'es' }, sourceLicenses: [], itemRights: { sourceAccess: 'NOT_APPLICABLE', reuseRights: 'STUDYUS_OWNED', inForce: true }, humanReviewDecisions: 1,
    scope: { structureVersionId: 'sv-1', academicSubjectId: 'subj-1' }, objectiveConcepts: concepts.map((canonicalConceptId) => ({ canonicalConceptId, relationType: 'FULL' as const })),
  });
}
const SCENARIO = (seconds: number | null = null) => [cached('Q1', 'C1', {}, [], seconds), cached('Q2', 'C1', {}, [['C2', 'SUPPORTING']], seconds), cached('Q3', 'C2', {}, [['C4', 'PRIMARY']], seconds), cached('Q4', 'C4', {}, [], seconds)];
const learn = (coverages: QuestionCoverage[], concepts: string[], depth: 'QUICK' | 'BALANCED' | 'DEEP', intent: 'CUSTOM_CONCEPT_PRACTICE' | 'MASTERY_CHECK' = 'CUSTOM_CONCEPT_PRACTICE', availableMinutes: number | null = null): BlueprintSolution =>
  solveLearningBlueprint({ policy: { studentId: STUDENT, intent, depth, canonicalConceptIds: concepts, needs: projectEvidenceNeeds(concepts, [], POLICY, AS_OF), availableMinutes }, coverages, asOf: AS_OF });
const byDepth = (coverages: QuestionCoverage[], concepts: string[]) => ({ QUICK: learn(coverages, concepts, 'QUICK'), BALANCED: learn(coverages, concepts, 'BALANCED'), DEEP: learn(coverages, concepts, 'DEEP') });
const PRACTICE = { quizMode: 'topic_practice', activityType: 'PRACTICE', evidenceMode: 'PRACTICE' as const, evidenceSource: 'PRACTICE_QUIZ' };
const PROVE = { quizMode: 'canonical_prove', activityType: 'SOLO_CHECK', evidenceMode: 'INDEPENDENT' as const, evidenceSource: 'SOLO_VERIFICATION' };
const freezeLearning = (coverages: QuestionCoverage[], concepts: string[], activity: NonNullable<FrozenAssessment['activity']> = PRACTICE): FrozenAssessment => freezeAssessment({ solution: learn(coverages, concepts, 'BALANCED'), coverages, studentId: STUDENT, createdAt: AS_OF, path: 'LEARNING_ACTIVITY', intent: 'CUSTOM_CONCEPT_PRACTICE', activity });
const position = (index: number, objective: string): FormPosition => ({ index, blueprintObjectiveTargetId: `bot-${index}`, assessmentComponentId: 'comp-1', learningObjectiveId: objective, questionType: null, difficultyRange: null });
const OFFICIAL_BANK = [bank('i1', 'lo-1', ['C1', 'C2']), bank('i2', 'lo-2', ['C3'])];
const officialSolution = () => solveOfficialBlueprint({ policy: { studentId: STUDENT, examTargetId: 'target-1', examVersionId: 'ev-1', blueprintId: 'bp', positions: [position(0, 'lo-1'), position(1, 'lo-2')] }, coverages: OFFICIAL_BANK });
const freezeOfficial = (audience: 'STUDENT' | 'TECHNICAL_DEMO' = 'STUDENT') => freezeAssessment({ solution: officialSolution(), coverages: OFFICIAL_BANK, studentId: STUDENT, createdAt: AS_OF, path: 'OFFICIAL_MOCK', exam: { examTargetId: 'target-1', examVersionId: 'ev-1', assessmentComponentIds: ['comp-1'] }, contentAudience: audience });

/** A B3 result built by the real planner and result builder; evidence "applied" as the writer would report it. */
function postState(frozen: FrozenAssessment, responses: ScoredResponse[], concepts: string[], attemptRef = 'qs-1'): PostAssessmentState {
  const plan = planEvidence(frozen, { assessmentRef: attemptRef, examTargetId: frozen.exam ? 'target-1' : null }, responses, { identities: concepts.map(canonical), subjectByLearnerConcept: new Map(concepts.map((c) => [`lc-${c}`, 'subject-1'])) });
  const evidence = plan.writes.map((w) => ({ canonicalConceptId: w.canonicalConceptId, learnerConceptId: w.learnerConceptId, status: 'APPLIED' as const, operationKey: 'k', sourceItemKeys: w.sourceItemKeys, mastery: { before: 40, after: w.evidence.result === 'correct' ? 55 : 35 }, masteryEventId: 'e', retentionCheckQualified: null, error: null }));
  return buildPostAssessmentState({
    assessment: { snapshotId: frozen.snapshotId, family: frozen.family, path: frozen.path, intent: frozen.intent, record: { kind: frozen.family === 'LEARNING' ? 'QUIZ_SESSION' : 'EXAM_INSTANCE', id: 'r' }, policy: frozen.policy },
    attemptRef, studentId: STUDENT, technicalDemo: frozen.contentAudience === 'TECHNICAL_DEMO', plan, responseCount: responses.length, evidence,
    conceptStateChanges: plan.writes.map((w) => ({ canonicalConceptId: w.canonicalConceptId, learnerConceptId: w.learnerConceptId, before: 'LEARNING', after: w.evidence.result === 'correct' ? 'DEVELOPING' : 'LEARNING', changed: w.evidence.result === 'correct' })),
    examGaps: null, nextDecision: { status: 'NOT_REQUESTED' },
  });
}
const scored = (key: string, fraction: number): ScoredResponse => ({ itemKey: key, responseRef: `r-${key}`, status: 'SCORED', fraction });

/* ================================================================== */

describe('B4 launch contract -- a surface states intent, never content', () => {
  const base = { origin: 'LEARNING_PATH', family: 'LEARNING', intent: 'TOPIC_PRACTICE', depth: 'BALANCED', scope: { canonicalConceptIds: ['C1'] } };

  it('accepts intent, scope and depth, and nothing that would let the UI select or size an assessment', () => {
    expect(parseLaunchRequest(base)).toMatchObject({ ok: true, request: { family: 'LEARNING', depth: 'BALANCED', scope: { canonicalConceptIds: ['C1'], learnerConceptIds: [], node: null }, availableMinutes: null } });
    for (const extra of [{ questionIds: ['q1'] }, { questionCount: 10 }, { maxQuestions: 10 }, { masteryThreshold: 80 }, { priority: 1 }, { difficulty: 4 }]) expect(parseLaunchRequest({ ...base, ...extra }), JSON.stringify(extra)).toEqual({ ok: false, issue: 'MALFORMED' });
    expect(parseLaunchRequest({ ...base, scope: { canonicalConceptIds: ['C1'], questionIds: ['q'] } })).toEqual({ ok: false, issue: 'MALFORMED' });
    expect(parseLaunchRequest({ ...base, scope: {} })).toEqual({ ok: false, issue: 'NO_SCOPE' });
    expect(parseLaunchRequest({ ...base, scope: { node: { structureVersionId: 'sv', nodeId: 'n' } } })).toMatchObject({ ok: true });
  });

  it('one request shape for the three families', () => {
    expect(parseLaunchRequest({ origin: 'EXAM_PREPARATION', family: 'EXAM_PREPARATION', examTargetId: 't', objective: 'CLOSE_GAPS' })).toMatchObject({ ok: true });
    expect(parseLaunchRequest({ origin: 'EXAM_PREPARATION', family: 'OFFICIAL_EXAM', examTargetId: 't', request: 'FULL_MOCK' })).toMatchObject({ ok: true });
    // a preparation practice cannot ask to be stored as a mock, and no request names a technical demo
    expect(parseLaunchRequest({ origin: 'EXAM_PREPARATION', family: 'OFFICIAL_EXAM', examTargetId: 't', request: 'EXAM_PRACTICE' }).ok).toBe(false);
    expect(JSON.stringify(AssessmentLaunchRequestSchema)).not.toMatch(/TECHNICAL_DEMO/);
  });

  it('the frozen-snapshot execution path is OFF, by a constant no configuration can flip', () => {
    expect(CANONICAL_EXECUTION_ENABLED).toBe(false);
    const r = parseLaunchRequest(base);
    expect(r.ok && executionPathFor(r.request)).toBe('EXISTING_RUNTIME');
    expect(code('src/lib/assessment-experience/launch.ts')).not.toMatch(/process\.env|isCanonicalEngineV1Enabled|STUDENT_JOURNEY_V2/);
  });
});

describe('B4 setup view -- depth is a meaning, the numbers are the Blueprint Core\'s', () => {
  it('QUICK / BALANCED / DEEP show what the solver selected; nothing is multiplied', () => {
    const view = learningSetupView(byDepth(SCENARIO(), ['C1', 'C2', 'C4']));
    expect(view.state).toBe('READY');
    expect(view.depthOptions.map((o) => [o.depth, o.preview.availability, o.preview.effort.questions, o.preview.effort.minutes, o.preview.canStart])).toEqual([['QUICK', 'AVAILABLE', 2, null, true], ['BALANCED', 'AVAILABLE', 4, null, true], ['DEEP', 'PARTIAL', 4, null, true]]);
    expect(view.depthOptions[2].preview.limitations).toEqual(['NOT_ENOUGH_QUESTIONS']);
    expect(view.depthOptions.every((o) => o.preview.targets.requested === 3 && o.preview.targets.covered === 3)).toBe(true);
    // the same depth on a different bank is a different number: the UI could not have computed it
    expect(previewOf(learn([cached('X', 'C1', {}, [['C2', 'PRIMARY'], ['C4', 'PRIMARY']])], ['C1', 'C2', 'C4'], 'QUICK')).effort.questions).toBe(1);
  });

  it('duration is shown only when recorded; an unknown duration is null, never a placeholder', () => {
    expect(learningSetupView(byDepth(SCENARIO(120), ['C1', 'C2', 'C4'])).depthOptions.map((o) => o.preview.effort)).toEqual([{ questions: 2, minutes: 4 }, { questions: 4, minutes: 8 }, { questions: 4, minutes: 8 }]);
    expect(learningSetupView(byDepth(SCENARIO(), ['C1', 'C2', 'C4'])).depthOptions.every((o) => o.preview.effort.minutes === null)).toBe(true);
  });

  it('insufficient coverage, unresolved scope and unverifiable time are governed states, not errors', () => {
    const nothing = learningSetupView(byDepth([], ['C1']));
    expect(nothing).toMatchObject({ state: 'UNAVAILABLE' });
    expect(nothing.depthOptions.every((o) => !o.preview.canStart && o.preview.effort.questions === null && o.preview.limitations.join() === 'NOT_ENOUGH_QUESTIONS')).toBe(true);
    const partial = learningSetupView(byDepth([cached('a', 'C1')], ['C1', 'C2']));
    expect(partial.state).toBe('PARTIAL');
    expect(partial.depthOptions[0].preview).toMatchObject({ availability: 'PARTIAL', targets: { requested: 2, covered: 1 }, effort: { questions: 1 } });
    const timed = singleSetupView(learn(SCENARIO(), ['C1'], 'QUICK', 'CUSTOM_CONCEPT_PRACTICE', 10));
    expect(timed).toMatchObject({ state: 'UNAVAILABLE', preview: { limitations: ['TIME_CANNOT_BE_ESTIMATED'], canStart: false } });
    // internal causes never reach the view
    expect(JSON.stringify([nothing, partial, timed])).not.toMatch(/NO_ELIGIBLE_CANDIDATE|DURATION_UNKNOWN|UNRESOLVED_TARGET|INSUFFICIENT_COVERAGE|ONLY_WEAKER/);
  });

  it('the setup read model asks the Blueprint Core per depth and resolves a curriculum node of any framework', async () => {
    const calls: Array<{ depth: string; concepts: readonly string[] | undefined }> = [];
    const solve = async (_s: string, r: { depth: 'QUICK' | 'BALANCED' | 'DEEP'; canonicalConceptIds?: readonly string[] }) => { calls.push({ depth: r.depth, concepts: r.canonicalConceptIds }); return { ok: true as const, solution: learn(SCENARIO(), ['C1', 'C2', 'C4'], r.depth) }; };
    const request = (scope: object, intent = 'TOPIC_PRACTICE') => { const p = parseLaunchRequest({ origin: 'LEARNING_PATH', family: 'LEARNING', intent, depth: 'BALANCED', scope }); if (!p.ok || p.request.family !== 'LEARNING') throw new Error('bad'); return p.request; };
    for (const [fixture, nodeId, expected] of [[IB, 'ib-A', [FORCE, MOMENTUM]], [SCHOOL_PLAN, 'sch-u3', [FORCE]], [PROVIDER_IB_COURSE, 'prov-D1.2', [FORCE, GRAVITY, MOMENTUM]]] as const) {
      calls.length = 0;
      const r = await learningSetupForStudent(STUDENT, request({ node: { structureVersionId: fixture.scope.structureVersion.id, nodeId } }), AS_OF, { solve: solve as never, loadScope: async () => fixture.scope });
      expect(r.ok && r.canonicalConceptIds, fixture.key).toEqual([...expected]);
      expect(calls.map((c) => c.depth)).toEqual(['QUICK', 'BALANCED', 'DEEP']);
      expect(r.ok && r.view.depthOptions).toHaveLength(3);
    }
    expect(LINEAR).toBeTruthy();
    expect(await learningSetupForStudent(STUDENT, request({ node: { structureVersionId: 'x', nodeId: 'nope' } }), AS_OF, { solve: solve as never, loadScope: async () => IB.scope })).toEqual({ ok: false, reason: 'SCOPE_NOT_FOUND' });
    expect(await learningSetupForStudent(STUDENT, request({ canonicalConceptIds: ['C1'] }), AS_OF, { solve: (async () => ({ ok: false, issues: [] })) as never })).toEqual({ ok: false, reason: 'CONTEXT_UNAVAILABLE' });
    // a diagnostic has one shape: no depth choice is offered
    calls.length = 0;
    const d = await learningSetupForStudent(STUDENT, request({ canonicalConceptIds: ['C1'] }, 'DIAGNOSTIC'), AS_OF, { solve: solve as never });
    expect(d.ok && [d.view.depthOptions.length, d.view.preview !== null]).toEqual([0, true]);
    expect(calls).toHaveLength(1);
    expect(code('src/lib/assessment-experience/assessment-experience.service.ts')).not.toMatch(/INSERT|UPDATE |DELETE |persistAssessmentSnapshot|freezeAssessment|completeAssessmentEvidence|storeQuiz/);
  });
});

describe('B4 exam attempt options -- B1 semantics, never a catch-all', () => {
  const full = { fidelity: 'FULL' as const, reasons: [] };
  const reduced = { fidelity: 'REDUCED' as const, reasons: [] };
  const row = (o: ReturnType<typeof examAttemptOptions>) => o.map((x) => [x.type, x.available, x.reason]);

  it('four distinct attempt types in a fixed order', () => {
    expect(examAttemptOptions({ officialForm: { status: 'READY' }, fidelity: full, difficultyBandMet: true, practiceContentAvailable: true }).map((o) => o.type)).toEqual(['EXAM_PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK', 'EXAM_CHALLENGE']);
  });

  it('a full mock is offered only when B1 would store a FULL_MOCK; otherwise it is unavailable with a reason, never downgraded', () => {
    expect(row(examAttemptOptions({ officialForm: { status: 'READY' }, fidelity: full, difficultyBandMet: true, practiceContentAvailable: true }))).toEqual([['EXAM_PRACTICE', true, null], ['REDUCED_MOCK', false, 'FIDELITY_NOT_VERIFIED'], ['FULL_MOCK', true, null], ['EXAM_CHALLENGE', true, null]]);
    expect(row(examAttemptOptions({ officialForm: { status: 'READY' }, fidelity: reduced, difficultyBandMet: null, practiceContentAvailable: true }))).toEqual([['EXAM_PRACTICE', true, null], ['REDUCED_MOCK', true, null], ['FULL_MOCK', false, 'FIDELITY_NOT_VERIFIED'], ['EXAM_CHALLENGE', true, null]]);
    expect(row(examAttemptOptions({ officialForm: { status: 'READY' }, fidelity: full, difficultyBandMet: false, practiceContentAvailable: true }))[2]).toEqual(['FULL_MOCK', false, 'OFFICIAL_DIFFICULTY_NOT_MET']);
    expect(row(examAttemptOptions({ officialForm: { status: 'READY' }, fidelity: null, difficultyBandMet: true, practiceContentAvailable: true })).slice(1, 3)).toEqual([['REDUCED_MOCK', false, 'FIDELITY_NOT_VERIFIED'], ['FULL_MOCK', false, 'FIDELITY_NOT_VERIFIED']]);
  });

  it('with no eligible content (DEV today) everything is honestly unavailable', () => {
    expect(row(examAttemptOptions({ officialForm: { status: 'INSUFFICIENT_COVERAGE' }, fidelity: full, difficultyBandMet: true, practiceContentAvailable: false }))).toEqual([['EXAM_PRACTICE', false, 'CONTENT_NOT_READY'], ['REDUCED_MOCK', false, 'CONTENT_NOT_READY'], ['FULL_MOCK', false, 'CONTENT_NOT_READY'], ['EXAM_CHALLENGE', false, 'CONTENT_NOT_READY']]);
    expect(row(examAttemptOptions({ officialForm: null, fidelity: null, difficultyBandMet: null, practiceContentAvailable: false })).every(([, available]) => available === false)).toBe(true);
  });
});

describe('B4 run view -- capabilities of the frozen assessment', () => {
  it('practice may ask for help; an independent check may not; an official form shows no feedback and requires integrity', () => {
    const practice = runViewOf(freezeLearning(SCENARIO(), ['C1', 'C2', 'C4']), []);
    expect(practice.capabilities).toEqual({ canUseAIHelp: true, canShowImmediateFeedback: true, canNavigateBack: false, hasMarks: false, requiresIntegrity: false });
    expect(runViewOf(freezeLearning(SCENARIO(), ['C1', 'C2', 'C4'], PROVE), []).capabilities.canUseAIHelp).toBe(false);
    expect(runViewOf(freezeOfficial(), []).capabilities).toEqual({ canUseAIHelp: false, canShowImmediateFeedback: false, canNavigateBack: true, hasMarks: true, requiresIntegrity: true });
    expect(code('src/lib/assessment-experience/views.ts')).toMatch(/canUseAI\(\{ evidenceMode: frozen\.activity\.evidenceMode, feature: 'HINT' \}\)/);
  });

  it('progress is counted against the frozen assessment, and a resumed attempt is the same assessment', () => {
    const frozen = freezeLearning(SCENARIO(), ['C1', 'C2', 'C4']);
    const first = runViewOf(frozen, [frozen.items[0].key]);
    expect(first.progress).toEqual({ answered: 1, total: 4 });
    // resume: same snapshot, same total, whatever the live bank now holds; foreign keys do not count
    const resumed = runViewOf(frozen, [frozen.items[0].key, frozen.items[1].key, frozen.items[1].key, 'LEARNING_ITEM_CACHE:new-question']);
    expect(resumed).toMatchObject({ snapshotId: first.snapshotId, progress: { answered: 2, total: 4 } });
  });
});

describe('B4 result view -- what happened, what was demonstrated, what stayed open', () => {
  it('learning: evidence obtained vs not answered, with intended vs observed coverage; absence is not failure', () => {
    const frozen = freezeLearning([cached('a', 'C1'), cached('b', 'C2'), cached('c', 'C3'), cached('d', 'C1', { questionType: 'short_answer', difficulty: 4 }), cached('e', 'C2', { questionType: 'short_answer', difficulty: 4 }), cached('f', 'C3', { questionType: 'short_answer', difficulty: 4 })], ['C1', 'C2', 'C3']);
    const keysOf = (c: string) => frozen.items.filter((i) => i.coverage.some((x) => x.canonicalConceptId === c)).map((i) => i.key);
    const view = resultViewOf(postState(frozen, [...keysOf('C1').map((k) => scored(k, 1)), ...keysOf('C2').map((k) => scored(k, 0.2))], ['C1', 'C2', 'C3']));
    expect(view.happened).toMatchObject({ questions: 6, answered: 4, scored: 4, scorePercent: 60, marks: null });
    expect(view.concepts).toEqual([
      { canonicalConceptId: 'C1', status: 'EVIDENCE_OBTAINED', state: { before: 'LEARNING', after: 'DEVELOPING', changed: true }, direction: 'UP' },
      { canonicalConceptId: 'C2', status: 'EVIDENCE_OBTAINED', state: { before: 'LEARNING', after: 'LEARNING', changed: false }, direction: 'DOWN' },
      { canonicalConceptId: 'C3', status: 'NOT_ANSWERED', state: null, direction: null },
    ]);
    expect(view.coverage).toEqual({ intended: 3, withEvidence: 2 });
    expect(view.learningAttribution).toBe('AVAILABLE');
  });

  it('a multi-concept question credits one concept; the other is "not attributable", never "failed"', () => {
    const frozen = freezeLearning([cached('m', 'C1', {}, [['C2', 'SUPPORTING']])], ['C1', 'C2']);
    const view = resultViewOf(postState(frozen, [scored(frozen.items[0].key, 1)], ['C1', 'C2']));
    expect(view.concepts.map((c) => [c.canonicalConceptId, c.status, c.direction])).toEqual([['C1', 'EVIDENCE_OBTAINED', 'UP'], ['C2', 'NOT_ATTRIBUTABLE', null]]);
  });

  it('official exam: the score stands and learning attribution is UNAVAILABLE -- a state, not an error', () => {
    const frozen = freezeOfficial();
    const view = resultViewOf(postState(frozen, frozen.items.map((i) => scored(i.key, 0.5)), ['C1', 'C2', 'C3'], 'att-1'));
    expect(view.happened).toMatchObject({ questions: 2, scored: 2, scorePercent: 50, marks: { obtained: 2, available: 4 } });
    expect(view.learningAttribution).toBe('UNAVAILABLE');
    expect(view.concepts.every((c) => c.status === 'NOT_ATTRIBUTABLE' && c.state === null)).toBe(true);
    expect(view.coverage.withEvidence).toBe(0);
  });

  it('a technical demonstration never reports learner evidence', () => {
    const frozen = freezeOfficial('TECHNICAL_DEMO');
    expect(resultViewOf(postState(frozen, frozen.items.map((i) => scored(i.key, 1)), ['C1', 'C2', 'C3'], 'att-1')).learningAttribution).toBe('NOT_APPLICABLE');
  });
});

describe('B4 continuation -- the primary step is an authority\'s, or the way back to where it is shown', () => {
  const ready = { status: 'READY' as const, authority: 'CANONICAL' as const, conceptId: 'c3', subjectId: 's1', activityType: 'PRACTICE' as const, challenge: 'PRACTICE' as const, stage: null, reinforce: false, itemCount: 6, facts: [] };

  it('renders what it was given; it ranks nothing', () => {
    expect(continuationViewOf({ resolution: { status: 'LAUNCH', launchTarget: '/dashboard/quiz?x=1', activityType: 'SOLO_CHECK', source: 'CANONICAL_ENGINE_V1' } })).toEqual({ authority: 'CANONICAL', primary: { kind: 'LAUNCH', href: '/dashboard/quiz?x=1', activityType: 'SOLO_CHECK' }, secondary: [] });
    expect(continuationViewOf({ nextChallenge: ready })).toMatchObject({ authority: 'CANONICAL', primary: { kind: 'NEXT_CHALLENGE', href: '/dashboard/today', conceptId: 'c3', activityType: 'PRACTICE' } });
    expect(continuationViewOf({ resolution: { status: 'WAITING', waitingReason: 'RETENTION_NOT_DUE', nextEligibleAt: '2026-10-12T00:00:00.000Z' } }).primary).toEqual({ kind: 'WAITING', href: '/dashboard/today', nextEligibleAt: '2026-10-12T00:00:00.000Z' });
  });

  it('there is always a primary step: with no canonical action it returns to Today, never a dead end', () => {
    for (const facts of [{}, { nextChallenge: null }, { resolution: { status: 'RETURN_TO_MISSION' as const, reason: 'NO_CANONICAL_ACTION' as const } }, { nextChallenge: { status: 'CONSOLIDATED' as const, authority: 'CANONICAL' as const, conceptId: 'c', subjectId: 's', stage: null } }]) {
      expect(continuationViewOf(facts)).toMatchObject({ authority: 'NONE', primary: { kind: 'RETURN', href: '/dashboard/today' } });
    }
    expect(continuationViewOf({ secondary: [{ kind: 'BACK_TO_EXAM_PREP', href: '/dashboard/exam-prep/x' }] }).secondary).toEqual([{ kind: 'BACK_TO_EXAM_PREP', href: '/dashboard/exam-prep/x' }]);
    // an exam gap is not an input: it cannot become the next step here
    expect(code('src/lib/assessment-experience/continuation.ts')).not.toMatch(/gap|ExamGap|severity|classification/i);
  });
});

/* ================================================================== */

let C: typeof import('@/components/assessment/AssessmentExperience');
beforeAll(async () => {
  (globalThis as any).React = React;
  C = await import('@/components/assessment/AssessmentExperience');
});
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
/** Visible text only: tags (and their attributes, which legitimately carry codes) removed. */
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const RAW_CODES = /\b(QUICK|BALANCED|DEEP|FULL_MOCK|REDUCED_MOCK|EXAM_PRACTICE|EXAM_CHALLENGE|MINI_MOCK|NOT_ATTRIBUTABLE|EVIDENCE_OBTAINED|DERIVED_ONLY|INSUFFICIENT_COVERAGE|PARTIAL|UNAVAILABLE|NEXT_CHALLENGE|TECHNICAL_DEMO|undefined|null|NaN)\b/;

describe('B4 shared components', () => {
  const t = getMessages('es');
  const setup = (): AssessmentSetupView => learningSetupView(byDepth(SCENARIO(120), ['C1', 'C2', 'C4']));

  it('setup: three semantic choices in a real form; effort shown as the contract states it', () => {
    const out = html(createElement(C.AssessmentSetup, { view: setup(), t, scopeLabel: 'Funciones cuadráticas', action: '/dashboard/learn', hidden: { subjectId: 's1' }, backHref: '/dashboard/learn' }));
    expect(text(out)).toContain('Repaso rápido');
    expect(text(out)).toContain('Práctica completa');
    expect(text(out)).toContain('Profundizar');
    expect(text(out)).toContain('2 preguntas · ~4 min');
    expect(text(out)).toContain('4 preguntas · ~8 min');
    const radios = out.match(/<input type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(3);
    expect(radios.every((r) => /name="depth"/.test(r))).toBe(true);
    // the default is the middle depth, when it can start; it is a default, not a recommendation engine
    expect(radios.filter((r) => /checked=""/.test(r))).toEqual([expect.stringContaining('value="BALANCED"')]);
    expect(out).toMatch(/<fieldset[^>]*><legend[^>]*>¿Cómo quieres practicar\?<\/legend>/);
    const form = /<form[^>]*>/.exec(out)![0];
    expect(form).toMatch(/action="\/dashboard\/learn"/);
    expect(form).toMatch(/method="get"/);
    const hidden = (out.match(/<input[^>]*type="hidden"[^>]*>/g) ?? []).join();
    expect(hidden).toMatch(/name="subjectId"/);
    expect(hidden).toMatch(/value="s1"/);
    expect(out).toMatch(/<button[^>]*type="submit"[^>]*>Comenzar<\/button>/);
    // no control lets the Student set a number of questions
    expect(out).not.toMatch(/type="range"|type="number"|name="maxQuestions"|name="count"/);
    expect(text(out)).not.toMatch(RAW_CODES);
  });

  it('setup: unknown duration shows no time at all; one preview-less question count is still shown', () => {
    const out = text(html(createElement(C.AssessmentSetup, { view: learningSetupView(byDepth(SCENARIO(), ['C1', 'C2', 'C4'])), t, action: '/x', backHref: '/y' })));
    expect(out).toContain('2 preguntas');
    expect(out).not.toMatch(/min\b|~/);
    expect(C.effortText({ questions: 11, minutes: 22 }, t)).toBe('11 preguntas · ~22 min');
    expect(C.effortText({ questions: 1, minutes: null }, t)).toBe('1 pregunta');
    expect(C.effortText({ questions: null, minutes: null }, t)).toBeNull();
  });

  it('setup: partial and unavailable are learner-safe states; an unavailable practice has no start control', () => {
    const partial = html(createElement(C.AssessmentSetup, { view: learningSetupView(byDepth([cached('a', 'C1')], ['C1', 'C2'])), t, action: '/x', backHref: '/y' }));
    expect(text(partial)).toContain('Podemos practicar parte de este tema.');
    expect(text(partial)).toContain('Aún no tenemos suficientes preguntas para cubrirlo completo.');
    expect(text(partial)).toContain('Cubre 1 de 2 conceptos');
    const none = html(createElement(C.AssessmentSetup, { view: learningSetupView(byDepth([], ['C1'])), t, action: '/x', backHref: '/back' }));
    expect(text(none)).toContain('Esta práctica todavía no está disponible.');
    expect(none).not.toMatch(/<button[^>]*type="submit"/);
    expect((none.match(/<input[^>]*type="radio"[^>]*>/g) ?? []).filter((r) => /disabled=""/.test(r))).toHaveLength(3);
    expect(none).toMatch(/<a href="\/back" class="btn btn-primary">Volver<\/a>/);
    expect(none).toMatch(/role="status"/);
    expect(text(partial + none)).not.toMatch(RAW_CODES);
  });

  it('exam options: governed names; an unavailable mock is text with a reason, never a link', () => {
    const options = examAttemptOptions({ officialForm: { status: 'READY' }, fidelity: { fidelity: 'REDUCED', reasons: [] }, difficultyBandMet: null, practiceContentAvailable: true });
    const out = html(createElement(C.ExamAttemptOptions, { options, t, hrefs: { EXAM_PRACTICE: '/p', REDUCED_MOCK: '/r', FULL_MOCK: '/f', EXAM_CHALLENGE: '/c' } }));
    for (const name of ['Práctica de examen', 'Simulacro reducido', 'Simulacro completo', 'Reto de examen']) expect(text(out)).toContain(name);
    expect(out).toMatch(/href="\/r"/);
    expect(out).not.toMatch(/href="\/f"/);
    expect(text(out)).toContain('No disponible todavía');
    expect(text(out)).toContain('Todavía no podemos garantizar que reproduzca el examen oficial.');
    expect(text(out)).not.toMatch(RAW_CODES);
  });

  it('run header: accessible progress from the frozen total, and the help line follows the capability', () => {
    const practice = html(createElement(C.AssessmentRunHeader, { view: runViewOf(freezeLearning(SCENARIO(), ['C1', 'C2', 'C4']), []), t, title: 'Tema' }));
    expect(practice).toMatch(/role="progressbar" aria-label="Progreso" aria-valuemin="0" aria-valuemax="4" aria-valuenow="0"/);
    expect(text(practice)).toContain('Puedes pedir una pista');
    expect(text(html(createElement(C.AssessmentRunHeader, { view: runViewOf(freezeLearning(SCENARIO(), ['C1', 'C2', 'C4'], PROVE), []), t, title: 'Tema' })))).toContain('Sin ayuda: demuestra lo que sabes');
    expect(text(html(createElement(C.AssessmentRunHeader, { view: runViewOf(freezeOfficial(), []), t, title: 'Examen' })))).toContain('Condiciones de examen');
  });

  it('result: an official score with no learning attribution renders as information, with no concept table', () => {
    const frozen = freezeOfficial();
    const view = resultViewOf(postState(frozen, frozen.items.map((i) => scored(i.key, 0.5)), ['C1', 'C2', 'C3'], 'att-1'));
    const out = html(createElement(C.AssessmentResult, { view, t, conceptLabels: { C1: 'Uno', C2: 'Dos', C3: 'Tres' } }));
    expect(text(out)).toContain('2 de 4 puntos');
    expect(text(out)).toContain('Tu puntaje está listo.');
    expect(out).toMatch(/role="status"/);
    expect(out).not.toMatch(/role="alert"/);
    expect(text(out)).not.toContain('Lo que demostraste');
    expect(text(out)).not.toMatch(RAW_CODES);
  });

  it('result: learning rows distinguish obtained / not answered / not attributable, and never say "failed"', () => {
    const frozen = freezeLearning([cached('m', 'C1', {}, [['C2', 'SUPPORTING']]), cached('z', 'C3')], ['C1', 'C2', 'C3']);
    const view = resultViewOf(postState(frozen, [scored('LEARNING_ITEM_CACHE:m', 1)], ['C1', 'C2', 'C3']));
    const out = text(html(createElement(C.AssessmentResult, { view, t, conceptLabels: { C1: 'Uno', C2: 'Dos', C3: 'Tres' } })));
    expect(out).toContain('Esta práctica cubría 3 conceptos. Registramos evidencia en 1.');
    expect(out).toMatch(/Uno Avanzaste Evidencia registrada/);
    expect(out).toMatch(/Dos Aún no cuenta para este concepto/);
    expect(out).toMatch(/Tres Sin responder/);
    expect(out).not.toMatch(/fall|reprob|incorrect|dominad|maestr/i);
    expect(out).not.toMatch(RAW_CODES);
  });

  it('continuation: one primary link, canonical when there is one', () => {
    const canonicalStep = html(createElement(C.AssessmentContinuation, { view: continuationViewOf({ nextChallenge: { status: 'READY', authority: 'CANONICAL', conceptId: 'c3', subjectId: 's1', activityType: 'PRACTICE', challenge: 'PRACTICE', stage: null, reinforce: false, itemCount: null, facts: [] }, secondary: [{ kind: 'BACK_TO_EXAM_PREP', href: '/dashboard/exam-prep/p' }] }), t, conceptLabel: 'Factorización' }));
    expect(canonicalStep).toMatch(/data-authority="CANONICAL" data-primary="NEXT_CHALLENGE"/);
    expect(canonicalStep.match(/class="btn btn-primary btn-lg"/g)).toHaveLength(1);
    expect(canonicalStep).toMatch(/<a href="\/dashboard\/today" class="btn btn-primary btn-lg">Continuar con tu siguiente reto: Factorización<\/a>/);
    expect(canonicalStep).toMatch(/<a href="\/dashboard\/exam-prep\/p" class="btn btn-ghost">Volver a preparación de examen<\/a>/);
    const fallback = html(createElement(C.AssessmentContinuation, { view: continuationViewOf({}), t }));
    expect(fallback).toMatch(/data-authority="NONE" data-primary="RETURN"/);
    expect(fallback).toMatch(/<a href="\/dashboard\/today" class="btn btn-primary btn-lg">Ir a Hoy<\/a>/);
  });

  it('every locale renders every screen with its own words and no raw code', () => {
    const frozen = freezeOfficial();
    const official = resultViewOf(postState(frozen, frozen.items.map((i) => scored(i.key, 1)), ['C1', 'C2', 'C3'], 'att-1'));
    for (const locale of LOCALES) {
      const tl = getMessages(locale);
      const all = [
        html(createElement(C.AssessmentSetup, { view: setup(), t: tl, action: '/x', backHref: '/y' })),
        html(createElement(C.AssessmentSetup, { view: learningSetupView(byDepth([], ['C1'])), t: tl, action: '/x', backHref: '/y' })),
        html(createElement(C.ExamAttemptOptions, { options: examAttemptOptions({ officialForm: null, fidelity: null, difficultyBandMet: null, practiceContentAvailable: false }), t: tl, hrefs: {} })),
        html(createElement(C.AssessmentRunHeader, { view: runViewOf(frozen, []), t: tl, title: 'X' })),
        html(createElement(C.AssessmentResult, { view: official, t: tl, conceptLabels: {} })),
        html(createElement(C.AssessmentContinuation, { view: continuationViewOf({}), t: tl })),
      ].join(' ');
      expect(text(all), locale).not.toMatch(RAW_CODES);
      expect(text(all), locale).not.toMatch(/ax\.|ex\.type\./);
    }
    const keys = Object.keys(ASSESSMENT_EXPERIENCE_MESSAGES.es).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(ASSESSMENT_EXPERIENCE_MESSAGES[locale]).sort(), locale).toEqual(keys);
      for (const k of keys) expect((getMessages(locale) as Record<string, string>)[k], `${locale} ${k}`).toBeTruthy();
    }
    // the copy is the Student's language, not the architecture's
    for (const locale of LOCALES) expect(Object.values(ASSESSMENT_EXPERIENCE_MESSAGES[locale]).join(' '), locale).not.toMatch(/blueprint|solver|snapshot|engine|motor|algorit|\bIA\b|\bAI\b|\bKI\b/i);
  });
});

/* ================================================================== */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const EXPERIENCE = [...walk('src/lib/assessment-experience'), 'src/components/assessment/AssessmentExperience.tsx'];

describe('B4 authority guardrails', () => {
  it('the experience layer selects nothing, sizes nothing and computes no mastery', () => {
    for (const f of EXPERIENCE) {
      const c = code(f);
      expect(c, f).not.toMatch(/Math\.random|shuffle|\.sort\(\(\) =>/);
      expect(c, f).not.toMatch(/length\s*\*\s*\d|\*\s*(questionsPer|perConcept)|questionsPerConcept|maxQuestions|questionCount\s*=/);
      expect(c, f).not.toMatch(/masteryScore|mastery_state|calculateMastery|updateMastery|>=\s*(70|80)\b|minimumScorePercent|threshold/i);
      expect(c, f).not.toMatch(/toLowerCase\(\)\s*===|localeCompare\([^)]*label|\.name\s*===/);
      expect(c, f).not.toMatch(/solveBlueprint\(|solveLearningBlueprint\(|solveOfficialBlueprint\(|freezeAssessment\(|completeAssessmentEvidence\(|persistAssessmentSnapshot\(/);
    }
  });

  it('nothing forks on a curriculum framework or an exam family name', () => {
    const terms = /\b(IB|IBO|IGCSE|CAMBRIDGE|SEP|MEN|PAA|SABER|ICFES|AICE)\b/;
    for (const f of EXPERIENCE) expect(code(f), f).not.toMatch(terms);
  });

  it('TECHNICAL_DEMO is absent from the learner experience: components, copy, launch requests and attempt options', () => {
    expect(code('src/components/assessment/AssessmentExperience.tsx')).not.toMatch(/TECHNICAL_DEMO|contentAudience/);
    expect(code('src/lib/assessment-experience/launch.ts')).not.toMatch(/TECHNICAL_DEMO|contentAudience/);
    expect(code('src/lib/assessment-experience/continuation.ts')).not.toMatch(/TECHNICAL_DEMO/);
    for (const locale of LOCALES) expect(JSON.stringify(ASSESSMENT_EXPERIENCE_MESSAGES[locale])).not.toMatch(/TECHNICAL_DEMO|technical demo|demostración técnica/i);
    expect(examAttemptOptions({ officialForm: { status: 'READY' }, fidelity: { fidelity: 'FULL', reasons: [] }, difficultyBandMet: true, practiceContentAvailable: true }).map((o) => o.type)).not.toContain('TECHNICAL_DEMO');
    // the one place it appears is the result view, to say "no learner evidence" -- never as an option or a label
    expect(code('src/lib/assessment-experience/views.ts').match(/TECHNICAL_DEMO/g)).toBeNull();
    // and the student listings still exclude it at the source
    expect(read('src/lib/exam-core/exam-instance.service.ts')).toMatch(/content_audience' IS DISTINCT FROM 'TECHNICAL_DEMO'/);
  });

  it('no dead end on a result: the exam result, the assigned practice and the multi-concept quiz all continue', () => {
    const examResult = code('src/app/dashboard/exam-prep/attempt/[attemptId]/result/page.tsx');
    expect(examResult).toMatch(/<AssessmentContinuation view=\{continuation\}/);
    expect(examResult).toMatch(/continuationViewOf\(\{ nextChallenge: nextChallenge\?\.view \?\? null/);
    expect(examResult).toMatch(/presentSnapshotNextChallenge\(snapshot\)/);
    // the page no longer picks "the first gap" as the next step; per-concept study links stay secondary
    expect(examResult).not.toMatch(/firstGapConcept/);
    // ... and nothing else on the page competes with it as a primary action
    expect(examResult.match(/className="btn btn-primary"/g) ?? []).toHaveLength(0);
    const practice = code('src/app/dashboard/assignments/practice/PracticeRunner.tsx');
    expect(practice.match(/href="\/dashboard\/today" className="btn btn-primary"/g)).toHaveLength(2);
    const quiz = read('src/app/dashboard/quiz/page.tsx');
    expect(quiz).toMatch(/!canonicalNextShown && continuation\(false\) === null && \(\s*<section className="card ls-panel ls-next" data-testid="results-next-step-fallback">/);
  });

  it('no exam gap is placed on Today by the experience layer', () => {
    for (const f of EXPERIENCE) expect(code(f), f).not.toMatch(/dailyPlan|nextExecutableItem|learning_plan|student_plan_entries/);
    expect(code('src/app/dashboard/today/page.tsx')).not.toMatch(/examGaps|ExamGapCandidate|assessment-experience/);
  });

  it('no runtime cutover: no route imports the Blueprint Core service or the execution service, and no start is wired', () => {
    const app = walk('src/app');
    expect(app.filter((f) => /assessment-execution\.service|assessment-blueprint\.service|assessment-experience\.service/.test(read(f)))).toEqual([]);
    expect(app.filter((f) => /persistAssessmentSnapshot|completeAssessmentEvidence|freezeAssessment|solveLearningForStudent/.test(read(f)))).toEqual([]);
    // the two existing evidence write sites are untouched
    expect(read('src/app/api/quizzes/generate-and-take/route.ts')).toMatch(/await updateMastery\(\{/);
    expect(read('src/lib/simulation/scoring.service.ts')).toMatch(/await updateMastery\(\{/);
  });

  it('the fixture preview is local-only and touches no data', () => {
    const page = code('src/app/experience-preview/page.tsx');
    expect(page).toMatch(/if \(process\.env\.NODE_ENV === 'production' \|\| process\.env\.VERCEL_ENV\) notFound\(\);/);
    expect(page).not.toMatch(/@\/lib\/db|\.service'|auth\(\)|getOrCreateStudentId|fetch\(/);
  });

  it('B4 adds no migration', () => {
    const migrations = readdirSync(join(ROOT, 'database/migrations')).filter((f) => f.endsWith('.sql')).sort();
    expect(migrations).toHaveLength(80);
    expect(migrations.at(-1)).toBe('20261110_1800_assessment_snapshot.sql');
  });
});

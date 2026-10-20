/**
 * B1 -- Blueprint contracts (three families), EvidenceAttribution (no double credit), GeneratedAssessmentSnapshot,
 * ExamGapCandidate, PreparationContext / StudentAssessmentContext and the continuation extensions.
 * Domain / contract tests: pure, no database.
 */
import { describe, it, expect } from 'vitest';
import {
  BlueprintRequirementSchema,
  BlueprintResultSchema,
  learningRequirementFromActivityContract,
  officialRequirementFromFormPositions,
  officialResultFromAssembledForm,
  parseBlueprintRequirement,
  parseBlueprintResult,
} from '@/lib/assessment-foundation/blueprint-contract';
import { ADAPTS_TO_LEARNER, ASSESSMENT_FAMILIES, COUNT_AUTHORITY } from '@/lib/assessment-foundation/families';
import { attributionViolations, claimsFullIndependentEvidence, planEvidenceAttribution, type AttributionRequest } from '@/lib/assessment-foundation/evidence-attribution';
import { coverageOfLearningCacheItem, coverageOfReviewedBankItem, type QuestionCoverage } from '@/lib/assessment-foundation/question-coverage';
import { snapshotFromExamInstance, snapshotFromQuizSession } from '@/lib/assessment-foundation/generated-assessment';
import { ExamGapCandidateSchema, examGapCandidateFrom, gapSeverity } from '@/lib/assessment-foundation/exam-gap-candidate';
import { isPlannablePreparation, projectPreparationContext } from '@/lib/assessment-foundation/preparation-context';
import { composeStudentAssessmentContext, learnerConceptFor, validateAssessmentIntent } from '@/lib/assessment-foundation/student-assessment-context';
import { continuationConcept, isCrossConceptContinuation, withAssessmentContext, CONTINUATION_CONTRACT_VERSION, type ContinuationResolution, type LearningOrigin } from '@/lib/lx/continuation';
import type { ActivityContract } from '@/lib/pedagogical-engine/types';
import type { AssembledForm, FormPosition } from '@/lib/exam-core/form-assembly';
import type { StudentExamProfile } from '@/lib/assessment/types';

const POLICY = { id: 'test-policy', version: '1' };

const proveContract: ActivityContract = {
  activityType: 'PROVE',
  itemCount: { min: 10, max: 10 },
  difficulty: { target: 3, min: 3, max: 4, reasonCode: 'PROVE_DIFFICULTY_FROM_QUALIFYING_PRACTICE' },
  independence: true,
  supportLevel: 'NONE',
  minimumScorePercent: 80,
  evidenceContract: 'PROVE_V1_EXACT10',
  noveltyRequirements: 'NOVEL_ITEMS_REQUIRED',
} as ActivityContract;

const positions: FormPosition[] = [
  { index: 0, blueprintObjectiveTargetId: 't0', assessmentComponentId: 'comp-1', learningObjectiveId: 'lo-1', questionType: 'multiple_choice', difficultyRange: { min: 2, max: 4 }, constraints: [{ dimension: 'MARKS', value: '1' }] as FormPosition['constraints'] },
  { index: 1, blueprintObjectiveTargetId: 't1', assessmentComponentId: 'comp-2', learningObjectiveId: 'lo-2', questionType: null, difficultyRange: null },
];

const official = () => officialRequirementFromFormPositions({ studentId: 'stu-1', examTargetId: 'target-1', examVersionId: 'ev-1', blueprintId: 'bp-1', positions, policy: POLICY, officialMinutes: 90 });

describe('B1 Blueprint contracts -- one contract, three families', () => {
  it('the three families exist, with distinct count authorities and adaptation rules', () => {
    expect([...ASSESSMENT_FAMILIES]).toEqual(['LEARNING', 'EXAM_PREPARATION', 'OFFICIAL_EXAM']);
    expect(COUNT_AUTHORITY).toEqual({ LEARNING: 'EVIDENCE_REQUIREMENTS', EXAM_PREPARATION: 'PREPARATION_POLICY', OFFICIAL_EXAM: 'OFFICIAL_BLUEPRINT' });
    expect(ADAPTS_TO_LEARNER).toEqual({ LEARNING: true, EXAM_PREPARATION: true, OFFICIAL_EXAM: false });
    // no question store is a count authority
    expect(Object.values(COUNT_AUTHORITY).some((a) => /BANK|STORE|CACHE/.test(a))).toBe(false);
  });

  it('LEARNING: the canonical ActivityContract is carried over verbatim as evidence needs', () => {
    const r = learningRequirementFromActivityContract({ studentId: 'stu-1', canonicalConceptId: 'c-1', contract: proveContract, policy: POLICY });
    expect(r.family).toBe('LEARNING');
    expect(r.targets.canonicalConceptIds).toEqual(['c-1']);
    expect(r.evidence).toEqual({ activityType: 'PROVE', itemCount: { min: 10, max: 10 }, independence: true, supportLevel: 'NONE', minimumScorePercent: 80, evidenceContract: 'PROVE_V1_EXACT10', novelItemsRequired: true });
    expect(r.difficulty).toEqual({ min: 3, max: 4, target: 3, reasonCode: 'PROVE_DIFFICULTY_FROM_QUALIFYING_PRACTICE' });
    expect(r.official).toBeNull();
    expect(r.emphasis).toBeNull();
  });

  it('LEARNING: an engine contract with no item count (LEARN) stays null -- never an invented number', () => {
    const r = learningRequirementFromActivityContract({ studentId: 'stu-1', canonicalConceptId: 'c-1', contract: { ...proveContract, activityType: 'LEARN_CHECK', itemCount: null } as ActivityContract, policy: POLICY });
    expect(r.evidence?.itemCount).toBeNull();
  });

  it('OFFICIAL_EXAM: expresses fidelity -- one slot per blueprint position, frozen, never adaptive', () => {
    const r = official();
    expect(r.official?.slots.map((s) => s.blueprintObjectiveTargetId)).toEqual(['t0', 't1']);
    expect(r.official?.slots[0]).toMatchObject({ learningObjectiveId: 'lo-1', questionType: 'multiple_choice', difficultyRange: { min: 2, max: 4 } });
    expect(r.official?.frozenSelectionRequired).toBe(true);
    expect(r.official?.adaptsToLearner).toBe(false);
    expect(r.exam).toEqual({ examTargetId: 'target-1', examVersionId: 'ev-1', assessmentComponentIds: ['comp-1', 'comp-2'] });
    expect(r.time).toEqual({ availableMinutes: null, officialMinutes: 90 });
  });

  it('OFFICIAL_EXAM cannot carry adaptive emphasis, learner evidence needs or learner-chosen targets', () => {
    const base = official();
    const bad = (over: Record<string, unknown>) => parseBlueprintRequirement({ ...base, ...over });
    expect(bad({ emphasis: { objective: 'CLOSE_GAPS', gapConceptIds: ['c-1'], gapObjectiveIds: [], mayDeviateFromOfficialDistribution: true } }).ok).toBe(false);
    expect(bad({ targets: { canonicalConceptIds: ['c-1'], learningObjectiveIds: [] } }).ok).toBe(false);
    expect(bad({ official: null }).ok).toBe(false);
    expect(bad({ official: { ...base.official!, adaptsToLearner: true } }).ok).toBe(false);
    expect(bad({ official: { ...base.official!, frozenSelectionRequired: false } }).ok).toBe(false);
    expect(parseBlueprintRequirement(base).ok).toBe(true);
  });

  it('EXAM_PREPARATION: expresses adaptive emphasis and may depart from the official distribution, within exam applicability', () => {
    const prep = {
      v: 1,
      family: 'EXAM_PREPARATION',
      policy: POLICY,
      studentId: 'stu-1',
      exam: { examTargetId: 'target-1', examVersionId: 'ev-1', assessmentComponentIds: [] },
      targets: { canonicalConceptIds: ['c-1'], learningObjectiveIds: ['lo-1'] },
      emphasis: { objective: 'CLOSE_GAPS', gapConceptIds: ['c-1'], gapObjectiveIds: ['lo-1'], mayDeviateFromOfficialDistribution: true },
      time: { availableMinutes: 25, officialMinutes: null },
    };
    const ok = parseBlueprintRequirement(prep);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.requirement.emphasis?.mayDeviateFromOfficialDistribution).toBe(true);
    // still bound to an exam version, and never an official form
    expect(parseBlueprintRequirement({ ...prep, exam: null }).ok).toBe(false);
    expect(parseBlueprintRequirement({ ...prep, official: official().official }).ok).toBe(false);
  });

  it('LEARNING requires evidence needs and a canonical target, and is never an official form', () => {
    const learn = learningRequirementFromActivityContract({ studentId: 'stu-1', canonicalConceptId: 'c-1', contract: proveContract, policy: POLICY });
    expect(parseBlueprintRequirement({ ...learn, evidence: null }).ok).toBe(false);
    expect(parseBlueprintRequirement({ ...learn, targets: { canonicalConceptIds: [], learningObjectiveIds: [] } }).ok).toBe(false);
    expect(parseBlueprintRequirement({ ...learn, official: official().official }).ok).toBe(false);
  });

  it('all three families serialise and re-validate (JSON round trip)', () => {
    const learn = learningRequirementFromActivityContract({ studentId: 'stu-1', canonicalConceptId: 'c-1', contract: proveContract, policy: POLICY });
    for (const r of [learn, official()]) expect(BlueprintRequirementSchema.parse(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it('the requirement has no field through which a question store could set the count', () => {
    const keys = Object.keys(official());
    expect(keys).not.toContain('questionCount');
    expect(keys).not.toContain('itemCount');
    expect(parseBlueprintRequirement({ ...official(), questionCount: 20 }).ok).toBe(false);
  });
});

const form = (slots: AssembledForm['slots']): AssembledForm => ({ v: 1, mode: 'MOCK', targetDifficulty: 1, difficultyIndex: 1, slots, components: [], fidelity: 'FULL', coveragePercent: slots.length ? (100 * slots.filter((s) => s.approvedItemId).length) / slots.length : 0, difficultyBandMet: true, notes: ['seeded'] });
const slot = (index: number, approvedItemId: string | null): AssembledForm['slots'][number] => ({ index, blueprintObjectiveTargetId: `t${index}`, assessmentComponentId: 'comp-1', approvedItemId, marks: 2, difficultyIndex: 1, contentOrigin: 'GENERATED', ...(approvedItemId ? {} : { unfilledReason: 'NO_BANK_ITEM' as const }) });

describe('B1 BlueprintResult', () => {
  it('a complete official form is READY with reviewed-bank references and its marks', () => {
    const r = officialResultFromAssembledForm(form([slot(0, 'a'), slot(1, 'b')]), POLICY);
    expect(r.status).toBe('READY');
    expect(r.selected).toEqual([
      { question: { store: 'REVIEWED_EXAM_BANK', id: 'a' }, slotIndex: 0, marks: 2 },
      { question: { store: 'REVIEWED_EXAM_BANK', id: 'b' }, slotIndex: 1, marks: 2 },
    ]);
    expect(r.estimate).toEqual({ items: 2, marks: 4, minutes: null });
    expect(r.unmet).toEqual([]);
  });

  it('an incomplete official form is INSUFFICIENT_COVERAGE, never PARTIAL, and selects nothing', () => {
    const r = officialResultFromAssembledForm(form([slot(0, 'a'), slot(1, null)]), POLICY);
    expect(r.status).toBe('INSUFFICIENT_COVERAGE');
    expect(r.selected).toEqual([]);
    expect(r.unmet[0].constraint).toBe('OFFICIAL_SLOTS_FILLED');
    expect(parseBlueprintResult({ ...r, status: 'PARTIAL' }).ok).toBe(false);
  });

  it('an official result can never contain a learning-cache (generated) question', () => {
    const ready = officialResultFromAssembledForm(form([slot(0, 'a')]), POLICY);
    const tampered = { ...ready, selected: [{ question: { store: 'LEARNING_ITEM_CACHE', id: 'cand-1' }, slotIndex: 0, marks: 2 }] };
    expect(parseBlueprintResult(tampered).ok).toBe(false);
  });

  it('PARTIAL / INSUFFICIENT must say what is unmet; READY must not; the estimate matches the selection', () => {
    const base = { v: 1, family: 'LEARNING', policy: POLICY, selected: [{ question: { store: 'LEARNING_ITEM_CACHE', id: 'q1' } }], coverage: { canonicalConceptIds: ['c-1'] }, estimate: { items: 1 } };
    expect(parseBlueprintResult({ ...base, status: 'READY' }).ok).toBe(true);
    expect(parseBlueprintResult({ ...base, status: 'PARTIAL' }).ok).toBe(false);
    expect(parseBlueprintResult({ ...base, status: 'PARTIAL', unmet: [{ constraint: 'DIFFICULTY_MIX', detail: 'no hard item' }] }).ok).toBe(true);
    expect(parseBlueprintResult({ ...base, status: 'READY', unmet: [{ constraint: 'X' }] }).ok).toBe(false);
    expect(parseBlueprintResult({ ...base, status: 'READY', estimate: { items: 5 } }).ok).toBe(false);
    expect(BlueprintResultSchema.shape.status.options).toEqual(['READY', 'PARTIAL', 'INSUFFICIENT_COVERAGE']);
  });
});

const multi = (roles: Array<'PRIMARY' | 'SUPPORTING' | 'UNSPECIFIED'>): QuestionCoverage => {
  const base = coverageOfLearningCacheItem({ candidateId: 'q', studentId: 'stu-1', learnerConceptId: 'lc-1', activityType: 'PROVE', questionType: 'mcq', difficulty: 3, language: 'es', validationStatus: 'VALIDATED', identity: { status: 'CANONICAL', learnerConceptId: 'lc-1', canonicalConceptId: 'c-1', basis: 'REVIEWED' } });
  return { ...base, concepts: roles.map((role, i) => ({ canonicalConceptId: `c-${i + 1}`, role, basis: 'ITEM_ATTRIBUTION' as const })) };
};
const learner = new Map([['c-1', 'lc-1'], ['c-2', 'lc-2']]);
const proveReq: AttributionRequest = { family: 'LEARNING', path: 'LEARNING_ACTIVITY', assessmentRef: 'quiz-1', dimension: 'PROVE', learnerConceptByCanonical: learner, independentActivity: true };

describe('B1 EvidenceAttribution -- no double credit', () => {
  it('a correct multi-concept question is NOT full independent evidence of every mapped concept', () => {
    const a = planEvidenceAttribution(multi(['PRIMARY', 'SUPPORTING']), proveReq);
    expect(claimsFullIndependentEvidence(a, 'c-1')).toBe(true);
    expect(claimsFullIndependentEvidence(a, 'c-2')).toBe(false);
    expect(a.targets.map((t) => t.credit)).toEqual(['DIRECT', 'CONTRIBUTORY']);
    expect(a.targets.filter((t) => t.independentEvidenceEligible)).toHaveLength(1);
    expect(attributionViolations(a)).toEqual([]);
  });

  it('two PRIMARY concepts: neither is a single direct target, so neither gets full independent credit', () => {
    const a = planEvidenceAttribution(multi(['PRIMARY', 'PRIMARY']), proveReq);
    expect(a.targets.map((t) => t.credit)).toEqual(['CONTRIBUTORY', 'CONTRIBUTORY']);
    expect(a.targets.some((t) => t.independentEvidenceEligible)).toBe(false);
  });

  it('objective-level coverage (role UNSPECIFIED) gives UNDETERMINED credit for each concept', () => {
    const exam = coverageOfReviewedBankItem({
      approvedItemId: 'i', learningObjectiveId: 'lo', questionType: null, content: null, status: 'PUBLISHED', bankLifecycleStatus: 'ACTIVE', usageEligibility: null, examAlignment: null, calibrationConfidence: null, contentOrigin: null,
      sourceIds: null, bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: 'ev', assessmentComponentId: null, currentVersionId: 'i', retired: false, language: null }, sourceLicenses: [], humanReviewDecisions: 1, scope: null,
      objectiveConcepts: [{ canonicalConceptId: 'c-1', relationType: 'PARTIAL' }, { canonicalConceptId: 'c-2', relationType: 'PARTIAL' }],
    });
    const a = planEvidenceAttribution(exam, { family: 'OFFICIAL_EXAM', path: 'OFFICIAL_MOCK', assessmentRef: 'att-1', dimension: 'EXAM_PERFORMANCE', learnerConceptByCanonical: learner, independentActivity: true, examScope: { examTargetId: 't', examVersionId: 'ev', examAttemptId: 'att-1' } });
    expect(a.targets.map((t) => t.credit)).toEqual(['UNDETERMINED', 'UNDETERMINED']);
    expect(a.targets.every((t) => !t.independentEvidenceEligible)).toBe(true);
    expect(a.targets.every((t) => t.eligibleDimensions.join() === 'EXAM_PERFORMANCE')).toBe(true);
    expect(attributionViolations(a)).toEqual([]);
  });

  it('distinguishes target concepts and never invents a weight', () => {
    const a = planEvidenceAttribution(multi(['PRIMARY', 'SUPPORTING', 'SUPPORTING']), proveReq);
    expect(a.targets.map((t) => [t.canonicalConceptId, t.role])).toEqual([['c-1', 'PRIMARY'], ['c-2', 'SUPPORTING'], ['c-3', 'SUPPORTING']]);
    expect(a.targets.every((t) => t.weight.state === 'UNKNOWN')).toBe(true);
  });

  it('a concept the Student has no instance of gets no evidence dimension (nothing to hang evidence on)', () => {
    const a = planEvidenceAttribution(multi(['PRIMARY', 'SUPPORTING', 'SUPPORTING']), proveReq);
    expect(a.targets[2]).toMatchObject({ canonicalConceptId: 'c-3', learnerConceptId: null, eligibleDimensions: [] });
    expect(a.targets[0].eligibleDimensions).toEqual(['PROVE']);
  });

  it('assisted or practice activity never yields independent evidence', () => {
    expect(planEvidenceAttribution(multi(['PRIMARY']), { ...proveReq, independentActivity: false }).targets[0].independentEvidenceEligible).toBe(false);
    expect(planEvidenceAttribution(multi(['PRIMARY']), { ...proveReq, dimension: 'PRACTICE' }).targets[0].independentEvidenceEligible).toBe(false);
  });

  it('exam evidence is planned for EXAM_PERFORMANCE and requires its exam scope (G6); it never names a stage', () => {
    expect(() => planEvidenceAttribution(multi(['PRIMARY']), { ...proveReq, family: 'EXAM_PREPARATION', path: 'PREPARATION_SIMULATION' })).toThrow('EXAM_SCOPE_REQUIRED');
    const a = planEvidenceAttribution(multi(['PRIMARY']), { ...proveReq, family: 'EXAM_PREPARATION', path: 'PREPARATION_SIMULATION', examScope: { examTargetId: 't', examVersionId: 'ev', examAttemptId: 'a' } });
    expect(a.targets[0].eligibleDimensions).toEqual(['EXAM_PERFORMANCE']);
    expect(a.targets[0].independentEvidenceEligible).toBe(false);
    expect(JSON.stringify(a)).not.toMatch(/stage/i);
  });

  it('B1-C: a question whose only correspondence is TRANSITIONAL attributes to nothing', () => {
    const transitional = coverageOfLearningCacheItem({ candidateId: 'q', studentId: 'stu-1', learnerConceptId: 'lc-1', activityType: 'PROVE', questionType: 'mcq', difficulty: 3, language: 'es', validationStatus: 'VALIDATED', identity: { status: 'TRANSITIONAL', learnerConceptId: 'lc-1', canonicalConceptId: 'c-1', basis: 'LABEL_MATCH' } });
    const a = planEvidenceAttribution(transitional, proveReq);
    expect(a.targets).toEqual([]);
    expect(a.unattributed).toBe('QUESTION_HAS_NO_CANONICAL_CONCEPT');
    expect(claimsFullIndependentEvidence(a, 'c-1')).toBe(false);
  });

  it('a question with no canonical concept is reported as unattributed, not dropped silently', () => {
    const a = planEvidenceAttribution({ ...multi([]), concepts: [] }, proveReq);
    expect(a.targets).toEqual([]);
    expect(a.unattributed).toBe('QUESTION_HAS_NO_CANONICAL_CONCEPT');
  });

  it('the invariant check catches a hand-built attribution that double-credits', () => {
    const good = planEvidenceAttribution(multi(['PRIMARY', 'SUPPORTING']), proveReq);
    const doubled = { ...good, targets: good.targets.map((t) => ({ ...t, credit: 'DIRECT' as const, independentEvidenceEligible: true })) };
    expect(attributionViolations(doubled)).toEqual(expect.arrayContaining(['MULTIPLE_DIRECT_TARGETS', 'SUPPORTING_CLAIMS_INDEPENDENT']));
  });
});

describe('B1 GeneratedAssessmentSnapshot', () => {
  const instance = { id: 'inst-1', studentId: 'stu-1', examProfileId: 'target-1', examVersionId: 'ev-1', componentIds: ['comp-1'], mode: 'MOCK', form: form([slot(0, 'a'), slot(1, 'b')]), formFrozenAt: '2026-10-01T00:00:00.000Z', focusObjectiveIds: [] };

  it('official mock: REUSES the frozen exam instance (a view of it, with its item references)', () => {
    const s = snapshotFromExamInstance(instance);
    expect(s).toMatchObject({ family: 'OFFICIAL_EXAM', path: 'OFFICIAL_MOCK', record: { kind: 'EXAM_INSTANCE', id: 'inst-1' }, frozen: true });
    expect(s.selected).toEqual({ state: 'KNOWN', value: [{ question: { store: 'REVIEWED_EXAM_BANK', id: 'a' }, slotIndex: 0 }, { question: { store: 'REVIEWED_EXAM_BANK', id: 'b' }, slotIndex: 1 }] });
    expect(s.exam).toEqual({ state: 'KNOWN', value: { examVersionId: 'ev-1', examTargetId: 'target-1', assessmentComponentIds: ['comp-1'] } });
  });

  it('a practice instance is exam practice (preparation family), not an official mock', () => {
    expect(snapshotFromExamInstance({ ...instance, mode: 'PRACTICE' })).toMatchObject({ family: 'EXAM_PREPARATION', path: 'EXAM_PRACTICE' });
  });

  it('a MOCK instance whose form is not frozen is not described as an official mock', () => {
    const s = snapshotFromExamInstance({ ...instance, form: null, formFrozenAt: null });
    expect(s.frozen).toBe(false);
    expect(s.path).not.toBe('OFFICIAL_MOCK');
    expect(s.selected).toEqual({ state: 'UNKNOWN' });
  });

  it('learning: projects what a quiz session already records; a legacy session reports UNKNOWN, not a reconstruction', () => {
    const canonical = snapshotFromQuizSession({ id: 'q1', studentId: 'stu-1', conceptId: 'lc-1', conceptIds: ['lc-1'], questions: [{}, {}, {}], pedagogicalPolicyVersion: 'policy-v2', canonicalStage: 'PROVE', canonicalActivityContract: { itemCount: 3 }, deliverySource: 'INVENTORY', createdAt: '2026-10-02T00:00:00.000Z' }, ['c-1']);
    expect(canonical).toMatchObject({ family: 'LEARNING', path: 'LEARNING_ACTIVITY', record: { kind: 'QUIZ_SESSION', id: 'q1' }, frozen: true });
    expect(canonical.policy).toEqual({ state: 'KNOWN', value: { id: 'canonical-pedagogical-policy', version: 'policy-v2' } });
    expect(canonical.itemCount).toEqual({ state: 'KNOWN', value: 3 });
    expect(canonical.targets.canonicalConceptIds).toEqual({ state: 'KNOWN', value: ['c-1'] });
    expect(canonical.targets.learnerConceptIds).toEqual({ state: 'KNOWN', value: ['lc-1'] });
    expect(canonical.exam).toEqual({ state: 'NOT_APPLICABLE' });

    const legacy = snapshotFromQuizSession({ id: 'q0', studentId: 'stu-1', conceptId: null, conceptIds: null, questions: [{}], pedagogicalPolicyVersion: null, canonicalStage: null, canonicalActivityContract: null, deliverySource: null, createdAt: null });
    expect(legacy.policy).toEqual({ state: 'UNKNOWN' });
    expect(legacy.targets.canonicalConceptIds).toEqual({ state: 'UNKNOWN' });
    expect(legacy.rationale).toEqual({ state: 'UNKNOWN' });
    expect(legacy.itemCount).toEqual({ state: 'KNOWN', value: 1 });
  });
});

describe('B1 ExamGapCandidate -- Exam Preparation publishes, it does not place', () => {
  const gap = { studentId: 'stu-1', canonicalConceptId: 'c-1', examProfileId: 'target-1', examAttemptId: 'att-1', learningObjectiveId: 'lo-1', fraction: 0.2, at: '2026-10-03T00:00:00.000Z' };

  it('projects the existing gap read with its evidence, target and severity', () => {
    const c = examGapCandidateFrom(gap, { assessmentComponentId: 'comp-1', blueprintTargets: 4, targetDate: '2027-05-01', intendedSession: { series: 'MAY', year: 2027 } });
    expect(c).toMatchObject({ canonicalConceptId: 'c-1', examTargetId: 'target-1', examAttemptId: 'att-1', severity: 'HIGH', evidence: { fraction: 0.2 }, relevance: { assessmentComponentId: 'comp-1', blueprintTargets: 4 }, urgency: { targetDate: '2027-05-01' } });
    expect(gapSeverity(0.3)).toBe('MEDIUM');
    expect(gapSeverity(0.6)).toBe('LOW');
  });

  it('cannot carry a Today placement or a next-activity instruction', () => {
    const c = examGapCandidateFrom(gap);
    expect(ExamGapCandidateSchema.safeParse({ ...c, putIntoToday: true }).success).toBe(false);
    expect(ExamGapCandidateSchema.safeParse({ ...c, nextLearningActivity: 'PRACTICE' }).success).toBe(false);
    expect(ExamGapCandidateSchema.safeParse({ ...c, priority: 1 }).success).toBe(false);
    expect(Object.keys(c).join(',')).not.toMatch(/today|next|activity|priority|accepted/i);
  });

  it('does not depend on a recommendation being accepted: it needs only the exam evidence', () => {
    expect(Object.keys(ExamGapCandidateSchema.shape)).not.toContain('recommendationStatus');
    expect(examGapCandidateFrom(gap).urgency).toEqual({ targetDate: null, intendedSession: null });
  });
});

const profile = (over: Partial<StudentExamProfile> = {}): StudentExamProfile => ({
  id: 'target-1', studentId: 'stu-1', examDefinitionId: 'def-1', examVersionId: 'ev-1', objectiveKey: 'ib.dp.physics.hl', objectiveFramework: 'IB_DP',
  objectiveContext: { programme: 'IB Diploma Programme', subject: 'Physics', level: 'HL', syllabusCode: null, label: 'Physics HL' },
  targetQualification: null, targetExamSeries: 'MAY', targetExamYear: 2027, purpose: null, programmeContext: null, subjectFocus: null, examDate: '2027-05-04', timezone: null, institutionTargetId: null, status: 'ACTIVE',
  ...over,
});
const resolution = { definitionIds: ['def-1'], versionIds: ['ev-1'], academicSubjectIds: ['subj-1'], source: 'OBJECTIVE' as const, mappingStatus: 'MAPPED' as const };

describe('B1 PreparationContext -- a projection of student_exam_profiles (no new entity)', () => {
  it('represents what the record states, with explicit KNOWN / UNKNOWN', () => {
    const p = projectPreparationContext(profile(), resolution, [], [{ structureVersionId: 'sv-1', academicSubjectId: 'subj-1' }]);
    expect(p).toMatchObject({ examTargetId: 'target-1', studentId: 'stu-1', status: 'ACTIVE', objective: { key: 'ib.dp.physics.hl', framework: 'IB_DP' }, academicSubjectIds: ['subj-1'] });
    expect(p.exam).toEqual({ definitionIds: ['def-1'], versionIds: ['ev-1'], pinnedVersionId: 'ev-1', mappingStatus: 'MAPPED' });
    expect(p.level).toEqual({ state: 'KNOWN', value: 'HL' });
    expect(p.subject).toEqual({ state: 'KNOWN', value: { label: 'Physics' } });
    expect(p.targetDate).toEqual({ state: 'KNOWN', value: { date: '2027-05-04', source: 'STUDENT_ENTERED' } });
    expect(p.curriculumScopes).toEqual([{ structureVersionId: 'sv-1', academicSubjectId: 'subj-1' }]);
    // not recorded on a target today: never guessed
    expect(p.component).toEqual({ state: 'UNKNOWN' });
    expect(p.targetResult).toEqual({ state: 'UNKNOWN' });
    expect(p.qualification).toEqual({ state: 'UNKNOWN' });
    expect(p.syllabusCode).toEqual({ state: 'UNKNOWN' });
    expect(isPlannablePreparation(p)).toBe(true);
  });

  it('T1 final delta: the intended session is target_exam_series + target_exam_year, never official_session_key', () => {
    expect(projectPreparationContext(profile(), resolution).intendedSession).toEqual({ state: 'KNOWN', value: { series: 'MAY', year: 2027 } });
    expect(projectPreparationContext(profile({ targetExamSeries: null, targetExamYear: null }), resolution).intendedSession).toEqual({ state: 'UNKNOWN' });
    const withOfficial = { ...profile({ targetExamSeries: null, targetExamYear: null }), officialSessionKey: 'M27' } as StudentExamProfile;
    expect(projectPreparationContext(withOfficial, resolution).intendedSession).toEqual({ state: 'UNKNOWN' });
  });

  it('a target grade is KNOWN only when a goal row states it', () => {
    const p = projectPreparationContext(profile(), resolution, [{ id: 'g', studentExamProfileId: 'target-1', goalType: 'TARGET_GRADE', targetValue: '6', competencyId: null }]);
    expect(p.targetResult).toEqual({ state: 'KNOWN', value: { goalType: 'TARGET_GRADE', value: '6' } });
  });

  it('an unmapped or archived target is not plannable', () => {
    expect(isPlannablePreparation(projectPreparationContext(profile({ examDefinitionId: null, examVersionId: null }), { ...resolution, versionIds: [], definitionIds: [], mappingStatus: 'MAPPING_NOT_AVAILABLE' }))).toBe(false);
    expect(isPlannablePreparation(projectPreparationContext(profile({ status: 'ARCHIVED' }), resolution))).toBe(false);
  });
});

describe('B1 StudentAssessmentContext -- composes authorities, owns none', () => {
  const prep = projectPreparationContext(profile(), resolution, [], [{ structureVersionId: 'sv-prep', academicSubjectId: 'subj-1' }]);
  const academic = { contextType: 'ACADEMIC', profileCompleted: true, programme: { id: 'prog', name: 'IB' }, qualification: null, academicSubjectIds: ['subj-1', 'subj-2'] };
  const concepts = [
    { status: 'CANONICAL' as const, learnerConceptId: 'lc-1', canonicalConceptId: 'c-1', basis: 'CREATED_FROM_CANONICAL' as const },
    { status: 'TRANSITIONAL' as const, learnerConceptId: 'lc-2', canonicalConceptId: 'c-2', basis: 'LABEL_MATCH' as const },
    { status: 'UNRESOLVED' as const, learnerConceptId: 'lc-3', canonicalConceptId: null, mappingStatus: 'UNRESOLVED' as const },
  ];
  const ctx = composeStudentAssessmentContext({ studentId: 'stu-1', intent: { family: 'EXAM_PREPARATION', purpose: 'EXAM_PRACTICE', examTargetId: 'target-1' }, academic, concepts, preparation: prep, profileScopes: [{ structureVersionId: 'sv-prep', academicSubjectId: 'subj-1' }, { structureVersionId: 'sv-prof', academicSubjectId: 'subj-2' }] });

  it('references curriculum by structure version (no copy), the exam target first, de-duplicated', () => {
    expect(ctx.curriculum).toEqual([
      { structureVersionId: 'sv-prep', academicSubjectId: 'subj-1', basis: 'PREPARATION_TARGET' },
      { structureVersionId: 'sv-prof', academicSubjectId: 'subj-2', basis: 'ACADEMIC_PROFILE' },
    ]);
    expect(JSON.stringify(ctx)).not.toMatch(/learningObjectives|canonicalConcepts"/);
  });

  it('references learner state by authority and identity -- no mastery or knowledge-state value is copied', () => {
    expect(ctx.learnerState.authority).toBe('concept_knowledge_state');
    expect(ctx.learnerState.evidenceWriter).toBe('updateMastery');
    expect(ctx.learnerState.identity).toEqual({ total: 3, canonical: 1, transitional: 1, unresolved: 1 });
    expect(JSON.stringify(ctx)).not.toMatch(/mastery_score|masteryScore|understanding_score|mastery_state/);
  });

  it('holds no question content and no exam definition copy', () => {
    expect(JSON.stringify(ctx)).not.toMatch(/"questions"|"content"|"blueprint"/);
    expect(ctx.preparation?.exam.versionIds).toEqual(['ev-1']);
  });

  it('finds the Student own instance of a canonical concept through the explicit link only', () => {
    expect(learnerConceptFor(ctx, 'c-1')?.learnerConceptId).toBe('lc-1');
    // B1-C: a concept held under a TRANSITIONAL link is not an instance for assessment planning
    expect(learnerConceptFor(ctx, 'c-2')).toBeNull();
    expect(learnerConceptFor(ctx, 'c-unknown')).toBeNull();
  });

  it('validates the intent against the family boundaries', () => {
    expect(validateAssessmentIntent('stu-1', { family: 'LEARNING', purpose: 'PRACTICE' }, null)).toEqual([]);
    expect(validateAssessmentIntent('stu-1', { family: 'OFFICIAL_EXAM', purpose: 'OFFICIAL_MOCK' }, null)).toEqual(['EXAM_TARGET_REQUIRED']);
    expect(validateAssessmentIntent('stu-1', { family: 'OFFICIAL_EXAM', purpose: 'OFFICIAL_MOCK', examTargetId: 'target-1' }, prep)).toEqual([]);
    expect(validateAssessmentIntent('stu-2', { family: 'EXAM_PREPARATION', purpose: 'EXAM_PRACTICE', examTargetId: 'target-1' }, prep)).toEqual(['EXAM_TARGET_NOT_OWNED']);
    expect(validateAssessmentIntent('stu-1', { family: 'EXAM_PREPARATION', purpose: 'EXAM_PRACTICE', examTargetId: 'x' }, null)).toEqual(['EXAM_TARGET_NOT_FOUND']);
    expect(validateAssessmentIntent('stu-1', { family: 'OFFICIAL_EXAM', purpose: 'OFFICIAL_MOCK', examTargetId: 'target-1', canonicalConceptIds: ['c-1'] }, prep)).toEqual(['OFFICIAL_EXAM_TAKES_NO_LEARNER_TARGETS']);
    expect(validateAssessmentIntent('stu-1', { family: 'LEARNING', purpose: 'OFFICIAL_MOCK' }, null)).toEqual(['PURPOSE_NOT_ALLOWED_FOR_FAMILY']);
  });
});

describe('B1 Continuation -- extended, not replaced', () => {
  const origin: LearningOrigin = { subjectId: 's1', conceptId: 'k1', entry: 'TODAY' };
  const launch: ContinuationResolution = { status: 'LAUNCH', launchTarget: '/dashboard/quiz?mode=topic_practice', activityType: 'PRACTICE', source: 'CANONICAL_ENGINE_V1' };

  it('the contract version is unchanged and existing origins / resolutions are still valid', () => {
    expect(CONTINUATION_CONTRACT_VERSION).toBe(1);
    expect(continuationConcept(origin, launch)).toEqual({ subjectId: 's1', conceptId: 'k1' });
    expect(isCrossConceptContinuation(origin, launch)).toBe(false);
  });

  it('exam / preparation context survives completion on the origin', () => {
    const o = withAssessmentContext(origin, { family: 'EXAM_PREPARATION', examTargetId: 'target-1', examAttemptId: 'att-1' });
    expect(o).toEqual({ ...origin, assessment: { family: 'EXAM_PREPARATION', examTargetId: 'target-1', examAttemptId: 'att-1' } });
    // the context is carried, and carries no instruction about what to do next
    expect(Object.keys(o.assessment!).sort()).toEqual(['examAttemptId', 'examTargetId', 'family']);
  });

  it('a continuation can name another concept (cross-concept), set only by the continuation authority', () => {
    const cross: ContinuationResolution = { ...launch, target: { subjectId: 's2', conceptId: 'k2' } };
    expect(continuationConcept(origin, cross)).toEqual({ subjectId: 's2', conceptId: 'k2' });
    expect(isCrossConceptContinuation(origin, cross)).toBe(true);
    const back: ContinuationResolution = { status: 'RETURN_TO_MISSION', reason: 'CANONICAL_NO_FURTHER_ACTION' };
    expect(isCrossConceptContinuation(origin, back)).toBe(false);
  });
});

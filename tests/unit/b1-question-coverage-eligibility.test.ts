/**
 * B1 -- QuestionCoverage (store-neutral) and QuestionEligibility (family boundaries). Domain / contract tests.
 */
import { describe, it, expect } from 'vitest';
import {
  coverageOfLearningCacheItem,
  coverageOfReviewedBankItem,
  coveredConceptIds,
  isMultiConcept,
  summarizeCoverage,
  type LearningCacheItemRow,
  type QuestionCoverage,
  type ReviewedBankItemRow,
} from '@/lib/assessment-foundation/question-coverage';
import { eligibleCandidates, evaluateQuestionEligibility, type QuestionEligibilityRequest } from '@/lib/assessment-foundation/question-eligibility';
import type { ConceptIdentity } from '@/lib/catalog/concept-identity';

const reviewedRow = (over: Partial<ReviewedBankItemRow> = {}): ReviewedBankItemRow => ({
  approvedItemId: 'item-1',
  learningObjectiveId: 'lo-1',
  questionType: 'multiple_choice',
  content: { difficulty: 3, marks: 2, language: 'es' },
  status: 'PUBLISHED',
  bankLifecycleStatus: 'ACTIVE',
  usageEligibility: ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK'],
  examAlignment: 'MOCK_READY',
  calibrationConfidence: 'INSUFFICIENT_DATA',
  contentOrigin: 'GENERATED',
  sourceIds: null,
  bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: 'ev-1', assessmentComponentId: 'comp-1', currentVersionId: 'item-1', retired: false, language: 'es' },
  sourceLicenses: [],
  itemRights: { sourceAccess: 'NOT_APPLICABLE', reuseRights: 'STUDYUS_OWNED', inForce: true }, 
  humanReviewDecisions: 1,
  scope: { structureVersionId: 'sv-1', academicSubjectId: 'subj-1' },
  objectiveConcepts: [{ canonicalConceptId: 'c-1', relationType: 'FULL' }],
  ...over,
});

const canonical = (canonicalConceptId: string): ConceptIdentity => ({ status: 'CANONICAL', learnerConceptId: 'lc-1', canonicalConceptId, basis: 'CREATED_FROM_CANONICAL' });

const cacheRow = (over: Partial<LearningCacheItemRow> = {}): LearningCacheItemRow => ({
  candidateId: 'cand-1',
  studentId: 'stu-1',
  learnerConceptId: 'lc-1',
  activityType: 'PRACTICE',
  questionType: 'multiple_choice',
  difficulty: 2,
  language: 'es',
  validationStatus: 'VALIDATED',
  identity: canonical('c-1'),
  ...over,
});

describe('B1 QuestionCoverage -- reviewed exam bank', () => {
  it('resolves through the learning objective to canonical concepts, and names its store', () => {
    const c = coverageOfReviewedBankItem(reviewedRow());
    expect(c.ref).toEqual({ store: 'REVIEWED_EXAM_BANK', id: 'item-1' });
    expect(c.learningObjectiveIds).toEqual({ state: 'KNOWN', value: ['lo-1'] });
    expect(c.concepts).toEqual([{ canonicalConceptId: 'c-1', role: 'UNSPECIFIED', basis: 'OBJECTIVE_MAPPING', relationType: 'FULL' }]);
    expect(c.conceptResolution).toEqual({ status: 'RESOLVED' });
    expect(c.curriculumApplicability).toEqual({ state: 'KNOWN', value: [{ structureVersionId: 'sv-1', academicSubjectId: 'subj-1' }] });
    expect(c.examApplicability).toEqual({ state: 'KNOWN', value: { examVersionId: 'ev-1', assessmentComponentId: 'comp-1' } });
    expect(c.ownerStudentId).toBeNull();
  });

  it('one question can cover several concepts, none claimed as primary and no weight invented', () => {
    const c = coverageOfReviewedBankItem(
      reviewedRow({
        objectiveConcepts: [
          { canonicalConceptId: 'c-1', relationType: 'FULL' },
          { canonicalConceptId: 'c-2', relationType: 'PARTIAL' },
          { canonicalConceptId: 'c-3', relationType: 'SUPPORTING' },
          { canonicalConceptId: 'c-1', relationType: 'FULL' },
        ],
      })
    );
    expect(coveredConceptIds(c)).toEqual(['c-1', 'c-2', 'c-3']);
    expect(isMultiConcept(c)).toBe(true);
    expect(c.concepts.every((x) => x.role === 'UNSPECIFIED' && x.basis === 'OBJECTIVE_MAPPING')).toBe(true);
    expect(c.concepts.some((x) => 'weight' in x)).toBe(false);
  });

  it('an objective with no concept mapping is UNRESOLVED, kept visible', () => {
    const c = coverageOfReviewedBankItem(reviewedRow({ objectiveConcepts: [] }));
    expect(c.concepts).toEqual([]);
    expect(c.conceptResolution).toEqual({ status: 'UNRESOLVED', reason: 'OBJECTIVE_HAS_NO_CONCEPT_MAPPING' });
  });

  it('metadata the source does not record is UNKNOWN, never a default', () => {
    const c = coverageOfReviewedBankItem(reviewedRow({ content: {}, questionType: null, sourceIds: null, scope: null, bankItem: null }));
    expect(c.estimatedSeconds).toEqual({ state: 'UNKNOWN' });
    expect(c.difficulty).toEqual({ state: 'UNKNOWN' });
    expect(c.marks).toEqual({ state: 'UNKNOWN' });
    expect(c.questionType).toEqual({ state: 'UNKNOWN' });
    expect(c.licensing).toEqual({ state: 'UNKNOWN' });
    expect(c.curriculumApplicability).toEqual({ state: 'UNKNOWN' });
    expect(c.examApplicability).toEqual({ state: 'UNKNOWN' });
  });

  it('estimated time is UNKNOWN for every item today (no source records it)', () => {
    expect(coverageOfReviewedBankItem(reviewedRow()).estimatedSeconds.state).toBe('UNKNOWN');
    expect(coverageOfLearningCacheItem(cacheRow()).estimatedSeconds.state).toBe('UNKNOWN');
  });

  it('a version with no bank identity, or fixture content, is a FIXTURE -- never assumed to be real content', () => {
    expect(coverageOfReviewedBankItem(reviewedRow({ bankItem: null })).provenance).toBe('FIXTURE');
    expect(coverageOfReviewedBankItem(reviewedRow({ content: { contentStatus: 'DEV_CERT_FIXTURE' } })).provenance).toBe('FIXTURE');
    expect(coverageOfReviewedBankItem(reviewedRow({ contentOrigin: 'FIXTURE' })).provenance).toBe('FIXTURE');
  });

  it('human review and licensing are reported as recorded', () => {
    expect(coverageOfReviewedBankItem(reviewedRow({ humanReviewDecisions: 0 })).review.humanReviewed).toEqual({ state: 'KNOWN', value: false });
    const licensed = coverageOfReviewedBankItem(reviewedRow({ sourceIds: ['s1', 's2'], sourceLicenses: ['PUBLIC', 'PUBLIC'] }));
    expect(licensed.licensing).toEqual({ state: 'KNOWN', value: { statuses: ['PUBLIC'], sourceIds: ['s1', 's2'] } });
  });
});

describe('B1 QuestionCoverage -- learning item cache', () => {
  it('resolves through the learner concept and its explicit canonical link', () => {
    const c = coverageOfLearningCacheItem(cacheRow());
    expect(c.ref).toEqual({ store: 'LEARNING_ITEM_CACHE', id: 'cand-1' });
    expect(c.ownerStudentId).toBe('stu-1');
    expect(c.learnerConceptId).toBe('lc-1');
    expect(c.concepts).toEqual([{ canonicalConceptId: 'c-1', role: 'PRIMARY', basis: 'LEARNER_CONCEPT_LINK' }]);
    expect(c.unconfirmedConceptId).toBeNull();
    expect(c.provenance).toBe('GENERATED_UNREVIEWED');
    expect(c.review.humanReviewed).toEqual({ state: 'KNOWN', value: false });
    expect(c.examApplicability).toEqual({ state: 'NOT_APPLICABLE' });
    expect(c.marks).toEqual({ state: 'NOT_APPLICABLE' });
    expect(c.learningObjectiveIds).toEqual({ state: 'UNKNOWN' });
  });

  it('an unlinked learner concept gives UNRESOLVED coverage -- no label is matched', () => {
    const unresolved: ConceptIdentity = { status: 'UNRESOLVED', learnerConceptId: 'lc-1', canonicalConceptId: null, mappingStatus: 'UNRESOLVED' };
    for (const identity of [unresolved, null]) {
      const c = coverageOfLearningCacheItem(cacheRow({ identity }));
      expect(c.concepts).toEqual([]);
      expect(c.conceptResolution).toEqual({ status: 'UNRESOLVED', reason: 'LEARNER_CONCEPT_NOT_LINKED' });
    }
  });

  it('B1-C: a TRANSITIONAL (label-matched) link is NOT coverage -- it behaves as unresolved', () => {
    const c = coverageOfLearningCacheItem(cacheRow({ identity: { status: 'TRANSITIONAL', learnerConceptId: 'lc-1', canonicalConceptId: 'c-9', basis: 'LABEL_MATCH' } }));
    expect(c.concepts).toEqual([]);
    expect(coveredConceptIds(c)).toEqual([]);
    expect(c.conceptResolution).toEqual({ status: 'UNRESOLVED', reason: 'LEARNER_CONCEPT_LINK_TRANSITIONAL' });
    // kept visible for governance only
    expect(c.unconfirmedConceptId).toBe('c-9');
    const s = summarizeCoverage([c]);
    expect(s).toMatchObject({ resolved: 0, unresolved: 1, transitional: 1, canonicalConceptIds: [] });
  });

  it('both stores are read through the same contract (same keys), with the store explicit', () => {
    const a = coverageOfReviewedBankItem(reviewedRow());
    const b = coverageOfLearningCacheItem(cacheRow());
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(new Set([a.ref.store, b.ref.store]).size).toBe(2);
  });

  it('a readiness roll-up reports resolution, provenance and review -- it selects nothing', () => {
    const s = summarizeCoverage([
      coverageOfReviewedBankItem(reviewedRow()),
      coverageOfReviewedBankItem(reviewedRow({ approvedItemId: 'item-2', objectiveConcepts: [], humanReviewDecisions: 0, bankItem: null })),
      coverageOfLearningCacheItem(cacheRow()),
    ]);
    expect(s).toMatchObject({ total: 3, byStore: { REVIEWED_EXAM_BANK: 2, LEARNING_ITEM_CACHE: 1 }, resolved: 2, unresolved: 1, humanReviewed: 1, canonicalConceptIds: ['c-1'], learningObjectiveIds: ['lo-1'] });
    expect(s.byProvenance).toEqual({ STUDYUS_GENERATED: 1, FIXTURE: 1, GENERATED_UNREVIEWED: 1 });
    expect(Object.keys(s)).not.toContain('selected');
  });
});

const official: QuestionEligibilityRequest = { family: 'OFFICIAL_EXAM', studentId: 'stu-1', examVersionId: 'ev-1' };
const prep: QuestionEligibilityRequest = { family: 'EXAM_PREPARATION', studentId: 'stu-1', examVersionId: 'ev-1' };
const learning: QuestionEligibilityRequest = { family: 'LEARNING', studentId: 'stu-1' };
const reasons = (c: QuestionCoverage, r: QuestionEligibilityRequest) => {
  const e = evaluateQuestionEligibility(c, r);
  return e.eligible ? [] : e.reasons;
};

describe('B1 QuestionEligibility -- family boundaries', () => {
  it('a reviewed, mock-ready, human-approved item is official-eligible for its exam version', () => {
    expect(evaluateQuestionEligibility(coverageOfReviewedBankItem(reviewedRow()), official)).toEqual({ eligible: true, use: 'FULL_MOCK' });
  });

  it('a generated learning item can NEVER become official-mock eligible, whatever the policy flags say', () => {
    const c = coverageOfLearningCacheItem(cacheRow());
    const r = reasons(c, { ...official, policy: { allowUnreviewedInPreparation: true } });
    expect(r).toContain('STORE_NOT_ALLOWED_FOR_FAMILY');
    expect(r).toContain('UNREVIEWED_CONTENT_NOT_ALLOWED');
  });

  it('OFFICIAL_EXAM keeps the existing delivery rule: PILOT, fixtures and practice-only items are refused', () => {
    expect(reasons(coverageOfReviewedBankItem(reviewedRow({ bankLifecycleStatus: 'PILOT' })), official)).toContain('BANK_DELIVERY_RULE');
    expect(reasons(coverageOfReviewedBankItem(reviewedRow({ contentOrigin: 'FIXTURE' })), official)).toContain('BANK_DELIVERY_RULE');
    expect(reasons(coverageOfReviewedBankItem(reviewedRow({ usageEligibility: ['PRACTICE'], examAlignment: 'PRACTICE' })), official)).toContain('BANK_DELIVERY_RULE');
    // a caller cannot downgrade an official exam to the practice rule
    expect(reasons(coverageOfReviewedBankItem(reviewedRow({ usageEligibility: ['PRACTICE'], examAlignment: 'PRACTICE' })), { ...official, use: 'PRACTICE' })).toContain('BANK_DELIVERY_RULE');
  });

  it('exam applicability is respected: another exam version or component is refused', () => {
    expect(reasons(coverageOfReviewedBankItem(reviewedRow()), { ...official, examVersionId: 'ev-other' })).toEqual(['EXAM_VERSION_MISMATCH']);
    expect(reasons(coverageOfReviewedBankItem(reviewedRow()), { ...official, assessmentComponentIds: ['comp-9'] })).toEqual(['COMPONENT_MISMATCH']);
    expect(reasons(coverageOfReviewedBankItem(reviewedRow({ bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: null, assessmentComponentId: null, currentVersionId: 'item-1', retired: false, language: null } })), official)).toContain('EXAM_APPLICABILITY_UNKNOWN');
    expect(reasons(coverageOfReviewedBankItem(reviewedRow()), { family: 'OFFICIAL_EXAM', studentId: 'stu-1' })).toContain('EXAM_VERSION_REQUIRED');
  });

  it('curriculum, objective, concept and question-type applicability are respected', () => {
    const c = coverageOfReviewedBankItem(reviewedRow());
    expect(reasons(c, { ...prep, structureVersionIds: ['sv-other'] })).toEqual(['CURRICULUM_MISMATCH']);
    expect(reasons(c, { ...prep, structureVersionIds: ['sv-1'] })).toEqual([]);
    expect(reasons(c, { ...prep, learningObjectiveIds: ['lo-other'] })).toEqual(['OBJECTIVE_MISMATCH']);
    expect(reasons(c, { ...prep, canonicalConceptIds: ['c-other'] })).toEqual(['CONCEPT_MISMATCH']);
    expect(reasons(c, { ...prep, canonicalConceptIds: ['c-1'] })).toEqual([]);
    expect(reasons(c, { ...prep, questionTypes: ['short_answer'] })).toEqual(['QUESTION_TYPE_MISMATCH']);
    expect(reasons(coverageOfReviewedBankItem(reviewedRow({ objectiveConcepts: [] })), { ...prep, canonicalConceptIds: ['c-1'] })).toEqual(['CONCEPT_UNRESOLVED']);
  });

  it('reuse rights: a licence status of a cited source grants nothing; only an established reuse right does', () => {
    const licensed = (over: Partial<ReviewedBankItemRow>) => coverageOfReviewedBankItem(reviewedRow({ contentOrigin: 'LICENSED', bankItem: { provenance: 'LICENSED', examVersionId: 'ev-1', assessmentComponentId: 'comp-1', currentVersionId: 'item-1', retired: false, language: 'es' }, ...over }));
    // a PUBLIC or LICENSED source, with no rights record for the item: not deliverable
    expect(reasons(licensed({ sourceIds: ['s1'], sourceLicenses: ['PUBLIC'], itemRights: null }), prep)).toEqual(['REUSE_RIGHTS_NOT_ESTABLISHED']);
    expect(reasons(licensed({ sourceIds: ['s1'], sourceLicenses: ['LICENSED'], itemRights: null }), prep)).toEqual(['REUSE_RIGHTS_NOT_ESTABLISHED']);
    expect(reasons(licensed({ sourceIds: ['s1'], sourceLicenses: ['LICENSED'], itemRights: { sourceAccess: 'LICENSED_SOURCE', reuseRights: 'LICENSED_FOR_USE', inForce: true } }), prep)).toEqual([]);
    // StudyUs content is judged by the same rule: it needs its own rights record too
    expect(reasons(coverageOfReviewedBankItem(reviewedRow({ sourceIds: null, itemRights: null })), prep)).toEqual(['REUSE_RIGHTS_NOT_ESTABLISHED']);
    expect(reasons(coverageOfReviewedBankItem(reviewedRow({ sourceIds: null })), prep)).toEqual([]);
  });

  it('EXAM_PREPARATION: unreviewed cached content only when the policy explicitly allows it', () => {
    const c = coverageOfLearningCacheItem(cacheRow());
    expect(reasons(c, prep)).toEqual(['UNREVIEWED_CONTENT_NOT_ALLOWED']);
    expect(evaluateQuestionEligibility(c, { ...prep, policy: { allowUnreviewedInPreparation: true } })).toEqual({ eligible: true, use: null });
    // ...and never another Student's, never an unresolved one
    expect(reasons(coverageOfLearningCacheItem(cacheRow({ studentId: 'stu-2' })), { ...prep, policy: { allowUnreviewedInPreparation: true } })).toEqual(['NOT_OWNED_BY_STUDENT']);
    expect(reasons(coverageOfLearningCacheItem(cacheRow({ identity: null })), { ...prep, policy: { allowUnreviewedInPreparation: true } })).toEqual(['CONCEPT_UNRESOLVED']);
  });

  it('LEARNING: the Student own validated cached questions; a retired or foreign one is refused', () => {
    expect(evaluateQuestionEligibility(coverageOfLearningCacheItem(cacheRow()), learning)).toEqual({ eligible: true, use: null });
    expect(reasons(coverageOfLearningCacheItem(cacheRow({ validationStatus: 'RETIRED' })), learning)).toEqual(['CACHE_ITEM_NOT_VALIDATED']);
    expect(reasons(coverageOfLearningCacheItem(cacheRow({ studentId: 'stu-2' })), learning)).toEqual(['NOT_OWNED_BY_STUDENT']);
    // a personal (unlinked) concept still has its own learning questions
    expect(evaluateQuestionEligibility(coverageOfLearningCacheItem(cacheRow({ identity: null })), learning).eligible).toBe(true);
  });

  it('B1-C: a TRANSITIONAL link never satisfies a canonical target, in any family, and no policy can allow it', () => {
    const c = coverageOfLearningCacheItem(cacheRow({ identity: { status: 'TRANSITIONAL', learnerConceptId: 'lc-1', canonicalConceptId: 'c-1', basis: 'LABEL_MATCH' } }));
    expect(reasons(c, { ...learning, canonicalConceptIds: ['c-1'] })).toEqual(['CONCEPT_UNRESOLVED']);
    expect(reasons(c, { ...prep, canonicalConceptIds: ['c-1'], policy: { allowUnreviewedInPreparation: true } })).toEqual(['CONCEPT_UNRESOLVED']);
    expect(reasons(c, { ...prep, policy: { allowUnreviewedInPreparation: true } })).toEqual(['CONCEPT_UNRESOLVED']);
    // the request type has no switch that would accept it
    const forced = { ...learning, canonicalConceptIds: ['c-1'], policy: { allowTransitionalConceptLinks: true } } as unknown as QuestionEligibilityRequest;
    expect(evaluateQuestionEligibility(c, forced).eligible).toBe(false);
    // with no canonical target, a personal learning question is still usable for LEARNING (it is the Student's own)
    expect(evaluateQuestionEligibility(c, learning).eligible).toBe(true);
    // a set with only transitional coverage yields no candidate for a canonical target: insufficient, never a guess
    expect(eligibleCandidates([c], { ...learning, canonicalConceptIds: ['c-1'] })).toEqual([]);
  });

  it('eligibility permits candidates; it does not select, rank or count', () => {
    const all = [coverageOfReviewedBankItem(reviewedRow()), coverageOfReviewedBankItem(reviewedRow({ approvedItemId: 'item-2', bankLifecycleStatus: 'PILOT' })), coverageOfLearningCacheItem(cacheRow())];
    const out = eligibleCandidates(all, official);
    expect(out.map((c) => c.ref.id)).toEqual(['item-1']);
    expect(eligibleCandidates(all, learning).map((c) => c.ref.id)).toEqual(['item-1', 'cand-1']);
    const e = evaluateQuestionEligibility(all[0], official);
    expect(Object.keys(e).sort()).toEqual(['eligible', 'use']);
  });
});

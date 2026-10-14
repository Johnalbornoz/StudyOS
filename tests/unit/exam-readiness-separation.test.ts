/**
 * Knowledge State vs Exam Readiness: the target evidence boundary (reference model, synthetic events). Pure.
 */
import { describe, expect, it } from 'vitest';
import { applyEvidence, emptyStores, EVIDENCE_PROJECTIONS, GOVERNED_TRANSFER_RULES, projectionsOf, type EvidenceEvent, type ExamTarget } from '@/lib/exam-bank/readiness/evidence-boundary';

const TARGET: ExamTarget = { examTargetId: 'target-1', assessmentSystem: 'SYNTH', assessmentVersion: 'v1', profile: null, component: 'math', paper: null, blueprintBucketId: 'alg', examAttemptId: 'att-1' };
let k = 0;
const ev = (over: Partial<EvidenceEvent> = {}): EvidenceEvent => ({
  studentId: 'stu-1', type: 'EXAM_ASSESSMENT', conceptStableId: 'math.linear-equations', correct: true, fraction: 1, assisted: false, responseFormat: 'SELECTED_RESPONSE',
  difficultyIndex: null, responseTimeMs: 40000, occurredAt: '2026-10-14T10:00:00.000Z', examTarget: TARGET, idempotencyKey: `k${++k}`, ...over,
});

describe('evidence boundary', () => {
  it('each evidence type has exactly one projection and the transfer registry ships empty', () => {
    expect(EVIDENCE_PROJECTIONS).toEqual({ LEARNING: ['KNOWLEDGE_STATE'], INTERNAL_ASSESSMENT: ['KNOWLEDGE_STATE', 'INTERNAL_ASSESSMENT_RESULT'], EXAM_ASSESSMENT: ['EXAM_READINESS'] });
    expect(GOVERNED_TRANSFER_RULES).toEqual([]);
  });

  it('a Student has Exam Readiness without Learning Plan membership or any learner concept', () => {
    const s = emptyStores();
    expect(applyEvidence(s, ev())).toEqual({ applied: ['EXAM_READINESS'] });
    expect(s.examReadiness.size).toBe(1);
    expect([...s.examReadiness.values()][0]).toMatchObject({ attemptCount: 1, independentCorrectCount: 1, conceptStableId: 'math.linear-equations', readinessScore: null });
  });

  it('exam evidence creates no learner concept, plan membership, route or recommendation, and never mutates Knowledge State', () => {
    const s = emptyStores();
    s.learnerConcepts.add('stu-1|math.fractions');
    s.learningPlan.add('stu-1|math.fractions');
    s.knowledgeState.set('stu-1|math.fractions', { attempts: 3, correct: 2, lastAt: '2026-10-01' });
    const before = JSON.stringify([...s.knowledgeState]);
    applyEvidence(s, ev({ conceptStableId: 'math.linear-equations' }));
    applyEvidence(s, ev({ conceptStableId: 'math.fractions' })); // on-plan concept: still no Knowledge State effect
    expect([...s.learningPlan]).toEqual(['stu-1|math.fractions']);
    expect([...s.learnerConcepts]).toEqual(['stu-1|math.fractions']);
    expect(s.learningRoutes.size + s.learningRecommendations.size).toBe(0);
    expect(JSON.stringify([...s.knowledgeState])).toBe(before);
  });

  it('Learning evidence keeps mutating Knowledge State and never Exam Readiness', () => {
    const s = emptyStores();
    s.learnerConcepts.add('stu-1|math.fractions');
    expect(applyEvidence(s, ev({ type: 'LEARNING', conceptStableId: 'math.fractions', examTarget: null }))).toEqual({ applied: ['KNOWLEDGE_STATE'] });
    expect(s.knowledgeState.get('stu-1|math.fractions')).toMatchObject({ attempts: 1, correct: 1 });
    expect(s.examReadiness.size).toBe(0);
    expect(s.learningPlan.size).toBe(0); // the precondition is ownership, not plan membership
    // The existing Learning precondition stands: evidence for a concept the Student does not own is refused.
    expect(applyEvidence(s, ev({ type: 'LEARNING', conceptStableId: 'math.other', examTarget: null }))).toEqual({ refused: 'LEARNING_EVIDENCE_WITHOUT_LEARNER_CONCEPT' });
  });

  it('Internal Assessment keeps its own stream and its existing Knowledge State effect, never Exam Readiness', () => {
    const s = emptyStores();
    s.learnerConcepts.add('stu-1|math.linear-equations');
    expect(applyEvidence(s, ev({ type: 'INTERNAL_ASSESSMENT', examTarget: null, fraction: 0.5 }))).toEqual({ applied: ['KNOWLEDGE_STATE', 'INTERNAL_ASSESSMENT_RESULT'] });
    expect(s.internalAssessment.get('stu-1|math.linear-equations')).toEqual({ attempts: 1, fractionSum: 0.5 });
    expect(s.knowledgeState.size).toBe(1);
    expect(s.examReadiness.size + s.learningPlan.size).toBe(0);
  });

  it('identity is captured, not inferred: exam evidence needs a target; other types may not carry one', () => {
    const s = emptyStores();
    expect(applyEvidence(s, ev({ examTarget: null }))).toEqual({ refused: 'EXAM_EVIDENCE_WITHOUT_TARGET' });
    expect(applyEvidence(s, ev({ type: 'INTERNAL_ASSESSMENT' }))).toEqual({ refused: 'NON_EXAM_EVIDENCE_WITH_EXAM_TARGET' });
    expect(applyEvidence(s, ev({ type: 'LEARNING' }))).toEqual({ refused: 'NON_EXAM_EVIDENCE_WITH_EXAM_TARGET' });
    const once = ev();
    applyEvidence(s, once);
    expect(applyEvidence(s, once)).toEqual({ refused: 'DUPLICATE' });
  });

  it('assisted exam responses are kept apart from independent correctness', () => {
    const s = emptyStores();
    applyEvidence(s, ev({ assisted: true }));
    applyEvidence(s, ev({ correct: false, fraction: 0 }));
    expect([...s.examReadiness.values()][0]).toMatchObject({ attemptCount: 2, correctCount: 1, assistedCorrectCount: 1, independentAttemptCount: 1, independentCorrectCount: 0 });
  });

  it('readiness is target-scoped: two exam targets do not complete each other', () => {
    const s = emptyStores();
    applyEvidence(s, ev());
    applyEvidence(s, ev({ examTarget: { ...TARGET, examTargetId: 'target-2', assessmentSystem: 'OTHER' } }));
    expect(s.examReadiness.size).toBe(2);
  });

  it('a cross-type effect exists only through an approved, recorded transfer rule', () => {
    expect(projectionsOf('EXAM_ASSESSMENT', [{ ruleId: 't', version: 1, from: 'EXAM_ASSESSMENT', to: 'KNOWLEDGE_STATE', approvedBy: '', decisionRef: '' }])).toEqual(['EXAM_READINESS']);
    const rule = { ruleId: 'exam-to-knowledge', version: 1, from: 'EXAM_ASSESSMENT' as const, to: 'KNOWLEDGE_STATE' as const, approvedBy: 'product-owner', decisionRef: 'DEC-TEST' };
    const s = emptyStores();
    expect(applyEvidence(s, ev(), [rule])).toEqual({ applied: ['EXAM_READINESS', 'KNOWLEDGE_STATE'] });
    expect(s.learningPlan.size + s.learnerConcepts.size).toBe(0);
  });
});

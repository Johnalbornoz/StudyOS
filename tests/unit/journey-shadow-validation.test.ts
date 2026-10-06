/**
 * Student Exam Journey V2 -- shadow validation phase: G6 cross-exam evidence
 * (proved, reported), the journey-side exclusion of other-exam-only evidence,
 * multiple targets resolving independently, the O-05 / O-06 / O-07 contracts,
 * the experimental preparation-window policy, and the internal diagnostic endpoint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const h = vi.hoisted(() => ({ gate: vi.fn(), resolveAll: vi.fn() }));
vi.mock('@/app/api/exam-preparation/route-helpers', () => ({ studentGate: (...a: any[]) => h.gate(...a) }));
vi.mock('@/lib/exam-journey/shadow.server', () => ({ resolveStudentExamJourneys: (...a: any[]) => h.resolveAll(...a) }));

import { classifyApplication, classifyUnderstanding } from '@/services/knowledge-state.service';
import { buildPreparationPlan, classifyRequirement, type RequirementInput } from '@/lib/exam-core/objectives/preparation-plan';
import { learningFactsFromPlan, isOtherExamOnly } from '@/lib/exam-journey/plan-facts';
import { resolveStudentExamJourney } from '@/lib/exam-journey/resolver';
import { JOURNEY_POLICY_V1 } from '@/lib/exam-journey/policy';
import type { ExamInstanceFact, LearnerFacts, StudentExamJourneyFacts } from '@/lib/exam-journey/types';
import { GET as journeyGET } from '@/app/api/exam-preparation/journey/route';

const ROOT = join(__dirname, '..', '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf-8');

const learner: LearnerFacts = { academicProfile: null, institution: { activeEnrollments: 0, classProgrammes: [], assignedObjectiveKeys: [] }, subjectCount: 0, examTargetCount: 2 };
const base = (over: Partial<StudentExamJourneyFacts> = {}): StudentExamJourneyFacts => ({
  asOf: '2026-10-05',
  learner,
  target: { examTargetId: 't-ib', objectiveKey: 'ib-objective', framework: 'X', objectiveKind: 'SUBJECT_LEVEL', examDefinitionId: null, level: null, examDate: '2027-01-15', sessionCode: null, status: 'ACTIVE', source: 'STUDENT', confirmation: 'CONFIRMED', satConfirmed: false, optedInEarly: false, previousResult: null, actualResult: null },
  blueprint: { readiness: 'REDUCED_MOCK_READY', structureVisible: true, publishedVersion: true, versionValidity: 'UNVERIFIED', programmePlan: false, institutionalRelease: 'NOT_APPLICABLE' },
  content: { practice: true, diagnostic: true, reducedMock: true, fullMock: false, learningBridge: true, unavailable: [], reducedMockLengthCoveragePercent: 26 },
  learning: null,
  exam: { instances: [], openAttempt: false },
  prediction: { modelClass: 'NO_MODEL', components: [], estimates: [] },
  ...over,
});
const scoredMock: ExamInstanceFact = { instanceRef: 'm1', mode: 'MOCK', purpose: null, status: 'COMPLETED', timingMode: 'OFFICIAL_SIMULATION_TIMED', componentScoped: false, fidelity: 'REDUCED', completedAt: '2026-10-01T10:00:00.000Z', result: 'SCORED', coveredComponentIds: ['p1'] };
const otherExamGap = { classification: 'GAP' as const, at: '2026-10-01T10:00:00.000Z', examName: 'Other exam', sameExam: false };
const req = (code: string, over: Partial<RequirementInput> = {}): RequirementInput => ({
  learningObjectiveId: `lo-${code}`, code, description: code, area: 'A', weight: 0.5, ownEvidence: null,
  concepts: [{ canonicalConceptId: `cc-${code}`, name: code, learner: null, examEvidence: null, alsoRelevantFor: [] }],
  ...over,
});

// ------------------------------------------------------------------ G6
describe('G6 -- cross-exam evidence', () => {
  it('PROOF (by design, KNOWLEDGE_MASTERY): exam-simulation answers alone move the shared learner state', () => {
    const examOnly = [1, 2, 3].map((i) => ({ sourceType: 'EXAM_SIMULATION', result: 'correct' as const, scorePercent: 100, aiAssistanceType: 'NONE', timestamp: `2026-10-0${i}` }));
    expect(classifyUnderstanding(examOnly)).toBe(100);
    expect(classifyApplication(examOnly)).toBe(100);
  });

  it('PROOF (pure read WITHOUT exam scope): that shared learner state alone marks the requirement ALREADY_STRONG -- G6 loaders always pass the scope', () => {
    const r = req('alg', { concepts: [{ canonicalConceptId: 'cc-alg', name: 'alg', learner: { studentConceptId: 'sc', subjectId: 's', masteryState: 'VALIDATED_MASTERY', validationReadiness: 'READY_FOR_VALIDATION' as any, memoryStatus: null, retentionDue: false, criticalMisconceptions: 0, evidenceCount: 3 }, examEvidence: otherExamGap, alsoRelevantFor: [] }] });
    expect(classifyRequirement(r).status).toBe('ALREADY_STRONG');
  });

  it('G6: evidence that is ENTIRELY another exam\'s is isolated (no risk left); a residual blend is REPORTED, never hidden', () => {
    const isolated = buildPreparationPlan([req('alg', { concepts: [{ canonicalConceptId: 'cc-alg', name: 'alg', learner: null, examEvidence: otherExamGap, alsoRelevantFor: [] }] }), req('geo')], { examDaysLeft: 100, canPractice: true, canRunDiagnostic: true });
    const r1 = resolveStudentExamJourney(base({ learning: learningFactsFromPlan(isolated, null) }));
    expect(r1.readinessStatus.crossExamEvidenceRisk).toBe(false);
    expect(learningFactsFromPlan(isolated, null).otherExamOnlyRequirements).toBe(1);
    // A concept this target knows from its own scope AND from another exam's attempts: used (capped), and reported.
    const blended = { studentConceptId: 'sc', subjectId: 's', masteryState: 'VALIDATED_MASTERY' as any, validationReadiness: 'READY_FOR_VALIDATION' as any, memoryStatus: null, retentionDue: false, criticalMisconceptions: 0, evidenceCount: 5, examScope: { inScopeEvidence: 2, outOfScopeExamEvidence: 3 } };
    const plan = buildPreparationPlan([req('alg', { concepts: [{ canonicalConceptId: 'cc-alg', name: 'alg', learner: blended, examEvidence: null, alsoRelevantFor: [] }] }), req('geo')], { examDaysLeft: 100, canPractice: true, canRunDiagnostic: true });
    expect(plan.requirements[0].status).toBe('NEEDS_CONFIRMATION'); // never ALREADY_STRONG on another exam's attempts
    const r2 = resolveStudentExamJourney(base({ learning: learningFactsFromPlan(plan, null) }));
    expect(r2.readinessStatus.crossExamEvidenceRisk).toBe(true);
    expect(r2.resolutionReasons.find((x) => x.code === 'CROSS_EXAM_EVIDENCE_RISK')?.detail).toEqual({ concepts: 1, otherExamOnlyRequirements: 0 });
  });

  it('journey-side fix: another exam\'s evidence never counts as THIS target\'s readiness or coverage', () => {
    const plan = buildPreparationPlan([req('alg', { concepts: [{ canonicalConceptId: 'cc-alg', name: 'alg', learner: null, examEvidence: otherExamGap, alsoRelevantFor: [] }] }), req('geo')], { examDaysLeft: 100, canPractice: true, canRunDiagnostic: true });
    // G6: the plan itself (Exam Core) now leaves the other-exam requirement without evidence for this target.
    expect(plan.requirements.map((r) => r.status)).toEqual(['NO_EVIDENCE', 'NO_EVIDENCE']);
    expect(isOtherExamOnly(plan.requirements[0])).toBe(true);
    const facts = learningFactsFromPlan(plan, null);
    expect(facts).toMatchObject({ mappedRequirements: 2, mappedWithEvidence: 0, weightedReadyShare: 0, otherExamOnlyRequirements: 1 });
    // Consequence: this target's diagnostic is still due (the pre-fix loader would have skipped it: coverage 1/2 = 50 %).
    expect(resolveStudentExamJourney(base({ learning: facts })).state).toBe('DIAGNOSTIC_DUE');
  });

  it('own learner evidence still counts (only other-exam-ONLY requirements are excluded)', () => {
    const learnerState = { studentConceptId: 'sc', subjectId: 's', masteryState: 'DEVELOPING' as any, validationReadiness: null, memoryStatus: null, retentionDue: false, criticalMisconceptions: 0, evidenceCount: 4 };
    const plan = buildPreparationPlan([req('alg', { concepts: [{ canonicalConceptId: 'cc-alg', name: 'alg', learner: learnerState, examEvidence: otherExamGap, alsoRelevantFor: [] }] })], { examDaysLeft: 100, canPractice: true, canRunDiagnostic: true });
    expect(isOtherExamOnly(plan.requirements[0])).toBe(false);
    expect(learningFactsFromPlan(plan, null)).toMatchObject({ mappedWithEvidence: 1, weightedReadyShare: 1 });
  });
});

// ------------------------------------------------------------------ S10
describe('S10 -- multiple targets resolve independently', () => {
  it('a scored mock of one target never counts for another; blockers stay per target', () => {
    const paa = resolveStudentExamJourney(base({ target: { ...base().target!, examTargetId: 't-paa', objectiveKey: 'paa', examDate: '2026-12-05' }, exam: { instances: [scoredMock], openAttempt: false } }));
    const ib = resolveStudentExamJourney(base({ blueprint: { ...base().blueprint!, readiness: 'STRUCTURE_READY' }, content: { practice: false, diagnostic: false, reducedMock: false, fullMock: false, learningBridge: true, unavailable: [{ capability: 'PRACTICE', reason: 'BANK_IN_PROGRESS' }], reducedMockLengthCoveragePercent: null } }));
    expect(paa.mockStatus.completedMocks).toBe(1);
    expect(paa.state).toBe('MOCK_1_COMPLETED');
    expect(ib.mockStatus.completedMocks).toBe(0);
    expect(ib.blockers.map((b) => b.code)).toContain('CONTENT_UNAVAILABLE');
    expect(paa.blockers.map((b) => b.code)).not.toContain('CONTENT_UNAVAILABLE');
    expect(paa.examTargetId).toBe('t-paa');
    expect(ib.examTargetId).toBe('t-ib');
  });

  it('the loader selects exam instances per target (exam_profile_id), never per Student', () => {
    expect(read('src/lib/exam-journey/facts.server.ts')).toMatch(/WHERE ei\.exam_profile_id = \$1 AND ei\.status <> 'DELETED'/);
  });
});

// ------------------------------------------------------------------ O-05 / O-06 / O-07
describe('O-05 -- an Exam Target is not an academic subject enrollment', () => {
  it('Path B resolves with zero subjects and never asks to create one', () => {
    const r = resolveStudentExamJourney(base({ learner: { ...learner, examTargetCount: 1 } }));
    expect(r.learner).toMatchObject({ state: 'EXAM_ONLY_PROFILE', requiresAcademicInput: false });
    const kinds = read('src/lib/exam-journey/types.ts').match(/export type NextActionKind =([\s\S]*?);/)![1];
    expect(kinds).not.toMatch(/SUBJECT/);
  });
  it('nothing in the journey writes subjects', () => {
    for (const f of ['resolver.ts', 'facts.server.ts', 'plan-facts.ts', 'shadow.server.ts']) expect(read(`src/lib/exam-journey/${f}`)).not.toMatch(/INSERT INTO subjects/i);
  });
});

describe('O-06 -- result provenance', () => {
  const withResult = (provenance: any) => resolveStudentExamJourney(base({ target: { ...base().target!, examDate: '2026-10-01', actualResult: { scale: 'S', value: 'v', provenance } } }));
  it('a Student-reported result is recorded, never verified, never official', () => {
    const r = withResult('STUDENT_REPORTED');
    expect(r.examResult).toEqual({ provenance: 'STUDENT_REPORTED', verified: false });
    expect(r.resolutionReasons.map((x) => x.code)).toContain('RESULT_STUDENT_REPORTED');
    expect(r.predictionStatus.official).toBe(false);
  });
  it('institution-reported is not verified; only a verified document or an official integration is', () => {
    expect(withResult('INSTITUTION_REPORTED').examResult).toEqual({ provenance: 'INSTITUTION_REPORTED', verified: false });
    expect(withResult('VERIFIED_DOCUMENT').examResult?.verified).toBe(true);
    expect(withResult('OFFICIAL_INTEGRATION').examResult?.verified).toBe(true);
    expect(withResult('OFFICIAL_INTEGRATION').resolutionReasons.map((x) => x.code)).toContain('RESULT_VERIFIED');
  });
  it('the provenance vocabulary is exactly the approved one', () => {
    expect(read('src/lib/exam-journey/types.ts')).toMatch(/ResultProvenance = 'STUDENT_REPORTED' \| 'INSTITUTION_REPORTED' \| 'VERIFIED_DOCUMENT' \| 'OFFICIAL_INTEGRATION'/);
  });
});

describe('O-07 -- institution assessments are not forced into Exam Targets', () => {
  it('only class EXAM assignments (objective keys) become targets; school assessments / assignments / join codes do not', () => {
    const loader = read('src/lib/exam-journey/facts.server.ts');
    expect(loader).toMatch(/loadClassExamAssignmentsForStudent/);
    expect(loader).not.toMatch(/assessment_schedule_rules|assessment_occurrences|class_assignments|join_code/i);
  });
});

// ------------------------------------------------------------------ preparation window policy (S9)
describe('S9 -- preparation window is an experimental, versioned journey heuristic', () => {
  it('is classified, versioned, visible in the resolution, and never a hard block', () => {
    expect(JOURNEY_POLICY_V1.classification).toBe('EXPERIMENTAL_PRODUCT_HEURISTIC');
    const far = resolveStudentExamJourney(base({ target: { ...base().target!, examDate: '2029-05-01' } }));
    expect(far.phase).toBe('HORIZON');
    expect(far.resolutionReasons.find((x) => x.code === 'WINDOW_NOT_OPEN')?.detail).toMatchObject({ windowDays: 182, policy: 'journey-policy-v1', classification: 'EXPERIMENTAL_PRODUCT_HEURISTIC' });
    expect(far.mockStatus.startable).toBe(true);
    expect(far.blockers.map((b) => b.code)).not.toContain('WINDOW_NOT_OPEN' as any);
  });
  it('does not live in the Blueprint facts contract', () => {
    const bp = read('src/lib/exam-journey/types.ts').match(/export interface BlueprintReadinessFacts \{([\s\S]*?)\n\}/)![1];
    expect(bp).not.toMatch(/window|weeks|days/i);
  });
  it('is replaceable: the resolver takes the policy as a parameter', () => {
    const shorter = { ...JOURNEY_POLICY_V1, version: 'journey-policy-test', preparationWindow: { minWeeks: 1, maxWeeks: 2 } } as any;
    expect(resolveStudentExamJourney(base(), shorter).policyVersion).toBe('journey-policy-test');
    expect(resolveStudentExamJourney(base(), shorter).phase).toBe('HORIZON');
  });
});

// ------------------------------------------------------------------ endpoint review
describe('GET /api/exam-preparation/journey -- internal diagnostic', () => {
  beforeEach(() => {
    h.gate.mockReset();
    h.resolveAll.mockReset();
    delete process.env.STUDENT_JOURNEY_V2;
  });
  it('404 when STUDENT_JOURNEY_V2 is not SHADOW (no auth call, no resolution)', async () => {
    const res: any = await (journeyGET as any)();
    expect(res.status).toBe(404);
    expect(h.gate).not.toHaveBeenCalled();
    expect(h.resolveAll).not.toHaveBeenCalled();
  });
  it('requires the authenticated owner', async () => {
    process.env.STUDENT_JOURNEY_V2 = 'SHADOW';
    const { NextResponse } = await import('next/server');
    h.gate.mockResolvedValue({ ok: false, res: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) });
    const res: any = await (journeyGET as any)();
    expect(res.status).toBe(401);
    expect(h.resolveAll).not.toHaveBeenCalled();
  });
  it('is marked internal and returns no Student id', async () => {
    process.env.STUDENT_JOURNEY_V2 = 'SHADOW';
    h.gate.mockResolvedValue({ ok: true, studentId: 'student-uuid-xyz' });
    h.resolveAll.mockResolvedValue([resolveStudentExamJourney(base())]);
    const res: any = await (journeyGET as any)();
    expect(res.status).toBe(200);
    expect(res.headers.get('x-studyus-internal')).toBe('JOURNEY_SHADOW_DIAGNOSTIC');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.internal).toBe('JOURNEY_SHADOW_DIAGNOSTIC');
    expect(JSON.stringify(body)).not.toContain('student-uuid-xyz');
    expect(h.resolveAll).toHaveBeenCalledWith('student-uuid-xyz', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });
});

// ------------------------------------------------------------------ defects found by the shadow validation (fixed)
describe('shadow-validation fixes', () => {
  it('BUG_JOURNEY-1: a structure-only exam (DRAFT definition over a PUBLISHED version) has a Blueprint -- the gap is content', () => {
    expect(read('src/lib/exam-journey/facts.server.ts')).toMatch(/v\.status = 'PUBLISHED'[\s\S]*d\.status IN \('ACTIVE', 'DRAFT'\)/);
    const r = resolveStudentExamJourney(base({ blueprint: { ...base().blueprint!, readiness: 'STRUCTURE_READY' }, content: { practice: false, diagnostic: false, reducedMock: false, fullMock: false, learningBridge: false, unavailable: [{ capability: 'PRACTICE', reason: 'STRUCTURE_ONLY' }], reducedMockLengthCoveragePercent: null } }));
    expect(r.blockers.map((b) => b.code)).toContain('CONTENT_UNAVAILABLE');
    expect(r.blockers.map((b) => b.code)).not.toContain('BLUEPRINT_INCOMPLETE');
  });

  it('BUG_JOURNEY-2: in HORIZON, a Student with nothing to learn yet is pointed at what the exam assesses, never at an empty "continue learning"', () => {
    const noScope = { ...base().content!, learningBridge: false };
    const far = (over: Partial<StudentExamJourneyFacts>) => resolveStudentExamJourney(base({ target: { ...base().target!, examDate: '2029-05-01' }, content: noScope, ...over }));
    expect(far({}).recommendedNextAction.kind).toBe('REVIEW_STRUCTURE');
    expect(far({ learner: { ...learner, subjectCount: 2 } }).recommendedNextAction.kind).toBe('CONTINUE_LEARNING');
    expect(far({ content: { ...noScope, learningBridge: true } }).recommendedNextAction.kind).toBe('CONTINUE_LEARNING');
    expect(far({ blueprint: { ...base().blueprint!, readiness: 'CATALOG_ONLY', structureVisible: false } }).recommendedNextAction.kind).toBe('NOTIFY_WHEN_AVAILABLE');
  });
});

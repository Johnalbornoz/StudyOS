/**
 * Question Bank V2 refinement -- quality, human certification, difficulty, usage, alignment,
 * exposure memory, cross-Student collision, demand-driven inventory (pure + source guards).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { bandOf, difficultyView, observedBand, usageAllows, checkReview, reviewStatusOf, ReviewError, effectiveUsage, type ReviewSubject } from '@/lib/exam-core/question-bank/quality';
import { isEligible, lifecycleSqlFor } from '@/lib/exam-core/question-bank/lifecycle';
import { computeCellDemand, difficultyPlan, DEFAULT_DEMAND_POLICY } from '@/lib/exam-core/question-bank/demand';
import { assembleForm, type FormPosition, type PoolItem } from '@/lib/exam-core/form-assembly';
import { computeBankHealth, type BankItemFact } from '@/lib/exam-core/question-bank/health';
import { deriveBlueprintCells } from '@/lib/exam-core/question-bank/cells';
import { applySettingsPatch, settingsFromEnvironment } from '@/lib/exam-core/question-bank/runtime-settings';
import { factoryConfig } from '@/lib/exam-core/question-bank/policy';
import { runDeterministicValidation, validateWellFormed, validateExplanationConsistency, judgeValidatorVerdict } from '@/lib/exam-core/question-bank/validation';
import { ApprovedItemContentSchema } from '@/lib/exam-core/items';

const ROOT = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const MIGRATION = read('database/migrations/20261028_1000_question_bank_quality_exposure_demand.sql');

const subject = (over: Partial<ReviewSubject> = {}): ReviewSubject => ({ provenance: 'STUDYUS_GENERATED', lifecycle: 'PILOT', createdBy: 'system-user', automatedOutcome: 'PASS', inBlueprintCell: true, ...over });
const facts = (over: Partial<Parameters<typeof isEligible>[0]> = {}) => ({ lifecycle: 'ACTIVE' as const, status: 'PUBLISHED', isCurrentVersion: true, retired: false, calibrationConfidence: null, provenance: 'STUDYUS_GENERATED', ...over });

describe('human certification gate', () => {
  it('approval records the reviewer decision; author / editor can never certify their own version', () => {
    expect(checkReview(subject(), { decision: 'APPROVED', notes: null, validatedDifficulty: 3, usage: ['PRACTICE', 'QUIZ'], alignment: 'EXAM_STYLE' }, 'reviewer')).toEqual({ usage: ['PRACTICE', 'QUIZ'], alignment: 'EXAM_STYLE' });
    expect(() => checkReview(subject({ createdBy: 'editor' }), { decision: 'APPROVED', notes: null, validatedDifficulty: null, usage: null, alignment: null }, 'editor')).toThrow(/SELF_REVIEW/);
  });
  it('generated content cannot be approved without a passed automated validation; rejection / correction need notes', () => {
    expect(() => checkReview(subject({ automatedOutcome: 'REPAIR_REQUIRED' }), { decision: 'APPROVED', notes: null, validatedDifficulty: null, usage: null, alignment: null }, 'r')).toThrow(/AUTOMATED_VALIDATION_NOT_PASSED/);
    expect(() => checkReview(subject(), { decision: 'REJECTED', notes: '', validatedDifficulty: null, usage: null, alignment: null }, 'r')).toThrow(/NOTES_REQUIRED/);
    expect(checkReview(subject(), { decision: 'REJECTED', notes: 'Distractor B también es correcto', validatedDifficulty: null, usage: null, alignment: null }, 'r')).toBeTruthy();
  });
  it('the DB refuses ACTIVE for generated content without an APPROVED review row', () => {
    expect(MIGRATION).toMatch(/QUESTION_BANK_HUMAN_APPROVAL_REQUIRED/);
    expect(MIGRATION).toMatch(/r\.decision = 'APPROVED'/);
    expect(read('src/app/api/admin/question-bank/versions/[versionId]/transition/route.ts')).toMatch(/USE_REVIEW_TO_APPROVE/);
  });
  it('review status: pending until a decision, not required for non-generated content', () => {
    expect(reviewStatusOf({ provenance: 'STUDYUS_GENERATED', latestDecision: null, lifecycle: 'PILOT' })).toBe('PENDING');
    expect(reviewStatusOf({ provenance: 'STUDYUS_GENERATED', latestDecision: 'APPROVED', lifecycle: 'ACTIVE' })).toBe('APPROVED');
    expect(reviewStatusOf({ provenance: 'FIXTURE', latestDecision: null, lifecycle: 'ACTIVE' })).toBe('NOT_REQUIRED');
  });
  it('every decision is audited: a review row + a lifecycle transition in one transaction', () => {
    const svc = read('src/lib/exam-core/question-bank/review.service.ts');
    expect(svc).toMatch(/INSERT INTO question_bank_reviews/);
    expect(svc).toMatch(/transitionVersion\(\{ versionId: p\.versionId, to, reason: `REVIEW:/);
    expect(MIGRATION).toMatch(/reviewed_by uuid NOT NULL/);
  });
});

describe('rejected / retired / pilot exclusion', () => {
  it('a rejected version is never eligible for anything', () => {
    expect(isEligible(facts({ lifecycle: 'REJECTED', status: 'REJECTED' }), 'PRACTICE')).toBe(false);
  });
});

describe('difficulty: LOW / MEDIUM / HIGH, three sources never conflated', () => {
  it('bands from the internal 1..5 scale', () => {
    expect([1, 2, 3, 4, 5].map(bandOf)).toEqual(['LOW', 'LOW', 'MEDIUM', 'HIGH', 'HIGH']);
  });
  it('validated wins over declared; observed only with enough evidence and never substituted', () => {
    expect(difficultyView({ declared: 2, validated: 4, empiricalDifficulty: 0.9, confidence: 'INSUFFICIENT_DATA' })).toEqual({ declared: 'LOW', validated: 'HIGH', observed: null, effective: 'HIGH' });
    expect(observedBand(0.3, 'MODERATE_CONFIDENCE')).toBe('HIGH');
    expect(observedBand(0.85, 'EARLY_SIGNAL')).toBe('LOW');
  });
});

describe('usage eligibility + exam alignment', () => {
  it('a PRACTICE-only item never enters a mock; a mock needs a mock-ready alignment', () => {
    expect(usageAllows(['PRACTICE'], 'EXAM_STYLE', 'STUDYUS_GENERATED', 'REDUCED_MOCK')).toBe(false);
    expect(usageAllows(['PRACTICE', 'REDUCED_MOCK'], 'EXAM_STYLE', 'STUDYUS_GENERATED', 'REDUCED_MOCK')).toBe(false);
    expect(usageAllows(['PRACTICE', 'REDUCED_MOCK'], 'MOCK_READY', 'STUDYUS_GENERATED', 'REDUCED_MOCK')).toBe(true);
    expect(isEligible(facts({ usage: ['PRACTICE'], alignment: 'EXAM_STYLE' }), 'REDUCED_MOCK')).toBe(false);
    expect(isEligible(facts({ usage: ['PRACTICE'], alignment: 'EXAM_STYLE' }), 'PRACTICE')).toBe(true);
    expect(isEligible(facts({ usage: ['PRACTICE', 'REDUCED_MOCK'], alignment: 'MOCK_READY' }), 'FULL_MOCK')).toBe(false);
  });
  it('legacy rows (NULL) keep every use they had (non-regression), never FORMAL_ASSESSMENT by default', () => {
    expect(effectiveUsage(null)).toEqual(['PRACTICE', 'DIAGNOSTIC', 'QUIZ', 'REDUCED_MOCK', 'FULL_MOCK']);
    expect(isEligible(facts({ provenance: 'STUDYUS_GENERATED', usage: null, alignment: null }), 'FULL_MOCK')).toBe(true);
    // QB D5: a DEV fixture keeps its uses only for a technical demo; it is never Student content.
    expect(isEligible(facts({ provenance: 'FIXTURE', usage: null, alignment: null }), 'FULL_MOCK', undefined, 'TECHNICAL_DEMO')).toBe(true);
    expect(isEligible(facts({ provenance: 'FIXTURE', usage: null, alignment: null }), 'FULL_MOCK')).toBe(false);
    expect(isEligible(facts({ provenance: 'FIXTURE', usage: null, alignment: null }), 'PRACTICE')).toBe(false);
  });
  it('the delivery SQL applies usage and alignment for mocks only', () => {
    expect(lifecycleSqlFor('PRACTICE')).toMatch(/'PRACTICE' = ANY\(ai\.usage_eligibility\)/);
    expect(lifecycleSqlFor('PRACTICE')).not.toMatch(/exam_alignment/);
    expect(lifecycleSqlFor('FULL_MOCK')).toMatch(/'FULL_MOCK' = ANY\(ai\.usage_eligibility\)\) AND \(ai\.exam_alignment IS NULL OR ai\.exam_alignment IN \('MOCK_READY', 'OFFICIAL'\)\)/);
  });
  it('the reviewer cannot give mock usage without MOCK_READY, nor MOCK_READY outside a blueprint cell', () => {
    expect(() => checkReview(subject(), { decision: 'APPROVED', notes: null, validatedDifficulty: 3, usage: ['PRACTICE', 'REDUCED_MOCK'], alignment: 'EXAM_STYLE' }, 'r')).toThrow(/MOCK_USE_NEEDS_MOCK_READY/);
    expect(() => checkReview(subject({ inBlueprintCell: false }), { decision: 'APPROVED', notes: null, validatedDifficulty: 3, usage: ['PRACTICE'], alignment: 'MOCK_READY' }, 'r')).toThrow(/MOCK_READY_NEEDS_BLUEPRINT/);
    expect(MIGRATION).toMatch(/approved_items_mock_needs_alignment/);
  });
});

describe('OFFICIAL content protection', () => {
  it('generated content never becomes OFFICIAL, whatever the reviewer asks', () => {
    expect(() => checkReview(subject(), { decision: 'APPROVED', notes: null, validatedDifficulty: 3, usage: ['PRACTICE'], alignment: 'OFFICIAL' }, 'r')).toThrow(/OFFICIAL_NOT_ALLOWED/);
    expect(checkReview(subject({ provenance: 'LICENSED' }), { decision: 'APPROVED', notes: null, validatedDifficulty: 3, usage: ['PRACTICE', 'FULL_MOCK'], alignment: 'OFFICIAL' }, 'r').alignment).toBe('OFFICIAL');
  });
  it('and the DB trigger refuses OFFICIAL without official / licensed provenance', () => {
    expect(MIGRATION).toMatch(/NEW\.exam_alignment = 'OFFICIAL' AND prov NOT IN \('OFFICIAL', 'LICENSED'\)/);
  });
});

// ------------------------------------------------------------------ exposure memory
const positions = (n: number): FormPosition[] => Array.from({ length: n }, (_, i) => ({ index: i, blueprintObjectiveTargetId: `t${i}`, assessmentComponentId: 'c', learningObjectiveId: 'lo', questionType: null, difficultyRange: null }));
const pool = (n: number): PoolItem[] => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, learningObjectiveId: 'lo', questionType: null, difficulty: 3, difficultyIndex: 1, marks: 1, templateFingerprint: `tpl${i}`, semanticFingerprint: null, stimulusKey: null, contentOrigin: 'GENERATED' }));
const form = (seed: string, usage: Parameters<typeof assembleForm>[0]['usage'], n = 3, items = 10) =>
  assembleForm({ seed, mode: 'PRACTICE', practiceLevel: 'STANDARD', positions: positions(n), pool: pool(items), usage, officialMarksByComponent: { c: null } }).slots.map((s) => s.approvedItemId!);

describe('Student exposure memory and cross-Student collision', () => {
  it('unseen-first: a new attempt of the same Student prefers questions not seen before', () => {
    const first = form('attempt-1', { approvedItemIds: new Set(), templateFingerprints: new Set() });
    const second = form('attempt-2', { approvedItemIds: new Set(first), templateFingerprints: new Set(), recentApprovedItemIds: new Set(first) });
    expect(second.filter((id) => first.includes(id))).toEqual([]);
  });
  it('repeat fallback: with the pool exhausted, seen items are reused (and counted), never an empty form', () => {
    const seen = new Set(pool(3).map((p) => p.id));
    const f = assembleForm({ seed: 's', mode: 'PRACTICE', practiceLevel: 'STANDARD', positions: positions(3), pool: pool(3), usage: { approvedItemIds: seen, templateFingerprints: new Set(), recentApprovedItemIds: seen }, officialMarksByComponent: { c: null } });
    expect(f.slots.every((s) => s.approvedItemId)).toBe(true);
    expect(f.repeatedForStudent).toBe(3);
  });
  it('cross-Student collision: Student B is steered away from what peers just received', () => {
    const a = form('student-a', { approvedItemIds: new Set(), templateFingerprints: new Set() });
    const peers = new Map(a.map((id) => [id, 3]));
    const b = form('student-a', { approvedItemIds: new Set(), templateFingerprints: new Set(), peerExposure: peers, globalExposure: peers, exposureCeiling: 8 });
    expect(b.filter((id) => a.includes(id)).length).toBe(0);
  });
  it('academic equivalence before randomization: exposure never overrides blueprint filters', () => {
    const p = [...pool(2), { ...pool(1)[0], id: 'other-objective', learningObjectiveId: 'lo-other' }];
    const f = assembleForm({ seed: 's', mode: 'MOCK', practiceLevel: null, positions: positions(2), pool: p, usage: { approvedItemIds: new Set(['i0', 'i1']), templateFingerprints: new Set(), globalExposure: new Map([['i0', 99], ['i1', 99]]) }, officialMarksByComponent: { c: null } });
    expect(f.slots.map((s) => s.approvedItemId).sort()).toEqual(['i0', 'i1']);
  });
  it('a short pool returns a structured shortage signal, never a silently weaker form', () => {
    const f = assembleForm({ seed: 's', mode: 'MOCK', practiceLevel: null, positions: positions(4), pool: pool(2), usage: { approvedItemIds: new Set(), templateFingerprints: new Set() }, officialMarksByComponent: { c: null } });
    expect(f.shortages).toEqual([{ learningObjectiveId: 'lo', missing: 2 }]);
  });
  it('exposures are recorded with what they were for; instance + per-position sourcing both record them', () => {
    expect(read('src/lib/exam-core/exam-instance.service.ts')).toMatch(/exam_instance_id, delivery_use\)/);
    expect(read('src/lib/exam-core/item-sourcing.service.ts')).toMatch(/INSERT INTO exam_item_usage [\s\S]*delivery_use/);
  });
});

describe('demand-driven inventory', () => {
  // The brief's example: 40 Students in process, 12 questions each -> 480 exposures; ceiling 8 -> 60 required; 47 approved.
  const policy = { ...DEFAULT_DEMAND_POLICY, practiceQuestionsPerStudent: 9, mocksPerStudent: 1 };
  const demand = computeCellDemand(
    { blueprintShare: 1, reducedPositions: 3, studentsInProcess: 40, studentsRetentionDue: 0, studentsAssigned: 0, approvedByBand: { LOW: 15, MEDIUM: 23, HIGH: 9 }, mockReady: 30, recentExposures: 120, recentStudents: 30, inPipeline: 0 },
    policy
  );
  it('expected exposures, required unique questions and the deficit', () => {
    expect(demand.expectedQuestionsPerStudent).toBe(12);
    expect(demand.expectedExposures).toBe(480);
    expect(demand.requiredUnique).toBe(60);
    expect(demand.approved).toBe(47);
    expect(demand.deficit).toBe(13);
  });
  it('difficulty-mix deficit and the Factory recommendation (13, split by band)', () => {
    expect(demand.requiredByBand).toEqual({ LOW: 18, MEDIUM: 30, HIGH: 12 });
    expect(demand.deficitByBand).toEqual({ LOW: 3, MEDIUM: 7, HIGH: 3 });
    expect(demand.recommendation.generate).toBe(13);
    expect(demand.recommendation.mix).toEqual({ LOW: 3, MEDIUM: 7, HIGH: 3 });
  });
  it('repeat rate, coverage and status (YELLOW: approaching shortage)', () => {
    expect(demand.expectedRepeatRate).toBeCloseTo(0.217, 2);
    expect(demand.estimatedDaysOfCoverage).toBe(11);
    expect(demand.status).toBe('YELLOW');
    expect(demand.currentExposureRate).toBeCloseTo(2.55, 1);
  });
  it('no demand -> nothing required, nothing generated (no static threshold); work in the pipeline is subtracted', () => {
    const none = computeCellDemand({ blueprintShare: 0.1, reducedPositions: 2, studentsInProcess: 0, studentsRetentionDue: 0, studentsAssigned: 0, approvedByBand: { LOW: 0, MEDIUM: 1, HIGH: 0 }, mockReady: 1, recentExposures: 0, recentStudents: 0, inPipeline: 0 });
    expect(none).toMatchObject({ requiredUnique: 0, deficit: 0, status: 'GREEN', recommendation: { generate: 0 } });
    const piped = computeCellDemand({ blueprintShare: 1, reducedPositions: 3, studentsInProcess: 40, studentsRetentionDue: 0, studentsAssigned: 0, approvedByBand: { LOW: 15, MEDIUM: 23, HIGH: 9 }, mockReady: 30, recentExposures: 0, recentStudents: 0, inPipeline: 10 }, policy);
    expect(piped.recommendation.generate).toBe(3);
  });
  it('RED when the inventory cannot cover half the horizon; retention and assignments add demand', () => {
    const red = computeCellDemand({ blueprintShare: 1, reducedPositions: 3, studentsInProcess: 40, studentsRetentionDue: 10, studentsAssigned: 5, approvedByBand: { LOW: 2, MEDIUM: 3, HIGH: 0 }, mockReady: 5, recentExposures: 0, recentStudents: 0, inPipeline: 0 }, policy);
    expect(red.status).toBe('RED');
    expect(red.expectedExposures).toBe(480 + 30 + 25);
  });
  it('a difficulty plan per candidate from the mix', () => {
    expect(difficultyPlan({ LOW: 1, MEDIUM: 2, HIGH: 1 }, 4)).toEqual([2, 3, 3, 4]);
  });
});

describe('mock integrity with the new metadata', () => {
  it('a full mock is not "full" because raw questions exist: PRACTICE-only items never count for mock readiness', () => {
    const comps = [{ id: 'c', sectionKey: 's', name: 'S', order: 0, officialItemCount: 2, maxMarks: null, simulationCapable: true }];
    const cells = deriveBlueprintCells([{ id: 't1', learningObjectiveId: 'lo', objectiveCode: 'o', assessmentComponentId: 'c', questionType: null, difficultyMin: null, difficultyMax: null, commandTerm: null }, { id: 't2', learningObjectiveId: 'lo', objectiveCode: 'o', assessmentComponentId: 'c', questionType: null, difficultyMin: null, difficultyMax: null, commandTerm: null }], comps);
    const item = (id: string, over: Partial<BankItemFact> = {}): BankItemFact => ({ versionId: id, bankItemId: id, learningObjectiveId: 'lo', questionType: 'mc', difficulty: 3, difficultyIndex: 1, marks: 1, templateFingerprint: id, semanticFingerprint: id, stimulusKey: null, provenance: 'STUDYUS_GENERATED', lifecycle: 'ACTIVE', status: 'PUBLISHED', isCurrentVersion: true, retired: false, calibrationConfidence: null, ...over });
    const practiceOnly = [item('a', { usage: ['PRACTICE'], alignment: 'EXAM_STYLE' }), item('b', { usage: ['PRACTICE'], alignment: 'EXAM_STYLE' })];
    const h = computeBankHealth({ cells, components: comps, items: practiceOnly, queue: [], unitPolicy: { mode: 'ITEM' } });
    expect(h.readiness.practice.ready).toBe(true);
    expect(h.readiness.fullMock.ready).toBe(false);
    const certified = practiceOnly.map((i) => ({ ...i, usage: ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK'], alignment: 'MOCK_READY' }));
    expect(computeBankHealth({ cells, components: comps, items: certified, queue: [], unitPolicy: { mode: 'ITEM' } }).readiness.fullMock.ready).toBe(true);
  });
});

describe('automated validation additions', () => {
  const base = { key: 'k', contentStatus: 'ORIGINAL', contentOrigin: 'GENERATED', language: 'es', type: 'multiple_choice', answerFormat: 'single_choice', question: '¿Cuánto es 3 + 4 en el conjunto de los números naturales?', options: [{ id: 'A', text: '7' }, { id: 'B', text: '6' }, { id: 'C', text: '8' }, { id: 'D', text: '12' }], correctAnswer: 'A', explanation: 'Sumando 3 y 4 se obtiene 7.', difficulty: 2, marks: 1 } as const;
  it('malformed content (generation artifacts) needs repair; ordinary Spanish words are not artifacts', () => {
    expect(validateWellFormed(ApprovedItemContentSchema.parse({ ...base, question: 'Valor de {{x}} cuando todo el año llueve' })).map((i) => i.code)).toContain('MALFORMED_CONTENT');
    expect(validateWellFormed(ApprovedItemContentSchema.parse({ ...base, question: 'Si llueve todo el año, ¿qué ocurre con la cosecha?' }))).toEqual([]);
  });
  it('answer / explanation consistency is a reviewer warning, never a silent pass or a block', () => {
    const c = ApprovedItemContentSchema.parse({ ...base, explanation: 'Se suman los dos números con cuidado.' });
    expect(validateExplanationConsistency(c, { domain: 'MATH' }).map((i) => [i.code, i.severity])).toEqual([['EXPLANATION_DOES_NOT_STATE_KEY', 'WARN']]);
    expect(validateExplanationConsistency(ApprovedItemContentSchema.parse(base), { domain: 'MATH' })).toEqual([]);
  });
  it('objective alignment and difficulty plausibility from the independent validator', () => {
    const v = { selectedOptionId: 'A', confidence: 0.9, alternativeDefensibleOptionIds: [], requiresOutsideInformation: false, implausibleDistractorIds: [] };
    expect(judgeValidatorVerdict({ ...v, assessesRequirement: false }, 'A', { stimulusOnlyEvidence: false }, false).outcome).toBe('REPAIR_REQUIRED');
    const plaus = judgeValidatorVerdict({ ...v, estimatedDifficulty: 'HIGH' }, 'A', { stimulusOnlyEvidence: false }, false, { declaredDifficulty: 1 });
    expect(plaus.outcome).toBe('PASS');
    expect(plaus.issues.map((i) => i.code)).toContain('DIFFICULTY_IMPLAUSIBLE');
    // A key verified by the math engine keeps precedence over a disagreeing validator (shown to the reviewer).
    const det = judgeValidatorVerdict({ ...v, selectedOptionId: 'B' }, 'A', { stimulusOnlyEvidence: false }, false, { deterministicKey: true });
    expect(det.outcome).toBe('PASS');
    expect(det.issues.map((i) => i.code)).toEqual(['VALIDATOR_DISAGREES_WITH_VERIFIED_KEY']);
  });
  it('warnings never block automated validation', () => {
    const spec: any = { cellKey: 'x', learningObjectiveId: 'lo', questionType: null, difficultyRange: null, targetDifficulty: 2, cognitiveDemand: null, language: 'es', answerFormats: ['single_choice'], optionCount: 4, domain: 'MATH', stimulusRequired: false, stimulusOnlyEvidence: false };
    const r = runDeterministicValidation({ ...base, tags: { skill: 'suma' }, distractorRationale: { B: 'resta', C: 'cuenta de más', D: 'multiplica' }, explanation: 'Se suman los dos números con cuidado.' }, spec, { verificationExpression: '3+4', evidenceQuote: null }, []);
    expect(r.outcome).toBe('PASS');
  });
});

describe('Demo Mode stays Preview-only; hard protections stay', () => {
  it('Demo Mode can never be switched on in Production', () => {
    const cur = settingsFromEnvironment(factoryConfig({}));
    expect(() => applySettingsPatch(cur, { demoMode: true }, { VERCEL_ENV: 'production' })).toThrow(/DEMO_MODE_NOT_ALLOWED_IN_PRODUCTION/);
    expect(applySettingsPatch(cur, { demoMode: true }, { VERCEL_ENV: 'preview' }).demoMode).toBe(true);
  });
  it('generation is chunked (max 5 per AI call) and requests are bounded by the DB', () => {
    expect(read('src/lib/exam-core/question-bank/factory.service.ts')).toMatch(/export const GENERATION_CHUNK = 5;/);
    expect(MIGRATION).toMatch(/requested_count BETWEEN 1 AND 25/);
  });
  it('the new admin surfaces are STUDYUS_ADMIN-only', () => {
    for (const f of ['review/route.ts', 'questions/[versionId]/route.ts', 'questions/[versionId]/review/route.ts', 'questions/[versionId]/correct/route.ts', 'demand/[examVersionId]/route.ts']) {
      expect(read(`src/app/api/admin/question-bank/${f}`), f).toMatch(/guardAdminUsersRoute\(/);
    }
  });
  it('new versions inherit quality metadata (corrections change content, not where an item may be used)', () => {
    expect(read('src/lib/exam-core/question-bank/bank.service.ts')).toMatch(/SET usage_eligibility = o\.usage_eligibility, exam_alignment = o\.exam_alignment, validated_difficulty = o\.validated_difficulty/);
  });
});

describe('academic review queue keeps stable exam identity across version supersession', () => {
  it('supports config-key filtering while preserving the legacy exact-version filter', () => {
    const service = read('src/lib/exam-core/question-bank/review-admin.service.ts');

    expect(service).toContain('examVersionId?: string;');
    expect(service).toContain('examConfigKey?: string;');
    expect(service).toContain('if (f.examVersionId) where.push(`qi.exam_version_id = ${p(f.examVersionId)}::uuid`);');
    expect(service).toContain('if (f.examConfigKey) where.push(`d.config_key = ${p(f.examConfigKey)}`);');
  });

  it('the visible Exam selector filters by stable config key, not the published version id', () => {
    const page = read('src/app/dashboard/admin/question-bank/review/page.tsx');

    expect(page).toContain('examConfigKey: safe(sp.examConfigKey');
    expect(page).toContain('name="examConfigKey"');
    expect(page).toContain('value={v.configKey}');
    expect(page).not.toContain('<select name="examVersionId"');
  });
});

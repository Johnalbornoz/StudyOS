/**
 * Saber 11 Matemáticas -- HUMAN REVIEW BATCH 1 (pure + source guards): the decision contract (every point
 * answered, structured human assessment, correction / rejection requirements), "AI never approves",
 * what counts toward content readiness, ONE_MOCK_READY with < 50 slot matches, the calibration report,
 * the Batch 2 gate and the item-level Student practice eligibility of an approved item (E2E-A).
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
import { readFileSync } from 'fs';
import { join } from 'path';
import { REVIEW_CHECKLIST } from '@/lib/exam-core/question-bank/pilots/saber11-math';
import {
  attentionPointsFor, buildHumanReviewReport, CALIBRATION_1_ATTENTION_POINTS, HUMAN_DECISION_LABEL, pilotDecisionProblems, PILOT_REVIEW_CONTRACT, proposalFromContent,
  v21CellCheck, type PilotProposal, type ReviewReportRow,
} from '@/lib/exam-core/question-bank/pilots/human-review';
import { saber11V21DeclaredCells } from '@/lib/exam-core/question-bank/pilots/saber11-v21-cells';
import { checkReview, ReviewError, type ReviewInput } from '@/lib/exam-core/question-bank/quality';
import { isEligible } from '@/lib/exam-core/question-bank/lifecycle';
import { parseExamVerticalConfig } from '@/lib/exam-core/vertical-config';
import { SABER11_MATH_V2 } from '@/lib/exam-core/verticals/v2';
import { certificationInputFromConfig } from '@/lib/exam-core/question-bank/certification-input';
import { assessExam, practiceBlockers, type BankItemFacts } from '@/lib/exam-core/question-bank/mock-certification';
import { ReviewActions } from '@/app/dashboard/admin/question-bank/ReviewActions';

const ROOT = join(__dirname, '..', '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const KEYS = REVIEW_CHECKLIST.map(([k]) => k);
const all = (v = true) => Object.fromEntries(KEYS.map((k) => [k, v])) as Record<string, boolean>;

// Item 8 of the batch as the generator proposed it (Argumentación x Álgebra y cálculo, AVANZADA, key A).
const CONTENT = {
  tags: { competency: 'Argumentación', contentCategory: 'Álgebra y cálculo' },
  difficulty: 4,
  correctAnswer: 'A',
  options: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
};
const proposal: PilotProposal = proposalFromContent(CONTENT);
const ITEM8 = 'qb.saber.argumentacion.52fc43dc03';
const attentionCodes = attentionPointsFor(ITEM8, 'calibration-1').map((a) => a.code);
const answers = (v: 'CONFIRMED' | 'NOT_CONFIRMED' = 'CONFIRMED') => Object.fromEntries(attentionCodes.map((c) => [c, v]));
const assessment = (over: Record<string, unknown> = {}) => ({ contract: PILOT_REVIEW_CONTRACT, reviewedCompetency: 'ARGUMENTACION', reviewedContentCategory: 'ALGEBRA_CALCULO', reviewedDifficulty: 'ADVANCED', reviewedAnswer: 'A', correctionNotes: null, attentionPoints: answers(), ...over });

const subject = { provenance: 'STUDYUS_GENERATED' as const, lifecycle: 'PILOT', createdBy: 'factory-system-user', automatedOutcome: 'PASS', inBlueprintCell: true, requiredChecklist: KEYS, pilot: { proposal, attentionPointCodes: attentionCodes } };
const input = (over: Partial<ReviewInput> = {}): ReviewInput => ({ decision: 'APPROVED', notes: null, validatedDifficulty: null, usage: ['PRACTICE'], alignment: 'EXAM_STYLE', checklist: all(), assessment: assessment(), ...over });
const REVIEWER = 'human-reviewer-user';

describe('the proposal is read from the item itself (never invented)', () => {
  it('competence / content / StudyUs difficulty / key', () => {
    expect(proposal).toEqual({ competency: 'ARGUMENTACION', contentCategory: 'ALGEBRA_CALCULO', difficulty: 'ADVANCED', answerKey: 'A', optionIds: ['A', 'B', 'C', 'D'] });
    expect(proposalFromContent({ tags: {}, difficulty: 5 })).toMatchObject({ competency: null, contentCategory: null, difficulty: null });
  });
  it('decision vocabulary: HUMAN_APPROVED / CORRECTION_REQUIRED / REJECTED map onto the DB contract', () => {
    expect(HUMAN_DECISION_LABEL).toEqual({ APPROVED: 'HUMAN_APPROVED', CORRECTION_REQUESTED: 'CORRECTION_REQUIRED', REJECTED: 'REJECTED' });
  });
});

describe('HUMAN_APPROVED only with every point explicitly confirmed', () => {
  it('a complete, coherent human review approves', () => {
    expect(checkReview(subject, input(), REVIEWER).usage).toEqual(['PRACTICE']);
  });
  it('incomplete checklist (an unanswered point) cannot approve', () => {
    const { ORIGINALITY: _omit, ...partial } = all();
    expect(() => checkReview(subject, input({ checklist: partial }), REVIEWER)).toThrow(/CHECKLIST_INCOMPLETE: ORIGINALITY/);
    expect(() => checkReview(subject, input({ checklist: null }), REVIEWER)).toThrow(/CHECKLIST_INCOMPLETE/);
  });
  it('a failed checklist point cannot approve', () => {
    expect(() => checkReview(subject, input({ checklist: { ...all(), DISTRACTORS: false } }), REVIEWER)).toThrow(/CHECKLIST_INCOMPLETE: DISTRACTORS/);
  });
  it('without the structured human assessment nothing is approved', () => {
    expect(() => checkReview(subject, input({ assessment: undefined }), REVIEWER)).toThrow(/PILOT_REVIEW_INVALID: ASSESSMENT_REQUIRED/);
    expect(() => checkReview(subject, input({ assessment: { ...assessment(), contract: 'other' } }), REVIEWER)).toThrow(/ASSESSMENT_INVALID/);
  });
  it('a confirmed point must agree with what the reviewer determined', () => {
    expect(() => checkReview(subject, input({ assessment: assessment({ reviewedAnswer: 'B' }) }), REVIEWER)).toThrow(/ANSWER_INCONSISTENT/);
    expect(() => checkReview(subject, input({ assessment: assessment({ reviewedCompetency: 'FORMULACION' }) }), REVIEWER)).toThrow(/COMPETENCE_INCONSISTENT/);
    expect(() => checkReview(subject, input({ assessment: assessment({ reviewedContentCategory: 'GEOMETRIA' }) }), REVIEWER)).toThrow(/CONTENT_CATEGORY_INCONSISTENT/);
    expect(() => checkReview(subject, input({ assessment: assessment({ reviewedDifficulty: 'BASIC' }) }), REVIEWER)).toThrow(/DIFFICULTY_INCONSISTENT/);
    expect(() => checkReview(subject, input({ assessment: assessment({ reviewedAnswer: 'E' }) }), REVIEWER)).toThrow(/ANSWER_NOT_AN_OPTION/);
  });
  it('every attention point of the item must be answered (confirmed or not)', () => {
    expect(attentionCodes).toEqual(['WEAK_DISTRACTOR_D', 'MATH_DELIMITERS', 'EXPLANATION_DOES_NOT_STATE_KEY', 'VALIDATOR_ESTIMATED_EASIER']);
    const { MATH_DELIMITERS: _m, ...missing } = answers();
    expect(() => checkReview(subject, input({ assessment: assessment({ attentionPoints: missing }) }), REVIEWER)).toThrow(/ATTENTION_POINT_UNANSWERED/);
    // Answering "not confirmed" is a valid answer: the reviewer may reject an AI observation.
    expect(() => checkReview(subject, input({ assessment: assessment({ attentionPoints: answers('NOT_CONFIRMED') }) }), REVIEWER)).not.toThrow();
  });
});

describe('CORRECTION_REQUIRED and REJECTED', () => {
  const failed = { ...all(), DIFFICULTY: false };
  it('CORRECTION_REQUIRED: failed points + comment + correction notes', () => {
    const ok = input({ decision: 'CORRECTION_REQUESTED', notes: 'La dificultad es menor', checklist: failed, assessment: assessment({ reviewedDifficulty: 'INTERMEDIATE', correctionNotes: 'Reformular como INTERMEDIA o subir la exigencia' }) });
    expect(() => checkReview(subject, ok, REVIEWER)).not.toThrow();
    expect(() => checkReview(subject, { ...ok, assessment: assessment({ reviewedDifficulty: 'INTERMEDIATE', correctionNotes: null }) }, REVIEWER)).toThrow(/CORRECTION_NOTES_REQUIRED/);
    expect(() => checkReview(subject, { ...ok, notes: null }, REVIEWER)).toThrow(/NOTES_REQUIRED/);
    expect(() => checkReview(subject, { ...ok, checklist: all() }, REVIEWER)).toThrow(/CHECKLIST_FAILURE_REQUIRED/);
  });
  it('REJECTED: failed points + reason; an unanswered point is never recorded as a failure', () => {
    const ok = input({ decision: 'REJECTED', notes: 'Clave incorrecta: la respuesta es B', checklist: { ...all(), ANSWER: false }, assessment: assessment({ reviewedAnswer: 'B' }) });
    expect(() => checkReview(subject, ok, REVIEWER)).not.toThrow();
    expect(() => checkReview(subject, { ...ok, notes: '' }, REVIEWER)).toThrow(/NOTES_REQUIRED/);
    const withFailure: Record<string, boolean> = { ...all(), ANSWER: false };
    const { ORIGINALITY: _o, ...unanswered } = withFailure;
    expect(() => checkReview(subject, { ...ok, checklist: unanswered }, REVIEWER)).toThrow(/CHECKLIST_INCOMPLETE: ORIGINALITY/);
  });
  it('items without a pilot keep the previous contract (notes only)', () => {
    const plain = { ...subject, requiredChecklist: null, pilot: null };
    expect(() => checkReview(plain, { decision: 'REJECTED', notes: 'no sirve', validatedDifficulty: null, usage: null, alignment: null }, REVIEWER)).not.toThrow();
  });
});

describe('the reviewer is a human, never the system / author, never inferred', () => {
  it('the factory identity (author) cannot certify', () => {
    expect(() => checkReview(subject, input(), subject.createdBy)).toThrow(ReviewError);
    expect(() => checkReview(subject, input(), subject.createdBy)).toThrow(/SELF_REVIEW/);
  });
  it('the reviewer comes from the authenticated admin session; no CLI command records decisions', () => {
    expect(read('src/app/api/admin/question-bank/questions/[versionId]/review/route.ts')).toMatch(/reviewerUserId: guard\.admin\.actor\.id/);
    const cli = read('scripts/operations/qb-pilot-saber11.ts');
    expect(cli).not.toMatch(/reviewVersion|INSERT INTO question_bank_reviews/);
  });
  it('the UI pre-fills nothing for the human decision (no default Sí/No, competence, content, difficulty or answer)', () => {
    const ui = read('src/app/dashboard/admin/question-bank/ReviewActions.tsx');
    expect(ui).toMatch(/useState<Record<string, boolean \| undefined>>\(\{\}\)/);
    for (const v of ['competency', 'content', 'studyUsDifficulty', 'answer']) expect(ui).toMatch(new RegExp(`const \\[${v}, set\\w+\\] = useState\\(''\\)`));
    expect(ui).toMatch(/\.\.\.\(pilot \? \{\} : \{ validatedDifficulty: difficulty \}\)/);
    expect(ui).toMatch(/disabled=\{busy \|\| usage\.length === 0 \|\| !checklistComplete \|\| !canApprove\}/);
  });
  it('the database re-checks: failed point (20261101), unanswered point / missing assessment / correction notes (20261104)', () => {
    expect(read('database/migrations/20261101_1000_question_bank_review_checklist.sql')).toMatch(/decision <> 'APPROVED' OR NOT jsonb_path_exists\(review_checklist, '\$\.\* \? \(@ == false\)'\)/);
    const m = read('database/migrations/20261104_1000_question_bank_review_assessment.sql');
    expect(m).toMatch(/PILOT_CHECKLIST_POINT_UNANSWERED/);
    expect(m).toMatch(/PILOT_ASSESSMENT_REQUIRED/);
    expect(m).toMatch(/PILOT_CORRECTION_NOTES_REQUIRED/);
    expect(m).toMatch(/review_checklist IS NULL OR decision = 'APPROVED' OR jsonb_path_exists\(review_checklist, '\$\.\* \? \(@ == false\)'\)/);
    expect(m).toMatch(/BEFORE INSERT OR UPDATE ON public\.question_bank_reviews/);
  });
});

// ------------------------------------------------------------------ readiness
const saber = (() => {
  const p = parseExamVerticalConfig(SABER11_MATH_V2);
  if (!p.ok) throw new Error(p.issues.join('; '));
  return p.config;
})();
const COMP = { I: 'INTERPRETACION_Y_REPRESENTACION', F: 'FORMULACION_Y_EJECUCION', A: 'ARGUMENTACION' } as const;
const CONT = { AC: 'ALGEBRA_Y_CALCULO', E: 'ESTADISTICA', G: 'GEOMETRIA' } as const;
const OBJ = { I: 'saber.interpretacion', F: 'saber.formulacion', A: 'saber.argumentacion' } as const;
let n = 0;
function item(objectiveId: string, competence: string, content: string, over: Partial<BankItemFacts> = {}): BankItemFacts {
  n += 1;
  return {
    id: `it-${String(n).padStart(3, '0')}`, objectiveId, questionType: 'multiple_choice', difficulty: 3, marks: 1,
    lifecycle: 'ACTIVE', usage: ['PRACTICE', 'DIAGNOSTIC', 'QUIZ'], alignment: 'EXAM_STYLE', provenance: 'STUDYUS_GENERATED', status: 'PUBLISHED', isCurrentVersion: true, retired: false, calibrationConfidence: null,
    contentStatus: 'ORIGINAL', templateFingerprint: null, structureProblems: [], grading: 'DETERMINISTIC', placeholderSignals: [], unresolvedDependencies: [],
    dimensions: { COMPETENCE: competence, CONTENT_CATEGORY: content, MARKS: '1' }, ...over,
  };
}
const humanApproved = (o = OBJ.F) => item(o, COMP.F, CONT.AC); // ACTIVE: only reachable with an APPROVED review (DB guard)
const correctionRequired = () => item(OBJ.F, COMP.F, CONT.AC, { lifecycle: 'REVIEW_REQUIRED' });
const rejected = () => item(OBJ.F, COMP.F, CONT.AC, { lifecycle: 'REJECTED', usage: null, alignment: null });
const autoPass = () => item(OBJ.F, COMP.F, CONT.AC, { lifecycle: 'PILOT' });
const fixture = () => item(OBJ.F, COMP.F, CONT.AC, { provenance: 'FIXTURE', contentStatus: 'DEV_CERT_FIXTURE' });

describe('what counts toward content readiness', () => {
  it('HUMAN_APPROVED counts (where eligible); CORRECTION_REQUIRED / REJECTED / AUTO_REJECTED / fixtures / AI auto-pass never', () => {
    expect(practiceBlockers(humanApproved())).toEqual([]);
    expect(practiceBlockers(correctionRequired())).toContain('NOT_PRACTICE_ELIGIBLE');
    expect(practiceBlockers(rejected())).toContain('NOT_PRACTICE_ELIGIBLE');
    expect(practiceBlockers(fixture())).toContain('DEV_FIXTURE');
    expect(practiceBlockers(autoPass())).toEqual(['NOT_HUMAN_APPROVED']);
  });
  it('HUMAN_APPROVED counts only where eligible: a retired or superseded approved version does not', () => {
    expect(practiceBlockers(item(OBJ.F, COMP.F, CONT.AC, { retired: true }))).toContain('NOT_PRACTICE_ELIGIBLE');
    expect(practiceBlockers(item(OBJ.F, COMP.F, CONT.AC, { isCurrentVersion: false }))).toContain('NOT_PRACTICE_ELIGIBLE');
  });
  it('the batch as it stands (8 auto-pass + 2 auto-rejected + fixtures): content readiness NONE, no ONE_MOCK_READY', () => {
    const items = [...Array.from({ length: 8 }, autoPass), rejected(), rejected(), ...Array.from({ length: 50 }, fixture)];
    const a = assessExam({ ...certificationInputFromConfig(saber), items });
    expect(a.contentReadiness).toBe('NONE');
    expect(a.mockReady).toBe(false);
    expect(a.practice.covered).toBe(0);
  });
  it('approved items in ONE competence leave readiness NONE (practice needs every blueprint objective)', () => {
    const a = assessExam({ ...certificationInputFromConfig(saber), items: [humanApproved(), humanApproved()] });
    expect(a.practice).toMatchObject({ objectives: 3, covered: 1 });
    expect(a.contentReadiness).toBe('NONE');
  });
  it('ONE_MOCK_READY stays false with fewer than 50 valid slot matches (49 mock-ready items in the right cells)', () => {
    const MATRIX: Array<[keyof typeof COMP, keyof typeof CONT, number]> = [['I', 'AC', 6], ['I', 'E', 7], ['I', 'G', 4], ['F', 'AC', 9], ['F', 'E', 8], ['F', 'G', 5], ['A', 'AC', 4], ['A', 'E', 4], ['A', 'G', 3]];
    const bank = MATRIX.flatMap(([c, k, count]) => Array.from({ length: count }, () => item(OBJ[c], COMP[c], CONT[k], { usage: ['PRACTICE', 'FULL_MOCK'], alignment: 'MOCK_READY' })));
    expect(bank).toHaveLength(50);
    const a49 = assessExam({ ...certificationInputFromConfig(saber), items: bank.slice(1) });
    expect(a49.mockReady).toBe(false);
    expect(a49.contentReadiness).not.toMatch(/MOCK_READY|PRODUCTION_DEPTH/);
    // Practice-ready (every objective has approved content) is not mock-ready.
    expect(a49.contentReadiness).toBe('PRACTICE_READY');
  });
});

describe('Blueprint V2.1 cell of each proposed item', () => {
  const declared = new Set(saber11V21DeclaredCells().keys());
  it('V2.1 declares the 9 competence x content cells (50 slots) -- read from the configuration', () => {
    const cells = saber11V21DeclaredCells();
    expect(cells.size).toBe(9);
    expect([...cells.values()].reduce((a, c) => a + c.count, 0)).toBe(50);
  });
  it('an item in its requested cell, under its competence objective, is a declared V2.1 cell', () => {
    expect(v21CellCheck({ requested: { competency: 'ARGUMENTACION', content: 'ALGEBRA_CALCULO' }, objectiveCode: 'saber.argumentacion', proposal, marks: 1, declaredSignatures: declared })).toEqual({ cell: 'ARGUMENTACION × ALGEBRA_CALCULO', matchesRequest: true, declaredInV21: true, problems: [] });
  });
  it('a classification drift is reported (never silently re-labelled)', () => {
    const r = v21CellCheck({ requested: { competency: 'INTERPRETACION', content: 'GEOMETRIA' }, objectiveCode: 'saber.interpretacion', proposal, marks: 2, declaredSignatures: declared });
    expect(r.problems).toEqual(expect.arrayContaining(['MARKS_NOT_1', 'OBJECTIVE_NOT_COMPETENCE_OBJECTIVE', 'COMPETENCE_DIFFERS_FROM_REQUEST', 'CONTENT_DIFFERS_FROM_REQUEST']));
    expect(r.matchesRequest).toBe(false);
  });
});

// ------------------------------------------------------------------ report
const row = (i: number, over: Partial<ReviewReportRow> = {}): ReviewReportRow => ({
  ordinal: i, itemKey: `k${i}`, autoStatus: 'PASSED_AUTOMATED_VALIDATION', autoIssues: [], lifecycle: 'PILOT', proposal, decision: null, checklist: null, assessment: null, notes: null, invalidReviewer: false, practiceEligible: true, ...over,
});
const batchNow = () => [...Array.from({ length: 8 }, (_, i) => row(i + 1)), row(9, { autoStatus: 'AUTO_REJECTED', lifecycle: 'REJECTED', practiceEligible: false }), row(10, { autoStatus: 'AUTO_REJECTED', lifecycle: 'REJECTED', practiceEligible: false })];
const approvedRow = (i: number, a = assessment()) => row(i, { decision: 'APPROVED', lifecycle: 'ACTIVE', checklist: all(), assessment: a as any });

describe('review report: an automated PASS is never a human approval', () => {
  it('the batch today: AWAITING_HUMAN_REVIEW, 0 approved, NOT_READY_FOR_BATCH_2, no real-content E2E', () => {
    const r = buildHumanReviewReport(batchNow());
    expect(r.status).toBe('AWAITING_HUMAN_REVIEW');
    expect(r.funnel).toEqual({ generated: 10, autoRejected: 2, sentToHumanReview: 8, humanDecided: 0, awaitingHumanReview: 8, humanApproved: 0, correctionRequired: 0, humanRejected: 0 });
    expect(r.rates.automaticRejectionRate).toBe(0.2);
    expect(r.rates.humanApprovalRateAmongReviewed).toBeNull();
    expect(r.rates.firstPassNonAcceptanceRate).toBeNull();
    expect(r.batch2.recommendation).toBe('NOT_READY_FOR_BATCH_2');
    expect(r.e2e.realContentE2EAvailable).toBe('NO');
    expect(r.items.filter((x) => x.humanDecision === 'AWAITING_HUMAN_REVIEW')).toHaveLength(8);
  });
  it('before any decision, 0 checklist failures is reported as NO_REVIEWS_YET -- never as "everything passed"', () => {
    const before = buildHumanReviewReport(batchNow());
    expect(before.funnel).toMatchObject({ generated: 10, autoRejected: 2, awaitingHumanReview: 8, humanDecided: 0, humanApproved: 0, correctionRequired: 0, humanRejected: 0 });
    expect(Object.values(before.checklistFailures).every((n) => n === 0)).toBe(true);
    expect(before.checklistFailureBasis).toMatchObject({ humanDecisions: 0, meaning: 'NO_REVIEWS_YET' });
    expect(before.checklistFailureBasis.text).toMatch(/aún no hay revisiones humanas/);
    expect(read('scripts/operations/qb-pilot-saber11.ts')).toMatch(/checklistFailureBasis\.text/);
  });

  it('rates after (synthetic) human decisions; the 25 % assumption is compared, not assumed', () => {
    const rows = batchNow();
    rows[0] = approvedRow(1);
    rows[1] = approvedRow(2, assessment({ reviewedDifficulty: 'ADVANCED' }));
    rows[2] = row(3, { decision: 'CORRECTION_REQUESTED', lifecycle: 'REVIEW_REQUIRED', checklist: { ...all(), DIFFICULTY: false }, assessment: assessment({ reviewedDifficulty: 'INTERMEDIATE', correctionNotes: 'bajar' }) as any, practiceEligible: false });
    rows[3] = row(4, { decision: 'REJECTED', lifecycle: 'REJECTED', checklist: { ...all(), ANSWER: false, DISTRACTORS: false }, assessment: assessment({ reviewedAnswer: 'B', reviewedCompetency: 'FORMULACION' }) as any, practiceEligible: false });
    for (let i = 4; i < 8; i++) rows[i] = approvedRow(i + 1);
    const r = buildHumanReviewReport(rows);
    expect(r.status).toBe('HUMAN_REVIEW_COMPLETE');
    expect(r.funnel).toMatchObject({ humanApproved: 6, correctionRequired: 1, humanRejected: 1, awaitingHumanReview: 0 });
    expect(r.rates).toMatchObject({ automaticRejectionRate: 0.2, humanApprovalRateAmongReviewed: 0.75, finalFirstPassApprovalRateAmongAll: 0.6, correctionRateAmongReviewed: 0.125, totalRejectionRate: 0.3, firstPassNonAcceptanceRate: 0.4, assumedRejectionRate: 0.25 });
    expect(r.rates.observedMinusAssumed).toEqual({ totalRejection: 0.05, firstPassNonAcceptance: 0.15 });
    expect(r.checklistFailures).toMatchObject({ ANSWER: 1, DISTRACTORS: 1, DIFFICULTY: 1, COMPETENCE: 0 });
    expect(r.answerKeyAccuracy).toEqual({ reviewed: 8, correct: 7, accuracy: 0.875 });
    expect(r.competence.corrections).toEqual([{ item: 4, proposed: 'ARGUMENTACION', reviewed: 'FORMULACION' }]);
    expect(r.difficulty.corrections).toEqual([{ item: 3, proposed: 'ADVANCED', reviewed: 'INTERMEDIATE' }]);
    expect(r.difficulty.meanShiftSteps).toBe(-0.12); // -1/8 rounded to 2 decimals
    expect(r.batch2.recommendation).toBe('READY_TO_CALIBRATE_GENERATOR');
    expect(r.e2e).toEqual({ approvedPracticeEligible: 6, realContentE2EAvailable: 'YES' });
  });
  it('all approved with no divergence and no automated rejection -> READY_FOR_BATCH_2_WITHOUT_CHANGES', () => {
    const r = buildHumanReviewReport(Array.from({ length: 4 }, (_, i) => approvedRow(i + 1)));
    expect(r.batch2.recommendation).toBe('READY_FOR_BATCH_2_WITHOUT_CHANGES');
  });
  it('a decision by an invalid reviewer or without its assessment blocks Batch 2', () => {
    expect(buildHumanReviewReport([approvedRow(1), { ...approvedRow(2), invalidReviewer: true }]).batch2.recommendation).toBe('NOT_READY_FOR_BATCH_2');
    expect(buildHumanReviewReport([approvedRow(1), { ...approvedRow(2), assessment: null }]).batch2.recommendation).toBe('NOT_READY_FOR_BATCH_2');
  });
  it('an approved item that is not practice-deliverable does not open the real-content E2E', () => {
    expect(buildHumanReviewReport([{ ...approvedRow(1), practiceEligible: false }]).e2e.realContentE2EAvailable).toBe('NO');
  });
});

describe('E2E-A: item-level Student practice eligibility (delivery rules as they are)', () => {
  const facts = (lifecycle: string, over: Record<string, unknown> = {}) => ({ lifecycle: lifecycle as any, usage: ['PRACTICE', 'DIAGNOSTIC', 'QUIZ'], alignment: 'EXAM_STYLE', provenance: 'STUDYUS_GENERATED', status: 'PUBLISHED', isCurrentVersion: true, retired: false, calibrationConfidence: null, ...over });
  it('a HUMAN_APPROVED generated item (ACTIVE) is eligible for Student practice, never for a mock (EXAM_STYLE)', () => {
    expect(isEligible(facts('ACTIVE'), 'PRACTICE', undefined, 'STUDENT')).toBe(true);
    expect(isEligible(facts('ACTIVE'), 'REDUCED_MOCK', undefined, 'STUDENT')).toBe(false);
  });
  it('CORRECTION_REQUIRED (REVIEW_REQUIRED) and REJECTED are never delivered', () => {
    expect(isEligible(facts('REVIEW_REQUIRED'), 'PRACTICE', undefined, 'STUDENT')).toBe(false);
    expect(isEligible(facts('REJECTED', { usage: null, alignment: null }), 'PRACTICE', undefined, 'STUDENT')).toBe(false);
  });
  it('FINDING (documented, not changed here): the practice delivery policy also accepts an un-reviewed PILOT item', () => {
    expect(isEligible(facts('PILOT'), 'PRACTICE', undefined, 'STUDENT')).toBe(true);
  });
});

describe('attention points are data for the reviewer, never decisions', () => {
  it('cover the pre-review findings (items 1, 5, 6, 7, 8, 9) plus the common difficulty signal', () => {
    expect(Object.keys(CALIBRATION_1_ATTENTION_POINTS)).toHaveLength(6);
    expect(attentionPointsFor('qb.saber.interpretacion.d1bb446253', 'calibration-1').map((a) => a.code)).toEqual(['COMPETENCE_MAY_BE_FORMULATION', 'DISTRACTOR_RATIONALES_IMPRECISE', 'VALIDATOR_ESTIMATED_EASIER']);
    expect(attentionPointsFor('qb.saber.interpretacion.1af76e7a3a', 'calibration-1').map((a) => a.code)).toEqual(['VALIDATOR_ESTIMATED_EASIER']);
    expect(attentionPointsFor('qb.saber.interpretacion.d1bb446253', 'batch-2')).toEqual([]);
  });
  it('a pilot decision problem list is empty only for a complete, coherent review', () => {
    expect(pilotDecisionProblems({ decision: 'APPROVED', checklist: all(), assessment: assessment(), proposal, requiredChecklist: KEYS, attentionPointCodes: attentionCodes })).toEqual([]);
  });
});

describe('admin review form (render): nothing is pre-decided for the human', () => {
  const pilotProps = {
    contract: PILOT_REVIEW_CONTRACT,
    proposal: { competency: 'ARGUMENTACION', contentCategory: 'ALGEBRA_CALCULO', difficulty: 'ADVANCED', answerKey: 'A' },
    attentionPoints: attentionPointsFor(ITEM8, 'calibration-1'),
    competencyOptions: [{ key: 'INTERPRETACION', label: 'Interpretación y representación' }, { key: 'FORMULACION', label: 'Formulación y ejecución' }, { key: 'ARGUMENTACION', label: 'Argumentación' }],
    contentOptions: [{ key: 'ALGEBRA_CALCULO', label: 'Álgebra y cálculo' }, { key: 'ESTADISTICA', label: 'Estadística' }, { key: 'GEOMETRIA', label: 'Geometría' }],
    options: [{ id: 'A', text: '0' }, { id: 'B', text: '1' }, { id: 'C', text: '2' }, { id: 'D', text: '3' }],
  };
  const html = renderToStaticMarkup(createElement(ReviewActions, { versionId: 'v', official: false, initial: { difficulty: 4, usage: ['PRACTICE'], alignment: 'EXAM_STYLE' }, checklist: REVIEW_CHECKLIST.map(([key, label]) => ({ key, label })), pilot: pilotProps }));
  it('every checklist point and attention point is a Sí / No pair with nothing checked', () => {
    expect(html.match(/type="radio"/g)).toHaveLength((KEYS.length + attentionCodes.length) * 2);
    expect(html).not.toMatch(/type="radio"[^>]*checked/);
  });
  it('competence / content / StudyUs difficulty / answer start empty; no pre-filled validated difficulty', () => {
    expect(html.match(/<option value="" disabled="" selected="">— elige —<\/option>/g)).toHaveLength(4);
    expect(html).not.toContain('Dificultad validada');
    expect(html).toContain('La validación automática no equivale a una aprobación humana');
  });
  it('approve, correct and reject are all disabled until the human completes the decision', () => {
    const buttons = html.match(/<button[^>]*>(Aprobar|Solicitar corrección|Rechazar)<\/button>/g) ?? [];
    expect(buttons).toHaveLength(3);
    for (const b of buttons) expect(b).toMatch(/disabled=""/);
  });
});

/**
 * OE-014, REVISED (lib/assessment-supply/supply-boundary).
 *
 * The first OE-014 forbade every Student-triggered generation. That made ordinary Learning depend on content
 * nobody produced. The rule is now per supply family:
 *   LEARNING              may generate on an explicit command (POST)
 *   INTERNAL_ASSESSMENT   may generate before the attempt begins
 *   STANDARDIZED_EXAM     never generates: insufficient certified content is NOT_READY
 * What did NOT change: no GET generates, no route queues background replenishment, a submission and a completion
 * generate nothing, and delivery from stored items never calls a provider.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  INSUFFICIENT_CERTIFIED_CONTENT,
  INSUFFICIENT_CERTIFIED_CONTENT_STATUS,
  studentRuntimeMayGenerateQuestions,
} from '@/lib/student-runtime/question-supply-policy';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf-8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const walk = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });

const START = 'src/app/api/quizzes/generate-and-take/route.ts';
const COMPLETE = 'src/app/api/assessments/learning/[sessionId]/complete/route.ts';
const DELIVERY = 'src/services/activity-delivery.service.ts';
const ENQUEUE = /scheduleDeliveryReplenishment|requestAssessmentSupply|requestSupplyForSession|enqueueGenerationJob|runGenerationWorker|dispatchDeliveryWorker|INSERT INTO generation_jobs/;
const GENERATORS = /generateQuickCheckQuestions\(|generatePracticeQuestions\(|generateRetentionCheckQuestions\(|generateCanonicalProveQuestions\(|generateCanonicalRetainQuestions\(|generateCanonicalTransferChallenges\(|generateGatedQuestionBatch\(|generateQuestionsForConcept\(/;

describe('the policy follows the supply boundary, and nothing can switch it', () => {
  it('a Learning / Internal Assessment launch may generate; a standardized exam launch (or an unknown mode) may not', () => {
    for (const mode of ['topic_practice', 'review', 'canonical_learn_check', 'quick_check', 'canonical_retain', 'retention_check', 'canonical_transfer', 'canonical_prove', 'diagnostic_check', 'cumulative_assessment']) expect(studentRuntimeMayGenerateQuestions(mode), mode).toBe(true);
    for (const mode of ['exam_simulation', 'something_new', '', null, undefined]) expect(studentRuntimeMayGenerateQuestions(mode as never), String(mode)).toBe(false);
    const src = code('src/lib/student-runtime/question-supply-policy.ts');
    // no environment, header or cookie decides it: a request cannot turn exam generation on
    expect(src).not.toMatch(/process\.env|headers\(|cookies\(/);
  });

  it('the not-ready answer is deterministic', () => {
    expect(INSUFFICIENT_CERTIFIED_CONTENT).toEqual({ success: false, error: 'NOT_READY', reason: 'INSUFFICIENT_CERTIFIED_CONTENT' });
    expect(INSUFFICIENT_CERTIFIED_CONTENT_STATUS).toBe(409);
  });
});

describe('quiz start (POST /api/quizzes/generate-and-take)', () => {
  const src = code(START);
  const gate = src.indexOf('if (!studentRuntimeMayGenerateQuestions(validated.quizMode)) {');

  it('generation_jobs delta = 0: the route cannot enqueue, schedule or run post-response work', () => {
    expect(src).not.toMatch(ENQUEUE);
    expect(src).not.toMatch(/\bafter\(/);
    expect(src).not.toMatch(/activity-delivery-worker\.service|generation-queue\.service|assessment-supply\.service/);
  });

  it('standardized exam: provider generation calls = 0 -- every generator call of the launch sits behind the gate, which returns first', () => {
    expect(gate).toBeGreaterThan(-1);
    const firstGenerator = src.search(GENERATORS);
    expect(firstGenerator).toBeGreaterThan(gate);
    // nothing that generates runs before the gate
    expect(src.slice(0, gate)).not.toMatch(GENERATORS);
    const gateBlock = src.slice(gate, src.indexOf('\n    }\n', gate));
    expect(gateBlock).toMatch(/return NextResponse\.json\(INSUFFICIENT_CERTIFIED_CONTENT, \{ status: INSUFFICIENT_CERTIFIED_CONTENT_STATUS \}\);/);
  });

  it('standardized exam with insufficient certified content: no generation fallback -- the lock is released and NOT_READY is returned', () => {
    const emergency = src.indexOf('emergencyLaunch = { lock: delivery.lock, input: deliveryInput, authorizationMs };');
    expect(emergency).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(emergency);
    // between the bank miss and the gate nothing generates and nothing is stored
    expect(src.slice(emergency, gate)).not.toMatch(/generate[A-Z]\w*\(|storeQuiz\(|completeEmergencyDelivery\(/);
    const gateBlock = src.slice(gate, src.indexOf('\n    }\n', gate));
    expect(gateBlock).toMatch(/if \(emergencyLaunch\) await emergencyLaunch\.lock\.release\(\)/);
  });

  it('a submission never generates a verification variant', () => {
    expect(src).toMatch(/const SUBMISSION_GENERATES_VARIANTS: boolean = false;/);
    expect(src).toMatch(/const variantResult = SUBMISSION_GENERATES_VARIANTS \? await generateQuestionVariant\(/);
    expect(src.match(/generateQuestionVariant\(/g)).toHaveLength(1);
  });
});

describe('learning assessment completion (POST /api/assessments/learning/[sessionId]/complete)', () => {
  const src = code(COMPLETE);
  it('generation_jobs delta = 0 and provider generation calls = 0', () => {
    expect(src).not.toMatch(ENQUEUE);
    expect(src).not.toMatch(/\bafter\(/);
    expect(src).not.toMatch(/generate[A-Z]\w*\(/);
    expect(src.match(/completeLearningAssessment\(/g)).toHaveLength(1);
  });
});

describe('delivery from the certified bank', () => {
  it('reads and assembles; it never queues supply and never generates', () => {
    const src = code(DELIVERY);
    expect(src).not.toMatch(ENQUEUE);
    expect(src).not.toMatch(/\bafter\(|scheduleReplenishment/);
    expect(src).not.toMatch(/generateActivityCandidates|generateCanonicalProveQuestions|generatePracticeQuestions|executeAI|callModel/);
  });
});

describe('no Student-facing surface reaches the generation queue', () => {
  it('pages, layouts and API routes: only the operator benchmark endpoint can enqueue', () => {
    const hits = walk('src/app').filter((f) => /\.(ts|tsx)$/.test(f) && ENQUEUE.test(code(f)));
    expect(hits).toEqual(['src/app/api/internal/delivery-bench/route.ts']);
  });

  it('the quiz page shows a final, explained EXAM state for NOT_READY -- never "not enough questions" for Learning', () => {
    const page = read('src/app/dashboard/quiz/page.tsx');
    expect(page.match(/b(ody)?\.error === 'NOT_READY'/g)).toHaveLength(2);
    expect(page).toMatch(/errorReason === 'INSUFFICIENT_CERTIFIED_CONTENT'\) return notReadyCard\(\);/);
    expect(page).toMatch(/genErrorReason === 'INSUFFICIENT_CERTIFIED_CONTENT'\) return notReadyCard\(\);/);
    const card = page.slice(page.indexOf('const notReadyCard = () => ('), page.indexOf('const notReadyCard = () => (') + 900);
    expect(card).toMatch(/title=\{t\['ax\.fail\.EXAM_CONTENT'\]\}/);
    expect(card).not.toMatch(/NOT_ENOUGH_QUESTIONS/);
  });
});

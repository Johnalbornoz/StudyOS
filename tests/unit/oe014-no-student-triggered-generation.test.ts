/**
 * OE-014 -- no Student action generates a question or replenishes inventory.
 *
 * A Student GET or POST may read the certified bank and create its own attempt, session and evidence records. It
 * never queues a generation job, never calls a provider to write a question and never falls back to legacy
 * generation: when certified content is insufficient the answer is NOT_READY / INSUFFICIENT_CERTIFIED_CONTENT.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  INSUFFICIENT_CERTIFIED_CONTENT,
  INSUFFICIENT_CERTIFIED_CONTENT_STATUS,
  STUDENT_RUNTIME_QUESTION_SUPPLY,
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

describe('the policy is a constant of the architecture', () => {
  it('Student runtime supply is the certified bank only, and nothing can switch it', () => {
    expect(STUDENT_RUNTIME_QUESTION_SUPPLY).toBe('CERTIFIED_BANK_ONLY');
    expect(studentRuntimeMayGenerateQuestions()).toBe(false);
    const src = code('src/lib/student-runtime/question-supply-policy.ts');
    expect(src).not.toMatch(/process\.env|headers\(|cookies\(|import /);
  });

  it('the not-ready answer is deterministic', () => {
    expect(INSUFFICIENT_CERTIFIED_CONTENT).toEqual({ success: false, error: 'NOT_READY', reason: 'INSUFFICIENT_CERTIFIED_CONTENT' });
    expect(INSUFFICIENT_CERTIFIED_CONTENT_STATUS).toBe(409);
  });
});

describe('quiz start (POST /api/quizzes/generate-and-take)', () => {
  const src = code(START);
  const gate = src.indexOf('if (!studentRuntimeMayGenerateQuestions()) {');

  it('generation_jobs delta = 0: the route cannot enqueue, schedule or run post-response work', () => {
    expect(src).not.toMatch(ENQUEUE);
    expect(src).not.toMatch(/\bafter\(/);
    expect(src).not.toMatch(/activity-delivery-worker\.service|generation-queue\.service|assessment-supply\.service/);
  });

  it('provider generation calls = 0: every generator call of the launch sits behind the gate, which returns first', () => {
    expect(gate).toBeGreaterThan(-1);
    const firstGenerator = src.search(GENERATORS);
    expect(firstGenerator).toBeGreaterThan(gate);
    // nothing that generates runs before the gate
    expect(src.slice(0, gate)).not.toMatch(GENERATORS);
    const gateBlock = src.slice(gate, src.indexOf('\n    }\n', gate));
    expect(gateBlock).toMatch(/return NextResponse\.json\(INSUFFICIENT_CERTIFIED_CONTENT, \{ status: INSUFFICIENT_CERTIFIED_CONTENT_STATUS \}\);/);
  });

  it('insufficient inventory: no generation fallback -- the "emergency" lock is released and NOT_READY is returned', () => {
    const emergency = src.indexOf('emergencyLaunch = { lock: delivery.lock, input: deliveryInput, authorizationMs };');
    expect(emergency).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(emergency);
    // between the bank miss and the gate nothing generates and nothing is stored
    expect(src.slice(emergency, gate)).not.toMatch(/generate[A-Z]\w*\(|storeQuiz\(|completeEmergencyDelivery\(/);
    const gateBlock = src.slice(gate, src.indexOf('\n    }\n', gate));
    expect(gateBlock).toMatch(/if \(emergencyLaunch\) await emergencyLaunch\.lock\.release\(\)/);
  });

  it('a submission never generates a verification variant', () => {
    expect(src).toMatch(/const variantResult = studentRuntimeMayGenerateQuestions\(\) \? await generateQuestionVariant\(/);
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

  it('the quiz page shows a final, explained state for NOT_READY instead of a retry', () => {
    const page = read('src/app/dashboard/quiz/page.tsx');
    expect(page.match(/b(ody)?\.error === 'NOT_READY'/g)).toHaveLength(2);
    expect(page).toMatch(/errorReason === 'INSUFFICIENT_CERTIFIED_CONTENT'\) return notReadyCard\(\);/);
    expect(page).toMatch(/genErrorReason === 'INSUFFICIENT_CERTIFIED_CONTENT'\) return notReadyCard\(\);/);
  });
});

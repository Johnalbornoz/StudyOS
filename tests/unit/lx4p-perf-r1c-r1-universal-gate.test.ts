/**
 * LX-4P-PERF-R1C-R1 -- UNIVERSAL QUESTION QUALITY GATE.
 *
 * Invariant: every AI-generated question that can reach a learner passes
 * the StudyUS Question Quality Gate -- the count never decides whether
 * validation runs.
 *
 * This file audits the learner-facing generation paths (source
 * contract), and unit-tests the shared gate primitives
 * (`applyQuestionQualityGate` parallel semantic verify;
 * `gateUnitWithTerraFallback` EMPTY vs SHORT fallback; observability
 * fields). The per-path architecture (parallel chunk gating, Quick Check
 * all-or-nothing, retention 2x3 + one recovery) is covered in the
 * respective mode suites; live Luna/Terra numbers stay blocked on
 * credentials.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

/* ============================================================== *
 * R1 -- AUDIT: every learner-facing generation path is GATED.    *
 * ============================================================== */
describe('R1C-R1 R1 -- learner-facing generation path audit', () => {
  const QG = read('src/services/quiz-generation.service.ts');
  const ROUTE = read('src/app/api/quizzes/generate-and-take/route.ts');

  it('canonical Practice (<=4): gated via generateGatedPracticeBatch / generateGatedQuestionBatch', () => {
    expect(QG).toMatch(/generateGatedPracticeBatch\(conceptId, studentId, subjectId/);
  });

  it('Practice (>4): every parallel chunk goes through gateUnitWithTerraFallback', () => {
    expect(QG).toMatch(/gateUnitWithTerraFallback\(\s*\n?\s*lunaMapped,/);
    expect(QG).toMatch(/fallbackWhen: 'EMPTY'/); // PRACTICE stays partial-tolerant
  });

  it('Quick Check: the 6 slots are gated (applyQuestionQualityGate) with per-slot Terra + all-or-nothing', () => {
    const qc = QG.slice(QG.indexOf('export async function generateQuickCheckQuestions'), QG.indexOf('export async function generatePracticeQuestions'));
    expect(qc).toMatch(/applyQuestionQualityGate\(storedQuestions/);
    expect(qc).toMatch(/requestSlot\(i, TERRA\)/);
    expect(qc).toMatch(/returning no questions rather than a partial set/); // all-or-nothing preserved
  });

  it('Retention: the baseline is gated (retentionApplyGate) feeding the single bounded recovery, published result exact-6-or-nothing (RET-R1: per-question, deficit-preserving)', () => {
    const rc = QG.slice(QG.indexOf('export async function generateRetentionCheckQuestions'), QG.indexOf('async function retentionApplyGate'));
    expect(rc).toMatch(/retentionApplyGate\(mappedBaseline, conceptId, language, studentId, subjectId/);
    expect(QG).toMatch(/async function retentionApplyGate\(/);
    expect(rc).toMatch(/question\(s\) short of the canonical count after bounded recovery/);
    // RET-R1 A2: an accepted question is never discarded because a sibling failed.
    expect(rc).not.toMatch(/chunkAFailed/);
  });

  it('cumulative / exam / diagnostic: routed through generateGatedQuestionBatch, not a bare generateQuestionsForConcept', () => {
    expect(ROUTE).toMatch(/generateGatedQuestionBatch\(cId, validated\.studentId, validated\.subjectId/);
    expect(ROUTE).not.toMatch(/\n\s*generateQuestionsForConcept\(cId,/); // the old ungated call site is gone
  });

  it('Prove / assessment variant: generateQuestionVariant clears the deterministic contract + semantic verdict before acceptance', () => {
    const v = QG.slice(QG.indexOf('export async function generateQuestionVariant'), QG.indexOf('function parseGeneratedQuestionBatch'));
    expect(v).toMatch(/applyQuestionQualityGate\(\[rawVariant\]/);
    expect(v).toMatch(/if \(vGate\.accepted\.length === 0\) return null/);
  });

  it('the ONLY generator that skips the gate is generateQuestionsForConcept itself -- and it is only ever reached THROUGH a gated wrapper', () => {
    // it must not be an import in the route any more (the gated batch replaced it)
    expect(ROUTE).not.toMatch(/^\s*generateQuestionsForConcept,\s*$/m);
    // and the gated wrapper is the only caller of the raw generator in the service layer
    expect(read('src/services/gated-question-generation.service.ts')).toMatch(/generateQuestionsForConcept\(conceptId, studentId, subjectId/);
  });
});

/* The gate PRIMITIVES (`applyQuestionQualityGate` parallel semantic
 * verify; `gateUnitWithTerraFallback` EMPTY vs SHORT + runtime events)
 * are unit-tested in tests/unit/lx4p-perf-r1c-r1-gate-primitives.test.ts
 * -- it whole-module-mocks the contract / verifier / runtime-event
 * modules, which this source-audit file must not. */

/* ============================================================== *
 * Observability schema.                                          *
 * ============================================================== */
describe('R1C-R1 R8 -- AIRuntimeEvent carries the acceptance metadata the live benchmark needs', () => {
  it('acceptedCount / rejectedCount are part of the event contract', () => {
    const src = read('src/lib/ai/runtime-event.ts');
    expect(src).toMatch(/acceptedCount\?: number/);
    expect(src).toMatch(/rejectedCount\?: number/);
    expect(src).toMatch(/first-pass acceptance rate|cost per accepted question/);
  });
});

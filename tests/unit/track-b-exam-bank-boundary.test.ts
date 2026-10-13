/**
 * TRACK B -- the Exam Bank (QF V5.1 / V5.2) and the curriculum-first runtime share ONE vocabulary and no supply.
 *
 *   Learning              generated on an explicit start          never the Exam Bank
 *   Internal Assessment   generated and frozen before the attempt never the Exam Bank
 *   Standardized Exam     the Certified Exam Bank only            never generated at runtime
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { SUPPLY_FAMILIES, SUPPLY_INTENTS, itemCategoryOf, providerGenerationAllowed, supplyFamilyOf, supplySourceOf } from '@/lib/assessment-supply/supply-boundary';
import { EXAM_BANK_ITEM, EXAM_BANK_SUPPLY_FAMILY, EXAM_USES, ITEM_TYPES, SUPPLY_FAMILIES as EXAM_BANK_FAMILIES, examBankServes, supplyForExamPractice, NO_HISTORY, type LiveGovernance } from '@/lib/assessment-instance/v52/supply-authority';

const ROOT = process.cwd();
const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => { const p = `${dir}/${f}`; return statSync(join(ROOT, p)).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('one vocabulary', () => {
  it('the runtime boundary and the Exam Bank name the same three families and the same three item types', () => {
    expect([...EXAM_BANK_FAMILIES]).toEqual([...SUPPLY_FAMILIES]);
    expect(SUPPLY_FAMILIES.map(itemCategoryOf)).toEqual([...ITEM_TYPES]);
    expect(itemCategoryOf(EXAM_BANK_SUPPLY_FAMILY)).toBe(EXAM_BANK_ITEM);
    expect(supplySourceOf('STANDARDIZED_EXAM')).toBe('CERTIFIED_EXAM_BANK');
  });

  it('every exam use of the bank is a standardized-exam intent of the runtime (the exam simulation is the full official form)', () => {
    const examIntents = SUPPLY_INTENTS.filter((i) => supplyFamilyOf(i) === 'STANDARDIZED_EXAM').map((i) => i.replace(/^EXAM_/, ''));
    for (const use of EXAM_USES.filter((u) => u !== 'EXAM_SIMULATION')) expect(examIntents).toContain(use.replace(/^EXAM_/, ''));
  });
});

describe('no shared supply', () => {
  const live: LiveGovernance = { objectEligible: () => true, systemVersionActive: () => true, quarantinedEnvelopes: new Set(), rightsDeliverable: () => true, policyHashInForce: 'x' };

  it('the Exam Bank serves a standardized exam and refuses every other consumer, with or without inventory', () => {
    expect(SUPPLY_FAMILIES.filter(examBankServes)).toEqual(['STANDARDIZED_EXAM']);
    for (const supplyFamily of ['LEARNING', 'INTERNAL_ASSESSMENT', 'AD_HOC', 'PRACTICE', '']) {
      expect(supplyForExamPractice([], { supplyFamily, adapterId: 'PAA.MATEMATICAS', scope: 'PILOT_PREVIEW', conceptIds: ['math.alg.quadratics'], perConcept: 1, difficultyBand: null, selectionSeed: 's' }, live, NO_HISTORY)).toMatchObject({ state: 'REFUSED', reason: 'NOT_AN_EXAM_CONSUMER' });
    }
    // an empty Exam Bank is NOT_READY for an exam; nothing is generated to fill it
    expect(supplyForExamPractice([], { supplyFamily: 'STANDARDIZED_EXAM', adapterId: 'PAA.MATEMATICAS', scope: 'PILOT_PREVIEW', conceptIds: ['math.alg.quadratics'], perConcept: 1, difficultyBand: null, selectionSeed: 's' }, live, NO_HISTORY)).toMatchObject({ state: 'NOT_READY', reason: 'INSUFFICIENT_CERTIFIED_CONTENT' });
  });

  it('a standardized exam never asks a provider for a question, at any moment; Learning and Internal Assessment never on a page render', () => {
    for (const moment of ['PAGE_RENDER', 'EXPLICIT_COMMAND', 'DURING_ATTEMPT'] as const) expect(providerGenerationAllowed('STANDARDIZED_EXAM', moment)).toBe(false);
    expect(providerGenerationAllowed('LEARNING', 'EXPLICIT_COMMAND')).toBe(true);
    expect(providerGenerationAllowed('INTERNAL_ASSESSMENT', 'EXPLICIT_COMMAND')).toBe(true);
    expect(providerGenerationAllowed('LEARNING', 'PAGE_RENDER')).toBe(false);
    expect(providerGenerationAllowed('INTERNAL_ASSESSMENT', 'DURING_ATTEMPT')).toBe(false);
  });

  it('the Learning and Internal Assessment supply never reads the Exam Bank: nothing of it imports assessment-instance', () => {
    const learningSide = [...walk('src/lib/assessment-supply'), 'src/lib/student-runtime/question-supply-policy.ts', 'src/app/api/assessments/learning/start/route.ts', 'src/app/api/quizzes/generate-and-take/route.ts', 'src/lib/assessment-experience/ad-hoc-exam.service.ts', 'src/lib/assessment-foundation/nominal-response-time.ts'];
    for (const f of learningSide) expect(code(f), f).not.toMatch(/assessment-instance|approved_items|question_bank_items/);
  });

  it('the Exam Bank never calls a provider and never reads the Student\'s generated items', () => {
    for (const f of walk('src/lib/assessment-instance')) {
      expect(code(f), f).not.toMatch(/from ['"](openai|@anthropic-ai\/sdk|ai)['"]|ai-runtime|quiz-generation\.service|learning-item-supply|question_bank_candidates/);
    }
  });

  it('the QF V5.1 supply policy is scoped to the Exam Bank: it is not a policy of Learning', () => {
    const policy = read('src/lib/assessment-instance/student-supply-policy.ts');
    expect(policy).toContain('this policy governs STANDARDIZED EXAM supply only');
    // and no Student runtime outside the Exam Bank consults it
    const consumers = walk('src').filter((f) => !f.startsWith('src/lib/assessment-instance/') && /student-supply-policy/.test(code(f)));
    expect(consumers).toEqual([]);
  });

  it('the Exam Bank is not wired to a Student runtime yet: nothing outside it imports it (exam delivery will be the ONLY importer)', () => {
    const importers = walk('src').filter((f) => !f.startsWith('src/lib/assessment-instance/') && /@\/lib\/assessment-instance|\.\.\/assessment-instance/.test(code(f)));
    expect(importers).toEqual([]);
  });
});

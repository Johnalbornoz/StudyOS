/**
 * Curriculum-first architecture -- the supply boundary and its acceptance tests.
 *
 *   LEARNING -> Learning AI Engine            INTERNAL_ASSESSMENT -> Internal Assessment Generator
 *   STANDARDIZED_EXAM -> Certified Exam Question Bank
 *
 * Learning and exam preparation are independent: neither needs the other.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const h = vi.hoisted(() => ({ identities: [] as any[], subjects: {} as Record<string, string>, locks: 0, released: 0, lockFails: false }));
vi.mock('@/lib/db', () => ({ db: { query: async (sql: string, params: any[]) => (/FROM concepts c JOIN subjects s/.test(sql) ? { rows: (params[0] as string[]).filter((id) => h.subjects[id]).map((id) => ({ id, subject_id: h.subjects[id] })) } : { rows: [] }) } }));
vi.mock('@/lib/catalog/concept-identity.service', () => ({ resolveStudentConceptIdentities: async () => h.identities }));
vi.mock('@/services/activity-launch-lock.service', () => ({ acquireLaunchLock: async () => { if (h.lockFails) throw new Error('lock timeout'); h.locks += 1; return { release: async () => { h.released += 1; } }; } }));
vi.mock('@/services/activity-delivery-context.service', () => ({ loadAcademicContext: async () => ({ programme: null }) }));
vi.mock('@/services/subject-generation-context.service', () => ({ getSubjectIBContext: async () => null, resolveLanguageForSubject: async () => 'es' }));
vi.mock('@/services/activity-candidate-generation.service', () => ({ generateActivityCandidates: async () => { throw new Error('the real generator must not run in a unit test'); } }));
vi.mock('@/services/question-bank.service', () => ({ addValidatedCandidates: async () => { throw new Error('the real store must not run in a unit test'); } }));
vi.mock('@/lib/assessment-blueprint/assessment-blueprint.service', () => ({ solveLearningForStudent: async () => { throw new Error('inject solve'); } }));

import {
  SUPPLY_INTENTS, SUPPLY_FAMILIES, evidenceClassOf, insufficientSupplyIs, itemCategoryOf, providerGenerationAllowed, supplyFamilyOf, supplyIntentOfLearningIntent, supplyIntentOfQuizMode, supplyProvenanceOf, supplySourceOf,
} from '@/lib/assessment-supply/supply-boundary';
import { ensureGeneratedSupply, SUPPLY_BOUNDS } from '@/lib/assessment-supply/learning-item-supply.service';
import { candidateSourceOf, LEARNING_INTENTS } from '@/lib/assessment-blueprint/policy/learning';
import { studentRuntimeMayGenerateQuestions } from '@/lib/student-runtime/question-supply-policy';
import { ASSESSMENT_EXPERIENCE_MESSAGES } from '@/lib/i18n/assessment-experience-messages';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((name) => (statSync(join(ROOT, dir, name)).isDirectory() ? walk(`${dir}/${name}`) : [`${dir}/${name}`]));

const STUDENT = 's-1';
const solutionOf = (unmet: Array<{ subject: string; requirement: string; missing: number; cause: string }>, selected = 0) => ({ ok: true as const, solution: { outcome: { status: unmet.length ? (selected ? 'PARTIAL' : 'INSUFFICIENT_COVERAGE') : 'READY', selected: Array.from({ length: selected }), unmet } } });
const short = (canonical: string, missing = 2, cause = 'NO_ELIGIBLE_CANDIDATE') => ({ subject: `CONCEPT:${canonical}`, requirement: 'OPPORTUNITY', missing, cause });

beforeEach(() => {
  h.identities = [{ status: 'CANONICAL', learnerConceptId: 'lc-1', canonicalConceptId: 'K1' }, { status: 'CANONICAL', learnerConceptId: 'lc-2', canonicalConceptId: 'K2' }];
  h.subjects = { 'lc-1': 'subject-1', 'lc-2': 'subject-1' };
  h.locks = 0; h.released = 0; h.lockFails = false;
});

describe('the supply boundary: three item categories, three sources, no generic "get questions"', () => {
  it('every intent has exactly one family, one item category and one source', () => {
    expect(SUPPLY_FAMILIES).toEqual(['LEARNING', 'INTERNAL_ASSESSMENT', 'STANDARDIZED_EXAM']);
    expect(Object.fromEntries(SUPPLY_INTENTS.map((i) => [i, supplyProvenanceOf(i).itemCategory]))).toEqual({
      LEARNING_PRACTICE: 'LEARNING_ITEM', LEARNING_RETENTION: 'LEARNING_ITEM', LEARNING_APPLICATION: 'LEARNING_ITEM',
      INTERNAL_DIAGNOSTIC: 'INTERNAL_ASSESSMENT_ITEM', INTERNAL_MASTERY_CHECK: 'INTERNAL_ASSESSMENT_ITEM', INTERNAL_AD_HOC: 'INTERNAL_ASSESSMENT_ITEM',
      EXAM_PRACTICE: 'EXAM_BANK_ITEM', EXAM_REDUCED_MOCK: 'EXAM_BANK_ITEM', EXAM_FULL_MOCK: 'EXAM_BANK_ITEM', EXAM_CHALLENGE: 'EXAM_BANK_ITEM',
    });
    expect([supplySourceOf('LEARNING'), supplySourceOf('INTERNAL_ASSESSMENT'), supplySourceOf('STANDARDIZED_EXAM')]).toEqual(['LEARNING_AI_ENGINE', 'INTERNAL_ASSESSMENT_GENERATOR', 'CERTIFIED_EXAM_BANK']);
    expect([itemCategoryOf('LEARNING'), evidenceClassOf('LEARNING'), evidenceClassOf('INTERNAL_ASSESSMENT'), evidenceClassOf('STANDARDIZED_EXAM')]).toEqual(['LEARNING_ITEM', 'LEARNING', 'INTERNAL_ASSESSMENT', 'EXAM_ASSESSMENT']);
  });

  it('revised OE-014: Learning generates on a command, an internal assessment before the attempt, a standardized exam never; no page render ever', () => {
    for (const family of SUPPLY_FAMILIES) expect(providerGenerationAllowed(family, 'PAGE_RENDER'), family).toBe(false); // 7. GET requests create no generation
    expect(providerGenerationAllowed('LEARNING', 'EXPLICIT_COMMAND')).toBe(true); // 8. explicit Learning POST may generate
    expect(providerGenerationAllowed('LEARNING', 'DURING_ATTEMPT')).toBe(true);
    expect(providerGenerationAllowed('INTERNAL_ASSESSMENT', 'EXPLICIT_COMMAND')).toBe(true);
    expect(providerGenerationAllowed('INTERNAL_ASSESSMENT', 'DURING_ATTEMPT')).toBe(false); // once the attempt begins: no generation
    expect(providerGenerationAllowed('STANDARDIZED_EXAM', 'EXPLICIT_COMMAND')).toBe(false);
    expect(providerGenerationAllowed('STANDARDIZED_EXAM', 'DURING_ATTEMPT')).toBe(false); // 11. live exam attempt: zero supply provider calls
    expect([insufficientSupplyIs('LEARNING'), insufficientSupplyIs('INTERNAL_ASSESSMENT'), insufficientSupplyIs('STANDARDIZED_EXAM')]).toEqual(['GENERATED_ON_DEMAND', 'GENERATED_ON_DEMAND', 'NOT_READY']);
  });

  it('the existing vocabularies map onto it; an unknown quiz mode fails closed as an exam', () => {
    expect(LEARNING_INTENTS.map((i) => [i, supplyFamilyOf(supplyIntentOfLearningIntent(i)!)])).toEqual([
      ['CONCEPT_PRACTICE', 'LEARNING'], ['TOPIC_PRACTICE', 'LEARNING'], ['CUSTOM_CONCEPT_PRACTICE', 'LEARNING'], ['DIAGNOSTIC', 'INTERNAL_ASSESSMENT'], ['MASTERY_CHECK', 'INTERNAL_ASSESSMENT'],
      ['RETENTION_CHECK', 'LEARNING'], ['MIXED_CUMULATIVE', 'LEARNING'], ['AD_HOC_CONCEPT_EXAM', 'INTERNAL_ASSESSMENT'],
    ]);
    expect(supplyIntentOfLearningIntent('PAA_FULL_MOCK')).toBeNull();
    expect(supplyFamilyOf(supplyIntentOfQuizMode('exam_simulation'))).toBe('STANDARDIZED_EXAM');
    expect(supplyFamilyOf(supplyIntentOfQuizMode('not_a_mode'))).toBe('STANDARDIZED_EXAM');
    expect(studentRuntimeMayGenerateQuestions('topic_practice')).toBe(true);
    expect(studentRuntimeMayGenerateQuestions('exam_simulation')).toBe(false);
  });

  it('no LEARNING or INTERNAL ASSESSMENT intent reads the Certified Exam Bank (QUESTION_BANK_BLOCKS_LEARNING = NO)', () => {
    for (const intent of LEARNING_INTENTS) expect(candidateSourceOf(intent), intent).toBe('LEARNING_ITEM_CACHE');
  });
});

describe('Learning AI Engine / Internal Assessment Generator (ensureGeneratedSupply)', () => {
  const deps = (solves: any[], generated: any[] = []) => {
    const calls = { solve: 0, generate: [] as any[], store: [] as any[], log: [] as any[] };
    return {
      calls,
      overrides: {
        solve: (async () => solves[Math.min(calls.solve++, solves.length - 1)]) as never,
        generate: (async (p: any) => { calls.generate.push(p); return { questions: generated, generator: { provider: 'openai', model: 'm', promptId: 'quiz.question_generation', promptVersion: '3', operationId: p.parentOperationId } }; }) as never,
        store: (async (questions: any[], meta: any) => { calls.store.push({ n: questions.length, meta }); return { inserted: questions.length, ids: questions.map((_, i) => `cand-${i}`) }; }) as never,
        log: (e: Record<string, unknown>) => { calls.log.push(e); },
      },
    };
  };
  const practice = { intent: 'CONCEPT_PRACTICE' as const, depth: 'BALANCED' as const, canonicalConceptIds: [], learnerConceptIds: ['lc-1'] };

  it('1 + 4 + 5. a valid curriculum concept with ZERO items: Learning Practice generates for the Student\'s own concept, with no exam in sight', async () => {
    const d = deps([solutionOf([short('K1', 2)]), solutionOf([], 3)], [{ question: 'q1' }, { question: 'q2' }, { question: 'q3' }]);
    const out = await ensureGeneratedSupply({ studentId: STUDENT, request: practice, asOf: '2026-10-13T12:00:00.000Z' }, d.overrides);
    expect(out).toEqual({ status: 'GENERATED', generated: 3, rounds: 1, unmetCanonicalConceptIds: [] });
    expect(d.calls.generate).toHaveLength(1);
    expect(d.calls.generate[0]).toMatchObject({ activityType: 'PRACTICE', conceptId: 'lc-1', studentId: STUDENT, subjectId: 'subject-1', language: 'es' });
    // nothing of an exam is an input of Learning generation
    expect(JSON.stringify(d.calls.generate[0])).not.toMatch(/exam|blueprint|adapter/i);
    // stored as THIS Student's own item of THIS concept
    expect(d.calls.store[0].meta).toMatchObject({ studentId: STUDENT, conceptId: 'lc-1', activityType: 'PRACTICE' });
    expect(d.calls.log.at(-1)).toMatchObject({ event: 'SUPPLY_RUN', usage: 'LEARNING_RUNTIME_USAGE', family: 'LEARNING', source: 'LEARNING_AI_ENGINE', itemsStored: 3 });
    expect([h.locks, h.released]).toEqual([1, 1]);
  });

  it('nothing short => no provider call, nothing written, no lock (a repeat start is free)', async () => {
    const d = deps([solutionOf([], 4)]);
    expect(await ensureGeneratedSupply({ studentId: STUDENT, request: practice, asOf: 'x' }, d.overrides)).toEqual({ status: 'SUFFICIENT', generated: 0, rounds: 0, unmetCanonicalConceptIds: [] });
    expect([d.calls.generate.length, d.calls.store.length, h.locks]).toEqual([0, 0, 0]);
  });

  it('2. AD_HOC Internal Assessment with zero items: generated in full before the attempt, at the chosen difficulty, for exactly the chosen concepts', async () => {
    const d = deps([solutionOf([short('K1', 2), short('K2', 1, 'ONLY_OTHER_DIFFICULTY')]), solutionOf([], 5)], [{ question: 'a' }, { question: 'b' }, { question: 'c' }]);
    const out = await ensureGeneratedSupply({ studentId: STUDENT, request: { intent: 'AD_HOC_CONCEPT_EXAM', depth: 'BALANCED', canonicalConceptIds: [], learnerConceptIds: ['lc-1', 'lc-2'], difficultyBand: 'HIGH' }, asOf: 'x' }, d.overrides);
    expect(out.status).toBe('GENERATED');
    expect(d.calls.generate.map((g) => g.conceptId).sort()).toEqual(['lc-1', 'lc-2']);
    expect(new Set(d.calls.generate.map((g) => g.activityType))).toEqual(new Set(['PROVE']));
    // HIGH is levels 4-5 of the item scale: the generator is asked inside the band, never outside it
    expect(d.calls.generate.every((g) => g.difficulty >= 4 && g.difficulty <= 5)).toBe(true);
    expect(d.calls.log.at(-1)).toMatchObject({ family: 'INTERNAL_ASSESSMENT', source: 'INTERNAL_ASSESSMENT_GENERATOR' });
  });

  it('bounded: a generator that produces nothing stops after one round and reports exactly what is unmet -- no infinite retry, no widening', async () => {
    const d = deps([solutionOf([short('K1', 2)])], []);
    const out = await ensureGeneratedSupply({ studentId: STUDENT, request: { ...practice, intent: 'AD_HOC_CONCEPT_EXAM' }, asOf: 'x' }, d.overrides);
    expect(out).toEqual({ status: 'INCOMPLETE', generated: 0, rounds: 1, unmetCanonicalConceptIds: ['K1'] });
    expect(d.calls.generate).toHaveLength(1);
    expect(SUPPLY_BOUNDS.LEARNING.rounds).toBeLessThanOrEqual(3);
    expect(SUPPLY_BOUNDS.INTERNAL_ASSESSMENT.rounds).toBeLessThanOrEqual(3);
    // every solve asked for the same request: the scope was never widened
    expect(d.calls.solve).toBe(2);
  });

  it('a generator failure for one concept is a controlled, retryable outcome -- never an Exam Bank fallback', async () => {
    const d = deps([solutionOf([short('K1', 2)])]);
    d.overrides.generate = (async () => { throw new Error('provider down'); }) as never;
    const out = await ensureGeneratedSupply({ studentId: STUDENT, request: practice, asOf: 'x' }, d.overrides);
    expect(out).toMatchObject({ status: 'INCOMPLETE', generated: 0, unmetCanonicalConceptIds: ['K1'] });
    expect(d.calls.log.some((e) => e.event === 'CONCEPT_BATCH_FAILED')).toBe(true);
    expect(h.released).toBe(1);
  });

  it('what generation cannot fix is not generated for: an unresolved concept (no canonical identity), a time limit', async () => {
    const d = deps([solutionOf([{ subject: 'LEARNER_CONCEPT:lc-9', requirement: 'IDENTITY', missing: 1, cause: 'UNRESOLVED_TARGET' }, { subject: 'CONCEPT:K1', requirement: 'OPPORTUNITY', missing: 1, cause: 'TIME_BUDGET' }])]);
    expect((await ensureGeneratedSupply({ studentId: STUDENT, request: practice, asOf: 'x' }, d.overrides)).status).toBe('NOT_GENERATABLE');
    expect(d.calls.generate).toHaveLength(0);
  });

  it('one supply run per Student at a time; a second one generates nothing', async () => {
    h.lockFails = true;
    const d = deps([solutionOf([short('K1')])]);
    expect(await ensureGeneratedSupply({ studentId: STUDENT, request: practice, asOf: 'x' }, d.overrides)).toMatchObject({ status: 'BUSY', generated: 0 });
    expect(d.calls.generate).toHaveLength(0);
  });

  it('36. only the signed-in Student\'s own concepts and items are ever involved', async () => {
    const d = deps([solutionOf([short('K1')]), solutionOf([], 1)], [{ question: 'q' }]);
    await ensureGeneratedSupply({ studentId: STUDENT, request: practice, asOf: 'x' }, d.overrides);
    expect(d.calls.generate.every((g) => g.studentId === STUDENT)).toBe(true);
    expect(d.calls.store.every((s) => s.meta.studentId === STUDENT)).toBe(true);
    // the subject of a concept is read for THIS Student only
    expect(code('src/lib/assessment-supply/learning-item-supply.service.ts')).toMatch(/WHERE c\.id = ANY\(\$1::uuid\[\]\) AND s\.student_id = \$2/);
  });
});

describe('acceptance: the boundary holds in the code', () => {
  const SUPPLY = 'src/lib/assessment-supply/learning-item-supply.service.ts';
  const EXAM_BANK_WRITE = /INSERT INTO (public\.)?(approved_items|question_bank_items|question_bank_item_concepts|question_bank_factory_runs)\b|UPDATE (public\.)?(approved_items|question_bank_items)\b/;

  it('9 + 10. Learning and Internal Assessment generation never write Exam Bank inventory', () => {
    for (const f of [SUPPLY, 'src/services/question-bank.service.ts', 'src/services/activity-candidate-generation.service.ts', 'src/lib/assessment-execution/assessment-start.service.ts']) expect(code(f), f).not.toMatch(EXAM_BANK_WRITE);
    // the Student's own item store is not the global bank
    expect(code('src/services/question-bank.service.ts')).toMatch(/INSERT INTO question_bank_candidates \(student_id, concept_id,/);
    expect(code(SUPPLY)).not.toMatch(/approved_items|question_bank_items|factory\.service|loadReviewedBankLearningCandidates/);
  });

  it('7. no page, layout or GET handler can reach the generation service', () => {
    const importsSupply = /learning-item-supply\.service|ensureGeneratedSupply/;
    const pages = walk('src/app').filter((f) => /(page|layout)\.tsx$/.test(f) && importsSupply.test(code(f)));
    expect(pages).toEqual([]);
    const routes = walk('src/app').filter((f) => /route\.ts$/.test(f) && importsSupply.test(code(f)));
    expect(routes).toEqual(['src/app/api/assessments/learning/start/route.ts']);
    const start = code(routes[0]);
    expect(start).not.toMatch(/export const GET|export async function GET/);
    expect(start).toMatch(/export const POST = /);
    // read models never import it either
    for (const f of walk('src/lib/assessment-experience').filter((x) => /\.ts$/.test(x))) expect(code(f), f).not.toMatch(importsSupply);
    expect(walk('src/components').filter((f) => importsSupply.test(code(f)))).toEqual([]);
  });

  it('8. the explicit start generates BEFORE the attempt exists, and the start authority itself never generates', () => {
    const route = code('src/app/api/assessments/learning/start/route.ts');
    expect(route.indexOf('ensureGeneratedSupply(')).toBeLessThan(route.indexOf('startLearningAssessment({'));
    for (const f of ['src/lib/assessment-execution/assessment-start.service.ts', 'src/lib/assessment-execution/assessment-completion.service.ts', 'src/app/api/assessments/learning/[sessionId]/complete/route.ts']) {
      expect(code(f), f).not.toMatch(/ensureGeneratedSupply|generateActivityCandidates|generatePracticeQuestions|executeAI|callModel/);
    }
  });

  it('3 + 11. a standardized exam attempt is never supplied by a generator: the bank has an item or the position is unavailable', () => {
    const sourcing = code('src/lib/exam-core/item-sourcing.service.ts');
    const fn = sourcing.slice(sourcing.indexOf('export async function sourceExamItem'), sourcing.indexOf('export async function generatedFallbackAllowed'));
    expect(fn).toMatch(/selectApprovedBankItem\(/);
    expect(fn).not.toMatch(/generateValidatedItem\(|generatePracticeQuestions\(/);
    expect(fn).toMatch(/return \{ outcome: 'UNAVAILABLE', reason: 'NO_ITEM_GENERATED' \};/);
  });

  it('6. exam preparation does not require prior StudyUs learning: bank selection reads no Learn history', () => {
    const sourcing = code('src/lib/exam-core/item-sourcing.service.ts');
    const fn = sourcing.slice(sourcing.indexOf('export async function sourceExamItem'), sourcing.indexOf('export async function generatedFallbackAllowed'));
    expect(fn).not.toMatch(/learning_evidence|concept_knowledge_state|mastery_records|question_bank_candidates|student_plan_entries/);
  });

  it('33. copy: Learning never says "not enough questions"; an exam says certified content is still being prepared', () => {
    const M = ASSESSMENT_EXPERIENCE_MESSAGES as Record<string, Record<string, string>>;
    for (const locale of ['es', 'en', 'de', 'fr', 'pt'] as const) for (const k of ['ax.avail.ON_DEMAND', 'ax.start.preparing', 'ax.fail.LEARNING', 'ax.fail.ASSESSMENT', 'ax.fail.EXAM_CONTENT']) expect(M[locale][k], `${locale} ${k}`).toBeTruthy();
    expect(M.en['ax.fail.LEARNING']).toMatch(/couldn’t prepare this practice right now/);
    expect(M.en['ax.fail.EXAM_CONTENT']).toMatch(/certified exam content is still being prepared/);
    expect(M.es['ax.fail.LEARNING']).not.toMatch(/suficientes preguntas|banco/i);
    const start = read('src/app/dashboard/assessment/StartAssessment.tsx');
    expect(start).toMatch(/body\?\.reason === 'LEARNING_GENERATION_FAILED' \? 'LEARNING'/);
  });

  it('18. every evidence record of the canonical runtime says which supply family produced its questions', () => {
    const plan = code('src/lib/assessment-execution/evidence-plan.ts');
    expect(plan).toMatch(/const supply = supplyIntent \? \{ \.\.\.supplyProvenanceOf\(supplyIntent\), evidenceClass: evidenceClassOf\(/);
    expect(plan).toMatch(/const assessment = \(sources: Credited\[\]\) => \(\{\s+supply,/);
  });
});

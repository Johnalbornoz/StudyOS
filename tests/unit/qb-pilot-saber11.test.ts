/**
 * Saber 11 Matemáticas population pilot (approved 2026-10-05): the plan's numbers, the calibration batch,
 * the pilot generation contract and the mandatory human review checklist (pure + source guards).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { calibrationRequests, planProblems, COMPETENCIES, CONTENTS, CROSS_DISTRIBUTION, DIFFICULTY_POLICY, POLICY_NOTES, REVIEW_CHECKLIST, CALIBRATION_BATCH_1 } from '@/lib/exam-core/question-bank/pilots/saber11-math';
import { candidateToContent, generationUserPrompt, GENERATION_SCHEMA, parseGenerationOutput, type GenerationContext } from '@/lib/exam-core/question-bank/prompts';
import { checkReview, ReviewError } from '@/lib/exam-core/question-bank/quality';
import { difficultyPlan } from '@/lib/exam-core/question-bank/demand';
import { ApprovedItemContentSchema } from '@/lib/exam-core/items';

const ROOT = join(__dirname, '..', '..');

describe('approved plan (official vs StudyUs policy)', () => {
  it('is internally consistent and inside every published range', () => {
    expect(planProblems()).toEqual([]);
  });
  it('official competence weights 34/43/23 -> 17/22/11; content 19/19/12 (Algebra & Calculus / Statistics / Geometry)', () => {
    expect(Object.values(COMPETENCIES).map((c) => [c.officialPercent, c.items])).toEqual([[34, 17], [43, 22], [23, 11]]);
    expect([CONTENTS.ALGEBRA_CALCULO.items, CONTENTS.ESTADISTICA.items, CONTENTS.GEOMETRIA.items]).toEqual([19, 19, 12]);
  });
  it('the 3x3 cross-distribution is the approved StudyUs policy 6/7/4, 9/8/5, 4/4/3', () => {
    expect(Object.values(CROSS_DISTRIBUTION).map((r) => [r.ALGEBRA_CALCULO, r.ESTADISTICA, r.GEOMETRIA])).toEqual([[6, 7, 4], [9, 8, 5], [4, 4, 3]]);
    expect(POLICY_NOTES.crossDistribution).toMatch(/not an official Icfes/);
  });
  it('difficulty is the StudyUs scale 30/50/20, never Icfes performance levels; timing and scoring are StudyUs policy', () => {
    expect(Object.entries(DIFFICULTY_POLICY).map(([k, d]) => [k, d.percent, d.items])).toEqual([['BASIC', 30, 15], ['INTERMEDIATE', 50, 25], ['ADVANCED', 20, 10]]);
    expect(POLICY_NOTES.difficulty).toMatch(/never Icfes performance levels/);
    expect(POLICY_NOTES.timing).toMatch(/never presented as official/);
    expect(POLICY_NOTES.scoring).toMatch(/No Icfes 0-100/);
  });
});

describe('calibration batch 1 (the only batch generated before human review)', () => {
  const reqs = calibrationRequests();
  it('10 items, every cell of the matrix, StudyUs difficulty 3 / 5 / 2', () => {
    expect(reqs.reduce((n, r) => n + r.count, 0)).toBe(10);
    expect(new Set(CALIBRATION_BATCH_1.map((c) => `${c.competency}|${c.content}`)).size).toBe(9);
    const all = reqs.flatMap((r) => r.pilot.difficulty);
    expect(['BASIC', 'INTERMEDIATE', 'ADVANCED'].map((d) => all.filter((x) => x === d).length)).toEqual([3, 5, 2]);
  });
  it('each request carries the pilot coordinates, the review checklist and an idempotency key', () => {
    for (const r of reqs) {
      expect(r.pilot).toMatchObject({ pilotKey: 'saber11-math-2026', batch: 'calibration-1', locale: 'es-CO', domain: 'MATH' });
      expect(r.pilot.reviewChecklist).toEqual(REVIEW_CHECKLIST.map(([k]) => k));
      expect(r.idempotencyKey).toMatch(/^saber11-math-2026:calibration-1:/);
    }
    expect(new Set(reqs.map((r) => r.idempotencyKey)).size).toBe(reqs.length);
  });
  it('difficulty mix maps onto the internal scale 2 / 3 / 4', () => {
    const two = reqs.find((r) => r.count === 2)!;
    expect(difficultyPlan(two.difficultyMix, two.count)).toEqual([2, 4]);
  });
});

describe('pilot generation contract', () => {
  const pilot = calibrationRequests()[0].pilot;
  const spec = { cellKey: 'math|saber.interpretacion|*|*|*', learningObjectiveId: 'lo', questionType: null, difficultyRange: null, targetDifficulty: 3, cognitiveDemand: null, language: 'es', answerFormats: ['single_choice'], optionCount: 4, domain: 'MATH' as const, stimulusRequired: false, stimulusOnlyEvidence: false };
  const ctx: GenerationContext = { examLabel: 'Saber 11', versionLabel: 'V2', componentName: 'Matemáticas', componentContract: null, objectiveCode: 'saber.interpretacion', objectiveDescription: 'x', spec, count: 1, reason: 'MANUAL_SMALL_BATCH', exemplars: [], avoidStems: [], pilot, difficultyPlan: [3] };
  it('the prompt states content category, competence, assertion, evidence claim, StudyUs difficulty and es-CO', () => {
    const p = generationUserPrompt(ctx);
    expect(p).toContain('CONTENT CATEGORY (required): Álgebra y cálculo');
    expect(p).toContain('COMPETENCE (required): Interpretación y representación');
    expect(p).toContain('frameworkEvidence');
    expect(p).toMatch(/StudyUs scale .* never an official performance level/);
    expect(p).toContain('es-CO');
    expect(generationUserPrompt({ ...ctx, pilot: null })).not.toContain('CONTENT CATEGORY');
  });
  it('the structured-output schema requires frameworkEvidence (strict mode: every property is required)', () => {
    const item = (GENERATION_SCHEMA as any).schema.properties.items.items;
    expect(item.required).toContain('frameworkEvidence');
    expect(Object.keys(item.properties).sort()).toEqual([...item.required].sort());
  });
  it('the stored item carries the framework coordinates as tags; the evidence is the generator claim', () => {
    const [c] = parseGenerationOutput({ items: [{ question: '¿Cuál es la pendiente de la recta?', options: ['1', '2', '3', '4'], correctIndex: 1, explanation: 'Δy/Δx = 2.', difficulty: 3, cognitiveDemand: 'APPLICATION', skill: 'pendiente', distractorRationales: ['', '', '', ''], distractorMisconceptions: [null, null, null, null], stimulusTitle: null, stimulusText: null, evidenceQuote: null, verificationExpression: '4/2', frameworkEvidence: 'Relaciona la representación gráfica con la tabular.' }] }, { count: 1, optionCount: 4 }).value;
    const { content } = candidateToContent(c, { itemKey: 'qb.x', spec, stimulusKey: null, difficultyIndex: 1, pilot });
    expect(content.tags).toMatchObject({ competency: 'Interpretación y representación', contentCategory: 'Álgebra y cálculo', evidence: 'Relaciona la representación gráfica con la tabular.' });
    expect(content).toMatchObject({ contentOrigin: 'GENERATED', contentStatus: 'ORIGINAL', marks: 1 });
    expect(ApprovedItemContentSchema.safeParse(content).success).toBe(true);
  });
  it('a pilot PASS without its framework tags goes to human review, never PILOT (source guard)', () => {
    const f = readFileSync(join(ROOT, 'src/lib/exam-core/question-bank/factory.service.ts'), 'utf8');
    expect(f).toMatch(/code: 'PILOT_TAGS_MISSING', severity: 'REVIEW'/);
    expect(f).toMatch(/pilot\?\.domain === 'MATH' \? \{ \.\.\.cellSpec, domain: 'MATH'/);
  });
});

describe('human review checklist (mandatory for pilot items)', () => {
  const subject = { provenance: 'STUDYUS_GENERATED' as const, lifecycle: 'PILOT', createdBy: 'system', automatedOutcome: 'PASS', inBlueprintCell: true, requiredChecklist: REVIEW_CHECKLIST.map(([k]) => k) };
  const all = Object.fromEntries(REVIEW_CHECKLIST.map(([k]) => [k, true]));
  it('the nine points are the approved ones', () => {
    expect(REVIEW_CHECKLIST.map(([k]) => k)).toEqual(['ANSWER', 'DISTRACTORS', 'COMPETENCE', 'ASSERTION_EVIDENCE', 'CONTENT_CATEGORY', 'DIFFICULTY', 'LANGUAGE', 'SOLUTION', 'ORIGINALITY']);
  });
  it('APPROVED needs every point confirmed', () => {
    expect(() => checkReview(subject, { decision: 'APPROVED', notes: null, validatedDifficulty: 3, usage: ['PRACTICE'], alignment: 'EXAM_STYLE', checklist: { ...all, ORIGINALITY: false } }, 'reviewer')).toThrow(/CHECKLIST_INCOMPLETE: ORIGINALITY/);
    expect(() => checkReview(subject, { decision: 'APPROVED', notes: null, validatedDifficulty: 3, usage: ['PRACTICE'], alignment: 'EXAM_STYLE' }, 'reviewer')).toThrow(ReviewError);
    expect(checkReview(subject, { decision: 'APPROVED', notes: null, validatedDifficulty: 3, usage: ['PRACTICE', 'FULL_MOCK'], alignment: 'MOCK_READY', checklist: all }, 'reviewer').usage).toEqual(['PRACTICE', 'FULL_MOCK']);
  });
  it('a rejection may record failed points; the author never reviews; items without a pilot are unchanged', () => {
    expect(checkReview(subject, { decision: 'REJECTED', notes: 'clave incorrecta', validatedDifficulty: null, usage: null, alignment: null, checklist: { ...all, ANSWER: false } }, 'reviewer').usage).toEqual(['PRACTICE', 'DIAGNOSTIC', 'QUIZ']);
    expect(() => checkReview(subject, { decision: 'APPROVED', notes: null, validatedDifficulty: 3, usage: ['PRACTICE'], alignment: 'EXAM_STYLE', checklist: all }, 'system')).toThrow(/SELF_REVIEW/);
    expect(() => checkReview({ ...subject, requiredChecklist: null }, { decision: 'APPROVED', notes: null, validatedDifficulty: 3, usage: ['PRACTICE'], alignment: 'EXAM_STYLE' }, 'reviewer')).not.toThrow();
  });
  it('the migration and the service re-check it; the admin UI cannot approve with the checklist incomplete', () => {
    expect(readFileSync(join(ROOT, 'database/migrations/20261101_1000_question_bank_review_checklist.sql'), 'utf8')).toMatch(/decision <> 'APPROVED' OR NOT jsonb_path_exists\(review_checklist, '\$\.\* \? \(@ == false\)'\)/);
    expect(readFileSync(join(ROOT, 'src/lib/exam-core/question-bank/review.service.ts'), 'utf8')).toMatch(/generation_params->'pilot'->'reviewChecklist'/);
    expect(readFileSync(join(ROOT, 'src/app/dashboard/admin/question-bank/ReviewActions.tsx'), 'utf8')).toMatch(/disabled=\{busy \|\| usage\.length === 0 \|\| !checklistComplete \|\| !canApprove\}/);
  });
});

describe('calibration finding: math delimiters the item renderer cannot show', () => {
  it('\\( \\) / \\[ \\] in generated content -> REPAIR (the renderer only understands $...$ / $$...$$)', async () => {
    const { validateWellFormed } = await import('@/lib/exam-core/question-bank/validation');
    const { parseMathText } = await import('@/lib/math-text');
    const base = { key: 'k', contentStatus: 'ORIGINAL', language: 'es', type: 'multiple_choice', answerFormat: 'single_choice', options: [{ id: 'A', text: '0' }, { id: 'B', text: '1' }], correctAnswer: 'A', explanation: 'La expresión no está definida en x = 3.', difficulty: 4, marks: 1 } as any;
    expect(parseMathText('obtiene \\(x+3=6\\)')).toEqual([{ type: 'text', value: 'obtiene \\(x+3=6\\)' }]);
    expect(validateWellFormed({ ...base, question: 'Resuelve \\((x^2-9)/(x-3)=6\\).' }).map((i) => i.code)).toContain('UNSUPPORTED_MATH_DELIMITERS');
    expect(validateWellFormed({ ...base, question: 'Resuelve $(x^2-9)/(x-3)=6$.' }).map((i) => i.code)).not.toContain('UNSUPPORTED_MATH_DELIMITERS');
    expect(readFileSync(join(ROOT, 'src/lib/exam-core/question-bank/prompts.ts'), 'utf8')).toMatch(/never \\\\\( \\\\\) or/);
  });
});

describe('pilot review survives exam-version supersession', () => {
  const source = readFileSync(join(ROOT, 'scripts/operations/qb-pilot-saber11.ts'), 'utf8');

  it('pilotItems resolves the pilot by stable exam identity, never the current published version id', () => {
    const start = source.indexOf('async function pilotItems()');
    const end = source.indexOf('async function status()');
    const body = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(body).toContain('JOIN exam_definitions d ON d.id = ev.exam_definition_id');
    expect(body).toContain('WHERE d.config_key = $1');
    expect(body).toContain("gr.generation_params->'pilot'->>'pilotKey' = $2");
    expect(body).toContain('[SABER11_MATH_CONFIG_KEY, SABER11_MATH_PILOT_KEY]');
    expect(body).not.toContain('qi.exam_version_id = $1');
    expect(body).not.toContain('const version = await saberVersion()');
  });

  it('batchRows resolves config key + pilot key + batch across superseded versions', () => {
    const start = source.indexOf('async function batchRows(batch: string)');
    const end = source.indexOf('function toReportRow');
    const body = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(body).toContain('JOIN exam_definitions d ON d.id = ev.exam_definition_id');
    expect(body).toContain('WHERE d.config_key = $1');
    expect(body).toContain("gr.generation_params->'pilot'->>'pilotKey' = $2");
    expect(body).toContain("gr.generation_params->'pilot'->>'batch' = $3");
    expect(body).toContain('[SABER11_MATH_CONFIG_KEY, SABER11_MATH_PILOT_KEY, batch]');
    expect(body).not.toContain('qi.exam_version_id = $1');
    expect(body).not.toContain('const version = await saberVersion()');
  });
});

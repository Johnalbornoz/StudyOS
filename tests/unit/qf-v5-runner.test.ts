/**
 * Question Factory V5 -- prompt policy, specification planning, the batch engine end to end on a stub model, the
 * review package and the spend refusal. No provider is called and no key is read.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATION_PROFILES, profileById } from '@/lib/exam-core/question-bank/production/v5/generation-profile';
import { CandidateItemSchema, learnerView } from '@/lib/exam-core/question-bank/production/v5/item';
import { authoringPrompt, difficultyPrompt, parseAuthored, parseSolver, solverPrompt, constructPrompt } from '@/lib/exam-core/question-bank/production/v5/prompts';
import { assessmentBrief, difficultyInput, solverInput } from '@/lib/exam-core/question-bank/production/v5/pipeline';
import { TIER_CYCLE } from '@/lib/exam-core/question-bank/production/v5/plan';
import { auditSample, calibrationGate, reviewQueue } from '@/lib/exam-core/question-bank/production/v5/batch-control';
import { clusterOf, planState } from '../../scripts/operations/qf-v5/run';
import { WORST_CASE_CALLS, runBatch, type ModelCall } from '../../scripts/operations/qf-v5/engine';
import { REVIEW_HEADER, coverageRows, reviewCsv, reviewRow, toCsv } from '../../scripts/operations/qf-v5/artifacts';

const ROOT = join(__dirname, '..', '..');
const { specifications, allocation, readiness, sections } = planState([]);
const saber = specifications.filter((s) => s.profileId === 'ICFES.SABER11.MATEMATICAS');

const WORDS = 'granja mercado puente taller museo estadio biblioteca cosecha represa ferrocarril vivero panadería acueducto teatro muelle cantera molino huerta imprenta fábrica laboratorio almacén terminal mirador parque plaza colegio hospital embalse túnel faro aeropuerto bodega refinería invernadero establo glorieta avenida ciclovía cancha'.split(' ');
const VERBS = 'registra compara estima reparte ajusta proyecta mide organiza distribuye clasifica calcula verifica reduce amplía combina alterna'.split(' ');
/** A distinct, well-formed selected-response item for a specification: different words, not a re-numbered template. */
const authored = (slotKey: string, attempt: number, n: number, over: Record<string, unknown> = {}) => {
  const w = (k: number) => WORDS[(n * 7 + k * 11) % WORDS.length];
  const v = (k: number) => VERBS[(n * 5 + k * 3) % VERBS.length];
  const a = 20 + n; const b = 3 + (n % 7);
  return JSON.stringify({
    v: 1, itemId: `${slotKey}#${attempt}`, slotKey, itemType: 'SELECTED_RESPONSE', language: 'es', stimulus: null,
    fullLearnerPrompt: `En ${w(1)} ${w(2)} se ${v(1)} ${a} unidades por ${w(3)} y luego se ${v(2)} ${b} veces en ${w(4)} ${w(5)} junto a ${w(6)}. Quien ${v(3)} el ${w(7)} afirma que el ${w(8)} total equivale al producto. ¿Qué valor sustenta esa afirmación sobre ${w(9)} y ${w(10)}?`,
    parts: [], options: [{ label: 'A', text: String(a + b) }, { label: 'B', text: String(a * b) }, { label: 'C', text: String(a * b + b) }, { label: 'D', text: String(a - b) }],
    proposedAnswer: 'B', answerExpression: `${a}*${b}`, acceptedUnits: [], solution: `${a} por ${b}.`, rubric: [], distractorRationales: { A: 'suma en lugar de multiplicar', C: 'cuenta un grupo de más', D: 'resta' }, marks: 1, commandTerm: null, provenance: 'ORIGINAL_STUDYUS', ...over,
  });
};
/** A stub model: authors from the slot key in the request and answers each judge the way `judge` says. */
const model = (over: { author?: (slot: string, attempt: number, n: number) => string; solver?: string; construct?: Record<string, unknown>; difficulty?: (text: string) => Record<string, unknown> } = {}) => {
  const seen: { role: string; text: string }[] = [];
  let n = 0;
  const call: ModelCall = async (role, prompt) => {
    seen.push({ role, text: `${prompt.system}\n${prompt.user}` });
    const usage = { inputTokens: 900, outputTokens: 300 };
    if (role === 'AUTHOR') { const m = /itemId \("(.+)#(\d)"\)/.exec(prompt.user)!; n += 1; return { text: (over.author ?? authored)(m[1], Number(m[2]), n), ...usage }; }
    if (role === 'SOLVER') return { text: JSON.stringify({ independentAnswer: over.solver ?? 'B', solution: 'producto', confidence: 'HIGH', ambiguityFlag: false, ambiguityNote: null }), ...usage };
    if (prompt.user.includes('"actualDifficulty"')) return { text: JSON.stringify(over.difficulty ? over.difficulty(prompt.user) : { actualDifficulty: null }), ...usage };
    if (prompt.user.includes('"constructFit"')) return { text: JSON.stringify({ constructFit: 'PASS', authenticity: 'HIGH', contextMaterial: true, languageQuality: 'PASS', plausibility: 'PASS', provenanceConcern: false, note: 'ok', ...over.construct }), ...usage };
    return { text: JSON.stringify({ quality: 'PASS', defensibleOptions: ['B'], note: 'ok' }), ...usage };
  };
  return { call, seen };
};

describe('generator prompt policy', () => {
  const spec = saber[0];
  const p = profileById(spec.profileId)!;
  it('the authoring request carries the nine parts and asks for the pedagogical objective, not a schema', () => {
    const r = authoringPrompt(spec, p);
    for (const part of ['A. ASSESSMENT', 'B. REQUIREMENT', 'C. SCOPE', 'D. COGNITIVE DEMAND', 'E. DIFFICULTY', 'F. FORMAT', 'G. ORIGINALITY', 'H. LEARNER LANGUAGE', 'I. PROHIBITED']) expect(r.user).toContain(part);
    expect(r.system).toMatch(/generic textbook exercise is a failure/);
    expect(r.user).toMatch(/Never from: length of the text; tedious arithmetic; large or awkward numbers/);
    expect(r.user).toContain('worth 1 mark');
    expect(r.user).toContain('Spanish');
  });
  it('each family is given its own request, not one template with the name substituted', () => {
    const body = (id: string) => { const s = specifications.find((x) => x.profileId === id)!; return authoringPrompt(s, profileById(id)!).user.split('\n\n').filter((b) => /^(A|D|E|I)\./.test(b)).join('\n'); };
    const ids = ['PAA.MATEMATICAS', 'PISA.MATHEMATICS', 'IB.MATH_AA.HL.P1', 'CAMBRIDGE.0580.EXTENDED.P4', 'AICE.9709.MECHANICS', 'ICFES.SABER11.MATEMATICAS'];
    expect(new Set(ids.map(body)).size).toBe(6);
    expect(body('PISA.MATHEMATICS')).toMatch(/one-step calculation hidden in a narrative/);
    expect(body('IB.MATH_AA.HL.P1')).toMatch(/HL item an SL candidate answers/);
    expect(body('ICFES.SABER11.MATEMATICAS')).toMatch(/artificial story/);
  });
  it('the solver and the calibrator are asked from the learner view alone', () => {
    const item = CandidateItemSchema.parse(JSON.parse(authored(spec.slotKey, 0, 1)));
    const s = solverPrompt(solverInput(item));
    for (const secret of ['suma en lugar', '21 por 4', '21*4', spec.intendedDifficulty, spec.bucket.objectiveCode, 'KEYED']) expect(`${s.system}${s.user}`).not.toContain(secret);
    expect(s.user).toContain(learnerView(item).prompt);
    const d = difficultyPrompt(difficultyInput(item, p));
    expect(d.system).toMatch(/not told what difficulty was intended/);
    expect(d.user).not.toMatch(/intended|proposedAnswer|suma en lugar/);
    // the construct judge is told what the assessment is, never the key
    const c = constructPrompt({ view: learnerView(item), brief: assessmentBrief(p), commandTerm: null, cognitiveTarget: spec.cognitiveTarget });
    expect(c.user).not.toMatch(/suma en lugar|"B"/);
  });
  it('replies are parsed strictly: a fenced, prefixed or mis-shaped reply is malformed, never repaired', () => {
    expect(() => parseAuthored('```json\n{}\n```')).toThrow(/MALFORMED_REPLY/);
    expect(() => parseAuthored('Here is the item: {}')).toThrow(/MALFORMED_REPLY/);
    expect(() => parseSolver('{"independentAnswer":"B"}')).toThrow(/MALFORMED_REPLY/);
    expect(() => parseSolver('{"independentAnswer":"B","solution":"","confidence":"SURE","ambiguityFlag":false,"ambiguityNote":null}')).toThrow(/MALFORMED_REPLY/);
    expect(parseSolver('{"independentAnswer":"B","solution":"","confidence":"HIGH","ambiguityFlag":false,"ambiguityNote":null}').independentAnswer).toBe('B');
  });
});

describe('coverage-driven specification planning', () => {
  it('plans from the gap of every governed bucket, three forms deep, with one specification per slot', () => {
    expect(specifications.length).toBe(allocation.reduce((a, r) => a + r.toGenerate, 0));
    expect(new Set(specifications.map((s) => s.slotKey)).size).toBe(specifications.length);
    expect(saber.length).toBe(Math.ceil(150 / 0.8) + 2); // 50 slots x 3 forms, over nine buckets each rounded up
    const perFamily = new Map<string, number>();
    for (const s of specifications) perFamily.set(s.family, (perFamily.get(s.family) ?? 0) + 1);
    expect([...perFamily.keys()].sort()).toEqual(['AICE', 'CAMBRIDGE', 'IB', 'ICFES', 'PAA', 'PISA']);
    expect(new Set(perFamily.values()).size).toBe(6);
    expect(new Set(specifications.map((s) => clusterOf(s.profileId))).size).toBe(21);
  });
  it('fixes format, tier, marks and command term before anything is authored, within the profile', () => {
    for (const s of specifications) {
      const p = profileById(s.profileId)!;
      expect(p.itemFormats, s.slotKey).toContain(s.itemFormat);
      const selected = s.itemFormat === 'SELECTED_RESPONSE' || s.itemFormat === 'MULTI_SELECT';
      if (selected) expect(s.intendedMarks, s.slotKey).toBe(1);
      else { expect(s.intendedMarks).toBeGreaterThanOrEqual(p.markPolicy.constructedMarks[0]); expect(s.intendedMarks).toBeLessThanOrEqual(p.markPolicy.constructedMarks[1]); }
      if (p.commandTermPolicy.required && !selected) expect(p.commandTermPolicy.allowed, s.slotKey).toContain(s.commandTerm);
      else expect(s.commandTerm).toBe(null);
    }
    expect(TIER_CYCLE.filter((t) => t === 'FOUNDATIONAL').length).toBe(3);
    expect(TIER_CYCLE.filter((t) => t === 'CHALLENGE').length).toBe(2);
    // no selected-response slot is given more marks because it is a CHALLENGE slot
    expect(specifications.filter((s) => s.itemFormat === 'SELECTED_RESPONSE' && s.intendedDifficulty === 'CHALLENGE').every((s) => s.intendedMarks === 1)).toBe(true);
    expect(GENERATION_PROFILES.filter((p) => !specifications.some((s) => s.profileId === p.profileId)).map((p) => p.profileId)).toEqual([]);
  });
});

describe('the batch engine, end to end on a stub model', () => {
  const tier = (text: string, specs = saber) => { const s = specs.find((x) => text.includes('__never__')) ?? null; return s; };
  void tier;
  it('a calibrated batch passes C1; every item went through every stage and nothing was approved unverified', async () => {
    const batch = saber.slice(0, 20);
    const bySlot = new Map(batch.map((s) => [s.slotKey, s]));
    let current = '';
    const m = model({ author: (slot, attempt, n) => { current = slot; return authored(slot, attempt, n); }, difficulty: () => ({ actualDifficulty: bySlot.get(current)!.intendedDifficulty, alsoPlausible: null, reasoningTransitions: 3, note: 'ok' }) });
    const r = await runBatch(batch, m.call, []);
    expect(calibrationGate('C1', r.outcomes)).toEqual({ phase: 'C1', pass: true, unmet: [] });
    expect(r.accepted.length).toBe(20);
    expect(r.outcomes.every((o) => o.final.record.stagesCompleted.length === 11 && o.final.record.answerMatch === 'CONFIRMED')).toBe(true);
    expect(r.account).toMatchObject({ AUTHOR: { calls: 20, failed: 0 }, SOLVER: { calls: 20 }, JUDGE: { calls: 60 } });
    for (const role of ['AUTHOR', 'SOLVER', 'JUDGE'] as const) expect(r.account[role].calls / 20).toBeLessThanOrEqual(WORST_CASE_CALLS[role]);
    // no solver or difficulty request ever contained the key rationale or the intended tier label
    for (const s of m.seen.filter((x) => x.role === 'SOLVER')) expect(s.text).not.toMatch(/suma en lugar|FOUNDATIONAL|CHALLENGE/);
  });
  it('twenty re-numberings of one exercise are not a diverse bank: the siblings are rejected as duplicates', async () => {
    const same = (slot: string, attempt: number, n: number) => authored(slot, attempt, 1, { itemId: `${slot}#${attempt}`, slotKey: slot, options: [{ label: 'A', text: String(24 + n) }, { label: 'B', text: String(21 * 4 + n * 0) }, { label: 'C', text: String(88 + n) }, { label: 'D', text: String(17 + n) }], answerExpression: '21*4' });
    const batch = saber.slice(0, 6);
    const bySlot = new Map(batch.map((s) => [s.slotKey, s]));
    let current = '';
    const r = await runBatch(batch, model({ author: (slot, a, n) => { current = slot; return same(slot, a, n); }, difficulty: () => ({ actualDifficulty: bySlot.get(current)!.intendedDifficulty, alsoPlausible: null, reasoningTransitions: 3, note: '' }) }).call, []);
    expect(r.accepted.length).toBe(1);
    expect(r.outcomes.slice(1).every((o) => o.final.record.reviewDecision === 'AUTO_REJECT' && /^DUPLICATE_/.test(o.final.record.reviewReason) && o.regenerated)).toBe(true);
  });
  it('a wrong key never survives, whatever the author claims; a malformed reply is a failure, not an item', async () => {
    const r = await runBatch(saber.slice(0, 3), model({ solver: 'C', author: (s, a, n) => authored(s, a, n, { answerExpression: null }) }).call, []);
    expect(r.accepted).toEqual([]);
    expect(r.outcomes.every((o) => o.final.record.answerMatch === 'MISMATCH' && o.specificationIssue)).toBe(true);
    const bad = await runBatch(saber.slice(0, 2), model({ author: () => 'Sure! Here is your item.' }).call, []);
    expect(bad.outcomes.every((o) => o.final.record.reviewDecision === 'AUTO_REJECT' && /AUTHORING_FAILED: MALFORMED_REPLY/.test(o.final.record.reviewReason))).toBe(true);
    expect(calibrationGate('C1', bad.outcomes).pass).toBe(false);
  });
});

describe('review package and coverage matrix', () => {
  it('contains only review-bound items and the audit sample, each adjudicable on its own, with no prompt in it', async () => {
    const batch = saber.slice(0, 20);
    const bySlot = new Map(batch.map((s) => [s.slotKey, s]));
    let current = ''; let k = 0;
    const m = model({ author: (slot, a, n) => { current = slot; k += 1; return authored(slot, a, n); }, difficulty: () => { const t = bySlot.get(current)!.intendedDifficulty; return k === 3 ? { actualDifficulty: t, alsoPlausible: null, reasoningTransitions: 0, note: 'thin' } : { actualDifficulty: t, alsoPlausible: null, reasoningTransitions: 3, note: '' }; } });
    const r = await runBatch(batch, m.call, []);
    const records = r.outcomes.map((o) => o.final.record);
    const items = new Map(r.outcomes.filter((o) => o.final.item).map((o) => [o.final.item!.itemId, o.final.item!]));
    const queue = reviewQueue(records).map((x) => reviewRow(x, items.get(x.itemId) ?? null));
    expect(queue.length).toBe(1);
    expect(queue[0]).toMatchObject({ priority: 'P2', exam_family: 'ICFES', proposed_canonical_answer: 'B', independent_solver_answer: 'B', tier_fit: 'BORDERLINE' });
    for (const h of REVIEW_HEADER) expect(queue[0]).toHaveProperty(h);
    const csv = reviewCsv(queue);
    expect(csv.split('\n')[0]).toBe(REVIEW_HEADER.join(','));
    expect(csv).not.toMatch(/A\. ASSESSMENT|You write original assessment items|I\. PROHIBITED/);
    const audit = auditSample(records.filter((x) => x.reviewDecision === 'AUTO_APPROVE'), 'run-1');
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit.length).toBeLessThan(records.length);
    expect(toCsv(['a', 'b'], [['x,y', 'he said "no"']])).toBe('a,b\n"x,y","he said ""no"""\n');
  });
  it('the coverage matrix names bucket, required, available and gap for every blocked mode of every family', () => {
    const rows = coverageRows(readiness);
    expect(new Set(rows.map((r) => r[0])).size).toBe(6);
    const saberReduced = rows.filter((r) => r[0] === 'ICFES' && r[4] === 'REDUCED_MOCK');
    expect(saberReduced.reduce((a, r) => a + Number(r[9]), 0)).toBe(50);
    expect(rows.filter((r) => r[0] === 'PISA' && r[4] === 'FULL_MOCK')).toEqual([['PISA', '', '', '', 'FULL_MOCK', 'NOT_APPLICABLE', '', '', '', '']]);
    expect(sections.length).toBeGreaterThan(100);
  });
});

describe('the lane makes no provider call without an authorised budget', () => {
  it('generate refuses, before reading a key or importing the transport, when QB_GENERATION_BUDGET_USD is absent', () => {
    const env = { ...process.env }; delete env.QB_GENERATION_BUDGET_USD; delete env.OPENAI_API_KEY; delete env.ANTHROPIC_API_KEY;
    let out = ''; let status = 0;
    try { execFileSync('npx', ['tsx', 'scripts/operations/qf-v5/run.ts', 'generate', '--run', 't', '--phase', 'C1', '--cluster', 'PAA.MATEMATICAS'], { cwd: ROOT, env, stdio: 'pipe' }); } catch (e) { status = (e as { status: number }).status; out = String((e as { stderr: Buffer }).stderr); }
    expect(status).toBe(2);
    expect(out).toMatch(/REFUSED: BUDGET_NOT_AUTHORIZED/);
  }, 60_000);
  it('only live.ts opens a network connection or reads a key; nothing in the lane touches a database', () => {
    const dir = 'scripts/operations/qf-v5';
    expect(readdirSync(join(ROOT, dir)).sort()).toEqual(['artifacts.ts', 'engine.ts', 'live.ts', 'run.ts']);
    const strip = (f: string) => readFileSync(join(ROOT, dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    for (const f of ['artifacts.ts', 'engine.ts', 'run.ts']) expect(strip(f), f).not.toMatch(/fetch\(|https?:\/\/|API_KEY/);
    for (const f of ['artifacts.ts', 'engine.ts', 'live.ts', 'run.ts']) expect(strip(f), f).not.toMatch(/DATABASE_URL|from 'pg'|@\/lib\/db|src\/lib\/db|dotenv|INSERT INTO|UPDATE \w+ SET/);
    expect(strip('run.ts')).toMatch(/await import\('\.\/live'\)/);
  });
});

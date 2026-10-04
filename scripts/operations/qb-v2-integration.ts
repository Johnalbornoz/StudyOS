/**
 * Question Bank V2 refinement -- integration certification against a REAL, EPHEMERAL Postgres
 * that already holds every governed configuration (cert step 6). Refuses unless
 * TRACK_B_ALLOW_EPHEMERAL equals the fingerprint and the host is a local socket. Deterministic
 * fake AI: no provider is called.
 *
 * Proves on the real schema + triggers: backfill of quality metadata, demand-driven generation
 * (difficulty mix, chunked calls) -> automated validation -> PILOT as EXAM_STYLE; the human gate
 * (DB refuses ACTIVE without APPROVED review, self-review refused, OFFICIAL refused), approve /
 * request correction (new version) / reject; usage + alignment eligibility in the real delivery SQL;
 * unseen-first across attempts and minimal cross-Student collision with real createExamInstance;
 * demand per cell from real preparing Students; review queue / detail / exposure metrics.
 */
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { listBankVersions, loadVersionHealthInputs } from '@/lib/exam-core/question-bank/health.service';
import { enqueueManual } from '@/lib/exam-core/question-bank/queue.service';
import { runFactory } from '@/lib/exam-core/question-bank/factory.service';
import { factoryConfig, type FactoryConfig } from '@/lib/exam-core/question-bank/policy';
import { reviewVersion, correctVersion } from '@/lib/exam-core/question-bank/review.service';
import { reviewQueue, questionDetail, exposureMetrics } from '@/lib/exam-core/question-bank/review-admin.service';
import { versionDemand } from '@/lib/exam-core/question-bank/demand.service';
import { lifecycleSqlFor } from '@/lib/exam-core/question-bank/lifecycle';
import { createExamInstance } from '@/lib/exam-core/exam-instance.service';
import type { FactoryAI, AICallUsage } from '@/lib/exam-core/question-bank/ai-runner';
import type { GeneratedCandidate } from '@/lib/exam-core/question-bank/prompts';

const results: Array<{ id: string; ok: boolean }> = [];
function check(id: string, ok: boolean, detail?: unknown) {
  results.push({ id, ok });
  console.log(`${ok ? '  OK  ' : '  FAIL'} ${id}${detail !== undefined ? ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
const n = async (sql: string, p: unknown[] = []) => Number((await one(sql, p))?.n ?? 0);
async function refused(fn: () => Promise<unknown>, pattern: RegExp): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e: any) {
    return pattern.test(String(e?.code ?? '') + ' ' + String(e?.message ?? ''));
  }
}

function guard() {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  if (process.env.TRACK_B_ALLOW_EPHEMERAL !== fp || !(u.searchParams.get('host') ?? '').startsWith('/')) throw new Error(`REFUSING: not an allowed ephemeral local database (${fp})`);
}

/* ------------------------------------------------------------------ fake AI */
const STEMS: Array<[string, string[], string]> = [
  ['Si 4(x - 1) = 20, ¿cuál es el valor de x?', ['6', '4', '5', '24'], '20/4+1'],
  ['La mitad de un número aumentada en 7 es 15. ¿Cuál es el número?', ['16', '4', '11', '44'], '(15-7)*2'],
  ['Un plan telefónico cuesta 8 dólares al mes más 0.5 dólares por mensaje. ¿Cuántos mensajes se enviaron si la factura fue de 20 dólares?', ['24', '12', '40', '6'], '(20-8)/0.5'],
  ['Si g(t) = 3t - 5, ¿para qué valor de t se cumple que g(t) = 13?', ['6', '3', '8', '18'], '(13+5)/3'],
  ['El triple de un número menos 9 es igual al doble del mismo número. ¿Cuál es el número?', ['9', '3', '-9', '27'], '9'],
  ['Dos números enteros consecutivos suman 41. ¿Cuál es el mayor de ellos?', ['21', '20', '22', '41'], '(41+1)/2'],
  ['Una receta usa 3 tazas de harina por cada 2 de azúcar. ¿Cuántas tazas de harina se necesitan con 8 tazas de azúcar?', ['12', '16', '10', '24'], '3*8/2'],
];
const calls = { generate: 0, validate: 0, repair: 0 };
let stemCursor = 0;
const usage = (): AICallUsage => ({ calls: 1, inputTokens: 800, outputTokens: 300, costUSD: 0.001, rateLimited: false, provider: 'fake', model: 'fake', errorCode: null });
const fakeAI: FactoryAI = {
  async generate(ctx) {
    calls.generate += 1;
    const out: GeneratedCandidate[] = [];
    for (let i = 0; i < ctx.count && stemCursor < STEMS.length; i++) {
      const [q, options, expr] = STEMS[stemCursor++];
      out.push({ stimulusTitle: null, stimulusText: null, question: q, options, correctIndex: 0, explanation: `Se plantea la ecuación y se resuelve: el resultado es ${options[0]}.`, difficulty: ctx.difficultyPlan?.[i] ?? ctx.spec.targetDifficulty, cognitiveDemand: ctx.spec.cognitiveDemand ?? 'APPLICATION', skill: 'Álgebra', distractorRationales: options.map((_, k) => (k === 0 ? '' : 'Error de despeje.')), distractorMisconceptions: options.map(() => null), evidenceQuote: null, verificationExpression: expr });
    }
    return { candidates: out, usage: usage() };
  },
  async validate(content) {
    calls.validate += 1;
    const d = Number((content as any).difficulty ?? 3);
    return { verdict: { selectedOptionId: content.correctAnswer, confidence: 0.95, alternativeDefensibleOptionIds: [], requiresOutsideInformation: false, implausibleDistractorIds: [], assessesRequirement: true, estimatedDifficulty: d <= 2 ? 'LOW' : d === 3 ? 'MEDIUM' : 'HIGH' }, usage: usage() };
  },
  async repair(_ctx, previous) {
    calls.repair += 1;
    return { candidate: previous, usage: usage() };
  },
};
const cfg: FactoryConfig = { ...factoryConfig({ QUESTION_BANK_FACTORY_ENABLED: 'true' }), enabled: true, dailyBudget: 100, maxPerRun: 40, minRemainingAiReserve: 10, maxBatch: 25, hardDailyLimit: 1000, softBudgetEnforced: false } as FactoryConfig;

async function main() {
  guard();
  process.env.AI_MAX_CALLS_PER_DAY = '5000';
  const [editor, reviewer] = (await db.query(`SELECT id FROM users WHERE is_system ORDER BY created_at, id LIMIT 2`)).rows.map((r: any) => r.id);
  const paa = (await listBankVersions()).find((v) => v.configKey === 'v2.paa')!;

  // ---------------- backfill of quality metadata ----------------
  check('BACKFILL.fixture-versions-full-usage-mock-ready', (await n(`SELECT count(*) n FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE qi.provenance = 'FIXTURE' AND NOT (ai.usage_eligibility @> ARRAY['PRACTICE','REDUCED_MOCK','FULL_MOCK']::text[] AND ai.exam_alignment = 'MOCK_READY')`)) === 0);
  check('BACKFILL.no-official-without-official-provenance', (await n(`SELECT count(*) n FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE ai.exam_alignment = 'OFFICIAL' AND qi.provenance NOT IN ('OFFICIAL','LICENSED')`)) === 0);

  // ---------------- demand from real preparing Students ----------------
  const students: string[] = [];
  for (let i = 0; i < 3; i++) {
    const sid = (await one(`INSERT INTO students (clerk_id, email) VALUES ($1, $2) RETURNING id`, [`cert:qbv2:${i}`, `qbv2-${i}@cert.invalid`])).id;
    await db.query(`INSERT INTO student_exam_profiles (student_id, exam_definition_id, exam_version_id) VALUES ($1, $2, $3)`, [sid, paa.examDefinitionId, paa.examVersionId]);
    students.push(sid);
  }
  let inputs = (await loadVersionHealthInputs(paa.examVersionId))!;
  const demand = await versionDemand(inputs);
  const alg = demand.cells.find((c) => c.objectiveCode === 'paa.mat.algebra')!;
  check('DEMAND.preparing-students-counted', demand.studentsPreparing === 3 && alg.studentsInProcess === 3, { preparing: demand.studentsPreparing, inProcess: alg.studentsInProcess });
  check('DEMAND.required-deficit-recommendation', alg.expectedExposures > 0 && alg.requiredUnique >= alg.expectedQuestionsPerStudent && alg.deficit === Math.max(0, alg.requiredUnique - alg.approved) && alg.recommendation.generate > 0, alg);
  console.log(JSON.stringify({ demandExample: { cell: alg.objectiveCode, studentsInProcess: alg.studentsInProcess, expectedExposures: alg.expectedExposures, requiredUnique: alg.requiredUnique, approved: alg.approved, byBand: alg.approvedByBand, required: alg.requiredByBand, deficit: alg.deficit, repeat: alg.expectedRepeatRate, coverage: alg.estimatedDaysOfCoverage, status: alg.status, recommendation: alg.recommendation } }));

  // ---------------- demand-driven generation (mix, chunked) ----------------
  const cell = inputs.cells.find((c) => c.objectiveCode === 'paa.mat.algebra')!;
  const mix = { LOW: 2, MEDIUM: 3, HIGH: 2 };
  const { request, created } = await enqueueManual({ inputs, cellKey: cell.cellKey, count: 7, requestedBy: editor, idempotencyKey: 'qbv2-cert-demand', maxBatch: 25, difficultyMix: mix, demand: { source: 'CERT' } });
  check('FACTORY.demand-request', created && request.reason === 'DEMAND_SHORTAGE' && request.requestedCount === 7);
  const run = await runFactory({ trigger: 'CLI', examVersionIds: [paa.examVersionId], onlyRequestId: request.id, ai: fakeAI, cfg, skipGapAnalysis: true });
  check('FACTORY.chunked-generation', calls.generate === 2 && run.status === 'COMPLETED', { generate: calls.generate, status: run.status });
  const gen = (await db.query(
    `SELECT ai.id, ai.bank_lifecycle_status lc, ai.usage_eligibility, ai.exam_alignment, (ai.content->>'difficulty')::int AS d, ai.validation_report->>'stage' stage, ai.validation_report->>'outcome' outcome, ai.created_by
       FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE qi.generation_request_id = $1 ORDER BY ai.created_at`,
    [request.id]
  )).rows;
  check('VALIDATION.all-pass-to-pilot-exam-style', gen.length === 7 && gen.every((g: any) => g.lc === 'PILOT' && g.exam_alignment === 'EXAM_STYLE' && JSON.stringify(g.usage_eligibility) === JSON.stringify(['PRACTICE', 'DIAGNOSTIC', 'QUIZ'])), gen.map((g: any) => [g.lc, g.exam_alignment]));
  check('VALIDATION.deterministic-plus-independent-alignment-check', gen.every((g: any) => g.stage === 'DETERMINISTIC+ALIGNMENT' && g.outcome === 'PASS') && calls.validate === 7);
  check('DIFFICULTY.mix-honoured', JSON.stringify(gen.map((g: any) => g.d).sort()) === JSON.stringify([2, 2, 3, 3, 3, 4, 4]), gen.map((g: any) => g.d));

  // ---------------- human gate ----------------
  const [g1, g2, g3, g4, g5] = gen.map((g: any) => g.id);
  check('GATE.db-refuses-active-without-review', await refused(() => db.query(`UPDATE approved_items SET bank_lifecycle_status = 'ACTIVE' WHERE id = $1`, [g1]), /HUMAN_APPROVAL_REQUIRED/));
  check('GATE.self-review-refused', await refused(() => reviewVersion({ versionId: g1, reviewerUserId: gen[0].created_by, input: { decision: 'APPROVED', notes: null, validatedDifficulty: 3, usage: ['PRACTICE'], alignment: 'EXAM_STYLE' } }), /SELF_REVIEW/));
  check('OFFICIAL.reviewer-refused', await refused(() => reviewVersion({ versionId: g1, reviewerUserId: reviewer, input: { decision: 'APPROVED', notes: null, validatedDifficulty: 3, usage: ['PRACTICE'], alignment: 'OFFICIAL' } }), /OFFICIAL_NOT_ALLOWED/));
  check('OFFICIAL.db-refused', await refused(() => db.query(`UPDATE approved_items SET exam_alignment = 'OFFICIAL' WHERE id = $1`, [g1]), /OFFICIAL_NEEDS_OFFICIAL_PROVENANCE/));
  const approvedMock = await reviewVersion({ versionId: g1, reviewerUserId: reviewer, input: { decision: 'APPROVED', notes: null, validatedDifficulty: 4, usage: ['PRACTICE', 'QUIZ', 'REDUCED_MOCK'], alignment: 'MOCK_READY' } });
  check('GATE.approved-active-with-reviewer-metadata', approvedMock.lifecycle === 'ACTIVE' && (await n(`SELECT count(*) n FROM approved_items WHERE id = $1 AND bank_lifecycle_status = 'ACTIVE' AND validated_difficulty = 4 AND exam_alignment = 'MOCK_READY' AND 'REDUCED_MOCK' = ANY(usage_eligibility)`, [g1])) === 1);
  await reviewVersion({ versionId: g2, reviewerUserId: reviewer, input: { decision: 'APPROVED', notes: null, validatedDifficulty: 2, usage: ['PRACTICE'], alignment: 'EXAM_STYLE' } });
  const rejected = await reviewVersion({ versionId: g3, reviewerUserId: reviewer, input: { decision: 'REJECTED', notes: 'El distractor C también puede defenderse.', validatedDifficulty: null, usage: null, alignment: null } });
  check('GATE.rejected', rejected.lifecycle === 'REJECTED');
  const corr = await reviewVersion({ versionId: g4, reviewerUserId: reviewer, input: { decision: 'CORRECTION_REQUESTED', notes: 'Aclarar el enunciado: indicar que t es real.', validatedDifficulty: null, usage: null, alignment: null } });
  check('GATE.correction-requested', corr.lifecycle === 'REVIEW_REQUIRED');
  const fixed = await correctVersion({ versionId: g4, editorUserId: reviewer, patch: { question: 'Si g(t) = 3t - 5 con t real, ¿para qué valor de t se cumple que g(t) = 13?' }, notes: 'Se aclara el dominio de t.' });
  check('CORRECTION.new-version-validated-pilot', fixed.versionNumber === 2 && fixed.lifecycle === 'PILOT' && (await n(`SELECT count(*) n FROM approved_items WHERE id = $1 AND bank_lifecycle_status = 'SUPERSEDED'`, [g4])) === 1, fixed);
  check('CORRECTION.editor-cannot-certify-own-correction', await refused(() => reviewVersion({ versionId: fixed.versionId, reviewerUserId: reviewer, input: { decision: 'APPROVED', notes: null, validatedDifficulty: 3, usage: ['PRACTICE'], alignment: 'EXAM_STYLE' } }), /SELF_REVIEW/));
  const otherApproval = await reviewVersion({ versionId: fixed.versionId, reviewerUserId: editor, input: { decision: 'APPROVED', notes: null, validatedDifficulty: 3, usage: ['PRACTICE'], alignment: 'EXAM_STYLE' } });
  check('CORRECTION.other-reviewer-approves', otherApproval.lifecycle === 'ACTIVE');
  check('AUDIT.reviews-and-events', (await n(`SELECT count(*) n FROM question_bank_reviews WHERE approved_item_id = ANY($1::uuid[])`, [[g1, g2, g3, g4, fixed.versionId]])) === 5 && (await n(`SELECT count(*) n FROM question_bank_lifecycle_events WHERE reason LIKE 'REVIEW:%' AND approved_item_id = ANY($1::uuid[])`, [[g1, g2, g3, g4, fixed.versionId]])) >= 5);

  // ---------------- eligibility in the real delivery SQL ----------------
  const pool = async (use: 'PRACTICE' | 'REDUCED_MOCK' | 'FULL_MOCK') => (await db.query(`SELECT ai.id FROM approved_items ai WHERE ai.status = 'PUBLISHED' AND ai.learning_objective_id = $1 AND ${lifecycleSqlFor(use)}`, [cell.learningObjectiveId])).rows.map((r: any) => r.id);
  const practice = await pool('PRACTICE');
  const reduced = await pool('REDUCED_MOCK');
  const full = await pool('FULL_MOCK');
  check('ELIGIBILITY.pilot-practice-only', practice.includes(g5) && !reduced.includes(g5));
  check('ELIGIBILITY.rejected-excluded', !practice.includes(g3) && !reduced.includes(g3));
  check('ELIGIBILITY.approved-practice-only-not-in-mock', practice.includes(g2) && !reduced.includes(g2));
  check('ELIGIBILITY.approved-mock-ready-in-reduced-not-full', reduced.includes(g1) && !full.includes(g1));

  // ---------------- exposure memory with the real instance service ----------------
  const comps = Object.values((await db.query(`SELECT id FROM assessment_components WHERE exam_version_id = $1 ORDER BY sequence_order`, [paa.examVersionId])).rows.map((r: any) => r.id)) as string[];
  const profile = async (sid: string) => (await one(`SELECT id FROM student_exam_profiles WHERE student_id = $1`, [sid])).id;
  const ids = (f: any) => f.slots.map((s: any) => s.approvedItemId).filter(Boolean) as string[];
  // Student A's first form, then Student B (sees A's exposure as peer collision), then A's second attempt (unseen-first).
  const a1 = await createExamInstance({ studentId: students[0], examProfileId: await profile(students[0]), examVersionId: paa.examVersionId, componentIds: comps, mode: 'MOCK' });
  const b1 = await createExamInstance({ studentId: students[1], examProfileId: await profile(students[1]), examVersionId: paa.examVersionId, componentIds: comps, mode: 'MOCK' });
  const a2 = await createExamInstance({ studentId: students[0], examProfileId: await profile(students[0]), examVersionId: paa.examVersionId, componentIds: comps, mode: 'MOCK' });
  // Minimum possible overlap per objective = max(0, need_first + need_second - eligible items).
  const needs = (await db.query(`SELECT t.learning_objective_id lo, count(*)::int need FROM blueprint_objective_targets t JOIN assessment_blueprints b ON b.id = t.blueprint_id WHERE b.exam_version_id = $1 GROUP BY 1`, [paa.examVersionId])).rows;
  const eligible = new Map<string, number>();
  for (const r of (await db.query(`SELECT ai.learning_objective_id lo, count(*)::int n FROM approved_items ai WHERE ai.status = 'PUBLISHED' AND ${lifecycleSqlFor('REDUCED_MOCK')} GROUP BY 1`)).rows) eligible.set(r.lo, r.n);
  const minOverlap = needs.reduce((s: number, r: any) => s + Math.max(0, 2 * r.need - (eligible.get(r.lo) ?? 0)), 0);
  const overlap = (x: string[], y: string[]) => x.filter((id) => y.includes(id)).length;
  console.log(JSON.stringify({ exposureExample: { positions: ids(a1.form).length, minPossibleOverlap: minOverlap, studentA_attempt2_repeats: overlap(ids(a1.form), ids(a2.form)), studentB_vs_A_collisions: overlap(ids(a1.form), ids(b1.form)), repeatedForStudent: a2.form?.repeatedForStudent } }));
  check('EXPOSURE.unseen-first-new-attempt', overlap(ids(a1.form), ids(a2.form)) === minOverlap && a2.form?.repeatedForStudent === minOverlap, { overlap: overlap(ids(a1.form), ids(a2.form)), minOverlap });
  // The floor ignores stimulus units: keeping a passage's questions together outranks collision avoidance
  // (academic equivalence before randomization), so a few extra shared positions are expected on PAA Lectura.
  check('COLLISION.student-b-near-minimal-overlap-with-a', overlap(ids(a1.form), ids(b1.form)) <= minOverlap + Math.ceil(0.1 * ids(a1.form).length) && overlap(ids(a1.form), ids(b1.form)) < ids(a1.form).length, { overlap: overlap(ids(a1.form), ids(b1.form)), floor: minOverlap });
  check('EXPOSURE.recorded-with-use', (await n(`SELECT count(*) n FROM exam_item_usage WHERE exam_instance_id = $1 AND delivery_use = 'REDUCED_MOCK'`, [a1.id])) === ids(a1.form).length);
  check('MOCK.never-pilot-or-practice-only', [a1, a2, b1].every((i) => !ids(i.form).some((id) => [g2, g3, g5, fixed.versionId].includes(id))));

  // ---------------- admin read models ----------------
  const queue = await reviewQueue({ examVersionId: paa.examVersionId });
  check('QUEUE.pending-lists-unreviewed-pilots', queue.some((q) => q.versionId === g5) && !queue.some((q) => q.versionId === g1 || q.versionId === g3));
  check('QUEUE.filter-by-band', (await reviewQueue({ examVersionId: paa.examVersionId, band: 'HIGH' })).every((q) => q.difficulty === 'HIGH'));
  const detail = (await questionDetail(g1))!;
  check('DETAIL.complete', detail.humanReview.status === 'APPROVED' && detail.alignment === 'MOCK_READY' && detail.difficulty.effective === 'HIGH' && detail.automatedValidation.result === 'PASS' && detail.audit.length >= 4 && detail.content.answer && detail.provenance === 'STUDYUS_GENERATED');
  const m = await exposureMetrics();
  check('METRICS.exposure', m.generated >= 7 && m.approved >= 3 && m.rejected >= 1 && m.exposures > 0 && m.repeatRate > 0 && m.collisionRate > 0, m);
  inputs = (await loadVersionHealthInputs(paa.examVersionId))!;
  const after = (await versionDemand(inputs)).cells.find((c) => c.objectiveCode === 'paa.mat.algebra')!;
  check('DEMAND.approved-inventory-grows-after-review', after.approved === alg.approved + 3, { before: alg.approved, after: after.approved });

  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ checks: results.length, failed: failed.length, fakeAiCalls: calls }));
  await db.end();
  if (failed.length) process.exit(1);
}

main().catch(async (err) => {
  console.error('QBV2 INTEGRATION ERROR', err instanceof Error ? err.stack : err);
  await db.end().catch(() => undefined);
  process.exit(1);
});

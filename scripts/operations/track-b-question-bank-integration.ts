/**
 * Question Bank Factory V1 -- integration certification against a REAL,
 * EPHEMERAL Postgres (never Neon / DEV / Stage / Production): refuses unless
 * TRACK_B_ALLOW_EPHEMERAL equals the fingerprint of DATABASE_URL and the host
 * is a local socket. The AI is a deterministic fake (no provider is called):
 * the factory's behaviour, not a model's, is what is certified here.
 *
 * Proves on the real schema + triggers: bank registration of applied content,
 * health from the live bank, gap -> queue -> generate -> validate -> bank ->
 * coverage delta, idempotent queueing, SKIP LOCKED claiming, one run at a time,
 * budget / reserve / disabled stops, rate-limit backoff, duplicate rejection,
 * repair as a new version, independent validation, PILOT never in a mock,
 * historical integrity across versions, retirement, AICE isolation.
 *
 *   (run by scripts/operations/track-b-question-bank-migration-cert.sh)
 */
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { applyExamVerticalConfig } from '@/lib/exam-core/apply-vertical-config.service';
import { PAA_V2, PISA_2022_V2, AICE_9709_AS, AICE_9702_AS } from '@/lib/exam-core/verticals/v2';
import { refreshVersionHealth, loadVersionHealthInputs, latestSnapshots } from '@/lib/exam-core/question-bank/health.service';
import { enqueueGaps, claimNextRequest, releaseRequest, enqueueManual } from '@/lib/exam-core/question-bank/queue.service';
import { runFactory } from '@/lib/exam-core/question-bank/factory.service';
import { factoryConfig, type FactoryConfig } from '@/lib/exam-core/question-bank/policy';
import { createNextVersion, transitionVersion } from '@/lib/exam-core/question-bank/bank.service';
import { selectApprovedBankItem } from '@/lib/exam-core/item-sourcing.service';
import { createExamInstance } from '@/lib/exam-core/exam-instance.service';
import { examItemFromApproved } from '@/lib/exam-core/items';
import type { FactoryAI, AICallUsage } from '@/lib/exam-core/question-bank/ai-runner';
import type { GeneratedCandidate } from '@/lib/exam-core/question-bank/prompts';

const results: Array<{ id: string; ok: boolean; detail?: string }> = [];
function check(id: string, ok: boolean, detail?: unknown) {
  results.push({ id, ok, detail: detail === undefined ? undefined : typeof detail === 'string' ? detail : JSON.stringify(detail) });
  console.log(`${ok ? '  OK  ' : '  FAIL'} ${id}${detail !== undefined ? ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
const count = async (sql: string, params: unknown[] = []) => Number((await one(sql, params))?.n ?? 0);

function guard() {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  const host = u.searchParams.get('host') ?? '';
  if (process.env.TRACK_B_ALLOW_EPHEMERAL !== fp || !host.startsWith('/')) throw new Error(`REFUSING: not an allowed ephemeral local database (${fp})`);
}

/* ------------------------------------------------------------------ fake AI */
const usage = (over: Partial<AICallUsage> = {}): AICallUsage => ({ calls: 1, inputTokens: 900, outputTokens: 400, costUSD: 0.001, rateLimited: false, provider: 'fake', model: 'fake-generator', errorCode: null, ...over });
const math = (question: string, options: string[], correctIndex: number, expr: string | null, demand: string, difficulty: number): GeneratedCandidate => ({
  stimulusTitle: null, stimulusText: null, question, options, correctIndex, explanation: 'Se resuelve paso a paso.', difficulty, cognitiveDemand: demand, skill: 'Álgebra',
  distractorRationales: options.map((_, i) => (i === correctIndex ? '' : 'Error típico de cálculo.')), distractorMisconceptions: options.map(() => null), evidenceQuote: null, verificationExpression: expr,
});
const PASSAGE = 'Durante el verano, la biblioteca del barrio abrió una sala de lectura al aire libre. Los primeros días llegaron pocas personas, pero cuando los vecinos empezaron a llevar sus propios libros para intercambiarlos, la sala se llenó cada tarde. La bibliotecaria comentó que nunca había visto tantos lectores jóvenes en la biblioteca.';
const reading = (question: string, options: string[], quote: string, demand: string, difficulty: number): GeneratedCandidate => ({
  stimulusTitle: 'La sala al aire libre', stimulusText: PASSAGE, question, options, correctIndex: 0, explanation: 'El texto lo indica.', difficulty, cognitiveDemand: demand, skill: 'Inferencia',
  distractorRationales: ['', 'No se menciona en el texto.', 'Contradice el texto.', 'Confunde el orden de los hechos.'], distractorMisconceptions: [null, null, null, null], evidenceQuote: quote, verificationExpression: null,
});

interface FakeScript {
  calls: { generate: number; validate: number; repair: number };
  mode: 'NORMAL' | 'RATE_LIMIT';
}
function fakeAI(state: FakeScript, fixtureStem: string): FactoryAI {
  return {
    async generate(ctx) {
      state.calls.generate += 1;
      if (state.mode === 'RATE_LIMIT') return { candidates: [], usage: usage({ rateLimited: true, errorCode: 'RATE_LIMIT' }) };
      const d = ctx.spec.cognitiveDemand ?? 'APPLICATION';
      const diff = ctx.spec.targetDifficulty;
      if (ctx.objectiveCode === 'paa.mat.algebra') {
        return {
          candidates: [
            math('Un taller cobra 12 dólares fijos más 4 dólares por hora. Si una reparación costó 40 dólares, ¿cuántas horas duró?', ['7', '10', '13', '28'], 0, '(40-12)/4', d, diff),
            math('Si f(x) = 2x^2 - 3x, ¿cuál es el valor de f(-2)?', ['14', '2', '-2', '10'], 0, '2*(-2)^2-3*(-2)', d, diff),
            // Wrong key on purpose: recomputation catches it, the repair fixes it.
            math('La suma de dos números es 30 y su diferencia es 6. ¿Cuál es el número mayor?', ['12', '18', '24', '15'], 0, '(30+6)/2', d, diff),
          ].slice(0, ctx.count),
          usage: usage(),
        };
      }
      if (ctx.objectiveCode === 'paa.mat.geometria') {
        // Exact copy of a bank item: rejected as a duplicate.
        return { candidates: [math(fixtureStem, ['10', '12', '14', '16'], 0, null, d, diff)], usage: usage() };
      }
      if (ctx.objectiveCode === 'paa.lect.inferencia') {
        return {
          candidates: [
            reading('¿Qué se puede inferir sobre la sala de lectura al final del verano?', ['Que se convirtió en un lugar concurrido', 'Que cerró por falta de público', 'Que solo asistían adultos', 'Que prohibió el intercambio de libros'], 'la sala se llenó cada tarde', d, diff),
            reading('¿Por qué, según el texto, aumentó la asistencia a la sala?', ['Porque los vecinos llevaron libros para intercambiar', 'Porque la biblioteca regaló libros', 'Porque se amplió el horario', 'Porque llovió todo el verano'], 'empezaron a llevar sus propios libros para intercambiarlos', d, diff),
          ].slice(0, ctx.count),
          usage: usage(),
        };
      }
      return { candidates: [], usage: usage() };
    },
    async validate(content) {
      state.calls.validate += 1;
      // Agrees with the key on the inference item; finds a second defensible answer on the other one.
      const ambiguous = /aumentó la asistencia/.test(content.question);
      return { verdict: { selectedOptionId: content.correctAnswer, confidence: 0.92, alternativeDefensibleOptionIds: ambiguous ? [content.options!.find((o) => o.id !== content.correctAnswer)!.id] : [], requiresOutsideInformation: false, implausibleDistractorIds: [] }, usage: usage({ model: 'fake-validator' }) };
    },
    async repair(ctx, previous) {
      state.calls.repair += 1;
      if (/aumentó la asistencia/.test(previous.question)) return { candidate: { ...previous }, usage: usage() };
      const k = previous.options.indexOf('18');
      return { candidate: { ...previous, correctIndex: k, distractorRationales: previous.options.map((_, i) => (i === k ? '' : 'Error típico de cálculo.')) }, usage: usage() };
    },
  };
}

const cfgWith = (over: Partial<FactoryConfig>): FactoryConfig => ({ ...factoryConfig({ QUESTION_BANK_FACTORY_ENABLED: 'true' }), dailyBudget: 50, maxPerRun: 20, minRemainingAiReserve: 10, maxBatch: 3, ...over });

async function main() {
  guard();
  // ---------------- content applied by the governed path is registered in the bank ----------------
  const paa = await applyExamVerticalConfig(PAA_V2, { write: true });
  await applyExamVerticalConfig(PISA_2022_V2, { write: true });
  const a9709 = await applyExamVerticalConfig(AICE_9709_AS, { write: true });
  const a9702 = await applyExamVerticalConfig(AICE_9702_AS, { write: true });
  check('CORE.apply-registers-bank-identity', (await count(`SELECT count(*) n FROM approved_items WHERE bank_item_id IS NULL`)) === 0);
  check('CORE.fixture-items-active-version-1', (await count(`SELECT count(*) n FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE ai.bank_lifecycle_status = 'ACTIVE' AND ai.version_number = 1 AND qi.provenance = 'FIXTURE' AND qi.current_version_id = ai.id`)) === (await count(`SELECT count(*) n FROM approved_items`)));
  check('CORE.official-content-zero', (await count(`SELECT count(*) n FROM question_bank_items WHERE provenance IN ('OFFICIAL','LICENSED')`)) === 0);
  const reapply = await applyExamVerticalConfig(PAA_V2, { write: true });
  check('CORE.reapply-noop-no-duplicates', reapply.noop && (await count(`SELECT count(*) n FROM question_bank_items`)) === (await count(`SELECT count(*) n FROM approved_items`)));

  // ---------------- PAA health from the live bank ----------------
  const before = (await refreshVersionHealth(paa.versionId))!;
  check('PAA.bank-ingested', before.health.totals.items === 47 && before.health.totals.active === 47 && before.health.totals.cells === 20, before.health.totals);
  check('PAA.reduced-mock-assembles', before.health.readiness.reducedMock.ready === true);
  check('PAA.full-mock-false-real-reasons', !before.health.readiness.fullMock.ready && before.health.readiness.fullMock.reasons.length >= 20, before.health.readiness.fullMock.reasons.slice(0, 3));
  check('PAA.full-length-175', before.inputs.cells.reduce((n, c) => n + c.fullPositions, 0) === 175);
  check('PERF.snapshot-stored', (await latestSnapshots([paa.versionId])).has(paa.versionId));

  // ---------------- queue idempotence ----------------
  const cfg = cfgWith({});
  const first = await enqueueGaps(before.inputs, before.health, cfg, 3);
  // Re-running the analysis on the same (stale) health: no duplicate per cell, and the queue never exceeds its cap.
  const again = await enqueueGaps(before.inputs, before.health, cfg, 3);
  check('QUEUE.bounded-gaps-created', first.length === 3 && first.every((r) => r.priority === 'P1' && r.requestedCount <= cfg.maxBatch), first.map((r) => r.cellKey));
  check('QUEUE.idempotent-rerun-creates-nothing', again.length === 0 && (await count(`SELECT count(*) n FROM question_bank_generation_requests WHERE status IN ('PENDING','RUNNING')`)) === 3);
  let dupErr = '';
  try {
    await db.query(`INSERT INTO question_bank_generation_requests (exam_version_id, blueprint_id, cell_key, learning_objective_id, assessment_component_id, requested_count, priority, reason, language) SELECT exam_version_id, blueprint_id, cell_key, learning_objective_id, assessment_component_id, 1, 'P1', 'FORM_BLOCKER', 'es' FROM question_bank_generation_requests LIMIT 1`);
  } catch (e: any) {
    dupErr = e.code;
  }
  check('QUEUE.db-refuses-second-open-request-per-cell', dupErr === '23505');
  // Two workers claim concurrently: never the same request.
  const [c1, c2] = await Promise.all([claimNextRequest('w1', 60_000), claimNextRequest('w2', 60_000)]);
  check('LOCK.skip-locked-distinct-claims', !!c1 && !!c2 && c1.id !== c2.id);
  await releaseRequest(c1!.id, 'w1', 'test');
  await releaseRequest(c2!.id, 'w2', 'test');
  check('LOCK.release-does-not-burn-attempts', (await count(`SELECT count(*) n FROM question_bank_generation_requests WHERE attempt_count = 0 AND status = 'PENDING'`)) === 3);
  await db.query(`UPDATE question_bank_generation_requests SET status = 'CANCELLED', completed_at = now() WHERE status = 'PENDING'`);

  // ---------------- one run at a time / disabled / budget / reserve ----------------
  const fixtureGeo = (PAA_V2.items as any[]).find((i) => i.objectiveCode === 'paa.mat.geometria').content.question as string;
  const state: FakeScript = { calls: { generate: 0, validate: 0, repair: 0 }, mode: 'NORMAL' };
  const ai = fakeAI(state, fixtureGeo);
  const disabled = await runFactory({ trigger: 'CLI', examVersionIds: [paa.versionId], ai, cfg: { ...cfg, enabled: false } });
  check('BUDGET.disabled-by-default-no-ai', disabled.status === 'SKIPPED_DISABLED' && state.calls.generate === 0);
  await db.query(`INSERT INTO question_bank_factory_runs (trigger, status, lease_expires_at) VALUES ('CLI', 'RUNNING', now() + interval '10 minutes')`);
  const locked = await runFactory({ trigger: 'CLI', examVersionIds: [paa.versionId], ai, cfg });
  check('LOCK.second-run-skipped-while-one-running', locked.status === 'SKIPPED_LOCKED' && state.calls.generate === 0);
  let runDupErr = '';
  try {
    await db.query(`INSERT INTO question_bank_factory_runs (trigger, status, lease_expires_at) VALUES ('CLI', 'RUNNING', now() + interval '10 minutes')`);
  } catch (e: any) {
    runDupErr = e.code;
  }
  check('LOCK.db-refuses-two-running-runs', runDupErr === '23505');
  await db.query(`UPDATE question_bank_factory_runs SET lease_expires_at = now() - interval '1 minute' WHERE status = 'RUNNING'`);
  // Shared-cap reserve: only 5 calls left on the platform cap with a reserve of 10 -> no AI.
  process.env.AI_MAX_CALLS_PER_DAY = '1000';
  await db.query(`UPDATE ai_global_limits SET day_calls = 995, day_start = date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' WHERE id = true`);
  const reserve = await runFactory({ trigger: 'CLI', examVersionIds: [paa.versionId], ai, cfg });
  check('BUDGET.shared-cap-reserve-stops-cleanly', reserve.status === 'STOPPED_RESERVE' && state.calls.generate === 0, reserve.status);
  check('LOCK.stale-run-expired-not-blocking', (await count(`SELECT count(*) n FROM question_bank_factory_runs WHERE error = 'LEASE_EXPIRED'`)) === 1);
  await db.query(`UPDATE ai_global_limits SET day_calls = 0 WHERE id = true`);
  await db.query(`UPDATE question_bank_generation_requests SET status = 'CANCELLED', completed_at = now() WHERE status = 'PENDING'`);

  // ---------------- rate limit: deferred with backoff, nothing written ----------------
  state.mode = 'RATE_LIMIT';
  const itemsBefore = await count(`SELECT count(*) n FROM approved_items`);
  const rl = await runFactory({ trigger: 'CLI', examVersionIds: [paa.versionId], ai, cfg });
  check('RATE.stops-run', rl.status === 'STOPPED_RATE_LIMIT' && rl.counters.rateLimitEvents === 1, rl.status);
  const deferred = await one(`SELECT status, attempt_count, next_attempt_at > now() + interval '4 minutes' AS backed_off, last_error FROM question_bank_generation_requests WHERE last_error LIKE 'RATE_LIMIT%' LIMIT 1`);
  check('RATE.request-pending-with-backoff', deferred?.status === 'PENDING' && deferred?.attempt_count === 1 && deferred?.backed_off === true, deferred);
  check('RATE.no-bank-change', (await count(`SELECT count(*) n FROM approved_items`)) === itemsBefore);
  await db.query(`UPDATE question_bank_generation_requests SET status = 'CANCELLED', completed_at = now() WHERE status = 'PENDING'`);
  state.mode = 'NORMAL';

  // ---------------- the controlled small batch: gap -> queue -> generate -> validate -> bank ----------------
  const inputs = (await loadVersionHealthInputs(paa.versionId))!;
  const cellOf = (code: string) => inputs.cells.find((c) => c.objectiveCode === code)!.cellKey;
  for (const code of ['paa.mat.algebra', 'paa.mat.geometria', 'paa.lect.inferencia']) {
    await enqueueManual({ inputs, cellKey: cellOf(code), count: 3, requestedBy: (await one(`SELECT id FROM users WHERE is_system ORDER BY created_at LIMIT 1`)).id, idempotencyKey: `cert:${code}`, maxBatch: 3 });
  }
  const idem = await enqueueManual({ inputs, cellKey: cellOf('paa.mat.algebra'), count: 3, requestedBy: (await one(`SELECT id FROM users WHERE is_system ORDER BY created_at LIMIT 1`)).id, idempotencyKey: 'cert:paa.mat.algebra', maxBatch: 3 });
  check('QUEUE.manual-idempotency-key', idem.created === false);
  const callsBefore = { ...state.calls };
  const run = await runFactory({ trigger: 'CLI', examVersionIds: [paa.versionId], ai, cfg, skipGapAnalysis: true });
  console.log(JSON.stringify({ run: { status: run.status, counters: run.counters, notes: run.notes } }));
  check('GEN.run-completed-within-budget', run.status === 'COMPLETED' && run.counters.aiCalls <= cfg.maxPerRun, run.status);
  const gen = (await db.query(
    `SELECT qi.item_key, qi.cell_key, qi.provenance, ai.version_number, ai.bank_lifecycle_status AS lc, ai.status, ai.content->>'question' AS q, ai.validation_report->>'stage' AS stage
       FROM question_bank_items qi JOIN approved_items ai ON ai.bank_item_id = qi.id WHERE qi.generation_request_id IS NOT NULL ORDER BY ai.created_at`
  )).rows;
  for (const g of (await db.query(`SELECT ai.version_number, ai.bank_lifecycle_status AS lc, left(ai.content->>'question', 60) AS q, ai.validation_report->'issues' AS issues FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE qi.generation_request_id IS NOT NULL ORDER BY ai.created_at`)).rows) {
    console.log(`    [candidate] v${g.version_number} ${g.lc} ${g.q} :: ${(g.issues ?? []).map((i: any) => `${i.code}${i.detail ? `(${String(i.detail).slice(0, 40)})` : ''}`).join(', ')}`);
  }
  const pilots = gen.filter((g: any) => g.lc === 'PILOT');
  check('GEN.provenance-always-studyus-generated', gen.length > 0 && gen.every((g: any) => g.provenance === 'STUDYUS_GENERATED'));
  check('GEN.valid-math-enter-pilot-deterministically', pilots.filter((g: any) => g.cell_key === cellOf('paa.mat.algebra')).length === 3 && pilots.filter((g: any) => g.cell_key === cellOf('paa.mat.algebra')).every((g: any) => String(g.stage).startsWith('DETERMINISTIC')));
  const repaired = gen.filter((g: any) => /La suma de dos números/.test(g.q));
  check('GEN.repair-is-a-new-version', repaired.length === 2 && repaired.some((g: any) => g.version_number === 1 && g.lc === 'SUPERSEDED') && repaired.some((g: any) => g.version_number === 2 && g.lc === 'PILOT'), repaired.map((g: any) => [g.version_number, g.lc]));
  check('DUP.exact-copy-rejected', gen.some((g: any) => g.cell_key === cellOf('paa.mat.geometria') && g.lc === 'REJECTED'));
  check('VAL.reading-needs-independent-validator', state.calls.validate - callsBefore.validate >= 2);
  const readingRows = gen.filter((g: any) => g.cell_key === cellOf('paa.lect.inferencia'));
  check('VAL.reading-agreed-enters-pilot', readingRows.some((g: any) => /inferir/.test(g.q) && g.lc === 'PILOT'));
  check('VAL.ambiguous-never-promoted', readingRows.filter((g: any) => /aumentó la asistencia/.test(g.q)).every((g: any) => g.lc === 'REJECTED' || g.lc === 'SUPERSEDED'), readingRows.map((g: any) => g.lc));
  check('GEN.no-generated-item-active-or-mock-eligible', gen.every((g: any) => g.lc !== 'ACTIVE' && g.lc !== 'CALIBRATED'));
  check('AUDIT.every-transition-recorded', (await count(`SELECT count(*) n FROM question_bank_lifecycle_events e JOIN question_bank_items qi ON qi.id = e.bank_item_id WHERE qi.generation_request_id IS NOT NULL`)) >= gen.length * 3);
  const runRow = await one(`SELECT ai_calls, accepted, rejected, repaired, candidates_generated, coverage_after FROM question_bank_factory_runs WHERE id = $1`, [run.runId]);
  check('OBS.run-observability', runRow.ai_calls === run.counters.aiCalls && runRow.accepted === run.counters.accepted && runRow.candidates_generated >= 5 && !!runRow.coverage_after, runRow);

  // ---------------- coverage delta: the right cell grows, readiness only moves for real ----------------
  const after = (await refreshVersionHealth(paa.versionId))!;
  const cellAfter = (code: string) => after.health.cells.find((c) => c.objectiveCode === code)!;
  const cellBefore = (code: string) => before.health.cells.find((c) => c.objectiveCode === code)!;
  check('COVERAGE.algebra-practice-coverage-up-by-3', cellAfter('paa.mat.algebra').counts.practiceEligible - cellBefore('paa.mat.algebra').counts.practiceEligible === 3);
  check('COVERAGE.pilot-not-mock-eligible', cellAfter('paa.mat.algebra').counts.mockEligible === cellBefore('paa.mat.algebra').counts.mockEligible);
  check('COVERAGE.rejected-does-not-improve', cellAfter('paa.mat.geometria').counts.practiceEligible === cellBefore('paa.mat.geometria').counts.practiceEligible);
  check('COVERAGE.other-cells-unchanged', after.health.cells.filter((c) => !['paa.mat.algebra', 'paa.lect.inferencia', 'paa.mat.geometria'].includes(c.objectiveCode)).every((c) => JSON.stringify(c.counts) === JSON.stringify(before.health.cells.find((b) => b.cellKey === c.cellKey)!.counts)));
  check('READINESS.reduced-mock-non-regression', after.health.readiness.reducedMock.ready === true);
  check('READINESS.full-mock-still-false', after.health.readiness.fullMock.ready === false && after.health.readiness.fullMockCalibrated.ready === false);
  check('OBS.coverage-delta-in-run', run.coverage.length === 1 && run.coverage[0].cells.some((c) => c.cellKey === cellOf('paa.mat.algebra') && c.pilotAfter - c.pilotBefore === 3), run.coverage[0]?.cells);

  // ---------------- delivery policy on the real SQL path ----------------
  const studentId = (await one(`INSERT INTO students (clerk_id, email) VALUES ('cert:qb', 'qb@cert.invalid') RETURNING id`)).id;
  const defId = (await one(`SELECT exam_definition_id FROM exam_versions WHERE id = $1`, [paa.versionId])).exam_definition_id;
  const profileId = (await one(`INSERT INTO student_exam_profiles (student_id, exam_definition_id, exam_version_id) VALUES ($1, $2, $3) RETURNING id`, [studentId, defId, paa.versionId])).id;
  const compIds = Object.values(paa.componentIdsBySection);
  const pilotIds = new Set((await db.query(`SELECT id FROM approved_items WHERE bank_lifecycle_status = 'PILOT'`)).rows.map((r: any) => r.id));
  const mock = await createExamInstance({ studentId, examProfileId: profileId, examVersionId: paa.versionId, componentIds: compIds, mode: 'MOCK' });
  const mockIds = mock.form!.slots.map((s) => s.approvedItemId).filter(Boolean) as string[];
  check('POLICY.mock-never-uses-pilot', mockIds.length === 36 && mockIds.every((id) => !pilotIds.has(id)), { filled: mockIds.length });
  check('POLICY.reduced-mock-still-full-36', mock.form!.slots.every((s) => s.approvedItemId));
  const algLo = paa.objectiveIdsByCode['paa.mat.algebra'];
  const fixtureAlg = (await db.query(`SELECT id FROM approved_items WHERE learning_objective_id = $1 AND bank_lifecycle_status = 'ACTIVE'`, [algLo])).rows.map((r: any) => r.id);
  const practicePick = await selectApprovedBankItem({ attemptId: 'cert-practice', target: { learningObjectiveId: algLo, questionType: null, difficultyRange: null }, excludeApprovedItemIds: fixtureAlg, preferredStimulusKey: null });
  check('POLICY.practice-may-use-pilot', !!practicePick && pilotIds.has(practicePick.exam.approvedItemId!));

  // ---------------- historical integrity across versions ----------------
  const v1 = mockIds[0];
  const v1Row = await one(`SELECT ai.content, ai.bank_item_id, t.assessment_component_id FROM approved_items ai JOIN blueprint_objective_targets t ON t.learning_objective_id = ai.learning_objective_id WHERE ai.id = $1 LIMIT 1`, [v1]);
  const attemptId = (await one(`INSERT INTO exam_attempts (student_exam_profile_id, exam_version_id, frozen_configuration, status, completed_at) VALUES ($1, $2, '{}'::jsonb, 'COMPLETED', now()) RETURNING id`, [profileId, paa.versionId])).id;
  const respId = (await one(
    `INSERT INTO exam_attempt_item_responses (exam_attempt_id, assessment_component_id, approved_item_id, item_snapshot, raw_response, score, max_score) VALUES ($1, $2, $3, $4, '"A"'::jsonb, 1, 1) RETURNING id`,
    [attemptId, v1Row.assessment_component_id, v1, JSON.stringify(examItemFromApproved({ id: v1, learning_objective_id: algLo, content: v1Row.content }))]
  )).id;
  let immutable = '';
  try {
    await db.query(`UPDATE approved_items SET content = content || '{"explanation":"edited"}'::jsonb WHERE id = $1`, [v1]);
  } catch (e: any) {
    immutable = String(e.message);
  }
  check('HIST.v1-content-immutable', /QUESTION_BANK_VERSION_IMMUTABLE/.test(immutable));
  let noDelete = '';
  try {
    await db.query(`DELETE FROM approved_items WHERE id = $1`, [v1]);
  } catch (e: any) {
    noDelete = String(e.message);
  }
  check('HIST.version-never-deleted', /NOT_DELETABLE|foreign key/.test(noDelete));
  const admin = (await one(`SELECT id FROM users WHERE is_system ORDER BY created_at LIMIT 1`)).id;
  const v2Content = { ...v1Row.content, explanation: `${v1Row.content.explanation} (corregida)` };
  const v2 = await createNextVersion({ bankItemId: v1Row.bank_item_id, version: { content: v2Content, learningObjectiveId: (await one(`SELECT learning_objective_id FROM approved_items WHERE id = $1`, [v1])).learning_objective_id, questionType: v2Content.type, targetDifficulty: v2Content.difficulty }, lifecycle: 'VALIDATING', replaceNow: false, reason: 'CORRECTION', actor: { kind: 'ADMIN', userId: admin } });
  check('HIST.v1-still-current-while-v2-validates', (await one(`SELECT current_version_id FROM question_bank_items WHERE id = $1`, [v1Row.bank_item_id])).current_version_id === v1);
  await transitionVersion({ versionId: v2.versionId, to: 'VALIDATED', reason: 'reviewed', actor: { kind: 'ADMIN', userId: admin } });
  await transitionVersion({ versionId: v2.versionId, to: 'ACTIVE', reason: 'correction approved', actor: { kind: 'ADMIN', userId: admin } });
  const v1Now = await one(`SELECT bank_lifecycle_status, status, content FROM approved_items WHERE id = $1`, [v1]);
  check('HIST.v1-superseded-not-rewritten', v1Now.bank_lifecycle_status === 'SUPERSEDED' && v1Now.status === 'RETIRED' && JSON.stringify(v1Now.content) === JSON.stringify(v1Row.content));
  const resp = await one(`SELECT approved_item_id, item_snapshot FROM exam_attempt_item_responses WHERE id = $1`, [respId]);
  check('HIST.old-attempt-resolves-v1', resp.approved_item_id === v1 && resp.item_snapshot.explanation === v1Row.content.explanation);
  check('HIST.v2-is-current', (await one(`SELECT current_version_id FROM question_bank_items WHERE id = $1`, [v1Row.bank_item_id])).current_version_id === v2.versionId && v2.versionNumber === 2);
  const mock2 = await createExamInstance({ studentId, examProfileId: profileId, examVersionId: paa.versionId, componentIds: compIds, mode: 'MOCK' });
  const mock2Ids = mock2.form!.slots.map((s) => s.approvedItemId);
  check('HIST.new-form-never-gets-v1', !mock2Ids.includes(v1));
  const pool = await count(`SELECT count(*) n FROM approved_items WHERE id = $1 AND status = 'PUBLISHED'`, [v2.versionId]);
  check('HIST.v2-eligible-for-new-attempts', pool === 1);

  // ---------------- retirement ----------------
  const victim = mock2Ids.find((id) => id && id !== v2.versionId)!;
  await transitionVersion({ versionId: victim, to: 'RETIRED', reason: 'retire for certification', actor: { kind: 'ADMIN', userId: admin } });
  const retiredItem = await one(`SELECT qi.retired_at IS NOT NULL AS retired, ai.status FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE ai.id = $1`, [victim]);
  check('RETIRE.item-retired-history-kept', retiredItem.retired === true && retiredItem.status === 'RETIRED' && (await count(`SELECT count(*) n FROM question_bank_lifecycle_events WHERE approved_item_id = $1`, [victim])) >= 2);
  const mock3 = await createExamInstance({ studentId, examProfileId: profileId, examVersionId: paa.versionId, componentIds: compIds, mode: 'MOCK' }).catch(() => null);
  check('RETIRE.never-enters-new-form', !mock3 || !mock3.form!.slots.some((s) => s.approvedItemId === victim));
  let badTransition = '';
  try {
    await transitionVersion({ versionId: victim, to: 'ACTIVE', reason: 'resurrect', actor: { kind: 'ADMIN', userId: admin } });
  } catch (e: any) {
    badTransition = e.code ?? e.message;
  }
  check('LIFECYCLE.invalid-transition-fails', badTransition === 'INVALID_TRANSITION');
  let dbGuard = '';
  try {
    await db.query(`UPDATE approved_items SET bank_lifecycle_status = 'ACTIVE', status = 'PUBLISHED' WHERE id = $1`, [victim]);
  } catch (e: any) {
    dbGuard = String(e.message);
  }
  check('LIFECYCLE.db-trigger-refuses-invalid-transition', /QUESTION_BANK_INVALID_TRANSITION/.test(dbGuard));
  const generatedValidated = gen.find((g: any) => g.lc === 'PILOT');
  let pilotSkip = '';
  try {
    const anyPilot = (await one(`SELECT ai.id FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE qi.provenance = 'STUDYUS_GENERATED' AND ai.bank_lifecycle_status = 'PILOT' LIMIT 1`)).id;
    await transitionVersion({ versionId: anyPilot, to: 'ACTIVE', reason: 'unattended', actor: { kind: 'SYSTEM' } });
  } catch (e: any) {
    pilotSkip = e.code ?? '';
  }
  check('LIFECYCLE.system-cannot-promote-pilot-to-active', !!generatedValidated && pilotSkip === 'ADMIN_REQUIRED');

  // ---------------- AICE isolation ----------------
  const h9702 = (await refreshVersionHealth(a9702.versionId))!;
  const own9702 = Object.keys(a9702.itemIdsByKey).length;
  check('AICE.9709-never-counts-for-9702', h9702.health.totals.items === own9702 && (await refreshVersionHealth(a9709.versionId))!.health.totals.items === Object.keys(a9709.itemIdsByKey).length, { own9702, counted: h9702.health.totals.items });

  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ checks: results.length, failed: failed.length, aiFakeCalls: state.calls }));
  await db.end();
  if (failed.length) process.exit(1);
}

main().catch(async (err) => {
  console.error('INTEGRATION ERROR', err instanceof Error ? err.stack : err);
  await db.end().catch(() => undefined);
  process.exit(1);
});

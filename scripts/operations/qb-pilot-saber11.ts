/**
 * Saber 11 Matemáticas -- Question Bank population pilot, operator CLI (DEV ONLY).
 *
 *   npx tsx --env-file=<DEV env> scripts/operations/qb-pilot-saber11.ts plan
 *   npx tsx --env-file=<DEV env> scripts/operations/qb-pilot-saber11.ts calibration --max-calls 40 [--confirm-ai]
 *   npx tsx --env-file=<DEV env> scripts/operations/qb-pilot-saber11.ts status [--json]
 *   npx tsx --env-file=<DEV env> scripts/operations/qb-pilot-saber11.ts packet --out <file.md>
 *   npx tsx --env-file=<DEV env> scripts/operations/qb-pilot-saber11.ts review-report [--batch calibration-1]
 *
 * `review-report` (read-only) summarises the HUMAN review of a batch: approved / correction requested /
 * rejected, the failed checklist dimensions, and the final acceptance rate over ALL generated candidates
 * (automatic rejections included). It never approves anything.
 *
 * `calibration` generates ONLY calibration batch 1 (10 items over the 3x3 policy matrix, StudyUs difficulty
 * 3 / 5 / 2). Without --confirm-ai it is a dry run (prints the requests, writes nothing). With it: one bounded
 * factory run per planned request (never gap analysis, never other exams), stopping at --max-calls in total.
 * Generated items end at PILOT (practice only) or REVIEW_REQUIRED / REJECTED -- never ACTIVE: only a HUMAN
 * reviewer (Admin -> Banco de preguntas -> Revisión, with the pilot checklist) can approve them.
 * The remaining batches are NOT generated here: they wait for the calibration review.
 */
import { createHash } from 'crypto';
import { writeFileSync } from 'fs';
import { db } from '@/lib/db';
import { factoryConfig } from '@/lib/exam-core/question-bank/policy';
import { runFactory } from '@/lib/exam-core/question-bank/factory.service';
import { enqueueManual } from '@/lib/exam-core/question-bank/queue.service';
import { loadVersionHealthInputs } from '@/lib/exam-core/question-bank/health.service';
import { systemAuthorId } from '@/lib/exam-core/question-bank/bank.service';
import { constraintSignature, dimensionKey } from '@/lib/exam-core/slot-constraints';
import {
  calibrationRequests, planProblems, COMPETENCIES, CONTENTS, CROSS_DISTRIBUTION, DIFFICULTY_POLICY, POLICY_NOTES, REVIEW_CHECKLIST, SABER11_MATH_CONFIG_KEY, SABER11_MATH_PILOT_KEY, SABER11_MATH_SOURCES,
} from '@/lib/exam-core/question-bank/pilots/saber11-math';

const DEV_FP = '2a29b99ee14a22b4';
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);

function fingerprint(): string {
  const u = new URL(process.env.DATABASE_URL ?? '');
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}

async function saberVersion(): Promise<{ id: string; label: string }> {
  const r = await db.query(
    `SELECT v.id, v.version_label FROM exam_versions v JOIN exam_definitions d ON d.id = v.exam_definition_id
      WHERE d.config_key = $1 AND d.status = 'ACTIVE' AND v.status = 'PUBLISHED' ORDER BY v.created_at DESC LIMIT 1`,
    [SABER11_MATH_CONFIG_KEY]
  );
  if (!r.rows[0]) throw new Error(`no published version of ${SABER11_MATH_CONFIG_KEY}`);
  return { id: r.rows[0].id, label: r.rows[0].version_label };
}

function plan() {
  const problems = planProblems();
  console.log(JSON.stringify({
    pilot: SABER11_MATH_PILOT_KEY, sources: SABER11_MATH_SOURCES, problems,
    competencies: Object.fromEntries(Object.entries(COMPETENCIES).map(([k, c]) => [k, { label: c.label, officialPercent: c.officialPercent, items: c.items }])),
    contents: Object.fromEntries(Object.entries(CONTENTS).map(([k, c]) => [k, { label: c.label, officialRangePercent: c.officialRangePercent, items: c.items }])),
    crossDistribution_STUDYUS_POLICY: CROSS_DISTRIBUTION, difficulty_STUDYUS_POLICY: DIFFICULTY_POLICY, policyNotes: POLICY_NOTES,
    calibrationBatch1: calibrationRequests().map((r) => ({ objective: r.objectiveCode, competency: r.pilot.competency, content: r.pilot.contentCategory, difficulty: r.pilot.difficulty })),
    reviewChecklist: REVIEW_CHECKLIST,
  }, null, 1));
  if (problems.length) throw new Error(`plan inconsistent: ${problems.join(', ')}`);
}

async function calibration() {
  const problems = planProblems();
  if (problems.length) throw new Error(`plan inconsistent: ${problems.join(', ')}`);
  const maxCalls = Number(opt('--max-calls') ?? 0);
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 60) throw new Error('--max-calls must be 1..60');
  const version = await saberVersion();
  const inputs = await loadVersionHealthInputs(version.id);
  if (!inputs) throw new Error('no bank inputs for the Saber version');
  const requests = calibrationRequests();
  // With the V2.1 blueprint each competence x content combination is its own cell (slot constraints); on the
  // V2 (12-slot) blueprint the competence objective's single cell is used and the content goes in the pilot params.
  const cellFor = (r: (typeof requests)[number]) => {
    const want = [`COMPETENCE=${dimensionKey(r.pilot.competencyLabel)}`, `CONTENT_CATEGORY=${dimensionKey(r.pilot.contentCategory)}`];
    const constrained = inputs.cells.find((c) => c.objectiveCode === r.objectiveCode && want.every((w) => constraintSignature(c.constraints).split(';').includes(w)));
    return constrained ?? inputs.cells.find((c) => c.objectiveCode === r.objectiveCode && !c.constraints?.length);
  };
  for (const r of requests) if (!cellFor(r)) throw new Error(`no blueprint cell for ${r.objectiveCode} x ${r.pilot.contentCategory}`);
  console.log(JSON.stringify({ version, requests: requests.map((r) => ({ cell: cellFor(r)!.cellKey, content: r.pilot.contentCategory, difficulty: r.pilot.difficulty, count: r.count, idempotencyKey: r.idempotencyKey })) }, null, 1));
  if (!flag('--confirm-ai')) {
    console.log('DRY RUN: nothing enqueued or generated (add --confirm-ai).');
    return;
  }
  const requestedBy = await systemAuthorId();
  const base = factoryConfig({ ...process.env, QUESTION_BANK_FACTORY_ENABLED: 'true' });
  let used = 0;
  const results: unknown[] = [];
  for (const r of requests) {
    const remaining = maxCalls - used;
    if (remaining < 3) {
      results.push({ idempotencyKey: r.idempotencyKey, skipped: 'BUDGET' });
      continue;
    }
    const { request, created } = await enqueueManual({ inputs, cellKey: cellFor(r)!.cellKey, count: r.count, requestedBy, idempotencyKey: r.idempotencyKey, maxBatch: 3, difficultyMix: r.difficultyMix, pilot: r.pilot });
    // Idempotent re-run: a request already completed (or another open request of the cell) is never regenerated.
    if (!created) {
      results.push({ idempotencyKey: r.idempotencyKey, skipped: `EXISTING_${request.status}`, requestId: request.id });
      continue;
    }
    // Enabled for THIS process only, for THIS request only, bounded by the remaining call budget.
    const cfg = { ...base, enabled: true, maxPerRun: remaining, dailyBudget: Math.max(base.dailyBudget, maxCalls), maxBatch: 3, examConfigKeys: [SABER11_MATH_CONFIG_KEY] };
    const run = await runFactory({ trigger: 'CLI', cfg, examVersionIds: [version.id], onlyRequestId: request.id, skipGapAnalysis: true });
    used += run.counters.aiCalls;
    results.push({ idempotencyKey: r.idempotencyKey, requestId: request.id, runStatus: run.status, calls: run.counters.aiCalls, costUSD: run.counters.costUSD, candidates: run.counters.candidates, pilot: run.counters.accepted, rejected: run.counters.rejected, reviewRequired: run.counters.reviewRequired, notes: run.notes });
  }
  console.log(JSON.stringify({ aiCallsUsed: used, maxCalls, results }, null, 1));
}

async function pilotItems() {
  const version = await saberVersion();
  return (await db.query(
    `SELECT qi.item_key, ai.id AS version_id, ai.version_number, ai.bank_lifecycle_status AS lifecycle, ai.content, ai.validation_report, lo.code AS objective, gr.generation_params->'pilot' AS pilot, gr.status AS request_status,
            (SELECT r.decision FROM question_bank_reviews r WHERE r.approved_item_id = ai.id ORDER BY r.reviewed_at DESC LIMIT 1) AS review
       FROM question_bank_items qi JOIN question_bank_generation_requests gr ON gr.id = qi.generation_request_id
       JOIN approved_items ai ON ai.bank_item_id = qi.id JOIN learning_objectives lo ON lo.id = ai.learning_objective_id
      WHERE qi.exam_version_id = $1 AND gr.generation_params->'pilot'->>'pilotKey' = $2
      ORDER BY gr.created_at, qi.created_at, ai.version_number`,
    [version.id, SABER11_MATH_PILOT_KEY]
  )).rows;
}

async function status() {
  const rows = await pilotItems();
  const current = rows.filter((r: any, i: number) => !rows.slice(i + 1).some((x: any) => x.item_key === r.item_key));
  const tally = (f: (r: any) => string) => current.reduce<Record<string, number>>((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {});
  const summary = { candidates: current.length, byLifecycle: tally((r) => r.lifecycle), byReview: tally((r) => r.review ?? 'NOT_REVIEWED'), byCompetency: tally((r) => r.pilot?.competency ?? '?'), byContent: tally((r) => r.content?.tags?.contentCategory ?? '?') };
  if (flag('--json')) return console.log(JSON.stringify({ summary, items: current }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  for (const r of current) console.log([r.lifecycle, r.review ?? '-', r.pilot?.competency, r.content?.tags?.contentCategory, `d${r.content?.difficulty}`, r.validation_report?.outcome ?? '-', (r.validation_report?.issues ?? []).map((i: any) => i.code).join(',') || '-', r.item_key].join('\t'));
}

const DIFF_LABEL: Record<number, string> = { 2: 'BÁSICA', 3: 'INTERMEDIA', 4: 'AVANZADA' };

async function packet() {
  const out = opt('--out');
  if (!out) throw new Error('--out <file.md> required');
  const rows = await pilotItems();
  const current = rows.filter((r: any, i: number) => !rows.slice(i + 1).some((x: any) => x.item_key === r.item_key));
  const lines: string[] = [
    '# Saber 11 Matemáticas — piloto · lote de calibración 1 · paquete de revisión humana', '',
    `Generado ${new Date().toISOString()} desde DEV (fp ${fingerprint()}). Contenido ORIGINAL generado por StudyUs (asistido por IA). No es contenido oficial del Icfes.`, '',
    '**La decisión se registra en Admin → Banco de preguntas → Revisión** (la aprobación exige confirmar los 9 puntos; quien revisa nunca es el autor).', '',
    'Lista de revisión por ítem:', ...REVIEW_CHECKLIST.map(([k, l]) => `- **${k}** — ${l}`), '',
    `Política StudyUs (no oficial): ${POLICY_NOTES.difficulty} ${POLICY_NOTES.crossDistribution}`, '',
  ];
  current.forEach((r: any, i: number) => {
    const c = r.content ?? {};
    lines.push(`---`, '', `## ${i + 1}. ${r.pilot?.competencyLabel ?? r.objective} × ${c.tags?.contentCategory ?? '?'} — dificultad StudyUs ${DIFF_LABEL[c.difficulty] ?? c.difficulty}`, '');
    lines.push(`Estado: **${r.lifecycle}** · validación automática: **${r.validation_report?.outcome ?? '—'}**${(r.validation_report?.issues ?? []).length ? ` (${r.validation_report.issues.map((x: any) => x.code).join(', ')})` : ''} · revisión: ${r.review ?? 'pendiente'} · \`${r.item_key}\` v${r.version_number}`, '');
    if (c.stimulus) lines.push(`> **${c.stimulus.title ?? 'Contexto'}**`, ...String(c.stimulus.text).split('\n').map((l: string) => `> ${l}`), '');
    lines.push(`**${c.question}**`, '');
    for (const o of c.options ?? []) lines.push(`- ${o.id}) ${o.text}${o.id === c.correctAnswer ? ' **← clave**' : c.distractorRationale?.[o.id] ? ` — _${c.distractorRationale[o.id]}_` : ''}`);
    lines.push('', `**Solución:** ${c.explanation}`, '');
    lines.push(`- Competencia: ${c.tags?.competency ?? '—'}`, `- Afirmación: ${c.tags?.assertion ?? '—'}`, `- Evidencia (afirmada por el generador — verificar con el marco Icfes): ${c.tags?.evidence ?? '—'}`, `- Clave recomputada: ${r.validation_report?.verification?.verificationExpression ?? '—'}`, `- Validador independiente: ${r.validation_report?.validator?.verdict ? `eligió ${r.validation_report.validator.verdict.selectedOptionId}, dificultad estimada ${r.validation_report.validator.verdict.estimatedDifficulty}, ${r.validation_report.validator.verdict.note ?? ''}` : '—'}`, '');
  });
  writeFileSync(out, lines.join('\n'));
  console.log(`packet: ${current.length} items -> ${out}`);
}

async function reviewReport() {
  const batch = opt('--batch') ?? 'calibration-1';
  const version = await saberVersion();
  // One row per generated candidate (bank item): its current version, latest human decision and checklist.
  const rows = (await db.query(
    `SELECT qi.item_key, cur.bank_lifecycle_status AS lifecycle, gr.generation_params->'pilot'->>'competency' AS competency, cur.content->'tags'->>'contentCategory' AS content,
            r.decision, r.review_checklist, r.review_notes, r.reviewed_at, (r.reviewed_by = cur.created_by) AS self_review
       FROM question_bank_items qi JOIN question_bank_generation_requests gr ON gr.id = qi.generation_request_id
       JOIN approved_items cur ON cur.id = qi.current_version_id
       LEFT JOIN LATERAL (SELECT * FROM question_bank_reviews rv WHERE rv.bank_item_id = qi.id ORDER BY rv.reviewed_at DESC LIMIT 1) r ON true
      WHERE qi.exam_version_id = $1 AND gr.generation_params->'pilot'->>'pilotKey' = $2 AND gr.generation_params->'pilot'->>'batch' = $3
      ORDER BY qi.created_at`,
    [version.id, SABER11_MATH_PILOT_KEY, batch]
  )).rows;
  const count = (f: (r: any) => boolean) => rows.filter(f).length;
  const failedByDimension: Record<string, number> = Object.fromEntries(REVIEW_CHECKLIST.map(([k]) => [k, 0]));
  for (const r of rows) for (const [k, v] of Object.entries((r.review_checklist ?? {}) as Record<string, boolean>)) if (v === false) failedByDimension[k] = (failedByDimension[k] ?? 0) + 1;
  const approved = count((r) => r.decision === 'APPROVED');
  const report = {
    batch, generatedCandidates: rows.length,
    automaticallyRejected: count((r) => !r.decision && r.lifecycle === 'REJECTED'),
    awaitingHumanReview: count((r) => !r.decision && r.lifecycle !== 'REJECTED'),
    human: { approved, correctionRequested: count((r) => r.decision === 'CORRECTION_REQUESTED'), rejected: count((r) => r.decision === 'REJECTED') },
    failedChecklistByDimension: failedByDimension,
    finalAcceptanceRate: rows.length ? Math.round((approved / rows.length) * 1000) / 1000 : null,
    reviewComplete: rows.length > 0 && count((r) => !r.decision && r.lifecycle !== 'REJECTED') === 0,
    selfReviews: count((r) => r.self_review === true),
    items: rows.map((r: any) => ({ item: r.item_key, competency: r.competency, content: r.content, lifecycle: r.lifecycle, decision: r.decision ?? (r.lifecycle === 'REJECTED' ? 'AUTO_REJECTED' : 'PENDING_HUMAN_REVIEW'), failed: Object.entries((r.review_checklist ?? {}) as Record<string, boolean>).filter(([, v]) => v === false).map(([k]) => k), notes: r.review_notes ?? null })),
  };
  console.log(JSON.stringify(report, null, 1));
}

async function main() {
  const cmd = args[0];
  if (cmd === 'plan') return plan();
  const fp = fingerprint();
  if (fp !== DEV_FP) throw new Error(`REFUSING: not the DEV database (${fp})`);
  if (cmd === 'calibration') await calibration();
  else if (cmd === 'status') await status();
  else if (cmd === 'packet') await packet();
  else if (cmd === 'review-report') await reviewReport();
  else throw new Error('usage: plan | calibration --max-calls N [--confirm-ai] | status [--json] | packet --out <file.md>');
}

main()
  .then(() => db.end().catch(() => undefined))
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await db.end().catch(() => undefined);
    process.exit(1);
  });

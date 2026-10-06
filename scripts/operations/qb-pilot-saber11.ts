/**
 * Saber 11 Matemáticas -- Question Bank population pilot, operator CLI (DEV ONLY).
 *
 *   npx tsx --env-file=<DEV env> scripts/operations/qb-pilot-saber11.ts plan
 *   npx tsx --env-file=<DEV env> scripts/operations/qb-pilot-saber11.ts calibration --max-calls 40 [--confirm-ai]
 *   npx tsx --env-file=<DEV env> scripts/operations/qb-pilot-saber11.ts status [--json]
 *   npx tsx --env-file=<DEV env> scripts/operations/qb-pilot-saber11.ts packet --out <file.md>
 *   npx tsx --env-file=<DEV env> scripts/operations/qb-pilot-saber11.ts review-report [--batch calibration-1] [--markdown <file.md>]
 *   npx tsx --env-file=<DEV env> scripts/operations/qb-pilot-saber11.ts review-package --out <file.md> [--batch calibration-1]
 *
 * `review-report` (read-only) summarises the HUMAN review of a batch: approved / correction requested /
 * rejected, the failed checklist dimensions, and the final acceptance rate over ALL generated candidates
 * (automatic rejections included), the proposed-vs-human competence / content / difficulty comparison, the
 * answer-key accuracy, the Batch 2 recommendation and whether real content exists for the E2E. It never
 * approves anything: an item without a human review row is AWAITING_HUMAN_REVIEW, whatever its automated PASS.
 *
 * `review-package` (read-only) writes the reviewer's package: per item identity, question, key, solution,
 * proposed classification, Blueprint V2.1 cell check, automated checks / warnings / validator signal, the
 * attention points to confirm or reject, and the 9-point checklist. Decisions are recorded ONLY by the human
 * reviewer, with their own account, in Admin -> Banco de preguntas -> Revisión.
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
import { attentionPointsFor, buildHumanReviewReport, HUMAN_DECISION_LABEL, PilotReviewAssessmentSchema, proposalFromContent, v21CellCheck, type ReviewReportRow } from '@/lib/exam-core/question-bank/pilots/human-review';
import { saber11V21DeclaredCells } from '@/lib/exam-core/question-bank/pilots/saber11-v21-cells';
import { isEligible } from '@/lib/exam-core/question-bank/lifecycle';
import type { Saber11Competency, Saber11Content } from '@/lib/exam-core/question-bank/pilots/saber11-math';

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

const CONTENT_BY_LABEL = (label: unknown): Saber11Content | null => (Object.keys(CONTENTS) as Saber11Content[]).find((k) => CONTENTS[k].label === label) ?? null;

async function hasAssessmentColumn(): Promise<boolean> {
  const r = await db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'question_bank_reviews' AND column_name = 'review_assessment'`);
  return r.rows.length > 0;
}

/** One row per generated candidate of the batch: current version, automated outcome and latest HUMAN review. */
async function batchRows(batch: string) {
  const version = await saberVersion();
  const withAssessment = await hasAssessmentColumn();
  return (await db.query(
    `SELECT qi.item_key, qi.provenance, qi.retired_at, gr.id AS request_id, gr.idempotency_key, gr.generation_params->'pilot' AS pilot, qi.generation_metadata,
            cur.id AS version_id, cur.version_number, cur.bank_lifecycle_status AS lifecycle, cur.status, cur.usage_eligibility, cur.exam_alignment, cur.content, cur.validation_report, cur.question_type,
            lo.code AS objective_code,
            r.decision, r.review_checklist, r.review_notes, r.reviewed_at, ${withAssessment ? 'r.review_assessment' : 'NULL::jsonb AS review_assessment'},
            (r.reviewed_by = cur.created_by OR ru.is_system IS TRUE) AS invalid_reviewer
       FROM question_bank_items qi JOIN question_bank_generation_requests gr ON gr.id = qi.generation_request_id
       JOIN approved_items cur ON cur.id = qi.current_version_id
       JOIN learning_objectives lo ON lo.id = cur.learning_objective_id
       LEFT JOIN LATERAL (SELECT * FROM question_bank_reviews rv WHERE rv.bank_item_id = qi.id ORDER BY rv.reviewed_at DESC LIMIT 1) r ON true
       LEFT JOIN users ru ON ru.id = r.reviewed_by
      WHERE qi.exam_version_id = $1 AND gr.generation_params->'pilot'->>'pilotKey' = $2 AND gr.generation_params->'pilot'->>'batch' = $3
      ORDER BY gr.created_at, qi.created_at`,
    [version.id, SABER11_MATH_PILOT_KEY, batch]
  )).rows;
}

function toReportRow(r: any, i: number): ReviewReportRow {
  const parsed = r.review_assessment ? PilotReviewAssessmentSchema.safeParse(r.review_assessment) : null;
  return {
    ordinal: i + 1,
    itemKey: r.item_key,
    autoStatus: r.lifecycle === 'REJECTED' && !r.decision ? 'AUTO_REJECTED' : 'PASSED_AUTOMATED_VALIDATION',
    autoIssues: ((r.validation_report?.issues ?? []) as any[]).map((x) => x.code),
    lifecycle: r.lifecycle,
    proposal: proposalFromContent(r.content),
    decision: r.decision ?? null,
    checklist: r.review_checklist ?? null,
    assessment: parsed?.success ? parsed.data : null,
    notes: r.review_notes ?? null,
    invalidReviewer: r.invalid_reviewer === true,
    practiceEligible: isEligible({ lifecycle: r.lifecycle, usage: r.usage_eligibility, alignment: r.exam_alignment, provenance: r.provenance, status: r.status, isCurrentVersion: true, retired: !!r.retired_at, calibrationConfidence: null }, 'PRACTICE', undefined, 'STUDENT'),
  };
}

async function reviewReport() {
  const batch = opt('--batch') ?? 'calibration-1';
  const rows = await batchRows(batch);
  const report = { batch, generatedAt: new Date().toISOString(), assessmentColumn: await hasAssessmentColumn(), ...buildHumanReviewReport(rows.map(toReportRow)) };
  console.log(JSON.stringify(report, null, 1));
  const md = opt('--markdown');
  if (md) {
    const t = report.items;
    const lines = [
      `# Saber 11 Matemáticas — ${batch} — reporte de revisión humana`, '',
      `Estado: **${report.status}** · generado ${report.generatedAt} (DEV, solo lectura).`, '',
      `Funnel: generados ${report.funnel.generated} · AUTO_REJECTED ${report.funnel.autoRejected} · esperando revisión humana ${report.funnel.awaitingHumanReview} · HUMAN_APPROVED ${report.funnel.humanApproved} · CORRECTION_REQUIRED ${report.funnel.correctionRequired} · REJECTED ${report.funnel.humanRejected}.`,
      `Fallos de la lista de revisión: ${report.checklistFailureBasis.text}`, '',
      '| Item | Auto status | Human decision | Correct answer (key / reviewed) | Competence proposed | Competence reviewed | Content proposed | Content reviewed | Difficulty proposed | Difficulty reviewed | Checklist failures | Correction required | Reviewer notes |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
      ...t.map((x) => `| ${x.item} | ${x.autoStatus}${x.autoIssues.length ? ` (${x.autoIssues.join(', ')})` : ''} | ${x.humanDecision} | ${x.answerKey ?? '—'} / ${x.reviewedAnswer ?? '—'} | ${x.competenceProposed ?? '—'} | ${x.competenceReviewed ?? '—'} | ${x.contentProposed ?? '—'} | ${x.contentReviewed ?? '—'} | ${x.difficultyProposed ?? '—'} | ${x.difficultyReviewed ?? '—'} | ${x.checklistFailures.join(', ') || '—'} | ${x.correctionRequired ?? '—'} | ${(x.reviewerNotes ?? '—').replace(/\|/g, '/').replace(/\n/g, ' ')} |`),
      '', '```json', JSON.stringify({ funnel: report.funnel, rates: report.rates, checklistFailures: report.checklistFailures, answerKeyAccuracy: report.answerKeyAccuracy, batch2: report.batch2, e2e: report.e2e }, null, 1), '```', '',
    ];
    writeFileSync(md, lines.join('\n'));
    console.error(`markdown -> ${md}`);
  }
}

async function reviewPackage() {
  const out = opt('--out');
  if (!out) throw new Error('--out <file.md> required');
  const batch = opt('--batch') ?? 'calibration-1';
  const rows = await batchRows(batch);
  const declared = new Set(saber11V21DeclaredCells().keys());
  const label = (k: string | null, table: Record<string, { label: string }>) => (k ? table[k]?.label ?? k : 'sin etiqueta');
  const DIFF: Record<string, string> = { BASIC: 'BÁSICA', INTERMEDIATE: 'INTERMEDIA', ADVANCED: 'AVANZADA' };
  const sent = rows.filter((r: any) => !(r.lifecycle === 'REJECTED' && !r.decision));
  const lines: string[] = [
    `# Saber 11 Matemáticas — Human Review Batch 1 — paquete del revisor`, '',
    `Batch = **Saber 11 Math Calibration 1** (\`${batch}\`). Generado ${new Date().toISOString()} desde DEV (fp ${fingerprint()}), solo lectura.`,
    'Contenido ORIGINAL generado por StudyUs con asistencia de IA. No es contenido oficial del Icfes.', '',
    `**${sent.length} ítems para revisión humana** (pasaron la validación automática) · ${rows.length - sent.length} rechazados automáticamente (no se revisan; cuentan en la tasa final).`, '',
    '> **La validación automática NO es una aprobación humana.** Cada ítem sigue en espera de revisión humana hasta que un revisor calificado registre una decisión explícita.', '',
    '## Cómo registrar la decisión', '',
    '- Dónde: Admin → Banco de preguntas → Revisión → ítem (con **tu propia cuenta**; quien revisa nunca es el autor ni una identidad del sistema).',
    '- Decisiones: **HUMAN_APPROVED** (Aprobar) · **CORRECTION_REQUIRED** (Solicitar corrección) · **REJECTED** (Rechazar).',
    '- Para cualquier decisión: responde **Sí / No** a los 9 puntos, elige la competencia, la categoría de contenido, la dificultad StudyUs y la respuesta correcta según tu revisión, y confirma o descarta cada punto de atención.',
    '- Aprobar exige los 9 puntos en «Sí». Solicitar corrección exige al menos un «No», un comentario y notas de corrección. Rechazar exige al menos un «No» y el motivo.',
    '- **Prerrequisito (operador, antes de registrar):** el entorno donde se registra debe tener la migración `20261104_1000_question_bank_review_assessment` aplicada y el código de esta revisión desplegado. Sin ellos, el formulario no captura la clasificación del revisor y la base de datos rechaza la decisión de piloto (`PILOT_ASSESSMENT_REQUIRED`).', '',
    'Lista de revisión (contrato vigente, 9 puntos):', ...REVIEW_CHECKLIST.map(([k, l]) => `- **${k}** — ${l}`), '',
    `Política StudyUs (no oficial): ${POLICY_NOTES.difficulty} ${POLICY_NOTES.crossDistribution}`, '',
  ];
  rows.forEach((r: any, i: number) => {
    const c = r.content ?? {};
    const prop = proposalFromContent(c);
    const pilot = r.pilot ?? {};
    const auto = r.lifecycle === 'REJECTED' && !r.decision;
    const cell = v21CellCheck({ requested: { competency: pilot.competency as Saber11Competency, content: CONTENT_BY_LABEL(pilot.contentCategory) }, objectiveCode: r.objective_code, proposal: prop, marks: c.marks, declaredSignatures: declared });
    const issues = ((r.validation_report?.issues ?? []) as any[]);
    const v = r.validation_report?.validator?.verdict;
    lines.push('---', '', `## Ítem ${i + 1} ${auto ? '— AUTO_REJECTED (no se revisa)' : `— ${r.decision ? HUMAN_DECISION_LABEL[r.decision as 'APPROVED'] : 'AWAITING_HUMAN_REVIEW'}`}`, '');
    lines.push('**Identidad**', '', `- Candidato: \`${r.item_key}\` · versión v${r.version_number} (\`${r.version_id}\`)`, `- Batch: Saber 11 Math Calibration 1 · solicitud \`${r.idempotency_key}\``, `- Estado del ciclo de vida: ${r.lifecycle}`, '');
    if (c.stimulus) lines.push(`> **${c.stimulus.title ?? 'Contexto'}**`, ...String(c.stimulus.text).split('\n').map((l: string) => `> ${l}`), '');
    lines.push('**Pregunta**', '', c.question ?? '—', '');
    for (const o of c.options ?? []) lines.push(`- **${o.id})** ${o.text}${o.id === c.correctAnswer ? '  ← **clave propuesta**' : ''}`);
    lines.push('', `**Clave propuesta:** ${c.correctAnswer ?? '—'}`, '', `**Solución / explicación:** ${c.explanation ?? '—'}`, '');
    if (c.distractorRationale) lines.push('**Racionales de distractores (del generador):**', ...Object.entries(c.distractorRationale as Record<string, string>).map(([k, t]) => `- ${k}: ${t}`), '');
    lines.push('**Clasificación propuesta (generador — confirmar o corregir)**', '',
      `- Competencia: ${label(prop.competency, COMPETENCIES)}`,
      `- Afirmación: ${c.tags?.assertion ?? '—'}`,
      `- Evidencia (afirmada por el generador; verificar con el marco Icfes): ${c.tags?.evidence ?? '—'}`,
      `- Categoría de contenido: ${label(prop.contentCategory, CONTENTS)}`,
      `- Dificultad StudyUs: ${prop.difficulty ? DIFF[prop.difficulty] : '—'} (escala interna ${c.difficulty ?? '—'}; nunca un nivel de desempeño Icfes)`,
      `- Idioma / locale: ${c.language ?? '—'} / ${pilot.locale ?? '—'}`,
      `- Puntos (marks): ${c.marks ?? '—'} · tipo: ${r.question_type ?? c.type ?? '—'} (${c.answerFormat ?? '—'})`, '');
    lines.push('**Celda Blueprint**', '', `- Solicitada: ${pilot.competency ?? '—'} × ${CONTENT_BY_LABEL(pilot.contentCategory) ?? '—'} · objetivo \`${r.objective_code}\``, `- Propuesta por el ítem: **${cell.cell}** · ${cell.declaredInV21 ? 'declarada en Blueprint Saber V2.1 (50 posiciones)' : 'NO declarada en V2.1'}${cell.problems.length ? ` · ⚠ ${cell.problems.join(', ')}` : ' · coincide con la solicitud'}`, '');
    lines.push('**Validación automática (no es aprobación humana)**', '',
      `- Resultado: ${r.validation_report?.outcome ?? '—'} · etapa ${r.validation_report?.stage ?? '—'}`,
      `- Clave recomputada (MATH): ${r.validation_report?.verification?.verificationExpression ?? '—'}`,
      `- Hallazgos: ${issues.length ? issues.map((x) => `${x.code} (${x.severity})`).join(', ') : 'ninguno'}`,
      `- Validador independiente: ${v ? `eligió ${v.selectedOptionId}, dificultad estimada ${v.estimatedDifficulty}, distractores implausibles ${(v.implausibleDistractorIds ?? []).join(', ') || 'ninguno'}, alternativas defendibles ${(v.alternativeDefensibleOptionIds ?? []).join(', ') || 'ninguna'}` : '—'}`, '');
    if (!auto) {
      const aps = attentionPointsFor(r.item_key, batch);
      lines.push('**Puntos de atención (confirmar o descartar; NO son decisiones)**', '', ...aps.map((a) => `- [ ] Confirmo · [ ] No confirmo — ${a.text} \`${a.code}\``), '');
      lines.push('**Decisión del revisor (se registra en Admin)**', '', ...REVIEW_CHECKLIST.map(([k, l]) => `- [ ] Sí · [ ] No — ${k}: ${l}`), '', '- Competencia según el revisor: ____ · Contenido: ____ · Dificultad StudyUs: ____ · Respuesta correcta: ____', '- Decisión: [ ] HUMAN_APPROVED · [ ] CORRECTION_REQUIRED · [ ] REJECTED', '');
    }
  });
  writeFileSync(out, lines.join('\n'));
  console.log(`review package: ${rows.length} candidates (${sent.length} for human review) -> ${out}`);
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
  else if (cmd === 'review-package') await reviewPackage();
  else throw new Error('usage: plan | calibration --max-calls N [--confirm-ai] | status [--json] | packet --out <file.md> | review-report [--batch b] [--markdown f.md] | review-package --out <file.md>');
}

main()
  .then(() => db.end().catch(() => undefined))
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await db.end().catch(() => undefined);
    process.exit(1);
  });

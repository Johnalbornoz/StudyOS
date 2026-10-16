/**
 * TRACK B -- PAA FULL-LENGTH preparation mock, end to end, in-process (PAA_FULL_LENGTH_MOCK, John 2026-10-15).
 *
 *   v2.paa-full-length (175 positions, 4 sections, official order and time) -> one MOCK instance of the WHOLE test
 *   -> frozen at start, stored as PREPARATION_MOCK (StudyUs preparation, never an official form) -> every position
 *   answered (keyed, then wrong) -> canonical scorers -> Exam Readiness evidence only.
 *
 * Checks: blueprint 175 = 45/25/55/50 and 100% filled, timing 50/30/60/40, section order, no within-form repeat (item,
 * template, wording), certified lineage only (no LEGACY), no coach / no feedback / no hints, 0 provider calls, scoring,
 * evidence + attribution, Learning Plan and Knowledge State untouched, fixture removed.
 *
 *   EXAM_BANK_PUBLICATION_FP=4baac799b9bd2a6a npx tsx --env-file=<candidate env> scripts/operations/exam-bank/paa-full-length-scenario.ts [--out <json>]
 *
 * Authorised targets: DEV and the pilot candidate's own database. Writes only its own fixture Student, then removes it.
 */
import { createHash } from 'crypto';
import { writeFileSync } from 'fs';

process.env.EXAM_BANK_DELIVERY_SCOPE = 'PILOT_PREVIEW';
process.env.QUESTION_BANK_READINESS_MODE = 'ENFORCE';
// as the candidate deployment runs: the frozen assessment snapshot is written at start
process.env.ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED = 'true';
const TARGETS: Readonly<Record<string, string>> = { '2a29b99ee14a22b4': 'DEV', '4baac799b9bd2a6a': 'PILOT_CANDIDATE_20261015' };
const CONFIG = 'v2.paa-full-length';
const OFFICIAL: Readonly<Record<string, { order: number; items: number; minutes: number }>> = { lectura: { order: 1, items: 45, minutes: 50 }, redaccion: { order: 2, items: 25, minutes: 30 }, matematicas: { order: 3, items: 55, minutes: 60 }, ingles: { order: 4, items: 50, minutes: 40 } };
const RUN = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = ''): void => { results.push({ id, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? `  [${detail}]` : ''}`); };

async function main(): Promise<number> {
  const out = (() => { const i = process.argv.indexOf('--out'); return i > 0 ? process.argv[i + 1] : null; })();
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${u.hostname}|${u.pathname.slice(1)}`).digest('hex').slice(0, 16);
  if (!TARGETS[fp] || process.env.EXAM_BANK_PUBLICATION_FP !== fp) throw new Error(`REFUSING: database ${fp} is not an authorised target`);
  const { db } = await import('@/lib/db');
  const { getOrCreateCanonicalUser } = await import('@/lib/identity/canonical-user.service');
  const { upsertStudentFromWebhook } = await import('@/lib/auth');
  const { assignSelfServiceRole } = await import('@/lib/identity/role-assignment.service');
  const { createExamInstance, startExamInstance, ensureExamProfile } = await import('@/lib/exam-core/exam-instance.service');
  const { getNextSimulationItem, submitSimulationItemAnswer, finalizeOpenItemsForSubmission, endSimulationBreak } = await import('@/lib/simulation/item-resolution.service');
  const { completeSimulationAttempt, getSimulationAttempt } = await import('@/lib/simulation/attempt.service');
  const { finalizeExamCompletion } = await import('@/lib/exam-core/post-completion');
  const { findAnswerKeyLeak } = await import('@/lib/exam-core/items');
  const { engineReadinessForVersion } = await import('@/lib/exam-bank/readiness/readiness-authority.service');
  const { cleanupFixtureStudent } = await import('./fixture-cleanup');
  const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
  const n = async (sql: string, p: unknown[] = []) => Number((await one(sql, p))?.n ?? 0);

  const exam = await one(`SELECT d.id AS definition_id, v.id AS version_id FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED' WHERE d.config_key = $1`, [CONFIG]);
  check(`B1  ${CONFIG} is published in ${TARGETS[fp]}`, !!exam);
  if (!exam) { await db.end(); return 1; }
  const comps = (await db.query(`SELECT id, section_key, sequence_order, duration_minutes, definition FROM assessment_components WHERE exam_version_id = $1 ORDER BY sequence_order`, [exam.version_id])).rows;
  const targets = (await db.query(`SELECT t.assessment_component_id AS comp, lo.code, t.question_type, COALESCE(t.target_item_count, 1)::int AS required FROM blueprint_objective_targets t JOIN learning_objectives lo ON lo.id = t.learning_objective_id JOIN assessment_blueprints b ON b.id = t.blueprint_id AND b.exam_version_id = $1 AND b.purpose IS NULL`, [exam.version_id])).rows;
  const requiredOf = (compId: string) => targets.filter((t: any) => t.comp === compId).reduce((m: number, t: any) => m + t.required, 0);
  const total = targets.reduce((m: number, t: any) => m + t.required, 0);
  check('B2  four sections in the official order', comps.map((c: any) => c.section_key).join(',') === 'lectura,redaccion,matematicas,ingles', comps.map((c: any) => c.section_key).join(','));
  check('B3  PAA_FULL_BLUEPRINT: 175 positions = Lectura 45 / Redacción 25 / Matemáticas 55 / Inglés 50', total === 175 && comps.every((c: any) => requiredOf(c.id) === OFFICIAL[c.section_key]?.items && Number(c.definition?.officialItemCount) === OFFICIAL[c.section_key]?.items), comps.map((c: any) => `${c.section_key}:${requiredOf(c.id)}`).join(' '));
  check('B4  PAA_FULL_TIMING: each section runs on its official time (50 / 30 / 60 / 40 min)', comps.every((c: any) => Number(c.duration_minutes) === OFFICIAL[c.section_key]?.minutes && Number(c.definition?.officialDurationMinutes) === OFFICIAL[c.section_key]?.minutes), comps.map((c: any) => `${c.section_key}:${c.duration_minutes}`).join(' '));
  const engine = await engineReadinessForVersion(exam.version_id);
  check('R1  PAA_FULL_LENGTH_MOCK readiness = READY (engine), stored as a PREPARATION_MOCK', engine?.reducedMock === 'READY' && engine?.mockAttemptType === 'PREPARATION_MOCK', `${engine?.reducedMock} ${engine?.mockAttemptType}; ${JSON.stringify(engine?.practiceBySection)}`);
  const report: Record<string, unknown> = { kind: 'PAA_FULL_LENGTH_SCENARIO', run: RUN, database: TARGETS[fp], config: CONFIG, engine };

  const clerk = `ebr-paa-full-${RUN}`;
  const user = await getOrCreateCanonicalUser(clerk, `${clerk}@exam-bank.test`);
  const S = await upsertStudentFromWebhook(clerk, `${clerk}@exam-bank.test`, 'paa full-length scenario');
  const actor = user.id as string;
  await assignSelfServiceRole(clerk, actor, 'STUDENT');
  try {
    await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', 'paa full-length scenario') ON CONFLICT (id) DO NOTHING`, [S]);
    await db.query(`INSERT INTO student_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [S]);
    const providerCalls = async () => n(`SELECT count(*)::int AS n FROM ai_execution_events WHERE student_id = $1`, [S]).catch(() => -1);
    const planEntries = async () => n(`SELECT count(*)::int AS n FROM student_plan_entries WHERE student_id = $1`, [S]);
    const knowledge = async () => n(`SELECT count(*)::int AS n FROM concept_knowledge_state WHERE student_id = $1`, [S]).catch(() => -1);
    const plan0 = await planEntries(); const ks0 = await knowledge(); const calls0 = await providerCalls();
    const profileId = await ensureExamProfile(S, exam.definition_id, exam.version_id);

    const attempt = async (label: string, answerOf: (content: any) => string) => {
      const inst = await createExamInstance({ studentId: S, examProfileId: profileId, examVersionId: exam.version_id, componentIds: comps.map((c: any) => c.id), mode: 'MOCK' });
      const started = await startExamInstance(inst.id, { language: 'es' });
      const sim = started.simulationAttemptId!;
      const row = await one(`SELECT ei.form_frozen_at, ei.assessment_snapshot IS NOT NULL AS snap, sa.simulation_type, sa.timing_mode, sa.navigation_state, sp.plan FROM exam_instances ei JOIN simulation_attempts sa ON sa.id = ei.simulation_attempt_id JOIN simulation_plans sp ON sp.id = sa.simulation_plan_id WHERE ei.id = $1`, [inst.id]);
      const served: { index: number; approvedItemId: string; section: string | null; objective: string; questionType: string; lineage: string; template: string; semantic: string; leak: string | null; feedback: unknown }[] = [];
      const breaks: (string | null)[] = [];
      for (let k = 0; k < 200; k++) {
        const next = await getNextSimulationItem(actor, sim);
        // the official breaks (after Redacción, after Matemáticas): the Student ends each one and goes on
        if (next.outcome === 'BREAK') { breaks.push(next.nextSectionName); await endSimulationBreak(actor, sim); continue; }
        if (next.outcome !== 'ITEM_READY') break;
        const state = (await one(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [sim])).navigation_state.items[String(next.targetIndex)];
        const approvedItemId = state?.item?.exam?.approvedItemId as string;
        const item = await one(`SELECT ai.content, ai.question_type, ai.template_fingerprint, ai.semantic_fingerprint, lo.code, qi.lineage_class, c.section_key FROM approved_items ai JOIN learning_objectives lo ON lo.id = ai.learning_objective_id LEFT JOIN question_bank_items qi ON qi.id = ai.bank_item_id LEFT JOIN assessment_components c ON c.id = $2 WHERE ai.id = $1`, [approvedItemId, state?.ctx?.assessmentComponentId ?? null]);
        served.push({ index: next.targetIndex, approvedItemId, section: item?.section_key ?? null, objective: item.code, questionType: item.question_type, lineage: item.lineage_class ?? 'NONE', template: item.template_fingerprint, semantic: item.semantic_fingerprint, leak: findAnswerKeyLeak(next), feedback: (next as any).feedback ?? null });
        const sub = await submitSimulationItemAnswer(actor, sim, answerOf(item.content), `paa-full:${label}:${sim}:${next.targetIndex}`, next.targetIndex);
        if ((sub as any)?.feedback || (sub as any)?.correctAnswer || (sub as any)?.explanation) served[served.length - 1].feedback = 'FEEDBACK_SHOWN';
      }
      await finalizeOpenItemsForSubmission(actor, sim);
      await completeSimulationAttempt(sim);
      await finalizeExamCompletion(sim, S, 'paa-full-length-scenario');
      const examAttemptId = (await getSimulationAttempt(sim))!.examAttemptId;
      const responses = (await db.query(`SELECT approved_item_id, score, max_score, review_status, grading_detail, evaluation_model_version FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [examAttemptId])).rows;
      return { row, served, examAttemptId, responses, breaks };
    };

    const a = await attempt('key', (c) => String(c.correctAnswer));
    check('F1  one MOCK instance of the whole test, frozen at start, stored as PREPARATION_MOCK (never FULL_MOCK / official)', !!a.row?.form_frozen_at && a.row?.snap && a.row?.simulation_type === 'PREPARATION_MOCK', `${a.row?.simulation_type}`);
    const served = a.served;
    const bySection = Object.keys(OFFICIAL).map((k) => `${k}:${served.filter((s) => s.section === k).length}`).join(' ');
    check('F2  PAA_FULL_FORM_ASSEMBLY: 175 of 175 positions served, every target at its count and question type', served.length === 175 && targets.every((t: any) => served.filter((s) => s.objective === t.code && (!t.question_type || s.questionType === t.question_type)).length >= t.required), `${served.length}/175; ${bySection}`);
    check('F3  PAA_FULL_NO_WITHIN_FORM_REPEATS: 175 distinct items, templates and wordings', new Set(served.map((s) => s.approvedItemId)).size === served.length && new Set(served.map((s) => s.template)).size === served.length && new Set(served.map((s) => s.semantic)).size === served.length, `${new Set(served.map((s) => s.template)).size} templates`);
    const order = served.map((s) => OFFICIAL[s.section ?? '']?.order ?? 0);
    check('F4  PAA_FULL_SECTION_ORDER: positions run Lectura -> Redacción -> Matemáticas -> Inglés', order.every((o, k) => o > 0 && (k === 0 || o >= order[k - 1])), [...new Set(served.map((s) => s.section))].join(' > '));
    check('F5  certified lineage only (CORE_DERIVED / PILOT_CERTIFIED): no LEGACY content in the form', served.every((s) => s.lineage === 'CORE_DERIVED' || s.lineage === 'PILOT_CERTIFIED'), [...new Set(served.map((s) => s.lineage))].join(','));
    check('F6  no answer key on the wire; no coach, no per-item feedback, no hints while answering', served.every((s) => s.leak === null && s.feedback === null) && a.row?.navigation_state?.itemFeedback !== 'AFTER_EACH_ITEM', `itemFeedback ${a.row?.navigation_state?.itemFeedback ?? 'n/a'}`);
    const sections = ((a.row?.plan?.sections ?? []) as any[]).sort((x, y) => x.order - y.order);
    check('F7  PAA_FULL_TIMING in the frozen plan: each section timed at its official minutes, in the official order', a.row?.timing_mode === 'OFFICIAL_SIMULATION_TIMED' && sections.map((x) => `${x.key}:${Number(x.durationSeconds) / 60}`).join(',') === 'lectura:50,redaccion:30,matematicas:60,ingles:40', `${a.row?.timing_mode}; ${sections.map((x) => `${x.key}:${Number(x.durationSeconds) / 60}`).join(',')}`);
    check('F8  the official breaks are held (after Redacción, after Matemáticas)', a.breaks.length === 2, `${a.breaks.length} breaks before ${a.breaks.join(', ')}`);
    const full = a.responses.every((r: any) => Number(r.score) === Number(r.max_score) && Number(r.max_score) > 0 && r.review_status === 'NONE' && !r.evaluation_model_version);
    check('S1  PAA_FULL_SCORING: keyed answers score full marks on every position (deterministic scorers, never a model)', a.responses.length === 175 && full, `${a.responses.filter((r: any) => Number(r.score) === Number(r.max_score)).length}/${a.responses.length}`);
    const b = await attempt('wrong', (c) => (Array.isArray(c.options) && c.options.length ? String(c.options.find((o: any) => o.id !== c.correctAnswer).id) : `${String(c.correctAnswer).includes('/') ? '1' : String(Number(c.correctAnswer) + 1)}`));
    check('S2  wrong answers score 0 on every position (no partial credit invented)', b.responses.length === 175 && b.responses.every((r: any) => Number(r.score) === 0), `${b.responses.filter((r: any) => Number(r.score) === 0).length}/${b.responses.length}`);
    const calls1 = await providerCalls();
    check('X1  PAA_FULL_RUNTIME_PROVIDER_CALLS = 0', calls0 !== -1 && calls1 - calls0 === 0, `${calls1 - calls0}`);
    check('X2  no Learning Plan entry was created', (await planEntries()) === plan0);
    const ks1 = await knowledge();
    check('X3  PAA_FULL_KS_ISOLATION: no Knowledge State row written', ks0 === -1 || ks1 === ks0, ks0 === -1 ? 'table not present' : `${ks0} -> ${ks1}`);
    const evidence = await n(`SELECT count(*)::int AS n FROM exam_readiness_evidence WHERE student_id = $1 AND evidence_class = 'EXAM_ASSESSMENT'`, [S]);
    const attributed = await n(`SELECT count(*)::int AS n FROM exam_readiness_evidence WHERE student_id = $1 AND system_id = 'PAA' AND exam_version_id = $2 AND exam_target_id IS NOT NULL`, [S, exam.version_id]);
    check('E1  PAA_FULL_EVIDENCE: every response is Exam Readiness evidence, attributed to PAA / this version / the target', evidence === a.responses.length + b.responses.length && attributed === evidence, `${evidence} rows; ${attributed} attributed`);
    check('E2  no Learning evidence row was written (separation)', (await n(`SELECT count(*)::int AS n FROM learning_evidence WHERE student_id = $1`, [S])) === 0);
    report.form = served.map((s) => ({ section: s.section, objective: s.objective, questionType: s.questionType, lineage: s.lineage }));
  } finally {
    const remaining = await cleanupFixtureStudent(db, S, actor).catch((e) => { console.error(e); return -1; });
    check('Z1  the fixture Student and everything of theirs is removed', remaining === 0, `${remaining} rows left`);
    report.results = results;
    if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    await db.end();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} PASS`);
  return failed === 0 ? 0 : 1;
}
main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });

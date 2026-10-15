/**
 * TRACK B -- ONE COMPLETE GOVERNED FORM, end to end in DEV, through the Exam Core services the Student routes call.
 *
 *   configuration + section (e.g. v2.cambridge.9709-as / p1)
 *   -> every blueprint objective of the section has certified, runtime-eligible Exam Bank supply (system-scoped)
 *   -> a PRACTICE instance of the WHOLE section (no focus) is created and frozen at start
 *   -> it serves exactly one position per blueprint objective; no answer key on the wire
 *   -> the Student answers every position: the keyed answer (run A) and a wrong value (run B)
 *   -> canonical scoring: run A full marks on every position, run B 0
 *   -> 0 question-provider calls; no Learning Plan entry; no Knowledge State row written by exam prep
 *
 * DEV ONLY. One clearly-marked fixture Student, removed at the end.
 *
 *   EXAM_BANK_PUBLICATION_FP=2a29b99ee14a22b4 npx tsx --env-file=<dev env> scripts/operations/exam-bank/governed-form-scenario.ts \
 *     --config v2.cambridge.9709-as --section p1 --system CAMBRIDGE [--out <json>]
 */
import { createHash, randomBytes } from 'crypto';
import { writeFileSync } from 'fs';

process.env.ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED = 'true';
process.env.QUESTION_BANK_READINESS_MODE = 'ENFORCE';
process.env.EXAM_BANK_DELIVERY_SCOPE = 'PILOT_PREVIEW';

const DEV = '2a29b99ee14a22b4';
const RUN = randomBytes(3).toString('hex');
const arg = (k: string): string | null => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = ''): void => { results.push({ id, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? `  [${detail}]` : ''}`); };

async function main(): Promise<number> {
  const CONFIG = arg('--config'); const SECTION = arg('--section'); const SYSTEM = arg('--system'); const out = arg('--out');
  if (!CONFIG || !SECTION || !SYSTEM) throw new Error('usage: --config <key> --section <key> --system <systemId>');
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${u.hostname}|${u.pathname.slice(1)}`).digest('hex').slice(0, 16);
  if (fp !== DEV || process.env.EXAM_BANK_PUBLICATION_FP !== fp) throw new Error(`REFUSING: database ${fp} is not DEV`);
  const { db } = await import('@/lib/db');
  const { getOrCreateCanonicalUser } = await import('@/lib/identity/canonical-user.service');
  const { upsertStudentFromWebhook } = await import('@/lib/auth');
  const { assignSelfServiceRole } = await import('@/lib/identity/role-assignment.service');
  const { createExamInstance, startExamInstance, ensureExamProfile } = await import('@/lib/exam-core/exam-instance.service');
  const { getNextSimulationItem, submitSimulationItemAnswer, finalizeOpenItemsForSubmission } = await import('@/lib/simulation/item-resolution.service');
  const { completeSimulationAttempt, getSimulationAttempt } = await import('@/lib/simulation/attempt.service');
  const { finalizeExamCompletion } = await import('@/lib/exam-core/post-completion');
  const { findAnswerKeyLeak } = await import('@/lib/exam-core/items');
  const { certifiedSupplySql } = await import('@/lib/exam-bank/delivery-scope');
  const { cleanupFixtureStudent } = await import('./fixture-cleanup');
  const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
  const n = async (sql: string, p: unknown[] = []) => Number((await one(sql, p))?.n ?? 0);

  const exam = await one(`SELECT d.id AS definition_id, v.id AS version_id FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED' WHERE d.config_key = $1`, [CONFIG]);
  check('C1  the configuration is published in DEV', !!exam, CONFIG);
  if (!exam) { await db.end(); return 1; }
  const comp = await one(`SELECT id FROM assessment_components WHERE exam_version_id = $1 AND section_key = $2`, [exam.version_id, SECTION]);
  const targets = (await db.query(`SELECT lo.id, lo.code, sum(t.target_count)::int AS required FROM blueprint_objective_targets t JOIN learning_objectives lo ON lo.id = t.learning_objective_id WHERE t.assessment_component_id = $1 GROUP BY lo.id, lo.code ORDER BY lo.code`, [comp.id])).rows;
  const supply = (await db.query(
    `SELECT ai.learning_objective_id AS lo, count(*)::int AS n FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id AND qi.current_version_id = ai.id JOIN assessment_item_instances i ON i.id = qi.item_instance_id
      WHERE ai.learning_objective_id = ANY($1::uuid[]) AND i.system_id = $2 AND EXISTS (SELECT 1 FROM student_eligible_item_instances_pilot e WHERE e.id = i.id) AND ${certifiedSupplySql('ai', 'PILOT_PREVIEW')}
      GROUP BY ai.learning_objective_id`, [targets.map((t: any) => t.id), SYSTEM])).rows;
  const supplyOf = (lo: string) => Number(supply.find((s: any) => s.lo === lo)?.n ?? 0);
  const required = targets.reduce((m: number, t: any) => m + Number(t.required), 0);
  check('C2  every blueprint objective of the section has certified, pilot-eligible supply of this system', targets.length > 0 && targets.every((t: any) => supplyOf(t.id) >= Number(t.required)), targets.map((t: any) => `${t.code}:${supplyOf(t.id)}/${t.required}`).join(' '));
  const report: Record<string, unknown> = { kind: 'GOVERNED_FORM_DEV', run: RUN, database: 'DEV', config: CONFIG, section: SECTION, system: SYSTEM, positionsRequired: required, supply: targets.map((t: any) => ({ objective: t.code, required: Number(t.required), certifiedEligible: supplyOf(t.id) })) };

  const clerk = `ebr-form-${RUN}`;
  const user = await getOrCreateCanonicalUser(clerk, `${clerk}@exam-bank.test`);
  const S = await upsertStudentFromWebhook(clerk, `${clerk}@exam-bank.test`, 'governed form scenario');
  const actor = user.id as string;
  await assignSelfServiceRole(clerk, actor, 'STUDENT');
  try {
    await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', 'governed form scenario') ON CONFLICT (id) DO NOTHING`, [S]);
    await db.query(`INSERT INTO student_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [S]);
    const questionCalls = async () => n(`SELECT count(*)::int AS n FROM ai_execution_events WHERE student_id = $1 AND capability = 'QUESTION_GENERATION'`, [S]);
    const planEntries = async () => n(`SELECT count(*)::int AS n FROM student_plan_entries WHERE student_id = $1`, [S]);
    const knowledge = async () => n(`SELECT count(*)::int AS n FROM concept_knowledge_state WHERE student_id = $1`, [S]).catch(() => -1);
    const plan0 = await planEntries(); const ks0 = await knowledge();
    const profileId = await ensureExamProfile(S, exam.definition_id, exam.version_id);

    /** One PRACTICE attempt of the whole section; every served position answered with `answerOf(item)`. */
    const attempt = async (label: string, answerOf: (content: any) => string) => {
      const inst = await createExamInstance({ studentId: S, examProfileId: profileId, examVersionId: exam.version_id, componentIds: [comp.id], mode: 'PRACTICE' });
      const started = await startExamInstance(inst.id, { language: 'en' });
      const frozen = await one(`SELECT form_frozen_at, assessment_snapshot FROM exam_instances WHERE id = $1`, [inst.id]);
      const sim = started.simulationAttemptId!;
      const served: { approvedItemId: string; objective: string | null; leak: string | null }[] = [];
      for (let k = 0; k < required + 5; k++) {
        const next = await getNextSimulationItem(actor, sim);
        if (next.outcome !== 'ITEM_READY') break;
        const state = (await one(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [sim])).navigation_state.items[String(next.targetIndex)];
        const approvedItemId = state?.item?.exam?.approvedItemId as string;
        const item = await one(`SELECT content, learning_objective_id FROM approved_items WHERE id = $1`, [approvedItemId]);
        served.push({ approvedItemId, objective: targets.find((t: any) => t.id === item?.learning_objective_id)?.code ?? null, leak: findAnswerKeyLeak(next) });
        await submitSimulationItemAnswer(actor, sim, answerOf(item.content), `form:${label}:${sim}:${next.targetIndex}`, next.targetIndex);
      }
      await finalizeOpenItemsForSubmission(actor, sim);
      await completeSimulationAttempt(sim);
      await finalizeExamCompletion(sim, S, 'governed-form-scenario');
      const examAttemptId = (await getSimulationAttempt(sim))!.examAttemptId;
      const responses = (await db.query(`SELECT approved_item_id, score, max_score, review_status, grading_detail FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [examAttemptId])).rows;
      return { frozen, served, examAttemptId, responses };
    };
    const calls0 = await questionCalls();
    const a = await attempt('key', (c) => String(c.correctAnswer));
    const objectives = new Set(a.served.map((s) => s.objective));
    check('F1  the whole-section PRACTICE instance is frozen at start (assessment snapshot)', !!a.frozen?.assessment_snapshot && !!a.frozen?.form_frozen_at);
    check('F2  it serves exactly one position per blueprint objective (the complete governed form)', a.served.length === required && targets.every((t: any) => a.served.filter((s) => s.objective === t.code).length === Number(t.required)), `${a.served.length}/${required} positions; ${[...objectives].join(', ')}`);
    check('F3  no answer key on the wire for any position', a.served.every((s) => s.leak === null));
    const full = a.responses.every((r: any) => Number(r.score) === Number(r.max_score) && Number(r.max_score) > 0 && r.review_status === 'NONE' && r.grading_detail?.contract === 'canonical-response-1');
    check('S1  keyed answers score full marks on every position, by the canonical contract', a.responses.length === required && full, a.responses.map((r: any) => `${r.score}/${r.max_score}`).join(' '));
    const b = await attempt('wrong', (c) => `${String(c.correctAnswer).includes('/') ? '1' : String(Number(c.correctAnswer) + 1)}`);
    check('S2  wrong values score 0 on every position (no partial credit invented)', b.responses.length === required && b.responses.every((r: any) => Number(r.score) === 0), b.responses.map((r: any) => `${r.score}/${r.max_score}`).join(' '));
    check('X1  0 question-provider calls', (await questionCalls()) - calls0 === 0);
    check('X2  no Learning Plan entry was created by exam prep', (await planEntries()) === plan0);
    const ks1 = await knowledge();
    check('X3  Knowledge State: no row written for the Student by exam prep', ks0 === -1 || ks1 === ks0, ks0 === -1 ? 'table not present' : `${ks0} -> ${ks1}`);
    report.attempts = [a, b].map((x) => ({ examAttemptId: x.examAttemptId, positions: x.served.map((s) => s.objective), scores: x.responses.map((r: any) => [Number(r.score), Number(r.max_score)]) }));
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

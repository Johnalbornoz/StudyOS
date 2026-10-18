/**
 * Candidate #14 -- DEV scenario for C13-P1-01 (PAA availability) and C13-P1-02 (Exam Readiness correctness), through the
 * real services the Student routes call. DEV ONLY (fingerprint guard). One clearly-marked fixture Student
 * (`ebr-c13-<run>`, `@exam-bank.test`), removed at the end.
 *
 *   EXAM_BANK_PUBLICATION_FP=2a29b99ee14a22b4 QUESTION_BANK_READINESS_MODE=ENFORCE EXAM_BANK_DELIVERY_SCOPE=PILOT_PREVIEW \
 *   STUDENT_CATALOG_EXPOSURE=PILOT npx tsx --env-file=<dev env> scripts/operations/exam-bank/c13-p1-dev-scenario.ts
 *
 * P1-01: a fresh PAA preparation created by the product path is bound to a governed form (exam_version_id set), and the
 *        availability cards are the same resolver the "Actividades disponibles" list reads -- before any attempt.
 * P1-02: after a practice of ONE section where only 6 positions are answered (2 correct), the preparation shows the STORED
 *        readiness status, coverage only where evidence exists (that section), and no recommendation outside it.
 *        DEV coverage note: on DEV only v2.paa `matematicas` has pilot-eligible certified supply (lectura / ingles: 0), so
 *        the single answered domain is Mathematics here (the candidate defect was Reading-only; the rule is the same).
 * Isolation: 0 question-provider calls, 0 Knowledge State / Learning evidence / Learning Plan rows.
 */
import { createHash, randomBytes } from 'crypto';

const DEV = '2a29b99ee14a22b4';
const RUN = randomBytes(3).toString('hex');
const SECTION = process.argv.includes('--section') ? process.argv[process.argv.indexOf('--section') + 1] : 'matematicas';
const PREFIX: Record<string, string> = { lectura: 'paa.lect', matematicas: 'paa.mat', ingles: 'paa.ing', redaccion: 'paa.red' };
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = ''): void => { results.push({ id, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? `  [${detail}]` : ''}`); };

async function main(): Promise<number> {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${u.hostname}|${u.pathname.slice(1)}`).digest('hex').slice(0, 16);
  if (fp !== DEV || process.env.EXAM_BANK_PUBLICATION_FP !== fp) throw new Error(`REFUSING: database ${fp} is not DEV`);
  const { db } = await import('@/lib/db');
  const { getOrCreateCanonicalUser } = await import('@/lib/identity/canonical-user.service');
  const { upsertStudentFromWebhook } = await import('@/lib/auth');
  const { assignSelfServiceRole } = await import('@/lib/identity/role-assignment.service');
  const { createObjectivePreparation, getPreparationView } = await import('@/lib/exam-core/objectives/preparation.service');
  const { preparationAttemptOptions } = await import('@/lib/exam-core/objectives/preparation-availability');
  const { createExamInstance, startExamInstance } = await import('@/lib/exam-core/exam-instance.service');
  const { getNextSimulationItem, submitSimulationItemAnswer, finalizeOpenItemsForSubmission } = await import('@/lib/simulation/item-resolution.service');
  const { completeSimulationAttempt } = await import('@/lib/simulation/attempt.service');
  const { finalizeExamCompletion } = await import('@/lib/exam-core/post-completion');
  const { cleanupFixtureStudent } = await import('./fixture-cleanup');
  const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
  const n = async (sql: string, p: unknown[] = []) => Number((await one(sql, p))?.n ?? 0);

  const clerk = `ebr-c13-${RUN}`;
  const user = await getOrCreateCanonicalUser(clerk, `${clerk}@exam-bank.test`);
  const S = await upsertStudentFromWebhook(clerk, `${clerk}@exam-bank.test`, 'c13 p1 scenario');
  const actor = user.id as string;
  await assignSelfServiceRole(clerk, actor, 'STUDENT');
  try {
    await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', 'c13 p1 scenario') ON CONFLICT (id) DO NOTHING`, [S]);
    await db.query(`INSERT INTO student_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [S]);
    const questionCalls = async () => n(`SELECT count(*)::int AS n FROM ai_execution_events WHERE student_id = $1 AND capability = 'QUESTION_GENERATION'`, [S]);
    const calls0 = await questionCalls();

    /* ------------------------------------------------------------------ C13-P1-01 */
    const created = await createObjectivePreparation(S, { objectiveKey: 'paa' });
    const profileRow = await one(`SELECT exam_definition_id, exam_version_id FROM student_exam_profiles WHERE id = $1`, [created.profile.id]);
    check('A1  a fresh PAA preparation (product path) is bound to a governed form at creation (no first attempt needed)', !!profileRow?.exam_version_id && !!profileRow?.exam_definition_id, `version ${String(profileRow?.exam_version_id ?? 'NULL').slice(0, 8)}`);
    const view0 = await getPreparationView(S, created.profile.id, 'es');
    const caps = view0!.capabilities;
    const cards = preparationAttemptOptions(caps, []);
    const card = (t: string) => cards.find((c) => c.type === t);
    const listPractice = caps.practiceModes.length > 0 && caps.canPractice;
    const listReduced = caps.reducedMocks.some((e) => e.mockAttemptType !== 'PREPARATION_MOCK');
    check('A2  before any attempt: the practice card and the Actividades list agree', (card('EXAM_PRACTICE')?.available ?? false) === listPractice, `card ${card('EXAM_PRACTICE')?.available} list ${listPractice}`);
    check('A3  before any attempt: the reduced-mock card and the Actividades list agree', (card('REDUCED_MOCK')?.available ?? false) === listReduced, `card ${card('REDUCED_MOCK')?.available} list ${listReduced}`);
    check('A4  practice is offered on a fresh preparation (not "No disponible" while the list offers it)', listPractice && card('EXAM_PRACTICE')?.available === true);

    /* ------------------------------------------------------------------ C13-P1-02 */
    const versionId = profileRow.exam_version_id as string;
    const comp = await one(`SELECT id FROM assessment_components WHERE exam_version_id = $1 AND section_key = $2`, [versionId, SECTION]);
    check(`B0  the bound form has the ${SECTION} section`, !!comp);
    if (!comp) return 1;
    const inst = await createExamInstance({ studentId: S, examProfileId: created.profile.id, examVersionId: versionId, componentIds: [comp.id], mode: 'PRACTICE' });
    const started = await startExamInstance(inst.id, { language: 'en' });
    const sim = started.simulationAttemptId!;
    let answered = 0;
    let correctGiven = 0;
    for (let k = 0; k < 6; k++) {
      const next = await getNextSimulationItem(actor, sim);
      if (next.outcome !== 'ITEM_READY') { console.log('next outcome', String((next as any).reason ?? next.outcome)); break; }
      const state = (await one(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [sim])).navigation_state.items[String(next.targetIndex)];
      const item = await one(`SELECT content FROM approved_items WHERE id = $1`, [state?.item?.exam?.approvedItemId]);
      const c = item.content;
      const right = correctGiven < 2;
      const answer = right ? String(c.correctAnswer) : String((Array.isArray(c.options) ? c.options.find((o: any) => o.id !== c.correctAnswer)?.id : null) ?? 'x');
      if (right) correctGiven++;
      await submitSimulationItemAnswer(actor, sim, answer, `c13:${sim}:${next.targetIndex}`, next.targetIndex);
      answered++;
    }
    await finalizeOpenItemsForSubmission(actor, sim);
    await completeSimulationAttempt(sim);
    await finalizeExamCompletion(sim, S, 'c13-p1-dev-scenario');
    // what POST /api/simulation/attempts/[id]/complete runs in after(): the stored readiness snapshot of this attempt's version
    const { computeReadinessSnapshot } = await import('@/lib/readiness/readiness.service');
    await computeReadinessSnapshot({ studentId: S, examProfileId: created.profile.id, examVersionId: versionId });
    check(`B1  6 ${SECTION} positions answered (2 correct), the rest of the section left unanswered`, answered === 6 && correctGiven === 2);
    const scored = await n(`SELECT count(*)::int AS n FROM exam_readiness_evidence WHERE student_id = $1 AND status = 'SCORED'`, [S]);
    check('B2  Exam Readiness evidence exists only for the answered positions', scored === 6, `${scored} SCORED rows`);
    const snap = await one(`SELECT overall_status FROM readiness_snapshots WHERE exam_profile_id = $1 ORDER BY calculated_at DESC LIMIT 1`, [created.profile.id]);
    const view1 = await getPreparationView(S, created.profile.id, 'es');
    check('B3  the preparation shows the STORED readiness status (never recomputed / never "needs reinforcement" by default)', !!snap && view1!.readiness?.overallStatus === snap.overall_status, `stored ${snap?.overall_status ?? 'none'} shown ${view1!.readiness?.overallStatus ?? 'none'}`);
    const reqs = view1!.plan?.requirements ?? [];
    const evidenced = reqs.filter((r) => r.hasEvidence);
    check(`B4  coverage counts only requirements with evidence -- all of them ${SECTION} (no unanswered domain shown as evidenced)`, evidenced.length > 0 && evidenced.every((r) => r.code.startsWith(PREFIX[SECTION])) && view1!.plan!.coverage.mappedWithEvidence < view1!.plan!.coverage.mapped, `${view1!.plan!.coverage.mappedWithEvidence}/${view1!.plan!.coverage.mapped}; ${evidenced.map((r) => r.code).join(',')}`);
    const conceptRecs = (view1!.plan?.recommendations ?? []).filter((r) => r.recommendation.action === 'ADD_TO_PLAN' || r.recommendation.action === 'CONTINUE_CONCEPT');
    check(`B5  no concept recommendation for an unanswered domain (only ${SECTION} answered)`, conceptRecs.every((r) => r.code.startsWith(PREFIX[SECTION])), conceptRecs.map((r) => r.code).join(',') || 'none');

    /* ------------------------------------------------------------------ isolation */
    check('X1  0 question-provider calls', (await questionCalls()) - calls0 === 0);
    check('X2  Exam Prep wrote no Learning evidence / Knowledge State / Learning Plan entry', (await n(`SELECT count(*)::int AS n FROM learning_evidence WHERE student_id = $1`, [S])) === 0
      && (await n(`SELECT count(*)::int AS n FROM concept_knowledge_state WHERE student_id = $1`, [S]).catch(() => 0)) === 0
      && (await n(`SELECT count(*)::int AS n FROM student_plan_entries WHERE student_id = $1`, [S])) === 0);
  } finally {
    const remaining = await cleanupFixtureStudent(db, S, actor).catch((e: any) => { console.error(e); return -1; });
    check('Z1  the fixture Student and everything of theirs is removed', remaining === 0, `${remaining} rows left`);
    await db.end();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} PASS`);
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });

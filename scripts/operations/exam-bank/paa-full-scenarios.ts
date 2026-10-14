/**
 * TRACK B -- the four PAA components over the PERSISTED Certified Exam Bank: section practice for Lectura, Redacción
 * and Inglés (generated, automatically certified for the pilot) and the four-component reduced practice mock.
 * Drives real attempts through the Exam Core services. One fixture Student (`ebr-<run>`), removed at the end.
 *
 *   EXAM_BANK_PUBLICATION_FP=4c249c68e0627b9f npx tsx --env-file=<candidate env> scripts/operations/exam-bank/paa-full-scenarios.ts
 */
import { createHash, randomBytes } from 'crypto';

process.env.ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED = 'true';
process.env.QUESTION_BANK_READINESS_MODE = 'ENFORCE';
process.env.EXAM_BANK_DELIVERY_SCOPE = 'PILOT_PREVIEW';
const TARGETS: Readonly<Record<string, string>> = { '4c249c68e0627b9f': 'PREVIEW_TRACK_B' };
const RUN = randomBytes(3).toString('hex');
const results: boolean[] = [];
const check = (id: string, ok: boolean, detail = ''): void => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`); };

async function main(): Promise<void> {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  if (!TARGETS[fp] || process.env.EXAM_BANK_PUBLICATION_FP !== fp) throw new Error(`REFUSING: database ${fp} is not an authorised target`);
  const { db } = await import('@/lib/db');
  const { getOrCreateCanonicalUser } = await import('@/lib/identity/canonical-user.service');
  const { upsertStudentFromWebhook } = await import('@/lib/auth');
  const { resolveExamLevel } = await import('@/lib/exam-core/catalog/structure.service');
  const { createExamInstance, startExamInstance, ensureExamProfile, getExamInstance } = await import('@/lib/exam-core/exam-instance.service');
  const { getNextSimulationItem, submitSimulationItemAnswer, finalizeOpenItemsForSubmission, revealSimulationItemStrategy } = await import('@/lib/simulation/item-resolution.service');
  const { completeSimulationAttempt } = await import('@/lib/simulation/attempt.service');
  const { finalizeExamCompletion } = await import('@/lib/exam-core/post-completion');
  const { findAnswerKeyLeak } = await import('@/lib/exam-core/items');
  const { enrollCanonicalConcept } = await import('@/lib/learning-plan/personal-plan.service');
  const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
  const n = async (sql: string, p: unknown[] = []) => Number((await one(sql, p))?.n ?? 0);
  const paa = await one(`SELECT d.id AS definition_id, v.id AS version_id FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED' WHERE d.config_key = 'v2.paa'`);
  const comps = (await db.query(`SELECT id, section_key FROM assessment_components WHERE exam_version_id = $1 ORDER BY sequence_order NULLS LAST`, [paa.version_id])).rows as { id: string; section_key: string }[];
  const compOf = (k: string) => comps.find((c) => c.section_key === k)!.id;
  const clerk = `ebr-${RUN}`;
  const user = await getOrCreateCanonicalUser(clerk, `${clerk}@exam-bank.test`);
  const S = await upsertStudentFromWebhook(clerk, `${clerk}@exam-bank.test`, 'paa full cert');
  const actor = user.id as string;
  const { assignSelfServiceRole } = await import('@/lib/identity/role-assignment.service');
  await assignSelfServiceRole(clerk, actor, 'STUDENT');
  try {
    await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', 'paa full cert') ON CONFLICT (id) DO NOTHING`, [S]);
    await db.query(`INSERT INTO student_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [S]);
    // the Student owns the concepts the pilot items are OF, so that a result has a concept to be evidence of
    const concepts = (await db.query(`SELECT DISTINCT ic.canonical_concept_id AS id FROM question_bank_item_concepts ic JOIN question_bank_items qi ON qi.current_version_id = ic.approved_item_id WHERE qi.exam_version_id = $1 AND ic.role = 'PRIMARY'`, [paa.version_id])).rows as { id: string }[];
    for (const c of concepts) await enrollCanonicalConcept(S, c.id, { type: 'SELF_SELECTED', actorUserId: null }, null).catch(() => undefined);
    const profileId = await ensureExamProfile(S, paa.definition_id, paa.version_id);
    const evidenceOf = async (examAttemptId: string) => (await db.query(`SELECT metadata FROM learning_evidence WHERE student_id = $1 AND (metadata->'assessment'->>'examAttemptId' = $2 OR metadata->'context'->>'examAttemptId' = $2 OR metadata::text LIKE '%' || $2 || '%')`, [S, examAttemptId])).rows as any[];

    const drive = async (simId: string, wrongEvery = 0) => {
      const out = { delivered: 0, leak: null as string | null, ids: [] as string[], sections: [] as string[], stimuli: [] as (string | null)[], optionOrders: [] as string[], coached: 0, revealRefused: 0, shuffledAwayFromStored: 0, choice: 0, answersById: 0 };
      for (let guard = 0; guard < 80; guard += 1) {
        const next = await getNextSimulationItem(actor, simId);
        if (next.outcome === 'COMPLETE') break;
        if (next.outcome === 'BREAK') { const { endSimulationBreak } = await import('@/lib/simulation/item-resolution.service'); await endSimulationBreak(actor, simId); continue; }
        if (next.outcome !== 'ITEM_READY') throw new Error(`unexpected ${next.outcome} at ${(next as any).targetIndex}: ${(next as any).reason ?? ''}`);
        out.leak = out.leak ?? findAnswerKeyLeak(next);
        const state = (await one(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [simId])).navigation_state.items[String(next.targetIndex)];
        const item = state.item;
        out.ids.push(item.exam.approvedItemId); out.sections.push(next.section.key); out.stimuli.push(next.question.stimulus?.key ?? null);
        if (next.coach) out.coached += 1;
        try { await revealSimulationItemStrategy(actor, simId, next.targetIndex); } catch { out.revealRefused += 1; }
        let answer: string;
        if (item.answerFormat === 'single_choice') {
          out.choice += 1;
          const shown = (next.question.options ?? []).map((o: any) => o.id);
          out.optionOrders.push(shown.join(','));
          if (shown.join(',') !== (item.options ?? []).map((o: any) => o.id).join(',')) out.shuffledAwayFromStored += 1;
          const wrong = wrongEvery > 0 && out.delivered % wrongEvery === 0;
          answer = wrong ? shown.find((id: string) => id !== item.correctAnswer) : item.correctAnswer;
          if (shown.includes(item.correctAnswer)) out.answersById += 1;
        } else answer = String(item.exam.acceptableAnswers?.[0] ?? item.correctAnswer);
        await submitSimulationItemAnswer(actor, simId, answer, `ebr:${simId}:${next.targetIndex}`, next.targetIndex);
        out.delivered += 1;
      }
      return out;
    };
    const finish = async (simId: string) => { await finalizeOpenItemsForSubmission(actor, simId); await completeSimulationAttempt(simId); return finalizeExamCompletion(simId, S, 'paa-full-scenarios'); };
    const pilotFacts = async (ids: string[]) => { const r = (await db.query(`SELECT ai.id, qi.lineage_class, qi.provenance, EXISTS (SELECT 1 FROM exam_bank_pilot_deliverable_versions d WHERE d.approved_item_id = ai.id) AS deliverable, EXISTS (SELECT 1 FROM student_eligible_item_instances_pilot e WHERE e.id = qi.item_instance_id) AS core FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE ai.id = ANY($1::uuid[])`, [ids])).rows as any[]; return { all: r.length === new Set(ids).size, certified: r.every((x) => (x.lineage_class === 'PILOT_CERTIFIED' && x.deliverable) || (x.lineage_class === 'CORE_DERIVED' && x.core)), pilot: r.filter((x) => x.lineage_class === 'PILOT_CERTIFIED').length }; };

    /* ---------------------------------------------- section practice ---------------------------------------------- */
    const expected: Record<string, number> = { lectura: 10, redaccion: 6, ingles: 8 };
    const used: string[] = [];
    for (const section of ['lectura', 'redaccion', 'ingles']) {
      const level = await resolveExamLevel(`paa.practice.${section}`, 'es');
      check(`${section} C1  the catalogue offers practice for the section (bank-derived readiness)`, !!level && level.modes.includes('PRACTICE'), level ? `modes ${level.modes.join(',')}` : 'no level');
      const inst = await createExamInstance({ studentId: S, examProfileId: profileId, examVersionId: paa.version_id, componentIds: [compOf(section)], mode: 'PRACTICE' });
      const sim = (await startExamInstance(inst.id, { language: 'es' })).simulationAttemptId!;
      const run = await drive(sim, 4);
      await finish(sim);
      const facts = await pilotFacts(run.ids);
      const examAttempt = (await one(`SELECT exam_attempt_id FROM simulation_attempts WHERE id = $1`, [sim])).exam_attempt_id as string;
      const score = await one(`SELECT count(*)::int AS n, sum(score)::float AS earned, sum(max_score)::float AS available FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [examAttempt]);
      const wrong = Math.ceil(expected[section] / 4);
      check(`${section} P1  ${expected[section]} positions, every one a certified pilot item of the Exam Bank, none repeated`, run.delivered === expected[section] && facts.all && facts.certified && facts.pilot === run.delivered, `${run.delivered} delivered, ${facts.pilot} pilot-certified`);
      check(`${section} P2  selected response: four options shown in an attempt-own order, answered and scored by option id`, run.choice === run.delivered && run.answersById === run.delivered && run.shuffledAwayFromStored > 0 && Number(score.earned) === run.delivered - wrong && Number(score.available) === run.delivered, `${run.shuffledAwayFromStored}/${run.delivered} shown in another order than stored; ${score.earned}/${score.available} with ${wrong} deliberately wrong`);
      check(`${section} P3  no answer key reaches the client`, run.leak === null, run.leak ?? '');
      if (section !== 'ingles') check(`${section} P4  every item is read against its frozen stimulus`, run.stimuli.every((k) => !!k && /^stim\.paa\./.test(k)), `${new Set(run.stimuli).size} stimuli`);
      else check('ingles P4  reading items carry their stimulus; language and writing items are self-contained', run.stimuli.filter(Boolean).length === 3, `${run.stimuli.filter(Boolean).length} with a stimulus`);
      const ev = await evidenceOf(examAttempt);
      check(`${section} P5  evidence is EXAM_ASSESSMENT of the standardized exam, one per response`, ev.length === run.delivered && ev.every((e) => e.metadata?.assessment?.supply?.evidenceClass === 'EXAM_ASSESSMENT' && e.metadata?.assessment?.supply?.family === 'STANDARDIZED_EXAM'), `${ev.length} rows`);
      check(`${section} P6  exposure is recorded`, (await n(`SELECT count(DISTINCT approved_item_id)::int AS n FROM exam_item_usage WHERE student_id = $1 AND approved_item_id = ANY($2::uuid[])`, [S, run.ids])) === run.delivered);
      used.push(...run.ids);
    }

    /* ---------------------------------------------- catalogue + diagnostic ---------------------------------------------- */
    {
      const { startPreparationDiagnostic } = await import('@/lib/exam-core/objectives/preparation.service');
      let diag: any = null; let diagError = '';
      try { diag = await startPreparationDiagnostic(S, profileId); } catch (e: any) { diagError = String(e?.message ?? e); }
      const diagComps = diag ? (await one(`SELECT component_ids FROM exam_instances WHERE id = $1`, [diag.instanceId]))?.component_ids ?? [] : [];
      check('D1  "Diagnosticar mi preparación" starts: it reads the same bank-derived readiness the button is offered on', !!diag && diagComps.length === 4, diag ? `${diagComps.length} components, ${diag.instance?.status}` : diagError);
      if (diag) await db.query(`UPDATE exam_instances SET status = 'CANCELLED' WHERE id = $1 AND status IN ('DRAFT', 'READY')`, [diag.instanceId]).catch(() => undefined);
      const fullLevel = await resolveExamLevel('paa.full', 'es');
      check('D2  the catalogue does not offer a Challenge without calibrated difficulty', !!fullLevel && !fullLevel.modes.includes('CHALLENGE'), fullLevel ? `modes ${fullLevel.modes.join(',')}` : 'no level');
    }

    /* ---------------------------------------------- four-component practice mock ---------------------------------------------- */
    const full = await resolveExamLevel('paa.full', 'es');
    check('M0  the catalogue offers the four-component mock', !!full && full.modes.includes('MOCK'), full ? `modes ${full.modes.join(',')}` : 'no level');
    const mock = await createExamInstance({ studentId: S, examProfileId: profileId, examVersionId: paa.version_id, componentIds: comps.map((c) => c.id), mode: 'MOCK' });
    const mockRow = (await getExamInstance(mock.id)) as any;
    const slots = (mockRow.form?.slots ?? []) as any[];
    check('M1  the mock freezes a complete 36-position form from the certified bank', mockRow.status === 'READY' && slots.length === 36 && slots.every((s) => !!s.approvedItemId), `${slots.filter((s) => s.approvedItemId).length}/${slots.length} positions`);
    const mStarted = await startExamInstance(mock.id, { language: 'es' });
    const mSim = mStarted.simulationAttemptId!;
    const mType = (await one(`SELECT simulation_type FROM simulation_attempts WHERE id = $1`, [mSim])).simulation_type;
    check('M2  it is a REDUCED mock -- never a full official one', mType === 'REDUCED_MOCK', String(mType));
    const mRun = await drive(mSim);
    await finish(mSim);
    const perSection = mRun.sections.reduce((m: Record<string, number>, k) => { m[k] = (m[k] ?? 0) + 1; return m; }, {});
    const mFacts = await pilotFacts(mRun.ids);
    check('M3  36 delivered: Lectura 10, Redacción 6, Matemáticas 12, Inglés 8 -- the frozen form, all certified', mRun.delivered === 36 && JSON.stringify(mRun.ids) === JSON.stringify(slots.map((s) => s.approvedItemId)) && mFacts.certified && perSection.lectura === 10 && perSection.redaccion === 6 && perSection.matematicas === 12 && perSection.ingles === 8, JSON.stringify(perSection));
    check('M4  no coach, no target, no strategy while the mock runs; every reveal is refused', mRun.coached === 0 && mRun.revealRefused === 36, `${mRun.coached} coached, ${mRun.revealRefused} refused`);
    const groups = mRun.stimuli.reduce((acc: string[], k) => { if (k && acc[acc.length - 1] !== k) acc.push(k); return acc; }, []);
    // INFO, not a gate: the frozen form places each item at its blueprint position, so items of one stimulus are not
    // guaranteed to be adjacent. Every question shows its own stimulus. Known limitation, recorded in the pilot status.
    console.log(`INFO  mock stimuli: ${new Set(mRun.stimuli.filter(Boolean)).size} distinct, in ${groups.length} runs`);
    const mExam = (await one(`SELECT exam_attempt_id FROM simulation_attempts WHERE id = $1`, [mSim])).exam_attempt_id as string;
    const mScore = await one(`SELECT count(*)::int AS n, sum(score)::float AS earned, sum(max_score)::float AS available FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [mExam]);
    const mEv = await evidenceOf(mExam);
    check('M6  scored 36 of 36 by option identity / numeric key; evidence EXAM_ASSESSMENT', Number(mScore.n) === 36 && Number(mScore.earned) === 36 && mEv.length > 0 && mEv.every((e) => e.metadata?.assessment?.supply?.evidenceClass === 'EXAM_ASSESSMENT'), `${mScore.earned}/${mScore.available}; ${mEv.length} evidence rows`);
    check('M7  exposure of the 36 is recorded', (await n(`SELECT count(DISTINCT approved_item_id)::int AS n FROM exam_item_usage WHERE student_id = $1 AND approved_item_id = ANY($2::uuid[])`, [S, mRun.ids])) === 36);
    check('X1  no provider was asked for anything during the six attempts', (await n(`SELECT count(*)::int AS n FROM ai_execution_events WHERE student_id = $1`, [S])) === 0);
    check('X2  a deployment that is not a pilot delivers none of the pilot-certified supply', (await n(`SELECT count(*)::int AS n FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE qi.lineage_class = 'PILOT_CERTIFIED' AND ${(await import('@/lib/exam-bank/delivery-scope')).certifiedSupplySql('ai', 'PRODUCTION')}`)) === 0);
  } finally {
    const { cleanupFixtureStudent } = await import('./fixture-cleanup');
    const remaining = await cleanupFixtureStudent(db, S, actor);
    check('CLEANUP  the fixture Student and everything of theirs is removed', remaining === 0, `remaining rows ${remaining}`);
    await db.end();
  }
  console.log(`RESULT ${results.filter(Boolean).length}/${results.length}`);
  process.exit(results.every(Boolean) ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

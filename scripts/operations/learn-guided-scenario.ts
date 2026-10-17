/**
 * LEARN guided understanding (operator rule 2026-10-16) -- DEV scenario with the REAL services, the REAL
 * provider and the DEV database.
 *
 *   A  every answer correct          -> the AI may close from interaction 4 (expected: closedBy AI at 4)
 *   B  wrong answers at 3 and 4      -> no close at 4 (a wrong answer is always followed by another interaction)
 *   C  every answer wrong            -> CAP at 7 (closedBy CAP), weaknesses recorded
 *   E  exactly one learning_evidence row per session, contract 1.1 shape; nothing in mastery_records
 *   P  the latest LEARN weaknesses are what a canonical PRACTICE generation receives as extra guidance;
 *      P2/P3 (requirement §22): the shared accessor + a bank-delivered PRACTICE records BANK_PRIORITY provenance (0 AI calls)
 *
 * Learning runtime provider usage is allowed (this is Learning, not a standardized exam). DEV only.
 * The fixture Student (`cfl-lg-<run>`) and everything that references it are removed at the end.
 *   CURRICULUM_CONVERGENCE_FP=2a29b99ee14a22b4 npx tsx --env-file=<dev env> scripts/operations/learn-guided-scenario.ts
 */
import { createHash, randomBytes } from 'crypto';

process.env.CANONICAL_ENGINE_V1_ENABLED = 'true';
const DEV = '2a29b99ee14a22b4';
const RUN = randomBytes(3).toString('hex');
const results: { id: string; ok: boolean }[] = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};
const info = (line: string) => console.log(`INFO  ${line}`);

async function main() {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  if (fp !== DEV || process.env.CURRICULUM_CONVERGENCE_FP !== fp) throw new Error(`REFUSING: database ${fp} (DEV only)`);
  const { db } = await import('@/lib/db');
  const { enrollCanonicalConcept } = await import('@/lib/learning-plan/personal-plan.service');
  const { getCanonicalPedagogicalDecision } = await import('@/lib/pedagogical-decision/canonical-decision.service');
  const { resolveCanonicalLaunch } = await import('@/lib/pedagogical-decision/canonical-session-launch');
  const svc = await import('@/services/learn-guided.service');
  const { practiceGuidanceWithLearnWeaknesses, LEARN_GUIDED_QUIZ_MODE } = await import('@/lib/learn-guided/policy');
  const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
  console.log(`learn-guided scenario -- db ${fp} -- run ${RUN}`);

  const S = (await one(`INSERT INTO students (clerk_id, email, name, language) VALUES ($1, $2, 'cfl learn-guided', 'es') RETURNING id`, [`cfl-lg-${RUN}`, `cfl-lg-${RUN}@curriculum-first.test`])).id as string;
  try {
    await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', 'cfl learn-guided')`, [S]);
    await db.query(`INSERT INTO student_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [S]);
    const concepts: Array<{ learner: string; name: string }> = [];
    for (const name of ['Fracciones', 'Porcentajes', 'Ecuaciones lineales']) {
      const cc = await one(`SELECT cc.id FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id WHERE cs.name = 'Matemáticas' AND cc.name = $1 AND cc.status = 'ACTIVE'`, [name]);
      const e = await enrollCanonicalConcept(S, cc.id, { type: 'SELF_SELECTED', actorUserId: null }, null);
      concepts.push({ learner: e.learnerConceptId, name });
    }
    const subjectId = (await one(`SELECT subject_id FROM concepts WHERE id = $1`, [concepts[0].learner])).subject_id as string;
    // enrollment may seed mastery rows; LEARN must not change them
    const masterySnapshot = async () => JSON.stringify((await db.query(`SELECT concept_id, mastery_score, updated_at FROM mastery_records WHERE student_id = $1 ORDER BY concept_id`, [S])).rows);
    const masteryBefore = await masterySnapshot();

    // The canonical LEARN launch now targets the guided page.
    const d0 = (await getCanonicalPedagogicalDecision({ studentId: S, conceptId: concepts[0].learner })).decision;
    const launch = resolveCanonicalLaunch({ subjectId, conceptId: concepts[0].learner, decision: d0 });
    check('L0  a new concept is at LEARN (executable) and its canonical launch is the guided page', d0.stage === 'LEARN' && d0.actionState === 'EXECUTABLE' && !!launch.launchTarget?.startsWith('/dashboard/learn/guided?'), `${d0.stage}/${d0.actionState} -> ${launch.launchTarget}`);

    // a correct / wrong answer for the pending interaction, read from the server-side record (the client never has it)
    const pendingQuestion = async (sessionId: string) => {
      const r = await one(`SELECT questions FROM quiz_sessions WHERE id = $1`, [sessionId]);
      const qs = r.questions as any[];
      return qs[qs.length - 1].question as { answerFormat: string; correctAnswer: string; options?: { id: string }[] };
    };
    const answerFor = (q: { answerFormat: string; correctAnswer: string; options?: { id: string }[] }, correct: boolean) =>
      correct ? q.correctAnswer : q.answerFormat === 'single_choice' ? (q.options ?? []).find((o) => o.id !== q.correctAnswer)?.id ?? 'zzz' : 'No lo sé, creo que no tiene relación con nada de esto.';

    const runSession = async (conceptId: string, plan: (n: number) => boolean) => {
      const started = await svc.startGuidedLearnSession({ studentId: S, subjectId, conceptId, language: 'es' });
      if (!started.ok) return { ok: false as const, reason: started.code };
      const sessionId = started.sessionId;
      const turns: Array<{ n: number; answeredCorrect: boolean; graded: boolean; closed: boolean; closedBy: string | null; feedback: any }> = [];
      for (let n = 1; n <= 8; n++) {
        const q = await pendingQuestion(sessionId);
        const intended = plan(n);
        let t = await svc.submitGuidedLearnTurn({ studentId: S, sessionId, answer: answerFor(q, intended) });
        if (!t.ok && t.code === 'GENERATION_FAILED') t = await svc.submitGuidedLearnTurn({ studentId: S, sessionId, answer: answerFor(q, intended) });
        if (!t.ok) return { ok: false as const, reason: `turn ${n}: ${t.code}` };
        turns.push({ n, answeredCorrect: intended, graded: t.correct, closed: t.closed, closedBy: t.closedBy, feedback: t.feedback });
        if (t.closed) return { ok: true as const, sessionId, turns, final: t };
      }
      return { ok: false as const, reason: 'never closed' };
    };
    const evidenceOf = async (sessionId: string) => (await db.query(`SELECT source_type, result, ai_assistance_type, hints_used, score_percent, metadata FROM learning_evidence WHERE operation_key = $1`, [`LEARN_GUIDED:${sessionId}`])).rows as any[];
    const contractShape = (m: any, n: number, closedBy: string) =>
      m?.activityType === 'LEARN_CHECK' && m.evidenceMode === 'PRACTICE' && m.independenceEligible === false &&
      m.learnSession?.version === 'learn-guided-v1' && m.learnSession.interactionCount === n && m.learnSession.closedBy === closedBy &&
      Array.isArray(m.learnSession.weaknesses) && m.learnSession.weaknesses.every((w: unknown) => typeof w === 'string') &&
      (m.learnSession.misconceptionIds === undefined || Array.isArray(m.learnSession.misconceptionIds));

    /* ---------------------------------------------- A: all correct ---------------------------------------------- */
    const A = await runSession(concepts[0].learner, () => true);
    if (A.ok) {
      const n = A.turns.length;
      check('A1  every answer correct is graded correct with immediate feedback each turn', A.turns.every((t) => t.graded && t.feedback?.verdict === 'CORRECT' && !!t.feedback.reinforcement), A.turns.map((t) => (t.graded ? 'C' : 'x')).join(''));
      check('A2  the AI closes between 4 and 7 (expected 4)', A.final.closedBy === 'AI' && n >= 4 && n <= 7, `closed at ${n} by ${A.final.closedBy}`);
      if (n !== 4) info(`A: the model kept LEARN open past 4 (closed at ${n}) -- an AI judgement, inside the bounds`);
      const ev = await evidenceOf(A.sessionId);
      check('A3  exactly one evidence row, contract 1.1 shape, assisted (never independent)', ev.length === 1 && ev[0].source_type === 'LEARN_GUIDED' && ev[0].ai_assistance_type === 'TUTOR_GUIDANCE' && contractShape(ev[0].metadata, n, 'AI'), JSON.stringify(ev[0]?.metadata?.learnSession ?? null));
    } else check('A   all-correct session', false, A.reason);

    /* ---------------------------------------------- B: wrong at 3 and 4 ---------------------------------------------- */
    const B = await runSession(concepts[1].learner, (n) => !(n === 3 || n === 4));
    if (B.ok) {
      const n = B.turns.length;
      const wrong = B.turns.find((t) => !t.graded);
      check('B1  a wrong answer gets the full corrective feedback (what was wrong + key idea)', !!wrong && wrong.feedback.verdict !== 'CORRECT' && !!wrong.feedback.whatWasWrong && !!wrong.feedback.reinforcement, JSON.stringify(wrong?.feedback ?? null).slice(0, 300));
      check('B2  no close at 4 after a wrong 4th answer: LEARN extends (5..7)', n >= 5 && n <= 7, `closed at ${n} by ${B.final.closedBy}; graded ${B.turns.map((t) => (t.graded ? 'C' : 'x')).join('')}`);
      const ev = await evidenceOf(B.sessionId);
      check('B3  exactly one evidence row with the detected weaknesses', ev.length === 1 && contractShape(ev[0].metadata, n, B.final.closedBy!) && ev[0].metadata.learnSession.weaknesses.length > 0, JSON.stringify(ev[0]?.metadata?.learnSession ?? null));
    } else check('B   mixed session', false, B.reason);

    /* ---------------------------------------------- C: all wrong -> CAP ---------------------------------------------- */
    const C = await runSession(concepts[2].learner, () => false);
    if (C.ok) {
      check('C1  every answer wrong -> CAP at 7', C.turns.length === 7 && C.final.closedBy === 'CAP' && C.turns.slice(0, 6).every((t) => !t.closed), `closed at ${C.turns.length} by ${C.final.closedBy}`);
      const ev = await evidenceOf(C.sessionId);
      check('C2  exactly one evidence row, CAP, interactionCount 7, weaknesses kept; no score gate (diagnostic score only)', ev.length === 1 && contractShape(ev[0].metadata, 7, 'CAP') && ev[0].metadata.learnSession.weaknesses.length > 0, `score ${ev[0]?.score_percent} weaknesses ${JSON.stringify(ev[0]?.metadata?.learnSession?.weaknesses ?? null)}`);
      const replay = await svc.submitGuidedLearnTurn({ studentId: S, sessionId: C.sessionId, answer: 'x' });
      check('C3  a retried final turn returns the stored outcome and writes nothing', replay.ok && replay.alreadyClosed === true && (await evidenceOf(C.sessionId)).length === 1);

      /* ---------------------------------------------- P: carried into PRACTICE ---------------------------------------------- */
      const weaknesses = await svc.loadLatestLearnWeaknesses(S, concepts[2].learner);
      const guidance = practiceGuidanceWithLearnWeaknesses('BASE', weaknesses);
      check('P1  the latest LEARN weaknesses are read back for PRACTICE generation guidance', weaknesses.length > 0 && weaknesses.every((w) => guidance.includes(w)), JSON.stringify(weaknesses));

      // P2/P3 (requirement §22): a PRACTICE delivered from the VALIDATED bank (0 AI calls) prioritises the item that
      // addresses the LEARN weakness and records `learnWeaknessProvenance` on the session. The v1 marker is a DEV
      // fixture (the delivery service never decides authority; the route verifies it before delivering).
      const { getLearnWeaknessesForConcept } = await import('@/services/learn-weakness.service');
      const { addValidatedCandidates } = await import('@/services/question-bank.service');
      const { loadAcademicContext } = await import('@/services/activity-delivery-context.service');
      const { buildDeliveryInput, deliverCanonicalActivity } = await import('@/services/activity-delivery.service');
      const { currentAiCallCount, runWithAiMetrics } = await import('@/lib/ai/request-metrics');
      const focus = await getLearnWeaknessesForConcept(S, concepts[2].learner);
      const learnEvidenceId = (await one(`SELECT id FROM learning_evidence WHERE operation_key = $1`, [`LEARN_GUIDED:${C.sessionId}`]))?.id ?? null;
      check('P2  the shared accessor returns the latest LEARN focus with its evidence id', !!focus && focus.weaknesses.length > 0 && focus.learnEvidenceIds.includes(String(learnEvidenceId)), JSON.stringify(focus));
      if (focus && weaknesses.length > 0) {
        const academic = await loadAcademicContext(S, subjectId);
        const mk = (i: number, type: string, question: string): any => ({
          id: `p2-${RUN}-${i}`, conceptId: concepts[2].learner, type, answerFormat: 'text', difficulty: 3, question, correctAnswer: 'x', explanation: 'Fixture explanation.',
        });
        const fixtures = [
          mk(0, 'short_answer', 'Resuelve 3x + 4 = 19 y comprueba el resultado.'),
          mk(1, 'numeric_problem', 'Un tren recorre 240 km en 3 horas. ¿Cuál es su velocidad media?'),
          mk(2, 'open_ended', 'Explica con tus palabras por qué al despejar se aplica la misma operación a ambos lados.'),
          mk(3, 'comparison', 'Compara 2(x - 1) = 8 con 2x - 1 = 8: ¿tienen la misma solución?'),
          mk(4, 'prediction', 'Si duplicas ambos miembros de una igualdad, ¿qué le pasa a la solución?'),
          mk(5, 'justification', `Practica este punto: ${weaknesses[0]}. Justifica cada paso.`),
        ];
        const banked = await addValidatedCandidates(fixtures, {
          studentId: S, conceptId: concepts[2].learner, activityType: 'PRACTICE', language: 'es', academic,
          generator: { provider: null, model: null, promptId: 'fixture', promptVersion: 'fixture', operationId: null },
        });
        const matchingCandidateId = banked.ids[5];
        const marker: any = {
          pedagogicalPolicyVersion: 'studyus-canonical-v1', canonicalRevision: `fixture-${RUN}`, canonicalStage: 'PRACTICE', canonicalActivityType: 'PRACTICE',
          itemCount: { min: 4, max: 4, authorized: 4 }, difficulty: { min: 2, max: 4, target: 3 }, assistanceAllowed: true, independence: false, supportLevel: 'ASSISTED', minimumScorePercent: 80,
        };
        const input = await buildDeliveryInput({ studentId: S, subjectId, conceptId: concepts[2].learner, quizMode: 'topic_practice', activityType: 'PRACTICE', v1Marker: marker, language: 'es', itemCount: 4 });
        const { delivery, ai } = await runWithAiMetrics('learn-guided-scenario P3', async () => ({ delivery: await deliverCanonicalActivity(input), ai: currentAiCallCount() }));
        const stored = delivery.status === 'DELIVERED' ? await one(`SELECT canonical_activity_contract->'learnWeaknessProvenance' AS p FROM quiz_sessions WHERE id = $1`, [delivery.quizId]) : null;
        const p = stored?.p;
        check(
          'P3  a bank-delivered PRACTICE prioritises the weakness item and records BANK_PRIORITY provenance (0 AI calls)',
          delivery.status === 'DELIVERED' && delivery.source === 'BANK' && delivery.questions.length === 4 && ai.executions + ai.providerCalls === 0 &&
            p?.appliedVia === 'BANK_PRIORITY' && p.learnEvidenceIds?.includes(String(learnEvidenceId)) && p.matchedItemIds?.includes(matchingCandidateId) &&
            JSON.stringify(p.weaknesses) === JSON.stringify(focus.weaknesses),
          JSON.stringify({ source: delivery.status === 'DELIVERED' ? delivery.source : delivery.status, ai, provenance: p ?? null }),
        );
        if (delivery.status === 'EMERGENCY_REQUIRED') await delivery.lock.release();
      }
      const after = (await getCanonicalPedagogicalDecision({ studentId: S, conceptId: concepts[2].learner })).decision;
      info(`after the CAP close the canonical decision reads ${after.stage}/${after.actionState} (advancing to PRACTICE depends on the ENGINE workstream reading learnSession)`);
    } else check('C   all-wrong session', false, C.reason);

    /* ---------------------------------------------- E: global ---------------------------------------------- */
    const counts = await one(
      `SELECT (SELECT count(*) FROM learning_evidence WHERE student_id = $1)::int AS evidence,
              (SELECT count(*) FROM learning_evidence WHERE student_id = $1 AND source_type = 'LEARN_GUIDED')::int AS learn,
              (SELECT count(*) FROM quiz_sessions WHERE student_id = $1 AND quiz_mode = $2 AND status = 'completed')::int AS closed`,
      [S, LEARN_GUIDED_QUIZ_MODE],
    );
    const expected = [A, B, C].filter((r) => r.ok).length;
    const masteryAfter = await masterySnapshot();
    check('E1  one LEARN_GUIDED row per closed session and no other evidence; mastery_records untouched', counts.learn === expected && counts.evidence === expected && counts.closed === expected && masteryAfter === masteryBefore, JSON.stringify(counts));
    const usage = await one(`SELECT count(*)::int AS calls, count(*) FILTER (WHERE status <> 'SUCCESS')::int AS failed FROM ai_execution_events WHERE student_id = $1`, [S]).catch(() => null);
    if (usage) info(`provider calls recorded for this Student (LEARNING_RUNTIME_USAGE): ${usage.calls} (${usage.failed} not successful)`);
  } finally {
    const { removeFixtureStudent } = await import('./curriculum-first-fixture-cleanup');
    const remaining = await removeFixtureStudent(db, S);
    check('CLEANUP  the fixture Student and everything of theirs is removed', remaining === 0, `remaining rows ${remaining}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS${failed.length ? ` -- FAILED: ${failed.map((f) => f.id).join(' | ')}` : ''}`);
  await db.end();
  if (failed.length) process.exit(2);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});

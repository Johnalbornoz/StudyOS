/**
 * APPLY -- adaptive transfer ladder (transfer-ladder-v1): runtime scenario with the REAL service, the REAL
 * provider (generation + canonical free-text grading) and a real database (DEV only).
 *
 *   R0  the REAL canonical decision of a fresh fixture is not TRANSFER/EXECUTABLE -> start refused, zero AI calls
 *   R1  an attempt (authorization stubbed to TRANSFER/EXECUTABLE, see below) with a "good" answer at every
 *       challenge except one deliberate wrong answer -> starts NEAR; certified passes move up; the failed
 *       challenge stays at the same level in a DIFFERENT context; never down; closes at FAR or 5
 *   R2  while the attempt is open the Tutor is restricted (active-evidence-guard) and hints are denied
 *   R3  ONE learning_evidence row with metadata.transferLadder exactly per contract 1.2, canonical attribution,
 *       independent (hints 0, ai_assistance NONE); every challenge has a transfer_task_instances row whose
 *       novelty_validation_passed equals the challenge's `certified`
 *
 * Authorization: a fixture cannot honestly reach canonical TRANSFER without a full LEARN..RETAIN history
 * (and the RETAIN spacing gate), so R1 injects a TRANSFER/EXECUTABLE decision; R0 proves the REAL decision
 * path refuses. Route-level authorization is covered by tests/unit/transfer-ladder-routes.test.ts.
 *
 * Fixture `cfl-apply-<run>` (curriculum-first convention) and every row that references it are removed at the end.
 *   APPLY_SCENARIO_FP=2a29b99ee14a22b4 npx tsx --env-file=<dev env> scripts/operations/apply-ladder-scenario.ts
 */
import { createHash, randomBytes } from 'crypto';
import { isDeepStrictEqual } from 'util';

process.env.CANONICAL_ENGINE_V1_ENABLED = 'true';
const DEV = '2a29b99ee14a22b4';
const RUN = randomBytes(3).toString('hex');
const results: { id: string; ok: boolean }[] = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};

async function main() {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  if (fp !== DEV || process.env.APPLY_SCENARIO_FP !== fp) throw new Error(`REFUSING: database ${fp} (DEV only)`);
  const { db } = await import('@/lib/db');
  const { enrollCanonicalConcept } = await import('@/lib/learning-plan/personal-plan.service');
  const { createTransferLadderService, defaultTransferLadderDeps, TransferLadderError } = await import('@/services/transfer-ladder.service');
  const { getActiveInstructionRestriction } = await import('@/services/active-evidence-guard.service');
  const { getQuizSession } = await import('@/services/quiz-persistence.service');
  const { canUseAI } = await import('@/lib/ai-permission-policy');
  const { fetchStudyUSEvidenceRows } = await import('@/lib/pedagogical-shadow/evidence-fetch');
  const { removeFixtureStudent } = await import('./curriculum-first-fixture-cleanup');
  const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
  console.log(`apply ladder scenario -- db ${fp} -- run ${RUN}`);

  const S = (await one(`INSERT INTO students (clerk_id, email, name, language) VALUES ($1, $2, 'apply cert', 'es') RETURNING id`, [`cfl-apply-${RUN}`, `cfl-apply-${RUN}@curriculum-first.test`])).id as string;
  try {
    await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', 'apply cert')`, [S]);
    await db.query(`INSERT INTO student_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [S]);
    const cc = await one(`SELECT cc.id FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id WHERE cs.name = 'Matemáticas' AND cc.name = 'Porcentajes' AND cc.status = 'ACTIVE'`);
    const enrolled = await enrollCanonicalConcept(S, cc.id, { type: 'SELF_SELECTED', actorUserId: null }, null);
    const C = enrolled.learnerConceptId as string;
    const SUBJ = (await one(`SELECT subject_id FROM concepts WHERE id = $1`, [C])).subject_id as string;
    const aiCalls = async () => Number((await one(`SELECT count(*)::int AS n FROM ai_execution_events WHERE student_id = $1`, [S])).n);

    /* R0 -- the REAL decision refuses */
    const ai0 = await aiCalls();
    try {
      await createTransferLadderService().start({ studentId: S, conceptId: C, subjectId: SUBJ, language: 'es' });
      check('R0  real canonical decision refuses APPLY for a fresh fixture', false, 'started');
    } catch (e) {
      check('R0  real canonical decision refuses APPLY for a fresh fixture', e instanceof TransferLadderError && e.code === 'TRANSFER_NOT_AUTHORIZED' && (await aiCalls()) === ai0, (e as Error).message);
    }

    /* R1 -- an adaptive attempt with the real provider */
    const deps = defaultTransferLadderDeps();
    deps.getDecision = async () => ({ stage: 'TRANSFER', actionState: 'EXECUTABLE', canonicalRevision: `scenario-${RUN}` }) as never;
    const svc = createTransferLadderService(deps);
    let view = await svc.start({ studentId: S, conceptId: C, subjectId: SUBJ, language: 'es' });
    check('R1.0  the attempt starts at NEAR with one challenge', view.pending?.level === 'NEAR' && view.challengeCount === 1, view.nextUnavailable ?? '');
    const sessionId = view.sessionId;

    // R2 -- independence while open
    const guard = await getActiveInstructionRestriction({ studentId: S, subjectId: null });
    const qs = await getQuizSession(sessionId);
    check('R2  open attempt: Tutor restricted, INDEPENDENT session, hints denied', !guard.allowed && qs?.evidenceMode === 'INDEPENDENT' && !canUseAI({ evidenceMode: qs!.evidenceMode, feature: 'HINT' }), `${guard.reason} ${qs?.evidenceMode}`);

    const steps: Array<{ level: string; certified: boolean; passed: boolean; score: number; context: string; wrong: boolean }> = [];
    let failedOnce = false;
    for (let guardN = 0; guardN < 6 && !view.summary; guardN++) {
      if (!view.pending) {
        view = await svc.start({ studentId: S, conceptId: C, subjectId: SUBJ, language: 'es' }); // resume -> serve next
        if (!view.pending) break;
      }
      const session = (await svc.load(sessionId))!;
      const rec = session.state.challenges[session.state.challenges.length - 1];
      // One deliberately wrong answer at the first MID challenge (same-level retry); otherwise the model answer.
      const wrong = !failedOnce && rec.level === 'MID';
      if (wrong) failedOnce = true;
      const answer = wrong ? 'No lo sé.' : rec.modelAnswer;
      const r = await svc.answer(session, answer);
      steps.push({ level: rec.level, certified: rec.certified, passed: r.result.passed, score: r.result.scorePercent, context: `${rec.contextDomain ?? ''}|${rec.context}`, wrong });
      console.log(`      #${rec.index} ${rec.level} certified=${rec.certified} (${rec.certificationReason}) score=${r.result.scorePercent} passed=${r.result.passed} wrong=${wrong} ctx=${rec.contextDomain}`);
      view = r.view;
    }
    const levels = steps.map((s) => s.level);
    const rank = (l: string) => ['NEAR', 'MID', 'FAR'].indexOf(l);
    check('R1.1  never down', levels.every((l, i) => i === 0 || rank(l) >= rank(levels[i - 1])), levels.join('>'));
    check('R1.2  a certified pass moves up; a fail or uncertified pass stays', steps.every((s, i) => i === steps.length - 1 || (s.passed && s.certified ? rank(levels[i + 1]) === Math.min(rank(s.level) + 1, 2) : levels[i + 1] === s.level)));
    const retry = steps.findIndex((s) => s.wrong);
    check('R1.3  same-level retry: the wrong answer failed and the next challenge stayed at its level in a different context',
      retry >= 0 && !steps[retry].passed && steps[retry + 1]?.level === steps[retry].level && steps[retry + 1]?.context !== steps[retry].context,
      retry >= 0 ? `${steps[retry].level} score=${steps[retry].score}` : 'MID not reached');
    check('R1.4  every challenge in a different context', new Set(steps.map((s) => s.context)).size === steps.length);
    check('R1.5  closed within 3..5 challenges', !!view.summary && steps.length >= 3 && steps.length <= 5, `${steps.length} ${view.summary?.closeReason}`);
    check('R1.6  NEAR -> MID -> FAR reached (FAR certified pass)', view.summary?.highestLevelReached === 'FAR', `highest=${view.summary?.highestLevelReached} competency=${view.summary?.competency}`);

    /* R3 -- evidence and task registry */
    const ev = (await db.query(`SELECT source_type, result, score_percent, hints_used, ai_assistance_type, metadata, operation_key FROM learning_evidence WHERE student_id = $1 AND concept_id = $2`, [S, C])).rows as any[];
    check('R3.1  exactly ONE learning_evidence row', ev.length === 1, String(ev.length));
    const m = ev[0]?.metadata ?? {};
    const L = m.transferLadder ?? {};
    const sess = (await svc.load(sessionId))!;
    const graded = sess.state.challenges.filter((c) => c.graded);
    const expected = graded.map((c) => ({ level: c.level, scorePercent: c.graded!.scorePercent, passed: c.graded!.passed, certified: c.certified, taskId: c.taskId, contextDomain: c.contextDomain }));
    check('R3.2  metadata.activityType TRANSFER; transferLadder exactly per contract', m.activityType === 'TRANSFER' && L.version === 'transfer-ladder-v1' && JSON.stringify(Object.keys(L).sort()) === JSON.stringify(['challenges', 'highestLevelReached', 'version']) && isDeepStrictEqual(L.challenges, expected) /* jsonb does not keep key order */ && L.highestLevelReached === (view.summary?.highestLevelReached ?? null));
    check('R3.3  canonical attribution + independent', m.pedagogicalPolicyVersion === 'studyus-canonical-v1' && m.canonicalStage === 'TRANSFER' && m.canonicalActivityType === 'TRANSFER' && m.evidenceMode === 'INDEPENDENT' && ev[0].hints_used === 0 && ev[0].ai_assistance_type === 'NONE' && String(ev[0].operation_key).startsWith('TRANSFER_LADDER::'));
    const tasks = (await db.query(`SELECT id, transfer_distance, novelty_validation_passed FROM transfer_task_instances WHERE student_id = $1`, [S])).rows as any[];
    check('R3.4  one transfer_task_instances row per served challenge; certified == novelty_validation_passed; distance == level',
      sess.state.challenges.every((c) => tasks.some((t) => t.id === c.taskId && t.transfer_distance === c.level && t.novelty_validation_passed === c.certified)), `${tasks.length} tasks / ${sess.state.challenges.length} challenges`);
    const row = await one(`SELECT status FROM quiz_sessions WHERE id = $1`, [sessionId]);
    const guardAfter = await getActiveInstructionRestriction({ studentId: S, subjectId: null });
    check('R3.5  attempt completed; Tutor restriction lifted', row.status === 'completed' && guardAfter.allowed);
    const fetched = await fetchStudyUSEvidenceRows(S, C);
    check('R3.6  the engine evidence fetch reads the row as activityType TRANSFER (ENGINE workstream maps transferLadder)', fetched.length === 1 && fetched[0].activityType === 'TRANSFER');
    console.log(`      evidence: ${JSON.stringify({ result: ev[0]?.result, score_percent: ev[0]?.score_percent, transferLadder: L })}`);
  } finally {
    const remaining = await removeFixtureStudent(db, S);
    check('CLEANUP  fixture and every referencing row removed', remaining === 0, `remaining=${remaining}`);
    await db.end();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

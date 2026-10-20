/**
 * C14-P0-01 -- DEV scenario: a Student whose history holds an APPLY transfer ladder session (quiz_sessions.questions =
 * the TRANSFER_LADDER state OBJECT) starts a teacher-assigned Subject Test and Mock, and their own subject Test.
 * Before the fix every one of these starts threw "object is not iterable" (HTTP 500).
 *
 * Real services throughout: ensureConceptInLearnerPlan, the transfer ladder STORE's own create/save/complete (the
 * real persisted shape -- no hand-written SQL for the session; the real ladder service needs a canonical
 * TRANSFER+EXECUTABLE decision a fresh fixture cannot reach), publishSubjectAssessmentAssignment,
 * listStudentSubjectAssignments, startSubjectAssignmentAttempt, createSubjectAssessmentSession, loadSeenFingerprints.
 * The ONLY substitution is the item generator (deterministic stub, like teacher-subject-assessment-scenario.ts): no
 * provider call.
 *
 * Clock: the assignment windows run from today to TOMORROW (21:00 America/Bogota of endDate), so the scenario is
 * open whatever the hour it runs at (a same-day window closes at 21:00 Bogota).
 *
 * Fixtures `cfl-c14p001-<run>-*` (@curriculum-first.test), all removed at the end.
 *   CURRICULUM_CONVERGENCE_FP=2a29b99ee14a22b4 npx tsx --env-file=<dev env> scripts/operations/c14-p0-01-dev-scenario.ts
 */
import { createHash, randomBytes, randomUUID } from 'crypto';

const DEV = '2a29b99ee14a22b4';
const RUN = randomBytes(3).toString('hex');
const TZ = 'America/Bogota';
const results: { id: string; ok: boolean }[] = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};

async function main() {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  if (fp !== DEV || process.env.CURRICULUM_CONVERGENCE_FP !== fp) throw new Error(`REFUSING: database ${fp} (DEV only)`);
  const { db } = await import('@/lib/db');
  const svc = await import('@/lib/teacher/subject-assessment-assignment.service');
  const rules = await import('@/lib/teacher/subject-assessment-assignment.rules');
  const subject = await import('@/services/subject-assessment.service');
  const { ensureConceptInLearnerPlan } = await import('@/lib/teacher/plan-enrollment.service');
  const { createDbTransferLadderStore, TRANSFER_LADDER_QUIZ_MODE } = await import('@/services/transfer-ladder-session.store');
  const { fingerprintQuestion } = await import('@/lib/lx/exact-duplicate-novelty');
  const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
  console.log(`C14-P0-01 scenario -- db ${fp} -- run ${RUN}`);

  // ------------------------------------------------------------- generator stub (no provider)
  let counter = 0;
  let generatorCalls = 0;
  const generate = async (a: { conceptId: string; count: number; difficulty: number }) => {
    generatorCalls++;
    return Array.from({ length: a.count }, () => ({
      id: `c14-${RUN}-${++counter}`, conceptId: a.conceptId, type: 'multiple_choice', answerFormat: 'single_choice', question: `C14 ${RUN} pregunta ${counter}`,
      options: [{ id: 'a', text: 'Correcta' }, { id: 'b', text: 'Incorrecta' }, { id: 'c', text: 'Otra' }, { id: 'd', text: 'Ninguna' }],
      correctAnswer: 'a', explanation: 'La opción correcta es "Correcta".', difficulty: a.difficulty,
    })) as any;
  };
  const deps = { generate };
  const failingDeps = { generate: async () => { generatorCalls++; throw new Error('stub generator down'); } };

  // ------------------------------------------------------------- fixtures
  const created = { users: [] as string[], students: [] as string[], institutions: [] as string[], classes: [] as string[] };
  const mkUser = async (tag: string, role: string) => {
    const id = (await one(`INSERT INTO users (clerk_id, email) VALUES ($1, $2) RETURNING id`, [`cfl-c14p001-${RUN}-${tag}`, `cfl-c14p001-${RUN}-${tag}@curriculum-first.test`])).id as string;
    created.users.push(id);
    await db.query(`INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, $2, 'ACTIVE', 'SELF_REGISTRATION')`, [id, role]);
    return id;
  };
  const mkStudent = async (tag: string) => {
    const userId = await mkUser(tag, 'STUDENT');
    const id = (await one(`INSERT INTO students (clerk_id, email, name, user_id, language) VALUES ($1, $2, $3, $4, 'es') RETURNING id`, [`cfl-c14p001-${RUN}-${tag}`, `cfl-c14p001-${RUN}-${tag}@curriculum-first.test`, `C14 ${tag}`, userId])).id as string;
    created.students.push(id);
    await db.query(`INSERT INTO profiles (id, user_type, full_name, user_id) VALUES ($1, 'student', $2, $3)`, [id, `C14 ${tag}`, userId]);
    return { userId, id };
  };
  try {
    const math = (await one(`SELECT id FROM canonical_subjects WHERE name = 'Matemáticas'`)).id as string;
    const inst = (await one(`INSERT INTO institutions (name, status, timezone) VALUES ($1, 'ACTIVE', $2) RETURNING id`, [`C14 ${RUN} Colegio`, TZ])).id as string;
    created.institutions.push(inst);
    const klass = (await one(`INSERT INTO classes (institution_id, name, canonical_subject_id, status) VALUES ($1, 'Matemáticas C14', $2, 'ACTIVE') RETURNING id`, [inst, math])).id as string;
    created.classes.push(klass);
    const teacher = await mkUser('teacher', 'TEACHER');
    const tm = (await one(`INSERT INTO institution_memberships (institution_id, user_id, membership_role, status) VALUES ($1, $2, 'TEACHER', 'APPROVED') RETURNING id`, [inst, teacher])).id;
    await db.query(`INSERT INTO teacher_assignments (institution_membership_id, class_id, status) VALUES ($1, $2, 'ACTIVE')`, [tm, klass]);
    const ana = await mkStudent('ana');
    await db.query(`INSERT INTO class_enrollments (class_id, student_id, status) VALUES ($1, $2, 'ACTIVE')`, [klass, ana.id]);

    const ctx = await svc.getSubjectAssessmentComposerContext(teacher, klass);
    const canonical = ctx.concepts.slice(0, 2).map((c) => c.id);
    check('FIXTURE  class subject has concepts to assess', canonical.length === 2, `${ctx.concepts.length} concepts`);

    /* ---------------------------------------------- 1. the Student reaches an APPLY transfer ladder session ---------------------------------------------- */
    const learnerConcept = (await ensureConceptInLearnerPlan({ studentId: ana.id, canonicalConceptId: canonical[0], classId: klass, actorUserId: teacher })).conceptId;
    const learnerSubject = (await one(`SELECT subject_id FROM concepts WHERE id = $1`, [learnerConcept])).subject_id as string;
    const store = createDbTransferLadderStore(db);
    const applyId = `apply-${randomUUID()}`;
    const baseState = {
      kind: 'TRANSFER_LADDER' as const, version: 'transfer-ladder-v1' as const, revision: 0, conceptLabel: 'Concepto C14', learnedContext: 'clase',
      attribution: { pedagogicalPolicyVersion: 'v1', canonicalRevision: `c14-${RUN}`, canonicalStage: 'APPLY', canonicalActivityType: 'TRANSFER' as const },
      challenges: [], closedAt: null,
    };
    await store.create({ id: applyId, studentId: ana.id, conceptId: learnerConcept, subjectId: learnerSubject, language: 'es', state: baseState });
    const prompts = [`C14 ${RUN} tarea de transferencia cercana`, `C14 ${RUN} tarea de transferencia media`];
    let state: any = baseState;
    for (const [i, prompt] of prompts.entries()) {
      const next = {
        ...state, revision: state.revision + 1,
        challenges: [...state.challenges, {
          index: i + 1, level: i === 0 ? 'NEAR' : 'MEDIUM', taskId: randomUUID(), context: `Contexto ${i + 1}`, contextDomain: i === 0 ? 'cocina' : 'deporte', prompt,
          modelAnswer: 'respuesta modelo', certified: true, certificationReason: 'CERTIFIED', servedAt: new Date().toISOString(),
          graded: { scorePercent: 90, passed: true, feedback: 'Bien', errorType: null, answer: 'respuesta', answeredAt: new Date().toISOString(), aiExecutionId: null },
        }],
      };
      const saved = await store.save(applyId, next, state.revision);
      if (!saved) throw new Error('store.save failed');
      state = next;
    }
    await store.complete(applyId);
    const applyRow = await one(`SELECT quiz_mode, status, jsonb_typeof(questions) t, questions->>'kind' k, jsonb_array_length(questions->'challenges') n FROM quiz_sessions WHERE id = $1`, [applyId]);
    check('APPLY  the Student has a completed transfer_ladder session whose questions is the TRANSFER_LADDER OBJECT (the defect shape)',
      applyRow.quiz_mode === TRANSFER_LADDER_QUIZ_MODE && applyRow.status === 'completed' && applyRow.t === 'object' && applyRow.k === 'TRANSFER_LADDER' && applyRow.n === 2, JSON.stringify(applyRow));

    const seen = await subject.loadSeenFingerprints(ana.id, [learnerConcept]);
    check('HISTORY  loadSeenFingerprints no longer throws and keeps the APPLY prompts as seen for the session concept',
      prompts.every((p) => seen.get(learnerConcept)!.has(fingerprintQuestion({ question: p }))), `${seen.get(learnerConcept)!.size} seen`);

    /* ------------------------------------------------- 2. the teacher assigns a Subject Test and a Mock ------------------------------------------------- */
    const nowDb = new Date((await one(`SELECT now() AS n`)).n);
    const today = rules.localDateIn(TZ, nowDb);
    const [y, m, d] = today.split('-').map(Number);
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    const pTest = await svc.publishSubjectAssessmentAssignment(teacher, { classId: klass, kind: 'TEST', conceptIds: canonical, difficulty: 'MIXTO', startDate: today, endDate: tomorrow, maxAttempts: 2, timing: { timed: false, durationMinutes: null }, studentIds: [ana.id], requestId: randomUUID() });
    const pMock = await svc.publishSubjectAssessmentAssignment(teacher, { classId: klass, kind: 'MOCK', conceptIds: canonical, difficulty: 'MIXTO', startDate: today, endDate: tomorrow, maxAttempts: 2, timing: { timed: true, durationMinutes: null }, studentIds: [ana.id], requestId: randomUUID() });
    const ivTest = pTest.assigned[0].interventionId;
    const ivMock = pMock.assigned[0].interventionId;
    const learnerMap = (await one(`SELECT subject_assessment_assignment->'learner'->'conceptIds' AS m FROM teacher_interventions WHERE id = $1`, [ivTest])).m;
    check('ASSIGN  Test + Mock published to the Student (window today..tomorrow 21:00 Bogota, 2 attempts); the APPLY concept is one of the assigned learner concepts',
      pTest.assigned.length === 1 && pMock.assigned.length === 1 && learnerMap[canonical[0]] === learnerConcept, `closes ${pTest.preview.window.closesAt}`);
    const listed = await svc.listStudentSubjectAssignments(ana.id);
    check('LISTED  both appear on the Student\'s assignments, 0 of 2 attempts used, action START',
      [ivTest, ivMock].every((iv) => { const x = listed.find((l) => l.interventionId === iv); return !!x && x.attemptsUsed === 0 && x.action.action === 'START'; }),
      JSON.stringify(listed.map((l) => ({ k: l.kind, used: l.attemptsUsed, a: l.action.action }))));

    /* ------------------------------------- 3. a genuinely failing start leaves nothing behind (no session, no execution) ------------------------------------- */
    const sessionsBefore = Number((await one(`SELECT count(*) n FROM quiz_sessions WHERE student_id = $1`, [ana.id])).n);
    let failCode = ''; let failStatus = 0;
    try { await svc.startSubjectAssignmentAttempt(ana.userId, ivTest, failingDeps); } catch (e: any) { failCode = e.code; failStatus = e.status; }
    const sessionsAfterFail = Number((await one(`SELECT count(*) n FROM quiz_sessions WHERE student_id = $1`, [ana.id])).n);
    const execAfterFail = Number((await one(`SELECT count(*) n FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [ivTest])).n);
    check('FAILING GENERATOR  start refuses with GENERATION_INSUFFICIENT (503), no session, no execution claim left, attempt not consumed',
      failCode === 'GENERATION_INSUFFICIENT' && failStatus === 503 && sessionsAfterFail === sessionsBefore && execAfterFail === 0, `${failCode} ${failStatus}`);

    /* ------------------------------------------------------- 4. the Student starts both: STARTED ------------------------------------------------------- */
    const callsBefore = generatorCalls;
    const sTest = await svc.startSubjectAssignmentAttempt(ana.userId, ivTest, deps);
    const sMock = await svc.startSubjectAssignmentAttempt(ana.userId, ivMock, deps);
    const setupOf = async (quizId: string) => (await one(`SELECT subject_assessment_setup s FROM quiz_sessions WHERE id = $1`, [quizId])).s;
    const tSetup = await setupOf(sTest.quizId);
    const mSetup = await setupOf(sMock.quizId);
    check('TEACHER TEST START  STARTED (no 500), attempt 1, frozen with the APPLY prompts counted as prior items',
      sTest.outcome === 'STARTED' && sTest.attemptNumber === 1 && tSetup.origin === 'TEACHER' && tSetup.assignmentId === ivTest && tSetup.priorFingerprintCount >= prompts.length, `prior ${tSetup.priorFingerprintCount}`);
    check('TEACHER MOCK START  STARTED (no 500), attempt 1, timed',
      sMock.outcome === 'STARTED' && sMock.attemptNumber === 1 && mSetup.kind === 'SUBJECT_MOCK_EXAM' && mSetup.timing.timed === true && mSetup.priorFingerprintCount >= prompts.length, `prior ${mSetup.priorFingerprintCount}`);
    const served = [...(await one(`SELECT questions q FROM quiz_sessions WHERE id = $1`, [sTest.quizId])).q, ...(await one(`SELECT questions q FROM quiz_sessions WHERE id = $1`, [sMock.quizId])).q];
    check('NOVELTY  no APPLY prompt is re-served; only the stub generator was used (no provider call)',
      !served.some((q: any) => prompts.includes(q.question)) && generatorCalls > callsBefore, `${served.length} items`);
    const execs = Number((await one(`SELECT count(*) n FROM teacher_intervention_executions WHERE teacher_intervention_id = ANY($1::uuid[]) AND execution_reference NOT LIKE 'pending:%'`, [[ivTest, ivMock]])).n);
    check('EXECUTIONS  exactly one execution per started attempt', execs === 2, `${execs}`);

    /* ------------------------------------------------------ 5. the Student's own subject Test ------------------------------------------------------ */
    const own = await subject.createSubjectAssessmentSession({ studentId: ana.id, subjectId: learnerSubject, kind: 'TEST', origin: 'STUDENT', conceptIds: [learnerConcept], schedule: { mode: 'NOW' }, language: 'es' } as any, deps);
    check('OWN TEST START  the Student\'s own subject Test starts (no 500) with the APPLY session in the history',
      own.ok === true && own.ok && own.view.state === 'ACTIVE' && own.setup.origin === 'STUDENT' && (own.setup.priorFingerprintCount ?? 0) >= prompts.length, own.ok ? `prior ${own.setup.priorFingerprintCount}, ${own.setup.questionCount} items` : JSON.stringify(own));
  } finally {
    // --------------------------------------------------------------- cleanup
    const { removeFixtureStudent } = await import('./curriculum-first-fixture-cleanup');
    let remaining = 0;
    await db.query(`DELETE FROM teacher_intervention_executions WHERE teacher_intervention_id IN (SELECT id FROM teacher_interventions WHERE class_id = ANY($1::uuid[]))`, [created.classes]);
    await db.query(`DELETE FROM student_concept_sources WHERE class_id = ANY($1::uuid[])`, [created.classes]).catch(() => {});
    await db.query(`DELETE FROM student_availability WHERE student_id = ANY($1::uuid[])`, [created.students]).catch(() => {});
    for (const s of created.students) remaining += await removeFixtureStudent(db, s);
    await db.query(`DELETE FROM teacher_interventions WHERE class_id = ANY($1::uuid[])`, [created.classes]);
    await db.query(`DELETE FROM notifications WHERE recipient_user_id = ANY($1::uuid[])`, [created.users]);
    await db.query(`DELETE FROM class_enrollments WHERE class_id = ANY($1::uuid[])`, [created.classes]);
    await db.query(`DELETE FROM teacher_assignments WHERE class_id = ANY($1::uuid[])`, [created.classes]);
    await db.query(`DELETE FROM institution_memberships WHERE institution_id = ANY($1::uuid[])`, [created.institutions]);
    await db.query(`DELETE FROM classes WHERE id = ANY($1::uuid[])`, [created.classes]);
    await db.query(`DELETE FROM institutions WHERE id = ANY($1::uuid[])`, [created.institutions]);
    await db.query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [created.users]);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [created.users]).catch(async (e) => { console.error('users cleanup', e.message); });
    const left = Number((await one(
      `SELECT (SELECT count(*) FROM users WHERE id = ANY($1::uuid[])) + (SELECT count(*) FROM institutions WHERE id = ANY($2::uuid[])) + (SELECT count(*) FROM classes WHERE id = ANY($3::uuid[]))
            + (SELECT count(*) FROM teacher_interventions WHERE class_id = ANY($3::uuid[])) + (SELECT count(*) FROM students WHERE id = ANY($4::uuid[]))
            + (SELECT count(*) FROM quiz_sessions WHERE student_id = ANY($4::uuid[])) AS n`,
      [created.users, created.institutions, created.classes, created.students]
    )).n);
    check('CLEANUP  every fixture (institution, class, users, student, APPLY session, assignments, attempts) is removed', remaining === 0 && left === 0, `remaining ${remaining} + ${left}`);
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

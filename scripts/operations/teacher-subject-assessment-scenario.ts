/**
 * Overnight 2026-10-16 -- TEACHER-assigned subject Test / Mock scenario with the REAL services against the DEV database.
 *
 * Every service is the production one: the class / teacher / learner authorization chain, publishSubjectAssessment-
 * Assignment (targeting + idempotency of publishClassAssignment, ensureConceptInLearnerPlan, assignTeacherIntervention),
 * startSubjectAssignmentAttempt, the subject service (createSubjectAssessmentSession, answer, submit, read,
 * heartbeat, evidence through updateMastery), the feedback release and the teacher read models. The ONLY substitution
 * is the item generator: a deterministic stub (single-choice, correct option 'a') with two modes -- UNIQUE (always new
 * texts) and POOL (a tiny fixed pool per concept, so supply runs short and controlled reuse happens). No provider call.
 *
 * Time: the database clock is real; the window close is exercised by moving the FIXTURE's frozen close instant (the
 * intervention's window.closesAt and the attempt's assignmentWindow.closesAt) and its activity timestamps into the past
 * ("controlled clock injection" on fixture data only).
 *
 * Fixtures: institution "TSA <run>" (timezone America/Bogota) + a second one without timezone, classes, one teacher,
 * one stranger teacher, three students (`cfl-tsa-<run>-*`, `@curriculum-first.test`), all removed at the end.
 *   CURRICULUM_CONVERGENCE_FP=2a29b99ee14a22b4 npx tsx --env-file=<dev env> scripts/operations/teacher-subject-assessment-scenario.ts
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
  const { subjectAssessmentScorePercent: subjectScore } = await import('@/lib/subject-assessment/sizing');
  const { fingerprintQuestion } = await import('@/lib/lx/exact-duplicate-novelty');
  const { TeacherClassAccessDeniedError } = await import('@/lib/teacher/class-assignment.service');
  const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
  const all = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as any[];
  console.log(`teacher subject assessment scenario -- db ${fp} -- run ${RUN}`);

  // ------------------------------------------------------------- generator stub
  // UNIQUE: always new texts; POOL: a 2-item fixed pool per concept; REPLAY: every item ever generated for the concept,
  // newest first (supply with no novel item: the reuse order decides)
  let mode: 'UNIQUE' | 'POOL' | 'REPLAY' = 'UNIQUE';
  let counter = 0;
  const history = new Map<string, any[]>();
  const canonicalOf = new Map<string, string>();
  const item = (conceptId: string, text: string, difficulty: number) => ({
    id: `tsa-${RUN}-${++counter}`, conceptId, type: 'multiple_choice', answerFormat: 'single_choice', question: text,
    options: [{ id: 'a', text: 'Correcta' }, { id: 'b', text: 'Incorrecta' }, { id: 'c', text: 'Otra' }, { id: 'd', text: 'Ninguna' }],
    correctAnswer: 'a', explanation: `La opción correcta es "Correcta".`, difficulty,
  }) as any;
  const generate = async (a: { conceptId: string; count: number; difficulty: number }) => {
    if (mode === 'REPLAY') return [...(history.get(a.conceptId) ?? [])].reverse().map((q) => ({ ...q }));
    // the pool is per CANONICAL concept (the same topic yields the same texts for every learner)
    const canonical = canonicalOf.get(a.conceptId) ?? (await one(`SELECT canonical_concept_id AS c FROM concept_catalog_mapping WHERE learner_concept_id = $1`, [a.conceptId]))?.c ?? a.conceptId;
    canonicalOf.set(a.conceptId, canonical);
    const out = Array.from({ length: a.count }, (_, i) => item(a.conceptId, mode === 'UNIQUE' ? `TSA ${RUN} pregunta única ${++counter}` : `TSA ${RUN} pregunta del banco ${String(canonical).slice(0, 8)} #${(i % 2) + 1}`, a.difficulty));
    const h = history.get(a.conceptId) ?? [];
    for (const q of out) if (!h.some((x) => x.question === q.question)) h.push(q);
    history.set(a.conceptId, h);
    return out;
  };
  const deps = { generate };

  // ------------------------------------------------------------- fixtures
  const created = { users: [] as string[], students: [] as string[], institutions: [] as string[], classes: [] as string[] };
  const mkUser = async (tag: string, role: string) => {
    const id = (await one(`INSERT INTO users (clerk_id, email) VALUES ($1, $2) RETURNING id`, [`cfl-tsa-${RUN}-${tag}`, `cfl-tsa-${RUN}-${tag}@curriculum-first.test`])).id as string;
    created.users.push(id);
    await db.query(`INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, $2, 'ACTIVE', 'SELF_REGISTRATION')`, [id, role]);
    return id;
  };
  const mkStudent = async (tag: string) => {
    const userId = await mkUser(tag, 'STUDENT');
    const id = (await one(`INSERT INTO students (clerk_id, email, name, user_id, language) VALUES ($1, $2, $3, $4, 'es') RETURNING id`, [`cfl-tsa-${RUN}-${tag}`, `cfl-tsa-${RUN}-${tag}@curriculum-first.test`, `TSA ${tag}`, userId])).id as string;
    created.students.push(id);
    await db.query(`INSERT INTO profiles (id, user_type, full_name, user_id) VALUES ($1, 'student', $2, $3)`, [id, `TSA ${tag}`, userId]);
    return { userId, id };
  };
  try {
    const math = (await one(`SELECT id FROM canonical_subjects WHERE name = 'Matemáticas'`)).id as string;
    const inst = (await one(`INSERT INTO institutions (name, status, timezone) VALUES ($1, 'ACTIVE', $2) RETURNING id`, [`TSA ${RUN} Colegio`, TZ])).id as string;
    const instNoTz = (await one(`INSERT INTO institutions (name, status) VALUES ($1, 'ACTIVE') RETURNING id`, [`TSA ${RUN} Sin zona`])).id as string;
    created.institutions.push(inst, instNoTz);
    const klass = (await one(`INSERT INTO classes (institution_id, name, canonical_subject_id, status) VALUES ($1, 'Matemáticas 3A', $2, 'ACTIVE') RETURNING id`, [inst, math])).id as string;
    const klassOther = (await one(`INSERT INTO classes (institution_id, name, canonical_subject_id, status) VALUES ($1, 'Matemáticas 3B', $2, 'ACTIVE') RETURNING id`, [inst, math])).id as string;
    const klassNoTz = (await one(`INSERT INTO classes (institution_id, name, canonical_subject_id, status) VALUES ($1, 'Matemáticas sin zona', $2, 'ACTIVE') RETURNING id`, [instNoTz, math])).id as string;
    created.classes.push(klass, klassOther, klassNoTz);
    const teacher = await mkUser('teacher', 'TEACHER');
    const stranger = await mkUser('stranger', 'TEACHER');
    const tm = (await one(`INSERT INTO institution_memberships (institution_id, user_id, membership_role, status) VALUES ($1, $2, 'TEACHER', 'APPROVED') RETURNING id`, [inst, teacher])).id;
    await db.query(`INSERT INTO teacher_assignments (institution_membership_id, class_id, status) VALUES ($1, $2, 'ACTIVE')`, [tm, klass]);
    const tmNoTz = (await one(`INSERT INTO institution_memberships (institution_id, user_id, membership_role, status) VALUES ($1, $2, 'TEACHER', 'APPROVED') RETURNING id`, [instNoTz, teacher])).id;
    await db.query(`INSERT INTO teacher_assignments (institution_membership_id, class_id, status) VALUES ($1, $2, 'ACTIVE')`, [tmNoTz, klassNoTz]);
    const sm = (await one(`INSERT INTO institution_memberships (institution_id, user_id, membership_role, status) VALUES ($1, $2, 'TEACHER', 'APPROVED') RETURNING id`, [inst, stranger])).id;
    await db.query(`INSERT INTO teacher_assignments (institution_membership_id, class_id, status) VALUES ($1, $2, 'ACTIVE')`, [sm, klassOther]);
    const S1 = await mkStudent('s1');
    const S2 = await mkStudent('s2');
    const S3 = await mkStudent('s3');
    for (const s of [S1, S2, S3]) await db.query(`INSERT INTO class_enrollments (class_id, student_id, status) VALUES ($1, $2, 'ACTIVE')`, [klass, s.id]);
    await db.query(`INSERT INTO class_enrollments (class_id, student_id, status) VALUES ($1, $2, 'ACTIVE')`, [klassNoTz, S1.id]);

    const ctx = await svc.getSubjectAssessmentComposerContext(teacher, klass);
    const concepts = ctx.concepts.slice(0, 3).map((c) => c.id);
    const nowDb = new Date((await one(`SELECT now() AS n`)).n);
    const today = rules.localDateIn(TZ, nowDb);
    const plusDays = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, dd + n)); return x.toISOString().slice(0, 10); };
    check('COMPOSER  the class subject\'s eligible concepts are offered (all ON by default in the UI), timezone authority = the institution', ctx.concepts.length >= 3 && ctx.timezone === TZ && !ctx.timezoneBlocker && ctx.activeLearners.length === 3, `${ctx.concepts.length} concepts, tz ${ctx.timezone}`);

    /* ----------------------------------------------- preview: plan, recommended duration, window ----------------------------------------------- */
    const pv = await svc.previewSubjectAssessmentAssignment(teacher, { classId: klass, kind: 'MOCK', conceptIds: concepts, difficulty: 'INTERMEDIO', startDate: today, endDate: today, maxAttempts: 2, timing: { timed: true, durationMinutes: null } });
    check('PREVIEW  MOCK plan = planGroupAssessment (3 concepts -> 6 items, 2 each), band INTERMEDIATE from "Intermedio"', pv.plan.questionCount === 6 && Object.values(pv.plan.distribution).every((n) => n === 2) && pv.difficultyBand === 'INTERMEDIATE', JSON.stringify(pv.plan));
    check('PREVIEW  MOCK always timed with the StudyUs recommended duration (nominal sum over the planned items)', pv.timing.timed && (pv.timing.recommendedDurationMinutes ?? 0) >= 1 && pv.timing.durationMinutes === pv.timing.recommendedDurationMinutes && pv.timing.durationSource === 'STUDYUS_RECOMMENDED', `${pv.timing.recommendedDurationMinutes} min ${pv.timing.recommendationRule}`);
    const expectedClose = rules.zonedWallTimeToUtc(today, 21, 0, TZ).toISOString();
    check('WINDOW  closes 21:00 of endDate in the institution timezone (Bogota = 02:00Z next day), opens 00:00 of startDate', pv.window.closesAt === expectedClose && new Date(pv.window.closesAt).getUTCHours() === 2 && pv.window.opensAt === rules.zonedWallTimeToUtc(today, 0, 0, TZ).toISOString() && pv.closesAtLocal.time === '21:00' && pv.closesAtLocal.timezone === TZ, `${pv.window.opensAt} .. ${pv.window.closesAt}`);
    let blocker = '';
    try { await svc.previewSubjectAssessmentAssignment(teacher, { classId: klassNoTz, kind: 'TEST', conceptIds: concepts, difficulty: 'BASICO', startDate: today, endDate: today, maxAttempts: 1, timing: { timed: false, durationMinutes: null } }); } catch (e: any) { blocker = e.code; }
    let blockerPublish = '';
    try { await svc.publishSubjectAssessmentAssignment(teacher, { classId: klassNoTz, kind: 'TEST', conceptIds: concepts, difficulty: 'BASICO', startDate: today, endDate: today, maxAttempts: 1, timing: { timed: false, durationMinutes: null } }); } catch (e: any) { blockerPublish = e.code; }
    const rowsNoTz = Number((await one(`SELECT count(*) n FROM teacher_interventions WHERE class_id = $1`, [klassNoTz])).n);
    check('TIMEZONE_AUTHORITY_BLOCKER  an institution without timezone refuses preview and creation (nothing written)', blocker === 'TIMEZONE_AUTHORITY_BLOCKER' && blockerPublish === 'TIMEZONE_AUTHORITY_BLOCKER' && rowsNoTz === 0);
    let untimedMock = '';
    try { await svc.previewSubjectAssessmentAssignment(teacher, { classId: klass, kind: 'MOCK', conceptIds: concepts, difficulty: 'MIXTO', startDate: today, endDate: today, maxAttempts: 1, timing: { timed: false, durationMinutes: null } }); } catch (e: any) { untimedMock = e.code; }
    check('MOCK ALWAYS TIMED  an untimed mock is refused', untimedMock === 'MOCK_MUST_BE_TIMED');

    /* ---------------------------------------------------- publish: one / several / class ---------------------------------------------------- */
    const reqOne = randomUUID();
    const pOne = await svc.publishSubjectAssessmentAssignment(teacher, { classId: klass, kind: 'TEST', conceptIds: concepts, difficulty: 'BASICO', startDate: today, endDate: plusDays(today, 2), maxAttempts: 3, timing: { timed: false, durationMinutes: null }, studentIds: [S1.id], requestId: reqOne, title: `Prueba ${RUN}` });
    check('ASSIGN TO ONE  a Test to one student: one row, SUBJECT_TEST, multi-day window, 3 attempts, untimed', pOne.assigned.length === 1 && pOne.assigned[0].studentId === S1.id && pOne.preview.window.endDate === plusDays(today, 2) && pOne.preview.timing.timed === false);
    const replay = await svc.publishSubjectAssessmentAssignment(teacher, { classId: klass, kind: 'TEST', conceptIds: concepts, difficulty: 'BASICO', startDate: today, endDate: plusDays(today, 2), maxAttempts: 3, timing: { timed: false, durationMinutes: null }, studentIds: [S1.id], requestId: reqOne });
    const oneRows = Number((await one(`SELECT count(*) n FROM teacher_interventions WHERE assignment_group_id = $1`, [reqOne])).n);
    check('IDEMPOTENT  a retried publish (same requestId) replays the same group, no duplicate row', replay.replayed && replay.assignmentGroupId === reqOne && oneRows === 1 && replay.assigned[0].interventionId === pOne.assigned[0].interventionId);
    let conflict = '';
    try { await svc.publishSubjectAssessmentAssignment(teacher, { classId: klass, kind: 'MOCK', conceptIds: concepts, difficulty: 'BASICO', startDate: today, endDate: today, maxAttempts: 1, timing: { timed: true, durationMinutes: 10 }, studentIds: [S1.id], requestId: reqOne }); } catch (e: any) { conflict = e.code; }
    check('IDEMPOTENT  the same requestId for a different kind is a REQUEST_CONFLICT', conflict === 'REQUEST_CONFLICT');
    const rowOne = await one(`SELECT intervention_type, target_type, starts_at, due_at, subject_assessment_assignment AS c FROM teacher_interventions WHERE id = $1`, [pOne.assigned[0].interventionId]);
    check('DATA MODEL  SUBJECT target + frozen config (plan, band, window, maxAttempts, learner concept map), due_at = closesAt', rowOne.intervention_type === 'SUBJECT_TEST' && rowOne.target_type === 'SUBJECT' && rowOne.c.version === 'teacher-subject-assessment-v1' && new Date(rowOne.due_at).toISOString() === rowOne.c.window.closesAt && Object.keys(rowOne.c.learner.conceptIds).length === 3);

    const pMock = await svc.publishSubjectAssessmentAssignment(teacher, { classId: klass, kind: 'MOCK', conceptIds: concepts, difficulty: 'AVANZADO', startDate: today, endDate: today, maxAttempts: 2, timing: { timed: true, durationMinutes: 25 }, studentIds: [S1.id, S2.id], requestId: randomUUID() });
    check('ASSIGN TO SEVERAL  a Mock to two students, same-day window, teacher-adjusted duration frozen (25 min)', pMock.assigned.length === 2 && pMock.preview.timing.durationMinutes === 25 && pMock.preview.timing.durationSource === 'TEACHER_ADJUSTED' && pMock.preview.window.startDate === pMock.preview.window.endDate);
    const pClass = await svc.publishSubjectAssessmentAssignment(teacher, { classId: klass, kind: 'TEST', conceptIds: concepts, difficulty: 'MIXTO', startDate: today, endDate: plusDays(today, 1), maxAttempts: 2, timing: { timed: false, durationMinutes: null }, requestId: randomUUID() });
    check('ASSIGN TO CLASS  studentIds empty = every ACTIVE learner (3 rows, one group)', pClass.assigned.length === 3 && new Set(pClass.assigned.map((a) => a.studentId)).size === 3);
    const pFuture = await svc.publishSubjectAssessmentAssignment(teacher, { classId: klass, kind: 'TEST', conceptIds: concepts, difficulty: 'BASICO', startDate: plusDays(today, 1), endDate: plusDays(today, 1), maxAttempts: 1, timing: { timed: false, durationMinutes: null }, studentIds: [S3.id], requestId: randomUUID() });

    const ivOf = (p: { assigned: Array<{ studentId: string; interventionId: string }> }, s: { id: string }) => p.assigned.find((a) => a.studentId === s.id)!.interventionId;
    const answerAll = async (studentId: string, quizId: string, pattern: (i: number) => string) => {
      const q = (await one(`SELECT questions FROM quiz_sessions WHERE id = $1`, [quizId])).questions as any[];
      for (let i = 0; i < q.length; i++) { const a = pattern(i); if (a) await subject.recordSubjectAssessmentAnswer({ studentId, quizId, questionIndex: i, answer: a }, deps); }
      return q.length;
    };
    const fpsOf = async (quizId: string) => ((await one(`SELECT questions FROM quiz_sessions WHERE id = $1`, [quizId])).questions as any[]).map((q) => fingerprintQuestion(q));

    /* --------------------------------------- attempts: resume, last completed wins, retry after pass, reuse --------------------------------------- */
    let notOpen = '';
    try { await svc.startSubjectAssignmentAttempt(S3.userId, ivOf(pFuture, S3), deps); } catch (e: any) { notOpen = e.code; }
    check('WINDOW NOT OPEN  an attempt cannot start before 00:00 of startDate', notOpen === 'NOT_OPEN_YET');

    mode = 'UNIQUE';
    const ivT = ivOf(pOne, S1);
    const a1 = await svc.startSubjectAssignmentAttempt(S1.userId, ivT, deps);
    const a1b = await svc.startSubjectAssignmentAttempt(S1.userId, ivT, deps);
    check('RESUME  starting again while an attempt is active RESUMES it (same quiz, no extra attempt)', a1.outcome === 'STARTED' && a1.attemptNumber === 1 && a1b.outcome === 'RESUMED' && a1b.quizId === a1.quizId);
    const s1setup = (await one(`SELECT subject_assessment_setup s FROM quiz_sessions WHERE id = $1`, [a1.quizId])).s;
    check('FROZEN VERSION  the attempt freezes the group plan on the learner\'s concepts, band BASIC, origin TEACHER, assignmentId = intervention id, attempt 1', s1setup.origin === 'TEACHER' && s1setup.assignmentId === ivT && s1setup.attemptNumber === 1 && s1setup.difficulty.band === 'BASIC' && s1setup.questionCount === 4 && s1setup.maxAttempts === 3 && s1setup.assignmentWindow.closesAt === pOne.preview.window.closesAt);
    const n1 = await answerAll(S1.id, a1.quizId, () => 'a');
    const sub1 = await subject.submitSubjectAssessmentSession({ studentId: S1.id, quizId: a1.quizId }, deps);
    check('ATTEMPT 1  100% -> passed (>= 80 inclusive)', sub1.ok && sub1.data.subjectAssessment.scorePercent === 100 && sub1.data.subjectAssessment.passed, `${n1} items`);
    mode = 'POOL';
    const a2 = await svc.startSubjectAssignmentAttempt(S1.userId, ivT, deps);
    const fps1 = await fpsOf(a1.quizId);
    const fps2 = await fpsOf(a2.quizId);
    check('RETRY AFTER PASS  attempt 2 starts after a pass; different items, same blueprint', a2.outcome === 'STARTED' && a2.attemptNumber === 2 && fps2.every((f) => !fps1.includes(f)) && fps2.length === fps1.length);
    await answerAll(S1.id, a2.quizId, (i) => (i < 2 ? 'a' : 'b'));
    const sub2 = await subject.submitSubjectAssessmentSession({ studentId: S1.id, quizId: a2.quizId }, deps);
    const list1 = (await svc.listStudentSubjectAssignments(S1.id)).find((x) => x.interventionId === ivT)!;
    check('LAST COMPLETED WINS  a lower later score is the result (not the best, not the average); history keeps both', sub2.ok && sub2.data.subjectAssessment.scorePercent === 50 && list1.result?.attemptNumber === 2 && list1.result.scorePercent === 50 && list1.result.passed === false && list1.history.length === 2 && list1.attemptsUsed === 2, JSON.stringify(list1.result));
    const ev = await all(`SELECT (metadata->>'attemptNumber')::int AS n, count(*)::int AS c FROM learning_evidence WHERE student_id = $1 AND metadata->>'assignmentId' = $2 GROUP BY 1 ORDER BY 1`, [S1.id, ivT]);
    check('EVIDENCE PER ATTEMPT  each completed attempt wrote per-concept evidence with origin TEACHER, assignmentId, attemptNumber', ev.length === 2 && ev.every((e) => e.c === 3), JSON.stringify(ev));
    mode = 'REPLAY';
    const a3 = await svc.startSubjectAssignmentAttempt(S1.userId, ivT, deps);
    const s3setup = (await one(`SELECT subject_assessment_setup s FROM quiz_sessions WHERE id = $1`, [a3.quizId])).s;
    const fps3 = await fpsOf(a3.quizId);
    check('CONTROLLED REUSE  no novel item available -> every item reused, recorded with its pool and last-served time', a3.attemptNumber === 3 && s3setup.reusedItems.length === s3setup.questionCount && s3setup.reusedItems.every((r: any) => !!r.source && 'lastServedAt' in r), JSON.stringify(s3setup.reusedItems.map((r: any) => r.source)));
    check('REUSE ORDER  least recently used first (attempt 1\'s items), the immediately previous attempt avoided', fps3.every((f) => fps1.includes(f)) && fps3.filter((f) => fps2.includes(f)).length === 0 && s3setup.reusedItems.every((r: any) => r.source === 'OWN_LEAST_RECENTLY_USED'), `${fps3.filter((f) => fps1.includes(f)).length} from attempt 1, ${fps3.filter((f) => fps2.includes(f)).length} from attempt 2`);
    await answerAll(S1.id, a3.quizId, () => 'a');
    await subject.submitSubjectAssessmentSession({ studentId: S1.id, quizId: a3.quizId }, deps);
    let exhausted = '';
    try { await svc.startSubjectAssignmentAttempt(S1.userId, ivT, deps); } catch (e: any) { exhausted = e.code; }
    const list1b = (await svc.listStudentSubjectAssignments(S1.id)).find((x) => x.interventionId === ivT)!;
    check('MAX ATTEMPTS  after 3 of 3 no new attempt; status COMPLETED; result = attempt 3', exhausted === 'ATTEMPTS_EXHAUSTED' && list1b.status === 'COMPLETED' && list1b.result?.attemptNumber === 3 && list1b.action.action === 'NONE');

    /* ------------------------------------------------- group equivalence + diversity -> release ------------------------------------------------- */
    mode = 'UNIQUE';
    const classAttempts: Array<{ s: typeof S1; quizId: string }> = [];
    for (const s of [S1, S2, S3]) classAttempts.push({ s, quizId: (await svc.startSubjectAssignmentAttempt(s.userId, ivOf(pClass, s), deps)).quizId });
    const setups = await Promise.all(classAttempts.map(async (a) => (await one(`SELECT subject_assessment_setup s FROM quiz_sessions WHERE id = $1`, [a.quizId])).s));
    check('GROUP EQUIVALENCE  same count, rule, per-concept counts, band, timing for every student (never per-student)', setups.every((st) => rules.plansEquivalent(st, setups[0]) && JSON.stringify(st.difficulty) === JSON.stringify(setups[0].difficulty) && st.timing.timed === setups[0].timing.timed && !st.knowledgeSignals), JSON.stringify(setups.map((x) => x.questionCount)));
    const classFps = await Promise.all(classAttempts.map((a) => fpsOf(a.quizId)));
    const sharedClass = rules.crossStudentSharedFingerprints(classAttempts.map((a, i) => ({ studentId: a.s.id, fingerprints: classFps[i] })));
    check('DIFFERENT VERSIONS  each student got different items (no item shared across students)', sharedClass.size === 0);
    await answerAll(S1.id, classAttempts[0].quizId, (i) => (i % 2 === 0 ? 'a' : 'b'));
    const subC1 = await subject.submitSubjectAssessmentSession({ studentId: S1.id, quizId: classAttempts[0].quizId }, deps);
    check('RELEASE (diverse)  full feedback immediately: per-question review with expected answer + explanation', subC1.ok && subC1.data.feedbackRelease?.level === 'FULL' && subC1.data.review.length > 0 && subC1.data.review.every((r) => !!r.correctAnswer && !!r.explanation));

    // Mock to S1 + S2 from a tiny pool: the second student's version must share items -> answers held until close
    mode = 'POOL';
    const ivM1 = ivOf(pMock, S1);
    const ivM2 = ivOf(pMock, S2);
    const m1 = await svc.startSubjectAssignmentAttempt(S1.userId, ivM1, deps);
    const m2 = await svc.startSubjectAssignmentAttempt(S2.userId, ivM2, deps);
    const m1setup = (await one(`SELECT subject_assessment_setup s FROM quiz_sessions WHERE id = $1`, [m1.quizId])).s;
    const m2setup = (await one(`SELECT subject_assessment_setup s FROM quiz_sessions WHERE id = $1`, [m2.quizId])).s;
    check('MOCK TIMED  the frozen duration (25) and a wall-clock deadline', m1setup.timing.timed && m1setup.timing.durationMinutes === 25 && !!m1setup.timing.deadlineAt && m1setup.feedbackPolicy === 'MOCK_NONE');
    check('GROUP AVOIDANCE  supply short -> S2 reuses S1\'s items, recorded as ASSIGNMENT_GROUP', m2setup.reusedItems.some((r: any) => r.source === 'ASSIGNMENT_GROUP'), JSON.stringify(m2setup.reusedItems.map((r: any) => r.source)));
    await answerAll(S1.id, m1.quizId, () => 'a');
    const subM1 = await subject.submitSubjectAssessmentSession({ studentId: S1.id, quizId: m1.quizId }, deps);
    check('RELEASE (shared items)  score + general performance now, per-question answers / explanations held until close', subM1.ok && subM1.data.feedbackRelease?.level === 'SCORE_ONLY' && subM1.data.review.length === 0 && subM1.data.subjectAssessment.perConcept.length === 3 && typeof subM1.data.subjectAssessment.scorePercent === 'number');
    const readHeld = await subject.readSubjectAssessmentSession(S1.id, m1.quizId, deps);
    check('RELEASE (shared items)  the Student\'s later read is held too', readHeld.ok && readHeld.view.results?.feedbackRelease?.level === 'SCORE_ONLY' && readHeld.view.results.review.length === 0);

    /* ------------------------------------------------------- 21:00 close: finish vs exit ------------------------------------------------------- */
    const past = new Date(Date.now() - 60_000).toISOString();
    const moveClose = async (interventionId: string, closesAt: string) => {
      await db.query(`UPDATE teacher_interventions SET subject_assessment_assignment = jsonb_set(subject_assessment_assignment, '{window,closesAt}', to_jsonb($2::text)), due_at = $2::timestamptz WHERE id = $1`, [interventionId, closesAt]);
      await db.query(`UPDATE quiz_sessions SET subject_assessment_setup = jsonb_set(subject_assessment_setup, '{assignmentWindow,closesAt}', to_jsonb($2::text)) WHERE subject_assessment_setup->>'assignmentId' = $1`, [interventionId, closesAt]);
    };
    // S2 is inside the Mock (heartbeat now) when the window closes: the attempt may be finished after the close
    const hb = await subject.heartbeatSubjectAssessmentSession(S2.id, m2.quizId);
    await moveClose(ivM2, past);
    const ansAfter = await subject.recordSubjectAssessmentAnswer({ studentId: S2.id, quizId: m2.quizId, questionIndex: 0, answer: 'a' }, deps);
    const subM2 = await subject.submitSubjectAssessmentSession({ studentId: S2.id, quizId: m2.quizId }, deps);
    check('ACTIVE AT CLOSE  an attempt started before 21:00 and still live is finished after it (answer saved, SUBMITTED)', hb.ok && hb.data.alive && ansAfter.ok && subM2.ok && subM2.data.subjectAssessment.completionReason === 'SUBMITTED');
    let noNewAfter = '';
    try { await svc.startSubjectAssignmentAttempt(S2.userId, ivM2, deps); } catch (e: any) { noNewAfter = e.code; }
    check('NO NEW ATTEMPT AFTER CLOSE  even with 1 of 2 attempts used', noNewAfter === 'WINDOW_CLOSED');
    await moveClose(ivM1, past);
    const readReleased = await subject.readSubjectAssessmentSession(S1.id, m1.quizId, deps);
    check('RELEASE AT CLOSE  once the window closes the held review is released in full', readReleased.ok && readReleased.view.results?.feedbackRelease?.level === 'FULL' && (readReleased.view.results?.review.length ?? 0) > 0);

    // S3 left the class Test before 21:00 (1 answer saved) and comes back after: closed as is, no resume, no new attempt
    const ivC3 = ivOf(pClass, S3);
    const c3 = classAttempts[2].quizId;
    await subject.recordSubjectAssessmentAnswer({ studentId: S3.id, quizId: c3, questionIndex: 0, answer: 'a' }, deps);
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    await db.query(`UPDATE quiz_sessions SET subject_assessment_setup = jsonb_set(subject_assessment_setup, '{timing,startedAt}', to_jsonb($2::text)) WHERE id = $1`, [c3, tenMinAgo]);
    await db.query(`UPDATE quiz_responses SET created_at = $2::timestamptz WHERE quiz_session_id = $1`, [c3, tenMinAgo]);
    await moveClose(ivC3, new Date(Date.now() - 5 * 60_000).toISOString());
    let resumeAfter = '';
    try { await svc.startSubjectAssignmentAttempt(S3.userId, ivC3, deps); } catch (e: any) { resumeAfter = e.code; }
    const c3read = await subject.readSubjectAssessmentSession(S3.id, c3, deps);
    const c3total = setups[2].questionCount;
    check('EXIT AFTER CLOSE  the left attempt is not resumed: closed as is (WINDOW_CLOSED_AFTER_EXIT), unanswered in the denominator; no new attempt', resumeAfter === 'WINDOW_CLOSED' && c3read.ok && c3read.view.state === 'COMPLETED' && c3read.view.results?.subjectAssessment.completionReason === 'WINDOW_CLOSED_AFTER_EXIT' && c3read.view.results.subjectAssessment.unanswered === c3total - 1 && c3read.view.results.subjectAssessment.total === c3total, c3read.ok ? JSON.stringify({ r: c3read.view.results?.subjectAssessment.completionReason, u: c3read.view.results?.subjectAssessment.unanswered }) : c3read.error);

    // D70 default (resumeAfterInactivity = false): S2 idle 45 min on the class Test BEFORE the close -> closed as is
    // (INACTIVITY_CLOSED, the saved answer graded and kept), the same attempt never resumes; a new attempt may start
    const c2 = classAttempts[1].quizId;
    await subject.recordSubjectAssessmentAnswer({ studentId: S2.id, quizId: c2, questionIndex: 0, answer: 'a' }, deps);
    await subject.recordSubjectAssessmentAnswer({ studentId: S2.id, quizId: c2, questionIndex: 1, answer: 'b' }, deps);
    await db.query(`UPDATE quiz_sessions SET status = 'expired', expires_at = now() - interval '1 minute' WHERE id = $1`, [c2]);
    const c2frozen = (await one(`SELECT subject_assessment_setup s FROM quiz_sessions WHERE id = $1`, [c2])).s;
    const next = await svc.startSubjectAssignmentAttempt(S2.userId, ivOf(pClass, S2), deps);
    const c2read = await subject.readSubjectAssessmentSession(S2.id, c2, deps);
    check('D70 DEFAULT FALSE  idle 45 min before the close -> closed with the saved answer (INACTIVITY_CLOSED), the same attempt is not resumed; a new attempt starts',
      c2frozen.assignmentWindow?.resumeAfterInactivity === false && next.outcome === 'STARTED' && next.quizId !== c2 && next.attemptNumber === 2 && c2read.ok && c2read.view.state === 'COMPLETED'
        && c2read.view.results?.subjectAssessment.completionReason === 'INACTIVITY_CLOSED',
      c2read.ok ? JSON.stringify({ o: next.outcome, r: c2read.view.results?.subjectAssessment.completionReason }) : c2read.error);
    const c2sa = c2read.ok ? c2read.view.results?.subjectAssessment : null;
    check('D72 SCORE  the saved answers are graded (1 correct, 1 incorrect) and the unanswered stay in the denominator',
      !!c2sa && c2sa.correct === 1 && c2sa.incorrect === 1 && c2sa.unanswered === c2sa.total - 2 && c2sa.scorePercent === subjectScore(1, c2sa.total), JSON.stringify(c2sa && { c: c2sa.correct, i: c2sa.incorrect, u: c2sa.unanswered, t: c2sa.total, s: c2sa.scorePercent }));
    let c2again = '';
    const c2resume = await svc.startSubjectAssignmentAttempt(S2.userId, ivOf(pClass, S2), deps).catch((e: any) => { c2again = e.code; return null; });
    check('D72 CONSUMED + NO RESUME  the closed attempt used 1 of 2 attempts; starting again resumes the NEW attempt, never the closed one', !!c2resume && c2resume.outcome === 'RESUMED' && c2resume.quizId === next.quizId && c2resume.attemptNumber === 2, c2again);
    await answerAll(S2.id, next.quizId, () => 'a');
    await subject.submitSubjectAssessmentSession({ studentId: S2.id, quizId: next.quizId }, deps);

    // D70 resumeAfterInactivity = true (explicit teacher choice): the same attempt resumes before the close, answers kept
    const pResume = await svc.publishSubjectAssessmentAssignment(teacher, { classId: klass, kind: 'TEST', conceptIds: concepts, difficulty: 'BASICO', startDate: today, endDate: plusDays(today, 1), maxAttempts: 1, timing: { timed: false, durationMinutes: null, resumeAfterInactivity: true }, studentIds: [S2.id], requestId: randomUUID() });
    const ivR = ivOf(pResume, S2);
    const r1 = await svc.startSubjectAssignmentAttempt(S2.userId, ivR, deps);
    await subject.recordSubjectAssessmentAnswer({ studentId: S2.id, quizId: r1.quizId, questionIndex: 0, answer: 'a' }, deps);
    await db.query(`UPDATE quiz_sessions SET status = 'expired', expires_at = now() - interval '1 minute' WHERE id = $1`, [r1.quizId]);
    const resumed = await svc.startSubjectAssignmentAttempt(S2.userId, ivR, deps);
    const rRead = await subject.readSubjectAssessmentSession(S2.id, r1.quizId, deps);
    const rAttempts = Number((await one(`SELECT count(*) n FROM quiz_sessions WHERE subject_assessment_setup->>'assignmentId' = $1`, [ivR])).n);
    check('D70 TRUE  idle before the close -> the same attempt resumes (no extra attempt), the saved answer is preserved', resumed.outcome === 'RESUMED' && resumed.quizId === r1.quizId && rRead.ok && rRead.view.state === 'ACTIVE' && (rRead.view.answered ?? []).some((a) => a.questionIndex === 0) && rAttempts === 1);
    // ...but true never overrides the post-21:00 rule: idle again, then the window closes -> closed as is, no resume
    await db.query(`UPDATE quiz_sessions SET status = 'expired', expires_at = now() - interval '1 minute' WHERE id = $1`, [r1.quizId]);
    await moveClose(ivR, past);
    let afterClose = '';
    try { await svc.startSubjectAssignmentAttempt(S2.userId, ivR, deps); } catch (e: any) { afterClose = e.code; }
    const rClosed = await subject.readSubjectAssessmentSession(S2.id, r1.quizId, deps);
    check('D70 TRUE NEVER OVERRIDES 21:00  after the close the idle attempt is closed as is (WINDOW_CLOSED_AFTER_EXIT), no resume', afterClose === 'WINDOW_CLOSED' && rClosed.ok && rClosed.view.state === 'COMPLETED' && rClosed.view.results?.subjectAssessment.completionReason === 'WINDOW_CLOSED_AFTER_EXIT', rClosed.ok ? String(rClosed.view.results?.subjectAssessment.completionReason) : rClosed.error);

    /* ------------------------------------------------------------ teacher read models ------------------------------------------------------------ */
    const groups = await svc.listClassSubjectAssessmentAssignments(teacher, klass);
    check('TEACHER LIST  the class shows its subject assignments (5 groups, incl. the D70 resume one) with recipients and completion', groups.length === 5 && groups.some((g) => g.assignmentGroupId === pClass.assignmentGroupId && g.recipients === 3 && g.completedStudents === 3));
    const gr = await svc.getSubjectAssessmentGroupResults(teacher, klass, pClass.assignmentGroupId);
    const avg = Math.round(((gr.students.map((s) => s.latest!.scorePercent).reduce((a, b) => a + b, 0)) / 3) * 10) / 10;
    check('GROUP VIEW  per-student latest score, average, distribution, attempts used / max', gr.students.length === 3 && gr.students.every((s) => s.latest && s.maxAttempts === 2 && s.attemptsUsed === (s.studentId === S2.id ? 2 : 1)) && gr.averageScorePercent === avg && Object.values(gr.distribution).reduce((a, b) => a + b, 0) === 3, JSON.stringify({ avg: gr.averageScorePercent, dist: gr.distribution }));
    check('GROUP VIEW  performance by concept (3 canonical concepts pooled), difficulty, strongest / gaps, high-error areas', gr.perConcept.length === 3 && gr.perConcept.every((c) => !!c.conceptName) && gr.difficultyBand === 'MIXED' && gr.servedDifficultyMean !== null && Array.isArray(gr.strongestConcepts) && Array.isArray(gr.largestGaps) && Array.isArray(gr.highErrorAreas) && gr.versions.sharedItemCount === 0);
    const drill = await svc.getSubjectAssessmentStudentResult(teacher, klass, reqOne, S1.id);
    check('DRILL-DOWN  result = latest completed attempt; by concept; response by question with expected answer and explanation; history of 3', drill.result?.attemptNumber === 3 && drill.result.perConcept.length === 3 && drill.result.responses.length === 4 && drill.result.responses.every((r) => !!r.correctAnswer && !!r.explanation) && drill.history.length === 3 && drill.history.map((h) => h.scorePercent).join(',') === '100,50,100');

    /* ---------------------------------------------------------------- isolation ---------------------------------------------------------------- */
    let strangerGroup = '';
    try { await svc.getSubjectAssessmentGroupResults(stranger, klass, pClass.assignmentGroupId); } catch (e: any) { strangerGroup = e instanceof TeacherClassAccessDeniedError ? 'FORBIDDEN' : e.code; }
    let strangerDrill = '';
    try { await svc.getSubjectAssessmentStudentResult(stranger, klass, reqOne, S1.id); } catch (e: any) { strangerDrill = e instanceof TeacherClassAccessDeniedError ? 'FORBIDDEN' : e.code; }
    check('ISOLATION  a teacher of another class cannot read the group or the drill-down', strangerGroup === 'FORBIDDEN' && strangerDrill === 'FORBIDDEN');
    let wrongGroup = '';
    try { await svc.getSubjectAssessmentStudentResult(teacher, klass, pClass.assignmentGroupId, randomUUID()); } catch (e: any) { wrongGroup = e.code; }
    check('ISOLATION  a student who is not a recipient of the group is NOT_FOUND', wrongGroup === 'NOT_FOUND');
    let otherStudentStart = '';
    try { await svc.startSubjectAssignmentAttempt(S2.userId, ivT, deps); } catch (e: any) { otherStudentStart = e.code; }
    let teacherStart = '';
    try { await svc.startSubjectAssignmentAttempt(teacher, ivT, deps); } catch (e: any) { teacherStart = e.code; }
    check('ISOLATION  another student and the teacher cannot start / resume a student\'s attempt (owner only)', otherStudentStart === 'FORBIDDEN' && teacherStart === 'FORBIDDEN');
    const crossRead = await subject.readSubjectAssessmentSession(S2.id, a1.quizId, deps);
    const crossHb = await subject.heartbeatSubjectAssessmentSession(S2.id, a1.quizId);
    check('ISOLATION  a student cannot read another student\'s version / result', !crossRead.ok && crossRead.error === 'NOT_FOUND' && !crossHb.ok);
    const s2list = await svc.listStudentSubjectAssignments(S2.id);
    check('ISOLATION  a student\'s list holds only their own assignments', s2list.length === 3 && !s2list.some((x) => x.interventionId === ivT));
    const ownList = await subject.listStudentSubjectAssessments(S1.id);
    check('SEPARATION  teacher-assigned attempts are not in the Student\'s own "Mis evaluaciones programadas"', ownList.every((i) => i.origin !== 'TEACHER'));

    /* ------------------------------------- D73: pre-publication timezone validation, no partial publication ------------------------------------- */
    // the no-timezone institution's class gets a second learner who HAS their own timezone; S1 has none -> blocked
    await db.query(`INSERT INTO class_enrollments (class_id, student_id, status) VALUES ($1, $2, 'ACTIVE')`, [klassNoTz, S2.id]);
    await db.query(`INSERT INTO student_availability (student_id, timezone) VALUES ($1, 'America/Lima') ON CONFLICT (student_id) DO UPDATE SET timezone = EXCLUDED.timezone`, [S2.id]);
    const d73draft = { classId: klassNoTz, kind: 'TEST' as const, conceptIds: concepts, difficulty: 'BASICO' as const, startDate: today, endDate: plusDays(today, 1), maxAttempts: 1, timing: { timed: false, durationMinutes: null } };
    let d73err: any = null;
    try { await svc.publishSubjectAssessmentAssignment(teacher, { ...d73draft, requestId: randomUUID() }); } catch (e: any) { d73err = e; }
    const d73rows = Number((await one(`SELECT count(*) n FROM teacher_interventions WHERE class_id = $1`, [klassNoTz])).n);
    check('D73 BLOCKED  1 valid + 1 invalid recipient -> the publication is blocked, the invalid student is named, 0 recipient rows (no partial publication)',
      d73err?.code === 'TIMEZONE_AUTHORITY_BLOCKER' && d73err?.detail?.invalidRecipientCount === 1 && d73err?.detail?.invalidRecipientIds?.[0] === S1.id && typeof d73err?.detail?.invalidRecipients?.[0]?.name === 'string' && d73rows === 0,
      JSON.stringify({ code: d73err?.code, n: d73err?.detail?.invalidRecipientCount, rows: d73rows }));
    // the profile is corrected -> the teacher retries -> validation re-runs -> published, each window in the student's own zone
    await db.query(`INSERT INTO student_availability (student_id, timezone) VALUES ($1, 'America/Bogota') ON CONFLICT (student_id) DO UPDATE SET timezone = EXCLUDED.timezone`, [S1.id]);
    const d73ok = await svc.publishSubjectAssessmentAssignment(teacher, { ...d73draft, requestId: randomUUID() });
    const d73windows = (await db.query(`SELECT student_id, subject_assessment_assignment->'window'->>'timezone' AS tz, subject_assessment_assignment->'window'->>'timezoneSource' AS src FROM teacher_interventions WHERE class_id = $1`, [klassNoTz])).rows;
    check('D73 RETRY  after the correction the retry publishes to every recipient, each window in their own timezone (STUDENT_AVAILABILITY)',
      d73ok.assigned.length === 2 && d73windows.length === 2 && d73windows.every((w: any) => w.src === 'STUDENT_AVAILABILITY') && d73windows.find((w: any) => w.student_id === S2.id)?.tz === 'America/Lima' && d73windows.find((w: any) => w.student_id === S1.id)?.tz === 'America/Bogota',
      JSON.stringify(d73windows.map((w: any) => w.tz)));
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
            + (SELECT count(*) FROM teacher_interventions WHERE class_id = ANY($3::uuid[])) + (SELECT count(*) FROM students WHERE id = ANY($4::uuid[])) AS n`,
      [created.users, created.institutions, created.classes, created.students]
    )).n);
    check('CLEANUP  every fixture (institutions, classes, users, students, assignments, attempts, evidence) is removed', remaining === 0 && left === 0, `remaining ${remaining} + ${left}`);
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

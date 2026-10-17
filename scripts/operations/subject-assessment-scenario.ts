/**
 * Overnight 2026-10-16 -- subject Test ("Prueba por materia") / Mock ("Simulacro por materia") scenario with the REAL
 * services and a real database (DEV only).
 *
 * Every service is the production one (planning over the real Knowledge State rows, storeQuiz, the frozen setup,
 * start / answer / submit, deterministic structured grading, updateMastery evidence, the Tutor guard listing). The ONLY
 * substitution is the item generator: a deterministic stub that writes single-choice items (so counts, distribution,
 * novelty and grading are checkable, and no provider is called). SUBJECT_SCENARIO_REAL_AI=1 additionally creates one
 * Test with the real gated generator (provider calls; Learning runtime usage).
 *
 * Fixtures (`cfl-subj-<run>`: one Student, three subjects, concepts, one Knowledge State row) and everything that
 * references them are removed at the end (curriculum-first-fixture-cleanup).
 *   CURRICULUM_CONVERGENCE_FP=2a29b99ee14a22b4 npx tsx --env-file=<dev env> scripts/operations/subject-assessment-scenario.ts
 */
import { createHash, randomBytes } from 'crypto';

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
  if (fp !== DEV || process.env.CURRICULUM_CONVERGENCE_FP !== fp) throw new Error(`REFUSING: database ${fp} (DEV only)`);
  const { db } = await import('@/lib/db');
  const svc = await import('@/services/subject-assessment.service');
  const life = await import('@/lib/subject-assessment/lifecycle');
  const { getStudentActiveQuizzes } = await import('@/services/quiz-persistence.service');
  const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
  const all = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as any[];
  console.log(`subject assessment scenario -- db ${fp} -- run ${RUN}`);

  // deterministic stub generator: single-choice items, correct option 'a'. The first item of a multi-item call always
  // repeats the same text, so a later session for that concept meets an item the Student has already been served.
  let counter = 0;
  const generatorCalls: Array<{ conceptId: string; count: number; difficulty: number }> = [];
  const generate = async (a: { conceptId: string; count: number; difficulty: number }) => {
    generatorCalls.push({ conceptId: a.conceptId, count: a.count, difficulty: a.difficulty });
    return Array.from({ length: a.count }, (_, i) => {
      const text = i === 0 && a.count >= 2 ? `Pregunta fija del concepto ${a.conceptId}` : `Pregunta ${++counter} del concepto ${a.conceptId}`;
      return {
        id: `stub-${RUN}-${++counter}`, conceptId: a.conceptId, type: 'multiple_choice', answerFormat: 'single_choice', question: text,
        options: [{ id: 'a', text: 'Correcta' }, { id: 'b', text: 'Incorrecta' }, { id: 'c', text: 'Otra' }, { id: 'd', text: 'Ninguna' }],
        correctAnswer: 'a', explanation: `La opción correcta es "Correcta" (${text}).`, difficulty: a.difficulty,
      } as any;
    });
  };
  const deps = { generate };

  const S = (await one(`INSERT INTO students (clerk_id, email, name, language) VALUES ($1, $2, 'cfl subj', 'es') RETURNING id`, [`cfl-subj-${RUN}`, `cfl-subj-${RUN}@curriculum-first.test`])).id as string;
  try {
    await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', 'cfl subj')`, [S]);
    await db.query(`INSERT INTO student_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [S]);
    await db.query(`INSERT INTO student_availability (student_id, timezone) VALUES ($1, 'America/Bogota') ON CONFLICT (student_id) DO UPDATE SET timezone = EXCLUDED.timezone`, [S]);
    const mkSubject = async (name: string, n: number) => {
      const subject = (await one(`INSERT INTO subjects (student_id, name, status) VALUES ($1, $2, 'active') RETURNING id`, [S, `${name} ${RUN}`])).id as string;
      const concepts: string[] = [];
      for (let i = 0; i < n; i++) {
        const c = (await one(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [subject, `SUBJ_${RUN}_${name}_${i}`.toUpperCase()])).id as string;
        await db.query(`INSERT INTO concept_localizations (concept_id, language, label) VALUES ($1, 'es', $2)`, [c, `${name} concepto ${i + 1}`]);
        concepts.push(c);
      }
      return { subject, concepts };
    };
    const A = await mkSubject('Mate', 4); // generation scenarios
    const B = await mkSubject('Grande', 51); // max-50 / count-table plans
    const C = await mkSubject('Treinta', 30); // all-subject mock cap 50
    // Knowledge State: concept 0 of A is validated (no need), the others have no row (insufficient evidence -> need)
    const policyVersion = (await one(`SELECT max(version)::int AS v FROM mastery_policies`)).v as number;
    await db.query(
      `INSERT INTO concept_knowledge_state (student_id, concept_id, subject_id, mastery_state, understanding_score, independence_score, evidence_count, independent_evidence_count, validation_readiness, mastery_policy_version)
       VALUES ($1, $2, $3, 'VALIDATED_MASTERY', 95, 95, 12, 8, 'READY', $4)`,
      [S, A.concepts[0], A.subject, policyVersion],
    );

    /* ------------------------------------------------ planning rules (real KS reads) ------------------------------------------------ */
    const planOf = async (kind: 'TEST' | 'MOCK', subject: string, conceptIds: string[]) => svc.planSubjectAssessment({ studentId: S, subjectId: subject, kind, origin: 'STUDENT', conceptIds });
    const tp = await planOf('TEST', A.subject, A.concepts);
    check('ADAPTIVE COUNT  Test count follows the Knowledge State (1 validated + 3 in need -> 1 + 2*3 = 7)', tp.ok && tp.plan.questionCount === 7, tp.ok ? `${tp.plan.questionCount} ${tp.plan.rule}` : tp.error);
    check('KS-AWARE DISTRIBUTION  the validated concept gets 1, concepts in need get 2', tp.ok && tp.plan.distribution[A.concepts[0]] === 1 && A.concepts.slice(1).every((c) => tp.plan.distribution[c] === 2), tp.ok ? JSON.stringify(Object.values(tp.plan.distribution)) : '');
    check('KS-AWARE DISTRIBUTION  reasons recorded (NO_KNOWLEDGE_STATE for the unassessed ones)', tp.ok && tp.plan.knowledgeSignals![A.concepts[1]].reasons.includes('NO_KNOWLEDGE_STATE') && tp.plan.knowledgeSignals![A.concepts[0]].needsReinforcement === false);
    const t51 = await planOf('TEST', B.subject, B.concepts);
    check('MAX 50  a Test over 51 concepts is refused (every selected concept must appear)', !t51.ok && t51.error === 'TOO_MANY_CONCEPTS');
    const t50 = await planOf('TEST', B.subject, B.concepts.slice(0, 50));
    check('MAX 50  a Test over 50 concepts in need is capped at 50 with every concept once', t50.ok && t50.plan.questionCount === 50 && B.concepts.slice(0, 50).every((c) => t50.plan.distribution[c] >= 1));
    const mockCount = async (n: number, subject = B) => { const r = await planOf('MOCK', subject.subject, subject.concepts.slice(0, n)); return r.ok ? r.plan.questionCount : -1; };
    check('MOCK COUNT  1 concept = 5', (await mockCount(1)) === 5);
    check('MOCK COUNT  2-5 concepts = 2/concept, cap 10', (await mockCount(2)) === 4 && (await mockCount(3)) === 6 && (await mockCount(5)) === 10);
    check('MOCK COUNT  6-10 concepts = 2/concept, cap 20', (await mockCount(6)) === 12 && (await mockCount(10)) === 20);
    check('MOCK COUNT  11-15 concepts = 2/concept, cap 30', (await mockCount(11)) === 22 && (await mockCount(15)) === 30);
    const mAll = await planOf('MOCK', C.subject, C.concepts);
    check('MOCK COUNT  all subject (30 concepts) = cap 50, band ALL_SUBJECT', mAll.ok && mAll.plan.questionCount === 50 && mAll.plan.mockBand === 'ALL_SUBJECT' && mAll.plan.allSubject === true);
    const mPart = await planOf('MOCK', B.subject, B.concepts.slice(0, 20));
    check('MOCK COUNT  20 concepts, not the whole subject -> OVER_15_PARTIAL (reported), cap 50', mPart.ok && mPart.plan.questionCount === 40 && mPart.plan.mockBand === 'OVER_15_PARTIAL');
    check('REPRESENTATIVE DISTRIBUTION  the mock is uniform (max - min <= 1) and ignores the Knowledge State', mAll.ok && Math.max(...Object.values(mAll.plan.distribution)) - Math.min(...Object.values(mAll.plan.distribution)) <= 1 && !mAll.plan.knowledgeSignals);
    const mA = await planOf('MOCK', A.subject, A.concepts);
    check('REPRESENTATIVE DISTRIBUTION  the validated concept gets the same share as the others in a mock', mA.ok && new Set(Object.values(mA.plan.distribution)).size === 1);
    const empty = await planOf('TEST', A.subject, []);
    check('AT LEAST ONE CONCEPT  an empty selection is refused', !empty.ok && empty.error === 'NO_CONCEPTS_SELECTED');

    /* ---------------------------------------------------- Test, DO NOW ---------------------------------------------------- */
    const testNow = await svc.createSubjectAssessmentSession({ studentId: S, subjectId: A.subject, kind: 'TEST', origin: 'STUDENT', conceptIds: A.concepts, schedule: { mode: 'NOW' }, timing: { timed: false, durationMinutes: null }, language: 'es' }, deps);
    check('STUDENT CREATES  a Test is created by the Student (origin STUDENT, difficulty AUTO, frozen)', testNow.ok && testNow.setup.origin === 'STUDENT' && 'mode' in testNow.setup.difficulty && testNow.setup.difficulty.mode === 'AUTO' && !!testNow.setup.frozenAt, testNow.ok ? testNow.quizId : testNow.error);
    if (!testNow.ok) throw new Error('cannot continue without the Test');
    const tRow = await one(`SELECT subject_assessment_setup AS s, questions, expires_at, created_at, status FROM quiz_sessions WHERE id = $1`, [testNow.quizId]);
    check('DO NOW  the attempt starts immediately (startedAt frozen, state ACTIVE, questions served)', !!tRow.s.timing.startedAt && testNow.view.state === 'ACTIVE' && testNow.view.questions?.length === 7);
    check('ALL SELECTED CONCEPTS COVERED  the frozen blueprint equals the plan (every concept present)', life.blueprintMatches(tRow.s.distribution, tRow.s.blueprint) && A.concepts.every((c) => tRow.s.blueprint[c] >= 1));
    check('EXACT DISTRIBUTION  each concept was generated at exactly its planned count (no ceil-per-concept truncation)', tp.ok && A.concepts.every((c) => (tRow.questions as any[]).filter((q) => q.conceptId === c).length === tp.plan.distribution[c]));
    check('TEST UNTIMED  a Student Test has no timer; feedback policy TEST_CORRECTNESS_ONLY; one attempt', tRow.s.timing.timed === false && tRow.s.timing.durationMinutes === null && tRow.s.feedbackPolicy === 'TEST_CORRECTNESS_ONLY' && tRow.s.maxAttempts === 1);
    check('NO RECOMMENDED DATE  the frozen setup carries no recommendedDate keys', !('recommendedDate' in tRow.s) && !('recommendedDateStatus' in tRow.s));
    check('OWN EXPIRY  the untimed Test is not on the 45-minute creation TTL alone (inactivity window from start)', new Date(tRow.expires_at).getTime() - new Date(tRow.s.timing.startedAt).getTime() >= 45 * 60_000 - 5_000);

    const tq = tRow.questions as any[];
    const ans0 = await svc.recordSubjectAssessmentAnswer({ studentId: S, quizId: testNow.quizId, questionIndex: 0, answer: 'a' }, deps);
    const ans1 = await svc.recordSubjectAssessmentAnswer({ studentId: S, quizId: testNow.quizId, questionIndex: 1, answer: 'b' }, deps);
    const keys = (r: any) => (r.ok ? Object.keys(r.data).sort().join(',') : r.error);
    check('IMMEDIATE CORRECT/INCORRECT ONLY (Test)  an answer returns exactly { saved, correct } -- no explanation, hint or answer', ans0.ok && keys(ans0) === 'correct,saved' && (ans0 as any).data.correct === true && ans1.ok && (ans1 as any).data.correct === false && keys(ans1) === 'correct,saved');
    const ans1b = await svc.recordSubjectAssessmentAnswer({ studentId: S, quizId: testNow.quizId, questionIndex: 1, answer: 'a' }, deps);
    check('IMMEDIATE CORRECT/INCORRECT ONLY (Test)  the first answer is final (a changed answer keeps the recorded verdict)', ans1b.ok && (ans1b as any).data.correct === false && (ans1b as any).data.locked === true);
    // answer the rest correctly except two left UNANSWERED
    for (let i = 2; i < tq.length - 2; i++) await svc.recordSubjectAssessmentAnswer({ studentId: S, quizId: testNow.quizId, questionIndex: i, answer: 'a' }, deps);
    const guardBefore = await getStudentActiveQuizzes(S);
    check('TUTOR GUARD  a started Test restricts the Tutor (listed as active)', guardBefore.some((q) => q.id === testNow.quizId));
    const sub = await svc.submitSubjectAssessmentSession({ studentId: S, quizId: testNow.quizId, answers: [] }, deps);
    const expectedCorrect = 1 + (tq.length - 4); // q0 + q2..q(n-3)
    check('UNANSWERED DENOMINATOR (Test)  score = correct / ALL questions (2 unanswered count as 0)', sub.ok && sub.data.subjectAssessment.unanswered === 2 && sub.data.subjectAssessment.total === 7 && sub.data.subjectAssessment.correct === expectedCorrect && sub.data.subjectAssessment.scorePercent === Math.round((expectedCorrect / 7) * 1000) / 10, sub.ok ? JSON.stringify({ c: sub.data.subjectAssessment.correct, u: sub.data.subjectAssessment.unanswered, s: sub.data.subjectAssessment.scorePercent }) : sub.error);
    check('PASS RULE  >= 80 inclusive (4/7 = 57.1 -> not passed)', sub.ok && sub.data.subjectAssessment.passed === (sub.data.subjectAssessment.scorePercent >= 80) && sub.data.subjectAssessment.passPercent === 80);
    const rv = sub.ok ? sub.data.review : [];
    check('DETAILED FINAL FEEDBACK  every question: CORRECT / INCORRECT / UNANSWERED, expected answer and explanation', rv.length === 7 && rv.filter((r) => r.status === 'UNANSWERED').length === 2 && rv.filter((r) => r.status === 'INCORRECT').length === 1 && rv.every((r) => r.correctAnswer === 'Correcta' && r.explanation.length > 0));
    check('DETAILED FINAL FEEDBACK  per-concept performance and concepts to reinforce', sub.ok && sub.data.subjectAssessment.perConcept.length === 4 && sub.data.subjectAssessment.conceptsToReinforce.length >= 1 && sub.data.subjectAssessment.perConcept.every((c) => typeof c.scorePercent === 'number' && !!c.conceptLabel));
    const evT = await all(`SELECT concept_id, score_percent, metadata FROM learning_evidence WHERE student_id = $1 AND metadata->'subjectAssessment'->>'quizSessionId' = $2`, [S, testNow.quizId]);
    check('EVIDENCE (Test)  one CUMULATIVE_ASSESSMENT row per concept with origin and its scorePercent', evT.length === 4 && evT.every((e) => e.metadata.activityType === 'CUMULATIVE_ASSESSMENT' && e.metadata.origin === 'STUDENT' && Number(e.score_percent) === e.metadata.scorePercent && sub.ok && sub.data.subjectAssessment.perConcept.find((p) => p.conceptId === e.concept_id)?.scorePercent === Number(e.score_percent)), JSON.stringify(evT.map((e) => Number(e.score_percent))));
    const again = await svc.submitSubjectAssessmentSession({ studentId: S, quizId: testNow.quizId, answers: [{ questionIndex: 5, answer: 'a' }] }, deps);
    const evT2 = await all(`SELECT 1 FROM learning_evidence WHERE student_id = $1 AND metadata->'subjectAssessment'->>'quizSessionId' = $2`, [S, testNow.quizId]);
    check('ONE ATTEMPT  a submitted assessment cannot be resubmitted (alreadySubmitted, same result, no new evidence)', again.ok && again.alreadySubmitted === true && sub.ok && again.data.subjectAssessment.scorePercent === sub.data.subjectAssessment.scorePercent && evT2.length === 4);
    const restart = await svc.startSubjectAssessmentSession(S, testNow.quizId);
    check('ONE ATTEMPT  a completed assessment cannot be started again (ATTEMPT_ALREADY_USED)', !restart.ok && restart.error === 'ATTEMPT_ALREADY_USED');
    const readDone = await svc.readSubjectAssessmentSession(S, testNow.quizId, deps);
    check('FINAL FEEDBACK ON READ  a completed assessment shows its final feedback (no questions to answer)', readDone.ok && readDone.view.state === 'COMPLETED' && !readDone.view.questions && readDone.view.results?.review.length === 7);

    /* -------------------------------------------- novelty: a second Test avoids seen items -------------------------------------------- */
    const test2 = await svc.createSubjectAssessmentSession({ studentId: S, subjectId: A.subject, kind: 'TEST', origin: 'STUDENT', conceptIds: [A.concepts[1]], schedule: { mode: 'NOW' }, timing: { timed: false, durationMinutes: null }, language: 'es' }, deps);
    const t2q = test2.ok ? (await one(`SELECT questions, subject_assessment_setup AS s FROM quiz_sessions WHERE id = $1`, [test2.quizId])) : null;
    check('NOVELTY  a new assessment avoids the items the Student has already been served (the seen item offered again is rejected)', !!t2q && !(t2q.questions as any[]).some((q) => q.question === `Pregunta fija del concepto ${A.concepts[1]}`) && t2q.s.priorFingerprintCount > 0 && t2q.s.reusedItems.length === 0, t2q ? `prior=${t2q.s.priorFingerprintCount} reused=${t2q.s.reusedItems.length} count=${t2q.s.questionCount}` : '');
    // a generator that can only produce items the Student was already served: they are reused and RECORDED
    const servedA1 = (await all(`SELECT questions FROM quiz_sessions WHERE student_id = $1`, [S])).flatMap((r) => r.questions as any[]).filter((q) => q.conceptId === A.concepts[1]);
    let servedIdx = 0;
    const seenOnly = { generate: async (a: { conceptId: string; count: number }) => Array.from({ length: a.count }, () => ({ ...servedA1[servedIdx++ % servedA1.length], id: `seen-${RUN}-${servedIdx}` })) };
    const test4 = await svc.createSubjectAssessmentSession({ studentId: S, subjectId: A.subject, kind: 'TEST', origin: 'STUDENT', conceptIds: [A.concepts[1]], schedule: { mode: 'NOW' }, timing: { timed: false, durationMinutes: null }, language: 'es' }, seenOnly);
    check('NOVELTY  when supply is short of novel items, seen items are reused and RECORDED in the setup (never silent)', test4.ok && test4.setup.reusedItems.length === test4.setup.questionCount && test4.setup.reusedItems.every((r) => r.conceptId === A.concepts[1]), test4.ok ? `reused ${test4.setup.reusedItems.length}/${test4.setup.questionCount} of ${servedA1.length} served` : test4.error);
    // a generator that can ONLY produce seen items: reuse is recorded, never silent
    const onlySeen = { generate: async (a: { conceptId: string; count: number; difficulty: number }) => (await generate({ ...a, count: 1 })).slice(0, 1).concat([]).map((q) => ({ ...q, question: `Pregunta fija del concepto ${a.conceptId}` })) };
    const test3 = await svc.createSubjectAssessmentSession({ studentId: S, subjectId: A.subject, kind: 'MOCK', origin: 'STUDENT', conceptIds: [A.concepts[2]], schedule: { mode: 'SCHEDULED', date: life.localDateIn('America/Bogota', new Date()) }, timing: { timed: true, durationMinutes: null }, language: 'es' }, onlySeen);
    check('HONEST FAILURE  when generation cannot reach the planned count nothing is created (no shrink)', !test3.ok && test3.error === 'GENERATION_INSUFFICIENT', test3.ok ? 'created' : JSON.stringify(test3.detail));

    /* ------------------------------------------- Test SCHEDULED: early start + expiry ------------------------------------------- */
    const today = life.localDateIn('America/Bogota', new Date());
    const tomorrow = new Date(Date.now() + 36 * 3600_000);
    const tomorrowLocal = life.localDateIn('America/Bogota', tomorrow);
    const sched = await svc.createSubjectAssessmentSession({ studentId: S, subjectId: A.subject, kind: 'TEST', origin: 'STUDENT', conceptIds: A.concepts.slice(0, 2), schedule: { mode: 'SCHEDULED', date: tomorrowLocal }, timing: { timed: false, durationMinutes: null }, language: 'es', browserTimezone: 'Europe/Madrid' }, deps);
    const sRow = sched.ok ? await one(`SELECT subject_assessment_setup AS s, expires_at FROM quiz_sessions WHERE id = $1`, [sched.quizId]) : null;
    check('SCHEDULED  created and frozen, not started, no questions served yet', sched.ok && sched.view.state === 'SCHEDULED_NOT_STARTED' && !sched.view.questions && !!sRow && !sRow.s.timing.startedAt);
    check('SCHEDULED  expires at the END of the selected local date in the Student\'s timezone (student_availability, not the browser)', !!sRow && sRow.s.schedule.timezone === 'America/Bogota' && sRow.s.timezoneSource === 'STUDENT_AVAILABILITY' && new Date(sRow.expires_at).toISOString() === life.endOfLocalDateUtc(tomorrowLocal, 'America/Bogota').toISOString(), sRow ? new Date(sRow.expires_at).toISOString() : '');
    const guardSched = await getStudentActiveQuizzes(S);
    check('SCHEDULED  a not-started scheduled assessment does not restrict the Tutor', sched.ok && !guardSched.some((q) => q.id === sched.quizId));
    const ansBefore = sched.ok ? await svc.recordSubjectAssessmentAnswer({ studentId: S, quizId: sched.quizId, questionIndex: 0, answer: 'a' }, deps) : null;
    check('SCHEDULED  answers are refused before it is started', !!ansBefore && !ansBefore.ok && ansBefore.error === 'SESSION_NOT_ACTIVE');
    const early = sched.ok ? await svc.startSubjectAssessmentSession(S, sched.quizId) : null;
    check('EARLY START  a scheduled assessment can be started before its date and is then active', !!early && early.ok && early.view.state === 'ACTIVE' && (early.view.questions?.length ?? 0) === (sched.ok ? sched.setup.questionCount : -1));
    const early2 = sched.ok ? await svc.startSubjectAssessmentSession(S, sched.quizId) : null;
    check('EARLY START  starting again resumes the same attempt (never restarts it)', !!early2 && early2.ok && !!early && early.ok && early2.view.setup.timing.startedAt === early.view.setup.timing.startedAt);
    // a scheduled assessment for TODAY that is never taken: past the end of the date it EXPIRES (simulated by moving its
    // frozen expiry into the past -- a fixture row of this run only)
    const schedToday = await svc.createSubjectAssessmentSession({ studentId: S, subjectId: A.subject, kind: 'TEST', origin: 'STUDENT', conceptIds: [A.concepts[3]], schedule: { mode: 'SCHEDULED', date: today }, timing: { timed: false, durationMinutes: null }, language: 'es' }, deps);
    if (schedToday.ok) await db.query(`UPDATE quiz_sessions SET expires_at = now() - interval '1 minute' WHERE id = $1 AND student_id = $2`, [schedToday.quizId, S]);
    const expRead = schedToday.ok ? await svc.readSubjectAssessmentSession(S, schedToday.quizId, deps) : null;
    const expStart = schedToday.ok ? await svc.startSubjectAssessmentSession(S, schedToday.quizId) : null;
    const expSubmit = schedToday.ok ? await svc.submitSubjectAssessmentSession({ studentId: S, quizId: schedToday.quizId, answers: [{ questionIndex: 0, answer: 'a' }] }, deps) : null;
    const expEv = schedToday.ok ? await all(`SELECT 1 FROM learning_evidence WHERE student_id = $1 AND metadata->'subjectAssessment'->>'quizSessionId' = $2`, [S, schedToday.quizId]) : [{}];
    check('SCHEDULED EXPIRY  not taken on its date -> EXPIRED; cannot start (410) or submit (410); no evidence', !!expRead && expRead.ok && expRead.view.state === 'EXPIRED' && !!expStart && !expStart.ok && expStart.status === 410 && !!expSubmit && !expSubmit.ok && expSubmit.status === 410 && expEv.length === 0);
    const pastDate = await svc.createSubjectAssessmentSession({ studentId: S, subjectId: A.subject, kind: 'TEST', origin: 'STUDENT', conceptIds: [A.concepts[3]], schedule: { mode: 'SCHEDULED', date: '2020-01-01' }, timing: { timed: false, durationMinutes: null }, language: 'es' }, deps);
    check('SCHEDULED  a date in the past is refused', !pastDate.ok && pastDate.error === 'SCHEDULE_DATE_IN_PAST');

    /* ---------------------------------------------- Mock: timed, no feedback, time up ---------------------------------------------- */
    const callsBefore = generatorCalls.length;
    const mock1 = await svc.createSubjectAssessmentSession({ studentId: S, subjectId: A.subject, kind: 'MOCK', origin: 'STUDENT', conceptIds: [A.concepts[0]], schedule: { mode: 'NOW' }, timing: { timed: false, durationMinutes: null }, language: 'es' }, deps);
    check('MOCK COUNT (generated)  1 concept -> 5 questions', mock1.ok && mock1.setup.questionCount === 5 && (mock1.view.questions?.length ?? 0) === 5);
    const mock3 = await svc.createSubjectAssessmentSession({ studentId: S, subjectId: A.subject, kind: 'MOCK', origin: 'STUDENT', conceptIds: A.concepts.slice(0, 3), schedule: { mode: 'NOW' }, timing: { timed: false, durationMinutes: null }, language: 'es' }, deps);
    check('MOCK COUNT (generated)  3 concepts -> 6 questions, 2 each', mock3.ok && mock3.setup.questionCount === 6 && Object.values(mock3.setup.blueprint).every((n) => n === 2));
    if (!mock3.ok) throw new Error('cannot continue without the mock');
    const m3 = await one(`SELECT subject_assessment_setup AS s, questions, expires_at FROM quiz_sessions WHERE id = $1`, [mock3.quizId]);
    const rec = life.recommendedMockDurationMinutes((m3.questions as any[]).map((q) => ({ type: q.type, difficulty: q.difficulty })));
    check('ALWAYS TIMED  a Student Mock is timed even when the request says untimed; duration = nominal sum (NOMINAL_RESPONSE_TIME_SUM)', m3.s.timing.timed === true && m3.s.timing.durationMinutes === Math.max(1, rec.minutes) && m3.s.timing.durationRule === 'NOMINAL_RESPONSE_TIME_SUM', `${m3.s.timing.durationMinutes} min`);
    check('ALWAYS TIMED  wall-clock deadline = startedAt + duration; session expiry = deadline + grace (not the 45-min TTL)', new Date(m3.s.timing.deadlineAt).getTime() - new Date(m3.s.timing.startedAt).getTime() === m3.s.timing.durationMinutes * 60_000 && new Date(m3.expires_at).getTime() === new Date(m3.s.timing.deadlineAt).getTime() + life.SUBJECT_SUBMIT_GRACE_SECONDS * 1000);
    check('MOCK DIFFICULTY  AUTO (per-concept Knowledge State target), never a user choice', 'mode' in m3.s.difficulty && m3.s.difficulty.mode === 'AUTO' && generatorCalls.length > callsBefore);
    const ma = await svc.recordSubjectAssessmentAnswer({ studentId: S, quizId: mock3.quizId, questionIndex: 0, answer: 'b' }, deps);
    const mb = await svc.recordSubjectAssessmentAnswer({ studentId: S, quizId: mock3.quizId, questionIndex: 1, answer: 'a' }, deps);
    const mb2 = await svc.recordSubjectAssessmentAnswer({ studentId: S, quizId: mock3.quizId, questionIndex: 0, answer: 'a' }, deps);
    check('NO FEEDBACK (Mock)  a saved answer returns { saved } only -- nothing about correctness', ma.ok && keys(ma) === 'saved' && mb.ok && keys(mb) === 'saved' && mb2.ok && keys(mb2) === 'saved');
    const mRead = await svc.readSubjectAssessmentSession(S, mock3.quizId, deps);
    check('NO FEEDBACK (Mock)  a read shows the answered indexes without correctness; reconnect shows the true remaining time', mRead.ok && mRead.view.state === 'ACTIVE' && (mRead.view.answered ?? []).length === 2 && (mRead.view.answered ?? []).every((a) => !('correct' in a)) && (mRead.view.remainingSeconds ?? -1) > 0 && (mRead.view.remainingSeconds ?? 0) <= m3.s.timing.durationMinutes * 60);
    // time runs out: move the fixture attempt's frozen clock into the past (startedAt / deadline) -- connection loss never pauses it
    await db.query(
      `UPDATE quiz_sessions SET subject_assessment_setup = jsonb_set(jsonb_set(subject_assessment_setup, '{timing,startedAt}', to_jsonb((now() - interval '2 hours')::text)), '{timing,deadlineAt}', to_jsonb((now() - interval '1 minute')::text)),
              expires_at = now() + interval '1 minute' WHERE id = $1 AND student_id = $2`,
      [mock3.quizId, S],
    );
    // the two answers were saved during the attempt, i.e. before that (moved) deadline
    await db.query(`UPDATE quiz_responses SET created_at = now() - interval '30 minutes' WHERE quiz_session_id = $1 AND student_id = $2`, [mock3.quizId, S]);
    const late = await svc.recordSubjectAssessmentAnswer({ studentId: S, quizId: mock3.quizId, questionIndex: 2, answer: 'a' }, deps);
    check('TIMEOUT AUTO-SUBMIT  an answer after the deadline is not saved; the attempt is auto-submitted on that access', late.ok && 'timeUp' in late.data && late.data.timeUp === true && late.data.results.subjectAssessment.completionReason === 'TIME_UP_AUTO_SUBMIT');
    const mDone = await svc.readSubjectAssessmentSession(S, mock3.quizId, deps);
    const msa = mDone.ok ? mDone.view.results?.subjectAssessment : undefined;
    check('UNANSWERED DENOMINATOR (Mock)  2 correct of 6 (4 unanswered) = 33.3%, not 2 of 2', !!msa && msa.correct === 2 && msa.incorrect === 0 && msa.unanswered === 4 && msa.total === 6 && msa.scorePercent === 33.3, msa ? JSON.stringify({ c: msa.correct, i: msa.incorrect, u: msa.unanswered, s: msa.scorePercent }) : '');
    check('NO FEEDBACK (Mock)  the changed answer (b -> a) is the one graded, after the attempt', mDone.ok && mDone.view.results?.review[0].status === 'CORRECT');
    const evM = await all(`SELECT concept_id, score_percent, metadata FROM learning_evidence WHERE student_id = $1 AND metadata->'subjectAssessment'->>'quizSessionId' = $2`, [S, mock3.quizId]);
    check('EVIDENCE (Mock)  MOCK_EXAM per concept, explicitly mock, origin, scorePercent (unanswered in the denominator)', evM.length === 3 && evM.every((e) => e.metadata.activityType === 'MOCK_EXAM' && e.metadata.subjectAssessment.explicitlyMock === true && e.metadata.origin === 'STUDENT' && Number(e.score_percent) === e.metadata.scorePercent) && evM.filter((e) => Number(e.score_percent) === 50).length === 2 && evM.filter((e) => Number(e.score_percent) === 0).length === 1, JSON.stringify(evM.map((e) => Number(e.score_percent))));
    const erCount = await one(`SELECT count(*)::int AS n FROM exam_readiness_evidence WHERE student_id = $1`, [S]).catch(() => ({ n: 0 }));
    check('NEVER EXAM READINESS  no exam_readiness_evidence row for the Student', Number(erCount?.n ?? 0) === 0);

    /* ------------------------------------------------ TEACHER origin (explicit plan) ------------------------------------------------ */
    const { planGroupAssessment } = await import('@/lib/subject-assessment/sizing');
    const gp = planGroupAssessment('MOCK', A.concepts.slice(1, 3), false);
    const teacher = await svc.createSubjectAssessmentSession({
      studentId: S, subjectId: A.subject, kind: 'MOCK', origin: 'TEACHER', conceptIds: A.concepts.slice(1, 3),
      plan: { questionCount: gp.questionCount, distribution: gp.distribution, rule: gp.rule }, difficultyBand: 'HIGH',
      schedule: { mode: 'NOW' }, timing: { timed: true, durationMinutes: 25 }, assignmentId: `assign-${RUN}`, attemptNumber: 2, language: 'es',
    }, deps);
    check('TEACHER ORIGIN  explicit fixed plan + band (no Knowledge State adaptation), assignmentId / attemptNumber, teacher duration', teacher.ok && teacher.setup.origin === 'TEACHER' && 'band' in teacher.setup.difficulty && teacher.setup.difficulty.band === 'HIGH' && !teacher.setup.knowledgeSignals && teacher.setup.assignmentId === `assign-${RUN}` && teacher.setup.attemptNumber === 2 && teacher.setup.timing.durationMinutes === 25 && (teacher.questions ?? []).every((q) => q.difficulty === 4));
    const teacherNoPlan = await svc.createSubjectAssessmentSession({ studentId: S, subjectId: A.subject, kind: 'TEST', origin: 'TEACHER', conceptIds: A.concepts, schedule: { mode: 'NOW' }, timing: { timed: false, durationMinutes: null } }, deps);
    check('TEACHER ORIGIN  a teacher session without its fixed plan is refused', !teacherNoPlan.ok && teacherNoPlan.error === 'PLAN_REQUIRED');
    const teacherUntimedMock = await svc.createSubjectAssessmentSession({ studentId: S, subjectId: A.subject, kind: 'MOCK', origin: 'TEACHER', conceptIds: A.concepts.slice(1, 3), plan: { questionCount: gp.questionCount, distribution: gp.distribution, rule: gp.rule }, difficultyBand: 'MEDIUM', schedule: { mode: 'NOW' }, timing: { timed: false, durationMinutes: null } }, deps);
    check('ALWAYS TIMED  an untimed teacher mock is refused', !teacherUntimedMock.ok && teacherUntimedMock.error === 'MOCK_MUST_BE_TIMED');
    if (teacher.ok) {
      for (let i = 0; i < teacher.setup.questionCount; i++) await svc.recordSubjectAssessmentAnswer({ studentId: S, quizId: teacher.quizId, questionIndex: i, answer: 'a' }, deps);
      const ts = await svc.submitSubjectAssessmentSession({ studentId: S, quizId: teacher.quizId }, deps);
      const evTe = await all(`SELECT metadata FROM learning_evidence WHERE student_id = $1 AND metadata->'subjectAssessment'->>'quizSessionId' = $2`, [S, teacher.quizId]);
      check('TEACHER ORIGIN  evidence carries origin TEACHER + assignmentId + attemptNumber; 100% passes', ts.ok && ts.data.subjectAssessment.passed === true && evTe.length === 2 && evTe.every((e) => e.metadata.origin === 'TEACHER' && e.metadata.assignmentId === `assign-${RUN}` && e.metadata.attemptNumber === 2));
    }

    /* ----------------------------------------------------------- list ----------------------------------------------------------- */
    const list = await svc.listStudentSubjectAssessments(S, A.subject);
    check('MIS EVALUACIONES  the subject list shows the scheduled (started early), expired and completed ones with their state', list.some((i) => sched.ok && i.quizId === sched.quizId && i.state === 'ACTIVE' && i.scheduledDate === tomorrowLocal) && list.some((i) => schedToday.ok && i.quizId === schedToday.quizId && i.state === 'EXPIRED') && list.some((i) => i.quizId === testNow.quizId && i.state === 'COMPLETED' && i.scorePercent !== null));

    /* ---------------------------------------------------- optional: real AI ---------------------------------------------------- */
    if (process.env.SUBJECT_SCENARIO_REAL_AI === '1') {
      const real = await svc.createSubjectAssessmentSession({ studentId: S, subjectId: A.subject, kind: 'TEST', origin: 'STUDENT', conceptIds: [A.concepts[0]], schedule: { mode: 'NOW' }, timing: { timed: false, durationMinutes: null }, language: 'es' });
      check('REAL AI  the gated generator produces exactly the planned items (or fails honestly)', real.ok ? real.setup.questionCount === real.questions.length && life.blueprintMatches(real.setup.distribution, real.setup.blueprint) : real.error === 'GENERATION_INSUFFICIENT', real.ok ? `${real.questions.length} items` : real.error);
    }
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

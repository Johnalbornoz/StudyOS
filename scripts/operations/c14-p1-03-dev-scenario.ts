/**
 * C14-P1-03 -- DEV scenario: Learning and Exam Prep coexist (Learn / Today view models), through the real services.
 * DEV ONLY (fingerprint guard). Two clearly-marked fixture Students (`ebr-c14p103-<run>-L|C`, `@exam-bank.test`),
 * removed at the end.
 *
 *   CURRICULUM_CONVERGENCE_FP=2a29b99ee14a22b4 npx tsx --env-file=<dev env> scripts/operations/c14-p1-03-dev-scenario.ts
 *
 * Both Students have the SAME Learning state as Candidate #14's Student C: subject "Matemáticas", one concept
 * "Ecuaciones lineales" (catalogue-linked when DEV has the canonical concept), unclassified, and ONE finished LEARN
 * session (the exact LEARN_GUIDED evidence row the guided close writes -- diagnostic, no Knowledge State row).
 *   L = Learning only;  C = Learning + an ACTIVE PAA preparation created by the product path.
 * Asserts the Learn / Today view-model inputs: the Learning next step (canonical PRACTICE) is offered to both,
 * the Learning curriculum is never the exam's, the Exam Prep curriculum is a separate section, the Learning concept
 * grouping is identical with and without the preparation, and nothing crosses between the two evidence streams.
 * 0 provider calls (no LEARN turn is generated; the evidence row is written through the single evidence writer).
 */
import { createHash, randomBytes, randomUUID } from 'crypto';

process.env.CANONICAL_ENGINE_V1_ENABLED = 'true';

const DEV = '2a29b99ee14a22b4';
const RUN = randomBytes(3).toString('hex');
const results: { id: string; ok: boolean }[] = [];
const check = (id: string, ok: boolean, detail = ''): void => { results.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? `  [${detail}]` : ''}`); };

async function main(): Promise<number> {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${u.hostname}|${u.pathname.slice(1)}`).digest('hex').slice(0, 16);
  if (fp !== DEV || process.env.CURRICULUM_CONVERGENCE_FP !== fp) throw new Error(`REFUSING: database ${fp} (DEV only)`);
  const { db } = await import('@/lib/db');
  const { getOrCreateCanonicalUser } = await import('@/lib/identity/canonical-user.service');
  const { upsertStudentFromWebhook } = await import('@/lib/auth');
  const { assignSelfServiceRole } = await import('@/lib/identity/role-assignment.service');
  const { createObjectivePreparation } = await import('@/lib/exam-core/objectives/preparation.service');
  const { recordDiagnosticEvidence } = await import('@/services/mastery.service');
  const { buildLearnGuidedEvidence, LEARN_GUIDED_QUIZ_MODE } = await import('@/lib/learn-guided/policy');
  const { getLearningOSSnapshot } = await import('@/services/learning-os-snapshot.service');
  const { loadMyPathContext, buildSubjectPathView } = await import('@/lib/lx/path-view');
  const { presentSnapshotNextChallenge, presentCanonicalContinuation } = await import('@/lib/experience/next-challenge.server');
  const { subjectContinuation } = await import('@/lib/lx/canonical-continuation');
  const { loadSubjectCurriculumTopics, distinctExamCurriculum } = await import('@/lib/learning-plan/subject-curriculum-topics');
  const { cleanupFixtureStudent } = await import('./exam-bank/fixture-cleanup');
  const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
  const n = async (sql: string, p: unknown[] = []) => Number((await one(sql, p))?.n ?? 0);
  console.log(`c14-p1-03 scenario -- db ${fp} -- run ${RUN}`);

  const canonical = await one(`SELECT cc.id FROM canonical_concepts cc WHERE cc.status = 'ACTIVE' AND cc.name IN ('Linear Equations', 'Linear equations', 'Ecuaciones lineales') ORDER BY cc.name LIMIT 1`);
  const fixtures: Array<{ S: string; actor: string }> = [];
  const make = async (tag: 'L' | 'C') => {
    const clerk = `ebr-c14p103-${RUN}-${tag}`;
    const user = await getOrCreateCanonicalUser(clerk, `${clerk}@exam-bank.test`);
    const S = await upsertStudentFromWebhook(clerk, `${clerk}@exam-bank.test`, `c14-p1-03 ${tag}`);
    fixtures.push({ S, actor: user.id as string });
    await assignSelfServiceRole(clerk, user.id as string, 'STUDENT');
    await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', 'c14-p1-03') ON CONFLICT (id) DO NOTHING`, [S]);
    await db.query(`INSERT INTO student_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [S]);
    const subjectId = (await one(`INSERT INTO subjects (student_id, name, status) VALUES ($1, 'Matemáticas', 'active') RETURNING id`, [S])).id as string;
    const conceptId = (await one(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [subjectId, `ECUACIONES_LINEALES_C14P103_${RUN.toUpperCase()}`])).id as string;
    await db.query(`INSERT INTO concept_localizations (concept_id, language, label) VALUES ($1, 'es', 'Ecuaciones lineales'), ($1, 'en', 'Linear equations')`, [conceptId]);
    if (canonical) await db.query(`INSERT INTO concept_catalog_mapping (learner_concept_id, canonical_concept_id, status) VALUES ($1, $2, 'MATCHED')`, [conceptId, canonical.id]).catch(() => undefined);
    // ONE finished LEARN session (4 answered interactions, AI close): the exact row the guided close writes.
    const interactions = Array.from({ length: 4 }, () => ({ question: { difficulty: 2 } as any, askedAt: new Date().toISOString(), answer: 'x', answeredAt: new Date().toISOString(), correct: true }));
    const ev = buildLearnGuidedEvidence({ sessionId: randomUUID(), interactions, closedBy: 'AI' });
    await recordDiagnosticEvidence({ studentId: S, conceptId, subjectId, sourceType: ev.sourceType, result: ev.result, difficulty: ev.difficulty, scorePercent: ev.scorePercent, activityType: LEARN_GUIDED_QUIZ_MODE, learningMode: ev.learningMode, hintsUsed: ev.hintsUsed, aiAssistanceType: ev.aiAssistanceType, metadata: ev.metadata, operationKey: ev.operationKey });
    return { S, subjectId, conceptId };
  };

  try {
    const L = await make('L');
    const C = await make('C');
    const prep = await createObjectivePreparation(C.S, { objectiveKey: 'paa' });
    check('S0  fixtures: same Learning state for L and C; C has an ACTIVE PAA preparation', prep.profile.status === 'ACTIVE' && (await n(`SELECT count(*)::int AS n FROM student_exam_profiles WHERE student_id = $1 AND status = 'ACTIVE'`, [L.S])) === 0,
      `canonical concept ${canonical ? String(canonical.id).slice(0, 8) : 'none on DEV'}; prep ${String(prep.profile.id).slice(0, 8)}`);
    const ksBefore = { L: await n(`SELECT count(*)::int AS n FROM concept_knowledge_state WHERE student_id = $1`, [L.S]), C: await n(`SELECT count(*)::int AS n FROM concept_knowledge_state WHERE student_id = $1`, [C.S]) };
    check('S1  the LEARN-only concept has no Knowledge State row (the RC-2 precondition, for both)', ksBefore.L === 0 && ksBefore.C === 0);

    const views: Record<string, any> = {};
    for (const [tag, F] of [['L', L], ['C', C]] as const) {
      // Today
      const snap = await getLearningOSSnapshot(F.S, { preferredLanguage: 'es' });
      const best = snap.nextExecutableItem;
      const cont = !best ? snap.canonicalContinuations[0] ?? null : null;
      const hero = presentSnapshotNextChallenge(snap) ?? (cont ? presentCanonicalContinuation(cont) : null);
      check(`T1-${tag}  Today: Phase 3C has no decision for the concept (no KS row) -- legacy "Estás al día" precondition`, !snap.decisions.some((d) => d.actionConceptId === F.conceptId), `${snap.decisions.length} decisions`);
      check(`T2-${tag}  Today: the hero is the Learning next step (canonical, executable) for the concept -- not "Estás al día"`, hero?.status === 'READY' && hero.conceptId === F.conceptId && hero.authority === 'CANONICAL', `${hero?.status ?? 'none'} ${hero?.status === 'READY' ? hero.activityType : ''}`);
      // Learn
      const ctx = await loadMyPathContext(F.S, 'es');
      const view = await buildSubjectPathView(ctx, F.subjectId, 'Matemáticas');
      const learnCont = subjectContinuation(ctx.snapshot?.canonicalContinuations, F.subjectId);
      const learnHero = learnCont ? presentCanonicalContinuation(learnCont) : null;
      check(`L1-${tag}  Learn: the subject hero is the same next step as Today -- not "Nada pendiente"`, learnHero?.status === 'READY' && learnHero.conceptId === F.conceptId && (hero?.status === 'READY' ? hero.activityType : null) === (learnHero?.status === 'READY' ? learnHero.activityType : undefined));
      const learning = await loadSubjectCurriculumTopics(F.S, { id: F.subjectId, name: 'Matemáticas' }, 'es', 'LEARNING');
      const exam = distinctExamCurriculum(learning, await loadSubjectCurriculumTopics(F.S, { id: F.subjectId, name: 'Matemáticas' }, 'es', 'EXAM_PREP'));
      const any = await loadSubjectCurriculumTopics(F.S, { id: F.subjectId, name: 'Matemáticas' }, 'es');
      views[tag] = { hero: learnHero?.status === 'READY' ? learnHero.activityType : null, unassigned: view.unassigned.map((c) => c.conceptId), topics: view.topics.map((t) => t.topicId), learning, exam, any };
    }
    const { studentExplicitAcademicSubjects, listCurriculumOptions } = await import('@/lib/learning-plan/curriculum.service');
    const explicit = await studentExplicitAcademicSubjects(C.S);
    const options = await listCurriculumOptions('mathematics');
    const bound = await one(`SELECT exam_version_id FROM student_exam_profiles WHERE id = $1`, [prep.profile.id]);
    // DEV data note: on DEV the PAA form the product binds assesses academic subjects that are not a published maths
    // curriculum option, so its exam curriculum does not resolve for "Matemáticas" here (on Candidate #14 it does: the
    // reported "TEMAS DE TU CURRÍCULO — PAA" header). L3/L4 then run only where the data allows; the precedence rule
    // itself is unit-tested (c14-p1-03-learning-exam-prep-coexistence.test.ts) and L7 proves it on DEV with an Academic Profile.
    const examResolvesForMaths = explicit.some((e) => e.source === 'EXAM_PROFILE' && options.some((o) => o.academicSubjectId === e.academicSubjectId));
    console.log(`INFO  C prep bound to ${String(bound?.exam_version_id ?? 'NULL').slice(0, 8)}; exam-named subjects ${explicit.filter((e) => e.source === 'EXAM_PROFILE').map((e) => e.academicSubjectId.slice(0, 8)).join(',') || 'none'}; exam curriculum resolves for Matemáticas on this DB: ${examResolvesForMaths}`);
    check('L2    Learn: the Learning curriculum is never the exam\'s (no Academic Profile -> no "Temas de tu currículo" for L or C)', views.L.learning === null && views.C.learning === null);
    if (examResolvesForMaths) {
      check('L3    Learn: the PAA preparation appears for C only, as the separate Exam Prep section', views.L.exam === null && !!views.C.exam && (views.C.exam.status !== 'READY' || views.C.exam.reason === 'EXAM_PROFILE'), `C exam ${views.C.exam?.status ?? 'none'}`);
      check('L4    (before the fix) the single exam-first resolution named PAA as C\'s curriculum -- the replaced header', !!views.C.any && (views.C.any.status !== 'READY' || views.C.any.reason === 'EXAM_PROFILE'), String(views.C.any?.status ?? 'null'));
    } else {
      console.log('INFO  L3/L4 not applicable on this DB (exam curriculum does not resolve for Matemáticas); L has no Exam Prep section: ' + String(views.L.exam === null));
    }
    // L7: C also selects a maths subject in their Academic Profile -> that is the Learning curriculum, with the preparation still ACTIVE.
    const ib = options.find((o) => /IB Diploma/.test(o.programme)) ?? options[0];
    if (ib) {
      await db.query(`INSERT INTO student_academic_subjects (student_id, academic_subject_id) VALUES ($1, $2)`, [C.S, ib.academicSubjectId]);
      const learning2 = await loadSubjectCurriculumTopics(C.S, { id: C.subjectId, name: 'Matemáticas' }, 'es', 'LEARNING');
      const exam2 = distinctExamCurriculum(learning2, await loadSubjectCurriculumTopics(C.S, { id: C.subjectId, name: 'Matemáticas' }, 'es', 'EXAM_PREP'));
      check('L7    with an Academic Profile subject AND the active PAA preparation, the Learning curriculum is the Academic Profile\'s ("Temas de tu currículo")', learning2?.status === 'READY' && learning2.reason === 'ACADEMIC_PROFILE' && learning2.context.academicSubjectId === ib.academicSubjectId && (exam2 === null || (exam2.status === 'READY' ? exam2.reason === 'EXAM_PROFILE' : true)),
        `${learning2?.status === 'READY' ? `${learning2.context.programme} · ${learning2.context.name} (${learning2.reason})` : String(learning2?.status ?? 'null')}; exam section ${exam2?.status ?? 'none'}`);
      const ctx2 = await loadMyPathContext(C.S, 'es');
      const cont2 = subjectContinuation(ctx2.snapshot?.canonicalContinuations, C.subjectId);
      check('L8    the Learning next step is still offered with both contexts present', cont2?.conceptId === C.conceptId && presentCanonicalContinuation(cont2).status === 'READY');
    }
    check('L5    Learn: the Student\'s own concept grouping is identical with and without the preparation (no re-bucketing)', views.L.topics.length === views.C.topics.length && views.L.unassigned.length === views.C.unassigned.length && views.C.unassigned.includes(C.conceptId), `topics ${views.C.topics.length}, unclassified ${views.C.unassigned.length}`);
    check('L6    Learning next step is the same activity for L and C (the preparation changes nothing in Learning)', views.L.hero !== null && views.L.hero === views.C.hero, `${views.L.hero} / ${views.C.hero}`);

    // isolation
    check('X1    reading Today / Learn wrote no Knowledge State, mastery, plan or exam evidence row for either Student', (await n(`SELECT count(*)::int AS n FROM concept_knowledge_state WHERE student_id = ANY($1::uuid[])`, [[L.S, C.S]])) === 0
      && (await n(`SELECT count(*)::int AS n FROM student_plan_entries WHERE student_id = ANY($1::uuid[])`, [[L.S, C.S]])) === 0
      && (await n(`SELECT count(*)::int AS n FROM exam_readiness_evidence WHERE student_id = ANY($1::uuid[])`, [[L.S, C.S]])) === 0);
    check('X2    Learning evidence is exactly the one LEARN row per Student (Exam Prep added none)', (await n(`SELECT count(*)::int AS n FROM learning_evidence WHERE student_id = $1`, [L.S])) === 1 && (await n(`SELECT count(*)::int AS n FROM learning_evidence WHERE student_id = $1`, [C.S])) === 1);
    check('X3    0 provider calls', (await n(`SELECT count(*)::int AS n FROM ai_execution_events WHERE student_id = ANY($1::uuid[])`, [[L.S, C.S]]).catch(() => 0)) === 0);
  } finally {
    let left = 0;
    for (const f of fixtures) left += await cleanupFixtureStudent(db, f.S, f.actor).catch((e: any) => { console.error(e); return 1; });
    check('Z1    the fixture Students and everything of theirs are removed', left === 0, `${left} rows left`);
    await db.end();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} PASS`);
  return failed === 0 ? 0 : 1;
}

main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });

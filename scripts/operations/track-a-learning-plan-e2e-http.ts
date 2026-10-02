/**
 * Track A -- Learning Plan Orchestrator E2E (scenarios 53-57) over REAL HTTP
 * as REAL Clerk DEV identities, with the DEV database checked read-only for
 * every write the journey should -- and should NOT -- produce.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-a-fixtures.ts provision
 *   npx tsx --env-file=.env.local scripts/operations/track-a-fixtures.ts tokens <tokens.json>
 *   npx tsx --env-file=.env.local scripts/operations/track-a-learning-plan-e2e-http.ts <baseUrl> <tokens.json>
 *   (hosted DEV: VERCEL_PROTECTION_BYPASS=<existing automation bypass secret>)
 *
 * The run starts from a known state it builds itself (DEV fixtures only,
 * through the real services): TA Institución LP coordinated by lp-coord,
 * class "LP Matemáticas 11" (Mathematics) taught by lp-teacher with 20 ACTIVE
 * learners in MIXED states (Sofía with her real history, 19 DB-only synthetic
 * learners: 7 without the concept, 6 with it in plan, 3 archived, 3 with an
 * own unlinked "Linear equations"), and lp-student, an independent learner.
 *
 *  53  Independent student: base curriculum, add / idempotent add / archive /
 *      restore, recommendations, server-verified sources, pages.
 *  57  Coordinator: adopt curriculum, classify REQUIRED (recommended, never
 *      auto-added), remove / restore, tenant isolation; Platform Admin
 *      resolves a proposal.
 *  54  Teacher: curriculum browser, class plan, preview (have / will add /
 *      advanced), assign all (merge, no reset, idempotent replay), matrix,
 *      supplemental concept (coordinator told), remove keeps learning,
 *      proposal with equivalents, security.
 *  55  Exam gap: governed exam attempt -> EXAM_GAP recommendation -> accept
 *      (new) / accept (already in plan) / dismiss; exam preparation plan.
 *  56  Teacher + exam gaps: aggregated needs of the class only -> "assign to
 *      these N"; nothing from learners outside the class.
 */
import { readFileSync } from 'fs';
import { db } from '@/lib/db';
import { createInstitution, inviteInstitutionAdmin, requestTeacherMembership, decideMembership, createGrade, createClass, createTeacherAssignment } from '@/services/institution.service';
import { enrollCanonicalConcept, setPlanEntryArchived } from '@/lib/learning-plan/personal-plan.service';
import { createStudentExamProfile } from '@/lib/assessment/student-exam-profile.service';
import { startExamAttempt, completeExamAttempt } from '@/lib/assessment/exam-attempt.service';
import { recordExamAttemptItemResponse } from '@/lib/assessment/evaluation.service';
import { assertDev, emailFor, learningPlanTeardown, INST_LP_NAME, LP_CLASS_NAME, LP_EXAM_PURPOSE, LP_SYNTHETIC_PREFIX, type Tag } from './track-a-fixtures';

const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
const TOKENS: Record<Tag, string> = JSON.parse(readFileSync(process.argv[3] ?? '', 'utf-8'));
const EXAM_NAME = 'IB Mathematics: analysis and approaches SL';

const results: Array<{ id: string; ok: boolean; detail: string }> = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};

interface Res {
  status: number;
  body: any;
  text: string;
}
async function call(method: string, path: string, who: Tag | null, body?: unknown): Promise<Res> {
  const bypass = process.env.VERCEL_PROTECTION_BYPASS;
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(who ? { Authorization: `Bearer ${TOKENS[who]}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, text };
}
const get = (path: string, who: Tag | null) => call('GET', path, who);
const post = (path: string, who: Tag | null, body: unknown = {}) => call('POST', path, who, body);
const denied = (r: Res) => r.status === 401 || r.status === 403 || r.status === 404;
/** Visible text of a server-rendered page (tags and serialized props stripped). */
const visible = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
async function page(id: string, path: string, who: Tag, mustContain: Array<string | RegExp>, mustNot: Array<string | RegExp> = []) {
  const r = await get(path, who);
  const text = visible(r.text);
  const has = (m: string | RegExp) => (typeof m === 'string' ? text.includes(m) : m.test(text));
  const missing = mustContain.filter((m) => !has(m));
  const present = mustNot.filter(has);
  check(`PAGE.${id}`, r.status === 200 && missing.length === 0 && present.length === 0, `${r.status}${missing.length ? ' missing ' + missing.map(String).join(' | ') : ''}${present.length ? ' unexpected ' + present.map(String).join(' | ') : ''}`);
}
const q1 = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
const qa = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;
const n = async (sql: string, p: unknown[] = []) => Number((await q1(sql, p))?.n ?? 0);

// ---------------------------------------------------------------------------
// Known starting state (DEV fixtures only, real services)
// ---------------------------------------------------------------------------

interface World {
  inst: string;
  grade: string;
  klass: string;
  users: Record<string, string>;
  students: Record<string, string>;
  synthetic: Record<'none' | 'inPlan' | 'archived' | 'ownUnlinked', string[]>;
  mathSubject: string;
  le: string; // Linear Equations (Mathematics)
  required: string; // classified REQUIRED by the coordinator
  supplemental: string; // removed from the curriculum, then used by the Teacher
}

async function prepare(): Promise<World> {
  assertDev();
  await learningPlanTeardown();
  const users: Record<string, string> = {};
  const students: Record<string, string> = {};
  for (const tag of ['lp-student', 'lp-teacher', 'lp-coord', 'student-a', 'teacher-b', 'inst-a', 'platform-admin'] as Tag[]) {
    const u = await q1(`SELECT u.id, s.id AS student_id FROM users u LEFT JOIN students s ON s.user_id = u.id WHERE u.email = $1`, [emailFor(tag)]);
    if (!u) throw new Error(`fixture ${tag} missing -- run track-a-fixtures.ts provision`);
    users[tag] = u.id;
    if (u.student_id) students[tag] = u.student_id;
  }
  // The independent Student has completed first-run (national curriculum, no institution).
  const { upsertAcademicProfile } = await import('@/services/academic-profile.service');
  await upsertAcademicProfile(students['lp-student'], { countryOfStudy: 'CO', schoolYear: '11', curriculumType: 'national', academicYear: '2026', profileCompleted: true } as any);
  const le = await q1(`SELECT cc.id, cc.canonical_subject_id FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id WHERE cc.name = 'Linear Equations' AND cs.name = 'Mathematics' AND cc.status = 'ACTIVE'`);
  const required = await q1(`SELECT id FROM canonical_concepts WHERE name = 'Sequences and series' AND canonical_subject_id = $1`, [le.canonical_subject_id]);
  const supplemental = await q1(`SELECT id FROM canonical_concepts WHERE name = 'Logarithms' AND canonical_subject_id = $1`, [le.canonical_subject_id]);

  const inst = (await createInstitution(INST_LP_NAME)).id;
  await inviteInstitutionAdmin(inst, users['lp-coord']);
  const grade = (await createGrade(inst, '11.º LP')).id;
  const klass = (await createClass(inst, grade, LP_CLASS_NAME, le.canonical_subject_id)).id;
  const m = await requestTeacherMembership(inst, users['lp-teacher']);
  if (m.status === 'PENDING') await decideMembership(m.id, users['lp-coord'], 'APPROVED');
  await createTeacherAssignment(m.id, { classId: klass });
  const enroll = (studentId: string) =>
    db.query(
      `INSERT INTO class_enrollments (class_id, student_id, status, invited_by_user_id, responded_at) VALUES ($1, $2, 'ACTIVE', $3, NOW())
       ON CONFLICT (class_id, student_id) DO UPDATE SET status = 'ACTIVE', ended_at = NULL`,
      [klass, studentId, users['lp-teacher']]
    );
  await enroll(students['student-a']);

  const synthetic: World['synthetic'] = { none: [], inPlan: [], archived: [], ownUnlinked: [] };
  const plan: Array<[keyof World['synthetic'], number]> = [['none', 7], ['inPlan', 6], ['archived', 3], ['ownUnlinked', 3]];
  let i = 0;
  for (const [state, count] of plan) {
    for (let k = 0; k < count; k++) {
      i += 1;
      const nn = String(i).padStart(2, '0');
      const s = (await db.query(`INSERT INTO students (clerk_id, email, name, language) VALUES ($1, $2, $3, 'es') RETURNING id`, [`${LP_SYNTHETIC_PREFIX}${nn}`, `${LP_SYNTHETIC_PREFIX}${nn}@example.invalid`, `LP Sintético ${nn}`])).rows[0].id;
      // Legacy FK: subjects.student_id -> profiles(id) (a learner's profile shares the student id).
      await db.query(`INSERT INTO profiles (id, user_type, full_name, clerk_id) VALUES ($1, 'student', $2, $3)`, [s, `LP Sintético ${nn}`, `${LP_SYNTHETIC_PREFIX}${nn}`]);
      synthetic[state].push(s);
      await enroll(s);
      if (state === 'inPlan' || state === 'archived') await enrollCanonicalConcept(s, le.id, { type: 'SELF_SELECTED' });
      if (state === 'archived') await setPlanEntryArchived(s, le.id, true, null);
      if (state === 'ownUnlinked') {
        const subject = (await db.query(`INSERT INTO subjects (student_id, name, status) VALUES ($1, 'Mathematics', 'active') RETURNING id`, [s])).rows[0].id;
        const concept = (await db.query(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, 'LINEAR_EQUATIONS_OWN') RETURNING id`, [subject])).rows[0].id;
        await db.query(`INSERT INTO concept_localizations (concept_id, language, label) VALUES ($1, 'en', 'Linear equations')`, [concept]);
        await db.query(`INSERT INTO mastery_records (student_id, concept_id, subject_id, mastery_score, confidence_score, attempt_count, correct_count, incorrect_count) VALUES ($1, $2, $3, 0, 0, 0, 0, 0)`, [s, concept, subject]);
      }
    }
  }
  console.log(`prepared: institution ${inst}, class ${klass}, 20 learners (Sofía + 19 synthetic)`);
  return { inst, grade, klass, users, students, synthetic, mathSubject: le.canonical_subject_id, le: le.id, required: required.id, supplemental: supplemental.id };
}

/** Per-learner snapshot of everything that must survive an assignment unchanged. */
async function learnerSnapshot(studentId: string, canonicalConceptId: string) {
  const concepts = await qa(
    `SELECT c.id FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = $1 ORDER BY c.id`,
    [studentId]
  );
  const mastery = await qa(`SELECT concept_id, mastery_score, attempt_count, correct_count FROM mastery_records WHERE student_id = $1 ORDER BY concept_id`, [studentId]);
  const evidence = await n(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [studentId]);
  const entry = await q1(`SELECT learner_concept_id, plan_status FROM student_plan_entries WHERE student_id = $1 AND canonical_concept_id = $2`, [studentId, canonicalConceptId]);
  return { concepts: concepts.map((c: any) => c.id).join(','), mastery: JSON.stringify(mastery), evidence, entry };
}

/** A governed exam attempt: objectives in `failed` score 0/1, every other target 1/1. */
async function examAttempt(studentId: string, failedObjectives: string[]): Promise<{ profileId: string; attemptId: string }> {
  const exam = await q1(
    `SELECT ed.id AS def, ev.id AS version FROM exam_definitions ed JOIN exam_versions ev ON ev.exam_definition_id = ed.id AND ev.status = 'PUBLISHED' WHERE ed.name = $1 ORDER BY ev.created_at DESC LIMIT 1`,
    [EXAM_NAME]
  );
  const profile = await createStudentExamProfile({ studentId, examDefinitionId: exam.def, examVersionId: exam.version, purpose: LP_EXAM_PURPOSE });
  const attempt = await startExamAttempt({ studentExamProfileId: profile.id, examVersionId: exam.version });
  const targets = await qa(
    `SELECT DISTINCT bot.learning_objective_id, bot.assessment_component_id FROM assessment_blueprints b JOIN blueprint_objective_targets bot ON bot.blueprint_id = b.id
     WHERE b.exam_version_id = $1 AND bot.assessment_component_id IS NOT NULL`,
    [exam.version]
  );
  for (const t of targets) {
    const fail = failedObjectives.includes(t.learning_objective_id);
    await recordExamAttemptItemResponse({
      examAttemptId: attempt.id,
      assessmentComponentId: t.assessment_component_id,
      learningObjectiveId: t.learning_objective_id,
      itemSnapshot: { source: 'track-a-lp-e2e', objective: t.learning_objective_id },
      evaluation: { rawResponse: fail ? 'wrong' : 'right', score: fail ? 0 : 1, maxScore: 1, criteriaBreakdown: null, feedback: null, evaluationModelVersion: 'track-a-lp-e2e', provenance: { fixture: true } },
      idempotencyKey: `lp-${t.learning_objective_id}-${t.assessment_component_id}`,
    });
  }
  await completeExamAttempt(attempt.id);
  return { profileId: profile.id, attemptId: attempt.id };
}

/** Objectives of the exam whose published mappings reach ≥ 1 Mathematics concept, with those concepts. */
async function examObjectives(): Promise<Array<{ lo: string; concepts: string[] }>> {
  const rows = await qa(
    `SELECT bot.learning_objective_id AS lo, array_agg(DISTINCT ocm.canonical_concept_id) AS concepts
     FROM exam_definitions ed JOIN exam_versions ev ON ev.exam_definition_id = ed.id AND ev.status = 'PUBLISHED'
     JOIN assessment_blueprints b ON b.exam_version_id = ev.id JOIN blueprint_objective_targets bot ON bot.blueprint_id = b.id
     JOIN objective_concept_mappings ocm ON ocm.learning_objective_id = bot.learning_objective_id AND ocm.status = 'PUBLISHED' AND ocm.relation_type IN ('FULL', 'PARTIAL')
     WHERE ed.name = $1 AND bot.assessment_component_id IS NOT NULL GROUP BY 1 ORDER BY 1`,
    [EXAM_NAME]
  );
  return rows.map((r: any) => ({ lo: r.lo, concepts: r.concepts }));
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function s53(w: World) {
  const me = w.students['lp-student'];
  const cur = await get('/api/student/curriculum', 'lp-student');
  const view = cur.body?.data;
  check('S53.base-curriculum', cur.status === 200 && view?.subjects?.length > 0 && view?.counts?.available > 0 && view?.counts?.inPlan === 0, `${cur.status} subjects=${view?.subjects?.length} available=${view?.counts?.available} inPlan=${view?.counts?.inPlan}`);
  check('S53.available-is-not-plan', (await n(`SELECT COUNT(*) n FROM student_plan_entries WHERE student_id = $1`, [me])) === 0);
  const math = await get('/api/student/curriculum?subject=mathematics', 'lp-student');
  const mathConcepts = (math.body?.data?.areas ?? []).flatMap((a: any) => a.concepts);
  check('S53.math-curriculum-localized', math.status === 200 && mathConcepts.some((c: any) => c.canonicalConceptId === w.le && c.label === 'Ecuaciones lineales'), `${math.status} n=${mathConcepts.length}`);

  const add = await post('/api/student/plan', 'lp-student', { canonicalConceptId: w.le });
  check('S53.add-to-plan', add.status === 201 && add.body?.data?.entryCreated === true && add.body?.data?.conceptCreated === true, `${add.status} ${add.text.slice(0, 160)}`);
  const again = await post('/api/student/plan', 'lp-student', { canonicalConceptId: w.le });
  check('S53.add-idempotent', again.status === 200 && again.body?.data?.entryCreated === false && again.body?.data?.learnerConceptId === add.body?.data?.learnerConceptId, `${again.status}`);
  check('S53.one-learner-state', (await n(`SELECT COUNT(*) n FROM student_plan_entries WHERE student_id = $1 AND canonical_concept_id = $2`, [me, w.le])) === 1 &&
    (await n(`SELECT COUNT(*) n FROM concept_catalog_mapping m JOIN concepts c ON c.id = m.learner_concept_id JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = $1 AND m.canonical_concept_id = $2 AND m.status = 'MATCHED'`, [me, w.le])) === 1);
  check('S53.no-fabricated-progress', (await n(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [me])) === 0 &&
    (await n(`SELECT COUNT(*) n FROM mastery_records WHERE student_id = $1 AND (attempt_count > 0 OR mastery_score > 0)`, [me])) === 0);
  const plan = await get('/api/student/plan', 'lp-student');
  const entry = plan.body?.data?.entries?.find((e: any) => e.canonicalConceptId === w.le);
  check('S53.plan-shows-entry', plan.status === 200 && entry?.planStatus === 'IN_PLAN' && entry?.displayStatus === 'IN_PLAN' && entry?.sources?.some((s: any) => s.type === 'SELF_SELECTED'), `${plan.status} ${JSON.stringify(entry ?? null).slice(0, 160)}`);

  const archive = await post(`/api/student/plan/${w.le}/archive`, 'lp-student', { archived: true });
  const archived = await q1(`SELECT plan_status, learner_concept_id FROM student_plan_entries WHERE student_id = $1 AND canonical_concept_id = $2`, [me, w.le]);
  check('S53.archive', archive.status === 200 && archived?.plan_status === 'ARCHIVED' && archived?.learner_concept_id === add.body?.data?.learnerConceptId);
  const restore = await post(`/api/student/plan/${w.le}/archive`, 'lp-student', { archived: false });
  check('S53.restore-same-state', restore.status === 200 && (await q1(`SELECT plan_status FROM student_plan_entries WHERE student_id = $1 AND canonical_concept_id = $2`, [me, w.le]))?.plan_status === 'IN_PLAN');

  const recs = await get('/api/student/recommendations', 'lp-student');
  const list: any[] = recs.body?.data?.recommendations ?? [];
  check('S53.recommendations', recs.status === 200 && Array.isArray(list) && !list.some((r) => r.canonicalConceptId === w.le && !r.inPlan), `${recs.status} n=${list.length}`);

  // Server-verified sources.
  const fakeClass = await post('/api/student/plan', 'lp-student', { canonicalConceptId: w.required, source: 'CLASS_PLAN', classId: w.klass });
  check('S53.claimed-class-source-refused', fakeClass.status === 403, `${fakeClass.status}`);
  const teacherSource = await post('/api/student/plan', 'lp-student', { canonicalConceptId: w.required, source: 'TEACHER_ASSIGNMENT' });
  check('S53.teacher-source-refused', teacherSource.status === 400, `${teacherSource.status}`);
  check('S53.unauthenticated', (await get('/api/student/plan', null)).status === 401);
  check('S53.non-student-refused', denied(await get('/api/student/plan', 'lp-teacher')));

  await page('S53-plan', '/dashboard/plan', 'lp-student', ['Mi plan', 'Explorar currículo', 'Recomendado para mí', 'Preparar un examen', 'Ecuaciones lineales']);
  await page('S53-explore', '/dashboard/plan?tab=explore&subject=mathematics', 'lp-student', ['Ecuaciones lineales', 'Logaritmos']);
  await page('S53-recommended', '/dashboard/plan?tab=recommended', 'lp-student', ['Mi plan']);
}

async function s57(w: World, state: { curriculumId?: string }) {
  const base = `/api/institutions/${w.inst}`;
  const empty = await get(`${base}/curricula`, 'lp-coord');
  check('S57.no-curriculum-yet', empty.status === 200 && (empty.body?.data?.curricula ?? empty.body?.data ?? []).length === 0, `${empty.status} ${empty.text.slice(0, 120)}`);
  const adopt = await post(`${base}/curricula`, 'lp-coord', { canonicalSubjectId: w.mathSubject, gradeId: w.grade, academicYear: '2026-2027', title: 'Matemáticas 11 LP' });
  state.curriculumId = adopt.body?.data?.id ?? adopt.body?.data?.curriculumId;
  check('S57.adopt', adopt.status === 201 && !!state.curriculumId, `${adopt.status} ${adopt.text.slice(0, 160)}`);
  // Adopting a curriculum binds no class: the coordinator associates the LP class EXPLICITLY.
  const unbound = await get(`${base}/classes/${w.klass}/curriculum`, 'lp-coord');
  check('S57.adopt-binds-no-class', unbound.status === 200 && unbound.body?.data?.currentCurriculumId === null, `${unbound.status} ${unbound.text.slice(0, 120)}`);
  const bind = await post(`${base}/classes/${w.klass}/curriculum`, 'lp-coord', { curriculumId: state.curriculumId });
  check('S57.explicit-class-binding', bind.status === 200 && bind.body?.data?.curriculumId === state.curriculumId, `${bind.status} ${bind.text.slice(0, 160)}`);
  const dup = await post(`${base}/curricula`, 'lp-coord', { canonicalSubjectId: w.mathSubject, gradeId: w.grade, academicYear: '2026-2027', title: 'Otra' });
  check('S57.adopt-duplicate-refused', dup.status === 409, `${dup.status}`);
  const detail = await get(`${base}/curricula/${state.curriculumId}`, 'lp-coord');
  const concepts: any[] = detail.body?.data?.concepts ?? [];
  check('S57.seeded-from-base', detail.status === 200 && concepts.length >= 15 && concepts.every((c) => c.classification === 'RECOMMENDED'), `${detail.status} n=${concepts.length}`);
  check('S57.catalog-untouched', (await n(`SELECT COUNT(*) n FROM canonical_concepts WHERE canonical_subject_id = $1 AND status = 'ACTIVE'`, [w.mathSubject])) === concepts.filter((c) => c.status === 'ACTIVE').length);

  const classify = await post(`${base}/curricula/${state.curriculumId}/concepts`, 'lp-coord', { canonicalConceptId: w.required, classification: 'REQUIRED', period: 'T1' });
  check('S57.classify-required', classify.status === 200 || classify.status === 201, `${classify.status}`);
  const sofiaRecs = await get('/api/student/recommendations', 'student-a');
  const req = (sofiaRecs.body?.data?.recommendations ?? []).find((r: any) => r.canonicalConceptId === w.required);
  check('S57.required-is-recommended', sofiaRecs.status === 200 && req?.reasons?.some((x: any) => x.type === 'INSTITUTION_REQUIRED'), `${sofiaRecs.status} ${JSON.stringify(req ?? null).slice(0, 160)}`);
  check('S57.required-not-auto-added', (await n(`SELECT COUNT(*) n FROM student_plan_entries WHERE canonical_concept_id = $1 AND student_id = ANY($2::uuid[])`, [w.required, [w.students['student-a'], ...Object.values(w.synthetic).flat()]])) === 0);

  const remove = await post(`${base}/curricula/${state.curriculumId}/concepts/${w.supplemental}/remove`, 'lp-coord', {});
  const removed = await q1(`SELECT status FROM institution_curriculum_concepts WHERE curriculum_id = $1 AND canonical_concept_id = $2`, [state.curriculumId, w.supplemental]);
  check('S57.remove-keeps-row', remove.status === 200 && removed?.status === 'REMOVED', `${remove.status} ${removed?.status}`);
  check('S57.audit-trail', (await n(`SELECT COUNT(*) n FROM curriculum_events WHERE curriculum_id = $1 AND event_type IN ('CURRICULUM_ADOPTED', 'CONCEPT_CLASSIFIED', 'CONCEPT_REMOVED')`, [state.curriculumId])) >= 3);

  check('S57.other-coordinator-refused', denied(await get(`${base}/curricula`, 'inst-a')));
  check('S57.teacher-cannot-govern-curriculum', denied(await post(`${base}/curricula`, 'lp-teacher', { canonicalSubjectId: w.mathSubject, title: 'x' })));
  check('S57.student-refused', denied(await get(`${base}/curricula`, 'student-a')));
  await page('S57-curriculum', `/dashboard/institution/${w.inst}/curriculum`, 'lp-coord', ['Currículo', 'Ver cobertura curricular', 'Clases y currículo']);
  await page('S57-curriculum-content', `/dashboard/institution/${w.inst}/curriculum/${state.curriculumId}`, 'lp-coord', ['Contenido curricular', 'Conceptos del currículo', 'Obligatorio']);
}

async function s54(w: World, state: { curriculumId?: string }) {
  const k = `/api/teacher/classes/${w.klass}`;
  const all = [w.students['student-a'], ...Object.values(w.synthetic).flat()];
  const view = await get(`${k}/plan`, 'lp-teacher');
  const concepts: any[] = view.body?.data?.concepts ?? [];
  check('S54.curriculum-browser', view.status === 200 && view.body?.data?.hasInstitutionCurriculum === true && view.body?.data?.activeLearners === 20 && concepts.some((c) => c.canonicalConceptId === w.le && c.classification === 'RECOMMENDED'), `${view.status} learners=${view.body?.data?.activeLearners}`);
  const coverage = concepts.find((c) => c.canonicalConceptId === w.le)?.studentsWithConcept;
  check('S54.coverage', coverage === 7, `have=${coverage}`);

  const add = await post(`${k}/plan`, 'lp-teacher', { canonicalConceptId: w.le, priority: 'HIGH', targetDate: '2026-11-15', period: 'T1' });
  check('S54.add-to-class-plan', add.status === 201 && add.body?.data?.supplemental === false, `${add.status} ${add.text.slice(0, 120)}`);
  check('S54.class-plan-enrolls-nobody', (await n(`SELECT COUNT(*) n FROM student_concept_sources WHERE class_id = $1`, [w.klass])) === 0);

  const preview = await get(`${k}/assignment-preview?canonicalConceptId=${w.le}`, 'lp-teacher');
  const p = preview.body?.data;
  check('S54.preview', preview.status === 200 && p?.have === 7 && p?.willAdd === 13 && p?.advanced <= p?.have, JSON.stringify(p));

  const before = new Map<string, Awaited<ReturnType<typeof learnerSnapshot>>>();
  for (const s of all) before.set(s, await learnerSnapshot(s, w.le));
  const assign = await post(`${k}/plan/${w.le}/assign`, 'lp-teacher', {});
  check('S54.assign-all', assign.status === 200 && assign.body?.data?.added === 13 && assign.body?.data?.alreadyHad === 7 && assign.body?.data?.skipped === 0, `${assign.status} ${JSON.stringify(assign.body?.data)}`);

  let preserved = 0;
  let linked = 0;
  let restored = 0;
  for (const s of all) {
    const b = before.get(s)!;
    const a = await learnerSnapshot(s, w.le);
    const had = b.entry && b.entry.plan_status === 'IN_PLAN';
    if (had && a.entry?.learner_concept_id === b.entry.learner_concept_id && a.mastery === b.mastery && a.evidence === b.evidence && a.concepts === b.concepts) preserved += 1;
    if (w.synthetic.ownUnlinked.includes(s) && a.concepts === b.concepts && a.evidence === b.evidence) linked += 1;
    if (w.synthetic.archived.includes(s) && a.entry?.plan_status === 'IN_PLAN' && a.entry?.learner_concept_id === b.entry?.learner_concept_id && a.mastery === b.mastery) restored += 1;
  }
  check('S54.existing-state-preserved', preserved === 7, `${preserved}/7`);
  check('S54.own-concept-linked-not-duplicated', linked === 3, `${linked}/3`);
  check('S54.archived-restored-same-state', restored === 3, `${restored}/3`);
  check('S54.everyone-in-plan', (await n(`SELECT COUNT(*) n FROM student_plan_entries WHERE canonical_concept_id = $1 AND student_id = ANY($2::uuid[]) AND plan_status = 'IN_PLAN'`, [w.le, all])) === 20);
  check('S54.one-learner-state-each', (await n(
    `SELECT COUNT(*) n FROM (SELECT s.student_id FROM concept_catalog_mapping m JOIN concepts c ON c.id = m.learner_concept_id JOIN subjects s ON s.id = c.subject_id
     WHERE m.canonical_concept_id = $1 AND m.status = 'MATCHED' AND s.student_id = ANY($2::uuid[]) GROUP BY s.student_id HAVING COUNT(*) > 1) d`, [w.le, all])) === 0);
  check('S54.class-plan-source-each', (await n(`SELECT COUNT(*) n FROM student_concept_sources WHERE canonical_concept_id = $1 AND source_type = 'CLASS_PLAN' AND source_key = $2 AND active`, [w.le, w.klass])) === 20);
  const replay = await post(`${k}/plan/${w.le}/assign`, 'lp-teacher', {});
  check('S54.assign-idempotent', replay.status === 200 && replay.body?.data?.added === 0 && replay.body?.data?.alreadyHad === 20 &&
    (await n(`SELECT COUNT(*) n FROM student_concept_sources WHERE canonical_concept_id = $1 AND source_type = 'CLASS_PLAN' AND source_key = $2`, [w.le, w.klass])) === 20, `${replay.status} ${JSON.stringify(replay.body?.data)}`);

  const matrix = await get(`${k}/matrix`, 'lp-teacher');
  const row = (matrix.body?.data?.rows ?? []).find((r: any) => r.canonicalConceptId === w.le);
  const cellTotal = row ? Object.values(row.cells as Record<string, any[]>).reduce((t, c) => t + c.length, 0) : 0;
  check('S54.matrix', matrix.status === 200 && cellTotal === 20 && (row?.cells?.NOT_STARTED?.length ?? 0) < 20, `${matrix.status} total=${cellTotal}`);

  // Supplemental: the coordinator removed Logarithms from the curriculum.
  const supp = await post(`${k}/plan`, 'lp-teacher', { canonicalConceptId: w.supplemental });
  check('S54.supplemental', supp.status === 201 && supp.body?.data?.supplemental === true, `${supp.status} ${supp.text.slice(0, 120)}`);
  check('S54.coordinator-told', (await n(`SELECT COUNT(*) n FROM notifications WHERE recipient_user_id = $1 AND notification_type = 'CURRICULUM_SUPPLEMENTAL_CONCEPT'`, [w.users['lp-coord']])) >= 1);
  const coordPage = await get(`/dashboard/institution/${w.inst}/curriculum`, 'lp-coord');
  check('S54.coordinator-sees-suggestion', coordPage.status === 200 && visible(coordPage.text).includes('Logaritmos') && visible(coordPage.text).includes(LP_CLASS_NAME));
  const takeIn = await post(`/api/institutions/${w.inst}/curricula/${state.curriculumId}/concepts`, 'lp-coord', { canonicalConceptId: w.supplemental, classification: 'SUPPLEMENTAL' });
  check('S54.coordinator-adds-to-curriculum', (takeIn.status === 200 || takeIn.status === 201) &&
    (await q1(`SELECT classification, status FROM institution_curriculum_concepts WHERE curriculum_id = $1 AND canonical_concept_id = $2`, [state.curriculumId, w.supplemental]))?.status === 'ACTIVE');

  // Remove from the class plan: only CLASS_PLAN sources retire, learning stays.
  const remove = await post(`${k}/plan/${w.supplemental}/remove`, 'lp-teacher', {});
  check('S54.remove-from-class-plan', remove.status === 200, `${remove.status}`);
  const snapBefore = await learnerSnapshot(w.students['student-a'], w.le);
  const leRemove = await post(`${k}/plan/${w.le}/remove`, 'lp-teacher', {});
  const snapAfter = await learnerSnapshot(w.students['student-a'], w.le);
  check('S54.remove-keeps-learning', leRemove.status === 200 && leRemove.body?.data?.sourcesRetired === 20 && snapAfter.entry?.learner_concept_id === snapBefore.entry?.learner_concept_id && snapAfter.mastery === snapBefore.mastery && snapAfter.evidence === snapBefore.evidence &&
    (await n(`SELECT COUNT(*) n FROM student_plan_entries WHERE canonical_concept_id = $1 AND student_id = ANY($2::uuid[]) AND plan_status = 'IN_PLAN'`, [w.le, all])) === 20, `${leRemove.status} ${JSON.stringify(leRemove.body?.data)}`);
  const readd = await post(`${k}/plan`, 'lp-teacher', { canonicalConceptId: w.le });
  check('S54.re-add', readd.status === 201 || readd.status === 200, `${readd.status}`);
  const reassign = await post(`${k}/plan/${w.le}/assign`, 'lp-teacher', {});
  check('S54.re-assign-reactivates-sources', reassign.status === 200 && reassign.body?.data?.added === 0 &&
    (await n(`SELECT COUNT(*) n FROM student_concept_sources WHERE canonical_concept_id = $1 AND source_type = 'CLASS_PLAN' AND source_key = $2 AND active`, [w.le, w.klass])) === 20, `${reassign.status} ${JSON.stringify(reassign.body?.data)}`);

  // Proposal with equivalents; StudyUS governs.
  const proposal = await post(`${k}/concept-proposals`, 'lp-teacher', { title: 'Systems of Linear Equations', rationale: 'Lo necesito para la unidad 2' });
  const candidates: any[] = proposal.body?.data?.candidates ?? [];
  check('S54.proposal-with-equivalents', proposal.status === 201 && candidates.some((c) => c.canonicalConceptId === w.le), `${proposal.status} ${candidates.map((c) => c.name).join(', ')}`);
  check('S54.proposal-no-catalog-write', (await n(`SELECT COUNT(*) n FROM canonical_concepts WHERE name = 'Systems of Linear Equations'`)) === 0);
  const adminList = await get('/api/admin/concept-proposals', 'platform-admin');
  const mine = (adminList.body?.data?.proposals ?? []).find((x: any) => x.id === proposal.body?.data?.id);
  check('S57.admin-sees-proposal', adminList.status === 200 && mine?.status === 'PROPOSED');
  check('S57.coordinator-cannot-resolve', denied(await post(`/api/admin/concept-proposals/${proposal.body?.data?.id}/resolve`, 'lp-coord', { action: 'REJECT' })));
  const resolve = await post(`/api/admin/concept-proposals/${proposal.body?.data?.id}/resolve`, 'platform-admin', { action: 'MAP_TO_EXISTING', canonicalConceptId: w.le, note: 'Ya existe' });
  check('S57.admin-maps-to-existing', resolve.status === 200 && resolve.body?.data?.status === 'MAPPED_TO_EXISTING', `${resolve.status}`);
  check('S57.resolve-once', (await post(`/api/admin/concept-proposals/${proposal.body?.data?.id}/resolve`, 'platform-admin', { action: 'REJECT' })).status === 409);
  await page('S57-admin-proposals', '/dashboard/admin/concept-proposals', 'platform-admin', ['Propuestas de conceptos', 'Systems of Linear Equations', 'Vinculado a un concepto existente']);

  // Security.
  check('S54.foreign-teacher-refused', denied(await get(`${k}/plan`, 'teacher-b')) && denied(await post(`${k}/plan/${w.le}/assign`, 'teacher-b', {})) && denied(await get(`${k}/matrix`, 'teacher-b')));
  check('S54.student-refused', denied(await get(`${k}/plan`, 'student-a')));
  check('S54.outsider-recipient-refused', (await post(`${k}/plan/${w.le}/assign`, 'lp-teacher', { studentIds: [w.students['lp-student']] })).status === 404);
  check('S54.no-assignment-from-outsider', (await n(`SELECT COUNT(*) n FROM student_concept_sources WHERE student_id = $1 AND class_id = $2`, [w.students['lp-student'], w.klass])) === 0);

  const sofiaPlan = await get('/api/student/plan', 'student-a');
  const sofiaEntry = (sofiaPlan.body?.data?.entries ?? []).find((e: any) => e.canonicalConceptId === w.le);
  check('S54.student-sees-class-source', sofiaPlan.status === 200 && sofiaEntry?.sources?.some((s: any) => s.type === 'CLASS_PLAN' && s.className === LP_CLASS_NAME), JSON.stringify(sofiaEntry?.sources ?? null).slice(0, 200));

  await page('S54-overview', `/dashboard/teacher/classes/${w.klass}`, 'lp-teacher', ['Resumen', 'Plan de aprendizaje', 'Estudiantes', 'Tareas', 'Progreso', 'Quién necesita ayuda']);
  await page('S54-plan', `/dashboard/teacher/classes/${w.klass}/plan`, 'lp-teacher', ['Plan actual de la clase', 'Ecuaciones lineales', 'Currículo sugerido', 'Necesidades detectadas', 'Proponer un concepto nuevo']);
  await page('S54-students', `/dashboard/teacher/classes/${w.klass}/students`, 'lp-teacher', ['LP Sintético 01', 'Conceptos en su plan', 'Fuentes']);
  await page('S54-progress', `/dashboard/teacher/classes/${w.klass}/progress`, 'lp-teacher', ['Progreso de la clase', 'Ecuaciones lineales']);
  await page('S54-assignments', `/dashboard/teacher/classes/${w.klass}/assignments`, 'lp-teacher', ['Tareas']);
}

async function s55(w: World) {
  const me = w.students['lp-student'];
  const objectives = (await examObjectives()).filter((o) => o.concepts.length > 0);
  // Two failed objectives with distinct concepts; one of their concepts is put in the plan first.
  const failed = objectives.slice(0, 2);
  const gapConcepts = [...new Set(failed.flatMap((f) => f.concepts))];
  const already = gapConcepts[0];
  await post('/api/student/plan', 'lp-student', { canonicalConceptId: already });
  const { profileId, attemptId } = await examAttempt(me, failed.map((f) => f.lo));

  const recs = await get('/api/student/recommendations', 'lp-student');
  const list: any[] = recs.body?.data?.recommendations ?? [];
  const examRecs = list.filter((r) => r.reasons?.some((x: any) => x.type === 'EXAM_GAP'));
  check('S55.gap-recommended', recs.status === 200 && gapConcepts.every((c) => examRecs.some((r) => r.canonicalConceptId === c)), `${recs.status} exam=${examRecs.length} expected=${gapConcepts.length}`);
  check('S55.passed-objectives-not-gaps', !examRecs.some((r) => !gapConcepts.includes(r.canonicalConceptId)));
  await page('S55-recommended', '/dashboard/plan?tab=recommended', 'lp-student', ['Un examen mostró que conviene reforzarlo', 'Ya estás trabajando este concepto']);
  const rows = await qa(`SELECT id, canonical_concept_id, status FROM learning_recommendations WHERE student_id = $1 AND exam_attempt_id = $2`, [me, attemptId]);
  check('S55.recommendation-rows', rows.length === gapConcepts.length && rows.every((r: any) => r.status === 'OPEN'), `${rows.length}`);
  const refresh = await get('/api/student/recommendations', 'lp-student');
  check('S55.refresh-idempotent', refresh.status === 200 && (await n(`SELECT COUNT(*) n FROM learning_recommendations WHERE student_id = $1`, [me])) === gapConcepts.length);

  const alreadyRec = rows.find((r: any) => r.canonical_concept_id === already);
  const beforeEntry = await q1(`SELECT learner_concept_id FROM student_plan_entries WHERE student_id = $1 AND canonical_concept_id = $2`, [me, already]);
  const acceptOld = await post(`/api/student/recommendations/${alreadyRec.id}/accept`, 'lp-student', {});
  check('S55.accept-already-in-plan', acceptOld.status === 200 && acceptOld.body?.data?.alreadyInPlan === true && acceptOld.body?.data?.learnerConceptId === beforeEntry?.learner_concept_id, `${acceptOld.status} ${acceptOld.text.slice(0, 120)}`);
  const srcTypes = (await qa(`SELECT source_type FROM student_concept_sources WHERE student_id = $1 AND canonical_concept_id = $2 AND active ORDER BY 1`, [me, already])).map((r: any) => r.source_type);
  check('S55.sources-merged', srcTypes.includes('SELF_SELECTED') && srcTypes.includes('EXAM_GAP'), srcTypes.join(','));

  const fresh = rows.find((r: any) => r.canonical_concept_id !== already);
  if (fresh) {
    const acceptNew = await post(`/api/student/recommendations/${fresh.id}/accept`, 'lp-student', {});
    check('S55.accept-new', acceptNew.status === 200 && acceptNew.body?.data?.alreadyInPlan === false && (await n(`SELECT COUNT(*) n FROM student_concept_sources WHERE student_id = $1 AND canonical_concept_id = $2 AND source_type = 'EXAM_GAP' AND source_key = $3`, [me, fresh.canonical_concept_id, attemptId])) === 1, `${acceptNew.status}`);
    const replay = await post(`/api/student/recommendations/${fresh.id}/accept`, 'lp-student', {});
    check('S55.accept-replay-no-duplicate', replay.status === 200 && (await n(`SELECT COUNT(*) n FROM student_plan_entries WHERE student_id = $1 AND canonical_concept_id = $2`, [me, fresh.canonical_concept_id])) === 1);
  }
  const third = rows.find((r: any) => r.canonical_concept_id !== already && r.id !== fresh?.id);
  if (third) {
    const dismiss = await post(`/api/student/recommendations/${third.id}/dismiss`, 'lp-student', {});
    await get('/api/student/recommendations', 'lp-student');
    check('S55.dismiss-sticks', dismiss.status === 200 && (await q1(`SELECT status FROM learning_recommendations WHERE id = $1`, [third.id]))?.status === 'DISMISSED' && (await n(`SELECT COUNT(*) n FROM student_plan_entries WHERE student_id = $1 AND canonical_concept_id = $2`, [me, third.canonical_concept_id])) === 0);
  }
  check('S55.foreign-accept-refused', denied(await post(`/api/student/recommendations/${alreadyRec.id}/accept`, 'student-a', {})));

  const prep = await get(`/api/student/exam-prep/${profileId}/plan`, 'lp-student');
  const prepConcepts: any[] = (prep.body?.data?.areas ?? []).flatMap((a: any) => a.concepts);
  check('S55.exam-prep-plan', prep.status === 200 && prepConcepts.some((c) => c.canonicalConceptId === fresh?.canonical_concept_id && c.status === 'NEEDS_REINFORCEMENT') && prepConcepts.length >= gapConcepts.length, `${prep.status} n=${prepConcepts.length}`);
  check('S55.foreign-exam-prep-refused', denied(await get(`/api/student/exam-prep/${profileId}/plan`, 'student-a')));
  check('S55.no-fabricated-progress', (await n(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [me])) === 0);
  await page('S55-exam-plan', `/dashboard/plan/exam/${profileId}`, 'lp-student', ['Plan de preparación', 'Necesita refuerzo']);
  return { failed };
}

async function s56(w: World, failed: Array<{ lo: string; concepts: string[] }>) {
  const k = `/api/teacher/classes/${w.klass}`;
  const gapStudents = [w.students['student-a'], w.synthetic.none[0], w.synthetic.inPlan[0]];
  for (const s of gapStudents) await examAttempt(s, [failed[1].lo]);
  const target = failed[1].concepts[0];
  const needs = await get(`${k}/needs`, 'lp-teacher');
  const list: any[] = needs.body?.data?.needs ?? [];
  const need = list.find((x) => x.canonicalConceptId === target);
  check('S56.needs-aggregated', needs.status === 200 && need?.students?.length === 3 && gapStudents.every((s) => need.students.some((x: any) => x.studentId === s)), `${needs.status} ${JSON.stringify(need ?? null).slice(0, 200)}`);
  check('S56.outsiders-excluded', !list.some((x) => x.students.some((s: any) => s.studentId === w.students['lp-student'])));
  check('S56.no-scores-exposed', !/fraction|score|tutor|conversation/i.test(needs.text));
  check('S56.foreign-teacher-refused', denied(await get(`${k}/needs`, 'teacher-b')));

  const preview = await get(`${k}/assignment-preview?canonicalConceptId=${target}&studentIds=${gapStudents.join(',')}`, 'lp-teacher');
  check('S56.preview-these', preview.status === 200 && preview.body?.data?.have + preview.body?.data?.willAdd === 3, JSON.stringify(preview.body?.data));
  const assign = await post(`${k}/plan/${target}/assign`, 'lp-teacher', { studentIds: gapStudents });
  check('S56.assign-these', assign.status === 200 && assign.body?.data?.assigned === 3 && assign.body?.data?.skipped === 0, JSON.stringify(assign.body?.data));
  const others = Object.values(w.synthetic).flat().filter((s) => !gapStudents.includes(s));
  check('S56.only-these', (await n(`SELECT COUNT(*) n FROM student_concept_sources WHERE canonical_concept_id = $1 AND class_id = $2 AND student_id = ANY($3::uuid[])`, [target, w.klass, others])) === 0);
  const sofiaRecs = await get('/api/student/recommendations', 'student-a');
  const rec = (sofiaRecs.body?.data?.recommendations ?? []).find((r: any) => r.canonicalConceptId === target);
  check('S56.student-already-working', sofiaRecs.status === 200 && (!rec || rec.inPlan === true), JSON.stringify(rec ?? null).slice(0, 160));
  await page('S56-plan-needs', `/dashboard/teacher/classes/${w.klass}/plan`, 'lp-teacher', ['Necesidades detectadas', 'Asignar a estos 3']);
}

async function main() {
  if (!BASE) throw new Error('usage: <baseUrl> <tokens.json>');
  const w = await prepare();
  const state: { curriculumId?: string } = {};
  console.log('\n--- 53 independent student');
  await s53(w);
  console.log('\n--- 57 coordinator');
  await s57(w, state);
  console.log('\n--- 54 teacher class (20 learners, mixed states)');
  await s54(w, state);
  console.log('\n--- 55 exam gap');
  const { failed } = await s55(w);
  console.log('\n--- 56 teacher + exam gaps');
  await s56(w, failed);
  const failedChecks = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failedChecks.length}/${results.length} checks passed`);
  if (failedChecks.length) {
    console.log('FAILED:\n' + failedChecks.map((f) => `  ${f.id} ${f.detail}`).join('\n'));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await (db as any).end?.();
  });

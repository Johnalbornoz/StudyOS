/**
 * Track A -- Institution Curriculum Management V2 + hierarchical academic
 * governance E2E over REAL HTTP as REAL Clerk DEV identities, with the DEV
 * database checked read-only for every write the journey should -- and
 * should NOT -- produce. Runs on the Learning Plan E2E world (run
 * track-a-learning-plan-e2e-http.ts first): TA Institución LP coordinated by
 * lp-coord, class "LP Matemáticas 11" (20 learners) taught by lp-teacher.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-a-curriculum-v2-e2e-http.ts <baseUrl> <tokens.json>
 *
 *  54  AICE multi-subject on one grade (bulk add, idempotent replay)
 *  55  Edit: level A Level -> AS Level with impact preview, history kept
 *  56  Archive with impact, never a hard delete
 *  57  Content: objectives include / exclude / restore / classify in bulk,
 *      catalog concepts added, structure + catalog untouched
 *  58  Class <-> curriculum association (create with curriculum, foreign refused)
 *  59  Teacher inheritance: class curriculum, REQUIRED cannot be unrequired
 *  60  Class plan subset -> student plan (selected learners, no reset / dup)
 *  61  Coverage analytics = DB truth (coverage != mastery)
 *  62  StudyUS content coverage kept separate
 *  63  Security / tenant isolation
 * 103  Mexico SEP source with provenance (no invented structure)
 * 104  Colombia MEN / Secretarías (territorial) -- no duplicate concepts
 * 105  Institution-locked class plan content (server-side locks)
 * 106  Institution task, TEACHER_SELECTS_RECIPIENTS: date lock 20 Oct vs 21 Oct
 * 107  Institution task, DIRECT_ALL_STUDENTS: delivered, student sees origin
 * 108  Teacher autonomy: own task + own plan rows stay editable
 * 109  Governance security + audit trail (actor / old / new / outcome)
 */
import { readFileSync } from 'fs';
import { db } from '@/lib/db';
import { createGrade, createTeacherAssignment } from '@/services/institution.service';
import { listInstitutionCurriculumSubjects } from '@/lib/institution/curriculum-management.service';
import { assertDev, clerk, emailFor, findClerkUser, INST_A_NAME, INST_LP_NAME, LP_CLASS_NAME, LP_SYNTHETIC_PREFIX, type Tag } from './track-a-fixtures';

const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
const TOKENS: Record<Tag, string> = JSON.parse(readFileSync(process.argv[3] ?? '', 'utf-8'));
const SUITE_TAGS: Tag[] = ['lp-coord', 'lp-teacher', 'student-a', 'teacher-b', 'inst-a'];
let mintedAt = 0;
/** Session tokens live 10 minutes; this suite is longer, so it re-mints them (DEV Clerk test identities only). */
async function freshTokens(force = false) {
  if (!force && Date.now() - mintedAt < 6 * 60_000) return;
  for (const tag of SUITE_TAGS) {
    const u = await findClerkUser(tag);
    if (!u) throw new Error(`missing Clerk identity ${tag}`);
    const session = await clerk().sessions.createSession({ userId: u.id });
    TOKENS[tag] = (await clerk().sessions.getToken(session.id, undefined, 600)).jwt;
  }
  mintedAt = Date.now();
}
const V2_PREFIX = 'V2 ';
const DUE = '2026-10-20T23:59:00-05:00';
const DUE_TEACHER_TRY = '2026-10-21T23:59:00-05:00';
const DUE_INSTITUTION_MOVE = '2026-10-22T23:59:00-05:00';

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
const patch = (path: string, who: Tag | null, body: unknown = {}) => call('PATCH', path, who, body);
const denied = (r: Res) => r.status === 401 || r.status === 403 || r.status === 404;
const locked = (r: Res) => r.status === 403 && r.body?.error === 'FIELD_LOCKED_BY_INSTITUTION';
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
const iso = (v: any) => (v ? new Date(v).toISOString() : null);

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

interface World {
  inst: string;
  instA: string;
  lpClass: string;
  lpCurriculum: string;
  users: Record<string, string>;
  students: Record<string, string>;
  synthetic: string[];
  math: string; // canonical Mathematics
  concept: Record<string, string>; // canonical concept ids by name
  sources: any[];
  g12: string;
  g10: string;
  teacherMembership: string;
}

/** Remove what a previous run of THIS suite left in the LP world (fixtures only); the LP world itself stays. */
async function resetOwnArtifacts(inst: string, lpClass: string, lpCurriculum: string) {
  const q = (sql: string, p: unknown[]) => db.query(sql, p);
  const assignments = (await qa(`SELECT id FROM institution_assignments WHERE institution_id = $1`, [inst])).map((r: any) => r.id);
  const interventions = (await qa(`SELECT id FROM teacher_interventions WHERE institution_assignment_id = ANY($1::uuid[]) OR (class_id = $2 AND title LIKE $3)`, [assignments, lpClass, `${V2_PREFIX}%`])).map((r: any) => r.id);
  await q(`DELETE FROM teacher_intervention_executions WHERE teacher_intervention_id = ANY($1::uuid[])`, [interventions]);
  await q(`DELETE FROM teacher_interventions WHERE id = ANY($1::uuid[])`, [interventions]);
  await q(`DELETE FROM institution_assignment_targets WHERE assignment_id = ANY($1::uuid[])`, [assignments]);
  await q(`DELETE FROM institution_assignments WHERE id = ANY($1::uuid[])`, [assignments]);
  // keep the LP world's own audit (its explicit class binding); only this suite's events go
  await q(`DELETE FROM academic_governance_events WHERE institution_id = $1 AND (object_id IS NULL OR object_id::text <> $2)`, [inst, lpClass]);
  await q(`DELETE FROM class_plan_concepts WHERE class_id = $1 AND owner_scope = 'INSTITUTION'`, [lpClass]);
  const v2Classes = (await qa(`SELECT id FROM classes WHERE institution_id = $1 AND name LIKE $2`, [inst, `${V2_PREFIX}%`])).map((r: any) => r.id);
  const v2Interventions = (await qa(`SELECT id FROM teacher_interventions WHERE class_id = ANY($1::uuid[])`, [v2Classes])).map((r: any) => r.id);
  await q(`DELETE FROM teacher_intervention_executions WHERE teacher_intervention_id = ANY($1::uuid[])`, [v2Interventions]);
  await q(`DELETE FROM teacher_interventions WHERE id = ANY($1::uuid[])`, [v2Interventions]);
  await q(`DELETE FROM student_concept_sources WHERE class_id = ANY($1::uuid[])`, [v2Classes]);
  await q(`DELETE FROM curriculum_events WHERE class_id = ANY($1::uuid[])`, [v2Classes]);
  await q(`DELETE FROM class_plan_concepts WHERE class_id = ANY($1::uuid[])`, [v2Classes]);
  await q(`DELETE FROM teacher_assignments WHERE class_id = ANY($1::uuid[])`, [v2Classes]);
  await q(`DELETE FROM class_enrollments WHERE class_id = ANY($1::uuid[])`, [v2Classes]);
  await q(`UPDATE concepts SET origin_class_id = NULL WHERE origin_class_id = ANY($1::uuid[])`, [v2Classes]);
  await q(`DELETE FROM classes WHERE id = ANY($1::uuid[])`, [v2Classes]);
  const others = (await qa(`SELECT id FROM institution_curricula WHERE institution_id = $1 AND id <> $2`, [inst, lpCurriculum])).map((r: any) => r.id);
  await q(`UPDATE institution_curricula SET replaced_by_curriculum_id = NULL WHERE id = ANY($1::uuid[])`, [others]);
  await q(`DELETE FROM institution_curriculum_objectives WHERE curriculum_id = ANY($1::uuid[])`, [others]);
  await q(`DELETE FROM institution_curriculum_concepts WHERE curriculum_id = ANY($1::uuid[])`, [others]);
  await q(`DELETE FROM curriculum_events WHERE curriculum_id = ANY($1::uuid[])`, [others]);
  await q(`DELETE FROM institution_curricula WHERE id = ANY($1::uuid[])`, [others]);
  await q(`DELETE FROM grades WHERE institution_id = $1 AND name LIKE $2`, [inst, `%${V2_PREFIX.trim()}`]);
}

async function prepare(): Promise<World> {
  assertDev();
  const inst = (await q1(`SELECT id FROM institutions WHERE name = $1`, [INST_LP_NAME]))?.id;
  const lpClass = (await q1(`SELECT id FROM classes WHERE institution_id = $1 AND name = $2`, [inst, LP_CLASS_NAME]))?.id;
  const lpCurriculum = (await q1(`SELECT id FROM institution_curricula WHERE institution_id = $1 AND title = 'Matemáticas 11 LP'`, [inst]))?.id;
  if (!inst || !lpClass || !lpCurriculum) throw new Error('run track-a-learning-plan-e2e-http.ts first (LP world missing)');
  const instA = (await q1(`SELECT id FROM institutions WHERE name = $1`, [INST_A_NAME])).id;
  await resetOwnArtifacts(inst, lpClass, lpCurriculum);

  const users: Record<string, string> = {};
  const students: Record<string, string> = {};
  for (const tag of ['lp-teacher', 'lp-coord', 'student-a', 'teacher-b', 'inst-a', 'lp-student'] as Tag[]) {
    const u = await q1(`SELECT u.id, s.id AS student_id FROM users u LEFT JOIN students s ON s.user_id = u.id WHERE u.email = $1`, [emailFor(tag)]);
    users[tag] = u.id;
    if (u.student_id) students[tag] = u.student_id;
  }
  const synthetic = (await qa(`SELECT id FROM students WHERE clerk_id LIKE $1 ORDER BY clerk_id`, [`${LP_SYNTHETIC_PREFIX}%`])).map((r: any) => r.id);
  const math = (await q1(`SELECT id FROM canonical_subjects WHERE name = 'Mathematics'`)).id;
  const concept: Record<string, string> = {};
  for (const r of await qa(`SELECT id, name FROM canonical_concepts WHERE canonical_subject_id = $1 AND status = 'ACTIVE'`, [math])) concept[r.name] = r.id;
  const g12 = (await createGrade(inst, `12.º ${V2_PREFIX.trim()}`)).id;
  const g10 = (await createGrade(inst, `10.º ${V2_PREFIX.trim()}`)).id;
  const teacherMembership = (await q1(`SELECT id FROM institution_memberships WHERE institution_id = $1 AND user_id = $2 AND membership_role = 'TEACHER'`, [inst, users['lp-teacher']])).id;
  const list = await get(`/api/institutions/${inst}/curriculum/subjects`, 'lp-coord');
  const sources = list.body?.data?.sources ?? [];
  check('SETUP.sources-listed', list.status === 200 && sources.length > 0, `${list.status} ${sources.length}`);
  return { inst, instA, lpClass, lpCurriculum, users, students, synthetic, math, concept, sources, g12, g10, teacherMembership };
}

const src = (w: World, programme: string, subject: string, level: string | null, authority?: string) =>
  w.sources.find((s) => s.programme === programme && s.subject === subject && (level === null || s.level === level) && (!authority || s.authority === authority));

async function subjects(w: World) {
  return ((await get(`/api/institutions/${w.inst}/curriculum/subjects`, 'lp-coord')).body?.data?.subjects ?? []) as any[];
}

// ---------------------------------------------------------------------------
// 54-63 Curriculum management V2
// ---------------------------------------------------------------------------

async function s54(w: World, st: any) {
  const AICE = 'Cambridge AICE Diploma';
  const picks = ['Mathematics', 'Biology', 'Physics', 'Chemistry'].map((s) => src(w, AICE, s, 'A Level'));
  check('S54.aice-sources-available', picks.every(Boolean) && picks.every((p) => p.structureImported), picks.map((p) => p?.code).join(','));
  const body = { gradeId: w.g12, academicYear: '2026-2027', items: picks.map((p) => ({ academicSubjectId: p.academicSubjectId, versionId: p.versionId })) };
  const add = await post(`/api/institutions/${w.inst}/curriculum/subjects`, 'lp-coord', body);
  const res: any[] = add.body?.data?.results ?? [];
  check('S54.bulk-add', add.status === 201 && res.length === 4 && res.every((r) => r.created), `${add.status} ${add.text.slice(0, 160)}`);
  const replay = await post(`/api/institutions/${w.inst}/curriculum/subjects`, 'lp-coord', body);
  check('S54.idempotent-replay', replay.status === 200 && (replay.body?.data?.results ?? []).every((r: any) => !r.created) && (replay.body?.data?.results ?? []).map((r: any) => r.curriculumId).join() === res.map((r) => r.curriculumId).join());
  const rows = (await subjects(w)).filter((s) => s.gradeId === w.g12 && s.status === 'ACTIVE');
  const codes = rows.map((r) => r.code).sort().join(',');
  check('S54.multi-subject-one-grade', rows.length === 4 && codes === '9700,9701,9702,9709' && rows.every((r) => r.programme === AICE && r.sourceType === 'INTERNATIONAL_PROGRAMME' && r.level === 'A Level'), codes);
  const objectivesOk = await Promise.all(
    rows.map(async (r) => r.objectivesIncluded === picks.find((p) => p.academicSubjectId === r.academicSubjectId).objectives && r.objectivesTotal === r.objectivesIncluded)
  );
  check('S54.objectives-seeded-from-official-structure', objectivesOk.every(Boolean), rows.map((r) => `${r.code}:${r.objectivesIncluded}/${r.objectivesTotal}`).join(' '));
  const mapped = await Promise.all(
    rows.map((r) =>
      n(
        `SELECT COUNT(DISTINCT ocm.canonical_concept_id) n FROM objective_concept_mappings ocm JOIN learning_objectives lo ON lo.id = ocm.learning_objective_id JOIN structure_nodes sn ON sn.id = lo.structure_node_id
         JOIN canonical_concepts cc ON cc.id = ocm.canonical_concept_id
         WHERE sn.structure_version_id = $1 AND ocm.status = 'PUBLISHED' AND ocm.relation_type IN ('FULL', 'PARTIAL') AND cc.status = 'ACTIVE' AND cc.canonical_subject_id = $2`,
        [r.versionId, r.canonicalSubjectId]
      )
    )
  );
  const nonAuthority = await n(`SELECT COUNT(*) n FROM institution_curriculum_concepts WHERE curriculum_id = ANY($1::uuid[]) AND source <> 'AUTHORITY'`, [rows.map((r) => r.curriculumId)]);
  check('S54.concepts-only-from-official-mappings', rows.every((r, i) => r.conceptsIncluded === mapped[i]) && nonAuthority === 0, rows.map((r, i) => `${r.code}:${r.conceptsIncluded}/${mapped[i]}`).join(' '));
  check('S54.audit', (await n(`SELECT COUNT(*) n FROM academic_governance_events WHERE institution_id = $1 AND action = 'SUBJECT_ADDED' AND outcome = 'APPLIED' AND actor_user_id = $2`, [w.inst, w.users['lp-coord']])) === 4);
  st.byCode = Object.fromEntries(rows.map((r) => [r.code, r.curriculumId]));
  await page('S54-curriculum', `/dashboard/institution/${w.inst}/curriculum`, 'lp-coord', ['Currículo', AICE, '12.º V2', '9709', '9700', '9702', '9701', 'A Level', 'Añadir asignaturas', 'Clases y currículo']);
}

async function s55(w: World, st: any) {
  const old = st.byCode['9709'];
  const as = src(w, 'Cambridge AICE Diploma', 'Mathematics', 'AS Level');
  const preview = await get(`/api/institutions/${w.inst}/curriculum/subjects/${old}/preview?academicSubjectId=${as.academicSubjectId}&versionId=${as.versionId}`, 'lp-coord');
  const p = preview.body?.data;
  check('S55.impact-preview', preview.status === 200 && p?.target?.level === 'AS Level' && typeof p.added === 'number' && typeof p.retired === 'number' && p.retired > 0 && typeof p.classes === 'number', JSON.stringify(p));
  // exclude one objective first: the decision must survive the level change
  const before = await qa(`SELECT o.learning_objective_id, lo.code FROM institution_curriculum_objectives o JOIN learning_objectives lo ON lo.id = o.learning_objective_id WHERE o.curriculum_id = $1 ORDER BY lo.code`, [old]);
  const asCodes = new Set((await qa(`SELECT lo.code FROM learning_objectives lo JOIN structure_nodes sn ON sn.id = lo.structure_node_id WHERE sn.structure_version_id = $1`, [as.versionId])).map((r: any) => r.code));
  const shared = before.find((o: any) => asCodes.has(o.code));
  if (shared) await post(`/api/institutions/${w.inst}/curriculum/subjects/${old}/content`, 'lp-coord', { objectives: [{ learningObjectiveId: shared.learning_objective_id, status: 'EXCLUDED' }] });
  const edit = await patch(`/api/institutions/${w.inst}/curriculum/subjects/${old}`, 'lp-coord', { academicSubjectId: as.academicSubjectId, versionId: as.versionId });
  const next = edit.body?.data?.curriculumId;
  check('S55.level-change', edit.status === 200 && edit.body?.data?.replaced === true && next && next !== old, `${edit.status} ${edit.text.slice(0, 160)}`);
  const oldRow = await q1(`SELECT status, replaced_by_curriculum_id, archived_at FROM institution_curricula WHERE id = $1`, [old]);
  const newRow = await q1(`SELECT status, base_academic_subject_id, grade_id FROM institution_curricula WHERE id = $1`, [next]);
  check('S55.history-preserved', oldRow?.status === 'ARCHIVED' && oldRow.replaced_by_curriculum_id === next && !!oldRow.archived_at && (await n(`SELECT COUNT(*) n FROM institution_curriculum_objectives WHERE curriculum_id = $1`, [old])) === before.length, JSON.stringify(oldRow));
  check('S55.new-version-active', newRow?.status === 'ACTIVE' && newRow.base_academic_subject_id === as.academicSubjectId && newRow.grade_id === w.g12);
  if (shared) {
    const carried = await q1(`SELECT o.status FROM institution_curriculum_objectives o JOIN learning_objectives lo ON lo.id = o.learning_objective_id WHERE o.curriculum_id = $1 AND lo.code = $2`, [next, shared.code]);
    check('S55.decisions-carried-by-code', carried?.status === 'EXCLUDED', `${shared.code} ${carried?.status}`);
  }
  check('S55.audit-old-new', (await n(`SELECT COUNT(*) n FROM academic_governance_events WHERE institution_id = $1 AND action = 'LEVEL_CHANGED' AND object_id = $2 AND old_values IS NOT NULL AND new_values IS NOT NULL`, [w.inst, next])) +
    (await n(`SELECT COUNT(*) n FROM academic_governance_events WHERE institution_id = $1 AND action = 'LEVEL_CHANGED' AND object_id = $2`, [w.inst, old])) >= 1);
  // metadata edit stays in place
  const meta = await patch(`/api/institutions/${w.inst}/curriculum/subjects/${st.byCode['9700']}`, 'lp-coord', { academicYear: '2027' });
  check('S55.metadata-in-place', meta.status === 200 && meta.body?.data?.replaced === false && (await q1(`SELECT academic_year FROM institution_curricula WHERE id = $1`, [st.byCode['9700']]))?.academic_year === '2027');
  const wrong = await patch(`/api/institutions/${w.inst}/curriculum/subjects/${next}`, 'lp-coord', { academicSubjectId: src(w, 'Cambridge AICE Diploma', 'Biology', 'AS Level').academicSubjectId });
  check('S55.other-subject-refused', wrong.status === 422 && wrong.body?.error === 'INVALID_CHANGE', `${wrong.status} ${wrong.body?.error}`);
  st.mathAS = next;
}

async function s56(w: World, st: any) {
  const physics = st.byCode['9702'];
  const usage = await get(`/api/institutions/${w.inst}/curriculum/subjects/${physics}/preview`, 'lp-coord');
  check('S56.usage-before-archive', usage.status === 200 && Array.isArray(usage.body?.data?.usage?.classes) && typeof usage.body?.data?.usage?.students === 'number');
  const objectives = await n(`SELECT COUNT(*) n FROM institution_curriculum_objectives WHERE curriculum_id = $1`, [physics]);
  const archive = await post(`/api/institutions/${w.inst}/curriculum/subjects/${physics}/archive`, 'lp-coord', { reason: 'E2E archive' });
  check('S56.archive', archive.status === 200 && archive.body?.data?.archived === true, `${archive.status}`);
  const row = await q1(`SELECT status, archived_at, archived_by_user_id, archive_reason FROM institution_curricula WHERE id = $1`, [physics]);
  check('S56.soft-archive', row?.status === 'ARCHIVED' && !!row.archived_at && row.archived_by_user_id === w.users['lp-coord'] && row.archive_reason === 'E2E archive');
  check('S56.no-hard-delete', (await n(`SELECT COUNT(*) n FROM institution_curriculum_objectives WHERE curriculum_id = $1`, [physics])) === objectives);
  const list = await subjects(w);
  check('S56.listed-as-archived', list.some((s) => s.curriculumId === physics && s.status === 'ARCHIVED') && list.filter((s) => s.gradeId === w.g12 && s.status === 'ACTIVE').length === 3);
  const again = await post(`/api/institutions/${w.inst}/curriculum/subjects/${physics}/archive`, 'lp-coord', {});
  check('S56.archive-twice-refused', again.status === 409, `${again.status}`);
  check('S56.audit', (await n(`SELECT COUNT(*) n FROM academic_governance_events WHERE object_id = $1 AND action = 'SUBJECT_ARCHIVED'`, [physics])) === 1);
  st.physics = physics;
  await page('S56-archived', `/dashboard/institution/${w.inst}/curriculum`, 'lp-coord', ['Asignaturas archivadas', 'Physics', 'Reemplazada por otra versión']);
}

async function s57(w: World, st: any) {
  const id = st.mathAS;
  const url = `/api/institutions/${w.inst}/curriculum/subjects/${id}/content`;
  const structureBefore = await n(`SELECT COUNT(*) n FROM learning_objectives lo JOIN structure_nodes sn ON sn.id = lo.structure_node_id JOIN institution_curricula ic ON ic.base_structure_version_id = sn.structure_version_id WHERE ic.id = $1`, [id]);
  const catalogBefore = await n(`SELECT COUNT(*) n FROM canonical_concepts WHERE canonical_subject_id = $1`, [w.math]);
  const content = await get(url, 'lp-coord');
  const topics: any[] = content.body?.data?.topics ?? [];
  const objectives = topics.flatMap((t) => t.objectives);
  check('S57.topics-objectives', content.status === 200 && topics.length > 0 && objectives.length === structureBefore && topics.every((t) => t.label), `${topics.length} topics / ${objectives.length} objectives`);
  const [a, b] = objectives.filter((o) => o.status === 'INCLUDED');
  const bulk = await post(url, 'lp-coord', { objectives: [{ learningObjectiveId: a.id, status: 'EXCLUDED' }, { learningObjectiveId: b.id, status: 'EXCLUDED' }] });
  const statuses = async () => Object.fromEntries((await qa(`SELECT learning_objective_id, status, classification FROM institution_curriculum_objectives WHERE curriculum_id = $1`, [id])).map((r: any) => [r.learning_objective_id, r]));
  let s = await statuses();
  check('S57.bulk-exclude', bulk.status === 200 && s[a.id].status === 'EXCLUDED' && s[b.id].status === 'EXCLUDED', `${bulk.status}`);
  await post(url, 'lp-coord', { objectives: [{ learningObjectiveId: b.id, status: 'INCLUDED' }, { learningObjectiveId: b.id, classification: 'REQUIRED' }] });
  s = await statuses();
  check('S57.restore-and-classify', s[b.id].status === 'INCLUDED' && s[b.id].classification === 'REQUIRED');
  const foreign = (await q1(`SELECT lo.id FROM learning_objectives lo JOIN structure_nodes sn ON sn.id = lo.structure_node_id WHERE sn.structure_version_id = $1 LIMIT 1`, [src(w, 'Cambridge AICE Diploma', 'Biology', 'A Level').versionId])).id;
  const bad = await post(url, 'lp-coord', { objectives: [{ learningObjectiveId: foreign, status: 'INCLUDED' }] });
  check('S57.foreign-objective-refused', bad.status === 422 && (await n(`SELECT COUNT(*) n FROM institution_curriculum_objectives WHERE curriculum_id = $1 AND learning_objective_id = $2`, [id, foreign])) === 0, `${bad.status} ${bad.body?.error}`);
  const c = w.concept;
  const addable: any[] = content.body?.data?.addable ?? [];
  const extra = addable.find((x) => ![c['Differentiation'], c['Integration']].includes(x.id))?.id;
  const add = await post(url, 'lp-coord', {
    concepts: [
      { canonicalConceptId: c['Differentiation'], status: 'INCLUDED', classification: 'REQUIRED' },
      { canonicalConceptId: c['Integration'], status: 'INCLUDED', classification: 'RECOMMENDED' },
      { canonicalConceptId: extra, status: 'INCLUDED', classification: 'OPTIONAL' },
    ],
  });
  const cs = Object.fromEntries((await qa(`SELECT canonical_concept_id, status, classification, source FROM institution_curriculum_concepts WHERE curriculum_id = $1`, [id])).map((r: any) => [r.canonical_concept_id, r]));
  check('S57.classify-and-add-catalog-concepts', add.status === 200 && cs[c['Differentiation']]?.classification === 'REQUIRED' && cs[c['Integration']]?.status === 'ACTIVE' && cs[extra]?.source === 'INSTITUTION' && cs[extra]?.classification === 'OPTIONAL', `${add.status} ${add.text.slice(0, 120)}`);
  await post(url, 'lp-coord', { concepts: [{ canonicalConceptId: extra, status: 'EXCLUDED' }] });
  check('S57.exclude-concept-keeps-row', (await q1(`SELECT status FROM institution_curriculum_concepts WHERE curriculum_id = $1 AND canonical_concept_id = $2`, [id, extra]))?.status === 'REMOVED');
  const replay = await post(url, 'lp-coord', { concepts: [{ canonicalConceptId: extra, status: 'EXCLUDED' }] });
  check('S57.no-op-not-audited', replay.status === 200 && replay.body?.data?.concepts === 0);
  st.extra = extra;
  // another ACADEMIC DOMAIN (same-domain concepts, e.g. Matemáticas, are a governed equivalence and allowed)
  const otherSubject = (await q1(
    `SELECT cc.id FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id
     WHERE cc.status = 'ACTIVE' AND cs.academic_domain_code IS DISTINCT FROM (SELECT academic_domain_code FROM canonical_subjects WHERE id = $1) LIMIT 1`,
    [w.math]
  )).id;
  check('S57.other-subject-concept-refused', (await post(url, 'lp-coord', { concepts: [{ canonicalConceptId: otherSubject, status: 'INCLUDED' }] })).status === 422);
  check('S57.structure-untouched', (await n(`SELECT COUNT(*) n FROM learning_objectives lo JOIN structure_nodes sn ON sn.id = lo.structure_node_id JOIN institution_curricula ic ON ic.base_structure_version_id = sn.structure_version_id WHERE ic.id = $1`, [id])) === structureBefore);
  check('S57.catalog-untouched', (await n(`SELECT COUNT(*) n FROM canonical_concepts WHERE canonical_subject_id = $1`, [w.math])) === catalogBefore);
  check('S57.audit-per-item', (await n(`SELECT COUNT(*) n FROM academic_governance_events WHERE institution_id = $1 AND object_type IN ('INSTITUTION_CURRICULUM_OBJECTIVE', 'INSTITUTION_CURRICULUM_CONCEPT')`, [w.inst])) >= 7);
  await page('S57-content', `/dashboard/institution/${w.inst}/curriculum/${id}`, 'lp-coord', ['Contenido curricular', 'Temas y objetivos', 'Conceptos del currículo', 'Excluido', 'Seleccionar todo', 'Fecha objetivo institucional']);
}

async function s58(w: World, st: any) {
  const create = await post(`/api/institutions/${w.inst}/classes`, 'lp-coord', { name: `${V2_PREFIX}Matemáticas 3A`, gradeId: w.g12, institutionCurriculumId: st.mathAS });
  const klass = create.body?.data?.class?.id;
  const row = klass ? await q1(`SELECT institution_curriculum_id, canonical_subject_id, grade_id FROM classes WHERE id = $1`, [klass]) : null;
  check('S58.create-class-with-curriculum', create.status === 201 && row?.institution_curriculum_id === st.mathAS && row.canonical_subject_id === w.math && row.grade_id === w.g12, `${create.status} ${create.text.slice(0, 160)}`);
  const before = await n(`SELECT COUNT(*) n FROM classes WHERE institution_id = $1`, [w.inst]);
  const archived = await post(`/api/institutions/${w.inst}/classes`, 'lp-coord', { name: `${V2_PREFIX}Física`, gradeId: w.g12, institutionCurriculumId: st.physics });
  check('S58.archived-curriculum-refused-no-class', archived.status === 404 && (await n(`SELECT COUNT(*) n FROM classes WHERE institution_id = $1`, [w.inst])) === before, `${archived.status}`);
  const instAClass = (await q1(`SELECT id, institution_curriculum_id FROM classes WHERE institution_id = $1 LIMIT 1`, [w.instA]));
  if (instAClass) {
    const spoof = await post(`/api/institutions/${w.instA}/classes/${instAClass.id}/curriculum`, 'inst-a', { curriculumId: st.mathAS });
    const after = await q1(`SELECT institution_curriculum_id FROM classes WHERE id = $1`, [instAClass.id]);
    check('S58.cross-tenant-association-refused', denied(spoof) && after.institution_curriculum_id === instAClass.institution_curriculum_id, `${spoof.status}`);
  }
  check('S58.coordinator-of-other-institution', denied(await post(`/api/institutions/${w.inst}/classes/${klass}/curriculum`, 'inst-a', { curriculumId: st.mathAS })));
  const membership = w.teacherMembership;
  await createTeacherAssignment(membership, { classId: klass });
  for (const s of w.synthetic.slice(0, 3)) {
    await db.query(`INSERT INTO class_enrollments (class_id, student_id, status, invited_by_user_id, responded_at) VALUES ($1, $2, 'ACTIVE', $3, NOW()) ON CONFLICT (class_id, student_id) DO UPDATE SET status = 'ACTIVE', ended_at = NULL`, [klass, s, w.users['lp-teacher']]);
  }
  st.klass3A = klass;
  // the LP class is associated to its curriculum by an EXPLICIT, audited coordinator choice (never by adoption / subject match)
  check('S58.lp-class-explicitly-associated', (await q1(`SELECT institution_curriculum_id FROM classes WHERE id = $1`, [w.lpClass]))?.institution_curriculum_id === w.lpCurriculum
    && Number((await q1(`SELECT count(*) n FROM academic_governance_events WHERE object_id::text = $1 AND action IN ('CLASS_CURRICULUM_ASSIGNED', 'CLASS_CURRICULUM_CHANGED')`, [w.lpClass]))?.n ?? 0) > 0);
  await page('S58-class-detail', `/dashboard/institution/${w.inst}/classes/${klass}`, 'lp-coord', ['Mathematics', 'AS Level']);
}

async function s59(w: World, st: any) {
  const k = `/api/teacher/classes/${st.klass3A}`;
  const view = await get(`${k}/plan`, 'lp-teacher');
  const v = view.body?.data;
  const diff = v?.concepts?.find((c: any) => c.canonicalConceptId === w.concept['Differentiation']);
  check('S59.teacher-sees-class-curriculum', view.status === 200 && v.curriculum?.level === 'AS Level' && v.curriculum?.archived === false && v.hasInstitutionCurriculum === true, JSON.stringify(v?.curriculum));
  check('S59.required-flag-inherited', diff?.classification === 'REQUIRED' && diff.requiredByInstitution === true && diff.inClassPlan === false);
  check('S59.excluded-not-classified', v.concepts.find((c: any) => c.canonicalConceptId === st.extra)?.classification == null);
  const addD = await post(`${k}/plan`, 'lp-teacher', { canonicalConceptId: w.concept['Differentiation'], priority: 'HIGH', targetDate: '2026-11-10' });
  const addI = await post(`${k}/plan`, 'lp-teacher', { canonicalConceptId: w.concept['Integration'], priority: 'NORMAL' });
  check('S59.class-plan-subset', addD.status === 201 && addI.status === 201 && (await n(`SELECT COUNT(*) n FROM class_plan_concepts WHERE class_id = $1 AND status = 'ACTIVE'`, [st.klass3A])) === 2, `${addD.status} ${addI.status}`);
  const unrequire = await post(`${k}/plan`, 'lp-teacher', { canonicalConceptId: w.concept['Differentiation'], requiredForClass: false });
  check('S59.required-cannot-be-unrequired', locked(unrequire), `${unrequire.status} ${unrequire.text.slice(0, 120)}`);
  check('S59.denial-audited', (await n(`SELECT COUNT(*) n FROM academic_governance_events WHERE institution_id = $1 AND outcome = 'DENIED' AND actor_user_id = $2 AND object_type = 'CLASS_PLAN_CONCEPT'`, [w.inst, w.users['lp-teacher']])) >= 1);
  check('S59.teacher-cannot-manage-curriculum', denied(await post(`/api/institutions/${w.inst}/curriculum/subjects`, 'lp-teacher', { gradeId: w.g12, items: [{ academicSubjectId: src(w, 'Cambridge AICE Diploma', 'Economics', 'A Level').academicSubjectId }] })));
  await page('S59-teacher-plan', `/dashboard/teacher/classes/${st.klass3A}/plan`, 'lp-teacher', ['Currículo de la clase', 'AS Level', 'Obligatorio de la institución']);
}

async function s60(w: World, st: any) {
  const k = `/api/teacher/classes/${st.klass3A}`;
  const [s1, s2, s3] = w.synthetic.slice(0, 3);
  const diff = w.concept['Differentiation'];
  const snapshot = async (s: string) => JSON.stringify(await qa(`SELECT concept_id, mastery_score, attempt_count FROM mastery_records WHERE student_id = $1 ORDER BY concept_id`, [s]));
  const before = await snapshot(s1);
  const assign = await post(`${k}/plan/${diff}/assign`, 'lp-teacher', { studentIds: [s1, s2] });
  check('S60.assign-selected', assign.status === 200 && assign.body?.data?.assigned === 2, `${assign.status} ${JSON.stringify(assign.body?.data)}`);
  check('S60.one-learner-state-per-concept', (await n(`SELECT COUNT(*) n FROM student_plan_entries WHERE canonical_concept_id = $1 AND student_id = ANY($2::uuid[])`, [diff, [s1, s2]])) === 2);
  check('S60.not-mass-enrolled', (await n(`SELECT COUNT(*) n FROM student_plan_entries WHERE canonical_concept_id = $1 AND student_id = $2`, [diff, s3])) === 0);
  check('S60.integration-not-auto-added', (await n(`SELECT COUNT(*) n FROM student_plan_entries WHERE canonical_concept_id = $1 AND student_id = ANY($2::uuid[])`, [w.concept['Integration'], [s1, s2, s3]])) === 0);
  const replay = await post(`${k}/plan/${diff}/assign`, 'lp-teacher', { studentIds: [s1, s2] });
  check('S60.replay-no-duplicate', replay.status === 200 && (await n(`SELECT COUNT(*) n FROM student_plan_entries WHERE canonical_concept_id = $1 AND student_id = ANY($2::uuid[])`, [diff, [s1, s2]])) === 2);
  const after = await snapshot(s1);
  const parsedBefore = JSON.parse(before);
  check('S60.no-progress-reset', JSON.parse(after).filter((r: any) => parsedBefore.some((b: any) => b.concept_id === r.concept_id)).every((r: any) => parsedBefore.find((b: any) => b.concept_id === r.concept_id).mastery_score === r.mastery_score));
}

async function s61(w: World, st: any) {
  const cov = await get(`/api/institutions/${w.inst}/curriculum/coverage?gradeId=${w.g12}`, 'lp-coord');
  const rows: any[] = cov.body?.data?.subjects ?? [];
  const m = rows.find((r) => r.curriculumId === st.mathAS);
  check('S61.rows-for-grade', cov.status === 200 && rows.length === 3 && rows.every((r) => r.gradeName === '12.º V2'), `${cov.status} ${rows.length}`);
  // DB truth
  const total = await n(`SELECT COUNT(*) n FROM institution_curriculum_concepts WHERE curriculum_id = $1 AND status = 'ACTIVE'`, [st.mathAS]);
  const inClass = await n(
    `SELECT COUNT(*) n FROM institution_curriculum_concepts icc WHERE icc.curriculum_id = $1 AND icc.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM class_plan_concepts cpc JOIN classes c ON c.id = cpc.class_id WHERE c.institution_curriculum_id = $1 AND cpc.canonical_concept_id = icc.canonical_concept_id AND cpc.status = 'ACTIVE')`,
    [st.mathAS]
  );
  const inStudent = await n(
    `SELECT COUNT(*) n FROM institution_curriculum_concepts icc WHERE icc.curriculum_id = $1 AND icc.status = 'ACTIVE' AND EXISTS (
       SELECT 1 FROM student_plan_entries e JOIN class_enrollments ce ON ce.student_id = e.student_id AND ce.status = 'ACTIVE' JOIN classes c ON c.id = ce.class_id
       WHERE c.institution_curriculum_id = $1 AND e.canonical_concept_id = icc.canonical_concept_id AND e.plan_status = 'IN_PLAN')`,
    [st.mathAS]
  );
  check('S61.numbers-equal-db', m && m.total === total && m.inClassPlans === inClass && m.inStudentPlans === inStudent && inClass === 2 && inStudent >= 1, JSON.stringify(m && { t: m.total, c: m.inClassPlans, s: m.inStudentPlans, p: m.pending }) + ` db ${total}/${inClass}/${inStudent}`);
  const pending = await n(
    `SELECT COUNT(*) n FROM institution_curriculum_concepts icc WHERE icc.curriculum_id = $1 AND icc.status = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM class_plan_concepts cpc JOIN classes c ON c.id = cpc.class_id WHERE c.institution_curriculum_id = $1 AND cpc.canonical_concept_id = icc.canonical_concept_id AND cpc.status = 'ACTIVE')
       AND NOT EXISTS (SELECT 1 FROM student_plan_entries e JOIN class_enrollments ce ON ce.student_id = e.student_id AND ce.status = 'ACTIVE' JOIN classes c ON c.id = ce.class_id
                       WHERE c.institution_curriculum_id = $1 AND e.canonical_concept_id = icc.canonical_concept_id AND e.plan_status = 'IN_PLAN')`,
    [st.mathAS]
  );
  check('S61.pending-equals-db', m.pending === pending, `${m.pending} vs ${pending}`);
  const bySource = Object.fromEntries((await qa(`SELECT source, COUNT(*)::int AS n FROM institution_curriculum_concepts WHERE curriculum_id = $1 AND status = 'ACTIVE' GROUP BY 1`, [st.mathAS])).map((r: any) => [r.source, r.n]));
  check('S61.source-breakdown', m.bySource.AUTHORITY === (bySource.AUTHORITY ?? 0) && m.bySource.INSTITUTION === (bySource.INSTITUTION ?? 0) && m.bySource.AUTHORITY + m.bySource.INSTITUTION + m.bySource.TEACHER_SUPPLEMENTAL === m.total, JSON.stringify(m.bySource));
  check('S61.objectives-planificables', m.objectivesWithConcept <= m.objectivesIncluded, `${m.objectivesWithConcept}/${m.objectivesIncluded}`);
  check('S61.no-mastery-fields', !/mastery|score|dominio/i.test(JSON.stringify(rows)));
  const drill = await get(`/api/institutions/${w.inst}/curriculum/coverage?curriculumId=${st.mathAS}`, 'lp-coord');
  const d = drill.body?.data?.coverage?.[w.concept['Differentiation']];
  check('S61.drill-down', drill.status === 200 && d?.classes === 1 && d?.students === 2, JSON.stringify(d));
  const noClass = rows.find((r) => r.curriculumId === st.byCode['9701']);
  check('S61.subject-without-class', noClass && noClass.classes === 0 && noClass.inClassPlans === 0);
}

async function s62(w: World, st: any) {
  const text = visible((await get(`/dashboard/institution/${w.inst}/coverage?curriculum=${st.mathAS}`, 'lp-coord')).text);
  check('S62.institution-coverage-block', text.includes('Cobertura de la institución') && text.includes('No representa dominio académico') && text.includes('En planes de clase'));
  check('S62.studyus-block-separate', text.includes('Cobertura de contenido StudyUS') && text.includes('Esto no es la cobertura de tu institución'));
  check('S62.no-mastery-claim', !/dominan|dominado|mastered/i.test(text));
}

async function s63(w: World, st: any) {
  const base = `/api/institutions/${w.inst}/curriculum/subjects`;
  check('S63.teacher-denied', denied(await get(base, 'lp-teacher')));
  check('S63.student-denied', denied(await get(base, 'student-a')));
  check('S63.other-coordinator-denied', denied(await get(base, 'inst-a')));
  check('S63.anonymous', (await get(base, null)).status === 401);
  check('S63.invalid-id', (await get(`/api/institutions/not-a-uuid/curriculum/subjects`, 'lp-coord')).status === 404);
  check('S63.foreign-curriculum-patch', denied(await patch(`${base}/${st.mathAS}`.replace(w.inst, w.instA), 'inst-a', { academicYear: 'x' })) && (await q1(`SELECT academic_year FROM institution_curricula WHERE id = $1`, [st.mathAS]))?.academic_year !== 'x');
  check('S63.foreign-archive', denied(await post(`/api/institutions/${w.instA}/curriculum/subjects/${st.mathAS}/archive`, 'inst-a', {})) && (await q1(`SELECT status FROM institution_curricula WHERE id = $1`, [st.mathAS]))?.status === 'ACTIVE');
  check('S63.foreign-coverage', denied(await get(`/api/institutions/${w.inst}/curriculum/coverage`, 'inst-a')));
  check('S63.unknown-academic-subject', (await post(base, 'lp-coord', { gradeId: w.g12, items: [{ academicSubjectId: '00000000-0000-4000-8000-000000000000' }] })).status === 422);
  check('S63.foreign-grade', (await post(base, 'lp-coord', { gradeId: (await q1(`SELECT id FROM grades WHERE institution_id = $1 LIMIT 1`, [w.instA]))?.id ?? '00000000-0000-4000-8000-000000000000', items: [{ academicSubjectId: src(w, 'Cambridge AICE Diploma', 'Economics', 'A Level').academicSubjectId }] })).status === 422);
  check('S63.teacher-page-denied', (await get(`/dashboard/institution/${w.inst}/curriculum`, 'lp-teacher')).status !== 200 || !visible((await get(`/dashboard/institution/${w.inst}/curriculum`, 'lp-teacher')).text).includes('Añadir asignaturas'));
  // ALBO backward compatibility (read-only)
  const albo = (await q1(`SELECT id FROM institutions WHERE name = 'ALBO'`))?.id;
  if (albo) {
    const listed = await listInstitutionCurriculumSubjects(albo, { includeArchived: true });
    check('S63.albo-config-visible', listed.some((s) => s.status === 'ACTIVE' && s.objectivesIncluded > 0), listed.map((s) => `${s.programme ?? '-'} ${s.subject} ${s.level ?? ''} ${s.status} objectives=${s.objectivesIncluded} classes=${s.classes}`).join(' | '));
  }
}

// ---------------------------------------------------------------------------
// 103-109 Official sources + hierarchical governance
// ---------------------------------------------------------------------------

async function s103(w: World) {
  const sep = src(w, 'Educación Secundaria — Plan de Estudio 2022', 'Matemáticas', null, 'Secretaría de Educación Pública (SEP)');
  check('S103.sep-source', !!sep && sep.country === 'MX' && sep.sourceType === 'GOVERNMENT_AUTHORITY' && sep.structureImported === false, JSON.stringify(sep && { c: sep.country, t: sep.sourceType }));
  const add = await post(`/api/institutions/${w.inst}/curriculum/subjects`, 'lp-coord', { gradeId: w.g10, items: [{ academicSubjectId: sep.academicSubjectId, versionId: sep.versionId }] });
  const id = add.body?.data?.results?.[0]?.curriculumId;
  check('S103.sep-adopted', add.status === 201 && !!id, `${add.status} ${add.text.slice(0, 120)}`);
  const row = (await subjects(w)).find((s) => s.curriculumId === id);
  check('S103.provenance', row?.authority === 'Secretaría de Educación Pública (SEP)' && row.country === 'MX' && row.sourceType === 'GOVERNMENT_AUTHORITY' && row.structureImported === false && row.objectivesTotal === 0, JSON.stringify(row && { a: row.authority, t: row.sourceType }));
  const db1 = await q1(`SELECT source_type, provenance, academic_programme_id FROM institution_curricula WHERE id = $1`, [id]);
  check('S103.provenance-stored', db1?.source_type === 'GOVERNMENT_AUTHORITY' && !!db1.academic_programme_id && !!db1.provenance, JSON.stringify(db1));
  await page('S103-page', `/dashboard/institution/${w.inst}/curriculum`, 'lp-coord', ['Secretaría de Educación Pública (SEP)', 'Estructura oficial aún no importada']);
}

async function s104(w: World) {
  const bog = src(w, 'Educación Media (10.º–11.º)', 'Matemáticas', null, 'Secretaría de Educación del Distrito (Bogotá)');
  const ant = src(w, 'Educación Media (10.º–11.º)', 'Matemáticas', null, 'Secretaría de Educación de Antioquia');
  check('S104.territorial-sources', !!bog && !!ant && bog.parentAuthority?.includes('Ministerio de Educación Nacional') && bog.authorityLevel === 'TERRITORIAL' && bog.country === 'CO', JSON.stringify(bog && { p: bog.parentAuthority, l: bog.authorityLevel }));
  const catalog = await n(`SELECT COUNT(*) n FROM canonical_concepts`);
  const add = await post(`/api/institutions/${w.inst}/curriculum/subjects`, 'lp-coord', { gradeId: w.g10, items: [{ academicSubjectId: bog.academicSubjectId, versionId: bog.versionId }, { academicSubjectId: ant.academicSubjectId, versionId: ant.versionId }] });
  check('S104.adopted', add.status === 201 && (add.body?.data?.results ?? []).filter((r: any) => r.created).length === 2, `${add.status}`);
  check('S104.no-duplicate-concepts', (await n(`SELECT COUNT(*) n FROM canonical_concepts`)) === catalog);
  const rows = (await subjects(w)).filter((s) => s.gradeId === w.g10 && s.status === 'ACTIVE');
  check('S104.three-authorities-one-grade', rows.length === 3 && new Set(rows.map((r) => r.authority)).size === 3, rows.map((r) => r.authority).join(' | '));
}

async function s105(w: World) {
  const seq = w.concept['Sequences and series'];
  const plan = await post(`/api/institutions/${w.inst}/classes/${w.lpClass}/plan`, 'lp-coord', { canonicalConceptId: seq, priority: 'HIGH', institutionTargetDate: '2026-10-20', period: 'T1', required: true });
  check('S105.institution-plan-content', plan.status === 201, `${plan.status} ${plan.text.slice(0, 120)}`);
  const row = await q1(`SELECT owner_scope, locked_fields, institution_target_date, priority, period, required_for_class FROM class_plan_concepts WHERE class_id = $1 AND canonical_concept_id = $2`, [w.lpClass, seq]);
  check('S105.locked-row', row?.owner_scope === 'INSTITUTION' && ['priority', 'institution_target_date', 'period', 'required_for_class', 'removal'].every((f) => row.locked_fields.includes(f)), JSON.stringify(row));
  const k = `/api/teacher/classes/${w.lpClass}`;
  const view = (await get(`${k}/plan`, 'lp-teacher')).body?.data;
  const c = view?.concepts?.find((x: any) => x.canonicalConceptId === seq);
  check('S105.teacher-sees-locked', c?.ownerScope === 'INSTITUTION' && c.lockedFields.includes('priority') && c.institutionTargetDate === '2026-10-20');
  check('S105.remove-denied', locked(await post(`${k}/plan/${seq}/remove`, 'lp-teacher', {})));
  check('S105.priority-denied', locked(await post(`${k}/plan`, 'lp-teacher', { canonicalConceptId: seq, priority: 'LOW' })));
  check('S105.period-denied', locked(await post(`${k}/plan`, 'lp-teacher', { canonicalConceptId: seq, period: 'T3' })));
  check('S105.later-date-denied', locked(await post(`${k}/plan`, 'lp-teacher', { canonicalConceptId: seq, targetDate: '2026-10-21' })));
  const earlier = await post(`${k}/plan`, 'lp-teacher', { canonicalConceptId: seq, targetDate: '2026-10-15' });
  check('S105.earlier-planning-date-allowed', earlier.status === 200 || earlier.status === 201, `${earlier.status} ${earlier.text.slice(0, 120)}`);
  const after = await q1(`SELECT status, owner_scope, institution_target_date, priority, period FROM class_plan_concepts WHERE class_id = $1 AND canonical_concept_id = $2`, [w.lpClass, seq]);
  check('S105.db-unchanged', after.status === 'ACTIVE' && after.owner_scope === 'INSTITUTION' && String(iso(after.institution_target_date)).startsWith('2026-10-20') && after.priority === 'HIGH' && after.period === 'T1', JSON.stringify(after));
  await page('S105-teacher-plan', `/dashboard/teacher/classes/${w.lpClass}/plan`, 'lp-teacher', ['Contenido definido por la institución', 'Fecha definida por la institución']);
}

async function s106(w: World, st: any) {
  const le = w.concept['Linear Equations'];
  const requestId = '6f1c2a10-0000-4000-8000-000000000106';
  const body = { canonicalConceptId: le, title: `${V2_PREFIX}Tarea institucional: ecuaciones`, instructions: 'Resolver la guía 3.', dueAt: DUE, period: 'T1', priority: 'HIGH', required: true, deliveryMode: 'TEACHER_SELECTS_RECIPIENTS', classIds: [w.lpClass], requestId };
  const create = await post(`/api/institutions/${w.inst}/institution-assignments`, 'lp-coord', body);
  const id = create.body?.data?.id;
  check('S106.created', create.status === 201 && create.body?.data?.delivered === 0, `${create.status} ${create.text.slice(0, 160)}`);
  check('S106.idempotent', (await post(`/api/institutions/${w.inst}/institution-assignments`, 'lp-coord', body)).body?.data?.id === id && (await n(`SELECT COUNT(*) n FROM institution_assignments WHERE request_id = $1`, [requestId])) === 1);
  check('S106.no-auto-delivery', (await n(`SELECT COUNT(*) n FROM teacher_interventions WHERE institution_assignment_id = $1`, [id])) === 0);
  const k = `/api/teacher/classes/${w.lpClass}`;
  const list = await get(`${k}/institution-assignments`, 'lp-teacher');
  const a = (list.body?.data?.assignments ?? []).find((x: any) => x.id === id);
  check('S106.teacher-sees-task', list.status === 200 && a && a.lockedFields.includes('due_at') && a.teacherEditableFields.join() === 'recipients' && iso(a.dueAt) === iso(DUE), JSON.stringify(a && { l: a.lockedFields, e: a.teacherEditableFields }));
  const group = a.targets[0].groupId;
  const extra = await post(`${k}/institution-assignments/${id}/recipients`, 'lp-teacher', { studentIds: [w.synthetic[0]], dueAt: DUE_TEACHER_TRY });
  check('S106.recipients-endpoint-only-recipients', locked(extra) && (await n(`SELECT COUNT(*) n FROM teacher_interventions WHERE institution_assignment_id = $1`, [id])) === 0);
  const three = w.synthetic.slice(3, 6);
  const rec = await post(`${k}/institution-assignments/${id}/recipients`, 'lp-teacher', { studentIds: three });
  check('S106.recipients-selected', rec.status === 200 && rec.body?.data?.assigned?.length === 3, `${rec.status} ${rec.text.slice(0, 160)}`);
  const rows = await qa(`SELECT student_id, due_at, owner_scope, title FROM teacher_interventions WHERE institution_assignment_id = $1`, [id]);
  check('S106.only-selected', rows.length === 3 && rows.every((r: any) => three.includes(r.student_id) && r.owner_scope === 'INSTITUTION' && iso(r.due_at) === iso(DUE) && r.title === body.title));
  const attempt = await patch(`${k}/assignments/${group}`, 'lp-teacher', { dueAt: DUE_TEACHER_TRY });
  check('S106.teacher-date-change-denied', locked(attempt) && (attempt.body?.fields ?? []).includes('due_at'), `${attempt.status} ${attempt.text.slice(0, 160)}`);
  const dbDue = await q1(`SELECT due_at FROM institution_assignments WHERE id = $1`, [id]);
  const intDue = await qa(`SELECT DISTINCT due_at FROM teacher_interventions WHERE institution_assignment_id = $1`, [id]);
  check('S106.db-keeps-20-oct', iso(dbDue.due_at) === iso(DUE) && intDue.length === 1 && iso(intDue[0].due_at) === iso(DUE), `${iso(dbDue.due_at)}`);
  check('S106.title-change-denied', locked(await patch(`${k}/assignments/${group}`, 'lp-teacher', { title: 'Otro título' })));
  const bypass = await post(`${k}/assignments`, 'lp-teacher', { canonicalConceptId: le, title: 'bypass', dueAt: DUE_TEACHER_TRY, studentIds: [w.synthetic[6]], requestId: group });
  check('S106.publish-bypass-denied', locked(bypass) && (await n(`SELECT COUNT(*) n FROM teacher_interventions WHERE assignment_group_id = $1 AND student_id = $2`, [group, w.synthetic[6]])) === 0, `${bypass.status}`);
  const denial = await q1(`SELECT old_values, new_values, actor_scope FROM academic_governance_events WHERE object_id = $1 AND outcome = 'DENIED' AND action = 'UPDATE_ATTEMPT' ORDER BY created_at LIMIT 1`, [id]);
  check('S106.denial-audited-old-new', denial?.actor_scope === 'TEACHER' && iso(denial.old_values?.due_at) === iso(DUE) && denial.new_values?.dueAt === DUE_TEACHER_TRY, JSON.stringify(denial));
  const move = await patch(`/api/institutions/${w.inst}/institution-assignments/${id}`, 'lp-coord', { dueAt: DUE_INSTITUTION_MOVE });
  const moved = await qa(`SELECT DISTINCT due_at FROM teacher_interventions WHERE institution_assignment_id = $1`, [id]);
  check('S106.institution-can-move-date', move.status === 200 && moved.length === 1 && iso(moved[0].due_at) === iso(DUE_INSTITUTION_MOVE), `${move.status}`);
  check('S106.institution-update-audited', (await n(`SELECT COUNT(*) n FROM academic_governance_events WHERE object_id = $1 AND action = 'UPDATED' AND outcome = 'APPLIED' AND old_values IS NOT NULL AND new_values IS NOT NULL`, [id])) === 1);
  st.selectTask = id;
  st.selectGroup = group;
  await page('S106-teacher-assignments', `/dashboard/teacher/classes/${w.lpClass}/assignments`, 'lp-teacher', ['Tareas de la institución', body.title, 'Esta tarea fue definida por tu institución']);
}

async function s107(w: World, st: any) {
  const quad = w.concept['Quadratic functions and inequalities'];
  const create = await post(`/api/institutions/${w.inst}/institution-assignments`, 'lp-coord', { canonicalConceptId: quad, title: `${V2_PREFIX}Tarea directa: cuadráticas`, dueAt: '2026-10-30T23:59:00-05:00', deliveryMode: 'DIRECT_ALL_STUDENTS', classIds: [w.lpClass] });
  const id = create.body?.data?.id;
  const roster = await n(`SELECT COUNT(*) n FROM class_enrollments WHERE class_id = $1 AND status = 'ACTIVE'`, [w.lpClass]);
  check('S107.direct-delivered', create.status === 201 && create.body?.data?.delivered === roster && (await n(`SELECT COUNT(*) n FROM teacher_interventions WHERE institution_assignment_id = $1 AND owner_scope = 'INSTITUTION'`, [id])) === roster, `${create.body?.data?.delivered}/${roster}`);
  check('S107.one-learner-state', (await n(`SELECT COUNT(*) n FROM (SELECT student_id FROM student_plan_entries WHERE canonical_concept_id = $1 GROUP BY student_id HAVING COUNT(*) > 1) d`, [quad])) === 0);
  check('S107.source-institution-assignment', (await n(`SELECT COUNT(*) n FROM student_concept_sources WHERE source_type = 'INSTITUTION_ASSIGNMENT' AND source_key = $1`, [id])) === roster);
  const rec = await post(`/api/teacher/classes/${w.lpClass}/institution-assignments/${id}/recipients`, 'lp-teacher', {});
  check('S107.teacher-cannot-redeliver', rec.status === 409 && rec.body?.error === 'DIRECT_DELIVERY', `${rec.status}`);
  await page('S107-student', '/dashboard/assignments', 'student-a', ['Asignación institucional']);
  st.directTask = id;
}

async function s108(w: World, st: any) {
  const k = `/api/teacher/classes/${w.lpClass}`;
  const own = await post(`${k}/assignments`, 'lp-teacher', { canonicalConceptId: w.concept['Logarithms'], title: `${V2_PREFIX}Tarea propia`, dueAt: '2026-10-25T23:59:00-05:00', studentIds: [w.synthetic[7], w.synthetic[8]] });
  const group = own.body?.data?.assignmentGroupId;
  check('S108.own-task-created', own.status === 201 && !!group, `${own.status} ${own.text.slice(0, 120)}`);
  const edit = await patch(`${k}/assignments/${group}`, 'lp-teacher', { dueAt: '2026-10-26T23:59:00-05:00' });
  const rows = await qa(`SELECT DISTINCT due_at, owner_scope FROM teacher_interventions WHERE assignment_group_id = $1`, [group]);
  check('S108.own-task-editable', edit.status === 200 && rows.length === 1 && iso(rows[0].due_at) === iso('2026-10-26T23:59:00-05:00') && rows[0].owner_scope === 'TEACHER', `${edit.status}`);
  const vec = w.concept['Vectors'];
  const add = await post(`${k}/plan`, 'lp-teacher', { canonicalConceptId: vec, priority: 'LOW', targetDate: '2026-12-01' });
  const upd = await post(`${k}/plan`, 'lp-teacher', { canonicalConceptId: vec, priority: 'HIGH', period: 'T2' });
  const rm = await post(`${k}/plan/${vec}/remove`, 'lp-teacher', {});
  check('S108.own-plan-row-editable', (add.status === 201 || add.status === 200) && upd.status === 200 && rm.status === 200, `${add.status} ${upd.status} ${rm.status}`);
  check('S108.teacher-b-cannot-edit', denied(await patch(`${k}/assignments/${group}`, 'teacher-b', { dueAt: '2026-10-27T23:59:00-05:00' })));
  await page('S108-teacher-assignments', `/dashboard/teacher/classes/${w.lpClass}/assignments`, 'lp-teacher', [`${V2_PREFIX}Tarea propia`]);
}

async function s109(w: World, st: any) {
  const base = `/api/institutions/${w.inst}/institution-assignments`;
  const body = { canonicalConceptId: w.concept['Linear Equations'], title: 'x', deliveryMode: 'DIRECT_ALL_STUDENTS', classIds: [w.lpClass] };
  check('S109.teacher-cannot-create', denied(await post(base, 'lp-teacher', body)));
  check('S109.student-cannot-create', denied(await post(base, 'student-a', body)));
  check('S109.other-coordinator-cannot-create', denied(await post(base, 'inst-a', body)));
  check('S109.other-coordinator-cannot-edit', denied(await patch(`/api/institutions/${w.instA}/institution-assignments/${st.selectTask}`, 'inst-a', { dueAt: DUE })) && denied(await patch(`${base}/${st.selectTask}`, 'inst-a', { dueAt: DUE })));
  const foreignClass = (await q1(`SELECT id FROM classes WHERE institution_id = $1 LIMIT 1`, [w.instA]))?.id;
  if (foreignClass) check('S109.foreign-class-target', denied(await post(base, 'lp-coord', { ...body, classIds: [foreignClass] })) && (await n(`SELECT COUNT(*) n FROM institution_assignment_targets WHERE class_id = $1`, [foreignClass])) === 0);
  check('S109.foreign-teacher-recipients', denied(await post(`/api/teacher/classes/${w.lpClass}/institution-assignments/${st.selectTask}/recipients`, 'teacher-b', {})));
  check('S109.foreign-teacher-list', denied(await get(`/api/teacher/classes/${w.lpClass}/institution-assignments`, 'teacher-b')));
  check('S109.teacher-cannot-edit-institution-task', denied(await patch(`${base}/${st.selectTask}`, 'lp-teacher', { dueAt: DUE_TEACHER_TRY })));
  check('S109.teacher-cannot-lock-plan', denied(await post(`/api/institutions/${w.inst}/classes/${w.lpClass}/plan`, 'lp-teacher', { canonicalConceptId: w.concept['Vectors'], required: true })));
  check('S109.anonymous', (await get(base, null)).status === 401);
  const events = await qa(`SELECT actor_scope, action, outcome, COUNT(*)::int AS n FROM academic_governance_events WHERE institution_id = $1 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, [w.inst]);
  const has = (scope: string, action: string, outcome: string) => events.some((e: any) => e.actor_scope === scope && e.action === action && e.outcome === outcome);
  check('S109.audit-trail', has('INSTITUTION', 'CREATED', 'APPLIED') && has('TEACHER', 'RECIPIENTS_ASSIGNED', 'APPLIED') && has('TEACHER', 'UPDATE_ATTEMPT', 'DENIED') && has('INSTITUTION', 'UPDATED', 'APPLIED') && has('TEACHER', 'REMOVE_ATTEMPT', 'DENIED') && has('TEACHER', 'UPDATED', 'APPLIED'), events.map((e: any) => `${e.actor_scope}:${e.action}:${e.outcome}=${e.n}`).join(' '));
  check('S109.audit-actor', (await n(`SELECT COUNT(*) n FROM academic_governance_events WHERE institution_id = $1 AND actor_user_id IS NULL`, [w.inst])) === 0);
  await page('S109-tasks', `/dashboard/institution/${w.inst}/tasks`, 'lp-coord', ['Tareas institucionales', `${V2_PREFIX}Tarea institucional: ecuaciones`, `${V2_PREFIX}Tarea directa: cuadráticas`, 'Crear tarea institucional']);
  await page('S109-interventions-origin', `/dashboard/institution/${w.inst}/interventions?curriculum=${w.lpCurriculum}&period=all&origin=INSTITUTION`, 'lp-coord', ['Origen']);
}

async function main() {
  if (!BASE) throw new Error('usage: <baseUrl> <tokens.json>');
  await freshTokens(true);
  const w = await prepare();
  const st: any = {};
  for (const [label, fn] of [
    ['54 AICE multi-subject', s54],
    ['55 edit level / version', s55],
    ['56 archive', s56],
    ['57 content management', s57],
    ['58 class association', s58],
    ['59 teacher inheritance', s59],
    ['60 student plan', s60],
    ['61 coverage analytics', s61],
    ['62 StudyUS coverage separate', s62],
    ['63 security', s63],
  ] as const) {
    console.log(`\n--- ${label}`);
    await freshTokens();
    await fn(w, st);
  }
  for (const [label, fn] of [
    ['103 Mexico SEP', s103],
    ['104 Colombia', s104],
    ['105 institution-locked class plan', s105],
    ['106 institution task: date lock + recipients', s106],
    ['107 institution task: direct', s107],
    ['108 teacher autonomy', s108],
    ['109 governance security + audit', s109],
  ] as const) {
    console.log(`\n--- ${label}`);
    await freshTokens();
    await (fn as any)(w, st);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:\n' + failed.map((f) => `  ${f.id} ${f.detail}`).join('\n'));
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

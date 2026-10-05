/**
 * Exam eligibility (Phases C/D) -- DEV scenarios with the REAL services against
 * the REAL DEV database (or an explicitly allowed ephemeral one).
 *
 *   E1  evidence graph read from the catalogue (programme -> framework)
 *   E2  Colombia grado 11 national        -> Saber 11 only
 *   E3  México 1° Preparatoria            -> PAA + PISA
 *   E4  IB DP (legacy profile)            -> IB DP, never Cambridge
 *   E5  Cambridge class binding           -> Cambridge objectives with a class reason, IB / PISA absent
 *   E6  institution assignment            -> recommended "assigned", preparation source INSTITUTION, audited
 *   E7  incompatible assignment           -> refused + audited DENIED
 *   E8  revocation                        -> no longer recommended; the preparation is kept (history)
 *   E9  class without curriculum          -> only outside-curriculum assessments assignable
 *   E10 eligibility is read-only          -> no row of learning / exam state changes while resolving
 *   E11 personal goal                     -> unrelated objective still selectable, recorded as not recommended
 *
 * Fixtures (`eel-<run>-…`, `@eligibility.test`, institution "EEL <run>") are removed at the end.
 *
 *   ELIGIBILITY_ALLOW_FP=<fp> npx tsx --env-file=<env> scripts/operations/exam-eligibility-scenarios.ts
 *   (DEV fingerprint allowed by default; production always refused)
 */
import { createHash, randomBytes } from 'crypto';
import { db } from '@/lib/db';
import { getOrCreateCanonicalUser, assignSelfServiceRole } from '@/lib/identity';
import { upsertStudentFromWebhook } from '@/lib/auth';
import { upsertAcademicProfile } from '@/services/academic-profile.service';
import { examObjectives } from '@/lib/exam-core/objectives/objective-catalog';
import { loadPickerData } from '@/lib/exam-core/objectives/picker';
import { createObjectivePreparation } from '@/lib/exam-core/objectives/preparation.service';
import { loadEligibilityGraph } from '@/lib/exam-core/eligibility/graph';
import { resolveStudentExamEligibility } from '@/lib/exam-core/eligibility/eligibility.service';
import { assignExamToClass, listClassExamAssignments, revokeClassExamAssignment, ExamAssignmentError } from '@/lib/exam-core/eligibility/class-exam-assignment.service';

const PRODUCTION_FP = '6671e7382d808d06';
const ALLOWED_FP = new Set(['2a29b99ee14a22b4', ...(process.env.ELIGIBILITY_ALLOW_FP ? [process.env.ELIGIBILITY_ALLOW_FP] : [])]);
const RUN = randomBytes(3).toString('hex');
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};
function guard() {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  if (fp === PRODUCTION_FP || !ALLOWED_FP.has(fp)) throw new Error(`REFUSING: database ${fp} is not an allowed non-production target`);
  return fp;
}
const count = async (sql: string, p: unknown[] = []) => Number((await db.query(sql, p)).rows[0]?.n ?? 0);

async function student(tag: string, profile: { countryOfStudy: string; schoolYear: string; curriculumType: string; ibProgramme?: string; ibYear?: string } | null) {
  const clerk = `eel-${RUN}-${tag}`;
  const email = `e-${tag}-${RUN}@eligibility.test`;
  const user = await getOrCreateCanonicalUser(clerk, email);
  const studentId = await upsertStudentFromWebhook(clerk, email, `Eligibility ${tag}`);
  await assignSelfServiceRole(clerk, user.id, 'STUDENT');
  if (profile) await upsertAcademicProfile(studentId, { ...profile, academicYear: '2026', profileCompleted: true } as never);
  return { user, studentId };
}

async function recommended(studentId: string) {
  const { byKey } = await resolveStudentExamEligibility(studentId);
  const frameworks = new Set<string>();
  for (const e of byKey.values()) if (e.eligible) frameworks.add(e.framework);
  return { frameworks, byKey };
}

/** A fixture institution with one class bound (explicitly) to a curriculum of `programmeName`, or unbound. */
async function institutionWithClass(tag: string, programmeName: string | null) {
  const inst = (await db.query(`INSERT INTO institutions (name) VALUES ($1) RETURNING id`, [`EEL ${RUN} ${tag}`])).rows[0].id as string;
  let curriculumId: string | null = null;
  if (programmeName) {
    const subject = (
      await db.query(
        `SELECT s.id, s.canonical_subject_id, p.id AS programme_id, s.name FROM academic_subjects s JOIN academic_programmes p ON p.id = s.programme_id
          WHERE p.name = $1 AND p.programme_type = 'CURRICULUM' AND s.canonical_subject_id IS NOT NULL AND s.status = 'ACTIVE' ORDER BY s.name LIMIT 1`,
        [programmeName]
      )
    ).rows[0];
    if (!subject) throw new Error(`no catalogued subject with a canonical subject in ${programmeName}`);
    curriculumId = (
      await db.query(
        `INSERT INTO institution_curricula (institution_id, title, canonical_subject_id, base_academic_subject_id, academic_programme_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [inst, `${programmeName} · ${subject.name}`, subject.canonical_subject_id, subject.id, subject.programme_id]
      )
    ).rows[0].id;
  }
  const classId = (await db.query(`INSERT INTO classes (name, institution_id, institution_curriculum_id) VALUES ($1, $2, $3) RETURNING id`, [`Class ${tag} ${RUN}`, inst, curriculumId])).rows[0].id as string;
  return { institutionId: inst, classId };
}

async function main() {
  const fp = guard();
  console.log(`exam eligibility scenarios on ${fp}, run ${RUN}`);
  const objectives = examObjectives();

  // ---------------------------------------------------------------- E1
  const graph = await loadEligibilityGraph();
  const fwOf = (name: string) => graph.programmes.filter((p) => p.programmeName === name).flatMap((p) => p.frameworks);
  check('E1.ib-dp-programme', fwOf('IB Diploma Programme').includes('IB_DP'), JSON.stringify(fwOf('IB Diploma Programme')));
  check('E1.cambridge-igcse-programme', fwOf('Cambridge IGCSE').includes('CIE_IGCSE'), JSON.stringify(fwOf('Cambridge IGCSE')));
  check('E1.cambridge-aice-programme', fwOf('Cambridge AICE Diploma').includes('CIE_AS_A'), JSON.stringify(fwOf('Cambridge AICE Diploma')));
  check('E1.exam-programmes-are-not-curricula', graph.programmes.every((p) => !p.frameworks.some((f) => ['PAA', 'PISA', 'SABER11'].includes(f))));

  // ---------------------------------------------------------------- E2 / E3 / E4
  const co = await student('co11', { countryOfStudy: 'CO', schoolYear: '11°', curriculumType: 'national' });
  const rCo = await recommended(co.studentId);
  check('E2.colombia-11-saber-only', [...rCo.frameworks].join() === 'SABER11', [...rCo.frameworks].join());

  const mx = await student('mx10', { countryOfStudy: 'MX', schoolYear: '1° Preparatoria', curriculumType: 'national' });
  const rMx = await recommended(mx.studentId);
  check('E3.mexico-prepa1-paa-pisa', [...rMx.frameworks].sort().join() === 'PAA,PISA', [...rMx.frameworks].join());

  const ib = await student('ibdp', { countryOfStudy: 'CO', schoolYear: '11', curriculumType: 'ib', ibProgramme: 'DP', ibYear: 'DP1' });
  const rIb = await recommended(ib.studentId);
  check('E4.ib-dp-recommended', rIb.frameworks.has('IB_DP'), [...rIb.frameworks].join());
  check('E4.ib-never-cambridge', !['CIE_IGCSE', 'CIE_AS_A', 'CIE_AICE'].some((f) => rIb.frameworks.has(f)));
  const pickIb = await loadPickerData(ib.studentId, 'es');
  const ibRow = pickIb.objectives.find((o) => o.framework === 'IB_DP' && o.recommended);
  check('E4.reason-plain-language', !!ibRow?.reason && /^Disponible porque sigues IB Diploma Programme\.$/.test(ibRow.reason), ibRow?.reason ?? '');
  check('E4.catalogue-still-reachable', pickIb.objectives.length === objectives.length && pickIb.objectives.some((o) => !o.recommended));

  // ---------------------------------------------------------------- E5 Cambridge class
  const cam = await institutionWithClass('cambridge', 'Cambridge IGCSE');
  const kid = await student('cam', null);
  await db.query(`INSERT INTO class_enrollments (class_id, student_id) VALUES ($1, $2)`, [cam.classId, kid.studentId]);
  const rCam = await recommended(kid.studentId);
  check('E5.cambridge-class-recommends-igcse', rCam.frameworks.has('CIE_IGCSE'), [...rCam.frameworks].join());
  check('E5.unrelated-exams-hidden', !['IB_DP', 'PISA', 'PAA', 'SABER11'].some((f) => rCam.frameworks.has(f)), [...rCam.frameworks].join());
  const pickCam = await loadPickerData(kid.studentId, 'es');
  const camRow = pickCam.objectives.find((o) => o.key === 'cie.igcse.0580.extended');
  check('E5.class-reason', !!camRow?.recommended && /^Disponible porque tu clase .+ sigue Cambridge IGCSE/.test(camRow.reason ?? ''), camRow?.reason ?? '');

  // ---------------------------------------------------------------- E6 institution assignment
  const admin = await getOrCreateCanonicalUser(`eel-${RUN}-admin`, `admin-${RUN}@eligibility.test`);
  const a6 = await assignExamToClass({ institutionId: cam.institutionId, classId: cam.classId, objectiveKey: 'pisa.2022', actorUserId: admin.id, actorScope: 'INSTITUTION' });
  const again = await assignExamToClass({ institutionId: cam.institutionId, classId: cam.classId, objectiveKey: 'pisa.2022', actorUserId: admin.id, actorScope: 'INSTITUTION' });
  check('E6.assignment-idempotent', a6.created && !again.created && again.id === a6.id);
  const rAssigned = await recommended(kid.studentId);
  const pisa = rAssigned.byKey.get('pisa.2022')!;
  check('E6.assigned-recommended', pisa.eligible && pisa.reasons[0].code === 'INSTITUTION_ASSIGNED' && pisa.rank === 0);
  const prep = await createObjectivePreparation(kid.studentId, { objectiveKey: 'pisa.2022' });
  const prepRow = (await db.query(`SELECT source, objective_context FROM student_exam_profiles WHERE id = $1`, [prep.profile.id])).rows[0];
  check('E6.preparation-source-institution', prepRow.source === 'INSTITUTION' && prepRow.objective_context?.eligibility?.reasons?.includes('INSTITUTION_ASSIGNED'), JSON.stringify(prepRow.objective_context?.eligibility));
  check('E6.audited', (await count(`SELECT count(*) n FROM academic_governance_events WHERE institution_id = $1 AND object_type = 'CLASS_EXAM_ASSIGNMENT' AND action = 'ASSIGN' AND outcome = 'APPLIED'`, [cam.institutionId])) === 1);
  const profileBefore = (await db.query(`SELECT * FROM student_academic_profile WHERE student_id = $1`, [kid.studentId])).rows.length;
  check('E6.profile-not-modified', profileBefore === 0);

  // ---------------------------------------------------------------- E7 incompatible assignment
  const ibObjective = objectives.find((o) => o.framework === 'IB_DP')!;
  let refused = false;
  try {
    await assignExamToClass({ institutionId: cam.institutionId, classId: cam.classId, objectiveKey: ibObjective.key, actorUserId: admin.id, actorScope: 'TEACHER' });
  } catch (e) {
    refused = e instanceof ExamAssignmentError && e.code === 'OBJECTIVE_NOT_COMPATIBLE';
  }
  check('E7.ib-to-cambridge-class-refused', refused);
  check('E7.denial-audited', (await count(`SELECT count(*) n FROM academic_governance_events WHERE institution_id = $1 AND object_type = 'CLASS_EXAM_ASSIGNMENT' AND outcome = 'DENIED'`, [cam.institutionId])) === 1);
  let foreign = false;
  const other = await institutionWithClass('other', null);
  try {
    await assignExamToClass({ institutionId: other.institutionId, classId: cam.classId, objectiveKey: 'pisa.2022', actorUserId: admin.id, actorScope: 'INSTITUTION' });
  } catch (e) {
    foreign = e instanceof ExamAssignmentError && e.code === 'NOT_FOUND';
  }
  check('E7.foreign-class-not-found', foreign);

  // ---------------------------------------------------------------- E8 revocation keeps history
  await revokeClassExamAssignment({ institutionId: cam.institutionId, classId: cam.classId, assignmentId: a6.id, actorUserId: admin.id, actorScope: 'INSTITUTION' });
  const rRevoked = await recommended(kid.studentId);
  check('E8.revoked-not-recommended', !rRevoked.byKey.get('pisa.2022')!.eligible);
  check('E8.preparation-kept', (await count(`SELECT count(*) n FROM student_exam_profiles WHERE id = $1 AND status = 'ACTIVE'`, [prep.profile.id])) === 1);
  check('E8.row-kept-revoked', (await count(`SELECT count(*) n FROM class_exam_assignments WHERE id = $1 AND status = 'REVOKED' AND revoked_at IS NOT NULL`, [a6.id])) === 1);

  // ---------------------------------------------------------------- E9 class without curriculum
  const listOther = await listClassExamAssignments(other.institutionId, other.classId);
  const fwOther = new Set(listOther.assignable.map((a) => a.framework));
  check('E9.unbound-class-only-outside-curriculum', [...fwOther].sort().join() === 'PAA,PISA,SABER11' && listOther.curriculum === null, [...fwOther].join());
  const listCam = await listClassExamAssignments(cam.institutionId, cam.classId);
  check('E9.cambridge-class-assignable', listCam.assignable.some((a) => a.framework === 'CIE_IGCSE') && !listCam.assignable.some((a) => a.framework === 'IB_DP'));

  // ---------------------------------------------------------------- E10 read-only + timing
  const tables = ['student_exam_profiles', 'exam_attempts', 'learning_evidence', 'concept_knowledge_state', 'student_academic_profile', 'class_exam_assignments', 'academic_governance_events'];
  const snapshot = async () => Promise.all(tables.map((t) => count(`SELECT count(*) n FROM ${t}`)));
  const before = await snapshot();
  const real = (await db.query(`SELECT student_id FROM student_academic_profile ORDER BY updated_at DESC NULLS LAST LIMIT 20`)).rows.map((r: any) => r.student_id as string);
  const t0 = Date.now();
  for (const sid of real) await resolveStudentExamEligibility(sid);
  const perStudent = Math.round((Date.now() - t0) / Math.max(real.length, 1));
  const after = await snapshot();
  check('E10.resolution-writes-nothing', before.every((n, i) => n === after[i]), tables.map((t, i) => `${t}:${before[i]}->${after[i]}`).join(' '));
  check('E10.resolution-fast', perStudent < 1500, `${perStudent} ms/student over ${real.length}`);

  // ---------------------------------------------------------------- E11 personal goal
  const goal = await createObjectivePreparation(co.studentId, { objectiveKey: 'cie.igcse.0580.extended' });
  const goalRow = (await db.query(`SELECT source, objective_context FROM student_exam_profiles WHERE id = $1`, [goal.profile.id])).rows[0];
  check('E11.personal-goal-allowed-and-recorded', goal.created && goalRow.source === 'STUDENT' && goalRow.objective_context?.eligibility?.recommended === false);
}

// ------------------------------------------------------------------ cleanup
const childRefs = new Map<string, { t: string; c: string }[]>();
async function refsTo(table: string) {
  if (!childRefs.has(table)) {
    const rows = (await db.query(
      `SELECT conrelid::regclass::text AS t, a.attname AS c FROM pg_constraint con JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        WHERE con.contype = 'f' AND confrelid::regclass::text = $1 AND array_length(con.conkey, 1) = 1 AND conrelid::regclass::text <> $1`,
      [table]
    )).rows as { t: string; c: string }[];
    childRefs.set(table, rows);
  }
  return childRefs.get(table)!;
}
/** Deletes fixture rows and every row that references them (fixture-only ids). */
async function deleteCascade(table: string, col: string, ids: string[], depth = 0): Promise<void> {
  if (ids.length === 0 || depth > 8) return;
  for (const ch of await refsTo(table)) {
    const rowIds = (await db.query(`SELECT id::text AS id FROM ${table} WHERE ${col}::text = ANY($1::text[])`, [ids]).catch(() => ({ rows: [] }))).rows.map((r: any) => r.id);
    const childIds = (await db.query(`SELECT id::text AS id FROM ${ch.t} WHERE ${ch.c}::text = ANY($1::text[])`, [rowIds]).catch(() => ({ rows: [] }))).rows.map((r: any) => r.id);
    if (childIds.length) await deleteCascade(ch.t, 'id', childIds, depth + 1);
    else await db.query(`DELETE FROM ${ch.t} WHERE ${ch.c}::text = ANY($1::text[])`, [rowIds]).catch(() => undefined);
  }
  await db.query(`DELETE FROM ${table} WHERE ${col}::text = ANY($1::text[])`, [ids]);
}

async function cleanup() {
  guard();
  const run = process.env.ELIGIBILITY_CLEANUP_RUN && /^[0-9a-f]{6}$/.test(process.env.ELIGIBILITY_CLEANUP_RUN) ? process.env.ELIGIBILITY_CLEANUP_RUN : RUN;
  const ids = async (sql: string, p: unknown[]) => (await db.query(sql, p)).rows.map((r: any) => r.id as string);
  const userIds = await ids(`SELECT id FROM users WHERE clerk_id LIKE $1`, [`eel-${run}-%`]);
  const studentIds = await ids(`SELECT id FROM students WHERE clerk_id LIKE $1`, [`eel-${run}-%`]);
  const instIds = await ids(`SELECT id FROM institutions WHERE name LIKE $1`, [`EEL ${run} %`]);
  await db.query(`DELETE FROM class_exam_assignments WHERE institution_id = ANY($1::uuid[])`, [instIds]);
  await db.query(`DELETE FROM academic_governance_events WHERE institution_id = ANY($1::uuid[])`, [instIds]);
  await db.query(`DELETE FROM class_enrollments WHERE class_id IN (SELECT id FROM classes WHERE institution_id = ANY($1::uuid[]))`, [instIds]);
  await db.query(`DELETE FROM classes WHERE institution_id = ANY($1::uuid[])`, [instIds]);
  await db.query(`DELETE FROM institution_curricula WHERE institution_id = ANY($1::uuid[])`, [instIds]);
  await db.query(`DELETE FROM institutions WHERE id = ANY($1::uuid[])`, [instIds]);
  await db.query(`DELETE FROM analytics_events WHERE student_id = ANY($1::uuid[])`, [studentIds]);
  await db.query(`UPDATE student_exam_profiles SET replaced_by_profile_id = NULL WHERE student_id = ANY($1::uuid[])`, [studentIds]);
  await db.query(`DELETE FROM preparation_goals WHERE student_exam_profile_id IN (SELECT id FROM student_exam_profiles WHERE student_id = ANY($1::uuid[]))`, [studentIds]).catch(() => undefined);
  await db.query(`DELETE FROM student_exam_profiles WHERE student_id = ANY($1::uuid[])`, [studentIds]);
  await db.query(`DELETE FROM student_academic_profile WHERE student_id = ANY($1::uuid[])`, [studentIds]);
  await db.query(`DELETE FROM admin_audit_log WHERE actor_user_id = ANY($1::uuid[]) OR target_id = ANY($2::text[])`, [userIds, userIds]);
  await db.query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [userIds]);
  await deleteCascade('students', 'id', studentIds);
  await deleteCascade('profiles', 'user_id', userIds);
  await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
  const left = (await count(`SELECT count(*) n FROM users WHERE clerk_id LIKE $1`, [`eel-${run}-%`])) + (await count(`SELECT count(*) n FROM institutions WHERE name LIKE $1`, [`EEL ${run} %`]));
  check('CLEANUP.no-fixtures-left', left === 0, `remaining=${left}`);
}

(process.env.ELIGIBILITY_CLEANUP_RUN ? Promise.resolve() : main())
  .catch((e) => check('RUN.error', false, e instanceof Error ? `${e.name}: ${e.message}` : String(e)))
  .then(() => cleanup().catch((e) => check('CLEANUP.error', false, e instanceof Error ? e.message : String(e))))
  .finally(async () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    await db.end();
    process.exitCode = failed.length ? 1 : 0;
  });

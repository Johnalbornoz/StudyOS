/**
 * Track A -- Canonical ACADEMIC DOMAIN vs CURRICULUM SUBJECT: DEV scenarios with
 * the REAL services against the REAL DEV database.
 *
 *   1  SEP Matemáticas and Cambridge Mathematics 9709 share the MATHEMATICS domain, stay distinct subjects
 *   2  the coordinator sees both as separate, fully labelled candidates
 *   3  no automatic binding (creating a curriculum binds nothing; no subject/grade fallback)
 *   4  explicit Cambridge binding           5  explicit SEP binding
 *   6  changing the binding preserves learner history (enrollments, plan, learner state)
 *   7  the curriculum-derived Class Plan content follows the new binding
 *   8  one canonical concept -> one learner state across both curricula (governed equivalence)
 *   9  no curriculum structure contamination      10 cross-tenant binding denied
 *   +  ALBO untouched
 *
 * DEV ONLY (fingerprint guard). Fixtures (`tadc-<run>-…`, `@tracka.test`, institutions
 * "TA Dominio <run> …") are removed at the end.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-a-domain-curriculum-scenarios.ts
 */
import { createHash, randomBytes } from 'crypto';
import { db } from '@/lib/db';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { upsertStudentFromWebhook } from '@/lib/auth';
import { createInstitution, createGrade, createClass, enrollStudent } from '@/services/institution.service';
import {
  addInstitutionCurriculumSubjects,
  assignClassCurriculum,
  compatibleCurriculaForClass,
  listCurriculumSourceOptions,
  listInstitutionCurriculumSubjects,
  updateInstitutionCurriculumContentStatus,
  CurriculumManagementError,
} from '@/lib/institution/curriculum-management.service';
import { adoptInstitutionCurriculum, curriculumForClass } from '@/lib/learning-plan/institution-curriculum.service';
import { curriculumContextLabel } from '@/lib/institution/curriculum-identity';

const DEV_FP = '2a29b99ee14a22b4';
const ALBO_CLASS = '67596c78-aa42-472f-862a-5daac15dc042';
const RUN = randomBytes(3).toString('hex');
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};
function guard() {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  if (fp !== DEV_FP) throw new Error(`REFUSING: not the DEV database (${fp})`);
  return fp;
}
const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
const n = async (sql: string, p: unknown[] = []) => Number((await one(sql, p))?.n ?? 0);
async function rejects(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
    return false;
  } catch (e: any) {
    return e instanceof CurriculumManagementError && e.code === code;
  }
}
const subjectId = async (name: string) => (await one(`SELECT id FROM canonical_subjects WHERE name = $1`, [name])).id as string;

/** DEV fixture: the Student studies canonical concept `cc` (one learner concept, matched, with a knowledge state). */
async function studies(studentId: string, cc: string) {
  const subj = await one(`SELECT cs.name FROM canonical_concepts c JOIN canonical_subjects cs ON cs.id = c.canonical_subject_id WHERE c.id = $1`, [cc]);
  const subject = (await one(`INSERT INTO subjects (student_id, name) VALUES ($1, $2) RETURNING id`, [studentId, `${subj.name} ${RUN}`])).id;
  const concept = (await one(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [subject, `catalog:${cc}`])).id;
  await db.query(`INSERT INTO concept_catalog_mapping (learner_concept_id, canonical_concept_id, status, mapping_method) VALUES ($1, $2, 'MATCHED', 'SEED_FIXTURE')`, [concept, cc]);
  const policy = Number((await one(`SELECT COALESCE(max(version), 1) AS v FROM mastery_policies`)).v) || 1;
  await db.query(
    `INSERT INTO concept_knowledge_state (student_id, concept_id, subject_id, mastery_state, validation_readiness, evidence_count, mastery_policy_version) VALUES ($1, $2, $3, 'DEVELOPING', 'INSUFFICIENT_EVIDENCE', 4, $4)`,
    [studentId, concept, subject, policy]
  );
  return { subject, concept };
}

async function main() {
  console.log(`track-a domain vs curriculum scenarios -- db ${guard()} -- run ${RUN}`);
  const alboBefore = JSON.stringify((await one(`SELECT row_to_json(c) AS j FROM classes c WHERE id = $1`, [ALBO_CLASS]))?.j ?? null);

  const coord = await getOrCreateCanonicalUser(`tadc-${RUN}-coord`, `c-${RUN}@tracka.test`);
  const X = await createInstitution(`TA Dominio ${RUN} X`);
  const Y = await createInstitution(`TA Dominio ${RUN} Y`);
  const grade = await createGrade(X.id, '3º Preparatoria');
  const math = await subjectId('Matemáticas');
  const mathEn = await subjectId('Mathematics');

  // ---------------------------------------------------------------- curricula
  const sep = await adoptInstitutionCurriculum({ institutionId: X.id, canonicalSubjectId: math, gradeId: grade.id, programmeLabel: 'SEP · 3º Preparatoria', academicYear: '2026', title: 'Matemáticas', actorUserId: coord.id, locale: 'es' });
  const options = await listCurriculumSourceOptions();
  const opt9709 = options.find((o) => o.code === '9709' && /^A Level/i.test(o.level ?? '')) ?? options.find((o) => o.code === '9709');
  if (!opt9709) throw new Error('no Cambridge 9709 published subject on DEV');
  const [cam] = await addInstitutionCurriculumSubjects({ institutionId: X.id, actorUserId: coord.id, gradeId: grade.id, academicYear: '2026', items: [{ academicSubjectId: opt9709.academicSubjectId, versionId: opt9709.versionId }] });
  const physics = options.find((o) => o.canonicalSubject === 'Physics');
  const [phy] = physics ? await addInstitutionCurriculumSubjects({ institutionId: X.id, actorUserId: coord.id, gradeId: grade.id, items: [{ academicSubjectId: physics.academicSubjectId, versionId: physics.versionId }] }) : [null];
  const ySep = await adoptInstitutionCurriculum({ institutionId: Y.id, canonicalSubjectId: math, programmeLabel: 'SEP · Y', title: 'Matemáticas Y', actorUserId: coord.id, locale: 'es' });

  const rows = await listInstitutionCurriculumSubjects(X.id);
  const rSep = rows.find((r) => r.curriculumId === sep.id)!;
  const rCam = rows.find((r) => r.curriculumId === cam.curriculumId)!;
  check('T1.same-domain-distinct-subjects', rSep.academicDomain === 'MATHEMATICS' && rCam.academicDomain === 'MATHEMATICS' && rSep.curriculumId !== rCam.curriculumId && rSep.canonicalSubjectId !== rCam.canonicalSubjectId && rSep.academicSubjectId !== rCam.academicSubjectId, `${rSep.subject} | ${rCam.subject} ${rCam.code ?? ''}`);
  const lSep = curriculumContextLabel(rSep);
  const lCam = curriculumContextLabel(rCam);
  check('T1.labels-carry-context', lSep !== lCam && lSep.includes('SEP') && lCam.includes('9709') && !['Mathematics', 'Matemáticas'].includes(lSep) && !['Mathematics', 'Matemáticas'].includes(lCam), `${lSep} || ${lCam}`);

  // ---------------------------------------------------------------- classes: domain, no automatic binding
  const klass = await createClass(X.id, grade.id, 'Math 3A', mathEn);
  await db.query(`UPDATE classes SET academic_domain_code = 'MATHEMATICS' WHERE id = $1`, [klass.id]);
  const klass2 = await createClass(X.id, grade.id, 'Matemáticas 3B', math);
  // A curriculum created AFTER the classes, same subject and grade: still nothing is bound.
  const late = await adoptInstitutionCurriculum({ institutionId: X.id, canonicalSubjectId: mathEn, gradeId: grade.id, academicYear: '2027', programmeLabel: 'Institución', title: 'Mathematics (own)', actorUserId: coord.id, locale: 'es' });
  const cand = await compatibleCurriculaForClass(X.id, grade.id, 'MATHEMATICS');
  const cSep = cand.find((c) => c.curriculumId === sep.id);
  const cCam = cand.find((c) => c.curriculumId === cam.curriculumId);
  const cPhy = phy ? cand.find((c) => c.curriculumId === phy.curriculumId) : null;
  check('T2.both-separate-candidates', !!cSep?.compatible && !!cCam?.compatible && cand.indexOf(cSep!) >= 0 && (!phy || cPhy?.compatible === false), `${cand.filter((c) => c.compatible).length} compatible / ${cand.length}`);
  check('T2.other-tenant-not-a-candidate', !cand.some((c) => c.curriculumId === ySep.id));
  const bound = await n(`SELECT count(*) n FROM classes WHERE id = ANY($1::uuid[]) AND institution_curriculum_id IS NOT NULL`, [[klass.id, klass2.id]]);
  check('T3.no-automatic-binding', bound === 0 && (await curriculumForClass(klass.id)) === null && (await curriculumForClass(klass2.id)) === null && !!late.id);

  // ---------------------------------------------------------------- explicit bindings
  const a1 = await assignClassCurriculum({ institutionId: X.id, classId: klass.id, curriculumId: cam.curriculumId, actorUserId: coord.id });
  const ev1 = await n(`SELECT count(*) n FROM academic_governance_events WHERE object_id::text = $1 AND action = 'CLASS_CURRICULUM_ASSIGNED'`, [klass.id]);
  check('T4.explicit-cambridge-binding', a1.curriculumId === cam.curriculumId && (await curriculumForClass(klass.id))?.curriculumId === cam.curriculumId && ev1 === 1);
  await assignClassCurriculum({ institutionId: X.id, classId: klass2.id, curriculumId: sep.id, actorUserId: coord.id });
  check('T5.explicit-sep-binding', (await curriculumForClass(klass2.id))?.curriculumId === sep.id);
  check('T5.other-domain-refused', !phy || (await rejects(() => assignClassCurriculum({ institutionId: X.id, classId: klass2.id, curriculumId: phy.curriculumId, actorUserId: coord.id, confirmImpact: true }), 'DOMAIN_MISMATCH')));

  // ---------------------------------------------------------------- learner history + class plan content on re-binding
  const studentClerk = `tadc-${RUN}-student`;
  await getOrCreateCanonicalUser(studentClerk, `s-${RUN}@tracka.test`);
  const studentId = await upsertStudentFromWebhook(studentClerk, `s-${RUN}@tracka.test`, `TA Dominio ${RUN}`);
  await enrollStudent(klass.id, studentId);
  await enrollStudent(klass2.id, studentId);
  const camConcepts = (await db.query(`SELECT canonical_concept_id AS id FROM institution_curriculum_concepts WHERE curriculum_id = $1 AND status = 'ACTIVE' ORDER BY order_index LIMIT 2`, [cam.curriculumId])).rows.map((r: any) => r.id);
  const sepConcepts = (await db.query(`SELECT canonical_concept_id AS id FROM institution_curriculum_concepts WHERE curriculum_id = $1 AND status = 'ACTIVE' ORDER BY order_index`, [sep.id])).rows.map((r: any) => r.id);
  if (camConcepts[0]) {
    await db.query(`INSERT INTO class_plan_concepts (class_id, canonical_concept_id, status, added_by_user_id) VALUES ($1, $2, 'ACTIVE', $3)`, [klass.id, camConcepts[0], coord.id]).catch(() => undefined);
  }
  const learned = camConcepts[0] ? await studies(studentId, camConcepts[0]) : null;
  const snapshot = async () => JSON.stringify({
    enrollments: (await db.query(`SELECT class_id, status FROM class_enrollments WHERE student_id = $1 ORDER BY class_id`, [studentId])).rows,
    state: (await db.query(`SELECT concept_id, mastery_state, evidence_count FROM concept_knowledge_state WHERE student_id = $1 ORDER BY concept_id`, [studentId])).rows,
    plan: (await db.query(`SELECT canonical_concept_id, status FROM class_plan_concepts WHERE class_id = $1 ORDER BY canonical_concept_id`, [klass.id])).rows,
  });
  const before = await snapshot();
  const planBefore = await curriculumForClass(klass.id);
  check('T6.rebinding-needs-confirmation', await rejects(() => assignClassCurriculum({ institutionId: X.id, classId: klass.id, curriculumId: sep.id, actorUserId: coord.id }), 'IMPACT_CONFIRMATION_REQUIRED'));
  await assignClassCurriculum({ institutionId: X.id, classId: klass.id, curriculumId: sep.id, actorUserId: coord.id, confirmImpact: true });
  check('T6.learner-history-preserved', (await snapshot()) === before);
  const planAfter = await curriculumForClass(klass.id);
  const ev2 = await one(`SELECT old_values, new_values FROM academic_governance_events WHERE object_id::text = $1 AND action = 'CLASS_CURRICULUM_CHANGED' ORDER BY created_at DESC LIMIT 1`, [klass.id]);
  check('T6.change-audited', !!ev2 && ev2.old_values?.curriculumId === cam.curriculumId && ev2.new_values?.curriculumId === sep.id);
  const sameSets = JSON.stringify([...(planBefore?.classifications.keys() ?? [])].sort()) === JSON.stringify([...(planAfter?.classifications.keys() ?? [])].sort());
  check('T7.class-plan-content-follows-binding', planBefore?.curriculumId === cam.curriculumId && planAfter?.curriculumId === sep.id && !sameSets, `${planBefore?.classifications.size} -> ${planAfter?.classifications.size} concepts`);

  // ---------------------------------------------------------------- knowledge reuse via ONE canonical concept
  // Governance confirms equivalence: the coordinator adds a SEP (Matemáticas catalog) concept to the Cambridge curriculum.
  const shared = sepConcepts.find((id) => !camConcepts.includes(id));
  if (shared) {
    await updateInstitutionCurriculumContentStatus({ institutionId: X.id, curriculumId: cam.curriculumId, actorUserId: coord.id, concepts: [{ canonicalConceptId: shared, status: 'INCLUDED', classification: 'RECOMMENDED' }] });
    await studies(studentId, shared);
    await assignClassCurriculum({ institutionId: X.id, classId: klass.id, curriculumId: cam.curriculumId, actorUserId: coord.id, confirmImpact: true });
    const inCam = (await curriculumForClass(klass.id))?.classifications.has(shared);
    const inSep = (await curriculumForClass(klass2.id))?.classifications.has(shared);
    const states = await n(
      `SELECT count(*) n FROM concept_knowledge_state ks JOIN concept_catalog_mapping m ON m.learner_concept_id = ks.concept_id AND m.status = 'MATCHED' WHERE ks.student_id = $1 AND m.canonical_concept_id = $2`,
      [studentId, shared]
    );
    check('T8.one-learner-state-both-curricula', !!inCam && !!inSep && states === 1, `states=${states}`);
  } else check('T8.one-learner-state-both-curricula', false, 'no SEP concept to share');
  const otherDomain = phy ? (await one(`SELECT canonical_concept_id AS id FROM institution_curriculum_concepts WHERE curriculum_id = $1 LIMIT 1`, [phy.curriculumId]))?.id : null;
  check('T8.other-domain-concept-refused', !otherDomain || (await rejects(() => updateInstitutionCurriculumContentStatus({ institutionId: X.id, curriculumId: sep.id, actorUserId: coord.id, concepts: [{ canonicalConceptId: otherDomain, status: 'INCLUDED' }] }), 'CONTENT_NOT_IN_CURRICULUM')));

  // ---------------------------------------------------------------- structure isolation
  const camObjectives = await n(`SELECT count(*) n FROM institution_curriculum_objectives WHERE curriculum_id = $1`, [cam.curriculumId]);
  const sepObjectives = await n(`SELECT count(*) n FROM institution_curriculum_objectives WHERE curriculum_id = $1`, [sep.id]);
  const publishedObjectives = await n(`SELECT count(*) n FROM learning_objectives lo JOIN structure_nodes sn ON sn.id = lo.structure_node_id WHERE sn.structure_version_id = $1`, [opt9709.versionId]);
  const sepRow = await one(`SELECT base_structure_version_id, base_academic_subject_id, canonical_subject_id FROM institution_curricula WHERE id = $1`, [sep.id]);
  check('T9.no-structure-contamination', sepObjectives === 0 && camObjectives === publishedObjectives && sepRow.base_structure_version_id === null && sepRow.base_academic_subject_id === null && sepRow.canonical_subject_id === math, `cam=${camObjectives}/${publishedObjectives} sep=${sepObjectives}`);

  // ---------------------------------------------------------------- cross-tenant
  const yClass = await createClass(Y.id, null, 'Math Y', math);
  check('T10.foreign-curriculum-denied', await rejects(() => assignClassCurriculum({ institutionId: X.id, classId: klass.id, curriculumId: ySep.id, actorUserId: coord.id, confirmImpact: true }), 'NOT_FOUND'));
  check('T10.foreign-class-denied', await rejects(() => assignClassCurriculum({ institutionId: X.id, classId: yClass.id, curriculumId: sep.id, actorUserId: coord.id }), 'CLASS_NOT_IN_INSTITUTION'));

  // ---------------------------------------------------------------- ALBO untouched
  const alboAfter = JSON.stringify((await one(`SELECT row_to_json(c) AS j FROM classes c WHERE id = $1`, [ALBO_CLASS]))?.j ?? null);
  const strip = (j: string) => JSON.stringify({ ...JSON.parse(j), academic_domain_code: undefined });
  check('ALBO.untouched', alboBefore === alboAfter && JSON.parse(alboAfter)?.institution_curriculum_id === null, strip(alboAfter).slice(0, 120));
  void learned;
}

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
async function deleteCascade(table: string, col: string, ids: string[], depth = 0): Promise<void> {
  if (ids.length === 0 || depth > 8) return;
  for (const ch of await refsTo(table)) {
    let rowIds: string[] = [];
    try {
      rowIds = (await db.query(`SELECT id::text AS id FROM ${table} WHERE ${col}::text = ANY($1::text[])`, [ids])).rows.map((r: any) => r.id);
    } catch {
      rowIds = [];
    }
    await deleteCascade(ch.t, ch.c, rowIds, depth + 1);
  }
  await db.query(`DELETE FROM ${table} WHERE ${col}::text = ANY($1::text[])`, [ids]);
}

async function cleanup() {
  guard();
  const ids = async (sql: string, p: unknown[]) => (await db.query(sql, p)).rows.map((r: any) => r.id as string);
  const inst = await ids(`SELECT id FROM institutions WHERE name LIKE $1`, [`TA Dominio ${RUN} %`]);
  const userIds = await ids(`SELECT id FROM users WHERE clerk_id LIKE $1`, [`tadc-${RUN}-%`]);
  const studentIds = await ids(`SELECT id FROM students WHERE clerk_id LIKE $1`, [`tadc-${RUN}-%`]);
  for (let pass = 0; pass < 4; pass++) {
    try {
      await db.query(`DELETE FROM academic_governance_events WHERE institution_id = ANY($1::uuid[])`, [inst]);
      await deleteCascade('concept_knowledge_state', 'student_id', studentIds);
      await deleteCascade('subjects', 'student_id', studentIds);
      await deleteCascade('institutions', 'id', inst);
      await deleteCascade('students', 'id', studentIds);
      await db.query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [userIds]);
      await deleteCascade('profiles', 'user_id', userIds);
      await deleteCascade('users', 'id', userIds);
      break;
    } catch (e) {
      if (pass === 3) throw e;
    }
  }
  const left = (await n(`SELECT count(*) n FROM institutions WHERE name LIKE $1`, [`TA Dominio ${RUN} %`])) + (await n(`SELECT count(*) n FROM users WHERE clerk_id LIKE $1`, [`tadc-${RUN}-%`]));
  check('CLEANUP.no-fixtures-left', left === 0, `remaining=${left}`);
}

main()
  .catch((e) => check('RUN.error', false, e instanceof Error ? `${e.name}: ${e.message}` : String(e)))
  .then(() => cleanup().catch((e) => check('CLEANUP.error', false, e instanceof Error ? e.message : String(e))))
  .finally(async () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    await db.end();
    process.exitCode = failed.length ? 1 : 0;
  });

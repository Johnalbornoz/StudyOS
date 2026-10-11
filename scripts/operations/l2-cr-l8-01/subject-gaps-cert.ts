/**
 * CR-L8-01 (assessment side) -- runs the REAL `examGapsFor` query against an EPHEMERAL local Postgres holding the
 * seeded catalogue, with two fixture Students who each have one scored PAA attempt (a multi-subject exam).
 * Refuses any database that is not on 127.0.0.1. Invoked by scripts/operations/l2-cr-l8-01-subject-gaps-cert.sh.
 */
import { db } from '@/lib/db';
import { examGapsFor } from '@/lib/exam-core/exam-gaps.service';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -- ${detail}`}`); if (!ok) failed += 1; };
const one = async <T = Record<string, string>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as T;

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (host !== '127.0.0.1') throw new Error(`Refusing: ${host} is not an ephemeral local database`);

  const version = await one<{ id: string; definition_id: string }>(`SELECT v.id, d.id AS definition_id FROM exam_versions v JOIN exam_definitions d ON d.id = v.exam_definition_id WHERE d.exam_family = 'PAA' AND v.status = 'PUBLISHED' LIMIT 1`);
  const subject = async (name: string) => (await one<{ id: string }>(`SELECT id FROM canonical_subjects WHERE name = $1`, [name])).id;
  const [MATEMATICAS, MATHEMATICS, LECTURA, REDACCION] = await Promise.all(['Matemáticas', 'Mathematics', 'Lectura crítica', 'Redacción'].map(subject));
  const objective = async (code: string) => (await one<{ id: string }>(`SELECT lo.id FROM learning_objectives lo JOIN structure_nodes sn ON sn.id = lo.structure_node_id JOIN structure_versions sv ON sv.id = sn.structure_version_id WHERE lo.code = $1 AND sv.status = 'PUBLISHED' LIMIT 1`, [code])).id;
  const algebra = await objective('paa.mat.algebra'); // mapped to concepts of Matemáticas AND Mathematics
  const datos = await objective('paa.mat.datos');
  const inferencia = await objective('paa.lect.inferencia');
  const elision = await objective('paa.red.elision');
  // an objective of the same published structure with NO published concept mapping
  const unmapped = (await one<{ id: string }>(`INSERT INTO learning_objectives (structure_node_id, code, description) SELECT structure_node_id, 'cert.unmapped', 'Objective without a concept mapping' FROM learning_objectives WHERE id = $1 RETURNING id`, [algebra])).id;

  const student = async (tag: string, gaps: string[], mastered: string[]) => {
    const s = await one<{ id: string }>(`INSERT INTO students (clerk_id, email) VALUES ($1, $2) RETURNING id`, [`cert:${tag}`, `${tag}@cert.invalid`]);
    const profile = await one<{ id: string }>(`INSERT INTO student_exam_profiles (student_id, exam_definition_id) VALUES ($1, $2) RETURNING id`, [s.id, version.definition_id]);
    const attempt = await one<{ id: string }>(`INSERT INTO exam_attempts (student_exam_profile_id, exam_version_id, frozen_configuration, status) VALUES ($1, $2, '{}'::jsonb, 'COMPLETED') RETURNING id`, [profile.id, version.id]);
    const plan = await one<{ id: string }>(`INSERT INTO simulation_plans (student_id, exam_version_id, simulation_type, plan) VALUES ($1, $2, 'MINI_MOCK', '{}'::jsonb) RETURNING id`, [s.id, version.id]);
    await db.query(`INSERT INTO simulation_attempts (exam_attempt_id, student_id, exam_profile_id, exam_version_id, simulation_type, simulation_plan_id, timing_mode, pause_allowed, language, status) VALUES ($1, $2, $3, $4, 'MINI_MOCK', $5, 'UNTIMED', true, 'es', 'COMPLETED')`, [attempt.id, s.id, profile.id, version.id, plan.id]);
    const results = [...gaps.map((id, i) => ({ learningObjectiveId: id, classification: i % 2 ? 'DEVELOPING' : 'GAP' })), ...mastered.map((id) => ({ learningObjectiveId: id, classification: 'SECURE' }))];
    await db.query(`INSERT INTO exam_attempt_results (exam_attempt_id, student_id, exam_version_id, scoring_engine_version, scoring_status, raw_score, max_score, section_results, objective_results, provenance, response_set_hash, status) VALUES ($1, $2, $3, 'cert', 'SCORED', 1, 10, '[]'::jsonb, $4::jsonb, '{}'::jsonb, $5, 'SCORED')`, [attempt.id, s.id, version.id, JSON.stringify(results), `cert-${tag}`]);
    return s.id;
  };
  const ana = await student('ana', [algebra, datos, inferencia, unmapped], [elision]);
  const bea = await student('bea', [inferencia, elision], [algebra]);
  const ids = [ana, bea];
  const codes = (g: Awaited<ReturnType<typeof examGapsFor>>) => g.byObjective.map((o) => o.code).sort().join(',');

  const all = await examGapsFor(ids, { includePerStudent: true });
  check('unscoped (existing behaviour): every gap objective of both Students, including the unmapped one', codes(all) === 'cert.unmapped,paa.lect.inferencia,paa.mat.algebra,paa.mat.datos,paa.red.elision', codes(all));
  check('unscoped: 2 Students with results; Ana has 4 gap objectives', all.studentsWithResults === 2 && all.perStudent.find((p) => p.studentId === ana)?.gaps === 4);

  const math = await examGapsFor(ids, { includePerStudent: true, canonicalSubjectIds: [MATEMATICAS] });
  check('matching subject => returned: Matemáticas gives algebra and datos', codes(math) === 'paa.mat.algebra,paa.mat.datos', codes(math));
  check('different subject => excluded: no reading or writing objective, and Bea (no maths gap) is absent', !/lect|red\./.test(codes(math)) && math.studentsWithResults === 1 && !JSON.stringify(math).includes(bea));
  const subjectsOf = async (conceptIds: string[]) => (await db.query(`SELECT DISTINCT canonical_subject_id FROM canonical_concepts WHERE id = ANY($1::uuid[])`, [conceptIds])).rows.map((r) => r.canonical_subject_id as string);
  check('every concept returned for Matemáticas belongs to Matemáticas', (await subjectsOf(math.byConcept.map((c) => c.canonicalConceptId))).join() === MATEMATICAS);
  check('per Student for Matemáticas: Ana has 2 gap objectives', math.perStudent.length === 1 && math.perStudent[0].studentId === ana && math.perStudent[0].gaps === 2);
  check('domain aggregate is the in-subject slice only', math.byDomain.length >= 1 && math.byDomain.every((d) => d.students === 1));

  const mathematics = await examGapsFor(ids, { includePerStudent: true, canonicalSubjectIds: [MATHEMATICS] });
  check('multi-subject objective => only the authorized slice: Mathematics gives algebra alone, with Mathematics concepts only', codes(mathematics) === 'paa.mat.algebra' && (await subjectsOf(mathematics.byConcept.map((c) => c.canonicalConceptId))).join() === MATHEMATICS, codes(mathematics));
  check('the two slices of one objective do not share a concept', math.byConcept.every((c) => !mathematics.byConcept.some((d) => d.canonicalConceptId === c.canonicalConceptId)));

  const reading = await examGapsFor(ids, { includePerStudent: true, canonicalSubjectIds: [LECTURA] });
  check('multi-subject assessment => only the authorized subject slice: Lectura gives inferencia for both Students', codes(reading) === 'paa.lect.inferencia' && reading.byObjective[0].students === 2, codes(reading));
  const writing = await examGapsFor(ids, { includePerStudent: true, canonicalSubjectIds: [REDACCION] });
  check('a mastered objective is not a gap: Redacción gives elision for Bea only', codes(writing) === 'paa.red.elision' && writing.perStudent.length === 1 && writing.perStudent[0].studentId === bea, codes(writing));

  for (const [name, g] of [['Matemáticas', math], ['Mathematics', mathematics], ['Lectura', reading], ['Redacción', writing]] as const) check(`no safe subject mapping => omitted from ${name}`, !codes(g).includes('cert.unmapped'));
  const none = await examGapsFor(ids, { includePerStudent: true, canonicalSubjectIds: [] });
  const invalid = await examGapsFor(ids, { includePerStudent: true, canonicalSubjectIds: ['not-a-uuid'] });
  const unknown = await examGapsFor(ids, { includePerStudent: true, canonicalSubjectIds: ['00000000-0000-4000-8000-000000000000'] });
  check('fail closed: an empty, malformed or unknown subject scope returns nothing', [none, invalid, unknown].every((g) => g.studentsWithResults === 0 && g.byDomain.length + g.byObjective.length + g.byConcept.length + g.perStudent.length === 0));
  const union = await examGapsFor(ids, { includePerStudent: false, canonicalSubjectIds: [MATEMATICAS, LECTURA] });
  check('two subjects => union of the two slices; no per-Student data when not asked', codes(union) === 'paa.lect.inferencia,paa.mat.algebra,paa.mat.datos' && union.perStudent.length === 0 && union.byConcept.every((c) => c.studentIds.length === 0), codes(union));
  const onlyAna = await examGapsFor([ana], { includePerStudent: true, canonicalSubjectIds: [LECTURA] });
  check('the Student set is never widened', onlyAna.studentsWithResults === 1 && !JSON.stringify(onlyAna).includes(bea));

  console.log(failed === 0 ? 'L2_CR_L8_01_SUBJECT_GAPS_CERT = PASS' : `L2_CR_L8_01_SUBJECT_GAPS_CERT = FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

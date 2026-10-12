/**
 * Curriculum convergence -- runtime scenarios with the REAL services against a real database.
 *
 *   per curriculum family (PAA, and IB or Cambridge):
 *     1  Subject A (selected, no mappings) vs Subject B (same programme, most mappings): B is never selected
 *     2  Learn shows the curriculum as not ready; no lineage is derived from another subject
 *     3  with B selected explicitly, the curriculum resolves to B
 *     4  Catalog -> Add to Learn records canonical concept + academic subject + structure version + node + objective
 *     5  the lineage is verified (a false one is refused) and immutable
 *     6  the concept is grouped under its curriculum, not in the unassigned bucket ("Sin clasificar")
 *     7  a concept typed by the Student stays unassigned (nothing is inferred)
 *
 * Write mode: ephemeral (127.0.0.1) or DEV only. Fixtures (`ccc-<run>`) are removed at the end and the row
 * counts are compared with the start.
 * --read-only: no write at all (allowed on Preview): the negative resolution test against the live catalogue,
 * and the resolution of every Student that exists.
 *
 * No AI provider is called: the provider keys are removed from the process before any service is loaded.
 *   CURRICULUM_CONVERGENCE_FP=<fp> npx tsx --env-file=<env> scripts/operations/curriculum-convergence-scenarios.ts [--read-only]
 */
import { createHash, randomBytes } from 'crypto';

for (const k of Object.keys(process.env)) if (/(ANTHROPIC|OPENAI|GEMINI|GOOGLE_GENERATIVE|AI_GATEWAY)/i.test(k)) delete process.env[k];

const DEV = '2a29b99ee14a22b4';
const PREVIEW = '53d158d5811e7ee0';
const RUN = randomBytes(3).toString('hex');
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};

async function main() {
  const readOnly = process.argv.includes('--read-only');
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  const ephemeral = u.hostname === '127.0.0.1';
  const named = (fp === DEV || fp === PREVIEW) && process.env.CURRICULUM_CONVERGENCE_FP === fp;
  if (!ephemeral && !named) throw new Error(`REFUSING: database ${fp}`);
  if (fp === PREVIEW && !readOnly) throw new Error('REFUSING: Preview is read-only for this script (--read-only)');

  const { db } = await import('@/lib/db');
  const { catalogKeyOf, listCurriculumOptions, resolveCurriculumContext, studentExplicitAcademicSubjects } = await import('@/lib/learning-plan/curriculum.service');
  const { CURRICULUM_MAPPING_NOT_READY } = await import('@/lib/learning-plan/curriculum-context-resolution');
  const { loadSubjectCurriculumTopics } = await import('@/lib/learning-plan/subject-curriculum-topics');
  const { curriculumProvenanceForLearnerConcepts, deriveCurriculumProvenance, verifyCurriculumProvenance } = await import('@/lib/learning-plan/curriculum-provenance.service');
  const { groupUnassignedByCurriculum } = await import('@/lib/learning-plan/curriculum-grouping');
  const { enrollCanonicalConcept } = await import('@/lib/learning-plan/personal-plan.service');
  const { runCurriculumIntegrityGates } = await import('@/lib/curriculum/convergence/integrity.service');
  const { catalogSubject } = await import('@/lib/experience/subject-catalog');

  const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
  const rejects = async (fn: () => Promise<unknown>, code: string) => fn().then(() => false, (e: any) => String(e?.message ?? e).includes(code));
  console.log(`curriculum convergence scenarios -- db ${fp} -- ${readOnly ? 'READ-ONLY' : `run ${RUN}`}`);

  /** The richest published academic subject of a family whose canonical subject is a Learn subject (has a catalogue key). */
  const richest = async (family: string) => ((await db.query(
    `SELECT a.id, a.name, a.level, a.programme_id, p.name AS programme, sv.id AS version_id, cs.id AS canonical_subject_id, cs.name AS canonical_subject, count(DISTINCT cc.id)::int AS concepts
       FROM academic_subjects a JOIN academic_programmes p ON p.id = a.programme_id
       JOIN structure_versions sv ON sv.academic_subject_id = a.id AND sv.status = 'PUBLISHED'
       JOIN structure_nodes sn ON sn.structure_version_id = sv.id JOIN learning_objectives lo ON lo.structure_node_id = sn.id AND lo.status = 'ACTIVE'
       JOIN objective_concept_mappings m ON m.learning_objective_id = lo.id AND m.status = 'PUBLISHED' AND m.relation_type IN ('FULL', 'PARTIAL')
       JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id AND cc.status = 'ACTIVE' JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id AND cs.status = 'ACTIVE'
      WHERE ${family === 'PAA' ? `sv.source_locator = 'exam-vertical-config:v2.paa'` : `(p.name LIKE 'IB %' OR p.name LIKE 'Cambridge%')`}
      GROUP BY a.id, p.name, sv.id, cs.id ORDER BY count(DISTINCT cc.id) DESC, a.id`
  )).rows as any[]).find((r) => catalogKeyOf(r.canonical_subject));

  if (readOnly) {
    // Negative test on the live catalogue: an academic subject with a canonical subject and NO mapping chain (A),
    // while another academic subject of the same Learn subject has mappings (B). Requested A must be NOT_READY.
    const candidates = (await db.query(
      `SELECT a.id, a.name, p.name AS programme, cs.name AS canonical_subject
         FROM academic_subjects a JOIN academic_programmes p ON p.id = a.programme_id JOIN canonical_subjects cs ON cs.id = a.canonical_subject_id
        WHERE a.status = 'ACTIVE' AND NOT EXISTS (
          SELECT 1 FROM structure_versions sv JOIN structure_nodes sn ON sn.structure_version_id = sv.id JOIN learning_objectives lo ON lo.structure_node_id = sn.id
            JOIN objective_concept_mappings m ON m.learning_objective_id = lo.id AND m.status = 'PUBLISHED' WHERE sv.academic_subject_id = a.id AND sv.status = 'PUBLISHED')
        ORDER BY p.name, a.name, a.id`
    )).rows as any[];
    const nobody = '00000000-0000-4000-8000-000000000000';
    let tested = 0;
    for (const a of candidates) {
      const key = catalogKeyOf(a.canonical_subject);
      if (!key) continue;
      const options = await listCurriculumOptions(key);
      if (options.length === 0) continue;
      const largest = [...options].sort((x, y) => y.conceptCount - x.conceptCount)[0];
      const r = await resolveCurriculumContext(nobody, key, a.id);
      check(`RO-NEG ${a.programme} · ${a.name}`, r.context === null && r.reason === CURRICULUM_MAPPING_NOT_READY && r.notReady[0]?.academicSubjectId === a.id, `A has no mappings; B = ${largest.programme} · ${largest.name} (${largest.conceptCount} concepts, ${options.length} options) NOT substituted -> ${r.reason}`);
      const general = await resolveCurriculumContext(nobody, key);
      check(`RO-GENERAL ${key}`, general.context === null && general.reason === 'GENERAL', `no explicit subject -> ${general.reason}, context ${general.context ? 'SET' : 'null'}`);
      tested += 1;
    }
    check('RO-NEG ran', tested > 0, `${tested} subject(s) without mappings tested against richer siblings`);
    // Every Student that exists: what each of their Learn subjects resolves to (read-only).
    const students = (await db.query(`SELECT st.id, s.id AS subject_id, s.name FROM students st JOIN subjects s ON s.student_id = st.id AND s.status = 'active' ORDER BY st.created_at, s.created_at`)).rows as any[];
    for (const s of students) {
      const key = catalogKeyOf(s.name);
      if (!key) continue;
      const r = await resolveCurriculumContext(s.id, key);
      const explicitIds = (await studentExplicitAcademicSubjects(s.id)).map((x) => x.academicSubjectId);
      const explicit = !r.context || explicitIds.includes(r.context.academicSubjectId);
      check(`RO-STUDENT ${s.id.slice(0, 8)} · ${key} resolves only to a subject the Student explicitly has`, explicit, `${r.reason}${r.context ? ` -> ${r.context.programme} · ${r.context.name}` : ''}${r.notReady.length ? ` · not ready: ${r.notReady.map((x) => `${x.source}/${x.missing}`).join(', ')}` : ''}`);
    }
  } else {
    const counts = async () => one(
      `SELECT (SELECT count(*) FROM students)::int AS students, (SELECT count(*) FROM profiles)::int AS profiles, (SELECT count(*) FROM student_profiles)::int AS student_profiles, (SELECT count(*) FROM subjects)::int AS subjects, (SELECT count(*) FROM concepts)::int AS concepts,
              (SELECT count(*) FROM academic_subjects)::int AS academic_subjects, (SELECT count(*) FROM structure_versions)::int AS versions, (SELECT count(*) FROM structure_nodes)::int AS nodes,
              (SELECT count(*) FROM learner_concept_curriculum_provenance)::int AS provenance, (SELECT count(*) FROM student_plan_entries)::int AS plan_entries,
              (SELECT count(*) FROM concept_catalog_mapping)::int AS learner_mappings, (SELECT count(*) FROM student_academic_subjects)::int AS student_subjects, (SELECT count(*) FROM mastery_records)::int AS mastery`
    );
    const start = await counts();
    const students: string[] = [];
    const subjectsA: string[] = [];
    try {
      for (const family of ['PAA', 'IB_OR_CAMBRIDGE']) {
        const B = await richest(family);
        if (!B) {
          check(`${family} 0 a published curriculum with mappings exists`, false, 'none in this database');
          continue;
        }
        const key = catalogKeyOf(B.canonical_subject);
        if (!key) {
          check(`${family} 0 the canonical subject has a Learn subject`, false, B.canonical_subject);
          continue;
        }
        const tag = `${family} (${B.programme} · ${B.name}${B.level ? ` · ${B.level}` : ''})`;
        // Subject A: same programme, same canonical subject, PUBLISHED structure, NO objective and NO mapping.
        const A = (await one(`INSERT INTO academic_subjects (programme_id, name, canonical_subject_id) VALUES ($1, $2, $3) RETURNING id`, [B.programme_id, `ccc-${RUN} ${family} Subject A`, B.canonical_subject_id])).id as string;
        subjectsA.push(A);
        const svA = (await one(`INSERT INTO structure_versions (academic_subject_id, version_label, status, source_locator) VALUES ($1, 'ccc cert', 'PUBLISHED', 'curriculum-convergence-cert') RETURNING id`, [A])).id as string;
        const nodeA = (await one(`INSERT INTO structure_nodes (structure_version_id, node_type, source_label, code) VALUES ($1, 'EXAM_SECTION', 'ccc cert paper', 'ccc.paper') RETURNING id`, [svA])).id as string;
        const S = (await one(`INSERT INTO students (clerk_id, email, name, language) VALUES ($1, $2, 'ccc cert', 'es') RETURNING id`, [`ccc-${RUN}-${family}`, `ccc-${RUN}-${family}@convergence.test`])).id as string;
        students.push(S);
        // the legacy identity rows every Student has (subjects / mastery records reference profiles)
        await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', 'ccc cert')`, [S]);
        await db.query(`INSERT INTO student_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [S]);
        const learnName = (catalogSubject(key)?.names as Record<string, string> | undefined)?.es ?? B.canonical_subject;
        const learnSubject = (await one(`INSERT INTO subjects (student_id, name, status) VALUES ($1, $2, 'active') RETURNING id`, [S, learnName])).id as string;
        await db.query(`INSERT INTO student_academic_subjects (student_id, academic_subject_id) VALUES ($1, $2)`, [S, A]);

        const options = await listCurriculumOptions(key);
        const siblings = options.filter((o) => o.programmeId === B.programme_id);
        check(`${tag} 1a B is offered and A is not`, options.some((o) => o.academicSubjectId === B.id) && !options.some((o) => o.academicSubjectId === A), `${options.length} options, ${siblings.length} in the programme, B ${B.concepts} concepts`);
        const r1 = await resolveCurriculumContext(S, key);
        check(`${tag} 1b A selected, no mappings -> ${CURRICULUM_MAPPING_NOT_READY}; B never selected`, r1.context === null && r1.reason === CURRICULUM_MAPPING_NOT_READY && r1.notReady.length === 1 && r1.notReady[0].academicSubjectId === A && r1.notReady[0].missing === 'CONCEPT_MAPPINGS', `${r1.reason} · context ${r1.context ? r1.context.academicSubjectId : 'null'} · missing ${r1.notReady[0]?.missing}`);
        const t1 = await loadSubjectCurriculumTopics(S, { id: learnSubject, name: learnName }, 'es');
        check(`${tag} 2a Learn shows the curriculum as not ready`, t1?.status === CURRICULUM_MAPPING_NOT_READY, String(t1?.status ?? 'null'));
        const anyConceptOfB = (await one(
          `SELECT m.canonical_concept_id FROM objective_concept_mappings m JOIN learning_objectives lo ON lo.id = m.learning_objective_id AND lo.status = 'ACTIVE' JOIN structure_nodes sn ON sn.id = lo.structure_node_id
            JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id AND cc.status = 'ACTIVE' AND cc.canonical_subject_id = $2
            WHERE sn.structure_version_id = $1 AND m.status = 'PUBLISHED' AND m.relation_type IN ('FULL', 'PARTIAL') ORDER BY lo.code, m.canonical_concept_id LIMIT 1`, [B.version_id, B.canonical_subject_id])).canonical_concept_id as string;
        check(`${tag} 2b no lineage is derived from another subject`, (await deriveCurriculumProvenance(S, anyConceptOfB)) === null);

        // The Student now selects B explicitly.
        await db.query(`UPDATE student_academic_subjects SET ended_at = now() WHERE student_id = $1 AND academic_subject_id = $2`, [S, A]);
        await db.query(`INSERT INTO student_academic_subjects (student_id, academic_subject_id) VALUES ($1, $2)`, [S, B.id]);
        const r3 = await resolveCurriculumContext(S, key);
        check(`${tag} 3 B selected explicitly -> B`, r3.context?.academicSubjectId === B.id && r3.reason === 'ACADEMIC_PROFILE' && r3.context?.structureVersionId === B.version_id, r3.reason);
        const t3 = await loadSubjectCurriculumTopics(S, { id: learnSubject, name: learnName }, 'es');
        const topics = t3?.status === 'READY' ? t3.topics : [];
        const row = topics.flatMap((t) => t.concepts.map((c) => ({ topic: t, c }))).find((x) => !x.c.added);
        check(`${tag} 4a the catalogue lists topics whose rows carry node + objective`, !!row && !!row.c.structureNodeId && !!row.c.learningObjectiveId, `${topics.length} topics`);
        if (!row) continue;
        const lineage = { academicSubjectId: B.id as string, structureVersionId: B.version_id as string, structureNodeId: row.c.structureNodeId, learningObjectiveId: row.c.learningObjectiveId };
        check(`${tag} 5a the stated lineage is verified`, await verifyCurriculumProvenance(row.c.canonicalConceptId, lineage));
        check(`${tag} 5b a lineage through another subject is refused`, !(await verifyCurriculumProvenance(row.c.canonicalConceptId, { ...lineage, academicSubjectId: A })) && !(await verifyCurriculumProvenance(row.c.canonicalConceptId, { ...lineage, structureVersionId: svA, structureNodeId: nodeA })));
        const enrolled = await enrollCanonicalConcept(S, row.c.canonicalConceptId, { type: 'CURRICULUM_RECOMMENDATION', actorUserId: null }, lineage);
        const stored = await one(`SELECT * FROM learner_concept_curriculum_provenance WHERE learner_concept_id = $1`, [enrolled.learnerConceptId]);
        const canonical = await one(`SELECT canonical_concept_id, status FROM concept_catalog_mapping WHERE learner_concept_id = $1`, [enrolled.learnerConceptId]);
        check(`${tag} 4b Add to Learn records the whole lineage`, enrolled.provenanceRecorded && stored?.academic_subject_id === B.id && stored?.structure_version_id === B.version_id && stored?.structure_node_id === lineage.structureNodeId && stored?.learning_objective_id === lineage.learningObjectiveId && stored?.canonical_concept_id === row.c.canonicalConceptId);
        check(`${tag} 4c canonical identity is preserved`, canonical?.status === 'MATCHED' && canonical?.canonical_concept_id === row.c.canonicalConceptId);
        check(`${tag} 5c the lineage is immutable`, await rejects(() => db.query(`UPDATE learner_concept_curriculum_provenance SET structure_node_id = $2 WHERE learner_concept_id = $1`, [enrolled.learnerConceptId, nodeA]), 'LEARNER_CONCEPT_CURRICULUM_PROVENANCE_IMMUTABLE'));
        const again = await enrollCanonicalConcept(S, row.c.canonicalConceptId, { type: 'CURRICULUM_RECOMMENDATION', actorUserId: null }, lineage);
        check(`${tag} 5d adding again changes nothing`, !again.conceptCreated && !again.provenanceRecorded && again.learnerConceptId === enrolled.learnerConceptId);

        // A second concept with no stated lineage: taken from the Student's own explicit curriculum (as the API does).
        const second = topics.flatMap((t) => t.concepts).find((c) => c.canonicalConceptId !== row.c.canonicalConceptId && !c.added);
        if (second) {
          const derived = await deriveCurriculumProvenance(S, second.canonicalConceptId);
          const e2 = await enrollCanonicalConcept(S, second.canonicalConceptId, { type: 'SELF_SELECTED', actorUserId: null });
          check(`${tag} 4d with none stated, the lineage is the Student's own explicit curriculum`, derived?.academicSubjectId === B.id && derived?.structureVersionId === B.version_id && e2.provenanceRecorded);
          // The database refuses a lineage that names the wrong canonical concept / a node of another version.
          check(`${tag} 5e the database refuses a false lineage`, await rejects(() => db.query(
            `INSERT INTO learner_concept_curriculum_provenance (learner_concept_id, canonical_concept_id, academic_subject_id, structure_version_id, structure_node_id, learning_objective_id)
             SELECT c.id, $2, $3, $4, $5, $6 FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = $1 AND c.id NOT IN (SELECT learner_concept_id FROM learner_concept_curriculum_provenance) LIMIT 1`,
            [S, row.c.canonicalConceptId, A, svA, nodeA, lineage.learningObjectiveId]), 'LEARNER_CONCEPT_CURRICULUM_PROVENANCE_') || (await one(`SELECT count(*)::int AS n FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = $1 AND c.id NOT IN (SELECT learner_concept_id FROM learner_concept_curriculum_provenance)`, [S])).n === 0);
        }
        // A concept the Student typed: no canonical concept, no lineage.
        const holder = (await one(`SELECT c.subject_id FROM concepts c WHERE c.id = $1`, [enrolled.learnerConceptId])).subject_id as string;
        const typed = (await one(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [holder, `CCC_TYPED_${RUN.toUpperCase()}`])).id as string;
        await db.query(`INSERT INTO concept_localizations (concept_id, language, label) VALUES ($1, 'es', 'ccc concepto escrito por el estudiante')`, [typed]);
        const unassigned = (await db.query(`SELECT c.id FROM concepts c WHERE c.subject_id = $1 AND c.subtopic_id IS NULL ORDER BY c.created_at`, [holder])).rows.map((x: any) => ({ id: x.id as string }));
        const grouped = groupUnassignedByCurriculum(unassigned, await curriculumProvenanceForLearnerConcepts(unassigned.map((x) => x.id), 'es'), 'es');
        const placed = grouped.curriculumTopics.flatMap((t) => t.subtopics.flatMap((s) => s.concepts.map((c) => c.id)));
        check(`${tag} 6 the added concept is under its curriculum, not unassigned`, placed.includes(enrolled.learnerConceptId) && !grouped.unassigned.some((x) => x.id === enrolled.learnerConceptId) && grouped.curriculumTopics[0]?.id === `curriculum:${B.version_id}`, `${grouped.curriculumTopics.map((t) => `${t.name} > ${t.subtopics.map((s) => s.name).join(' | ')}`).join(' ; ')}`.slice(0, 200));
        check(`${tag} 7 a concept typed by the Student stays unassigned`, grouped.unassigned.length === 1 && grouped.unassigned[0].id === typed);
      }
      const gates = await runCurriculumIntegrityGates(db);
      const provenanceBroken = gates.findings.filter((f) => f.gate === 'LEARN_PROVENANCE' && f.kind === 'BROKEN').reduce((a, f) => a + f.count, 0);
      check('GATES Learn provenance has no broken lineage', provenanceBroken === 0, `${gates.findings.find((f) => f.gate === 'LEARN_PROVENANCE' && f.kind === 'INFO')?.count ?? 0} recorded`);
    } finally {
      // Remove exactly what this run created.
      for (const S of students) {
        const concepts = (await db.query(`SELECT c.id FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = $1`, [S])).rows.map((x: any) => x.id as string);
        await db.query(`DELETE FROM student_plan_events WHERE student_id = $1`, [S]);
        await db.query(`DELETE FROM student_concept_sources WHERE student_id = $1`, [S]);
        await db.query(`DELETE FROM student_plan_entries WHERE student_id = $1`, [S]);
        await db.query(`DELETE FROM learner_concept_curriculum_provenance WHERE learner_concept_id = ANY($1::uuid[])`, [concepts]);
        await db.query(`DELETE FROM concept_catalog_mapping WHERE learner_concept_id = ANY($1::uuid[])`, [concepts]);
        await db.query(`DELETE FROM mastery_records WHERE student_id = $1`, [S]);
        await db.query(`DELETE FROM concept_localizations WHERE concept_id = ANY($1::uuid[])`, [concepts]);
        await db.query(`DELETE FROM concepts WHERE id = ANY($1::uuid[])`, [concepts]);
        await db.query(`DELETE FROM subjects WHERE student_id = $1`, [S]);
        await db.query(`DELETE FROM student_academic_subjects WHERE student_id = $1`, [S]);
        await db.query(`DELETE FROM student_profiles WHERE id = $1`, [S]);
        await db.query(`DELETE FROM profiles WHERE id = $1`, [S]);
        await db.query(`DELETE FROM students WHERE id = $1`, [S]);
      }
      for (const A of subjectsA) {
        await db.query(`DELETE FROM structure_nodes WHERE structure_version_id IN (SELECT id FROM structure_versions WHERE academic_subject_id = $1)`, [A]);
        await db.query(`DELETE FROM structure_versions WHERE academic_subject_id = $1`, [A]);
        await db.query(`DELETE FROM academic_subjects WHERE id = $1`, [A]);
      }
      const end = await counts();
      check('CLEANUP every fixture removed (row counts as at the start)', JSON.stringify(start) === JSON.stringify(end), JSON.stringify(end));
    }
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

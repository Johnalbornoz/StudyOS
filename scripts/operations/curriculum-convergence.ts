/**
 * Curriculum convergence -- governed, idempotent catalogue remediation + integrity gates (operator step).
 *
 *   1. PAA: the certified Section / Domain / Topic hierarchy (applyPaaCurriculumHierarchy; no objective is moved)
 *   2. Cambridge AS & A Level: the syllabus Topic layer where the governed source is at topic granularity
 *   3. academic subjects: the canonical subject where it is a stated fact (mapping evidence / identical name)
 *   4. integrity gates (read-only) + the classification of everything that stays unmapped
 *
 * Dry run by default: one transaction, rolled back. --write commits, and only when the gates report nothing
 * BROKEN that this run could have introduced. Content only: no Student row is read for writing, nothing is
 * deleted, no objective, mapping, item or learner record is modified.
 *
 * Order of environments: ephemeral (127.0.0.1) -> DEV -> Preview. Never Production.
 *   CURRICULUM_CONVERGENCE_FP=<fp> npx tsx --env-file=<env> scripts/operations/curriculum-convergence.ts [--write] [--audit-only] [--out <dir>]
 */
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { applyPaaCurriculumHierarchy, readPaaCurriculumHierarchy, PaaHierarchyError } from '@/lib/curriculum/paa/paa-hierarchy.service';
import { PAA_DOMAINS, PAA_SECTIONS, PAA_TOPICS } from '@/lib/curriculum/paa/paa-hierarchy';
import { applyAiceTopicHierarchy, readAiceTopicHierarchy } from '@/lib/curriculum/aice/aice-topic-hierarchy.service';
import { aiceSyllabiWithoutTopicLayer } from '@/lib/curriculum/aice/aice-topic-hierarchy';
import { applyDeterministicCanonicalSubjects, auditStructureVersions, auditUnmappedAcademicSubjects } from '@/lib/curriculum/convergence/coverage.service';
import { runCurriculumIntegrityGates } from '@/lib/curriculum/convergence/integrity.service';

const DEV = '2a29b99ee14a22b4';
const PREVIEW = '53d158d5811e7ee0';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const csv = (rows: Array<Array<string | number | null>>) => rows.map((r) => r.map((v) => (v === null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\n') + '\n';

async function main() {
  const write = process.argv.includes('--write');
  const auditOnly = process.argv.includes('--audit-only');
  const outDir = arg('--out');
  const url = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${url.hostname}|${url.pathname.slice(1)}`).digest('hex').slice(0, 16);
  const ephemeral = url.hostname === '127.0.0.1';
  if (!ephemeral && !((fp === DEV || fp === PREVIEW) && process.env.CURRICULUM_CONVERGENCE_FP === fp)) {
    throw new Error(`REFUSING: database ${fp} is not ephemeral, DEV or Preview with a matching CURRICULUM_CONVERGENCE_FP`);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const exec = client as never;
  const problems: string[] = [];
  let committed = false;
  try {
    await client.query('BEGIN');
    const nodeTypes = async (where = '') => Object.fromEntries((await client.query(`SELECT n.node_type, count(*)::int AS c FROM structure_nodes n JOIN structure_versions sv ON sv.id = n.structure_version_id ${where} GROUP BY 1 ORDER BY 1`)).rows.map((r: any) => [r.node_type, r.c]));
    const PAA_WHERE = `WHERE sv.source_locator = 'exam-vertical-config:v2.paa'`;
    const fixed = async () => (await client.query(
      `SELECT (SELECT count(*) FROM learning_objectives)::int AS objectives,
              md5(COALESCE((SELECT string_agg(id::text || structure_node_id::text || status, ',' ORDER BY id) FROM learning_objectives), '')) AS objective_placement,
              md5(COALESCE((SELECT string_agg(id::text || status || learning_objective_id::text || canonical_concept_id::text, ',' ORDER BY id) FROM objective_concept_mappings), '')) AS mappings,
              md5(COALESCE((SELECT string_agg(id::text || structure_version_id::text || COALESCE(parent_id::text, '') || node_type || source_label || status, ',' ORDER BY id) FROM structure_nodes WHERE node_type IN ('EXAM_SECTION', 'PAPER', 'COMPONENT')), '')) AS assessment_nodes,
              md5(COALESCE((SELECT string_agg(id::text || canonical_subject_id::text || name || status, ',' ORDER BY id) FROM canonical_concepts), '')) AS canonical_concepts,
              (SELECT count(*) FROM concepts)::int AS learner_concepts, (SELECT count(*) FROM subjects)::int AS learner_subjects,
              md5(COALESCE((SELECT string_agg(id::text || learner_concept_id::text || status || COALESCE(canonical_concept_id::text, ''), ',' ORDER BY id) FROM concept_catalog_mapping), '')) AS learner_mappings,
              (SELECT count(*) FROM student_academic_subjects)::int AS student_subjects, (SELECT count(*) FROM structure_nodes)::int AS nodes,
              (SELECT count(*) FROM academic_subjects WHERE canonical_subject_id IS NULL)::int AS unmapped_subjects`
    )).rows[0];

    const before = { fixed: await fixed(), nodeTypes: await nodeTypes(), paaNodeTypes: await nodeTypes(PAA_WHERE), gates: await runCurriculumIntegrityGates(exec) };
    const unmappedBefore = await auditUnmappedAcademicSubjects(exec);
    const versionsBefore = await auditStructureVersions(exec);

    let paa: unknown = 'SKIPPED';
    let aice: Awaited<ReturnType<typeof applyAiceTopicHierarchy>> | null = null;
    let mapped: Awaited<ReturnType<typeof applyDeterministicCanonicalSubjects>>['mapped'] = [];
    if (!auditOnly) {
      try {
        const ledger = await applyPaaCurriculumHierarchy(exec, { reparentObjectives: false });
        const state = await readPaaCurriculumHierarchy(exec);
        if (state.sections !== PAA_SECTIONS.length || state.domains !== PAA_DOMAINS.length || state.topics !== PAA_TOPICS.length) problems.push(`PAA hierarchy is ${state.sections}/${state.domains}/${state.topics}, certified ${PAA_SECTIONS.length}/${PAA_DOMAINS.length}/${PAA_TOPICS.length}`);
        problems.push(...state.problems.map((p) => `PAA ${p}`));
        paa = { created: ledger.created, existing: ledger.existing, state: { sections: state.sections, domains: state.domains, topics: state.topics, topicsByAuthority: state.topicsByAuthority }, objectivesMoved: ledger.objectives.filter((o) => o.placement === 'MOVED_TO_DOMAIN').length };
      } catch (e) {
        // A database without the PAA exam configuration has no PAA structure to complete: reported, never created here.
        if (e instanceof PaaHierarchyError && e.code === 'STRUCTURE_VERSIONS_NOT_FOUND') paa = { skipped: e.message };
        else throw e;
      }
      aice = await applyAiceTopicHierarchy(exec);
      problems.push(...aice.problems.map((p) => `AICE ${p}`), ...(await readAiceTopicHierarchy(exec)).problems.map((p) => `AICE ${p}`));
      mapped = (await applyDeterministicCanonicalSubjects(exec)).mapped;
    }

    const after = { fixed: await fixed(), nodeTypes: await nodeTypes(), paaNodeTypes: await nodeTypes(PAA_WHERE), gates: await runCurriculumIntegrityGates(exec) };
    const unmappedAfter = await auditUnmappedAcademicSubjects(exec);
    const versionsAfter = await auditStructureVersions(exec);

    // What this run must never change.
    for (const k of ['objectives', 'objective_placement', 'mappings', 'assessment_nodes', 'canonical_concepts', 'learner_concepts', 'learner_subjects', 'learner_mappings', 'student_subjects'] as const) {
      if (before.fixed[k] !== after.fixed[k]) problems.push(`UNEXPECTED_CHANGE ${k}`);
    }
    const createdNodes = (paa && typeof paa === 'object' && 'created' in paa ? Object.values((paa as any).created as Record<string, number>).reduce((a, b) => a + b, 0) : 0) + (aice?.created ?? 0);
    if (after.fixed.nodes - before.fixed.nodes !== createdNodes) problems.push(`structure nodes changed by ${after.fixed.nodes - before.fixed.nodes}, expected ${createdNodes}`);
    if (before.fixed.unmapped_subjects - after.fixed.unmapped_subjects !== mapped.length) problems.push(`unmapped academic subjects changed by ${before.fixed.unmapped_subjects - after.fixed.unmapped_subjects}, expected ${mapped.length}`);
    // Structural gates must hold after the run (unresolved Student concepts and not-applied mappings are reported, not created here).
    for (const f of after.gates.findings) if (f.kind === 'BROKEN' && f.count > 0 && f.gate !== 'UNRESOLVED_STUDENT_CONCEPTS' && !(auditOnly && f.gate === 'ACADEMIC_SUBJECT_CANONICAL_MAPPING')) problems.push(`GATE ${f.gate}: ${f.count} ${f.detail}`);

    if (write && !auditOnly && problems.length === 0) {
      await client.query('COMMIT');
      committed = true;
    } else await client.query('ROLLBACK');

    const tally = (rows: Array<{ classification: string }>) => rows.reduce<Record<string, number>>((a, r) => ((a[r.classification] = (a[r.classification] ?? 0) + 1), a), {});
    const zero = (rows: typeof versionsAfter) => rows.filter((v) => v.status === 'PUBLISHED' && v.nodes > 0 && v.publishedConceptMappings === 0);
    const international = (rows: typeof versionsAfter) => rows.filter((v) => /^(IB |Cambridge)/.test(v.programme));
    const topicsByKey = new Map(versionsBefore.map((v) => [v.structureVersionId, v.topics]));
    const report = {
      db: fp, mode: committed ? 'APPLIED' : auditOnly ? 'AUDIT_ONLY' : problems.length ? 'ABORTED (rolled back)' : 'DRY_RUN (rolled back)',
      nodeTypes: { before: before.nodeTypes, after: after.nodeTypes }, paaNodeTypes: { before: before.paaNodeTypes, after: after.paaNodeTypes },
      paa, aice: aice ? { created: aice.created, existing: aice.existing, structures: aice.structures, sourceGaps: aiceSyllabiWithoutTopicLayer() } : 'SKIPPED',
      canonicalSubjects: { unmappedBefore: unmappedBefore.length, mapped: mapped.map((m) => `${m.programme} · ${m.name} -> ${m.canonicalSubject} (${m.basis})`), unmappedAfter: unmappedAfter.length, classificationBefore: tally(unmappedBefore), classificationAfter: tally(unmappedAfter) },
      structureVersions: { zeroMappingBefore: zero(versionsBefore).length, zeroMappingAfter: zero(versionsAfter).length, classificationAfter: tally(zero(versionsAfter)) },
      gates: { brokenBefore: before.gates.broken, brokenAfter: after.gates.broken, findings: after.gates.findings.filter((f) => f.count > 0) },
      problems,
    };
    console.log(JSON.stringify(report, null, 1));
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      const tag = fp === PREVIEW ? 'preview' : fp === DEV ? 'dev' : 'ephemeral';
      writeFileSync(join(outDir, `curriculum_convergence_${tag}_report.json`), JSON.stringify(report, null, 1) + '\n');
      writeFileSync(join(outDir, `canonical_subject_review_queue_${tag}.csv`), csv([['programme', 'programme_type', 'subject', 'level', 'config_key', 'classification', 'reason', 'academic_subject_id'], ...unmappedAfter.map((u) => [u.programme, u.programmeType, u.name, u.level, u.configKey, u.classification, u.reason, u.academicSubjectId])]));
      writeFileSync(join(outDir, `structure_version_classification_${tag}.csv`), csv([['programme', 'subject', 'level', 'version', 'status', 'config_key', 'nodes', 'topics_before', 'topics_after', 'objectives', 'concept_mappings', 'classification', 'structure_version_id'], ...versionsAfter.map((v) => [v.programme, v.subject, v.level, v.versionLabel, v.status, v.configKey, v.nodes, topicsByKey.get(v.structureVersionId) ?? 0, v.topics, v.activeObjectives, v.publishedConceptMappings, v.classification, v.structureVersionId])]));
      writeFileSync(join(outDir, `ib_cambridge_topic_matrix_${tag}.csv`), csv([['system', 'subject', 'level', 'structure_version', 'topics_before', 'topics_after', 'objectives', 'concept_mappings', 'unresolved_source_gaps'], ...international(versionsAfter).map((v) => {
        const syllabus = v.configKey?.match(/^v2\.aice\.(\d{4})-/)?.[1] ?? null;
        const gap = v.topics > 0 ? 'topic -> objective / concept association: not in the governed source' : syllabus ? aiceSyllabiWithoutTopicLayer().find((g) => g.syllabusCode === syllabus)?.gap ?? 'no governed Topic source' : v.programme.startsWith('IB') ? 'CURRICULUM_DATA_NOT_READY: the governed IB sources (ib-dp*.json) carry components and assessment objectives, no syllabus Topic layer' : 'CURRICULUM_DATA_NOT_READY: no governed Topic source for this syllabus';
        return [v.programme, v.subject, v.level, v.versionLabel, topicsByKey.get(v.structureVersionId) ?? 0, v.topics, v.activeObjectives, v.publishedConceptMappings, gap];
      })]));
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  if (problems.length) process.exit(2);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

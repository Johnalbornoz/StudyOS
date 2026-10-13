/**
 * Curriculum convergence -- data integrity gates (read-only).
 *
 * Every gate separates what is BROKEN from what is legitimately absent:
 *
 *   BROKEN                a row that contradicts the model, or data the model says must exist and does not
 *   NOT_READY_FAIL_CLOSED missing governed data; resolution answers CURRICULUM_MAPPING_NOT_READY for it
 *   REVIEW                needs a person (queued), nothing is decided automatically
 *   VALID_NOT_APPLICABLE  the rule does not semantically apply to the row
 *   INFO                  a count for the record
 *
 * A gate fails only on BROKEN. Rows are never forced to satisfy a rule that does not apply to them.
 */
import type { DbExecutor } from '@/lib/db';
import { catalogSubjectByName } from '@/lib/experience/subject-catalog';
import { auditStructureVersions, auditUnmappedAcademicSubjects } from './coverage.service';
import { isValidWithoutMappings } from './coverage-classification';

export type FindingKind = 'BROKEN' | 'NOT_READY_FAIL_CLOSED' | 'REVIEW' | 'VALID_NOT_APPLICABLE' | 'INFO';

export interface IntegrityFinding {
  gate: string;
  kind: FindingKind;
  count: number;
  detail: string;
  sample?: string[];
}

export const PROVENANCE_MIGRATION_VERSION = '20261122_1000';

const n = async (client: DbExecutor, sql: string, params: unknown[] = []) => Number((await client.query(sql, params)).rows[0]?.n ?? 0);
const hasTable = async (client: DbExecutor, table: string) => (await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`, [table])).rows.length > 0;

export async function runCurriculumIntegrityGates(client: DbExecutor): Promise<{ findings: IntegrityFinding[]; broken: number }> {
  const findings: IntegrityFinding[] = [];
  const add = (gate: string, kind: FindingKind, count: number, detail: string, sample?: string[]) => findings.push({ gate, kind, count, detail, ...(sample?.length ? { sample: sample.slice(0, 8) } : {}) });

  // 1. academic subjects without a canonical subject
  const unmapped = await auditUnmappedAcademicSubjects(client);
  const by = (c: string) => unmapped.filter((u) => u.classification === c);
  add('ACADEMIC_SUBJECT_CANONICAL_MAPPING', 'BROKEN', by('MAPPABLE_DETERMINISTICALLY').length, 'canonical subject is a stated fact and is not recorded', by('MAPPABLE_DETERMINISTICALLY').map((u) => `${u.programme} · ${u.name}`));
  add('ACADEMIC_SUBJECT_CANONICAL_MAPPING', 'BROKEN', by('DATA_ERROR').length, 'contradictory catalogue data', by('DATA_ERROR').map((u) => `${u.programme} · ${u.name}: ${u.reason}`));
  add('ACADEMIC_SUBJECT_CANONICAL_MAPPING', 'REVIEW', by('NEEDS_HUMAN_DECISION').length, 'no canonical subject can be stated deterministically (review queue)');
  add('ACADEMIC_SUBJECT_CANONICAL_MAPPING', 'VALID_NOT_APPLICABLE', by('NOT_APPLICABLE').length + by('DUPLICATE_LEGACY').length, 'programme core components and outgoing / retired courses');

  // 2. published structure versions with nodes and no concept mapping
  const versions = (await auditStructureVersions(client)).filter((v) => v.status === 'PUBLISHED' && v.nodes > 0 && v.publishedConceptMappings === 0);
  const notReady = versions.filter((v) => !isValidWithoutMappings(v.classification));
  add('STRUCTURE_VERSION_CONCEPT_MAPPINGS', 'NOT_READY_FAIL_CLOSED', notReady.length, 'active academic structures without a node -> concept path: resolution answers CURRICULUM_MAPPING_NOT_READY', notReady.map((v) => `${v.programme} · ${v.subject}${v.level ? ` · ${v.level}` : ''} (${v.classification})`));
  add('STRUCTURE_VERSION_CONCEPT_MAPPINGS', 'VALID_NOT_APPLICABLE', versions.length - notReady.length, 'structural-only, non-academic component or legacy / retired versions');

  // 3. orphan curriculum nodes
  add('ORPHAN_CURRICULUM_NODES', 'BROKEN', await n(client,
    `SELECT count(*)::int AS n FROM structure_nodes c WHERE c.parent_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM structure_nodes p WHERE p.id = c.parent_id AND p.structure_version_id = c.structure_version_id)`), 'a node whose parent is missing or belongs to another structure version');
  add('ORPHAN_CURRICULUM_NODES', 'BROKEN', await n(client,
    `SELECT count(*)::int AS n FROM learning_objectives lo WHERE NOT EXISTS (SELECT 1 FROM structure_nodes sn WHERE sn.id = lo.structure_node_id)`), 'a learning objective without its node');

  // 4. duplicate structure-node paths
  add('DUPLICATE_STRUCTURE_NODE_PATHS', 'BROKEN', await n(client,
    `SELECT count(*)::int AS n FROM (SELECT 1 FROM structure_nodes WHERE status = 'ACTIVE'
        GROUP BY structure_version_id, parent_id, node_type, lower(trim(source_label)) HAVING count(*) > 1) d`), 'two ACTIVE nodes with the same type and label under the same parent');
  add('DUPLICATE_STRUCTURE_NODE_PATHS', 'BROKEN', await n(client,
    `SELECT count(*)::int AS n FROM (SELECT 1 FROM structure_nodes WHERE code IS NOT NULL GROUP BY structure_version_id, code HAVING count(*) > 1) d`), 'two nodes with the same code in one structure version');

  // 5. invalid canonical-concept mappings
  add('INVALID_CONCEPT_MAPPINGS', 'BROKEN', await n(client,
    `SELECT count(*)::int AS n FROM objective_concept_mappings m
       LEFT JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id LEFT JOIN learning_objectives lo ON lo.id = m.learning_objective_id
      WHERE m.status = 'PUBLISHED' AND (cc.id IS NULL OR cc.status <> 'ACTIVE' OR lo.id IS NULL OR lo.status <> 'ACTIVE')`), 'a PUBLISHED mapping to a concept or objective that is missing or not ACTIVE');
  add('INVALID_CONCEPT_MAPPINGS', 'REVIEW', await n(client,
    `SELECT count(DISTINCT a.id)::int AS n FROM objective_concept_mappings m
       JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id JOIN learning_objectives lo ON lo.id = m.learning_objective_id
       JOIN structure_nodes sn ON sn.id = lo.structure_node_id JOIN structure_versions sv ON sv.id = sn.structure_version_id AND sv.status = 'PUBLISHED'
       JOIN academic_subjects a ON a.id = sv.academic_subject_id
      WHERE m.status = 'PUBLISHED' AND a.canonical_subject_id IS NOT NULL AND cc.canonical_subject_id <> a.canonical_subject_id`), 'academic subjects with a PUBLISHED mapping into a canonical subject other than their own (reviewed cross-subject content; listed, not changed)');

  // 6. Learn provenance
  if (await hasTable(client, 'learner_concept_curriculum_provenance')) {
    add('LEARN_PROVENANCE', 'BROKEN', await n(client,
      `SELECT count(*)::int AS n FROM learner_concept_curriculum_provenance p
         JOIN structure_nodes sn ON sn.id = p.structure_node_id JOIN structure_versions sv ON sv.id = p.structure_version_id
         LEFT JOIN concept_catalog_mapping m ON m.learner_concept_id = p.learner_concept_id AND m.status = 'MATCHED'
        WHERE sn.structure_version_id <> p.structure_version_id OR sv.academic_subject_id <> p.academic_subject_id OR m.canonical_concept_id IS DISTINCT FROM p.canonical_concept_id`), 'a recorded lineage whose references do not agree (node / version / subject / canonical concept)');
    add('LEARN_PROVENANCE', 'BROKEN', await n(client,
      `SELECT count(*)::int AS n FROM learner_concept_curriculum_provenance p
         JOIN canonical_concepts cc ON cc.id = p.canonical_concept_id JOIN academic_subjects a ON a.id = p.academic_subject_id
        WHERE NOT EXISTS (SELECT 1 FROM objective_concept_mappings ocm WHERE ocm.learning_objective_id = p.learning_objective_id AND ocm.canonical_concept_id = p.canonical_concept_id)`), 'a recorded lineage with no objective -> concept mapping behind it (cross-subject attribution)');
    add('LEARN_PROVENANCE', 'INFO', await n(client, `SELECT count(*)::int AS n FROM learner_concept_curriculum_provenance`), 'Learn concepts with a recorded curriculum lineage');
    // Required: the concept entered Learn from a curriculum (source CURRICULUM_RECOMMENDATION) after the lineage existed.
    add('LEARN_PROVENANCE', 'REVIEW', await n(client,
      `SELECT count(*)::int AS n FROM student_concept_sources s
         JOIN student_plan_entries e ON e.student_id = s.student_id AND e.canonical_concept_id = s.canonical_concept_id
        WHERE s.source_type = 'CURRICULUM_RECOMMENDATION' AND s.active
          AND s.added_at >= (SELECT applied_at FROM schema_migrations WHERE version = $1)
          AND NOT EXISTS (SELECT 1 FROM learner_concept_curriculum_provenance p WHERE p.learner_concept_id = e.learner_concept_id)`, [PROVENANCE_MIGRATION_VERSION]), 'concepts added from a curriculum after the lineage existed, without a recorded lineage (the concept is not mapped in the Student\'s own explicit curriculum)');
  } else add('LEARN_PROVENANCE', 'BROKEN', 1, `table learner_concept_curriculum_provenance is missing (migration ${PROVENANCE_MIGRATION_VERSION} not applied)`);

  // 7. Student selections that fail closed
  add('STUDENT_CURRICULUM_NOT_READY', 'NOT_READY_FAIL_CLOSED', await n(client,
    `SELECT count(*)::int AS n FROM student_academic_subjects sas
      WHERE sas.ended_at IS NULL AND NOT EXISTS (
        SELECT 1 FROM structure_versions sv JOIN structure_nodes sn ON sn.structure_version_id = sv.id
          JOIN learning_objectives lo ON lo.structure_node_id = sn.id AND lo.status = 'ACTIVE'
          JOIN objective_concept_mappings m ON m.learning_objective_id = lo.id AND m.status = 'PUBLISHED'
         WHERE sv.academic_subject_id = sas.academic_subject_id AND sv.status = 'PUBLISHED')`), 'academic subjects Students selected whose curriculum is not loaded: Learn shows it as not ready, never another curriculum');

  // 8. unresolved Student concepts: personal (no canonical counterpart exists) vs resolvable and not resolved
  const unresolved = (await client.query(
    `SELECT m.learner_concept_id, m.status, s.name AS subject_name,
            ARRAY(SELECT lower(trim(cl.label)) FROM concept_localizations cl WHERE cl.concept_id = c.id) AS labels
       FROM concept_catalog_mapping m JOIN concepts c ON c.id = m.learner_concept_id JOIN subjects s ON s.id = c.subject_id
      WHERE m.status <> 'MATCHED'`
  )).rows as Array<{ learner_concept_id: string; status: string; subject_name: string; labels: string[] }>;
  const canonical = (await client.query(
    `SELECT cs.name AS subject_name, lower(trim(cc.name)) AS label FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id AND cs.status = 'ACTIVE' WHERE cc.status = 'ACTIVE'
     UNION SELECT cs.name, lower(trim(l.label)) FROM canonical_concept_localizations l JOIN canonical_concepts cc ON cc.id = l.canonical_concept_id AND cc.status = 'ACTIVE' JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id AND cs.status = 'ACTIVE'`
  )).rows as Array<{ subject_name: string; label: string }>;
  // Resolution policy (catalog-resolution.ts): the SAME-NAMED canonical subject, by canonical name (A) or reviewed alias (B).
  const sameSubject = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const names = (await client.query(`SELECT cs.name AS subject_name, lower(trim(cc.name)) AS label FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id`)).rows as Array<{ subject_name: string; label: string }>;
  const aliases = (await hasTable(client, 'canonical_concept_aliases'))
    ? ((await client.query(`SELECT cs.name AS subject_name, a.normalized_label AS label FROM canonical_concept_aliases a JOIN canonical_subjects cs ON cs.id = a.canonical_subject_id WHERE a.status = 'ACTIVE'`)).rows as Array<{ subject_name: string; label: string }>)
    : [];
  const resolvable = unresolved.filter((u) => u.status === 'UNRESOLVED' && u.labels.some((l) => [...names, ...aliases].some((x) => sameSubject(x.subject_name, u.subject_name) && x.label === l)));
  // Localized catalogue labels are not a resolution ground; a Student label that equals one is listed for a reviewer.
  const keyOf = (name: string) => catalogSubjectByName(name)?.key ?? `name:${name.trim().toLowerCase()}`;
  const localized = new Set(canonical.map((x) => `${keyOf(x.subject_name)}|${x.label}`));
  const reviewable = unresolved.filter((u) => u.status === 'UNRESOLVED' && !resolvable.includes(u) && u.labels.some((l) => localized.has(`${keyOf(u.subject_name)}|${l}`)));
  add('UNRESOLVED_STUDENT_CONCEPTS', 'BROKEN', resolvable.length, 'BROKEN_RESOLUTION: the catalogue resolves this label (canonical name or reviewed alias of the same subject) and the Student concept is still UNRESOLVED', resolvable.map((u) => u.learner_concept_id));
  add('UNRESOLVED_STUDENT_CONCEPTS', 'REVIEW', unresolved.filter((u) => u.status !== 'UNRESOLVED').length + reviewable.length, 'AMBIGUOUS / PROPOSED correspondences, and labels equal to a localized catalogue label, waiting for a reviewer');
  add('UNRESOLVED_STUDENT_CONCEPTS', 'VALID_NOT_APPLICABLE', unresolved.filter((u) => u.status === 'UNRESOLVED').length - resolvable.length - reviewable.length, 'PERSONAL_UNMAPPED: no canonical name and no reviewed alias carries this label in this subject (nothing to resolve to; none is fabricated)');

  return { findings, broken: findings.filter((f) => f.kind === 'BROKEN').reduce((a, f) => a + f.count, 0) };
}

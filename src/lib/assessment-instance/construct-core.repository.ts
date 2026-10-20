/**
 * QF V5.1 -- persistence of construct cores, applicability, adapters, renderers and item instances.
 * Tables of migration 20261121_1100 (NOT applied to any environment yet). Every function takes the connection:
 * nothing here imports the application's pool, so nothing at runtime reaches these tables by accident.
 *
 * The database enforces the same rules the pure modules state (lifecycle, immutability of a certified core,
 * what an instance may be derived from); this module does not re-implement them, it surfaces their refusals.
 */
import { sha256OfCanonicalJson } from '@/lib/assessment-adaptation/canonical-hash';
import type { AssessmentAdapter } from './assessment-adapter';
import type { CoreApplicabilityRecord } from './core-applicability';
import { canTransitionCore, type ConstructCoreRecord, type CoreCertification, type CoreLifecycle } from './construct-core';
import type { AssessmentSystemRegistry } from './assessment-system-registry';
import type { RenderedInstance } from './renderer';

export interface Queryable { query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> }

export const CORE_COLUMNS = 'id, construct_family_id, family_version, family_type, canonical_subject, primary_concept_stable_id, lifecycle, certification_version, certified_by, certified_at, shortcut_constraints, family, content_hash';

const toRecord = (r: Record<string, unknown>): ConstructCoreRecord & { id: string } => ({
  id: String(r.id), v: 1, constructFamilyId: String(r.construct_family_id), familyVersion: String(r.family_version), familyType: String(r.family_type), canonicalSubject: String(r.canonical_subject),
  primaryConceptStableId: String(r.primary_concept_stable_id), lifecycle: r.lifecycle as CoreLifecycle,
  certification: r.certification_version ? { certificationVersion: String(r.certification_version), certifiedBy: String(r.certified_by), certifiedAt: new Date(r.certified_at as string).toISOString() } : null,
  shortcutConstraints: r.shortcut_constraints as ConstructCoreRecord['shortcutConstraints'], contentHash: String(r.content_hash), family: r.family as ConstructCoreRecord['family'],
});

/** Stores a core as a DRAFT (or UNDER_REVIEW). A core is never inserted certified: certification is a transition. */
export async function insertCore(db: Queryable, core: ConstructCoreRecord): Promise<ConstructCoreRecord & { id: string }> {
  if (core.lifecycle !== 'DRAFT' && core.lifecycle !== 'UNDER_REVIEW') throw new Error(`CORE_IS_CREATED_AS_A_DRAFT: ${core.lifecycle}`);
  const r = await db.query(
    `INSERT INTO assessment_construct_cores (construct_family_id, family_version, family_type, canonical_subject, primary_concept_stable_id, lifecycle, shortcut_constraints, family, content_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9) RETURNING ${CORE_COLUMNS}`,
    [core.constructFamilyId, core.familyVersion, core.familyType, core.canonicalSubject, core.primaryConceptStableId, core.lifecycle, JSON.stringify(core.shortcutConstraints), JSON.stringify(core.family), core.contentHash],
  );
  return toRecord(r.rows[0]);
}

export async function getCore(db: Queryable, constructFamilyId: string, familyVersion: string): Promise<(ConstructCoreRecord & { id: string }) | null> {
  const r = await db.query(`SELECT ${CORE_COLUMNS} FROM assessment_construct_cores WHERE construct_family_id = $1 AND family_version = $2`, [constructFamilyId, familyVersion]);
  return r.rows[0] ? toRecord(r.rows[0]) : null;
}

/** The cores Student delivery may be fed from. */
export async function listCertifiedCores(db: Queryable, primaryConceptStableId?: string): Promise<Array<ConstructCoreRecord & { id: string }>> {
  const r = await db.query(
    `SELECT ${CORE_COLUMNS} FROM assessment_construct_cores WHERE lifecycle = 'CERTIFIED'${primaryConceptStableId ? ' AND primary_concept_stable_id = $1' : ''} ORDER BY construct_family_id, family_version`,
    primaryConceptStableId ? [primaryConceptStableId] : [],
  );
  return r.rows.map(toRecord);
}

/**
 * One lifecycle step. Certifying stores the reviewed family contract (lifecycle CERTIFIED, reviewStatus REVIEWED)
 * with its new content hash, in the same statement as the certification; nothing else can change a core's content.
 */
export async function transitionCore(db: Queryable, current: ConstructCoreRecord & { id: string }, to: CoreLifecycle, certified?: { core: ConstructCoreRecord; certification: CoreCertification }): Promise<ConstructCoreRecord & { id: string }> {
  if (!canTransitionCore(current.lifecycle, to)) throw new Error(`CORE_LIFECYCLE_TRANSITION_REFUSED: ${current.lifecycle} -> ${to}`);
  if (to === 'CERTIFIED') {
    if (!certified || certified.core.lifecycle !== 'CERTIFIED' || certified.core.constructFamilyId !== current.constructFamilyId || certified.core.familyVersion !== current.familyVersion) throw new Error('CERTIFICATION_NEEDS_THE_REVIEWED_CORE');
    const r = await db.query(
      `UPDATE assessment_construct_cores SET lifecycle = 'CERTIFIED', family = $2::jsonb, shortcut_constraints = $3::jsonb, content_hash = $4, certification_version = $5, certified_by = $6, certified_at = $7
        WHERE id = $1 AND lifecycle = 'UNDER_REVIEW' RETURNING ${CORE_COLUMNS}`,
      [current.id, JSON.stringify(certified.core.family), JSON.stringify(certified.core.shortcutConstraints), certified.core.contentHash, certified.certification.certificationVersion, certified.certification.certifiedBy, certified.certification.certifiedAt],
    );
    if (!r.rows[0]) throw new Error('CORE_CHANGED_UNDER_REVIEW');
    return toRecord(r.rows[0]);
  }
  const r = await db.query(`UPDATE assessment_construct_cores SET lifecycle = $2 WHERE id = $1 AND lifecycle = $3 RETURNING ${CORE_COLUMNS}`, [current.id, to, current.lifecycle]);
  if (!r.rows[0]) throw new Error('CORE_CHANGED_CONCURRENTLY');
  return toRecord(r.rows[0]);
}

/**
 * Persists one registered system with its versions and context nodes (parents before children). Idempotent: a row
 * that exists is left as it is, except a lifecycle that moved. Nothing here decides WHICH systems exist -- it stores
 * whatever registry it is given.
 */
export async function persistRegisteredSystem(db: Queryable, registry: AssessmentSystemRegistry, systemId: string): Promise<void> {
  const system = registry.system(systemId);
  if (!system) throw new Error(`ASSESSMENT_SYSTEM_NOT_REGISTERED: ${systemId}`);
  await db.query(
    `INSERT INTO assessment_systems (system_id, display_name, organization, region, system_type, lifecycle, metadata, provenance) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
     ON CONFLICT (system_id) DO UPDATE SET lifecycle = EXCLUDED.lifecycle, updated_at = now()`,
    [system.systemId, system.displayName, system.organization, system.region, system.systemType, system.lifecycle, JSON.stringify(system.metadata), JSON.stringify(system.provenance)],
  );
  for (const v of registry.versions(systemId)) {
    await db.query(
      `INSERT INTO assessment_system_versions (system_id, version_id, label, lifecycle, effective_from, effective_to, provenance) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (system_id, version_id) DO UPDATE SET lifecycle = EXCLUDED.lifecycle`,
      [v.systemId, v.versionId, v.label, v.lifecycle, v.effectiveFrom, v.effectiveTo, JSON.stringify(v.provenance)],
    );
    const nodes = [...registry.nodes(systemId, v.versionId)];
    const depth = (id: string): number => registry.lineageOf(id, v.versionId).length;
    for (const n of nodes.sort((a, b) => depth(a.nodeId) - depth(b.nodeId) || (a.nodeId < b.nodeId ? -1 : 1))) {
      await db.query(
        `INSERT INTO assessment_system_nodes (node_id, system_id, version_id, kind, parent_node_id, code, display_name) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (node_id, version_id) DO NOTHING`,
        [n.nodeId, n.systemId, n.versionId, n.kind, n.parentNodeId, n.code, n.displayName],
      );
    }
  }
}

export async function listRegisteredSystems(db: Queryable): Promise<Array<{ systemId: string; systemType: string; lifecycle: string; versions: string[] }>> {
  const r = await db.query(
    `SELECT s.system_id, s.system_type, s.lifecycle, COALESCE(array_agg(v.version_id ORDER BY v.version_id) FILTER (WHERE v.version_id IS NOT NULL), '{}') AS versions
       FROM assessment_systems s LEFT JOIN assessment_system_versions v ON v.system_id = s.system_id GROUP BY s.system_id ORDER BY s.system_id`,
  );
  return r.rows.map((x) => ({ systemId: String(x.system_id), systemType: String(x.system_type), lifecycle: String(x.lifecycle), versions: x.versions as string[] }));
}

/** An adapter is stored only bound to its registered system version; an unbound view is refused before the database is asked. */
export async function upsertAdapter(db: Queryable, adapter: AssessmentAdapter): Promise<void> {
  if (!adapter.systemVersionId) throw new Error(`ADAPTER_IS_NOT_BOUND_TO_A_SYSTEM_VERSION: ${adapter.adapterId}`);
  await db.query(
    `INSERT INTO assessment_adapters (adapter_id, adapter_version, status, source, system_id, system_version_id, exam_family, definition, content_hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     ON CONFLICT (adapter_id, adapter_version) DO UPDATE SET status = EXCLUDED.status WHERE assessment_adapters.content_hash = EXCLUDED.content_hash`,
    [adapter.adapterId, adapter.version, adapter.status, adapter.source, adapter.systemId, adapter.systemVersionId, adapter.examFamily, JSON.stringify(adapter), sha256OfCanonicalJson({ ...adapter, status: null })],
  );
}

export async function registerRenderer(db: Queryable, renderer: { rendererVersion: string; construct: string; kind: string; status: string }): Promise<void> {
  await db.query(
    `INSERT INTO assessment_instance_renderers (renderer_version, construct, strategy, status) VALUES ($1, $2, $3, $4) ON CONFLICT (renderer_version) DO UPDATE SET status = EXCLUDED.status`,
    [renderer.rendererVersion, renderer.construct, renderer.kind, renderer.status],
  );
}

export async function recordApplicability(db: Queryable, coreId: string, record: CoreApplicabilityRecord): Promise<void> {
  await db.query(
    `INSERT INTO assessment_construct_core_applicability (core_id, system_profile_id, adapter_id, status, reason, constraints, basis) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
     ON CONFLICT (core_id, adapter_id) DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason, constraints = EXCLUDED.constraints, basis = EXCLUDED.basis, recorded_at = now()`,
    [coreId, record.systemProfileId, record.componentId, record.status, record.reason, JSON.stringify(record.constraints), JSON.stringify(record.basis)],
  );
}

/** null = nothing is recorded: the combination is not plannable. */
export async function getApplicability(db: Queryable, coreId: string, adapterId: string): Promise<{ status: string; reason: string | null; constraints: unknown } | null> {
  const r = await db.query(`SELECT status, reason, constraints FROM assessment_construct_core_applicability WHERE core_id = $1 AND adapter_id = $2`, [coreId, adapterId]);
  return r.rows[0] ? { status: String(r.rows[0].status), reason: (r.rows[0].reason as string | null) ?? null, constraints: r.rows[0].constraints } : null;
}

/** Materialises a rendered instance. The database refuses it unless core, adapter, renderer and applicability allow it. Idempotent per controlled input. */
export async function storeInstance(db: Queryable, coreId: string, instance: RenderedInstance): Promise<string | null> {
  const l = instance.lineage;
  const r = await db.query(
    `INSERT INTO assessment_item_instances (core_id, primary_concept_stable_id, adaptation_specification_id, system_id, system_version_id, adapter_id, adapter_version, blueprint_bucket_id, seed, parameter_set_id, renderer_version, certification_version, learner, answer_key, rubric, response_policy)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb)
     ON CONFLICT ON CONSTRAINT assessment_item_instances_uq DO NOTHING RETURNING id`,
    [coreId, l.primaryConceptId, l.adaptationSpecificationId, l.assessmentSystemId, l.assessmentSystemVersionId, l.assessmentAdapterId, l.assessmentAdapterVersion, l.blueprintBucketId, l.seed, l.parameterSetId, l.rendererVersion, l.certificationVersion, JSON.stringify(instance.learner), JSON.stringify(instance.key), JSON.stringify(instance.rubric), JSON.stringify(instance.responsePolicy)],
  );
  return r.rows[0] ? String(r.rows[0].id) : null;
}

/** What Student delivery may be supplied for a bucket: the view only -- never question_bank_items. */
export async function studentEligibleInstances(db: Queryable, blueprintBucketId: string): Promise<Array<{ id: string; parameterSetId: string; learner: unknown }>> {
  const r = await db.query(`SELECT id, parameter_set_id, learner FROM student_eligible_item_instances WHERE blueprint_bucket_id = $1 ORDER BY parameter_set_id`, [blueprintBucketId]);
  return r.rows.map((x) => ({ id: String(x.id), parameterSetId: String(x.parameter_set_id), learner: x.learner }));
}

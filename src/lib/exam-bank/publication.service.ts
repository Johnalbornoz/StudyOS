/**
 * TRACK B -- Exam Bank publication: the governed loader / materialiser.
 *
 * Persists a `PublicationPlan` (publication-plan.ts): the certification policy, the registered systems, the
 * recorded human decisions, the governed objects with their certifications, the certified item instances, and
 * the runtime materialisation of those instances as Exam Bank rows.
 *
 *   TRANSACTIONAL  one transaction; any refusal rolls everything back.
 *   IDEMPOTENT     every row has a stable identity. A row that exists with the same content is skipped; a second
 *                  identical run writes nothing.
 *   FAIL-CLOSED    a row that exists under the same identity with DIFFERENT content stops the run
 *                  (`PublicationConflict`). An immutable certification is never overwritten.
 *   RESTARTABLE    follows from the three above: after any failure, the same command is run again.
 *   DRY RUN        the same statements, against the same database guards, then ROLLBACK. What it reports is what
 *                  an apply would do.
 *
 * The database is the second authority: every write here passes the guards of the certification model
 * (migrations 20261121_1100, 20261122_1200, 20261123_1000). The loader never disables, bypasses or re-creates one.
 */
import type { PoolClient } from 'pg';
import { mergedForPublication } from './publication-plan';
import { ibGovernedConceptByStableId } from '@/lib/curriculum/ib/ib-aa-hl-concept-correspondence';
import { contentHash } from '@/lib/exam-core/question-bank/bank.service';
import { itemFingerprints } from '@/lib/exam-core/fingerprints';
import { ApprovedItemContentSchema, examItemFromApproved } from '@/lib/exam-core/items';
import { persistRegisteredSystem } from '@/lib/assessment-instance/construct-core.repository';
import { STUDYUS_ASSESSMENT_REGISTRY } from '@/lib/assessment-instance/registered-systems';
import { paaCertifiedConceptByStableId } from '@/lib/curriculum/paa/paa-certified-concepts';
import { bankContentIssues, bankContentOf, CORE_DERIVED_ALIGNMENT, CORE_DERIVED_USAGE } from './bank-projection';
import { bankProjectionFor, scoringBankContentIssues, scoringBankContentOf, SCORING_PROJECTION_VERSION } from './scoring-projection';
import { planCounts, type BlockedRow, type PlannedHumanDecision, type PlannedObjectCertification, type PublicationPlan } from './publication-plan';

/** The migrations the model needs, by ledger version. */
export const REQUIRED_MIGRATIONS = ['20261121_1100', '20261122_1200', '20261123_1000'] as const;
const LOCK_KEY = 'exam-bank-publication';
const WRITTEN_TABLES = [
  'assessment_certification_policies', 'assessment_systems', 'assessment_system_versions', 'assessment_system_nodes', 'assessment_reviewer_qualifications', 'assessment_certifications',
  'assessment_object_certifications', 'assessment_construct_cores', 'assessment_adapters', 'assessment_instance_renderers', 'assessment_renderer_envelopes', 'assessment_blueprint_classifications',
  'assessment_blueprint_buckets', 'assessment_construct_core_applicability', 'assessment_certification_batches', 'assessment_certification_batch_cells', 'assessment_item_instances',
  'question_bank_items', 'approved_items', 'question_bank_content_rights', 'question_bank_item_concepts', 'question_bank_lifecycle_events', 'assessment_coverage_snapshots',
] as const;
type WrittenTable = (typeof WRITTEN_TABLES)[number];

export class PublicationConflict extends Error {
  constructor(public readonly kind: string, public readonly identity: string, detail: string) { super(`PUBLICATION_CONFLICT ${kind} ${identity}: ${detail}`); }
}
export class PublicationRefused extends Error {
  constructor(public readonly reasons: string[]) { super(`PUBLICATION_REFUSED: ${reasons.join('; ')}`); }
}

export interface PublicationReport {
  mode: 'DRY_RUN' | 'APPLY';
  committed: boolean;
  planHash: string;
  planned: Record<string, number>;
  /** Rows written per table (dry run: that would be written). */
  inserted: Record<WrittenTable, number>;
  insertedTotal: number;
  skipped: Record<string, number>;
  materialized: { planned: number; inserted: number; skipped: number; superseded: number; byObjective: Record<string, number> };
  blocked: BlockedRow[];
  conflicts: string[];
  verification: Record<string, number | string | boolean>;
}

type Q = Pick<PoolClient, 'query'>;
const one = async <T = Record<string, unknown>>(c: Q, sql: string, params: unknown[] = []): Promise<T | undefined> => (await c.query(sql, params)).rows[0] as T | undefined;
const iso = (v: unknown): string => new Date(v as string).toISOString();

async function tableCounts(c: Q): Promise<Record<WrittenTable, number>> {
  const out = {} as Record<WrittenTable, number>;
  for (const t of WRITTEN_TABLES) out[t] = Number((await one<{ n: string }>(c, `SELECT count(*) AS n FROM ${t}`))!.n);
  return out;
}

/** What must be true of the database before anything is written. */
export async function preflightDatabase(c: Q): Promise<string[]> {
  const reasons: string[] = [];
  const applied = new Set((await c.query(`SELECT version FROM schema_migrations WHERE version = ANY($1::text[])`, [REQUIRED_MIGRATIONS])).rows.map((r) => String(r.version)));
  for (const m of REQUIRED_MIGRATIONS) if (!applied.has(m)) reasons.push(`MIGRATION_NOT_APPLIED:${m}`);
  if (reasons.length > 0) return reasons;
  const invariant = await one<{ v: string | null }>(c, `SELECT public.assessment_supply_view_invariant() AS v`);
  if (invariant?.v) reasons.push(`ELIGIBILITY_VIEW_INVARIANT:${invariant.v}`);
  const guard = await one<{ def: string }>(c, `SELECT pg_get_functiondef('public.question_bank_authored_version_guard()'::regprocedure) AS def`);
  if (!guard?.def.includes('QUESTION_BANK_CORE_DERIVED_IS_NOT_ITS_CERTIFIED_INSTANCE')) reasons.push('AUTHORSHIP_GUARD_IS_NOT_THE_CORE_DERIVED_ONE');
  if (!(await one(c, `SELECT 1 FROM users WHERE is_system = true LIMIT 1`))) reasons.push('NO_TECHNICAL_IDENTITY');
  return reasons;
}

async function publish(c: Q, plan: ReturnType<typeof mergedForPublication>, report: PublicationReport): Promise<void> {
  const skip = (k: string, n = 1): void => { report.skipped[k] = (report.skipped[k] ?? 0) + n; };
  const conflict = (kind: string, identity: string, detail: string): never => { throw new PublicationConflict(kind, identity, detail); };

  // ---- policy (immutable; a changed policy is a new version)
  const policyRow = await one<{ policy_hash: string }>(c, `SELECT policy_hash FROM assessment_certification_policies WHERE policy_id = $1 AND version = $2`, [plan.policy.policyId, plan.policy.version]);
  if (policyRow && policyRow.policy_hash !== plan.policy.policyHash) conflict('CERTIFICATION_POLICY', `${plan.policy.policyId}@${plan.policy.version}`, `stored hash ${policyRow.policy_hash}, artefact hash ${plan.policy.policyHash}`);
  if (policyRow) skip('policy');
  else await c.query(`INSERT INTO assessment_certification_policies (policy_hash, policy_id, version, may_grant_scopes, policy) VALUES ($1, $2, $3, $4::text[], $5::jsonb)`, [plan.policy.policyHash, plan.policy.policyId, plan.policy.version, plan.policy.mayGrantScopes, JSON.stringify(plan.policy.policy)]);

  // ---- registered systems, versions and component nodes (the repository's own idempotent writer)
  for (const systemId of plan.systems) await persistRegisteredSystem(c as never, STUDYUS_ASSESSMENT_REGISTRY, systemId);

  // ---- reviewer qualifications and the recorded human decisions: copied, never created
  for (const q of plan.qualifications) {
    const r = await c.query(
      `INSERT INTO assessment_reviewer_qualifications (reviewer_id, authority, canonical_subject, system_id, granted_by, granted_at) VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
       ON CONFLICT ON CONSTRAINT assessment_reviewer_qualifications_uq DO NOTHING RETURNING id`,
      [q.reviewerId, q.authority, q.canonicalSubject, q.systemId, q.grantedBy, q.grantedAt]);
    if (r.rows.length === 0) {
      const held = await one<{ granted_by: string; revoked_at: unknown }>(c, `SELECT granted_by, revoked_at FROM assessment_reviewer_qualifications WHERE reviewer_id = $1 AND authority = $2 AND canonical_subject = $3 AND system_id = $4 AND granted_at = $5::timestamptz`, [q.reviewerId, q.authority, q.canonicalSubject, q.systemId, q.grantedAt]);
      if (!held || held.granted_by !== q.grantedBy) conflict('REVIEWER_QUALIFICATION', `${q.reviewerId}|${q.canonicalSubject}|${q.systemId}`, 'a qualification of this identity was granted by someone else');
      skip('reviewerQualifications');
    }
  }
  const humanRowId = new Map<string, string>();
  for (const d of plan.humanDecisions) {
    const same = await c.query(
      `SELECT id, decision, evidence_hash, decided_at, notes FROM assessment_certifications
        WHERE reviewer_id = $1 AND authority = $2 AND canonical_subject = $3 AND system_id = $4 AND object_type = $5 AND object_id = $6 AND object_version = $7`,
      [d.reviewerId, d.authority, d.canonicalSubject, d.systemId, d.objectType, d.objectId, d.objectVersion]);
    const exact = same.rows.find((r) => r.decision === d.decision && r.evidence_hash === d.evidenceHash && iso(r.decided_at) === iso(d.decidedAt));
    if (exact) { humanRowId.set(d.decisionId, String(exact.id)); skip('humanDecisions'); continue; }
    // the same reviewer, object and scope with another decision, hash or moment is NOT this recorded decision: never merged, never overwritten
    if (same.rows.length > 0) conflict('HUMAN_DECISION', d.decisionId, `a decision of this reviewer on ${d.objectType} ${d.objectId}@${d.objectVersion} (${d.systemId}) exists with different content`);
    const qualification = await one<{ id: string }>(c, `SELECT id FROM assessment_reviewer_qualifications WHERE reviewer_id = $1 AND authority = $2 AND canonical_subject = $3 AND system_id = $4 AND granted_at <= $5::timestamptz AND (revoked_at IS NULL OR revoked_at > $5::timestamptz) ORDER BY granted_at DESC LIMIT 1`, [d.reviewerId, d.authority, d.canonicalSubject, d.systemId, d.decidedAt]);
    if (!qualification) throw new PublicationRefused([`HUMAN_DECISION_HAS_NO_QUALIFICATION_IN_FORCE:${d.decisionId}`]);
    const ins = await one<{ id: string }>(c,
      `INSERT INTO assessment_certifications (reviewer_id, authority, qualification_id, canonical_subject, system_id, object_type, object_id, object_version, decision, decided_at, evidence_hash, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, $12) RETURNING id`,
      [d.reviewerId, d.authority, qualification.id, d.canonicalSubject, d.systemId, d.objectType, d.objectId, d.objectVersion, d.decision, d.decidedAt, d.evidenceHash, d.notes]);
    humanRowId.set(d.decisionId, ins!.id);
  }
  const decisionById = new Map<string, PlannedHumanDecision>(plan.humanDecisions.map((d) => [d.decisionId, d]));

  // ---- the governed objects, stored uncertified first: certification is a recorded decision, then a transition
  for (const a of plan.adapters) {
    const held = await one<{ content_hash: string }>(c, `SELECT content_hash FROM assessment_adapters WHERE adapter_id = $1 AND adapter_version = $2`, [a.adapter.adapterId, a.adapter.version]);
    if (held && held.content_hash !== a.contentHash) conflict('ASSESSMENT_ADAPTER', `${a.adapter.adapterId}@${a.adapter.version}`, 'stored content hash differs from the governed one');
    if (held) skip('adapters');
    else await c.query(`INSERT INTO assessment_adapters (adapter_id, adapter_version, status, source, system_id, system_version_id, exam_family, definition, content_hash) VALUES ($1, $2, 'PROVISIONAL', $3, $4, $5, $6, $7::jsonb, $8)`,
      [a.adapter.adapterId, a.adapter.version, a.adapter.source, a.adapter.systemId, a.adapter.systemVersionId, a.adapter.examFamily, JSON.stringify(a.definition), a.contentHash]);
  }
  const coreRowId = new Map<string, string>();
  for (const p of plan.cores) {
    const core = p.core;
    const held = await one<{ id: string; content_hash: string; lifecycle: string }>(c, `SELECT id, content_hash, lifecycle FROM assessment_construct_cores WHERE construct_family_id = $1 AND family_version = $2`, [core.constructFamilyId, core.familyVersion]);
    if (held && held.content_hash !== core.contentHash) conflict('CONSTRUCT_CORE', `${core.constructFamilyId}@${core.familyVersion}`, 'stored content hash differs from the governed one');
    if (held) { coreRowId.set(core.constructFamilyId, held.id); skip('cores'); continue; }
    const ins = await one<{ id: string }>(c,
      `INSERT INTO assessment_construct_cores (construct_family_id, family_version, family_type, canonical_subject, primary_concept_stable_id, lifecycle, shortcut_constraints, family, content_hash)
       VALUES ($1, $2, $3, $4, $5, 'UNDER_REVIEW', $6::jsonb, $7::jsonb, $8) RETURNING id`,
      [core.constructFamilyId, core.familyVersion, core.familyType, core.canonicalSubject, core.primaryConceptStableId, JSON.stringify(core.shortcutConstraints), JSON.stringify(core.family), core.contentHash]);
    coreRowId.set(core.constructFamilyId, ins!.id);
  }
  for (const r of plan.renderers) {
    const held = await one<{ construct: string; strategy: string }>(c, `SELECT construct, strategy FROM assessment_instance_renderers WHERE renderer_version = $1`, [r.rendererVersion]);
    if (held && (held.construct !== r.construct || held.strategy !== r.strategy)) conflict('RENDERER', r.rendererVersion, 'stored construct or strategy differs');
    if (held) skip('renderers');
    else await c.query(`INSERT INTO assessment_instance_renderers (renderer_version, construct, strategy, status) VALUES ($1, $2, $3, 'PROVISIONAL')`, [r.rendererVersion, r.construct, r.strategy]);
    const other = await one<{ envelope_hash: string }>(c, `SELECT envelope_hash FROM assessment_renderer_envelopes WHERE renderer_version = $1 AND family_version = $2 AND envelope_hash <> $3`, [r.rendererVersion, r.envelope.constructFamilyVersion, r.envelopeHash]);
    if (other) conflict('RENDERER_ENVELOPE', `${r.rendererVersion}@${r.envelope.constructFamilyVersion}`, `another envelope (${other.envelope_hash}) is stored for this renderer and core version`);
    if (await one(c, `SELECT 1 FROM assessment_renderer_envelopes WHERE envelope_hash = $1`, [r.envelopeHash])) skip('envelopes');
    else await c.query(`INSERT INTO assessment_renderer_envelopes (envelope_hash, renderer_version, construct_family_id, family_version, envelope) VALUES ($1, $2, $3, $4, $5::jsonb)`, [r.envelopeHash, r.rendererVersion, r.envelope.constructFamilyId, r.envelope.constructFamilyVersion, JSON.stringify(r.envelope)]);
  }
  for (const b of plan.blueprints) {
    const id = `${b.blueprint.blueprintId}@${b.blueprint.classificationVersion}`;
    const held = await one<{ content_hash: string }>(c, `SELECT content_hash FROM assessment_blueprint_classifications WHERE blueprint_id = $1 AND classification_version = $2`, [b.blueprint.blueprintId, b.blueprint.classificationVersion]);
    if (held && held.content_hash !== b.contentHash) conflict('BLUEPRINT_CLASSIFICATION', id, 'stored content hash differs from the governed one');
    if (held) skip('blueprints');
    else await c.query(`INSERT INTO assessment_blueprint_classifications (blueprint_id, classification_version, system_id, system_version_id, adapter_id, blueprint_class, facts, content_hash) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [b.blueprint.blueprintId, b.blueprint.classificationVersion, b.systemId, b.systemVersionId, b.blueprint.adapterId, b.blueprint.blueprintClass, JSON.stringify(b.blueprint.facts), b.contentHash]);
    for (const k of b.buckets) {
      const bucket = await one<{ blueprint_id: string; objective_code: string; primary_concept_stable_ids: string[] }>(c, `SELECT blueprint_id, objective_code, primary_concept_stable_ids FROM assessment_blueprint_buckets WHERE bucket_id = $1 AND classification_version = $2`, [k.bucketId, b.blueprint.classificationVersion]);
      if (bucket && (bucket.blueprint_id !== b.blueprint.blueprintId || bucket.objective_code !== k.objectiveCode || JSON.stringify([...bucket.primary_concept_stable_ids].sort()) !== JSON.stringify([...k.primaryConceptStableIds].sort()))) conflict('BLUEPRINT_BUCKET', `${k.bucketId}@${b.blueprint.classificationVersion}`, 'stored bucket differs');
      if (bucket) skip('blueprintBuckets');
      else await c.query(`INSERT INTO assessment_blueprint_buckets (bucket_id, blueprint_id, classification_version, objective_code, primary_concept_stable_ids) VALUES ($1, $2, $3, $4, $5::text[])`, [k.bucketId, b.blueprint.blueprintId, b.blueprint.classificationVersion, k.objectiveCode, k.primaryConceptStableIds]);
    }
  }

  // ---- object certifications: HUMAN where a recorded decision of exactly this content exists, AUTOMATED otherwise. Append-only.
  const certify = async (o: PlannedObjectCertification): Promise<void> => {
    const identity = `${o.objectType} ${o.objectId}@${o.objectVersion}`;
    const rows = (await c.query(`SELECT content_hash, state, policy_hash, human_certification_id, decided_by FROM assessment_object_certifications WHERE object_type = $1 AND object_id = $2 AND object_version = $3 ORDER BY decided_at`, [o.objectType, o.objectId, o.objectVersion])).rows;
    const exact = rows.find((r) => r.content_hash === o.contentHash && r.state === o.state && r.policy_hash === plan.policy.policyHash && r.decided_by === o.decidedBy);
    if (exact) { skip('objectCertifications'); return; }
    // another decision about this object is on record: a different content, another state, another decider. It is not replaced.
    if (rows.length > 0) conflict('OBJECT_CERTIFICATION', identity, `a certification of this object exists with other content (${rows.map((r) => `${r.state}/${String(r.content_hash).slice(0, 12)}/${r.decided_by}`).join(', ')})`);
    if (o.provenance === 'HUMAN') {
      const decision = o.humanDecisionId ? decisionById.get(o.humanDecisionId) : undefined;
      const rowId = o.humanDecisionId ? humanRowId.get(o.humanDecisionId) : undefined;
      if (!decision || !rowId) throw new PublicationRefused([`HUMAN_CERTIFIED_WITHOUT_A_PERSISTED_DECISION:${identity}`]);
      await c.query(`INSERT INTO assessment_object_certifications (object_type, object_id, object_version, content_hash, state, policy_hash, reasons, evidence, human_certification_id, decided_by, decided_at) VALUES ($1, $2, $3, $4, 'HUMAN_CERTIFIED', $5, '[]'::jsonb, $6::jsonb, $7, $8, $9::timestamptz)`,
        [o.objectType, o.objectId, o.objectVersion, o.contentHash, plan.policy.policyHash, JSON.stringify(o.evidence), rowId, decision.reviewerId, decision.decidedAt]);
    } else {
      await c.query(`INSERT INTO assessment_object_certifications (object_type, object_id, object_version, content_hash, state, policy_hash, reasons, evidence, human_certification_id, decided_by) VALUES ($1, $2, $3, $4, 'AUTOMATED_CERTIFIED_PILOT', $5, '[]'::jsonb, $6::jsonb, NULL, $7)`,
        [o.objectType, o.objectId, o.objectVersion, o.contentHash, plan.policy.policyHash, JSON.stringify(o.evidence), o.decidedBy]);
    }
  };
  for (const o of [...plan.adapters.map((a) => a.certification), ...plan.cores.map((x) => x.certification), ...plan.renderers.map((r) => r.certification), ...plan.blueprints.map((b) => b.certification)]) await certify(o);

  // ---- transitions to CERTIFIED: the database checks each against the certification just recorded
  for (const a of plan.adapters) {
    const r = await c.query(`UPDATE assessment_adapters SET status = 'CERTIFIED' WHERE adapter_id = $1 AND adapter_version = $2 AND status <> 'CERTIFIED'`, [a.adapter.adapterId, a.adapter.version]);
    if (r.rowCount === 0) skip('adapterTransitions');
  }
  for (const p of plan.cores) {
    const held = (await one<{ lifecycle: string; certification_version: string | null; certified_by: string | null }>(c, `SELECT lifecycle, certification_version, certified_by FROM assessment_construct_cores WHERE id = $1`, [coreRowId.get(p.core.constructFamilyId)]))!;
    if (held.lifecycle === 'CERTIFIED') {
      if (held.certification_version !== p.certificationVersion || held.certified_by !== p.certifiedBy) conflict('CONSTRUCT_CORE', `${p.core.constructFamilyId}@${p.core.familyVersion}`, `certified as ${held.certification_version} by ${held.certified_by}; the artefacts say ${p.certificationVersion} by ${p.certifiedBy}`);
      skip('coreTransitions');
      continue;
    }
    if (held.lifecycle !== 'UNDER_REVIEW') conflict('CONSTRUCT_CORE', `${p.core.constructFamilyId}@${p.core.familyVersion}`, `lifecycle is ${held.lifecycle}`);
    // a human-certified core is certified at the moment of the recorded decision; an automated one, now
    const decidedAt = p.certification.humanDecisionId ? decisionById.get(p.certification.humanDecisionId)!.decidedAt : null;
    await c.query(`UPDATE assessment_construct_cores SET lifecycle = 'CERTIFIED', certification_version = $2, certified_by = $3, certified_at = COALESCE($4::timestamptz, now()) WHERE id = $1`, [coreRowId.get(p.core.constructFamilyId), p.certificationVersion, p.certifiedBy, decidedAt]);
  }
  for (const r of plan.renderers) {
    const u = await c.query(`UPDATE assessment_instance_renderers SET status = 'CERTIFIED' WHERE renderer_version = $1 AND status <> 'CERTIFIED'`, [r.rendererVersion]);
    if (u.rowCount === 0) skip('rendererTransitions');
  }

  // ---- applicability (core x adapter), with the content hash a CONDITIONAL one was approved at
  for (const a of plan.applicability) {
    const coreId = coreRowId.get(a.coreId);
    if (!coreId) throw new PublicationRefused([`APPLICABILITY_OF_AN_UNPUBLISHED_CORE:${a.coreId}`]);
    const held = await one<{ content_hash: string | null; status: string }>(c, `SELECT content_hash, status FROM assessment_construct_core_applicability WHERE core_id = $1 AND adapter_id = $2`, [coreId, a.record.componentId]);
    if (held && (held.content_hash !== a.contentHash || held.status !== a.record.status)) conflict('CORE_APPLICABILITY', `${a.coreId} x ${a.record.componentId}`, 'stored applicability differs');
    if (held) skip('applicability');
    else await c.query(`INSERT INTO assessment_construct_core_applicability (core_id, system_profile_id, adapter_id, status, reason, constraints, basis, content_hash) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [coreId, a.record.systemProfileId, a.record.componentId, a.record.status, a.record.reason ?? null, JSON.stringify(a.record.constraints), JSON.stringify(a.record.basis), a.contentHash]);
  }

  // ---- the batch the instances come from (0 provider calls: the column refuses anything else)
  for (const pb of plan.batches) {
    const batch = await one<{ policy_hash: string; inputs_hash: string }>(c, `SELECT policy_hash, inputs_hash FROM assessment_certification_batches WHERE batch_id = $1`, [pb.batchId]);
    if (batch && (batch.policy_hash !== plan.policy.policyHash || batch.inputs_hash !== pb.inputsHash)) conflict('CERTIFICATION_BATCH', pb.batchId, 'the stored batch was computed from other inputs');
    if (batch) skip('batch');
    else await c.query(`INSERT INTO assessment_certification_batches (batch_id, policy_hash, inputs_hash, status, provider_calls, finished_at) VALUES ($1, $2, $3, 'COMPLETE', 0, now())`, [pb.batchId, plan.policy.policyHash, pb.inputsHash]);
    for (const cell of pb.cells) {
      const r = await c.query(`INSERT INTO assessment_certification_batch_cells (batch_id, cell_id, status, attempted, certified, checkpoint) VALUES ($1, $2, 'DONE', $3, $4, '{}'::jsonb) ON CONFLICT (batch_id, cell_id) DO NOTHING`, [pb.batchId, cell.cellId, cell.attempted, cell.certified]);
      if (r.rowCount === 0) skip('batchCells');
    }
  }

  // ---- certified item instances (INHERITED_DETERMINISTIC): the database re-decides each one on insert
  const instanceRowId = new Map<string, string>();
  for (const p of plan.instances) {
    const i = p.instance;
    const held = await one<{ id: string; content_hash: string; item_difficulty: number }>(c, `SELECT id, content_hash, item_difficulty FROM assessment_item_instances WHERE certification_digest = $1`, [i.lineageHash]);
    if (held && (held.content_hash !== p.contentHash || Number(held.item_difficulty) !== i.itemDifficulty)) conflict('ITEM_INSTANCE', i.instanceId, 'an instance of this lineage digest is stored with other content');
    if (held) { instanceRowId.set(i.instanceId, held.id); skip('certifiedInstances'); continue; }
    const l = i.lineage;
    const ins = await one<{ id: string }>(c,
      `INSERT INTO assessment_item_instances (core_id, primary_concept_stable_id, adaptation_specification_id, system_id, system_version_id, adapter_id, adapter_version, blueprint_bucket_id, seed, parameter_set_id, renderer_version, certification_version,
                                              learner, answer_key, rubric, response_policy, item_difficulty, envelope_hash, content_hash, certification_digest, certification_mode, rights_status, rights_basis, certification_state,
                                              eligibility_scopes, rights_category, policy_hash, recognition_id, item_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17, $18, $19, $20, $21, $22, $23, $24, $25::text[], $26, $27, $28, $29) RETURNING id`,
      [coreRowId.get(i.coreId), i.conceptId, l.adaptationSpecificationId, i.systemId, i.systemVersionId, i.adapterId, i.adapterVersion, i.bucketId, i.seed, l.parameterSetId, i.rendererVersion, p.certificationVersion,
        JSON.stringify(i.learner), JSON.stringify(i.key), JSON.stringify(i.rubric), JSON.stringify(i.responsePolicy), i.itemDifficulty, i.envelopeHash, p.contentHash, i.lineageHash, i.certificationMode, p.rightsStatus, p.rightsBasis, i.certificationState,
        i.eligibilityScopes, i.rightsCategory, i.policyHash, i.recognitionId, i.itemType]);
    instanceRowId.set(i.instanceId, ins!.id);
  }

  // ---- runtime materialisation: one Exam Bank item (+ version 1) per instance the Exam Core has a target for
  const author = (await one<{ id: string }>(c, `SELECT id FROM users WHERE is_system = true ORDER BY created_at ASC, id ASC LIMIT 1`))!.id;
  const targetsOf = new Map<string, { examVersionId: string; componentId: string; objectiveId: string }[]>();
  for (const b of plan.blueprints) for (const k of b.buckets) {
    const rows = (await c.query(
      `SELECT DISTINCT v.id AS exam_version_id, comp.id AS component_id, lo.id AS objective_id
         FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED'
         JOIN assessment_components comp ON comp.exam_version_id = v.id AND comp.section_key = $2
         JOIN blueprint_objective_targets t ON t.assessment_component_id = comp.id
         JOIN learning_objectives lo ON lo.id = t.learning_objective_id AND lo.code = $3
        WHERE d.config_key = $1 ORDER BY 1, 2, 3`,
      [b.blueprint.configKey, b.blueprint.sectionKey, k.objectiveCode])).rows;
    targetsOf.set(k.bucketId, rows.map((r) => ({ examVersionId: String(r.exam_version_id), componentId: String(r.component_id), objectiveId: String(r.objective_id) })));
  }
  /**
   * The reuse right of a bank version, in the bank's own rights model: what the canonical eligibility rule reads.
   * It restates the instance's rights (StudyUs-owned, rendered from a StudyUs core); it is never UNKNOWN and never a licence.
   */
  const ensureRights = async (versionId: string, i: PublicationPlan['instances'][number]): Promise<void> => {
    const held = await one<{ reuse_rights: string; source_access: string }>(c, `SELECT reuse_rights, source_access FROM question_bank_content_rights WHERE content_type = 'ITEM_VERSION' AND content_id = $1 AND superseded_at IS NULL`, [versionId]);
    if (held && (held.reuse_rights !== i.rightsStatus || held.source_access !== 'NOT_APPLICABLE')) conflict('EXAM_BANK_RIGHTS', versionId, `the bank records ${held.reuse_rights}/${held.source_access} for this version`);
    if (held) { skip('contentRights'); return; }
    await c.query(`INSERT INTO question_bank_content_rights (content_type, content_id, source_access, reuse_rights, rights_holder, permitted_use, attribution_text, recorded_by) VALUES ('ITEM_VERSION', $1, 'NOT_APPLICABLE', $2, 'StudyUs', $3, $4, $5)`,
      [versionId, i.rightsStatus, `Delivery to Students within StudyUs, in the scopes its certified instance grants (${i.instance.eligibilityScopes.join(', ')}).`, i.rightsBasis, author]);
  };
  /**
   * The canonical concept a certified instance is OF, as a row of the catalogue: the instance names it by its stable
   * id, the certified catalogue says which concept that is, and exactly one ACTIVE row must carry it. null = not
   * resolvable, and then nothing is materialised for that instance: a bank row never guesses its concept.
   */
  const conceptRowOf = new Map<string, string | null>();
  const canonicalConceptOf = async (stableId: string): Promise<string | null> => {
    if (conceptRowOf.has(stableId)) return conceptRowOf.get(stableId)!;
    // PAA-certified identities, then the IB identities governed for the pilot (StudyUs canonical knowledge, never official IB)
    const certified = paaCertifiedConceptByStableId(stableId) ?? ibGovernedConceptByStableId(stableId);
    const rows = certified ? (await c.query(`SELECT cc.id FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id WHERE lower(cs.name) = lower($1) AND lower(cc.name) = lower($2) AND cc.status = 'ACTIVE'`, [certified.canonicalSubject, certified.canonicalName])).rows : [];
    const id = rows.length === 1 ? String(rows[0].id) : null;
    conceptRowOf.set(stableId, id);
    return id;
  };
  const lifecycleEvent = async (itemId: string, versionId: string, from: string | null, to: string, reason: string, i: PublicationPlan['instances'][number]): Promise<void> => {
    await c.query(`INSERT INTO question_bank_lifecycle_events (bank_item_id, approved_item_id, from_status, to_status, reason, actor_kind, actor_user_id, run_id, detail) VALUES ($1, $2, $3, $4, $5, 'SYSTEM', NULL, NULL, $6::jsonb)`,
      [itemId, versionId, from, to, reason, JSON.stringify({ itemInstanceId: i.instance.instanceId, lineageDigest: i.instance.lineageHash, certification: 'INHERITED_DETERMINISTIC', policy: i.instance.policyVersion, batch: i.batchId ?? plan.batchId })]);
  };
  /** The version's one PRIMARY concept: the certified instance's. Stated while the version is not yet in use; never changed afterwards. */
  const attribute = async (versionId: string, conceptId: string): Promise<void> => {
    await c.query(`INSERT INTO question_bank_item_concepts (approved_item_id, canonical_concept_id, role, attributed_by) VALUES ($1, $2, 'PRIMARY', $3)`, [versionId, conceptId, author]);
  };
  const sectionOf = new Map<string, { sectionKey: string; objectiveCode: string }>(plan.blueprints.flatMap((b) => b.buckets.map((k) => [k.bucketId, { sectionKey: b.blueprint.sectionKey, objectiveCode: k.objectiveCode }] as const)));
  for (const p of plan.instances) {
    const i = p.instance;
    // IB (new content only): the scoring-preserving projection 3. Every other system: projection 2, unchanged.
    const projection = bankProjectionFor(i);
    const PROJECTION = projection.version;
    const refusal = projection.refusal;
    if (refusal) { report.blocked.push({ kind: 'EXAM_BANK_ROW', identity: i.instanceId, reason: refusal, detail: `${i.adapterId} ${i.format}: stays a certified instance with no bank row` }); continue; }
    const conceptId = await canonicalConceptOf(i.conceptId);
    if (!conceptId) { report.blocked.push({ kind: 'EXAM_BANK_ROW', identity: i.instanceId, reason: 'CANONICAL_CONCEPT_NOT_RESOLVED', detail: `${i.conceptId} is not exactly one ACTIVE concept of the certified catalogue here` }); continue; }
    const targets = targetsOf.get(i.bucketId) ?? [];
    if (targets.length === 0) { report.blocked.push({ kind: 'EXAM_BANK_ROW', identity: i.instanceId, reason: 'NO_RUNTIME_BLUEPRINT_TARGET', detail: `no published exam version has an objective ${sectionOf.get(i.bucketId)?.objectiveCode ?? i.bucketId}` }); continue; }
    // one objective, one row: an objective is unique by its code within its curriculum, shared by the versions that target it
    const byObjective = new Map(targets.map((t) => [t.objectiveId, t]));
    for (const target of byObjective.values()) {
      report.materialized.planned += 1;
      const content = PROJECTION === SCORING_PROJECTION_VERSION ? scoringBankContentOf(i) : bankContentOf(i);
      const contentIssues = (): string[] => (PROJECTION === SCORING_PROJECTION_VERSION ? scoringBankContentIssues(content, i) : bankContentIssues(content, i));
      const parsed = ApprovedItemContentSchema.safeParse(content);
      if (!parsed.success || !examItemFromApproved({ id: i.instanceId, learning_objective_id: target.objectiveId, content })) throw new PublicationRefused([`BANK_CONTENT_IS_NOT_DELIVERABLE:${i.instanceId}:${parsed.success ? 'structure' : parsed.error.issues[0]?.message}`]);
      if (contentIssues().length > 0) throw new PublicationRefused([`BANK_CONTENT_IS_NOT_ITS_INSTANCE:${i.instanceId}:${contentIssues().join(',')}`]);
      const hash = contentHash(content);
      const held = await one<{ id: string; item_instance_id: string | null; lineage_class: string; provenance: string; current_hash: string | null; version_id: string | null; projection: string | null; digest: string | null; lifecycle: string | null }>(c,
        `SELECT qi.id, qi.item_instance_id, qi.lineage_class, qi.provenance, ai.content_hash AS current_hash, ai.id AS version_id, ai.content->'certified'->>'projection' AS projection, ai.content->'lineage'->>'digest' AS digest, ai.bank_lifecycle_status AS lifecycle FROM question_bank_items qi LEFT JOIN approved_items ai ON ai.id = qi.current_version_id WHERE qi.learning_objective_id = $1 AND qi.item_key = $2`,
        [target.objectiveId, content.key]);
      const fp = itemFingerprints(parsed.data);
      /**
       * One version of the bank item: stored not yet in use, given its right and its concept, then made ACTIVE -- the
       * database decides on that transition whether it may be. The validation report keeps two facts apart:
       *   generation   what the renderer recorded when it rendered the instance (its own certification state THEN);
       *   publication  the certification this publication rests on, recorded NOW by the loader.
       */
      const publishVersion = async (itemId: string, versionNumber: number, supersedes: string | null): Promise<string> => {
        const validation = {
          kind: 'INHERITED_DETERMINISTIC_CERTIFICATION', projection: PROJECTION, itemInstanceId: i.instanceId, lineageDigest: i.lineageHash,
          generation: { certificationVersion: i.lineage.certificationVersion, seed: i.seed, rendererVersion: i.rendererVersion, note: 'the renderer\'s own record at rendering time; immutable; part of the lineage digest' },
          publication: { coreCertificationVersion: p.certificationVersion, instanceCertificationState: i.certificationState, certificationMode: i.certificationMode, policyVersion: i.policyVersion, policyHash: i.policyHash, batch: p.batchId ?? plan.batchId, note: 'recorded when the instance was published; it did not exist when the instance was rendered' },
        };
        const version = await one<{ id: string }>(c,
          `INSERT INTO approved_items (learning_objective_id, question_type, content, created_by, status, published_at, content_origin, semantic_fingerprint, template_fingerprint, reasoning_fingerprint, stimulus_fingerprint,
                                       bank_item_id, version_number, bank_lifecycle_status, content_hash, target_difficulty, calibration_confidence, lifecycle_updated_at, usage_eligibility, exam_alignment, validation_report, supersedes_version_id)
           VALUES ($1, $2, $3::jsonb, $4, 'APPROVED', NULL, 'AUTHORED', $5, $6, $7, $8, $9, $10, 'VALIDATED', $11, $12, 'INSUFFICIENT_DATA', now(), $13::text[], $14, $15::jsonb, $16) RETURNING id`,
          [target.objectiveId, content.type, JSON.stringify(content), author, fp.semantic, fp.template, fp.reasoning, fp.stimulus, itemId, versionNumber, hash, content.difficulty, [...CORE_DERIVED_USAGE], CORE_DERIVED_ALIGNMENT, JSON.stringify(validation), supersedes]);
        await ensureRights(version!.id, p);
        await attribute(version!.id, conceptId);
        if (supersedes) {
          // the earlier version is kept as history, out of use: what an attempt saw is never rewritten
          await c.query(`UPDATE approved_items SET bank_lifecycle_status = 'SUPERSEDED', status = 'RETIRED' WHERE id = $1`, [supersedes]);
          await lifecycleEvent(itemId, supersedes, 'ACTIVE', 'SUPERSEDED', `REPLACED_BY_PROJECTION_${PROJECTION}`, p);
        }
        await c.query(`UPDATE approved_items SET bank_lifecycle_status = 'ACTIVE', status = 'PUBLISHED', published_at = now() WHERE id = $1`, [version!.id]);
        await c.query(`UPDATE question_bank_items SET current_version_id = $2, updated_at = now() WHERE id = $1`, [itemId, version!.id]);
        await lifecycleEvent(itemId, version!.id, null, 'ACTIVE', 'CERTIFIED_INSTANCE_MATERIALIZED', p);
        return version!.id;
      };
      if (held) {
        if (held.item_instance_id !== instanceRowId.get(i.instanceId) || held.lineage_class !== 'CORE_DERIVED' || held.provenance !== 'STUDYUS_AUTHORED' || held.digest !== i.lineageHash) conflict('EXAM_BANK_ROW', `${content.key}`, 'a bank item of this key exists that is not this instance');
        if (held.current_hash !== hash) {
          // the SAME instance under an earlier projection: a new version supersedes it. Anything else is a conflict.
          if (!held.projection || held.projection === PROJECTION || held.lifecycle !== 'ACTIVE') conflict('EXAM_BANK_ROW', `${content.key}`, `the current version differs and is not an earlier projection in use (${held.projection ?? 'no projection'}, ${held.lifecycle})`);
          const next = Number((await one<{ n: string }>(c, `SELECT COALESCE(max(version_number), 0) AS n FROM approved_items WHERE bank_item_id = $1`, [held.id]))!.n) + 1;
          await publishVersion(held.id, next, held.version_id);
          report.materialized.superseded += 1;
          continue;
        }
        await ensureRights(held.version_id!, p);
        const attributed = (await c.query(`SELECT canonical_concept_id, role FROM question_bank_item_concepts WHERE approved_item_id = $1`, [held.version_id])).rows;
        if (attributed.some((a) => a.role === 'PRIMARY' && a.canonical_concept_id !== conceptId)) conflict('EXAM_BANK_ATTRIBUTION', content.key, 'the version is attributed to another concept than its instance');
        if (!attributed.some((a) => a.role === 'PRIMARY')) conflict('EXAM_BANK_ATTRIBUTION', content.key, 'the version in use states no primary concept');
        skip('conceptAttributions');
        report.materialized.skipped += 1;
        continue;
      }
      const section = sectionOf.get(i.bucketId)!;
      const item = await one<{ id: string }>(c,
        `INSERT INTO question_bank_items (item_key, exam_version_id, assessment_component_id, learning_objective_id, cell_key, provenance, language, lineage_class, item_instance_id)
         VALUES ($1, $2, $3, $4, $5, 'STUDYUS_AUTHORED', $6, 'CORE_DERIVED', $7) RETURNING id`,
        [content.key, target.examVersionId, target.componentId, target.objectiveId, `${section.sectionKey}|${section.objectiveCode}|*|*-*|*`, i.language, instanceRowId.get(i.instanceId)]);
      await publishVersion(item!.id, 1, null);
      report.materialized.inserted += 1;
      report.materialized.byObjective[section.objectiveCode] = (report.materialized.byObjective[section.objectiveCode] ?? 0) + 1;
    }
  }

  // ---- what is true now, read back from the database (not from the plan)
  const n = async (sql: string, params: unknown[] = []): Promise<number> => Number((await one<{ n: string }>(c, sql, params))!.n);
  const v = report.verification;
  v.certifiedCores = await n(`SELECT count(*) AS n FROM assessment_construct_cores WHERE lifecycle = 'CERTIFIED'`);
  v.humanCertifiedCores = await n(`SELECT count(*) AS n FROM assessment_construct_cores c WHERE c.lifecycle = 'CERTIFIED' AND EXISTS (SELECT 1 FROM assessment_object_certifications o WHERE o.object_type = 'CONSTRUCT_CORE' AND o.object_id = c.construct_family_id AND o.object_version = c.family_version AND o.state = 'HUMAN_CERTIFIED')`);
  v.automatedCertifiedCores = await n(`SELECT count(*) AS n FROM assessment_construct_cores c WHERE c.lifecycle = 'CERTIFIED' AND c.certified_by = $1 AND NOT EXISTS (SELECT 1 FROM assessment_object_certifications o WHERE o.object_type = 'CONSTRUCT_CORE' AND o.object_id = c.construct_family_id AND o.object_version = c.family_version AND o.state = 'HUMAN_CERTIFIED')`, [plan.cores.find((x) => x.certification.provenance === 'AUTOMATED')?.certifiedBy ?? '']);
  v.certifiedAdapters = await n(`SELECT count(*) AS n FROM assessment_adapters WHERE status = 'CERTIFIED'`);
  v.certifiedRenderers = await n(`SELECT count(*) AS n FROM assessment_instance_renderers WHERE status = 'CERTIFIED'`);
  v.humanDecisions = await n(`SELECT count(*) AS n FROM assessment_certifications`);
  v.humanCertifiedObjects = await n(`SELECT count(*) AS n FROM assessment_object_certifications WHERE state = 'HUMAN_CERTIFIED'`);
  v.automatedCertifiedObjects = await n(`SELECT count(*) AS n FROM assessment_object_certifications WHERE state = 'AUTOMATED_CERTIFIED_PILOT'`);
  // no machine decision carries a person: an automated object certification names no human decision and is decided by the policy
  v.automatedDecisionsAttributedToAPerson = await n(`SELECT count(*) AS n FROM assessment_object_certifications o WHERE o.state = 'AUTOMATED_CERTIFIED_PILOT' AND (o.human_certification_id IS NOT NULL OR o.decided_by IN (SELECT reviewer_id FROM assessment_reviewer_qualifications))`);
  v.humanCertifiedWithoutARecordedDecision = await n(`SELECT count(*) AS n FROM assessment_object_certifications o WHERE o.state = 'HUMAN_CERTIFIED' AND NOT EXISTS (SELECT 1 FROM assessment_certifications h WHERE h.id = o.human_certification_id AND h.evidence_hash = o.content_hash AND h.decision = 'APPROVE')`);
  v.certifiedInstances = await n(`SELECT count(*) AS n FROM assessment_item_instances`);
  v.eligibleInstancesInScope = await n(`SELECT count(*) AS n FROM student_eligible_item_instances WHERE $1 = ANY (eligibility_scopes)`, [plan.scope]);
  v.eligibleInstancesProduction = await n(`SELECT count(*) AS n FROM student_eligible_item_instances_production`);
  v.instancesNotInheritedDeterministic = await n(`SELECT count(*) AS n FROM assessment_item_instances WHERE certification_mode <> 'INHERITED_DETERMINISTIC_CERTIFICATION' OR certification_state <> 'AUTOMATED_CERTIFIED_PILOT'`);
  v.materializedExamItems = await n(`SELECT count(*) AS n FROM question_bank_items WHERE lineage_class = 'CORE_DERIVED'`);
  v.orphanBankRows = await n(`SELECT count(*) AS n FROM question_bank_items qi WHERE qi.lineage_class = 'CORE_DERIVED' AND NOT EXISTS (SELECT 1 FROM student_eligible_item_instances i WHERE i.id = qi.item_instance_id)`);
  v.bankRowsNotTheirInstance = await n(`SELECT count(*) AS n FROM question_bank_items qi JOIN approved_items ai ON ai.id = qi.current_version_id WHERE qi.lineage_class = 'CORE_DERIVED' AND NOT public.question_bank_item_inherits_certification(qi.id, ai.content)`);
  v.bankRowsAuthoredByAPerson = await n(`SELECT count(*) AS n FROM question_bank_items qi JOIN approved_items ai ON ai.bank_item_id = qi.id JOIN users u ON u.id = ai.created_by WHERE qi.lineage_class = 'CORE_DERIVED' AND u.is_system IS DISTINCT FROM true`);
  v.bankRowsWithoutAnEstablishedRight = await n(`SELECT count(*) AS n FROM question_bank_items qi WHERE qi.lineage_class = 'CORE_DERIVED' AND NOT EXISTS (SELECT 1 FROM question_bank_content_rights r WHERE r.content_type = 'ITEM_VERSION' AND r.content_id = qi.current_version_id AND r.superseded_at IS NULL AND r.reuse_rights = 'STUDYUS_OWNED')`);
  v.bankRowsWithoutTheirCertifiedConcept = await n(`SELECT count(*) AS n FROM question_bank_items qi WHERE qi.lineage_class = 'CORE_DERIVED' AND (SELECT count(*) FROM question_bank_item_concepts ic WHERE ic.approved_item_id = qi.current_version_id AND ic.role = 'PRIMARY') <> 1`);
  v.bankRowsNotActive = await n(`SELECT count(*) AS n FROM question_bank_items qi JOIN approved_items ai ON ai.id = qi.current_version_id WHERE qi.lineage_class = 'CORE_DERIVED' AND (ai.bank_lifecycle_status <> 'ACTIVE' OR ai.status <> 'PUBLISHED')`);
  v.bankRowsPresentingTheKeyAsAnExplanation = await n(`SELECT count(*) AS n FROM question_bank_items qi JOIN approved_items ai ON ai.id = qi.current_version_id WHERE qi.lineage_class = 'CORE_DERIVED' AND (ai.content->>'explanationStatus' IS DISTINCT FROM 'NONE' OR length(coalesce(ai.content->>'explanation', '')) > 0)`);
  v.bankRowsWithoutTheirGenerationLineage = await n(`SELECT count(*) AS n FROM question_bank_items qi JOIN approved_items ai ON ai.id = qi.current_version_id JOIN assessment_item_instances i ON i.id = qi.item_instance_id WHERE qi.lineage_class = 'CORE_DERIVED' AND (ai.content->'certified'->'generationLineage'->>'seed' IS DISTINCT FROM i.seed OR ai.validation_report->'generation'->>'certificationVersion' IS NULL OR ai.validation_report->'publication'->>'coreCertificationVersion' IS DISTINCT FROM i.certification_version)`);
  v.effectiveExamCapacity = await n(`SELECT count(DISTINCT i.recognition_id) AS n FROM question_bank_items qi JOIN approved_items ai ON ai.id = qi.current_version_id AND ai.status = 'PUBLISHED' AND ai.bank_lifecycle_status = 'ACTIVE' JOIN student_eligible_item_instances i ON i.id = qi.item_instance_id WHERE qi.lineage_class = 'CORE_DERIVED' AND qi.retired_at IS NULL AND $1 = ANY (i.eligibility_scopes)`, [plan.scope]);
  v.duplicateInstanceDigests = await n(`SELECT count(*) AS n FROM (SELECT certification_digest FROM assessment_item_instances GROUP BY 1 HAVING count(*) > 1) d`);
  v.duplicateBankRows = await n(`SELECT count(*) AS n FROM (SELECT item_instance_id, learning_objective_id FROM question_bank_items WHERE lineage_class = 'CORE_DERIVED' GROUP BY 1, 2 HAVING count(*) > 1) d`);
  v.duplicateHumanDecisions = await n(`SELECT count(*) AS n FROM (SELECT reviewer_id, object_type, object_id, object_version, system_id, canonical_subject, evidence_hash, decision, decided_at FROM assessment_certifications GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9 HAVING count(*) > 1) d`);
  v.duplicateObjectCertifications = await n(`SELECT count(*) AS n FROM (SELECT object_type, object_id, object_version FROM assessment_object_certifications GROUP BY 1, 2, 3 HAVING count(*) > 1) d`);

  // ---- coverage state: what is PERSISTED and eligible now. The offline render capacity is recorded beside it, labelled as such.
  const persisted = Number(v.certifiedInstances);
  const distinct = await n(`SELECT count(DISTINCT recognition_id) AS n FROM student_eligible_item_instances WHERE $1 = ANY (eligibility_scopes)`, [plan.scope]);
  const effective = Number(v.effectiveExamCapacity);
  const summary = { kind: 'EXAM_BANK_PUBLICATION', planHash: plan.planHash, batchId: plan.batchId, persistedInstances: persisted, eligibleInstancesInScope: Number(v.eligibleInstancesInScope), materializedExamItems: Number(v.materializedExamItems), effectiveExamCapacity: effective, offlineRenderCapacity: { ...plan.capacity, note: 'what the certified envelopes can render, not what is persisted' } };
  if (await one(c, `SELECT 1 FROM assessment_coverage_snapshots WHERE policy_hash = $1 AND eligibility_scope = $2 AND summary->>'planHash' = $3 AND certified_delivery_capacity = $4 AND raw_variant_capacity = $5`, [plan.policy.policyHash, plan.scope, plan.planHash, effective, persisted])) skip('coverageSnapshots');
  else await c.query(`INSERT INTO assessment_coverage_snapshots (policy_hash, eligibility_scope, raw_variant_capacity, distinct_deliverable_variants, certified_delivery_capacity, effective_repeatability_depth, summary) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [plan.policy.policyHash, plan.scope, persisted, Math.max(distinct, effective), effective, 0, JSON.stringify(summary)]);
}

/** Checks the publication is sound. Any reason: the transaction is rolled back. */
function verificationFailures(plan: PublicationPlan, v: PublicationReport['verification']): string[] {
  const reasons: string[] = [];
  const zero = ['automatedDecisionsAttributedToAPerson', 'humanCertifiedWithoutARecordedDecision', 'eligibleInstancesProduction', 'instancesNotInheritedDeterministic', 'orphanBankRows', 'bankRowsNotTheirInstance', 'bankRowsAuthoredByAPerson', 'bankRowsWithoutAnEstablishedRight', 'bankRowsWithoutTheirCertifiedConcept', 'bankRowsNotActive', 'bankRowsPresentingTheKeyAsAnExplanation', 'bankRowsWithoutTheirGenerationLineage', 'duplicateInstanceDigests', 'duplicateBankRows', 'duplicateHumanDecisions', 'duplicateObjectCertifications'];
  for (const k of zero) if (Number(v[k]) !== 0) reasons.push(`${k}=${v[k]}`);
  if (Number(v.humanDecisions) !== plan.humanDecisions.length) reasons.push(`humanDecisions=${v.humanDecisions} (the recorded file has ${plan.humanDecisions.length})`);
  if (Number(v.eligibleInstancesInScope) !== plan.instances.length || Number(v.certifiedInstances) !== plan.instances.length) reasons.push(`instances persisted ${v.certifiedInstances}, eligible ${v.eligibleInstancesInScope}, planned ${plan.instances.length}`);
  if (Number(v.humanCertifiedCores) + Number(v.automatedCertifiedCores) !== Number(v.certifiedCores)) reasons.push('a certified core is neither human-certified on a recorded decision nor automated by the policy');
  return reasons;
}

/**
 * Runs the publication in one transaction on `client`. `apply: false` is a dry run: the same statements against
 * the same guards, then ROLLBACK. The caller owns the connection.
 */
export async function runPublication(client: PoolClient, plan: PublicationPlan, opts: { apply: boolean }): Promise<PublicationReport> {
  const empty = Object.fromEntries(WRITTEN_TABLES.map((t) => [t, 0])) as Record<WrittenTable, number>;
  const report: PublicationReport = { mode: opts.apply ? 'APPLY' : 'DRY_RUN', committed: false, planHash: plan.planHash, planned: planCounts(plan), inserted: empty, insertedTotal: 0, skipped: {}, materialized: { planned: 0, inserted: 0, skipped: 0, superseded: 0, byObjective: {} }, blocked: [...plan.blocked], conflicts: [], verification: {} };
  const work = mergedForPublication(plan);
  if (work.preflight.length > 0) throw new PublicationRefused(work.preflight);
  await client.query('BEGIN');
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [LOCK_KEY]);
    const database = await preflightDatabase(client);
    if (database.length > 0) throw new PublicationRefused(database);
    const before = await tableCounts(client);
    await publish(client, work, report);
    const after = await tableCounts(client);
    for (const t of WRITTEN_TABLES) report.inserted[t] = after[t] - before[t];
    report.insertedTotal = Object.values(report.inserted).reduce((a, b) => a + b, 0);
    const failures = verificationFailures(work, report.verification);
    if (failures.length > 0) throw new PublicationRefused(failures.map((f) => `VERIFICATION:${f}`));
    if (opts.apply) { await client.query('COMMIT'); report.committed = true; } else await client.query('ROLLBACK');
    return report;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof PublicationConflict) report.conflicts.push(error.message);
    throw error;
  }
}

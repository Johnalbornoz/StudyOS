/**
 * PAA pilot -- publication of AUTOMATED_CERTIFIED_PILOT units into the Exam Bank.
 *
 * The candidate never reaches the runtime from here unless it is certified: this loader takes the stored factory
 * artefacts, RE-DERIVES the candidates and RE-RUNS the certification (pure, deterministic -- a decision written in an
 * artefact is not trusted), and writes only what certifies:
 *   the policy row -> the certified stimulus (identity, version, digest) -> the bank item and its version (stored
 *   not in use) -> its right, its PRIMARY concept, its automated certification -> ACTIVE.
 * The database decides the last step: without a certification of exactly that content the version cannot be ACTIVE
 * (migration 20261124_1000). No row of question_bank_reviews is written and no person is named.
 *
 * TRANSACTIONAL, IDEMPOTENT (an identical item is skipped), FAIL-CLOSED (an item of the same key with other content
 * stops the run), DRY RUN = the same statements then ROLLBACK.
 */
import { fullMockAuthorizationFor } from '../full-mock-authorization';
import type { PoolClient } from 'pg';
import { contentHash } from '@/lib/exam-core/question-bank/bank.service';
import { itemFingerprints } from '@/lib/exam-core/fingerprints';
import { ApprovedItemContentSchema, examItemFromApproved } from '@/lib/exam-core/items';
import { candidateUnitOf, certifyUnit, tableText, type GeneratedUnit, type GenerationProvenance, type SolverRun, type UnitCertification, type UnitPlan } from './paa-pilot-contract';
import { PAA_PILOT_CERT_POLICY_V1, PAA_PILOT_DECIDER, PAA_PILOT_POLICY_HASH, PAA_PILOT_POLICY_VERSION, PAA_PILOT_PROJECTION } from './paa-pilot-policy';

export const PAA_PILOT_REQUIRED_MIGRATIONS = ['20261124_1000', '20261124_1100', '20261124_1200'] as const;
export const PAA_PILOT_CONFIG_KEY = 'v2.paa';
export const PAA_PILOT_USAGE = ['PRACTICE', 'REDUCED_MOCK'] as const;
/** The pilot certification is PILOT_PREVIEW only; under the recorded full-length preparation mock authorisation the usage adds FULL_MOCK. */
const PILOT_SCOPE = 'PILOT_PREVIEW';
const PILOT_USAGE: readonly string[] = fullMockAuthorizationFor('PAA', PILOT_SCOPE) ? [...PAA_PILOT_USAGE, 'FULL_MOCK'] : PAA_PILOT_USAGE;
export interface PilotArtefact { plan: UnitPlan; generated: GeneratedUnit; provenance: GenerationProvenance; runs: SolverRun[] }
export interface PilotPublicationReport { mode: 'DRY_RUN' | 'APPLY'; committed: boolean; units: number; candidates: number; certified: number; reviewRequired: number; stimuliInserted: number; stimuliSkipped: number; itemsInserted: number; itemsSkipped: number; /** versions in use whose usage a governed authorisation widened */ usageAuthorized?: number; byObjective: Record<string, number>; blocked: { identity: string; reason: string }[]; verification: Record<string, number> }

/** The certifications of a set of artefacts, in order: an earlier unit's stimulus makes a later identical one a duplicate. */
export function certifyArtefacts(artefacts: readonly PilotArtefact[]): UnitCertification[] {
  const seen = new Set<string>();
  return artefacts.map((a) => { const unit = candidateUnitOf(a.plan, a.generated, a.provenance); const cert = certifyUnit(unit, a.runs ?? [], seen); if (unit.stimulus) seen.add(unit.stimulus.contentDigest); return cert; });
}

type Q = Pick<PoolClient, 'query'>;
const one = async <T = Record<string, unknown>>(c: Q, sql: string, params: unknown[] = []): Promise<T | undefined> => (await c.query(sql, params)).rows[0] as T | undefined;

export async function runPilotPublication(client: PoolClient, artefacts: readonly PilotArtefact[], opts: { apply: boolean }): Promise<PilotPublicationReport> {
  const certs = certifyArtefacts(artefacts);
  const report: PilotPublicationReport = { mode: opts.apply ? 'APPLY' : 'DRY_RUN', committed: false, units: certs.length, candidates: certs.reduce((n, x) => n + x.decisions.length, 0), certified: certs.reduce((n, x) => n + x.certified.length, 0), reviewRequired: certs.reduce((n, x) => n + x.decisions.filter((d) => d.state !== 'AUTOMATED_CERTIFIED_PILOT').length, 0), stimuliInserted: 0, stimuliSkipped: 0, itemsInserted: 0, itemsSkipped: 0, byObjective: {}, blocked: [], verification: {} };
  const c = client;
  await c.query('BEGIN');
  try {
    for (const m of PAA_PILOT_REQUIRED_MIGRATIONS) if (!(await one(c, `SELECT 1 FROM schema_migrations WHERE version = $1`, [m]))) throw new Error(`MIGRATION_NOT_APPLIED:${m}`);
    // the database must have DECLARED itself a pilot environment (a deliberate operator step); the loader never declares it
    if (!(await one(c, `SELECT 1 FROM exam_bank_pilot_environment WHERE scope = 'PILOT_PREVIEW'`))) throw new Error('PILOT_ENVIRONMENT_NOT_DECLARED: run declare-pilot-environment.ts on an authorised pilot database first');
    const author = (await one<{ id: string }>(c, `SELECT id FROM users WHERE is_system = true ORDER BY created_at ASC, id ASC LIMIT 1`))?.id;
    if (!author) throw new Error('NO_TECHNICAL_IDENTITY');
    // ---- the policy (immutable; a changed policy is a new version)
    const held = await one<{ policy_hash: string }>(c, `SELECT policy_hash FROM assessment_certification_policies WHERE policy_id = $1 AND version = $2`, [PAA_PILOT_CERT_POLICY_V1.policyId, PAA_PILOT_CERT_POLICY_V1.version]);
    if (held && held.policy_hash !== PAA_PILOT_POLICY_HASH) throw new Error('PUBLICATION_CONFLICT: the stored PAA pilot policy is not this policy');
    if (!held) await c.query(`INSERT INTO assessment_certification_policies (policy_hash, policy_id, version, may_grant_scopes, policy) VALUES ($1, $2, $3, $4::text[], $5::jsonb)`, [PAA_PILOT_POLICY_HASH, PAA_PILOT_CERT_POLICY_V1.policyId, PAA_PILOT_CERT_POLICY_V1.version, [...PAA_PILOT_CERT_POLICY_V1.mayGrantScopes], JSON.stringify(PAA_PILOT_CERT_POLICY_V1)]);

    const targetOf = async (sectionKey: string, objectiveCode: string) => one<{ exam_version_id: string; component_id: string; objective_id: string }>(c,
      `SELECT DISTINCT v.id AS exam_version_id, comp.id AS component_id, lo.id AS objective_id
         FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED'
         JOIN assessment_components comp ON comp.exam_version_id = v.id AND comp.section_key = $2
         JOIN blueprint_objective_targets t ON t.assessment_component_id = comp.id
         JOIN learning_objectives lo ON lo.id = t.learning_objective_id AND lo.code = $3
        WHERE d.config_key = $1 ORDER BY 1, 2, 3 LIMIT 1`, [PAA_PILOT_CONFIG_KEY, sectionKey, objectiveCode]);
    const conceptOf = async (subject: string, name: string): Promise<string | null> => { const rows = (await c.query(`SELECT cc.id FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id WHERE lower(cs.name) = lower($1) AND lower(cc.name) = lower($2) AND cc.status = 'ACTIVE'`, [subject, name])).rows; return rows.length === 1 ? String(rows[0].id) : null; };

    for (const cert of certs) {
      if (cert.certified.length === 0) continue;
      const s = cert.stimulus;
      if (s) {
        const heldS = await one<{ content_digest: string }>(c, `SELECT content_digest FROM exam_bank_pilot_stimuli WHERE stimulus_id = $1 AND version = $2`, [s.stimulusId, s.version]);
        if (heldS && heldS.content_digest !== s.contentDigest) throw new Error(`PUBLICATION_CONFLICT: stimulus ${s.stimulusId}@${s.version} is stored with other content`);
        if (heldS) report.stimuliSkipped += 1;
        else {
          const first = cert.certified[0].lineage;
          await c.query(
            `INSERT INTO exam_bank_pilot_stimuli (stimulus_id, version, content_digest, kind, language, system_id, component_key, blueprint_bucket_ids, linked_item_keys, content, rights_category, rights_basis, originality, lineage, policy_hash, certification_state, eligibility_scopes, evidence, decided_by)
             VALUES ($1, $2, $3, $4, $5, 'PAA', $6, $7::text[], $8::text[], $9::jsonb, $10, $11, $12::jsonb, $13::jsonb, $14, 'AUTOMATED_CERTIFIED_PILOT', ARRAY['PILOT_PREVIEW'], $15::jsonb, $16)`,
            [s.stimulusId, s.version, s.contentDigest, s.kind, s.language, s.system.componentId, s.blueprintBucketIds, s.linkedItemIds, JSON.stringify({ title: s.title, text: s.text, table: s.table, rendered: s.text ?? tableText(s.table!) }), s.origin.category, s.origin.basis,
              JSON.stringify({ status: 'CHECKED_ORIGINAL', method: 'INDEPENDENT_SOLVER_ATTESTATION+INTRA_BATCH_DEDUP', note: 'No external corpus was searched: two independent models did not recognise the text as a reproduction, and it is unique in the batch.' }),
              JSON.stringify({ generationService: first.generationService, provider: first.provider, model: first.model, promptId: first.promptId, promptVersion: first.promptVersion, executionId: first.executionId, generatedAt: first.generatedAt, unitId: first.unitId, candidateDigest: first.candidateDigest }), PAA_PILOT_POLICY_HASH, JSON.stringify(s.evidence), PAA_PILOT_DECIDER]);
          report.stimuliInserted += 1;
        }
      }
      for (const ci of cert.certified) {
        const key = ci.item.itemId;
        const target = await targetOf(ci.component, ci.objectiveCode);
        if (!target) { report.blocked.push({ identity: key, reason: `NO_RUNTIME_BLUEPRINT_TARGET:${ci.objectiveCode}` }); continue; }
        const conceptId = await conceptOf(ci.concept.canonicalSubject, ci.concept.canonicalName);
        if (!conceptId) { report.blocked.push({ identity: key, reason: `CANONICAL_CONCEPT_NOT_RESOLVED:${ci.concept.canonicalSubject}/${ci.concept.canonicalName}` }); continue; }
        const parsed = ApprovedItemContentSchema.safeParse(ci.content);
        if (!parsed.success || !examItemFromApproved({ id: key, learning_objective_id: target.objective_id, content: ci.content })) throw new Error(`BANK_CONTENT_IS_NOT_DELIVERABLE:${key}`);
        const hash = contentHash(ci.content);
        const heldItem = await one<{ id: string; lineage_class: string; provenance: string; current_hash: string | null; version_id: string | null; usage: string[] | null; lifecycle: string | null }>(c, `SELECT qi.id, qi.lineage_class, qi.provenance, ai.content_hash AS current_hash, ai.id AS version_id, ai.usage_eligibility AS usage, ai.bank_lifecycle_status AS lifecycle FROM question_bank_items qi LEFT JOIN approved_items ai ON ai.id = qi.current_version_id WHERE qi.learning_objective_id = $1 AND qi.item_key = $2`, [target.objective_id, key]);
        if (heldItem) {
          if (heldItem.lineage_class !== 'PILOT_CERTIFIED' || heldItem.provenance !== 'STUDYUS_GENERATED' || heldItem.current_hash !== hash) throw new Error(`PUBLICATION_CONFLICT: a bank item ${key} exists that is not this certified content`);
          // a governed full-length preparation mock authorisation widens the usage of the version in use (never its content)
          const missing = PILOT_USAGE.filter((u) => !(heldItem.usage ?? []).includes(u));
          if (missing.length > 0 && heldItem.lifecycle === 'ACTIVE' && heldItem.version_id) {
            await c.query(`UPDATE approved_items SET usage_eligibility = $2::text[] WHERE id = $1`, [heldItem.version_id, [...new Set([...(heldItem.usage ?? []), ...PILOT_USAGE])]]);
            await c.query(`INSERT INTO question_bank_lifecycle_events (bank_item_id, approved_item_id, from_status, to_status, reason, actor_kind, actor_user_id, run_id, detail) VALUES ($1, $2, 'ACTIVE', 'ACTIVE', 'USAGE_AUTHORIZED_BY_GOVERNANCE', 'SYSTEM', NULL, NULL, $3::jsonb)`,
              [heldItem.id, heldItem.version_id, JSON.stringify({ added: missing, decision: fullMockAuthorizationFor('PAA', PILOT_SCOPE)?.decisionId ?? null, scope: PILOT_SCOPE, itemKey: key })]);
            report.usageAuthorized = (report.usageAuthorized ?? 0) + 1;
          }
          report.itemsSkipped += 1; continue;
        }
        const lineage = { ...ci.lineage, policyVersion: PAA_PILOT_POLICY_VERSION, itemDigest: ci.itemDigest, stimulus: ci.item.stimulus };
        const item = await one<{ id: string }>(c,
          `INSERT INTO question_bank_items (item_key, exam_version_id, assessment_component_id, learning_objective_id, cell_key, provenance, language, lineage_class, generation_metadata)
           VALUES ($1, $2, $3, $4, $5, 'STUDYUS_GENERATED', $6, 'PILOT_CERTIFIED', $7::jsonb) RETURNING id`,
          [key, target.exam_version_id, target.component_id, target.objective_id, `${ci.component}|${ci.objectiveCode}|*|*-*|*`, ci.item.language, JSON.stringify(lineage)]);
        const fp = itemFingerprints(parsed.data);
        const validation = { kind: 'AUTOMATED_PILOT_CERTIFICATION', projection: PAA_PILOT_PROJECTION, policyVersion: PAA_PILOT_POLICY_VERSION, policyHash: PAA_PILOT_POLICY_HASH, decidedBy: PAA_PILOT_DECIDER, humanReviewers: 0, gates: ci.evidence, generation: ci.lineage };
        const version = await one<{ id: string }>(c,
          `INSERT INTO approved_items (learning_objective_id, question_type, content, created_by, status, published_at, content_origin, semantic_fingerprint, template_fingerprint, reasoning_fingerprint, stimulus_fingerprint,
                                       bank_item_id, version_number, bank_lifecycle_status, content_hash, target_difficulty, calibration_confidence, lifecycle_updated_at, usage_eligibility, exam_alignment, validation_report)
           VALUES ($1, $2, $3::jsonb, $4, 'APPROVED', NULL, 'GENERATED', $5, $6, $7, $8, $9, 1, 'VALIDATED', $10, $11, 'INSUFFICIENT_DATA', now(), $12::text[], 'MOCK_READY', $13::jsonb) RETURNING id`,
          [target.objective_id, ci.content.type, JSON.stringify(ci.content), author, fp.semantic, fp.template, fp.reasoning, fp.stimulus, item!.id, hash, ci.content.difficulty, [...PILOT_USAGE], JSON.stringify(validation)]);
        await c.query(`INSERT INTO question_bank_content_rights (content_type, content_id, source_access, reuse_rights, rights_holder, permitted_use, attribution_text, recorded_by) VALUES ('ITEM_VERSION', $1, 'NOT_APPLICABLE', 'STUDYUS_OWNED', 'StudyUs', $2, $3, $4)`,
          [version!.id, 'Delivery to Students within StudyUs in PILOT_PREVIEW only (PAA pilot certification policy).', `${ci.item.rights.category}: ${ci.item.rights.basis}`, author]);
        await c.query(`INSERT INTO question_bank_item_concepts (approved_item_id, canonical_concept_id, role, attributed_by) VALUES ($1, $2, 'PRIMARY', $3)`, [version!.id, conceptId, author]);
        await c.query(
          `INSERT INTO exam_bank_pilot_item_certifications (approved_item_id, bank_item_id, content_hash, item_digest, system_id, component_key, blueprint_bucket, stimulus_id, stimulus_version, policy_hash, certification_state, eligibility_scopes, rights_category, evidence, lineage, decided_by)
           VALUES ($1, $2, $3, $4, 'PAA', $5, $6, $7, $8, $9, 'AUTOMATED_CERTIFIED_PILOT', ARRAY['PILOT_PREVIEW'], $10, $11::jsonb, $12::jsonb, $13)`,
          [version!.id, item!.id, hash, ci.itemDigest, ci.component, ci.objectiveCode, ci.item.stimulus?.stimulusId ?? null, ci.item.stimulus?.version ?? null, PAA_PILOT_POLICY_HASH, ci.item.rights.category, JSON.stringify(ci.evidence), JSON.stringify(lineage), PAA_PILOT_DECIDER]);
        // the database decides here: without the certification above, of exactly this content, this UPDATE is refused
        await c.query(`UPDATE approved_items SET bank_lifecycle_status = 'ACTIVE', status = 'PUBLISHED', published_at = now() WHERE id = $1`, [version!.id]);
        await c.query(`UPDATE question_bank_items SET current_version_id = $2, updated_at = now() WHERE id = $1`, [item!.id, version!.id]);
        await c.query(`INSERT INTO question_bank_lifecycle_events (bank_item_id, approved_item_id, from_status, to_status, reason, actor_kind, actor_user_id, run_id, detail) VALUES ($1, $2, NULL, 'ACTIVE', 'PILOT_CERTIFIED_ITEM_PUBLISHED', 'SYSTEM', NULL, NULL, $3::jsonb)`,
          [item!.id, version!.id, JSON.stringify({ certification: 'AUTOMATED_CERTIFIED_PILOT', policy: PAA_PILOT_POLICY_VERSION, decidedBy: PAA_PILOT_DECIDER, itemDigest: ci.itemDigest, unitId: ci.lineage.unitId })]);
        report.itemsInserted += 1;
        report.byObjective[ci.objectiveCode] = (report.byObjective[ci.objectiveCode] ?? 0) + 1;
      }
    }
    // ---- what is true now, read back from the database
    const n = async (sql: string): Promise<number> => Number((await one<{ n: string }>(c, sql))!.n);
    const v = report.verification;
    v.pilotBankItems = await n(`SELECT count(*) AS n FROM question_bank_items WHERE lineage_class = 'PILOT_CERTIFIED'`);
    v.deliverableVersions = await n(`SELECT count(*) AS n FROM exam_bank_pilot_deliverable_versions`);
    v.pilotStimuli = await n(`SELECT count(*) AS n FROM exam_bank_pilot_stimuli`);
    v.activeWithoutACertification = await n(`SELECT count(*) AS n FROM question_bank_items qi JOIN approved_items ai ON ai.id = qi.current_version_id WHERE qi.lineage_class = 'PILOT_CERTIFIED' AND ai.bank_lifecycle_status = 'ACTIVE' AND NOT public.exam_bank_pilot_version_certified(qi.id, ai.id, ai.content_hash)`);
    v.certificationsAttributedToAPerson = await n(`SELECT count(*) AS n FROM exam_bank_pilot_item_certifications WHERE decided_by !~ '^policy:'`);
    v.humanReviewsWrittenForPilotItems = await n(`SELECT count(*) AS n FROM question_bank_reviews r JOIN approved_items ai ON ai.id = r.approved_item_id JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE qi.lineage_class = 'PILOT_CERTIFIED'`);
    v.withoutAnEstablishedRight = await n(`SELECT count(*) AS n FROM question_bank_items qi WHERE qi.lineage_class = 'PILOT_CERTIFIED' AND NOT EXISTS (SELECT 1 FROM question_bank_content_rights r WHERE r.content_type = 'ITEM_VERSION' AND r.content_id = qi.current_version_id AND r.superseded_at IS NULL AND r.reuse_rights = 'STUDYUS_OWNED')`);
    v.withoutTheirPrimaryConcept = await n(`SELECT count(*) AS n FROM question_bank_items qi WHERE qi.lineage_class = 'PILOT_CERTIFIED' AND (SELECT count(*) FROM question_bank_item_concepts ic WHERE ic.approved_item_id = qi.current_version_id AND ic.role = 'PRIMARY') <> 1`);
    v.stimulusLinkedItemsWithoutTheirStimulus = await n(`SELECT count(*) AS n FROM exam_bank_pilot_item_certifications c JOIN approved_items ai ON ai.id = c.approved_item_id WHERE c.stimulus_id IS NOT NULL AND (ai.content->'stimulus'->>'key') IS DISTINCT FROM (c.stimulus_id || '@' || c.stimulus_version)`);
    v.coreDerivedBankItems = await n(`SELECT count(*) AS n FROM question_bank_items WHERE lineage_class = 'CORE_DERIVED'`);
    for (const k of ['activeWithoutACertification', 'certificationsAttributedToAPerson', 'humanReviewsWrittenForPilotItems', 'withoutAnEstablishedRight', 'withoutTheirPrimaryConcept', 'stimulusLinkedItemsWithoutTheirStimulus']) if (v[k] !== 0) throw new Error(`PUBLICATION_REFUSED: ${k} = ${v[k]}`);
    if (opts.apply) { await c.query('COMMIT'); report.committed = true; } else await c.query('ROLLBACK');
    return report;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

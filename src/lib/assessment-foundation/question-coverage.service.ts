/**
 * B1 -- QuestionCoverage providers: one per physical store, behind one interface. Read-only.
 *
 *   ReviewedExamBankCoverageProvider   exam item -> learning objective -> objective <-> canonical concept
 *   LearningItemCacheCoverageProvider  learning question -> learner concept -> explicit canonical link
 *
 * Neither reads the other's tables and no item-to-item bridge exists or is created.
 */
import { db, type DbExecutor } from '@/lib/db';
import { resolveConceptIdentities } from '@/lib/catalog/concept-identity.service';
import type { ObjectiveConceptRelation } from '@/lib/curriculum/curriculum-scope';
import { coverageOfLearningCacheItem, coverageOfReviewedBankItem, REUSE_RIGHTS, type QuestionCoverage, type QuestionRef, type QuestionStore, type ReuseRights, type ReviewedBankItemRow, type RightsRecord } from './question-coverage';

export interface QuestionCoverageProvider {
  readonly store: QuestionStore;
  /** Coverage of the questions with these ids, in this store. Unknown ids are simply absent. */
  load(ids: readonly string[]): Promise<QuestionCoverage[]>;
}

const pgArray = (v: unknown): string[] | null => (Array.isArray(v) ? (v as string[]) : null);

type ContentCarrierFacts = Pick<ReviewedBankItemRow, 'itemConcepts' | 'itemRights' | 'stimulus' | 'assets' | 'curriculumTrace'>;

/**
 * Question Bank content-carrier facts of item versions: attribution, stimulus, assets and the rights of each
 * (migrations 20261110_1000..1500). Where that schema is not applied yet, no fact exists: every item is
 * unattributed and has no rights record, which is the truth there.
 */
async function loadContentCarrierFacts(ids: readonly string[], client: DbExecutor): Promise<Map<string, ContentCarrierFacts>> {
  const out = new Map<string, ContentCarrierFacts>();
  const ready = await client.query(`SELECT to_regclass('public.question_bank_content_rights') IS NOT NULL AND to_regclass('public.question_bank_item_concepts') IS NOT NULL AND to_regclass('public.question_bank_stimulus_reviews') IS NOT NULL AS ready`);
  if (ready.rows[0]?.ready !== true) return out;
  const [concepts, stimuli, assets] = await Promise.all([
    client.query(`SELECT approved_item_id, canonical_concept_id, role FROM question_bank_item_concepts WHERE approved_item_id = ANY($1::uuid[]) ORDER BY approved_item_id, role, canonical_concept_id`, [ids]),
    client.query(
      `SELECT s.approved_item_id, s.position, v.id AS stimulus_version_id, v.stimulus_id, v.lifecycle_status, (st.current_version_id = v.id) AS is_current, (st.retired_at IS NOT NULL) AS retired,
              st.kind, v.selection_min_items, v.selection_max_items,
              EXISTS (SELECT 1 FROM question_bank_stimulus_reviews r WHERE r.stimulus_version_id = v.id AND r.decision = 'APPROVED') AS approved
         FROM question_bank_item_stimulus s
         JOIN question_bank_stimulus_versions v ON v.id = s.stimulus_version_id
         JOIN question_bank_stimuli st ON st.id = v.stimulus_id
        WHERE s.approved_item_id = ANY($1::uuid[])`,
      [ids]
    ),
    client.query(
      `SELECT x.approved_item_id, a.id AS asset_id, a.lifecycle_status
         FROM (SELECT ia.approved_item_id, ia.asset_id FROM question_bank_item_assets ia WHERE ia.approved_item_id = ANY($1::uuid[])
               UNION
               SELECT s.approved_item_id, p.asset_id FROM question_bank_item_stimulus s JOIN question_bank_stimulus_parts p ON p.stimulus_version_id = s.stimulus_version_id
                WHERE s.approved_item_id = ANY($1::uuid[]) AND p.asset_id IS NOT NULL) x
         JOIN question_bank_assets a ON a.id = x.asset_id
        ORDER BY x.approved_item_id, a.id`,
      [ids]
    ),
  ]);
  const contentIds = [...new Set([...ids, ...stimuli.rows.map((r: any) => r.stimulus_version_id as string), ...assets.rows.map((r: any) => r.asset_id as string)])];
  // The database decides whether a record is in force on the day; this module reads the answer.
  const rights = await client.query(
    `SELECT content_type, content_id, source_access, reuse_rights,
            ((valid_from IS NULL OR valid_from <= current_date) AND (valid_to IS NULL OR valid_to >= current_date)) AS in_force
       FROM question_bank_content_rights WHERE superseded_at IS NULL AND content_id = ANY($1::uuid[])`,
    [contentIds]
  );
  const rightsOf = new Map<string, RightsRecord>();
  for (const r of rights.rows as any[]) {
    const reuse = (REUSE_RIGHTS as readonly string[]).includes(r.reuse_rights) ? (r.reuse_rights as ReuseRights) : 'UNKNOWN';
    rightsOf.set(`${r.content_type}:${r.content_id}`, { sourceAccess: r.source_access ?? null, reuseRights: reuse, inForce: r.in_force === true });
  }
  const factsOf = (id: string): ContentCarrierFacts => {
    let f = out.get(id);
    if (!f) out.set(id, (f = { itemConcepts: [], itemRights: rightsOf.get(`ITEM_VERSION:${id}`) ?? null, stimulus: null, assets: [] }));
    return f;
  };
  for (const id of ids) factsOf(id);
  for (const c of concepts.rows as any[]) factsOf(c.approved_item_id).itemConcepts!.push({ canonicalConceptId: c.canonical_concept_id, role: c.role });
  for (const s of stimuli.rows as any[]) {
    factsOf(s.approved_item_id).stimulus = {
      stimulusId: s.stimulus_id, stimulusVersionId: s.stimulus_version_id, position: Number(s.position), lifecycle: s.lifecycle_status,
      humanApproved: s.approved === true, isCurrentVersion: s.is_current === true, retired: s.retired === true,
      // The group rule is the stimulus version's own: both NULL = whole (the schema allows no half-declared range).
      kind: s.kind, selection: s.selection_min_items === null || s.selection_max_items === null ? null : { minItems: Number(s.selection_min_items), maxItems: Number(s.selection_max_items) },
      rights: rightsOf.get(`STIMULUS_VERSION:${s.stimulus_version_id}`) ?? null,
    };
  }
  for (const a of assets.rows as any[]) factsOf(a.approved_item_id).assets!.push({ assetId: a.asset_id, lifecycle: a.lifecycle_status, rights: rightsOf.get(`ASSET:${a.asset_id}`) ?? null });
  // Curriculum traceability (migration 20261111_1000). Where that table is not applied, no item is traced.
  const traceReady = await client.query(`SELECT to_regclass('public.question_bank_item_curriculum_nodes') IS NOT NULL AS ready`);
  if (traceReady.rows[0]?.ready === true) {
    const traces = await client.query(
      `SELECT l.approved_item_id, t.id AS node_id, t.node_type, t.status AS node_status, t.source AS node_source, t.structure_version_id, sv.status AS version_status,
              p.id AS parent_id, p.node_type AS parent_type, p.status AS parent_status, p.source AS parent_source,
              (t.structure_version_id = on_.structure_version_id) AS in_objective_version
         FROM question_bank_item_curriculum_nodes l
         JOIN structure_nodes t ON t.id = l.structure_node_id
         JOIN structure_versions sv ON sv.id = t.structure_version_id
         LEFT JOIN structure_nodes p ON p.id = t.parent_id
         JOIN approved_items ai ON ai.id = l.approved_item_id
         JOIN learning_objectives lo ON lo.id = ai.learning_objective_id
         JOIN structure_nodes on_ ON on_.id = lo.structure_node_id
        WHERE l.approved_item_id = ANY($1::uuid[])`,
      [ids]
    );
    for (const x of traces.rows as any[]) {
      factsOf(x.approved_item_id).curriculumTrace = {
        nodeId: x.node_id, nodeType: x.node_type, nodeStatus: x.node_status, nodeSource: x.node_source ?? null,
        parent: x.parent_id ? { nodeId: x.parent_id, nodeType: x.parent_type, status: x.parent_status, source: x.parent_source ?? null } : null,
        structureVersionId: x.structure_version_id, structureVersionStatus: x.version_status, inObjectiveStructureVersion: x.in_objective_version === true,
      };
    }
  }
  return out;
}

export function reviewedExamBankCoverageProvider(client: DbExecutor = db): QuestionCoverageProvider {
  return {
    store: 'REVIEWED_EXAM_BANK',
    async load(ids) {
      if (ids.length === 0) return [];
      const items = await client.query(
        `SELECT ai.id, ai.learning_objective_id, ai.question_type, ai.content, ai.status, ai.bank_lifecycle_status, ai.usage_eligibility, ai.exam_alignment,
                ai.calibration_confidence, ai.content_origin, ai.source_ids,
                qi.id AS bank_item_id, qi.provenance, qi.exam_version_id, qi.assessment_component_id, qi.current_version_id, (qi.retired_at IS NOT NULL) AS retired, qi.language,
                sv.id AS structure_version_id, sv.academic_subject_id,
                (SELECT count(*)::int FROM question_bank_reviews r WHERE r.approved_item_id = ai.id AND r.reviewed_by IS NOT NULL) AS review_count
           FROM approved_items ai
           LEFT JOIN question_bank_items qi ON qi.id = ai.bank_item_id
           LEFT JOIN learning_objectives lo ON lo.id = ai.learning_objective_id
           LEFT JOIN structure_nodes sn ON sn.id = lo.structure_node_id
           LEFT JOIN structure_versions sv ON sv.id = sn.structure_version_id
          WHERE ai.id = ANY($1::uuid[])`,
        [[...new Set(ids)]]
      );
      const objectiveIds = [...new Set(items.rows.map((r: any) => r.learning_objective_id as string).filter(Boolean))];
      const sourceIds = [...new Set(items.rows.flatMap((r: any) => pgArray(r.source_ids) ?? []))];
      const carrier = await loadContentCarrierFacts(items.rows.map((r: any) => r.id as string), client);
      const [mappings, sources] = await Promise.all([
        objectiveIds.length
          ? client.query(`SELECT learning_objective_id, canonical_concept_id, relation_type FROM objective_concept_mappings WHERE learning_objective_id = ANY($1::uuid[]) AND status = 'PUBLISHED' ORDER BY learning_objective_id, canonical_concept_id`, [objectiveIds])
          : Promise.resolve({ rows: [] as any[] }),
        sourceIds.length ? client.query(`SELECT id, license_status FROM assessment_sources WHERE id = ANY($1::uuid[])`, [sourceIds]) : Promise.resolve({ rows: [] as any[] }),
      ]);
      const conceptsByObjective = new Map<string, Array<{ canonicalConceptId: string; relationType: ObjectiveConceptRelation }>>();
      for (const m of mappings.rows) conceptsByObjective.set(m.learning_objective_id, [...(conceptsByObjective.get(m.learning_objective_id) ?? []), { canonicalConceptId: m.canonical_concept_id, relationType: m.relation_type }]);
      const licenceBySource = new Map<string, string>(sources.rows.map((s: any) => [s.id as string, s.license_status as string]));
      return items.rows.map((r: any) => {
        const itemSources = pgArray(r.source_ids);
        const row: ReviewedBankItemRow = {
          approvedItemId: r.id,
          learningObjectiveId: r.learning_objective_id,
          questionType: r.question_type ?? null,
          content: r.content ?? null,
          status: r.status,
          bankLifecycleStatus: r.bank_lifecycle_status ?? null,
          usageEligibility: pgArray(r.usage_eligibility),
          examAlignment: r.exam_alignment ?? null,
          calibrationConfidence: r.calibration_confidence ?? null,
          contentOrigin: r.content_origin ?? null,
          sourceIds: itemSources,
          bankItem: r.bank_item_id
            ? { provenance: r.provenance, examVersionId: r.exam_version_id ?? null, assessmentComponentId: r.assessment_component_id ?? null, currentVersionId: r.current_version_id ?? null, retired: r.retired === true, language: r.language ?? null }
            : null,
          sourceLicenses: (itemSources ?? []).map((id) => licenceBySource.get(id)).filter((x): x is string => !!x),
          humanReviewDecisions: r.review_count ?? 0,
          scope: r.structure_version_id ? { structureVersionId: r.structure_version_id, academicSubjectId: r.academic_subject_id } : null,
          objectiveConcepts: conceptsByObjective.get(r.learning_objective_id) ?? [],
          ...(carrier.get(r.id) ?? {}),
        };
        return coverageOfReviewedBankItem(row);
      });
    },
  };
}

export function learningItemCacheCoverageProvider(client: DbExecutor = db): QuestionCoverageProvider {
  return {
    store: 'LEARNING_ITEM_CACHE',
    async load(ids) {
      if (ids.length === 0) return [];
      const items = await client.query(
        `SELECT id, student_id, concept_id, activity_type, question_type, difficulty, language, validation_status FROM question_bank_candidates WHERE id = ANY($1::uuid[])`,
        [[...new Set(ids)]]
      );
      // Canonical resolution goes through the explicit learner-concept link only.
      const identities = await resolveConceptIdentities(items.rows.map((r: any) => r.concept_id as string), client);
      return items.rows.map((r: any) =>
        coverageOfLearningCacheItem({
          candidateId: r.id,
          studentId: r.student_id,
          learnerConceptId: r.concept_id,
          activityType: r.activity_type ?? null,
          questionType: r.question_type ?? null,
          difficulty: typeof r.difficulty === 'number' ? r.difficulty : r.difficulty === null || r.difficulty === undefined ? null : Number(r.difficulty),
          language: r.language ?? null,
          validationStatus: r.validation_status,
          identity: identities.get(r.concept_id) ?? null,
        })
      );
    },
  };
}

/** Coverage of questions from either store, through its own provider, in the order asked. */
export async function loadQuestionCoverage(refs: readonly QuestionRef[], providers: readonly QuestionCoverageProvider[] = [reviewedExamBankCoverageProvider(), learningItemCacheCoverageProvider()]): Promise<QuestionCoverage[]> {
  const byStore = new Map<QuestionStore, string[]>();
  for (const ref of refs) byStore.set(ref.store, [...(byStore.get(ref.store) ?? []), ref.id]);
  const loaded = new Map<string, QuestionCoverage>();
  await Promise.all(
    [...byStore.entries()].map(async ([store, ids]) => {
      const provider = providers.find((p) => p.store === store);
      if (!provider) return;
      for (const c of await provider.load(ids)) loaded.set(`${c.ref.store}:${c.ref.id}`, c);
    })
  );
  return refs.map((ref) => loaded.get(`${ref.store}:${ref.id}`)).filter((x): x is QuestionCoverage => !!x);
}

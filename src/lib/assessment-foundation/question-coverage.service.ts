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
import { coverageOfLearningCacheItem, coverageOfReviewedBankItem, type QuestionCoverage, type QuestionRef, type QuestionStore, type ReviewedBankItemRow } from './question-coverage';

export interface QuestionCoverageProvider {
  readonly store: QuestionStore;
  /** Coverage of the questions with these ids, in this store. Unknown ids are simply absent. */
  load(ids: readonly string[]): Promise<QuestionCoverage[]>;
}

const pgArray = (v: unknown): string[] | null => (Array.isArray(v) ? (v as string[]) : null);

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

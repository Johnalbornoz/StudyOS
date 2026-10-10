/**
 * B2 -- read-only loaders that feed the pure pipelines from the canonical authorities, and the two
 * student-facing / readiness entry points built on them.
 *
 * Nothing here writes: no evidence, no mastery, no attempt, no assessment. Nothing here is called by a
 * route or by an existing selector -- B2 certifies the engine; enabling it at runtime is a later decision.
 */
import { db, type DbExecutor } from '@/lib/db';
import { loadQuestionCoverage } from '@/lib/assessment-foundation/question-coverage.service';
import type { QuestionCoverage } from '@/lib/assessment-foundation/question-coverage';
import { loadStudentAssessmentContext } from '@/lib/assessment-foundation/student-assessment-context.service';
import type { IntentIssue } from '@/lib/assessment-foundation/student-assessment-context';
import type { ExposureFacts } from './solver/candidate';
import { projectEvidenceNeeds, type EvidenceCountPolicy, type LearnerConceptState } from './policy/evidence-requirement';
import { resolveLearningTargets, type LearningIntent } from './policy/learning';
import type { PracticeDepth } from './policy/practice-depth';
import { solveLearningBlueprint, type ExposureIndex } from './pipeline';
import type { BlueprintSolution } from './result';
import { evaluateFeasibility, type FeasibilityReport } from './readiness/feasibility';

/** B2_SELECTION_POLICY: a question delivered within this many days counts as recently seen. */
export const RECENT_EXPOSURE_DAYS = 14;

/** The canonical minimum evidence counts: the current `mastery_policies` row. */
export async function loadEvidenceCountPolicy(client: DbExecutor = db): Promise<EvidenceCountPolicy> {
  const r = await client.query(`SELECT version, minimum_evidence_count, minimum_independent_evidence_count FROM mastery_policies ORDER BY version DESC LIMIT 1`);
  const row = r.rows[0];
  if (!row) throw new Error('NO_MASTERY_POLICY');
  return { version: Number(row.version), minimumEvidenceCount: Number(row.minimum_evidence_count), minimumIndependentEvidenceCount: Number(row.minimum_independent_evidence_count) };
}

/**
 * Canonical Knowledge State of the Student's own instances of these canonical concepts. `instances` maps a
 * canonical concept to the learner concept linked to it by a CANONICAL link (the caller resolved identity).
 */
export async function loadLearnerConceptStates(studentId: string, instances: ReadonlyMap<string, string>, client: DbExecutor = db): Promise<LearnerConceptState[]> {
  const learnerIds = [...new Set(instances.values())];
  const rows = learnerIds.length
    ? (await client.query(`SELECT concept_id, mastery_state, validation_readiness, evidence_count, independent_evidence_count, next_review_at FROM concept_knowledge_state WHERE student_id = $1 AND concept_id = ANY($2::uuid[])`, [studentId, learnerIds])).rows
    : [];
  const byLearner = new Map<string, any>(rows.map((r: any) => [r.concept_id, r]));
  return [...instances.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([canonicalConceptId, learnerConceptId]) => {
      const r = byLearner.get(learnerConceptId);
      return {
        canonicalConceptId,
        learnerConceptId,
        masteryState: r?.mastery_state ?? null,
        validationReadiness: r?.validation_readiness ?? null,
        evidenceCount: r ? Number(r.evidence_count) : null,
        independentEvidenceCount: r ? Number(r.independent_evidence_count) : null,
        nextReviewAt: r?.next_review_at ? (r.next_review_at instanceof Date ? r.next_review_at.toISOString() : String(r.next_review_at)) : null,
      };
    });
}

/** The Student's own validated cached questions for these learner concepts, with their exposure as of `asOf`. */
export async function loadLearningCandidates(studentId: string, learnerConceptIds: readonly string[], asOf: string, client: DbExecutor = db): Promise<{ coverages: QuestionCoverage[]; exposure: ExposureIndex }> {
  if (learnerConceptIds.length === 0) return { coverages: [], exposure: new Map() };
  const r = await client.query(
    `SELECT id, usage_count, last_used_at FROM question_bank_candidates WHERE student_id = $1 AND concept_id = ANY($2::uuid[]) AND validation_status = 'VALIDATED' ORDER BY id`,
    [studentId, [...new Set(learnerConceptIds)]]
  );
  const recentFrom = new Date(new Date(asOf).getTime() - RECENT_EXPOSURE_DAYS * 86_400_000).toISOString();
  const exposure = new Map<string, ExposureFacts>();
  for (const row of r.rows) {
    const last = row.last_used_at ? (row.last_used_at instanceof Date ? row.last_used_at.toISOString() : String(row.last_used_at)) : null;
    const seen = Number(row.usage_count ?? 0) > 0 || last !== null;
    if (seen) exposure.set(`LEARNING_ITEM_CACHE:${row.id}`, { seen: true, recent: last !== null && last >= recentFrom });
  }
  const coverages = await loadQuestionCoverage(r.rows.map((row: any) => ({ store: 'LEARNING_ITEM_CACHE' as const, id: row.id as string })));
  return { coverages, exposure };
}

export interface LearningSelectionRequest {
  intent: LearningIntent;
  depth: PracticeDepth;
  canonicalConceptIds?: readonly string[];
  learnerConceptIds?: readonly string[];
  availableMinutes?: number | null;
  /** Explicit "now". The pipeline never reads a clock. */
  asOf: string;
}

export type LearningSelection = { ok: true; solution: BlueprintSolution } | { ok: false; issues: IntentIssue[] };

/**
 * A LEARNING blueprint for a Student, end to end and read-only: context -> canonical targets -> evidence
 * needs -> the Student's eligible questions -> solver. It creates no session and delivers nothing.
 */
export async function solveLearningForStudent(studentId: string, request: LearningSelectionRequest): Promise<LearningSelection> {
  const loaded = await loadStudentAssessmentContext(studentId, { family: 'LEARNING', purpose: request.intent === 'DIAGNOSTIC' ? 'DIAGNOSTIC' : request.intent === 'MASTERY_CHECK' ? 'PROVE' : request.intent === 'RETENTION_CHECK' ? 'RETAIN' : 'PRACTICE' });
  if (!loaded.ok) return loaded;
  const context = loaded.context;
  const { canonicalConceptIds, unresolved } = resolveLearningTargets(context, request);
  // The Student's own instance of each canonical target, through a CANONICAL link only.
  const instances = new Map<string, string>();
  for (const c of context.learnerState.concepts) if (c.status === 'CANONICAL' && canonicalConceptIds.includes(c.canonicalConceptId) && !instances.has(c.canonicalConceptId)) instances.set(c.canonicalConceptId, c.learnerConceptId);
  const [policy, states, pool] = await Promise.all([loadEvidenceCountPolicy(), loadLearnerConceptStates(studentId, instances), loadLearningCandidates(studentId, [...instances.values()], request.asOf)]);
  const needs = projectEvidenceNeeds(canonicalConceptIds, states, policy, request.asOf);
  const solution = solveLearningBlueprint({
    policy: { studentId, intent: request.intent, depth: request.depth, canonicalConceptIds, needs, unresolved, curriculum: context.curriculum.map(({ structureVersionId, academicSubjectId }) => ({ structureVersionId, academicSubjectId })), availableMinutes: request.availableMinutes ?? null },
    coverages: pool.coverages,
    exposure: pool.exposure,
    asOf: request.asOf,
  });
  return { ok: true, solution };
}

/**
 * Readiness of the reviewed bank for one exam version, by learning objective (what Q1 can read). Generic:
 * no Student, no selection, no write.
 */
export async function evaluateExamVersionReadiness(examVersionId: string, client: DbExecutor = db): Promise<FeasibilityReport> {
  const [objectives, items, policy] = await Promise.all([
    client.query(`SELECT DISTINCT t.learning_objective_id FROM blueprint_objective_targets t JOIN assessment_blueprints b ON b.id = t.blueprint_id WHERE b.exam_version_id = $1 ORDER BY 1`, [examVersionId]),
    client.query(`SELECT ai.id FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE qi.exam_version_id = $1 AND qi.current_version_id = ai.id ORDER BY ai.id`, [examVersionId]),
    loadEvidenceCountPolicy(client),
  ]);
  const coverages = await loadQuestionCoverage(items.rows.map((r: any) => ({ store: 'REVIEWED_EXAM_BANK' as const, id: r.id as string })));
  return evaluateFeasibility({ kind: 'OBJECTIVE', targetIds: objectives.rows.map((r: any) => r.learning_objective_id as string), coverages, eligibility: { family: 'EXAM_PREPARATION', examVersionId }, evidencePolicy: policy });
}

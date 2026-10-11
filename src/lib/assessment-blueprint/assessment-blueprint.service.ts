/**
 * B2 -- read-only loaders that feed the pure pipelines from the canonical authorities, and the two
 * student-facing / readiness entry points built on them.
 *
 * Nothing here writes: no evidence, no mastery, no attempt, no assessment. Nothing here is called by a
 * route or by an existing selector -- B2 certifies the engine; enabling it at runtime is a later decision.
 */
import { db, type DbExecutor } from '@/lib/db';
import { loadQuestionCoverage, reviewedExamBankCoverageProvider } from '@/lib/assessment-foundation/question-coverage.service';
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
import { LOGICAL_POOLS, type LogicalPool, type PoolAssignments } from './protected/pools';
import type { ProtectedSelectionFacts } from './protected/protected-runtime';

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
    client.query(`SELECT DISTINCT t.learning_objective_id FROM blueprint_objective_targets t JOIN assessment_blueprints b ON b.id = t.blueprint_id WHERE b.exam_version_id = $1 AND b.purpose IS NULL ORDER BY 1`, [examVersionId]),
    client.query(`SELECT ai.id FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE qi.exam_version_id = $1 AND qi.current_version_id = ai.id ORDER BY ai.id`, [examVersionId]),
    loadEvidenceCountPolicy(client),
  ]);
  const coverages = await loadQuestionCoverage(items.rows.map((r: any) => ({ store: 'REVIEWED_EXAM_BANK' as const, id: r.id as string })));
  return evaluateFeasibility({ kind: 'OBJECTIVE', targetIds: objectives.rows.map((r: any) => r.learning_objective_id as string), coverages, eligibility: { family: 'EXAM_PREPARATION', examVersionId }, evidencePolicy: policy });
}

/**
 * B2-A -- the Student's item-level exposure in the reviewed bank, from the existing delivery ledger
 * (`exam_item_usage`), keyed like every other exposure index. Delivery of ANY version of a bank item
 * exposes the item, so the current version is reported as seen too. Read-only.
 *
 * Answer reveal is not recorded anywhere, so `answerRevealed` is not set (ANSWER_REVEAL_EXPOSURE = DEFERRED).
 */
export async function loadReviewedBankExposure(studentId: string, asOf: string, client: DbExecutor = db): Promise<ExposureIndex> {
  const recentFrom = new Date(new Date(asOf).getTime() - RECENT_EXPOSURE_DAYS * 86_400_000).toISOString();
  const r = await client.query(
    `SELECT COALESCE(sibling.id, seen.id) AS id, MAX(u.used_at) AS last_used_at
       FROM exam_item_usage u
       JOIN approved_items seen ON seen.id = u.approved_item_id
       LEFT JOIN approved_items sibling ON sibling.bank_item_id = seen.bank_item_id
      WHERE u.student_id = $1 AND u.used_at <= $2
      GROUP BY 1 ORDER BY 1`,
    [studentId, asOf]
  );
  const exposure = new Map<string, ExposureFacts>();
  for (const row of r.rows as Array<{ id: string; last_used_at: Date | string | null }>) {
    const last = row.last_used_at === null ? null : new Date(row.last_used_at).toISOString();
    exposure.set(`REVIEWED_EXAM_BANK:${row.id}`, { seen: true, recent: last !== null && last >= recentFrom });
  }
  return exposure;
}

/**
 * Pool membership of the current item versions of an exam version, as the Question Bank recorded it
 * (`question_bank_pool_memberships`). An item bound to a stimulus is in its stimulus's pool; a standalone
 * item is in its own. An item with no active membership is simply absent: it is in no pool, and a protected
 * form cannot use it. Where the pool schema is not applied yet, nothing has a pool.
 */
export async function loadReviewedBankPoolAssignments(examVersionId: string, client: DbExecutor = db): Promise<PoolAssignments> {
  const out = new Map<string, LogicalPool[]>();
  const ready = await client.query(`SELECT to_regclass('public.question_bank_pool_memberships') IS NOT NULL AND to_regclass('public.question_bank_item_stimulus') IS NOT NULL AS ready`);
  if (ready.rows[0]?.ready !== true) return out;
  const r = await client.query(
    `SELECT qi.current_version_id AS id, m.pool
       FROM question_bank_items qi
       LEFT JOIN question_bank_item_stimulus s ON s.approved_item_id = qi.current_version_id
       LEFT JOIN question_bank_stimulus_versions v ON v.id = s.stimulus_version_id
       JOIN question_bank_pool_memberships m
         ON m.retired_at IS NULL AND ((s.approved_item_id IS NULL AND m.bank_item_id = qi.id) OR (s.approved_item_id IS NOT NULL AND m.stimulus_id = v.stimulus_id))
      WHERE qi.exam_version_id = $1 AND qi.current_version_id IS NOT NULL
      ORDER BY 1, 2`,
    [examVersionId]
  );
  for (const row of r.rows as Array<{ id: string; pool: string }>) {
    if (!(LOGICAL_POOLS as readonly string[]).includes(row.pool)) continue;
    const key = `REVIEWED_EXAM_BANK:${row.id}`;
    out.set(key, [...(out.get(key) ?? []), row.pool as LogicalPool]);
  }
  return out;
}

/**
 * B2-B2 -- the stimuli a Student has met, from the same delivery ledger. A stimulus is exposed when ANY
 * version of ANY question ever asked about ANY of its versions was delivered to the Student -- including a
 * question that is no longer a member of the group. Reported as stimulus ids and as every version of those
 * stimuli (a frozen form records a version). Read-only; where the stimulus schema is absent nothing is exposed.
 */
export async function loadReviewedBankStimulusExposure(studentId: string, asOf: string, client: DbExecutor = db): Promise<ProtectedSelectionFacts['exposedStimuli']> {
  const out = { stimulusIds: new Set<string>(), stimulusVersionIds: new Set<string>() };
  const ready = await client.query(`SELECT to_regclass('public.question_bank_item_stimulus') IS NOT NULL AS ready`);
  if (ready.rows[0]?.ready !== true) return out;
  const r = await client.query(
    `SELECT DISTINCT v.stimulus_id, every_version.id AS stimulus_version_id
       FROM exam_item_usage u
       JOIN approved_items seen ON seen.id = u.approved_item_id
       JOIN approved_items sibling ON sibling.id = seen.id OR (seen.bank_item_id IS NOT NULL AND sibling.bank_item_id = seen.bank_item_id)
       JOIN question_bank_item_stimulus s ON s.approved_item_id = sibling.id
       JOIN question_bank_stimulus_versions v ON v.id = s.stimulus_version_id
       JOIN question_bank_stimulus_versions every_version ON every_version.stimulus_id = v.stimulus_id
      WHERE u.student_id = $1 AND u.used_at <= $2
      ORDER BY 1, 2`,
    [studentId, asOf]
  );
  for (const row of r.rows as Array<{ stimulus_id: string; stimulus_version_id: string }>) {
    out.stimulusIds.add(row.stimulus_id);
    out.stimulusVersionIds.add(row.stimulus_version_id);
  }
  return out;
}

/**
 * B2-B2 -- the ONE read-only entry point of a protected selection: everything the pure selector needs about
 * an exam version's reviewed bank (coverage with attribution / stimulus / rights, pool membership) and,
 * when a Student is named, their exposure (items and stimuli) as of `asOf`.
 *
 * `studentId: null` = a fixed-form assembly: no exposure is read. Nothing is selected or written here, and
 * no route calls it.
 */
export async function loadProtectedSelectionInputs(examVersionId: string, studentId: string | null, asOf: string, client: DbExecutor = db): Promise<ProtectedSelectionFacts> {
  const items = await client.query(`SELECT ai.id FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE qi.exam_version_id = $1 AND qi.current_version_id = ai.id ORDER BY ai.id`, [examVersionId]);
  const [coverages, poolAssignments, exposure, exposedStimuli] = await Promise.all([
    loadQuestionCoverage(items.rows.map((r: any) => ({ store: 'REVIEWED_EXAM_BANK' as const, id: r.id as string })), [reviewedExamBankCoverageProvider(client)]),
    loadReviewedBankPoolAssignments(examVersionId, client),
    studentId === null ? Promise.resolve<ExposureIndex>(new Map()) : loadReviewedBankExposure(studentId, asOf, client),
    studentId === null ? Promise.resolve({ stimulusIds: new Set<string>(), stimulusVersionIds: new Set<string>() }) : loadReviewedBankStimulusExposure(studentId, asOf, client),
  ]);
  return { examVersionId, coverages, poolAssignments, exposure, exposedStimuli };
}

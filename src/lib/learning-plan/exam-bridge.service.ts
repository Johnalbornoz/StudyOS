/**
 * Track A -- Exam → Learning Plan bridge.
 *
 *   completed exam attempt → per-objective result → GAP
 *     → learning objective → canonical concepts (PUBLISHED FULL/PARTIAL mappings)
 *     → learning_recommendations (EXAM_GAP, one per student + concept)
 *     → the learner accepts → Personal Plan (source EXAM_GAP) → normal engine
 *
 * Gap sources (read-only):
 *  - this branch's exam attempts: exam_attempt_item_responses aggregated per
 *    learning objective (earned / available below EXAM_GAP_THRESHOLD);
 *  - when present in the database, the exam track's scored results
 *    (exam_attempt_results.objective_results with classification GAP).
 *
 * A recommendation never enrolls anything by itself; accepting it reuses the
 * learner's existing concept when there is one (no duplicate, progress kept).
 */
import { fixtureResponseSql, technicalExamAttemptSql } from '@/lib/exam-core/audience';
import { db } from '@/lib/db';
import { canonicalConceptLabels } from './labels';
import { enrollCanonicalConcept, planIndex } from './personal-plan.service';
import { getCanonicalPedagogicalDecision } from '@/lib/pedagogical-decision/canonical-decision.service';
import type { PedagogicalStage } from '@/lib/pedagogical-engine/types';
import { resolveExamProfiles, type ExamMappingStatus } from './exam-profile-resolution';

/** An objective scored below this share of its available points is a gap (policy constant, documented). */
export const EXAM_GAP_THRESHOLD = 0.5;

export interface ExamGap {
  studentId: string;
  canonicalConceptId: string;
  /** G6: the exam target (student_exam_profiles.id) whose attempt showed the gap. */
  examProfileId: string;
  examAttemptId: string;
  learningObjectiveId: string;
  fraction: number;
  at: string;
}

const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v));

/**
 * Read-only: current exam gaps of these learners, one (latest) per learner + canonical concept.
 *
 * G6: a gap belongs to the exam TARGET whose attempt showed it. "Latest result per objective" is decided
 * within one target, so another exam (or another target of the same exam) can neither close nor open this
 * target's gap through a shared objective or concept. With `examProfileId`, only that target's attempts are
 * read (an exam-specific reader); without it, every target's gaps are returned, each still tagged with its
 * target (concept-level learning recommendations, teacher / institution views).
 */
export async function deriveExamGaps(studentIds: string[], canonicalConceptIds?: string[] | null, opts: { examProfileId?: string } = {}): Promise<ExamGap[]> {
  if (studentIds.length === 0) return [];
  const targetFilter = opts.examProfileId ?? null;
  const objectiveRows: Array<{ student_id: string; exam_profile_id: string; exam_attempt_id: string; learning_objective_id: string; fraction: number; at: any }> = [];
  const own = await db.query(
    `SELECT sep.student_id, sep.id AS exam_profile_id, ea.id AS exam_attempt_id, r.learning_objective_id, SUM(r.score)::float / NULLIF(SUM(r.max_score), 0) AS fraction, ea.completed_at AS at
     FROM exam_attempts ea
     JOIN student_exam_profiles sep ON sep.id = ea.student_exam_profile_id
     JOIN exam_attempt_item_responses r ON r.exam_attempt_id = ea.id
     WHERE sep.student_id = ANY($1::uuid[]) AND ea.status = 'COMPLETED' AND r.learning_objective_id IS NOT NULL AND r.max_score > 0
       AND ($2::uuid IS NULL OR ea.student_exam_profile_id = $2::uuid)
       AND NOT ${fixtureResponseSql('r')} AND NOT ${technicalExamAttemptSql('ea.id')}
     GROUP BY sep.student_id, sep.id, ea.id, r.learning_objective_id, ea.completed_at`,
    [studentIds, targetFilter]
  );
  objectiveRows.push(...own.rows);
  const hasResults = await db.query(`SELECT to_regclass('public.exam_attempt_results') IS NOT NULL AS present`);
  if (hasResults.rows[0]?.present) {
    const scored = await db.query(
      `SELECT ear.student_id, ea.student_exam_profile_id AS exam_profile_id, ear.exam_attempt_id, (o->>'learningObjectiveId')::uuid AS learning_objective_id, COALESCE((o->>'fraction')::float, 0) AS fraction, ear.scored_at AS at
       FROM exam_attempt_results ear JOIN exam_attempts ea ON ea.id = ear.exam_attempt_id, jsonb_array_elements(COALESCE(ear.objective_results, '[]'::jsonb)) o
       WHERE ear.student_id = ANY($1::uuid[]) AND ear.invalidated_at IS NULL AND o->>'classification' = 'GAP' AND o ? 'learningObjectiveId'
         AND ($2::uuid IS NULL OR ea.student_exam_profile_id = $2::uuid)
         AND NOT ${technicalExamAttemptSql('ear.exam_attempt_id')}`,
      [studentIds, targetFilter]
    ).catch(() => ({ rows: [] as any[] }));
    objectiveRows.push(...scored.rows.map((r: any) => ({ ...r, fraction: Math.min(Number(r.fraction), EXAM_GAP_THRESHOLD - 0.0001) })));
  }
  // Only the LATEST result per learner × target × objective counts: an objective failed
  // once and passed in a later attempt OF THE SAME TARGET is no longer a gap (G6).
  const latestByObjective = new Map<string, (typeof objectiveRows)[number]>();
  for (const r of objectiveRows) {
    if (r.fraction === null) continue;
    const k = `${r.student_id}:${r.exam_profile_id}:${r.learning_objective_id}`;
    const prior = latestByObjective.get(k);
    if (!prior || iso(prior.at) < iso(r.at) || (iso(prior.at) === iso(r.at) && Number(r.fraction) < Number(prior.fraction))) latestByObjective.set(k, r);
  }
  const gaps = [...latestByObjective.values()].filter((r) => Number(r.fraction) < EXAM_GAP_THRESHOLD);
  if (gaps.length === 0) return [];
  const mappings = await db.query(
    `SELECT learning_objective_id, canonical_concept_id FROM objective_concept_mappings
     WHERE status = 'PUBLISHED' AND relation_type IN ('FULL', 'PARTIAL') AND learning_objective_id = ANY($1::uuid[])`,
    [[...new Set(gaps.map((g) => g.learning_objective_id))]]
  );
  const conceptsByObjective = new Map<string, string[]>();
  for (const m of mappings.rows) conceptsByObjective.set(m.learning_objective_id, [...(conceptsByObjective.get(m.learning_objective_id) ?? []), m.canonical_concept_id]);
  const latest = new Map<string, ExamGap>();
  for (const g of gaps) {
    for (const conceptId of conceptsByObjective.get(g.learning_objective_id) ?? []) {
      if (canonicalConceptIds && !canonicalConceptIds.includes(conceptId)) continue;
      const k = `${g.student_id}:${conceptId}`;
      const candidate: ExamGap = { studentId: g.student_id, canonicalConceptId: conceptId, examProfileId: g.exam_profile_id, examAttemptId: g.exam_attempt_id, learningObjectiveId: g.learning_objective_id, fraction: Number(g.fraction), at: iso(g.at) };
      const prior = latest.get(k);
      if (!prior || prior.at < candidate.at) latest.set(k, candidate);
    }
  }
  return [...latest.values()];
}

/** Persist the learner's exam gaps as recommendations. Idempotent: a repeated gap updates the same row. */
export async function refreshExamGapRecommendations(studentId: string): Promise<number> {
  const gaps = await deriveExamGaps([studentId]);
  let created = 0;
  for (const g of gaps) {
    const r = await db.query(
      `INSERT INTO learning_recommendations (student_id, canonical_concept_id, recommendation_type, source_key, exam_attempt_id, learning_objective_id, reason)
       VALUES ($1, $2, 'EXAM_GAP', '', $3, $4, $5)
       ON CONFLICT (student_id, canonical_concept_id, recommendation_type, source_key) DO UPDATE
         SET last_seen_at = now(),
             -- a dismissed gap comes back only when a LATER attempt shows it again
             status = CASE WHEN learning_recommendations.status = 'DISMISSED' AND learning_recommendations.exam_attempt_id IS DISTINCT FROM EXCLUDED.exam_attempt_id THEN 'OPEN' ELSE learning_recommendations.status END,
             exam_attempt_id = EXCLUDED.exam_attempt_id, learning_objective_id = EXCLUDED.learning_objective_id, reason = EXCLUDED.reason
       RETURNING (xmax = 0) AS inserted`,
      [studentId, g.canonicalConceptId, g.examAttemptId, g.learningObjectiveId, JSON.stringify({ fraction: g.fraction, at: g.at })]
    );
    if (r.rows[0]?.inserted) {
      created += 1;
      await db.query(
        `INSERT INTO student_plan_events (student_id, canonical_concept_id, event_type, source_type, source_key, detail) VALUES ($1, $2, 'RECOMMENDED', 'EXAM_GAP', $3, $4)`,
        [studentId, g.canonicalConceptId, g.examAttemptId, JSON.stringify({ learningObjectiveId: g.learningObjectiveId, fraction: g.fraction })]
      );
    }
  }
  return created;
}

export interface ExamRecommendation {
  id: string;
  canonicalConceptId: string;
  label: string;
  examAttemptId: string | null;
  fraction: number | null;
  inPlan: boolean;
  learnerConceptId: string | null;
}

export async function listOpenExamRecommendations(studentId: string, locale: string): Promise<ExamRecommendation[]> {
  const r = await db.query(
    `SELECT id, canonical_concept_id, exam_attempt_id, reason FROM learning_recommendations WHERE student_id = $1 AND status = 'OPEN' AND recommendation_type = 'EXAM_GAP' ORDER BY last_seen_at DESC`,
    [studentId]
  );
  const [labels, plan] = await Promise.all([canonicalConceptLabels(r.rows.map((x: any) => x.canonical_concept_id), locale), planIndex(studentId)]);
  return r.rows.map((x: any) => {
    const entry = plan.get(x.canonical_concept_id);
    return {
      id: x.id,
      canonicalConceptId: x.canonical_concept_id,
      label: labels.get(x.canonical_concept_id) ?? '',
      examAttemptId: x.exam_attempt_id,
      fraction: typeof x.reason?.fraction === 'number' ? x.reason.fraction : null,
      inPlan: Boolean(entry && entry.planStatus === 'IN_PLAN'),
      learnerConceptId: entry?.learnerConceptId ?? null,
    };
  });
}

export class RecommendationError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'NOT_OPEN') {
    super(code);
    this.name = 'RecommendationError';
  }
}

/**
 * The learner accepts an exam recommendation: EXAM_GAP source added to the
 * ONE plan entry (created only if the concept was never in the plan). Returns
 * the learner concept to launch the normal Learning Engine on.
 */
export async function acceptExamRecommendation(studentId: string, recommendationId: string, actorUserId: string | null): Promise<{ learnerConceptId: string; alreadyInPlan: boolean }> {
  const r = await db.query(`SELECT id, canonical_concept_id, exam_attempt_id, status FROM learning_recommendations WHERE id = $1 AND student_id = $2`, [recommendationId, studentId]);
  const rec = r.rows[0];
  if (!rec) throw new RecommendationError('NOT_FOUND');
  const before = (await planIndex(studentId)).get(rec.canonical_concept_id);
  const enrolled = await enrollCanonicalConcept(studentId, rec.canonical_concept_id, {
    type: 'EXAM_GAP',
    key: rec.exam_attempt_id ?? '',
    examAttemptId: rec.exam_attempt_id,
    actorUserId,
  });
  if (rec.status === 'OPEN') {
    await db.query(`UPDATE learning_recommendations SET status = 'ACCEPTED', accepted_at = now() WHERE id = $1`, [rec.id]);
    await db.query(
      `INSERT INTO student_plan_events (student_id, canonical_concept_id, event_type, source_type, source_key, actor_user_id) VALUES ($1, $2, 'RECOMMENDATION_ACCEPTED', 'EXAM_GAP', $3, $4)`,
      [studentId, rec.canonical_concept_id, rec.exam_attempt_id ?? '', actorUserId]
    );
  }
  return { learnerConceptId: enrolled.learnerConceptId, alreadyInPlan: Boolean(before && before.planStatus === 'IN_PLAN') };
}

export async function dismissExamRecommendation(studentId: string, recommendationId: string, actorUserId: string | null): Promise<boolean> {
  const r = await db.query(
    `UPDATE learning_recommendations SET status = 'DISMISSED', dismissed_at = now() WHERE id = $1 AND student_id = $2 AND status = 'OPEN' RETURNING canonical_concept_id`,
    [recommendationId, studentId]
  );
  if (!r.rows[0]) return false;
  await db.query(
    `INSERT INTO student_plan_events (student_id, canonical_concept_id, event_type, source_type, actor_user_id) VALUES ($1, $2, 'RECOMMENDATION_DISMISSED', 'EXAM_GAP', $3)`,
    [studentId, r.rows[0].canonical_concept_id, actorUserId]
  );
  return true;
}

// ---------------------------------------------------------------------------
// Exam Preparation Plan
// ---------------------------------------------------------------------------

export type ExamPrepConceptStatus = 'NEEDS_REINFORCEMENT' | 'NOT_STARTED' | 'IN_PROGRESS' | 'CONSOLIDATED';

export interface ExamPrepConcept {
  canonicalConceptId: string;
  label: string;
  stage: PedagogicalStage | null;
  status: ExamPrepConceptStatus;
  inPlan: boolean;
  learnerConceptId: string | null;
  recommendationId: string | null;
  skills: string[];
}

export interface ExamPreparationPlan {
  examName: string;
  versionLabel: string | null;
  readiness: string | null;
  areas: Array<{ label: string; concepts: ExamPrepConcept[] }>;
  unmappedObjectives: number;
  /** Objective-first profiles resolve through the governed objective; no resolvable exam structure = MAPPING_NOT_AVAILABLE (never dropped). */
  mappingStatus: ExamMappingStatus;
}

export class ExamPlanError extends Error {
  constructor(public readonly code: 'NOT_FOUND') {
    super(code);
    this.name = 'ExamPlanError';
  }
}

/** Pure: the preparation status of one concept. */
export function examPrepStatus(stage: PedagogicalStage | null, inPlan: boolean, hasGap: boolean): ExamPrepConceptStatus {
  if (hasGap) return 'NEEDS_REINFORCEMENT';
  if (!inPlan || stage === null) return 'NOT_STARTED';
  if (stage === 'CONSOLIDATED' || stage === 'RETAIN' || stage === 'TRANSFER') return 'CONSOLIDATED';
  return 'IN_PROGRESS';
}

/** Blueprint × learner model for ONE of the learner's own exam profiles (ownership checked here). */
export async function getExamPreparationPlan(studentId: string, examProfileId: string, locale: string): Promise<ExamPreparationPlan> {
  // R1: definition-based AND objective-first profiles (exam_definition_id may be NULL since Track B 20261025).
  const row = (await db.query(
    `SELECT id, exam_definition_id, exam_version_id, objective_key, objective_context FROM student_exam_profiles WHERE id = $1 AND student_id = $2`,
    [examProfileId, studentId]
  )).rows[0];
  if (!row) throw new ExamPlanError('NOT_FOUND');
  const resolved = (await resolveExamProfiles([
    { id: row.id, examDefinitionId: row.exam_definition_id, examVersionId: row.exam_version_id, objectiveKey: row.objective_key, objectiveContext: row.objective_context },
  ])).get(row.id)!;
  const p = { exam_name: resolved.name, exam_version_ids: resolved.versionIds };
  const [version, targets, readiness] = await Promise.all([
    db.query(`SELECT COALESCE(version_label, curriculum_version, syllabus_code) AS label FROM exam_versions WHERE id = ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 1`, [p.exam_version_ids]),
    db.query(
      `SELECT bot.learning_objective_id, COALESCE(ac.name, ac.section_key, '') AS area, ocm.canonical_concept_id, sk.name AS skill
       FROM assessment_blueprints b
       JOIN blueprint_objective_targets bot ON bot.blueprint_id = b.id
       LEFT JOIN assessment_components ac ON ac.id = bot.assessment_component_id
       LEFT JOIN objective_concept_mappings ocm ON ocm.learning_objective_id = bot.learning_objective_id AND ocm.status = 'PUBLISHED' AND ocm.relation_type IN ('FULL', 'PARTIAL')
       LEFT JOIN skills sk ON sk.id = bot.skill_id
       WHERE b.exam_version_id = ANY($1::uuid[])
       ORDER BY ac.sequence_order NULLS LAST, ac.name`,
      [p.exam_version_ids]
    ),
    db.query(`SELECT overall_status FROM readiness_snapshots WHERE student_id = $1 AND exam_profile_id = $2 ORDER BY calculated_at DESC LIMIT 1`, [studentId, examProfileId]).catch(() => ({ rows: [] as any[] })),
  ]);
  const conceptIds = [...new Set(targets.rows.map((t: any) => t.canonical_concept_id).filter(Boolean))] as string[];
  const [labels, plan, gaps, recs] = await Promise.all([
    canonicalConceptLabels(conceptIds, locale),
    planIndex(studentId),
    // G6: this preparation's gaps come only from this target's own attempts.
    deriveExamGaps([studentId], conceptIds, { examProfileId }),
    db.query(`SELECT id, canonical_concept_id FROM learning_recommendations WHERE student_id = $1 AND status = 'OPEN'`, [studentId]),
  ]);
  const gapIds = new Set(gaps.map((g) => g.canonicalConceptId));
  const recByConcept = new Map<string, string>(recs.rows.map((r: any) => [r.canonical_concept_id, r.id]));
  const stages = new Map<string, PedagogicalStage | null>();
  await Promise.all(
    conceptIds.map(async (id) => {
      const entry = plan.get(id);
      if (!entry) return;
      const decision = await getCanonicalPedagogicalDecision({ studentId, conceptId: entry.learnerConceptId }).then((r) => r.decision).catch(() => null);
      stages.set(id, decision?.stage ?? null);
    })
  );
  const areas: ExamPreparationPlan['areas'] = [];
  const placed = new Set<string>();
  let unmapped = 0;
  for (const t of targets.rows) {
    if (!t.canonical_concept_id) {
      unmapped += 1;
      continue;
    }
    let area = areas.find((a) => a.label === t.area);
    if (!area) {
      area = { label: t.area, concepts: [] };
      areas.push(area);
    }
    const existing = area.concepts.find((c) => c.canonicalConceptId === t.canonical_concept_id);
    if (existing) {
      if (t.skill && !existing.skills.includes(t.skill)) existing.skills.push(t.skill);
      continue;
    }
    if (placed.has(t.canonical_concept_id)) continue;
    placed.add(t.canonical_concept_id);
    const entry = plan.get(t.canonical_concept_id);
    const inPlan = Boolean(entry && entry.planStatus === 'IN_PLAN');
    const stage = stages.get(t.canonical_concept_id) ?? null;
    area.concepts.push({
      canonicalConceptId: t.canonical_concept_id,
      label: labels.get(t.canonical_concept_id) ?? '',
      stage,
      status: examPrepStatus(stage, inPlan, gapIds.has(t.canonical_concept_id)),
      inPlan,
      learnerConceptId: entry?.learnerConceptId ?? null,
      recommendationId: recByConcept.get(t.canonical_concept_id) ?? null,
      skills: t.skill ? [t.skill] : [],
    });
  }
  return { examName: p.exam_name, versionLabel: version.rows[0]?.label ?? null, readiness: readiness.rows[0]?.overall_status ?? null, areas: areas.filter((a) => a.concepts.length > 0), unmappedObjectives: unmapped, mappingStatus: resolved.mappingStatus };
}

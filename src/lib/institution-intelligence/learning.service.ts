/**
 * F12 -- Learning Intelligence (task sections 12/13/14). Reads ONLY
 * already-materialized F5 state tables (`concept_knowledge_state`,
 * `learner_skill_state`, `learner_competency_state`) via GROUP BY --
 * never re-derives classification, never writes (INV-F12-05/06), never
 * collapses the three dimensions into one score (task section 13). "No
 * Evidence" is reported as its own named bucket, never folded into a
 * weak/incorrect bucket (INV-F12-12, task section 14).
 */
import { db } from '@/lib/db';
import { requireInstitutionAccess, requireClassInInstitution, requireLearnerInInstitution } from './authorization';
import { getActiveAnalyticsPolicy, applyCohortSuppression, type SuppressibleAggregate } from './policy.service';
import { buildMetric, nowIso, type AnalyticsScope, type MetricEnvelope } from './types';

async function activeLearnerIdsForInstitution(institutionId: string, classId?: string): Promise<string[]> {
  const params: unknown[] = [institutionId];
  let classFilter = '';
  if (classId) {
    params.push(classId);
    classFilter = `AND ce.class_id = $${params.length}`;
  }
  const result = await db.query(
    `SELECT DISTINCT ce.student_id FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id WHERE c.institution_id = $1 AND ce.status = 'ACTIVE' ${classFilter}`,
    params
  );
  return result.rows.map((r: any) => r.student_id);
}

export interface StateDistribution {
  dimension: 'CONCEPT_KNOWLEDGE' | 'SKILL' | 'COMPETENCY';
  distribution: Record<string, number>;
  totalStatesRecorded: number;
}

async function conceptKnowledgeDistribution(studentIds: string[]): Promise<StateDistribution> {
  if (studentIds.length === 0) return { dimension: 'CONCEPT_KNOWLEDGE', distribution: {}, totalStatesRecorded: 0 };
  const result = await db.query(
    `SELECT mastery_state, COUNT(*)::int AS c FROM concept_knowledge_state WHERE student_id = ANY($1::uuid[]) GROUP BY mastery_state`,
    [studentIds]
  );
  const distribution: Record<string, number> = {};
  let total = 0;
  for (const row of result.rows as Array<{ mastery_state: string; c: number }>) {
    distribution[row.mastery_state] = row.c;
    total += row.c;
  }
  return { dimension: 'CONCEPT_KNOWLEDGE', distribution, totalStatesRecorded: total };
}

async function skillStateDistribution(studentIds: string[]): Promise<StateDistribution> {
  if (studentIds.length === 0) return { dimension: 'SKILL', distribution: {}, totalStatesRecorded: 0 };
  const result = await db.query(`SELECT state, COUNT(*)::int AS c FROM learner_skill_state WHERE student_id = ANY($1::uuid[]) GROUP BY state`, [studentIds]);
  const distribution: Record<string, number> = {};
  let total = 0;
  for (const row of result.rows as Array<{ state: string; c: number }>) {
    distribution[row.state] = row.c;
    total += row.c;
  }
  return { dimension: 'SKILL', distribution, totalStatesRecorded: total };
}

async function competencyStateDistribution(studentIds: string[]): Promise<StateDistribution> {
  if (studentIds.length === 0) return { dimension: 'COMPETENCY', distribution: {}, totalStatesRecorded: 0 };
  const result = await db.query(`SELECT state, COUNT(*)::int AS c FROM learner_competency_state WHERE student_id = ANY($1::uuid[]) GROUP BY state`, [studentIds]);
  const distribution: Record<string, number> = {};
  let total = 0;
  for (const row of result.rows as Array<{ state: string; c: number }>) {
    distribution[row.state] = row.c;
    total += row.c;
  }
  return { dimension: 'COMPETENCY', distribution, totalStatesRecorded: total };
}

/**
 * Evidence sufficiency (task section 14): reports learners with ANY
 * `learning_evidence` row ("has evidence") vs zero ("NO_EVIDENCE") --
 * a coarse, dimension-independent split that never claims weakness for
 * the zero-evidence group. Per-dimension INSUFFICIENT_EVIDENCE is
 * already visible directly in the SKILL/COMPETENCY/CONCEPT_KNOWLEDGE
 * distributions above via their own real, named state values -- this
 * function does not recompute or duplicate that judgment.
 */
async function evidencePresenceSplit(studentIds: string[]): Promise<{ withEvidence: number; noEvidence: number }> {
  if (studentIds.length === 0) return { withEvidence: 0, noEvidence: 0 };
  const result = await db.query(`SELECT COUNT(DISTINCT student_id)::int AS c FROM learning_evidence WHERE student_id = ANY($1::uuid[])`, [studentIds]);
  const withEvidence = result.rows[0].c;
  return { withEvidence, noEvidence: studentIds.length - withEvidence };
}

export interface LearningSummary {
  scope: AnalyticsScope;
  cohort: SuppressibleAggregate<{
    uniqueLearnerCount: MetricEnvelope<number>;
    evidencePresence: MetricEnvelope<{ withEvidence: number; noEvidence: number }>;
    conceptKnowledge: StateDistribution;
    skill: StateDistribution;
    competency: StateDistribution;
  }>;
}

async function buildLearningSummary(scope: AnalyticsScope, studentIds: string[]): Promise<LearningSummary> {
  const policy = await getActiveAnalyticsPolicy();
  const asOf = nowIso();
  const lifetime = { type: 'LIFETIME' as const, asOf };

  const [evidencePresence, conceptKnowledge, skill, competency] = await Promise.all([
    evidencePresenceSplit(studentIds),
    conceptKnowledgeDistribution(studentIds),
    skillStateDistribution(studentIds),
    competencyStateDistribution(studentIds),
  ]);

  const inner = {
    uniqueLearnerCount: buildMetric({
      metricId: 'LEARNING_UNIQUE_LEARNER_COUNT', name: 'Unique Learners in Scope', scope, timeWindow: lifetime,
      populationDescription: 'distinct active learners in scope', populationCount: studentIds.length,
      numerator: studentIds.length, dataSource: 'class_enrollments', value: studentIds.length,
    }),
    evidencePresence: buildMetric({
      metricId: 'LEARNING_EVIDENCE_PRESENCE', name: 'Learners With vs Without Any Evidence', scope, timeWindow: lifetime,
      populationDescription: 'distinct active learners in scope', populationCount: studentIds.length,
      numerator: evidencePresence.withEvidence, denominator: studentIds.length, dataSource: 'learning_evidence',
      limitations: ['NO_EVIDENCE is a neutral fact (the learner has not yet produced qualifying activity), never treated as weak/incorrect performance (INV-F12-12)'],
      value: evidencePresence,
    }),
    conceptKnowledge,
    skill,
    competency,
  };

  return { scope, cohort: applyCohortSuppression(studentIds.length, policy, inner) };
}

export async function getInstitutionLearnerSummary(actorUserId: string, institutionId: string, filters?: { classId?: string }): Promise<LearningSummary> {
  await requireInstitutionAccess(actorUserId, institutionId);
  if (filters?.classId) await requireClassInInstitution(actorUserId, institutionId, filters.classId);
  const studentIds = await activeLearnerIdsForInstitution(institutionId, filters?.classId);
  return buildLearningSummary(filters?.classId ? { type: 'CLASS', id: filters.classId } : { type: 'INSTITUTION', id: institutionId }, studentIds);
}

export async function getClassLearningSummary(actorUserId: string, institutionId: string, classId: string): Promise<LearningSummary> {
  await requireClassInInstitution(actorUserId, institutionId, classId);
  const studentIds = await activeLearnerIdsForInstitution(institutionId, classId);
  return buildLearningSummary({ type: 'CLASS', id: classId }, studentIds);
}

export interface LearnerDrillDownSummary {
  studentId: string;
  evidenceCount: number;
  conceptKnowledgeDistribution: Record<string, number>;
  skillDistribution: Record<string, number>;
  competencyDistribution: Record<string, number>;
  calculatedAt: string;
}

/**
 * Learner drill-down (task section 25): server re-verifies the learner
 * belongs to an ACTIVE enrollment in THIS institution before returning
 * anything -- never inferred from the id alone. Returns a MINIMIZED
 * summary (aggregate state distributions only) -- never raw
 * `learning_evidence` rows, never AI prompts/provenance, never
 * cross-learner data (task section 42).
 */
export async function getLearnerDrillDown(actorUserId: string, institutionId: string, studentId: string): Promise<LearnerDrillDownSummary> {
  await requireLearnerInInstitution(actorUserId, institutionId, studentId);

  const [evidenceCount, concept, skill, competency] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1`, [studentId]),
    conceptKnowledgeDistribution([studentId]),
    skillStateDistribution([studentId]),
    competencyStateDistribution([studentId]),
  ]);

  return {
    studentId,
    evidenceCount: evidenceCount.rows[0].c,
    conceptKnowledgeDistribution: concept.distribution,
    skillDistribution: skill.distribution,
    competencyDistribution: competency.distribution,
    calculatedAt: nowIso(),
  };
}

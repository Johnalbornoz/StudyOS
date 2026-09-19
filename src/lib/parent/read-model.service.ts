/**
 * F10 -- Parent Read Model (task §12). The ONLY thing Parent-facing
 * routes/UI call. Every method that takes a `studentId` re-validates
 * F2 authorization itself, as its first action -- no caller is ever
 * trusted to have checked already (task §29). Sources exclusively from
 * F4/F5/F6/F7/F8/F9's own existing, certified read functions (plus a
 * small number of narrow, single-table SELECTs where no reusable
 * service export exists yet -- documented per-method below, and never
 * against Canonical V2 or the legacy `exam-readiness.service.ts`).
 *
 * See docs/implementation/f10/F10_PARENT_READ_MODEL.md for the design
 * rationale and docs/implementation/f10/F10_PARENT_PRIVACY_MODEL.md for
 * field-classification decisions.
 */

import { db } from '@/lib/db';
import { isActiveParentOf } from '@/lib/authorization';
import { getStudentMastery } from '@/services/mastery.service';
import { getActiveDebts } from '@/services/learning-debt.service';
import { getSubjectConcepts } from '@/services/concept-extraction.service';
import { getLatestReadinessSnapshot } from '@/lib/readiness/readiness.service';
import { getFullMockEligibility } from '@/lib/simulation/full-mock-eligibility.service';
import { getSimulationEligibility } from '@/lib/simulation/eligibility.service';
import type { ReadinessSnapshot, DimensionStatus } from '@/lib/readiness/types';
import type { SimulationType } from '@/lib/simulation/types';

export class ParentAccessDeniedError extends Error {
  constructor(studentId: string) {
    super(`Parent actor is not authorized to view learner ${studentId}`);
    this.name = 'ParentAccessDeniedError';
  }
}

/**
 * Deliberately PARENT-ONLY, not the generic canAccessLearner (F10
 * multi-role certification fix): canAccessLearner composes
 * Owner/Parent/Teacher as equivalent for LEARNER_PROGRESS_VIEW, which
 * is correct for F5-F9's routes (any authorized viewer) but wrong here
 * -- a Parent-labeled route must not grant access through an actor's
 * separate Teacher relationship to the same learner. Proven by
 * scripts/operations/f10-multi-role-authorization-check-runner.ts and
 * tests/unit/f10-parent-multi-role-isolation.test.ts.
 */
async function requireAccess(actorUserId: string, studentId: string): Promise<void> {
  const allowed = await isActiveParentOf(actorUserId, studentId);
  if (!allowed) throw new ParentAccessDeniedError(studentId);
}

export interface ParentLearnerSummary {
  studentId: string;
  name: string;
  activeSince: string | null;
}

/**
 * Derives the list from `parent_student_relationships` itself
 * (status='accepted', joined through the actor's canonical
 * `profiles.user_id`) -- safe by construction, no separate
 * per-learner check needed since the relationship IS the query.
 */
export async function getParentLearners(actorUserId: string): Promise<ParentLearnerSummary[]> {
  const result = await db.query(
    `
    SELECT s.id, s.name, s.email, psr.responded_at
    FROM parent_student_relationships psr
    JOIN profiles pp ON pp.id = psr.parent_id
    JOIN students s ON s.id = psr.student_id
    WHERE pp.user_id = $1 AND psr.status = 'accepted'
    ORDER BY psr.responded_at ASC NULLS LAST
    `,
    [actorUserId]
  );
  return result.rows.map((r) => ({
    studentId: r.id,
    name: r.name || r.email,
    activeSince: r.responded_at,
  }));
}

export interface ParentLearnerOverview {
  studentId: string;
  name: string;
  subjectCount: number;
  conceptsWithEvidence: number;
  areasNeedingAttentionCount: number;
  latestReadinessStatus: ReadinessSnapshot['overallStatus'] | 'NO_ACTIVE_EXAM_PROFILE';
  lastActivityAt: string | null;
}

export async function getParentLearnerOverview(actorUserId: string, studentId: string): Promise<ParentLearnerOverview> {
  await requireAccess(actorUserId, studentId);

  const [studentRow, subjectsResult, masteryRecords, debts, activeExamProfile, lastActivityResult] = await Promise.all([
    db.query(`SELECT name, email FROM students WHERE id = $1`, [studentId]),
    db.query(`SELECT id FROM subjects WHERE student_id = $1 AND status = 'active'`, [studentId]),
    getStudentMastery(studentId, undefined, 'en').catch(() => []),
    getActiveDebts(studentId, undefined, 'en').catch(() => []),
    getActiveExamProfile(studentId),
    db.query(`SELECT MAX("timestamp") AS last_at FROM learning_evidence WHERE student_id = $1`, [studentId]),
  ]);

  let latestReadinessStatus: ParentLearnerOverview['latestReadinessStatus'] = 'NO_ACTIVE_EXAM_PROFILE';
  if (activeExamProfile) {
    const snapshot = await getLatestReadinessSnapshot(activeExamProfile.id).catch(() => null);
    if (snapshot) latestReadinessStatus = snapshot.overallStatus;
  }

  const name = studentRow.rows[0]?.name || studentRow.rows[0]?.email || '';

  return {
    studentId,
    name,
    subjectCount: subjectsResult.rows.length,
    conceptsWithEvidence: masteryRecords.length,
    areasNeedingAttentionCount: debts.length,
    latestReadinessStatus,
    lastActivityAt: lastActivityResult.rows[0]?.last_at ?? null,
  };
}

export interface ParentSubjectProgress {
  subjectId: string;
  name: string;
  totalConcepts: number;
  conceptsWithQualifyingEvidence: number;
  activeAreasNeedingAttention: number;
}

/**
 * "Total concepts" is every concept mapped to the subject
 * (`getSubjectConcepts` has no active/inactive filter to reuse -- a
 * genuine gap, documented rather than papered over with new business
 * logic here). "Concepts with qualifying evidence" reuses the exact
 * same definition `getChildOverview` already established: a concept
 * has a mastery_records row.
 */
export async function getParentSubjectProgress(
  actorUserId: string,
  studentId: string,
  subjectId?: string
): Promise<ParentSubjectProgress[]> {
  await requireAccess(actorUserId, studentId);

  const subjectsResult = subjectId
    ? await db.query(`SELECT id, name FROM subjects WHERE student_id = $1 AND id = $2 AND status = 'active'`, [studentId, subjectId])
    : await db.query(`SELECT id, name FROM subjects WHERE student_id = $1 AND status = 'active' ORDER BY name`, [studentId]);

  return Promise.all(
    subjectsResult.rows.map(async (s: any) => {
      const [concepts, masteryRecords, debts] = await Promise.all([
        getSubjectConcepts(s.id, 'en').catch(() => []),
        getStudentMastery(studentId, s.id, 'en').catch(() => []),
        getActiveDebts(studentId, s.id, 'en').catch(() => []),
      ]);
      return {
        subjectId: s.id,
        name: s.name,
        totalConcepts: concepts.length,
        conceptsWithQualifyingEvidence: masteryRecords.length,
        activeAreasNeedingAttention: debts.length,
      };
    })
  );
}

export interface ParentActivityItem {
  kind: 'practice' | 'simulation';
  occurredAt: string;
  subjectId: string | null;
}

/**
 * Composed from two certified sources -- there is no pre-built
 * cross-source activity timeline anywhere in the codebase (confirmed
 * by inspection; see F10_CURRENT_PARENT_EXPERIENCE_ASSESSMENT.md). Each
 * item carries only a timestamp, kind, and subject id -- never raw
 * question/response content, per F10_PARENT_PRIVACY_MODEL.md.
 */
export async function getParentRecentActivity(
  actorUserId: string,
  studentId: string,
  limit: number = 20
): Promise<ParentActivityItem[]> {
  await requireAccess(actorUserId, studentId);

  const [practiceResult, simulationResult] = await Promise.all([
    db.query(
      `SELECT "timestamp" AS occurred_at, subject_id FROM learning_evidence WHERE student_id = $1 ORDER BY "timestamp" DESC LIMIT $2`,
      [studentId, limit]
    ),
    db.query(
      `SELECT sa.created_at AS occurred_at, sep.id AS exam_profile_id FROM simulation_attempts sa
       JOIN student_exam_profiles sep ON sep.id = sa.exam_profile_id
       WHERE sa.student_id = $1 ORDER BY sa.created_at DESC LIMIT $2`,
      [studentId, limit]
    ),
  ]);

  const items: ParentActivityItem[] = [
    ...practiceResult.rows.map((r) => ({ kind: 'practice' as const, occurredAt: r.occurred_at, subjectId: r.subject_id })),
    ...simulationResult.rows.map((r) => ({ kind: 'simulation' as const, occurredAt: r.occurred_at, subjectId: null })),
  ];

  return items.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()).slice(0, limit);
}

interface ActiveExamProfile {
  id: string;
  examDefinitionId: string;
  examVersionId: string | null;
  examName: string;
  examDate: string | null;
}

/**
 * No reusable "active exam profile for a student" service export
 * exists (confirmed by inspection -- `getStudentExamProfile` takes a
 * profile id, not a student id). Mirrors the exact inline-SQL pattern
 * F7's own canonical route (`/api/exam-profiles/route.ts`) already
 * uses for this same table, narrowed to the most recent ACTIVE row.
 */
async function getActiveExamProfile(studentId: string): Promise<ActiveExamProfile | null> {
  const result = await db.query(
    `
    SELECT sep.id, sep.exam_definition_id, sep.exam_version_id, sep.exam_date, ed.name AS exam_name
    FROM student_exam_profiles sep
    JOIN exam_definitions ed ON ed.id = sep.exam_definition_id
    WHERE sep.student_id = $1 AND sep.status = 'ACTIVE'
    ORDER BY sep.created_at DESC
    LIMIT 1
    `,
    [studentId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    examDefinitionId: row.exam_definition_id,
    examVersionId: row.exam_version_id,
    examName: row.exam_name,
    examDate: row.exam_date,
  };
}

export type FullMockReasonCategory = 'PLATFORM_NOT_READY' | 'LEARNER_NOT_READY';

export interface ParentExamPrep {
  examName: string;
  examDate: string | null;
  dimensions: Array<{ dimension: string; status: DimensionStatus }>;
  scoreProjectionAvailability: ReadinessSnapshot['scoreProjectionAvailability'];
  fullMock: {
    eligible: boolean;
    reasonCategory: FullMockReasonCategory | null;
    reasons: string[];
  };
  availableSimulationTypes: SimulationType[];
}

/**
 * Sourced exclusively from F9 (`readiness.service.ts`,
 * `full-mock-eligibility.service.ts`, `eligibility.service.ts`) --
 * never from `exam-readiness.service.ts`. Returns null when the
 * learner has no active Exam Profile (task §17 zero-state), which is a
 * valid, first-class result, not an error.
 */
export async function getParentExamPreparation(actorUserId: string, studentId: string): Promise<ParentExamPrep | null> {
  await requireAccess(actorUserId, studentId);

  const activeProfile = await getActiveExamProfile(studentId);
  if (!activeProfile || !activeProfile.examVersionId) return null;

  const snapshot = await getLatestReadinessSnapshot(activeProfile.id);
  const fullMock = await getFullMockEligibility(activeProfile.examVersionId);

  // Platform-vs-learner distinction (task §18/INV-F10-22), derived
  // directly from F9's own certified fields, never guessed from reason
  // text: `structuralReadiness.ready === false` means the PLATFORM
  // itself cannot yet offer a Full Mock for this exam version
  // (unsupported components, missing calibration); otherwise an
  // ineligibility is this learner's own domain-coverage/evidence gap.
  let reasonCategory: FullMockReasonCategory | null = null;
  if (!fullMock.eligible) {
    reasonCategory = fullMock.structuralReadiness && !fullMock.structuralReadiness.ready ? 'PLATFORM_NOT_READY' : 'LEARNER_NOT_READY';
  }

  const availableSimulationTypes: SimulationType[] = [];
  for (const type of ['TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK'] as SimulationType[]) {
    const eligibility =
      type === 'FULL_MOCK'
        ? fullMock
        : await getSimulationEligibility({ studentId, examVersionId: activeProfile.examVersionId, simulationType: type }).catch(() => null);
    if (eligibility?.eligible) availableSimulationTypes.push(type);
  }

  return {
    examName: activeProfile.examName,
    examDate: activeProfile.examDate,
    dimensions: snapshot ? snapshot.dimensions.map((d) => ({ dimension: d.dimension, status: d.status })) : [],
    scoreProjectionAvailability: snapshot?.scoreProjectionAvailability ?? 'NOT_APPLICABLE',
    fullMock: { eligible: fullMock.eligible, reasonCategory, reasons: fullMock.reasons },
    availableSimulationTypes,
  };
}

export type AttentionAreaCategory =
  | 'KNOWLEDGE_PRACTICE_NEEDED'
  | 'SKILL_PRACTICE_NEEDED'
  | 'TECHNIQUE_PRACTICE_NEEDED'
  | 'FLUENCY_PRACTICE_NEEDED'
  | 'MORE_EVIDENCE_NEEDED'
  | 'PLATFORM_COVERAGE_INCOMPLETE';

export interface ParentAttentionArea {
  category: AttentionAreaCategory;
  explanation: string;
  subjectId?: string;
}

const DIMENSION_TO_CATEGORY: Record<string, AttentionAreaCategory> = {
  KNOWLEDGE_READINESS: 'KNOWLEDGE_PRACTICE_NEEDED',
  SKILL_READINESS: 'SKILL_PRACTICE_NEEDED',
  EXAM_TECHNIQUE_READINESS: 'TECHNIQUE_PRACTICE_NEEDED',
  SPEED_FLUENCY_READINESS: 'FLUENCY_PRACTICE_NEEDED',
  EVIDENCE_SUFFICIENCY: 'MORE_EVIDENCE_NEEDED',
  BLUEPRINT_EVIDENCE_COVERAGE: 'PLATFORM_COVERAGE_INCOMPLETE',
};

/**
 * From F5 learning debt (concept-level gaps) and, when an active Exam
 * Profile exists, F9's own readiness dimensions flagged WEAK or
 * INSUFFICIENT_EVIDENCE -- a fixed enum, never a free-text or
 * psychological label (task §20).
 */
export async function getParentAttentionAreas(actorUserId: string, studentId: string): Promise<ParentAttentionArea[]> {
  await requireAccess(actorUserId, studentId);

  const areas: ParentAttentionArea[] = [];

  const debts = await getActiveDebts(studentId, undefined, 'en').catch(() => []);
  for (const debt of debts) {
    areas.push({
      category: 'KNOWLEDGE_PRACTICE_NEEDED',
      explanation: `Concept "${debt.concept.label}" has active learning debt (severity: ${debt.severity}).`,
      subjectId: debt.subjectId,
    });
  }

  const activeProfile = await getActiveExamProfile(studentId);
  if (activeProfile) {
    const snapshot = await getLatestReadinessSnapshot(activeProfile.id).catch(() => null);
    if (snapshot) {
      for (const dim of snapshot.dimensions) {
        if (dim.status === 'WEAK' || dim.status === 'INSUFFICIENT_EVIDENCE') {
          const category = DIMENSION_TO_CATEGORY[dim.dimension];
          if (category) {
            areas.push({
              category,
              explanation: dim.whatWouldImproveConfidence || `${dim.dimension} is currently ${dim.status}.`,
            });
          }
        }
      }
    }
  }

  return areas;
}

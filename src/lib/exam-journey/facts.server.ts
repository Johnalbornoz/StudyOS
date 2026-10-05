/**
 * Student Exam Journey V2 -- FACTS loader (server, read-only).
 *
 * Assembles `StudentExamJourneyFacts` from what StudyUs already stores, through
 * the existing services (capability contract, preparation plan, academic
 * context, Exam Core instances / results). It writes nothing. A fact that is
 * not stored yet is passed as null / empty / false -- never guessed:
 *
 *   - exam session code, sat confirmation, early opt-in, previous / actual
 *     result: no column yet (design §L.3, G-06)            -> null / false;
 *   - prediction model: `score_conversion_models` carries no O-02
 *     classification (official vs historical), and no Blueprint prediction
 *     contract exists yet                                    -> NO_MODEL;
 *   - component estimates: no table yet                      -> [];
 *   - version validity: not verifiable from stored data      -> UNVERIFIED;
 *   - institutional release: no release concept yet          -> NOT_APPLICABLE.
 */
import { db } from '@/lib/db';
import { getAcademicProfile } from '@/services/academic-profile.service';
import { getProfileCurriculum } from '@/services/academic-profile-catalogue.service';
import { loadClassExamAssignmentsForStudent, loadClassProgrammes } from '@/lib/exam-core/eligibility/academic-context';
import { normaliseGradeLevel } from '@/lib/exam-core/eligibility/grade-level';
import { isAcademicProfileComplete } from '@/lib/student/onboarding-gate';
import { listStudentExamProfiles } from '@/lib/assessment/student-exam-profile.service';
import { buildProfilePlan, objectiveCapabilities, profileObjective } from '@/lib/exam-core/objectives/preparation.service';
import { objectiveByKey, type ExamObjective } from '@/lib/exam-core/objectives/objective-catalog';
import type { ExamPreparationCapabilities } from '@/lib/exam-core/objectives/capabilities';
import type { PreparationPlan } from '@/lib/exam-core/objectives/preparation-plan';
import { findOpenSimulationAttemptForProfile } from '@/lib/simulation/attempt.service';
import type { StudentExamProfile } from '@/lib/assessment/types';
import type {
  BlueprintReadinessFacts,
  ContentReadinessFacts,
  ExamInstanceFact,
  ExamTargetFacts,
  LearnerFacts,
  LearningEvidenceFacts,
  PredictionCapabilityFacts,
  StudentExamJourneyFacts,
} from './types';

const NO_PREDICTION_MODEL: PredictionCapabilityFacts = { modelClass: 'NO_MODEL', components: [], estimates: [] };

export async function loadLearnerFacts(studentId: string, examTargetCount: number): Promise<LearnerFacts> {
  const [profile, curriculum, classRows, assignments, subjects] = await Promise.all([
    getAcademicProfile(studentId).catch(() => null),
    getProfileCurriculum(studentId).catch(() => null),
    loadClassProgrammes(studentId),
    loadClassExamAssignmentsForStudent(studentId),
    db.query(`SELECT count(*)::int AS n FROM subjects WHERE student_id = $1`, [studentId]),
  ]);
  const enrolledClasses = new Set([...classRows.map((r) => r.class_id), ...assignments.map((a) => a.classId)]);
  return {
    academicProfile: profile
      ? {
          complete: isAcademicProfileComplete(profile),
          countryCode: profile.countryOfStudy && profile.countryOfStudy !== 'OTHER' ? profile.countryOfStudy : null,
          gradeLevel: curriculum?.gradeLevel ?? normaliseGradeLevel(profile),
          programmeId: curriculum?.programmeId ?? null,
          academicSubjects: (curriculum?.subjects ?? []).map((s) => ({ academicSubjectId: s.id, level: s.level })),
        }
      : null,
    institution: {
      activeEnrollments: enrolledClasses.size,
      classProgrammes: classRows.map((r) => ({ classId: r.class_id, programmeId: r.programme_id, academicSubjectId: r.academic_subject_id })),
      assignedObjectiveKeys: [...new Set(assignments.map((a) => a.objectiveKey))],
    },
    subjectCount: subjects.rows[0]?.n ?? 0,
    examTargetCount,
  };
}

async function publishedVersionExists(objective: ExamObjective): Promise<boolean> {
  if (!objective.configKeys.length) return false;
  const r = await db.query(
    `SELECT 1 FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED'
      WHERE d.config_key = ANY($1::text[]) AND d.status = 'ACTIVE' LIMIT 1`,
    [objective.configKeys]
  );
  return r.rows.length > 0;
}

function blueprintFacts(caps: ExamPreparationCapabilities, publishedVersion: boolean): BlueprintReadinessFacts {
  return {
    readiness: caps.readiness,
    structureVisible: caps.canViewStructure,
    publishedVersion,
    versionValidity: 'UNVERIFIED',
    programmePlan: caps.canPlanDiploma,
    institutionalRelease: 'NOT_APPLICABLE',
  };
}

function contentFacts(caps: ExamPreparationCapabilities): ContentReadinessFacts {
  const reduced = caps.reducedMocks.map((m) => m.lengthCoveragePercent).filter((n): n is number => n !== null);
  return {
    practice: caps.canPractice,
    diagnostic: caps.canRunDiagnostic,
    reducedMock: caps.canRunReducedMock,
    fullMock: caps.canRunFullMock,
    learningBridge: caps.canUseLearningBridge,
    unavailable: caps.unavailableReasons,
    reducedMockLengthCoveragePercent: reduced.length ? Math.max(...reduced) : null,
  };
}

async function learningFacts(studentId: string, plan: PreparationPlan | null): Promise<LearningEvidenceFacts | null> {
  if (!plan) return null;
  const mapped = plan.requirements.filter((r) => r.status !== 'NOT_YET_MAPPED');
  const mappedWeight = mapped.reduce((a, r) => a + r.weight, 0);
  const readyWeight = mapped.filter((r) => r.status === 'ALREADY_STRONG' || r.status === 'NEEDS_CONFIRMATION').reduce((a, r) => a + r.weight, 0);
  const conceptIds = [...new Set(plan.requirements.flatMap((r) => r.concepts.map((c) => c.learner?.studentConceptId)).filter((id): id is string => !!id))];
  // Learning evidence only: exam-simulation rows are exam evidence, not learning (design G-08).
  const last = conceptIds.length
    ? (await db.query(`SELECT max("timestamp") AS at FROM learning_evidence WHERE student_id = $1 AND concept_id = ANY($2::uuid[]) AND source_type <> 'EXAM_SIMULATION'`, [studentId, conceptIds])).rows[0]?.at ?? null
    : null;
  const top = plan.recommendations[0] ?? null;
  return {
    mappedRequirements: plan.coverage.mapped,
    mappedWithEvidence: plan.coverage.mappedWithEvidence,
    counts: plan.counts,
    weightedReadyShare: mappedWeight > 0 ? readyWeight / mappedWeight : null,
    topRecommendation: top ? { action: top.recommendation.action, band: top.priority.band } : null,
    lastMappedLearningEvidenceAt: last ? new Date(last).toISOString() : null,
  };
}

const INSTANCES_SQL = `
  SELECT ei.id, ei.mode, ei.purpose, ei.status, ei.timing_mode, ei.completed_at, ei.component_ids,
         ei.form->>'fidelity' AS fidelity,
         cardinality(ei.component_ids) < (SELECT count(*) FROM assessment_components ac WHERE ac.exam_version_id = ei.exam_version_id) AS component_scoped,
         res.status AS result_status, res.scoring_status
    FROM exam_instances ei
    LEFT JOIN simulation_attempts sa ON sa.id = ei.simulation_attempt_id
    LEFT JOIN exam_attempt_results res ON res.exam_attempt_id = sa.exam_attempt_id
   WHERE ei.exam_profile_id = $1 AND ei.status <> 'DELETED'`;

export function toInstanceFact(row: any): ExamInstanceFact {
  const result = row.result_status === 'INVALIDATED' ? 'INVALIDATED' : row.result_status === 'SCORED' ? (row.scoring_status === 'NO_SCORING_POLICY' ? 'NO_SCORING_POLICY' : 'SCORED') : null;
  return {
    instanceRef: row.id,
    mode: row.mode,
    purpose: row.purpose === 'DIAGNOSTIC' ? 'DIAGNOSTIC' : null,
    status: row.status,
    timingMode: row.timing_mode,
    componentScoped: !!row.component_scoped,
    fidelity: row.fidelity === 'FULL' || row.fidelity === 'REDUCED' ? row.fidelity : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    result,
    coveredComponentIds: Array.isArray(row.component_ids) ? row.component_ids : [],
  };
}

function targetFacts(profile: StudentExamProfile | null, objective: ExamObjective | null, objectiveKey: string, assignedKeys: Set<string>): ExamTargetFacts {
  const assigned = profile?.source === 'INSTITUTION' || assignedKeys.has(objectiveKey);
  return {
    examTargetId: profile?.id ?? null,
    objectiveKey,
    framework: objective?.framework ?? profile?.objectiveFramework ?? null,
    objectiveKind: objective?.kind ?? null,
    examDefinitionId: profile?.examDefinitionId ?? null,
    level: objective?.context.level ?? null,
    examDate: profile?.examDate ?? null,
    sessionCode: null,
    status: profile?.status ?? 'ACTIVE',
    source: profile ? profile.source ?? 'STUDENT' : 'INSTITUTION_ASSIGNMENT',
    confirmation: assigned ? 'ASSIGNED' : 'CONFIRMED',
    satConfirmed: false,
    optedInEarly: false,
    previousResult: null,
    actualResult: null,
  };
}

async function factsForTarget(studentId: string, asOf: string, learner: LearnerFacts, profile: StudentExamProfile | null, objective: ExamObjective | null, objectiveKey: string): Promise<StudentExamJourneyFacts> {
  const target = targetFacts(profile, objective, objectiveKey, new Set(learner.institution.assignedObjectiveKeys));
  if (!objective) {
    // The target names no objective of the governed catalogue: nothing is known about the exam.
    return { asOf, learner, target, blueprint: null, content: null, learning: null, exam: { instances: [], openAttempt: false }, prediction: NO_PREDICTION_MODEL };
  }
  const [caps, published] = await Promise.all([objectiveCapabilities(objective), publishedVersionExists(objective)]);
  const [plan, instances, open] = profile
    ? await Promise.all([buildProfilePlan(studentId, profile, objective, caps), db.query(INSTANCES_SQL, [profile.id]), findOpenSimulationAttemptForProfile(profile.id)])
    : [null, { rows: [] as any[] }, null];
  return {
    asOf,
    learner,
    target,
    blueprint: blueprintFacts(caps, published),
    content: contentFacts(caps),
    learning: await learningFacts(studentId, plan),
    exam: { instances: instances.rows.map(toInstanceFact), openAttempt: !!open },
    prediction: NO_PREDICTION_MODEL,
  };
}

/**
 * One facts bundle per exam target of the Student: every non-archived
 * preparation, plus each institution assignment not yet taken up as a
 * preparation. A Student with neither gets ONE bundle with `target: null`.
 */
export async function loadStudentExamJourneyFacts(studentId: string, asOf: string): Promise<StudentExamJourneyFacts[]> {
  const profiles = await listStudentExamProfiles(studentId);
  const learner = await loadLearnerFacts(studentId, profiles.length);
  const objectives = await Promise.all(profiles.map((p) => profileObjective(p).catch(() => null)));
  const preparedKeys = new Set(profiles.map((p, i) => objectives[i]?.key ?? p.objectiveKey ?? '').filter(Boolean));
  const pendingAssignments = learner.institution.assignedObjectiveKeys.filter((k) => !preparedKeys.has(k));

  const bundles = await Promise.all([
    ...profiles.map((p, i) => factsForTarget(studentId, asOf, learner, p, objectives[i], objectives[i]?.key ?? p.objectiveKey ?? `exam-definition:${p.examDefinitionId}`)),
    ...pendingAssignments.map((key) => factsForTarget(studentId, asOf, learner, null, objectiveByKey(key), key)),
  ]);
  if (bundles.length > 0) return bundles;
  return [{ asOf, learner, target: null, blueprint: null, content: null, learning: null, exam: { instances: [], openAttempt: false }, prediction: NO_PREDICTION_MODEL }];
}

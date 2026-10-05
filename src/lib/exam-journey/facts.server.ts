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
import { learningFactsFromPlan } from './plan-facts';
import { findOpenSimulationAttemptForProfile } from '@/lib/simulation/attempt.service';
import type { StudentExamProfile } from '@/lib/assessment/types';
import { INSTITUTIONAL_ENROLLMENTS_SQL, studentDeclaredContext, toEnrollmentFact } from './institutional-context.server';
import { resolveInstitutionalAcademicContext, summariseInstitutionalContext } from './institutional-context';
import { scheduleFactsFromRow, type ExamTargetRow } from './exam-target';
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
  const [profile, curriculum, classRows, assignments, subjects, enrollments] = await Promise.all([
    getAcademicProfile(studentId).catch(() => null),
    getProfileCurriculum(studentId).catch(() => null),
    loadClassProgrammes(studentId),
    loadClassExamAssignmentsForStudent(studentId),
    db.query(`SELECT count(*)::int AS n FROM subjects WHERE student_id = $1`, [studentId]),
    db.query(INSTITUTIONAL_ENROLLMENTS_SQL, [studentId]),
  ]);
  // J1.2: the institutional context (two layers, provenance, missing links, conflicts) -- summary only.
  const context = summariseInstitutionalContext(
    resolveInstitutionalAcademicContext({ enrollments: enrollments.rows.map(toEnrollmentFact), student: studentDeclaredContext(profile, curriculum) })
  );
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
      context,
    },
    subjectCount: subjects.rows[0]?.n ?? 0,
    examTargetCount,
  };
}

/**
 * A published exam version exists for the objective. Structure-only verticals keep their
 * definition in DRAFT on purpose (no practice yet) over a PUBLISHED version: the structure
 * (Blueprint) exists; what is missing is content, which the capability facts report.
 */
async function publishedVersionExists(objective: ExamObjective): Promise<boolean> {
  if (!objective.configKeys.length) return false;
  const r = await db.query(
    `SELECT 1 FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED'
      WHERE d.config_key = ANY($1::text[]) AND d.status IN ('ACTIVE', 'DRAFT') LIMIT 1`,
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
  const conceptIds = [...new Set(plan.requirements.flatMap((r) => r.concepts.map((c) => c.learner?.studentConceptId)).filter((id): id is string => !!id))];
  // Learning evidence only: exam-simulation rows are exam evidence, not learning (design G-08).
  const last = conceptIds.length
    ? (await db.query(`SELECT max("timestamp") AS at FROM learning_evidence WHERE student_id = $1 AND concept_id = ANY($2::uuid[]) AND source_type <> 'EXAM_SIMULATION'`, [studentId, conceptIds])).rows[0]?.at ?? null
    : null;
  return learningFactsFromPlan(plan, last ? new Date(last).toISOString() : null);
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

function targetFacts(profile: StudentExamProfile | null, objective: ExamObjective | null, objectiveKey: string, assignedKeys: Set<string>, row: ExamTargetRow | null): ExamTargetFacts {
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
    // J3.2: schedule facts from the stored row (official session / authoritative / Student-reported / personal / estimate).
    schedule: scheduleFactsFromRow(row ?? { id: profile?.id ?? '' }),
    // J1.2: no target derives an institutional fact today; the hook exists for the ones that will.
    contextDependencies: [],
  };
}

async function factsForTarget(studentId: string, asOf: string, learner: LearnerFacts, profile: StudentExamProfile | null, objective: ExamObjective | null, objectiveKey: string, row: ExamTargetRow | null): Promise<StudentExamJourneyFacts> {
  const target = targetFacts(profile, objective, objectiveKey, new Set(learner.institution.assignedObjectiveKeys), row);
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
  // Whole rows as JSON: columns a database has not migrated yet read as absent (UNKNOWN), never as an error.
  const rows = new Map<string, ExamTargetRow>(
    profiles.length
      ? (await db.query(`SELECT to_jsonb(p) AS row FROM student_exam_profiles p WHERE p.id = ANY($1::uuid[])`, [profiles.map((p) => p.id)])).rows.map((r: any) => [r.row.id, r.row as ExamTargetRow])
      : []
  );

  const bundles = await Promise.all([
    ...profiles.map((p, i) => factsForTarget(studentId, asOf, learner, p, objectives[i], objectives[i]?.key ?? p.objectiveKey ?? `exam-definition:${p.examDefinitionId}`, rows.get(p.id) ?? null)),
    ...pendingAssignments.map((key) => factsForTarget(studentId, asOf, learner, null, objectiveByKey(key), key, null)),
  ]);
  if (bundles.length > 0) return bundles;
  return [{ asOf, learner, target: null, blueprint: null, content: null, learning: null, exam: { instances: [], openAttempt: false }, prediction: NO_PREDICTION_MODEL }];
}

/**
 * L8-R1 -- the exam-practice tasks a Teacher may assign to ONE learner of
 * ONE class they teach, through the existing EXAM_PRACTICE intervention
 * (teacher_interventions, target_type EXAM). Read-only: no new assignment
 * model, no schema. The Student still starts the task through the existing
 * execution path, whose own eligibility check stays the only start gate.
 *
 * Who: the class's Teacher only (`getTeacherClass`, never `canAccessClass`,
 * which also admits institution admins), for a learner ACTIVE in that class
 * whom the actor genuinely teaches.
 *
 * What: only the learner's own, non-archived preparation profiles that
 * resolve to a PUBLISHED exam version (the same resolution the execution
 * path uses), and inside each only what belongs to the CLASS'S SUBJECT:
 *   TOPIC_EXAM   an objective of the version's blueprint mapped (PUBLISHED)
 *                to a concept of the class subject, on a SUPPORTED component;
 *   DOMAIN_EXAM  an academic subject linked to the class subject that has a
 *                SUPPORTED component in the blueprint;
 *   MINI_MOCK    only when the exam itself is an exam of the class subject
 *                (a whole-exam task of a multi-subject exam would reach
 *                beyond the class), and the existing eligibility allows it.
 * FULL_MOCK (an official mock) is not offered from the Teacher surface.
 * A class without a linked subject offers nothing.
 */
import { db } from '@/lib/db';
import { canTeacherAccessLearner } from '@/lib/authorization';
import { studentAudienceDefinitionSql } from '@/lib/exam-core/audience';
import { getBlueprintForVersion, listObjectiveTargets } from '@/lib/assessment/blueprint.service';
import { listComponentsForVersion } from '@/lib/assessment/component.service';
import { getSimulationEligibility } from '@/lib/simulation/eligibility.service';
import { getTeacherClass, type TeacherClassContext } from './class-assignment.service';
import type { TeacherInterventionTarget } from './intervention.service';

export class TeacherExamPracticeAccessDeniedError extends Error {
  constructor() {
    super('actor cannot assign exam practice to this learner in this class');
    this.name = 'TeacherExamPracticeAccessDeniedError';
  }
}

export type ExamPracticeTarget = Extract<TeacherInterventionTarget, { targetType: 'EXAM' }>;
export type ExamPracticeKind = 'TOPIC_EXAM' | 'DOMAIN_EXAM' | 'MINI_MOCK';

export interface ExamPracticeOption {
  /** Stable within one profile; the form sends the target, never this key. */
  key: string;
  examProfileId: string;
  examName: string;
  kind: ExamPracticeKind;
  /** Objective (code + description) or academic subject name; null for a mini mock. */
  targetLabel: string | null;
  target: ExamPracticeTarget;
}

export interface TeacherExamPracticeOptions {
  klass: TeacherClassContext;
  subjectLinked: boolean;
  options: ExamPracticeOption[];
}

/** Display cap per exam profile. */
const TOPIC_LIMIT = 60;

export async function listTeacherExamPracticeOptions(actorUserId: string, classId: string, studentId: string): Promise<TeacherExamPracticeOptions> {
  const klass = await getTeacherClass(actorUserId, classId);
  if (!klass) throw new TeacherExamPracticeAccessDeniedError();
  const enrolled = await db.query(`SELECT 1 FROM class_enrollments WHERE class_id = $1 AND student_id = $2 AND status = 'ACTIVE'`, [classId, studentId]);
  if (enrolled.rows.length === 0 || !(await canTeacherAccessLearner(actorUserId, studentId))) throw new TeacherExamPracticeAccessDeniedError();
  if (!klass.subjectId) return { klass, subjectLinked: false, options: [] };

  // The learner's own profiles, resolved like the execution path: the pinned version, else the definition's
  // PUBLISHED one; a profile whose version is not PUBLISHED could never be started, so it is not offered.
  const profiles = (
    await db.query(
      `SELECT p.id AS profile_id, d.name AS exam_name, v.id AS version_id, (ds.canonical_subject_id = $2) AS exam_of_class_subject
         FROM student_exam_profiles p
         JOIN exam_definitions d ON d.id = p.exam_definition_id
         JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED' AND (p.exam_version_id IS NULL OR v.id = p.exam_version_id)
         LEFT JOIN academic_subjects ds ON ds.id = d.academic_subject_id
        WHERE p.student_id = $1 AND p.status <> 'ARCHIVED' AND ${studentAudienceDefinitionSql('d')}
        ORDER BY d.name, p.created_at DESC`,
      [studentId, klass.subjectId]
    )
  ).rows as Array<{ profile_id: string; exam_name: string; version_id: string; exam_of_class_subject: boolean | null }>;
  if (profiles.length === 0) return { klass, subjectLinked: true, options: [] };

  // The version's structure through the existing readers (the LEGACY blueprint, as every existing flow): which
  // objectives and academic subjects sit on a SUPPORTED component -- the same structural rule the existing
  // eligibility applies to TOPIC_EXAM / DOMAIN_EXAM.
  const versionIds = [...new Set(profiles.map((p) => p.version_id))];
  const structure = new Map<string, { objectiveIds: string[]; academicSubjectIds: string[] }>();
  await Promise.all(
    versionIds.map(async (versionId) => {
      const [blueprint, components] = await Promise.all([getBlueprintForVersion(versionId), listComponentsForVersion(versionId)]);
      const targets = blueprint ? await listObjectiveTargets(blueprint.id) : [];
      const supported = new Map(components.filter((c) => c.supportStatus === 'SUPPORTED').map((c) => [c.id, c]));
      const onSupported = targets.filter((t) => supported.has(t.assessmentComponentId));
      structure.set(versionId, {
        objectiveIds: [...new Set(onSupported.map((t) => t.learningObjectiveId))],
        academicSubjectIds: [...new Set(onSupported.map((t) => supported.get(t.assessmentComponentId)!.academicSubjectId).filter((id): id is string => Boolean(id)))],
      });
    })
  );
  const allObjectiveIds = [...new Set([...structure.values()].flatMap((v) => v.objectiveIds))];
  const allSubjectIds = [...new Set([...structure.values()].flatMap((v) => v.academicSubjectIds))];
  // ...and, of those, only what belongs to the class subject.
  const [topics, domains] = await Promise.all([
    allObjectiveIds.length
      ? db.query(
          `SELECT DISTINCT lo.id, lo.code, lo.description
             FROM learning_objectives lo
             JOIN objective_concept_mappings m ON m.learning_objective_id = lo.id AND m.status = 'PUBLISHED'
             JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id AND cc.canonical_subject_id = $2
            WHERE lo.id = ANY($1::uuid[])
            ORDER BY lo.code NULLS LAST, lo.description`,
          [allObjectiveIds, klass.subjectId]
        )
      : { rows: [] as any[] },
    allSubjectIds.length
      ? db.query(`SELECT s.id, s.name FROM academic_subjects s WHERE s.id = ANY($1::uuid[]) AND s.canonical_subject_id = $2 ORDER BY s.name`, [allSubjectIds, klass.subjectId])
      : { rows: [] as any[] },
  ]);

  const options: ExamPracticeOption[] = [];
  for (const p of profiles) {
    const base = { examProfileId: p.profile_id, examName: p.exam_name };
    const { objectiveIds, academicSubjectIds } = structure.get(p.version_id)!;
    for (const s of domains.rows.filter((r: any) => academicSubjectIds.includes(r.id))) {
      options.push({ ...base, key: `${p.profile_id}:DOMAIN_EXAM:${s.id}`, kind: 'DOMAIN_EXAM', targetLabel: s.name, target: { targetType: 'EXAM', examProfileId: p.profile_id, simulationType: 'DOMAIN_EXAM', academicSubjectId: s.id } });
    }
    for (const o of topics.rows.filter((r: any) => objectiveIds.includes(r.id)).slice(0, TOPIC_LIMIT)) {
      options.push({
        ...base,
        key: `${p.profile_id}:TOPIC_EXAM:${o.id}`,
        kind: 'TOPIC_EXAM',
        targetLabel: [o.code, o.description].filter(Boolean).join(' '),
        target: { targetType: 'EXAM', examProfileId: p.profile_id, simulationType: 'TOPIC_EXAM', learningObjectiveId: o.id },
      });
    }
    if (p.exam_of_class_subject === true) {
      const eligibility = await getSimulationEligibility({ studentId, examVersionId: p.version_id, simulationType: 'MINI_MOCK' }).catch(() => null);
      if (eligibility?.eligible) options.push({ ...base, key: `${p.profile_id}:MINI_MOCK`, kind: 'MINI_MOCK', targetLabel: null, target: { targetType: 'EXAM', examProfileId: p.profile_id, simulationType: 'MINI_MOCK' } });
    }
  }
  return { klass, subjectLinked: true, options };
}

function sameTarget(a: ExamPracticeTarget, b: ExamPracticeTarget): boolean {
  if (a.examProfileId !== b.examProfileId || a.simulationType !== b.simulationType) return false;
  if (a.simulationType === 'TOPIC_EXAM' && b.simulationType === 'TOPIC_EXAM') return a.learningObjectiveId === b.learningObjectiveId;
  if (a.simulationType === 'DOMAIN_EXAM' && b.simulationType === 'DOMAIN_EXAM') return a.academicSubjectId === b.academicSubjectId;
  return true;
}

/**
 * The option a requested EXAM target corresponds to for this actor, class
 * and learner -- null when the target is not one of the options (another
 * learner's profile, another subject's objective, a whole-exam task of a
 * multi-subject exam, FULL_MOCK). Throws when the actor is not this
 * learner's Teacher in this class.
 */
export async function findTeacherExamPracticeOption(actorUserId: string, classId: string, studentId: string, target: ExamPracticeTarget): Promise<ExamPracticeOption | null> {
  const { options } = await listTeacherExamPracticeOptions(actorUserId, classId, studentId);
  return options.find((o) => sameTarget(o.target, target)) ?? null;
}

/**
 * Track B / B9 -- the Student-facing exam catalog, grouped by exam family
 * (taxonomy order), and the qualification aggregate (AICE).
 *
 * Read-only. Only ACTIVE definitions with a PUBLISHED version are offered
 * Year/session are
 * shown only when a version carries them.
 */
import { db } from '@/lib/db';
import type { ExamFamily } from './taxonomy';

export interface CatalogExamOption {
  examDefinitionId: string;
  examDefinitionName: string;
  examFamily: ExamFamily | null;
  rawFamily: string;
  purpose: string | null;
  examVersionId: string;
  versionLabel: string;
  examYear: number | null;
  examSession: string | null;
  contentStatus: string | null;
  subjectName: string | null;
  subjectLevel: string | null;
  qualificationName: string | null;
}

export interface CatalogFamilyGroup {
  family: ExamFamily | 'OTHER';
  options: CatalogExamOption[];
}

export interface QualificationAggregate {
  qualificationId: string;
  qualificationName: string;
  groups: Array<{
    group: string;
    subjects: Array<{ examDefinitionId: string; name: string; subjectName: string; subjectLevel: string | null; latest: { finalScore: number | null; finalLabel: string | null; rawScore: number; maxScore: number; scoredAt: string } | null }>;
  }>;
  /** No certificate / diploma rule is ever assumed. */
  rulesStatus: 'NOT_CONFIGURED';
}

/**
 * The qualification a definition belongs to (via its subject), with every
 * subject definition of that qualification grouped by aggregation group and
 * the Student's latest SCORED result for each. Null when the definition is
 * not part of an aggregated qualification.
 */
export async function getQualificationAggregate(studentId: string, examDefinitionId: string): Promise<QualificationAggregate | null> {
  const anchor = await db.query(
    `SELECT q.id AS qualification_id, q.name AS qualification_name
       FROM exam_definitions d JOIN academic_subjects s ON s.id = d.academic_subject_id JOIN academic_qualifications q ON q.id = s.qualification_id
      WHERE d.id = $1 AND d.aggregation_group IS NOT NULL`,
    [examDefinitionId]
  );
  const a = anchor.rows[0];
  if (!a) return null;
  const rows = await db.query(
    `SELECT d.id, d.name, d.aggregation_group, s.name AS subject_name, s.level AS subject_level,
            r.final_score, r.final_label, r.raw_score, r.max_score, r.scored_at
       FROM exam_definitions d
       JOIN academic_subjects s ON s.id = d.academic_subject_id
       LEFT JOIN LATERAL (
         SELECT res.final_score, res.final_label, res.raw_score, res.max_score, res.scored_at
           FROM exam_attempt_results res JOIN exam_versions v ON v.id = res.exam_version_id
          WHERE v.exam_definition_id = d.id AND res.student_id = $2 AND res.status = 'SCORED'
          ORDER BY res.scored_at DESC LIMIT 1
       ) r ON true
      WHERE s.qualification_id = $1 AND d.status = 'ACTIVE' AND d.aggregation_group IS NOT NULL
      ORDER BY d.aggregation_group, d.name`,
    [a.qualification_id, studentId]
  );
  const groups = new Map<string, QualificationAggregate['groups'][number]>();
  for (const r of rows.rows) {
    const g: QualificationAggregate['groups'][number] = groups.get(r.aggregation_group) ?? { group: r.aggregation_group, subjects: [] };
    g.subjects.push({
      examDefinitionId: r.id,
      name: r.name,
      subjectName: r.subject_name,
      subjectLevel: r.subject_level,
      latest: r.scored_at
        ? { finalScore: r.final_score === null ? null : Number(r.final_score), finalLabel: r.final_label, rawScore: Number(r.raw_score), maxScore: Number(r.max_score), scoredAt: r.scored_at instanceof Date ? r.scored_at.toISOString() : r.scored_at }
        : null,
    });
    groups.set(r.aggregation_group, g);
  }
  return { qualificationId: a.qualification_id, qualificationName: a.qualification_name, groups: [...groups.values()], rulesStatus: 'NOT_CONFIGURED' };
}

/** The Student's attempts for one profile, newest first, with their lifecycle facts (for the Exam Prep history). */
export async function listProfileAttempts(examProfileId: string): Promise<Array<{ id: string; simulationType: string; timingMode: string; status: string; createdAt: string; finalScore: number | null; finalLabel: string | null; rawScore: number | null; maxScore: number | null; resultStatus: string | null; scoringStatus: string | null; instanceMode: string | null; instanceFidelity: string | null }>> {
  const rows = await db.query(
    `SELECT sa.id, sa.simulation_type, sa.timing_mode, sa.status, sa.created_at,
            r.final_score, r.final_label, r.raw_score, r.max_score, r.status AS result_status, r.scoring_status,
            i.mode AS instance_mode, i.form->>'fidelity' AS instance_fidelity
       FROM simulation_attempts sa LEFT JOIN exam_attempt_results r ON r.exam_attempt_id = sa.exam_attempt_id
       LEFT JOIN exam_instances i ON i.simulation_attempt_id = sa.id
      WHERE sa.exam_profile_id = $1
        -- Deleted from the visible history (history.service): a deleted Exam V2 instance, or a hidden
        -- pre-V2 attempt. Result, responses and evidence are kept.
        AND sa.hidden_at IS NULL AND (i.id IS NULL OR i.status <> 'DELETED')
      ORDER BY sa.created_at DESC LIMIT 20`,
    [examProfileId]
  );
  return rows.rows.map((r: any) => ({
    id: r.id,
    simulationType: r.simulation_type,
    timingMode: r.timing_mode,
    status: r.status,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    finalScore: r.final_score === null ? null : Number(r.final_score),
    finalLabel: r.final_label,
    rawScore: r.raw_score === null ? null : Number(r.raw_score),
    maxScore: r.max_score === null ? null : Number(r.max_score),
    resultStatus: r.result_status,
    scoringStatus: r.scoring_status,
    instanceMode: r.instance_mode ?? null,
    instanceFidelity: r.instance_fidelity ?? null,
  }));
}

/** Blueprint areas (sections) and objectives of a version -- used to target topic/area practice by name, never by a typed id. */
export async function listVersionAreas(examVersionId: string): Promise<Array<{ componentId: string; name: string; academicSubjectId: string | null; objectives: Array<{ id: string; code: string | null; description: string }> }>> {
  const rows = await db.query(
    `SELECT c.id AS component_id, c.name, c.academic_subject_id, c.sequence_order, c.created_at, lo.id AS lo_id, lo.code, lo.description
       FROM assessment_components c
       LEFT JOIN assessment_blueprints b ON b.exam_version_id = c.exam_version_id
       LEFT JOIN blueprint_objective_targets t ON t.blueprint_id = b.id AND t.assessment_component_id = c.id
       LEFT JOIN learning_objectives lo ON lo.id = t.learning_objective_id
      WHERE c.exam_version_id = $1
      ORDER BY c.sequence_order ASC NULLS LAST, c.created_at ASC, lo.code ASC`,
    [examVersionId]
  );
  type Area = { componentId: string; name: string; academicSubjectId: string | null; objectives: Array<{ id: string; code: string | null; description: string }> };
  const areas = new Map<string, Area>();
  for (const r of rows.rows) {
    const area: Area = areas.get(r.component_id) ?? { componentId: r.component_id, name: r.name, academicSubjectId: r.academic_subject_id, objectives: [] };
    if (r.lo_id && !area.objectives.some((o) => o.id === r.lo_id)) area.objectives.push({ id: r.lo_id, code: r.code, description: r.description });
    areas.set(r.component_id, area);
  }
  return [...areas.values()];
}

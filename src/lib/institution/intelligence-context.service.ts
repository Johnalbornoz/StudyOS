/**
 * Track A -- governed context for Institution Intelligence. Coordinators
 * never type ids: the context is chosen among the institution's OWN
 * curricula (Programa → Versión curricular → Grado → Asignatura), and the
 * structure version, exam versions and classes are resolved here,
 * server-side, from that choice. Anything requested that does not belong to
 * the institution is ignored (falls back to the smart default) -- a
 * manipulated id can never reach another institution's data.
 *
 * Smart default: the only curriculum when there is one; otherwise one with a
 * published base, grade-specific, most recently adopted.
 */
import { studentVisibleDefinitionSql } from '@/lib/exam-core/audience';
import { db } from '@/lib/db';
import { requireInstitutionAccess } from '@/lib/institution-intelligence';

export const INTELLIGENCE_PERIODS = ['current', '30d', 'all'] as const;
export type IntelligencePeriod = (typeof INTELLIGENCE_PERIODS)[number];
/** "Periodo actual" = the last 90 days (no dated academic periods exist yet; documented rule). */
export const PERIOD_DAYS: Record<IntelligencePeriod, number | undefined> = { current: 90, '30d': 30, all: undefined };

export interface CurriculumContextOption {
  curriculumId: string;
  programme: string;
  version: string;
  grade: string;
  subject: string;
  hasPublishedBase: boolean;
}

export interface IntelligenceContext {
  curricula: CurriculumContextOption[];
  selected: (CurriculumContextOption & { canonicalSubjectId: string; gradeId: string | null }) | null;
  /** Internal only -- never rendered. */
  structureVersionId: string | null;
  period: IntelligencePeriod;
  classes: Array<{ id: string; name: string }>;
  classId: string | null;
  exams: Array<{ id: string; label: string }>;
  examVersionId: string | null;
  /** Track A: assignment origin filter (null = all). */
  origin: 'INSTITUTION' | 'TEACHER' | null;
}

export async function getIntelligenceContext(
  actorUserId: string,
  institutionId: string,
  requested: { curriculum?: string | null; period?: string | null; classId?: string | null; exam?: string | null; origin?: string | null },
  labels: { general: string; allGrades: string }
): Promise<IntelligenceContext> {
  await requireInstitutionAccess(actorUserId, institutionId);
  const rows = (await db.query(
    `SELECT ic.id, ic.title, ic.programme_label, ic.academic_year, ic.grade_id, g.name AS grade_name, ic.canonical_subject_id, cs.name AS canonical_subject_name,
            ic.base_structure_version_id, sv.version_label, asub.name AS subject_name, asub.level, ap.name AS programme_name, ic.created_at
     FROM institution_curricula ic
     JOIN canonical_subjects cs ON cs.id = ic.canonical_subject_id
     LEFT JOIN grades g ON g.id = ic.grade_id
     LEFT JOIN structure_versions sv ON sv.id = ic.base_structure_version_id
     LEFT JOIN academic_subjects asub ON asub.id = ic.base_academic_subject_id
     LEFT JOIN academic_programmes ap ON ap.id = asub.programme_id
     WHERE ic.institution_id = $1 AND ic.status = 'ACTIVE'
     ORDER BY ic.created_at DESC`,
    [institutionId]
  )).rows as any[];

  const curricula = rows.map((r) => ({
    curriculumId: r.id as string,
    programme: (r.programme_name || r.programme_label || labels.general) as string,
    version: [r.version_label || r.title, r.academic_year].filter(Boolean).join(' · '),
    grade: (r.grade_name || labels.allGrades) as string,
    subject: r.subject_name ? `${r.subject_name}${r.level ? ` ${r.level}` : ''}` : (r.canonical_subject_name as string),
    hasPublishedBase: Boolean(r.base_structure_version_id),
  }));
  const ranked = [...rows].sort((a, b) => Number(Boolean(b.base_structure_version_id)) - Number(Boolean(a.base_structure_version_id)) || Number(Boolean(b.grade_id)) - Number(Boolean(a.grade_id)));
  const chosen = rows.find((r) => r.id === requested.curriculum) ?? ranked[0] ?? null;
  const period = (INTELLIGENCE_PERIODS as readonly string[]).includes(requested.period ?? '') ? (requested.period as IntelligencePeriod) : 'current';
  const origin = requested.origin === 'INSTITUTION' || requested.origin === 'TEACHER' ? requested.origin : null;
  if (!chosen) return { curricula, selected: null, structureVersionId: null, period, classes: [], classId: null, exams: [], examVersionId: null, origin };

  const [classes, exams] = await Promise.all([
    db.query(
      `SELECT id, name FROM classes WHERE institution_id = $1 AND canonical_subject_id = $2 AND ($3::uuid IS NULL OR grade_id = $3) ORDER BY name`,
      [institutionId, chosen.canonical_subject_id, chosen.grade_id]
    ),
    db.query(
      `SELECT DISTINCT ev.id, ed.name, ev.version_label
       FROM exam_versions ev JOIN exam_definitions ed ON ed.id = ev.exam_definition_id
       JOIN assessment_blueprints b ON b.exam_version_id = ev.id
       JOIN blueprint_objective_targets bot ON bot.blueprint_id = b.id
       JOIN learning_objectives lo ON lo.id = bot.learning_objective_id
       JOIN structure_nodes sn ON sn.id = lo.structure_node_id
       WHERE ev.status = 'PUBLISHED' AND ${studentVisibleDefinitionSql('ed')} AND (
         ($1::uuid IS NOT NULL AND sn.structure_version_id = $1)
         OR ($1::uuid IS NULL AND EXISTS (SELECT 1 FROM objective_concept_mappings ocm JOIN canonical_concepts cc ON cc.id = ocm.canonical_concept_id
                                          WHERE ocm.learning_objective_id = lo.id AND ocm.status = 'PUBLISHED' AND cc.canonical_subject_id = $2)))
       ORDER BY ed.name`,
      [chosen.base_structure_version_id, chosen.canonical_subject_id]
    ),
  ]);
  const classOptions = classes.rows.map((c: any) => ({ id: c.id, name: c.name }));
  const examOptions = exams.rows.map((e: any) => ({ id: e.id, label: e.version_label ? `${e.name} · ${e.version_label}` : e.name }));
  const selected = curricula.find((c) => c.curriculumId === chosen.id)!;
  return {
    curricula,
    selected: { ...selected, canonicalSubjectId: chosen.canonical_subject_id, gradeId: chosen.grade_id },
    structureVersionId: chosen.base_structure_version_id,
    period,
    classes: classOptions,
    classId: classOptions.some((c) => c.id === requested.classId) ? requested.classId! : null,
    exams: examOptions,
    examVersionId: examOptions.find((e) => e.id === requested.exam)?.id ?? examOptions[0]?.id ?? null,
    origin,
  };
}

/**
 * Curriculum work coverage (aggregated, institution-scoped): of the
 * curriculum's ACTIVE concepts, which are in some class plan of the
 * institution's matching classes, and in how many of those classes'
 * ACTIVE students' personal plans. Counts only -- never per-learner data.
 */
export async function getCurriculumWorkCoverage(institutionId: string, curriculumId: string, locale: string) {
  const r = await db.query(
    `WITH cur AS (SELECT * FROM institution_curricula WHERE id = $1 AND institution_id = $2),
          k AS (SELECT c.id FROM classes c, cur WHERE c.institution_id = cur.institution_id AND c.canonical_subject_id = cur.canonical_subject_id AND (cur.grade_id IS NULL OR c.grade_id = cur.grade_id)),
          learners AS (SELECT DISTINCT ce.student_id FROM class_enrollments ce WHERE ce.class_id IN (SELECT id FROM k) AND ce.status = 'ACTIVE')
     SELECT icc.canonical_concept_id, icc.classification,
            COALESCE(l.label, cc.name) AS label,
            (SELECT COUNT(DISTINCT cpc.class_id) FROM class_plan_concepts cpc WHERE cpc.canonical_concept_id = icc.canonical_concept_id AND cpc.status = 'ACTIVE' AND cpc.class_id IN (SELECT id FROM k))::int AS classes,
            (SELECT COUNT(*) FROM student_plan_entries e WHERE e.canonical_concept_id = icc.canonical_concept_id AND e.plan_status = 'IN_PLAN' AND e.student_id IN (SELECT student_id FROM learners))::int AS students,
            (SELECT COUNT(*) FROM learners)::int AS learner_total
     FROM institution_curriculum_concepts icc
     JOIN cur ON cur.id = icc.curriculum_id
     JOIN canonical_concepts cc ON cc.id = icc.canonical_concept_id
     LEFT JOIN canonical_concept_localizations l ON l.canonical_concept_id = cc.id AND l.language = $3
     WHERE icc.status = 'ACTIVE'
     ORDER BY icc.order_index, cc.name`,
    [curriculumId, institutionId, locale]
  );
  const concepts = r.rows.map((x: any) => ({ conceptId: x.canonical_concept_id as string, label: x.label as string, classification: x.classification as string, classes: x.classes as number, students: x.students as number }));
  return {
    total: concepts.length,
    inClassPlans: concepts.filter((c) => c.classes > 0).length,
    inStudentPlans: concepts.filter((c) => c.students > 0).length,
    learnerTotal: (r.rows[0]?.learner_total as number) ?? 0,
    pending: concepts.filter((c) => c.classes === 0 && c.students === 0),
    concepts,
  };
}

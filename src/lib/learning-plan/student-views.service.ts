/**
 * Track A -- the Student's "Explorar currículo" view: the suggested
 * curriculum for a subject (context-resolved or general) overlaid with the
 * learner's own plan, recommendations and institution classification.
 * Read-only; "available" is never "in plan".
 */
import { db } from '@/lib/db';
import { catalogSubject, SUBJECT_CATALOG } from '@/lib/experience/subject-catalog';
import type { PedagogicalStage } from '@/lib/pedagogical-engine/types';
import { getPersonalPlan, type DisplayPlanStatus } from './personal-plan.service';
import { resolveCurriculumContext, getBaseCurriculum, studentCatalogSubjects, canonicalSubjectIdsForCatalogKey, type ContextReason, type CurriculumOption } from './curriculum.service';
import { getStudentRecommendations } from './recommendations.service';
import { curriculumForClass, type CurriculumClassification } from './institution-curriculum.service';
import { canonicalConceptLabels } from './labels';

export interface ExploreConcept {
  canonicalConceptId: string;
  label: string;
  status: DisplayPlanStatus | null;
  stage: PedagogicalStage | null;
  learnerConceptId: string | null;
  recommended: boolean;
  classification: CurriculumClassification | null;
  prerequisiteLabels: string[];
}

export interface StudentCurriculumView {
  subjects: Array<{ catalogKey: string; name: string; own: boolean }>;
  selected: string | null;
  context: CurriculumOption | null;
  options: CurriculumOption[];
  reason: ContextReason | null;
  areas: Array<{ label: string; concepts: ExploreConcept[] }>;
  counts: { available: number; inPlan: number; recommended: number; completed: number };
}

export async function getStudentCurriculumView(studentId: string, requestedKey: string | null, requestedContext: string | null, locale: string): Promise<StudentCurriculumView> {
  const own = await studentCatalogSubjects(studentId);
  const subjects: StudentCurriculumView['subjects'] = [];
  for (const s of own) if (s.catalogKey && !subjects.some((x) => x.catalogKey === s.catalogKey)) subjects.push({ catalogKey: s.catalogKey, name: s.name, own: true });
  for (const entry of SUBJECT_CATALOG) {
    if (subjects.some((x) => x.catalogKey === entry.key)) continue;
    if ((await canonicalSubjectIdsForCatalogKey(entry.key)).length === 0) continue;
    subjects.push({ catalogKey: entry.key, name: (entry.names as Record<string, string>)[locale] ?? entry.names.en, own: false });
  }
  const selected = subjects.find((s) => s.catalogKey === requestedKey)?.catalogKey ?? subjects[0]?.catalogKey ?? null;
  if (!selected || !catalogSubject(selected)) {
    return { subjects, selected: null, context: null, options: [], reason: null, areas: [], counts: { available: 0, inPlan: 0, recommended: 0, completed: 0 } };
  }
  const { context, options, reason } = await resolveCurriculumContext(studentId, selected, requestedContext);
  const [curriculum, plan, recommendations, classes] = await Promise.all([
    getBaseCurriculum(selected, context, locale),
    getPersonalPlan(studentId, locale),
    getStudentRecommendations(studentId, locale),
    db.query(`SELECT class_id FROM class_enrollments WHERE student_id = $1 AND status = 'ACTIVE'`, [studentId]),
  ]);
  const classification = new Map<string, CurriculumClassification>();
  for (const k of classes.rows) {
    const c = await curriculumForClass(k.class_id);
    for (const [id, value] of c?.classifications ?? []) if (!classification.has(id)) classification.set(id, value);
  }
  const entries = new Map(plan.entries.map((e) => [e.canonicalConceptId, e]));
  const recommended = new Set(recommendations.filter((r) => !r.inPlan).map((r) => r.canonicalConceptId));
  const prereqLabels = await canonicalConceptLabels(curriculum.concepts.flatMap((c) => c.prerequisiteIds), locale);
  const areas = curriculum.areas.map((a) => ({
    label: a.label,
    concepts: a.concepts.map((c) => {
      const e = entries.get(c.canonicalConceptId);
      return {
        canonicalConceptId: c.canonicalConceptId,
        label: c.label,
        status: e?.displayStatus ?? null,
        stage: e?.stage ?? null,
        learnerConceptId: e?.learnerConceptId ?? null,
        recommended: recommended.has(c.canonicalConceptId),
        classification: classification.get(c.canonicalConceptId) ?? null,
        prerequisiteLabels: c.prerequisiteIds.map((id) => prereqLabels.get(id) ?? ''),
      };
    }),
  }));
  const all = areas.flatMap((a) => a.concepts);
  return {
    subjects,
    selected,
    context,
    options,
    reason,
    areas,
    counts: {
      available: all.length,
      inPlan: all.filter((c) => c.status && c.status !== 'ARCHIVED').length,
      recommended: all.filter((c) => c.recommended).length,
      completed: all.filter((c) => c.status === 'COMPLETED' || c.status === 'MAINTENANCE').length,
    },
  };
}

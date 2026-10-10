/**
 * Exam preparation -- data for "Preparaciones recomendadas para ti" (server).
 *
 * Every objective comes with its ELIGIBILITY for this Student (eligibility/rules.ts):
 * the page shows the recommended ones by default, each with a short reason
 * ("Disponible porque sigues Cambridge IGCSE", "Asignado por tu institución"),
 * and the rest of the catalogue only when the Student explicitly asks for
 * another preparation. Eligibility never blocks a choice the Student makes on
 * purpose, never changes readiness, scoring or evidence, and never forces an
 * institution's curriculum on the Student.
 */
import { db } from '@/lib/db';
import { getMessages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { examObjectives, familyOfFramework, OBJECTIVE_FRAMEWORKS, type ObjectiveFramework } from './objective-catalog';
import { presentObjective } from './objective-display';
import { allObjectiveCapabilities } from './preparation.service';
import { objectiveStatusKey } from './capabilities';
import { resolveStudentExamEligibility } from '../eligibility/eligibility.service';
import type { EligibilityReason, ObjectiveEligibility } from '../eligibility/rules';

/** One reason, in the Student's language and without internal mapping terms. */
export function reasonText(r: EligibilityReason, t: Record<string, string>, opts: { subjectLevel: boolean }): string {
  const params = { programme: r.programme ?? '', subject: r.subject ?? '', class: r.className ?? '' };
  switch (r.code) {
    case 'INSTITUTION_ASSIGNED':
      return fillMessage(t['elig.reason.INSTITUTION_ASSIGNED'], params);
    case 'CURRICULUM_SUBJECT':
      if (opts.subjectLevel && r.subject) return fillMessage(t[r.className ? 'elig.reason.CLASS_SUBJECT' : 'elig.reason.CURRICULUM_SUBJECT'], params);
      return fillMessage(t[r.className ? 'elig.reason.CLASS_CURRICULUM' : 'elig.reason.CURRICULUM'], params);
    case 'CURRICULUM':
      return fillMessage(t[r.className ? 'elig.reason.CLASS_CURRICULUM' : 'elig.reason.CURRICULUM'], params);
    case 'COUNTRY_GRADE':
      return t['elig.reason.COUNTRY_GRADE'];
    case 'GRADE':
      return t['elig.reason.GRADE'];
  }
}

/** REM-T1-04 (pure): the objective matches a subject of the Student's personal Academic Profile. */
export function isPersonalProfileSubject(reasons: readonly EligibilityReason[]): boolean {
  return reasons.some((r) => r.code === 'CURRICULUM_SUBJECT' && !!r.subject && !r.className);
}

/** Frameworks with a recommended objective, most specific to the Student first (pure). */
export function orderFrameworks(eligibility: ObjectiveEligibility[]): ObjectiveFramework[] {
  const best = new Map<ObjectiveFramework, number>();
  for (const e of eligibility) if (e.eligible) best.set(e.framework, Math.min(best.get(e.framework) ?? 99, e.rank));
  return OBJECTIVE_FRAMEWORKS.map((f) => f.key).filter((k) => best.has(k)).sort((a, b) => best.get(a)! - best.get(b)!);
}

export async function loadPickerData(studentId: string, language: string) {
  const t = getMessages(language) as Record<string, string>;
  const objectives = examObjectives();
  const [caps, mine, eligibility] = await Promise.all([
    allObjectiveCapabilities(language),
    db.query(`SELECT id, objective_key FROM student_exam_profiles WHERE student_id = $1 AND status <> 'ARCHIVED' AND objective_key IS NOT NULL`, [studentId]),
    resolveStudentExamEligibility(studentId, objectives),
  ]);
  const myByKey = new Map(mine.rows.map((r: any) => [r.objective_key as string, r.id as string]));
  const list = objectives.map((o) => ({ o, e: eligibility.byKey.get(o.key)! }));
  const recommendedFrameworks = orderFrameworks(list.map((x) => x.e));

  // Framework card reason: the most specific reason among its recommended objectives, at programme level.
  const frameworkReasons: Record<string, string> = {};
  for (const f of recommendedFrameworks) {
    const top = list.filter((x) => x.o.framework === f && x.e.eligible).sort((a, b) => a.e.rank - b.e.rank)[0];
    const r = top?.e.reasons[0];
    if (r) frameworkReasons[f] = reasonText(r, t, { subjectLevel: false });
  }

  const strip = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const rows = list
    .map(({ o, e }, index) => ({ o, e, index, shown: presentObjective(o, language), official: presentObjective(o, 'en') }))
    .map(({ o, e, index, shown, official }) => ({
      row: {
        key: o.key,
        framework: o.framework,
        kind: o.kind,
        label: shown.label,
        context: o.context,
        status: objectiveStatusKey(caps.get(o.key)!),
        preparationId: myByKey.get(o.key) ?? null,
        // Search covers subject, variant, level (name and code: "superior", "ns", "hl"), syllabus code (catalogue text),
        // the label and canonical subject in the interface locale, and the official English label.
        searchText: `${o.searchText} ${strip(shown.label)} ${strip(shown.groupLabel ?? '')} ${strip(official.label)}`,
        groupKey: shown.groupKey,
        groupLabel: shown.groupLabel,
        // Micro-delta M04: the course and level as displayed, for typeahead suggestions.
        // M03c: catalogue group names in the interface locale (the stored context keeps its own values).
        groupNames: shown.groups,
        subjectLabel: shown.subject,
        levelLabel: shown.level,
        recommended: e.eligible,
        reason: e.reasons[0] ? reasonText(e.reasons[0], t, { subjectLevel: true }) : null,
        // REM-T1-04: one of the subjects the Student selected in their PERSONAL Academic Profile (not a class's):
        // shown first in its framework, before "Explore all ... options".
        yourSubject: isPersonalProfileSubject(e.reasons),
      },
      rank: e.eligible ? e.rank : 99,
      index,
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.row);

  return {
    frameworks: OBJECTIVE_FRAMEWORKS.map((f) => ({ ...f, family: familyOfFramework(f.key) })),
    /** Frameworks with at least one recommended objective, most specific first. */
    suggested: recommendedFrameworks,
    frameworkReasons,
    hasAcademicContext: eligibility.context.profileCompleted || eligibility.context.programmes.length > 0 || eligibility.context.assignments.length > 0,
    objectives: rows,
  };
}

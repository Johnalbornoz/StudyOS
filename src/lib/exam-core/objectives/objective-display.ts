/**
 * T1 final delta (B2 / G) -- how ONE catalogue objective is displayed and grouped (pure; no I/O).
 *
 *   - label: IB subjects use the IB's official subject name in the interface locale, and the level in
 *     that locale with its published code kept ("Nivel Superior (NS)" / "Higher Level (HL)"). Every other
 *     objective keeps its catalogue label (Cambridge syllabus title + syllabus code + level, test names).
 *   - group: the objective's CANONICAL subject (subject-localization.ts), resolved from the catalogue's
 *     own identifiers -- "Mathematics · 4 options" holds AA HL / AA SL / AI HL / AI SL. Never string matching.
 *
 * Display only: objective keys, node keys and stored objective_context never change with the locale.
 */
import { objectiveByKey, type ExamObjective } from './objective-catalog';
import { canonicalSubjectLabel, canonicalSubjectOf, ibSubjectKeyOfNode, ibSubjectLabel } from '../catalog/subject-localization';

const IB_LEVELS: Record<'hl' | 'sl', { es: string; en: string }> = {
  hl: { es: 'Nivel Superior (NS)', en: 'Higher Level (HL)' },
  sl: { es: 'Nivel Medio (NM)', en: 'Standard Level (SL)' },
};

export interface ObjectivePresentation {
  label: string;
  /** The subject name alone, in the interface locale (null for tests / programme plans). */
  subject: string | null;
  /** The level / variant as displayed (null when the objective has none). */
  level: string | null;
  groupKey: string | null;
  groupLabel: string | null;
  /** The catalogue groups the objective sits in ("Group 1: Mathematics and Sciences"), in the interface locale. */
  groups: string[];
}

export function presentObjective(o: Pick<ExamObjective, 'label' | 'subjectNodeKey' | 'nodeKey' | 'context'> & { groupNames?: ExamObjective['groupNames'] }, locale: string): ObjectivePresentation {
  const groups = o.groupNames?.length ? o.groupNames.map((g) => (locale === 'es' ? g.es : g.en)) : o.context.groups;
  const ibKey = ibSubjectKeyOfNode(o.subjectNodeKey);
  let label = o.label;
  let subject = o.context.subject;
  let level = o.context.level;
  if (ibKey) {
    subject = ibSubjectLabel(ibKey, locale) ?? o.context.subject;
    const code = /\.(hl|sl)$/.exec(o.nodeKey)?.[1] as 'hl' | 'sl' | undefined;
    if (code) level = locale === 'es' ? IB_LEVELS[code].es : IB_LEVELS[code].en;
    label = [subject, level].filter(Boolean).join(' · ');
  }
  const ref = canonicalSubjectOf({ subjectNodeKey: o.subjectNodeKey, syllabusCode: o.context.syllabusCode });
  if (!ref) return { label, subject, level, groupKey: null, groupLabel: null, groups };
  return { label, subject, level, groupKey: ref.key, groupLabel: ref.canonical ? canonicalSubjectLabel(ref.key, locale) : subject, groups };
}

/** The display label of a stored objective key in the interface locale (null when the key is not in the catalogue). */
export function objectiveDisplayLabel(objectiveKey: string | null | undefined, locale: string): string | null {
  const o = objectiveKey ? objectiveByKey(objectiveKey) : null;
  return o ? presentObjective(o, locale).label : null;
}

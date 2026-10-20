/**
 * Curriculum convergence -- the curriculum context decision (pure rules, no IO).
 *
 * Curriculum resolution FAILS CLOSED. The only authority is an EXPLICIT link:
 *
 *   an academic subject the Student / their preparation names
 *     -> its PUBLISHED structure version
 *     -> PUBLISHED objective -> concept mappings into the Learn subject being viewed
 *
 * A subject that is named but does not have that chain is CURRICULUM_MAPPING_NOT_READY. Nothing here ever
 * substitutes another academic subject: not a sibling of the same programme, not the one with the most
 * mappings, not the largest structure, not a default. The order of `options` is never consulted.
 *
 * With no explicit subject for the Learn subject the result is GENERAL (no curriculum context at all: the
 * StudyUs catalogue of that same subject, never presented as the Student's curriculum).
 */

export const CURRICULUM_MAPPING_NOT_READY = 'CURRICULUM_MAPPING_NOT_READY' as const;

export type ExplicitSubjectSource = 'REQUESTED' | 'EXAM_PROFILE' | 'ACADEMIC_PROFILE';

/** An academic subject the Student explicitly points at, with what the catalogue says about it. */
export interface ExplicitAcademicSubject {
  academicSubjectId: string;
  source: ExplicitSubjectSource;
  /** false when the id names no academic subject at all. */
  exists: boolean;
  /** Does this academic subject belong to the Learn subject being resolved (canonical subject link, else its own name)? */
  belongsToCatalogSubject: boolean;
  hasPublishedVersion: boolean;
}

export type CurriculumMissingLink = 'ACADEMIC_SUBJECT' | 'PUBLISHED_STRUCTURE_VERSION' | 'CONCEPT_MAPPINGS';

export interface CurriculumNotReady {
  code: typeof CURRICULUM_MAPPING_NOT_READY;
  academicSubjectId: string;
  source: ExplicitSubjectSource;
  /** The first link of the chain that is not available. */
  missing: CurriculumMissingLink;
}

export type CurriculumDecision<O> =
  | { status: 'RESOLVED'; context: O; source: ExplicitSubjectSource; notReady: CurriculumNotReady[] }
  | { status: 'NOT_READY'; context: null; notReady: CurriculumNotReady[] }
  | { status: 'GENERAL'; context: null; notReady: [] };

/**
 * `options` are the academic subjects with a PUBLISHED mapping chain into the Learn subject; `explicit` are
 * the Student's explicit subjects in authority order (requested, exam preparations newest first, Academic
 * Profile selections in the order they were made).
 *
 * An explicit REQUESTED subject is exclusive: it resolves or it is NOT_READY (a request is never answered
 * with a different curriculum). Otherwise the first explicit subject that has the chain is the context; an
 * explicit subject of this Learn subject without the chain is reported, and when none resolves the result is
 * NOT_READY.
 */
export function decideCurriculumContext<O extends { academicSubjectId: string }>(options: readonly O[], explicit: readonly ExplicitAcademicSubject[]): CurriculumDecision<O> {
  const byId = new Map(options.map((o) => [o.academicSubjectId, o]));
  const notReadyOf = (e: ExplicitAcademicSubject): CurriculumNotReady => ({
    code: CURRICULUM_MAPPING_NOT_READY,
    academicSubjectId: e.academicSubjectId,
    source: e.source,
    missing: !e.exists ? 'ACADEMIC_SUBJECT' : !e.hasPublishedVersion ? 'PUBLISHED_STRUCTURE_VERSION' : 'CONCEPT_MAPPINGS',
  });
  const requested = explicit.find((e) => e.source === 'REQUESTED');
  if (requested) {
    const context = byId.get(requested.academicSubjectId);
    return context ? { status: 'RESOLVED', context, source: 'REQUESTED', notReady: [] } : { status: 'NOT_READY', context: null, notReady: [notReadyOf(requested)] };
  }
  const notReady: CurriculumNotReady[] = [];
  const seen = new Set<string>();
  for (const e of explicit) {
    if (seen.has(e.academicSubjectId)) continue;
    seen.add(e.academicSubjectId);
    const context = byId.get(e.academicSubjectId);
    if (context) return { status: 'RESOLVED', context, source: e.source, notReady };
    // Named, of this Learn subject, and without the chain: not ready. A subject of another Learn subject says nothing here.
    if (e.belongsToCatalogSubject) notReady.push(notReadyOf(e));
  }
  if (notReady.length > 0) return { status: 'NOT_READY', context: null, notReady };
  return { status: 'GENERAL', context: null, notReady: [] };
}

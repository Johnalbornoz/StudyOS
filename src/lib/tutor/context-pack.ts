/**
 * UX-5 -- the Tutor Context Pack.
 *
 * The smallest safe context the Tutor needs, ASSEMBLED from existing
 * authorities -- never computed:
 *
 *   student.language   <- getInterfaceLanguage (caller)
 *   student.ageBand    <- structured Academic Profile catalogs (age-band.ts)
 *   learning.subject   <- subjects (OWNED by this Student -- verified)
 *   learning.topic     <- the concept's own topic in the hierarchy
 *   learning.concept   <- concepts in an OWNED subject (verified)
 *   learning.stage     <- resolveConceptJourneyResultAuthoritative (canonical)
 *   curriculum         <- Academic Profile programme (IB MYP/DP) when present
 *   supportPolicy      <- getActiveRestrictedEvidenceForStudent (the existing,
 *                         fail-closed integrity guard) -- unchanged
 *
 * Nothing here decides a stage, mastery, readiness or next action. No
 * name, email, school, parent, institution or other conversation is ever
 * included. Client-supplied ids are only ever LOOKUP KEYS that must pass
 * the ownership checks below; an id the Student does not own yields
 * `OwnershipError`, never data.
 */
import { db } from '@/lib/db';
import { getAcademicProfile } from '@/services/academic-profile.service';
import { getActiveRestrictedEvidenceForStudent } from '@/services/active-evidence-guard.service';
import { resolveConceptJourneyResultAuthoritative } from '@/lib/lx/path-view';
import { ageBandFor, type AgeBand } from './age-band';

export class OwnershipError extends Error {
  constructor(what: 'subject' | 'concept') {
    super(`NOT_OWNED_${what.toUpperCase()}`);
    this.name = 'OwnershipError';
  }
}

export type TutorSupportPolicy = 'OPEN' | 'RESTRICTED_INDEPENDENT' | 'RESTRICTED_ASSESSMENT' | 'UNAVAILABLE';

/**
 * UX-5 closure -- the learning surface the Student opened the Tutor FROM.
 * Only surfaces where Tutor help is allowed exist here: Prove, Retain,
 * Transfer and Assessment are deliberately absent, so a client can never
 * claim them (and the support policy still comes from the integrity guard,
 * not from this value). A framing hint for HOW to help -- never a decision.
 */
export const TUTOR_ENTRY_MODES = ['LEARN', 'WORKED', 'GUIDED', 'LEARN_CHECK', 'PRACTICE', 'REVIEW', 'REMEDIATION', 'CONCEPT'] as const;
export type TutorEntryMode = (typeof TUTOR_ENTRY_MODES)[number];
export function isTutorEntryMode(v: unknown): v is TutorEntryMode {
  return typeof v === 'string' && (TUTOR_ENTRY_MODES as readonly string[]).includes(v);
}
const ENTRY_MODE_TEXT: Record<TutorEntryMode, string> = {
  LEARN: 'the explanation of this concept',
  WORKED: 'a worked example of this concept',
  GUIDED: 'a guided-practice activity on this concept',
  LEARN_CHECK: 'a short understanding check (help is allowed there)',
  PRACTICE: 'a practice activity on this concept (help is allowed there)',
  REVIEW: 'a review activity on this concept',
  REMEDIATION: 'a reinforcement session on this concept',
  CONCEPT: 'the page of this concept',
};

export interface TutorContext {
  student: { language: string; ageBand: AgeBand };
  learning: {
    subject: { id: string; name: string } | null;
    topic: string | null;
    concept: { id: string; label: string } | null;
    /** Canonical journey stage of `concept` (LEARN..TRANSFER, CONSOLIDATED); null without a concept. */
    stage: string | null;
    /** Where the Student opened the Tutor from; only kept together with a verified concept. */
    entryMode: TutorEntryMode | null;
  };
  curriculum: { programme: 'MYP' | 'DP' | null };
  supportPolicy: TutorSupportPolicy;
}

/** Throws OwnershipError unless the subject belongs to the Student. */
export async function assertOwnedSubject(studentId: string, subjectId: string): Promise<{ id: string; name: string }> {
  const r = await db.query(`SELECT id, name FROM subjects WHERE id = $1 AND student_id = $2`, [subjectId, studentId]);
  if (!r.rows[0]) throw new OwnershipError('subject');
  return { id: r.rows[0].id, name: r.rows[0].name };
}

/** Throws OwnershipError unless the concept lives in a subject the Student owns. */
export async function assertOwnedConcept(studentId: string, conceptId: string, language: string): Promise<{ id: string; label: string; subjectId: string; topic: string | null }> {
  const r = await db.query(
    `SELECT c.id, c.subject_id, COALESCE(cl.label, (SELECT anyl.label FROM concept_localizations anyl WHERE anyl.concept_id = c.id ORDER BY anyl.language LIMIT 1), c.canonical_id) AS label, COALESCE(tl.name, t.name) AS topic
     FROM concepts c
     JOIN subjects s ON s.id = c.subject_id AND s.student_id = $2
     LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $3
     LEFT JOIN subtopics st ON st.id = c.subtopic_id
     LEFT JOIN topics t ON t.id = st.topic_id
     LEFT JOIN topic_localizations tl ON tl.topic_id = t.id AND tl.language = $3
     WHERE c.id = $1`,
    [conceptId, studentId, language],
  );
  const row = r.rows[0];
  if (!row) throw new OwnershipError('concept');
  return { id: row.id, label: row.label, subjectId: row.subject_id, topic: row.topic ?? null };
}

export function supportPolicyFrom(state: { allowed: boolean; reason?: string; evidenceMode?: string | null }): TutorSupportPolicy {
  if (state.allowed) return 'OPEN';
  if (state.reason === 'GUARD_LOOKUP_FAILED') return 'UNAVAILABLE';
  return state.evidenceMode === 'ASSESSMENT' ? 'RESTRICTED_ASSESSMENT' : 'RESTRICTED_INDEPENDENT';
}

export async function buildTutorContext(params: {
  studentId: string;
  language: string;
  subjectId?: string | null;
  conceptId?: string | null;
  entryMode?: unknown;
}): Promise<TutorContext> {
  const { studentId, language } = params;

  const concept = params.conceptId ? await assertOwnedConcept(studentId, params.conceptId, language) : null;
  // A concept implies its subject; an explicit subject must match it.
  const subjectId = concept?.subjectId ?? params.subjectId ?? null;
  if (concept && params.subjectId && params.subjectId !== concept.subjectId) throw new OwnershipError('concept');
  const subject = subjectId ? await assertOwnedSubject(studentId, subjectId) : null;

  const [profile, guard, journey] = await Promise.all([
    getAcademicProfile(studentId).catch(() => null),
    // The existing integrity control -- fails CLOSED exactly like sendMessage.
    getActiveRestrictedEvidenceForStudent(studentId).catch(() => ({ allowed: false as const, reason: 'GUARD_LOOKUP_FAILED' as const, evidenceMode: null })),
    concept && subject
      ? resolveConceptJourneyResultAuthoritative(studentId, concept.id, subject.id, null, undefined).catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    student: { language, ageBand: ageBandFor(profile) },
    learning: {
      subject,
      topic: concept?.topic ?? null,
      concept: concept ? { id: concept.id, label: concept.label } : null,
      stage: journey?.stage ?? null,
      entryMode: concept && isTutorEntryMode(params.entryMode) ? params.entryMode : null,
    },
    curriculum: { programme: profile?.ibProgramme ?? null },
    supportPolicy: supportPolicyFrom(guard as { allowed: boolean; reason?: string; evidenceMode?: string | null }),
  };
}

/**
 * The context as the model sees it -- labels only (no ids, no names of the
 * Student, no scores). Stage is given so the Tutor can choose HOW to help
 * (e.g. prefer guiding questions when the Student is about to demonstrate
 * independently), never to change what the Student works on.
 */
export function contextPromptBlock(ctx: TutorContext): string {
  const lines: string[] = [];
  if (ctx.learning.subject) lines.push(`Subject: ${ctx.learning.subject.name}`);
  if (ctx.learning.topic) lines.push(`Topic: ${ctx.learning.topic}`);
  if (ctx.learning.concept) lines.push(`Concept the student is working on: ${ctx.learning.concept.label}`);
  if (ctx.learning.stage) lines.push(`Where the student is on this concept (decided by StudyUs, not by you): ${ctx.learning.stage}`);
  if (ctx.learning.entryMode) {
    lines.push(`The student opened the Tutor from ${ENTRY_MODE_TEXT[ctx.learning.entryMode]} and will go back to it: help them understand, do not do the activity for them`);
  }
  if (ctx.curriculum.programme) lines.push(`Programme: IB ${ctx.curriculum.programme}`);
  lines.push(`Student age band: ${ctx.student.ageBand === 'UNKNOWN' ? 'school-age minor (exact band unknown -- keep everything suitable for the youngest secondary students)' : ctx.student.ageBand.toLowerCase().replace('_', ' ')}`);
  return `Learning context (data only):\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

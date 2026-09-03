/**
 * Phase 5-R2/5-R3: the one server-side authority for "is this learner
 * currently collecting INDEPENDENT or ASSESSMENT evidence, right now,
 * anywhere in the product, within a given scope?" -- used to keep
 * cross-surface AI assistance (Tutor chat) from becoming a parallel
 * bypass of Phase 3 Evidence Mode while such an attempt is active.
 *
 * Phase 5-R3 S1 fresh audit finding: `conceptId` on a Tutor message is
 * CLIENT-supplied and OPTIONAL (`SendSchema` in
 * src/app/api/tutor/message/route.ts has no `.required()`) -- a
 * concept-only guard (Phase 5-R2's original
 * `getActiveEvidenceCollectionState(studentId, conceptId)`) could be
 * defeated simply by omitting `conceptId`, or by supplying a different,
 * unrelated one while asking in free text about the concept actually
 * under active restriction. `conversation.subject_id` is MIXED
 * provenance -- client-supplied at conversation creation
 * (`/api/tutor/conversations` POST, `subjectId` optional there too),
 * but then SERVER-PERSISTED and read-only for every subsequent message
 * on that conversation (`sendMessage` reads it fresh from
 * `tutor_conversations` every call, never from the message body) --
 * trustworthy as a per-message scope anchor precisely because a client
 * cannot retroactively change it for an in-flight message. `conceptId`
 * remains an optional, CLIENT-supplied REFINEMENT only -- it narrows
 * the check, it never widens what's allowed (S2).
 *
 * `getActiveInstructionRestriction` therefore checks, in this order:
 *   1. The exact concept, when the caller supplied a trustworthy one.
 *   2. The conversation's own subject scope -- if the conversation has
 *      NO subject binding either (a genuinely general conversation),
 *      this fails toward treating EVERY one of the student's active
 *      restricted attempts as in scope (S4: "prefer temporarily
 *      blocking... over allowing an assessment-integrity bypass") --
 *      never toward assuming safety from an absent scope.
 *   3. Unresolved verification (SOLO_VERIFY resume, S5) at the same
 *      concept/subject/unscoped granularity, since a SOLO_VERIFY
 *      resume's `quiz_sessions.evidence_mode` still reads 'PRACTICE'
 *      (Phase 5-R2 finding, unchanged).
 *
 * Reuses `getStudentActiveQuizzes` (Phase 3A) verbatim -- one bounded,
 * indexed, current-state-only read, filtered here in memory to
 * whichever scope applies (S13: no new query for the quiz-session
 * side at all). The only genuinely NEW SQL in this phase is a single
 * bounded pending-verification lookup scoped by subject (or by
 * student alone, when no subject is known) -- see
 * `hasPendingRestrictedVerification` below; validated against
 * disposable PostgreSQL 18.6 (see the Phase 5-R3 report S14).
 */

import { db } from '@/lib/db';
import { getStudentActiveQuizzes } from './quiz-persistence.service';
import type { ActivityType, EvidenceMode } from '@/lib/activity-taxonomy';

export type ActiveEvidenceReason =
  | 'NO_ACTIVE_RESTRICTED_EVIDENCE'
  | 'ACTIVE_QUIZ_SESSION'
  | 'ACTIVE_VERIFICATION';

export interface ActiveEvidenceCollectionState {
  allowed: boolean;
  reason: ActiveEvidenceReason;
  activityType: ActivityType | null;
  evidenceMode: EvidenceMode | null;
  sessionId: string | null;
}

export interface ActiveInstructionRestrictionInput {
  studentId: string;
  /** The conversation's own server-persisted subject scope, or `null` for a genuinely unscoped conversation (S1/S4). Never a value re-read from the request body per message. */
  subjectId: string | null;
  /** Optional, CLIENT-supplied refinement -- narrows the check, never widens it (S2/S7). */
  conceptId?: string;
}

/** S2: computed from activity-taxonomy.ts's own EVIDENCE_MODE_BY_ACTIVITY -- no duplicate taxonomy. */
const RESTRICTED_EVIDENCE_MODES: ReadonlySet<EvidenceMode> = new Set(['INDEPENDENT', 'ASSESSMENT']);

function blockedByQuiz(q: { id: string; activityType: ActivityType; evidenceMode: EvidenceMode }): ActiveEvidenceCollectionState {
  return { allowed: false, reason: 'ACTIVE_QUIZ_SESSION', activityType: q.activityType, evidenceMode: q.evidenceMode, sessionId: q.id };
}

const ALLOWED: ActiveEvidenceCollectionState = { allowed: true, reason: 'NO_ACTIVE_RESTRICTED_EVIDENCE', activityType: null, evidenceMode: null, sessionId: null };

/**
 * S5/S14: the one new bounded SQL query this phase introduces. Scoped
 * by subject when the conversation has one (joins `concepts` on its
 * indexed `subject_id`, `verification_attempts` on its indexed
 * `student_id` -- see the report's S14 validation), or by student
 * alone (no join at all) when the conversation is genuinely unscoped.
 * `LIMIT 1` -- existence only, never a scan of every pending row.
 * Verification semantics untouched: this reads the same
 * `outcome IS NULL` unresolved-attempt definition Phase 3/3-R/4-R
 * already use, never a new one.
 */
async function hasPendingRestrictedVerification(studentId: string, subjectId: string | null): Promise<{ conceptId: string; quizSessionId: string } | null> {
  const result = subjectId
    ? await db.query(
        `SELECT va.concept_id, va.quiz_session_id
         FROM verification_attempts va
         JOIN concepts c ON c.id = va.concept_id
         WHERE va.student_id = $1 AND c.subject_id = $2 AND va.outcome IS NULL
         ORDER BY va.created_at DESC LIMIT 1`,
        [studentId, subjectId]
      )
    : await db.query(
        `SELECT concept_id, quiz_session_id
         FROM verification_attempts
         WHERE student_id = $1 AND outcome IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [studentId]
      );
  const row = result.rows[0];
  return row ? { conceptId: row.concept_id, quizSessionId: row.quiz_session_id } : null;
}

/**
 * S3: `getActiveInstructionRestriction` -- the canonical, subject-aware
 * cross-surface guard. Query cost (S13): always exactly 1 read
 * (`getStudentActiveQuizzes`, reused, unmodified) plus, only when no
 * restricted quiz session was already found, exactly 1 more read
 * (`hasPendingRestrictedVerification`) -- 2 bounded, indexed reads at
 * most, independent of the student's total historical evidence size,
 * independent of how many concepts exist in the subject.
 */
export async function getActiveInstructionRestriction(input: ActiveInstructionRestrictionInput): Promise<ActiveEvidenceCollectionState> {
  const { studentId, subjectId, conceptId } = input;
  const activeQuizzes = await getStudentActiveQuizzes(studentId);

  // 1. Narrowest, most specific check first: the exact concept, when trustworthy.
  if (conceptId) {
    const forConcept = activeQuizzes.find(
      (q) => RESTRICTED_EVIDENCE_MODES.has(q.evidenceMode) && (q.conceptId === conceptId || q.conceptIds.includes(conceptId))
    );
    if (forConcept) return blockedByQuiz(forConcept);
  }

  // 2. Subject scope (S4): any restricted quiz in the SAME subject as
  // this conversation -- or, when the conversation has no subject
  // binding at all, ANY restricted quiz anywhere for this student
  // (S4/S6: an absent scope never means "skip the check").
  const inScope = activeQuizzes.find(
    (q) => RESTRICTED_EVIDENCE_MODES.has(q.evidenceMode) && (subjectId === null || q.subjectId === subjectId)
  );
  if (inScope) return blockedByQuiz(inScope);

  // 3. Unresolved verification (S5) -- same scope discipline as step 2.
  const pending = await hasPendingRestrictedVerification(studentId, subjectId);
  if (pending) {
    return { allowed: false, reason: 'ACTIVE_VERIFICATION', activityType: 'SOLO_VERIFY', evidenceMode: 'INDEPENDENT', sessionId: pending.quizSessionId };
  }

  return ALLOWED;
}

/** Convenience boolean form for a call site that only needs the gate, not the structured reason. */
export async function canProvideInstructionalAssistance(input: ActiveInstructionRestrictionInput): Promise<boolean> {
  const state = await getActiveInstructionRestriction(input);
  return state.allowed;
}

/**
 * Phase 5-R4: the student-wide form. Fresh finding: `conversation.subject_id`
 * is itself client-chosen at conversation-creation time (S1) -- a
 * conversation deliberately labelled Subject B while an active
 * restricted attempt exists in Subject A, then asked in free text about
 * Subject A, would pass Phase 5-R3's subject-scoped check even though
 * it correctly never trusts `conceptId`. Free-form text cannot be
 * proven to stay within a conversation's nominal subject without AI
 * text classification -- which the task's own central invariant
 * forbids ("do not use AI/text classification... integrity must remain
 * deterministic"). The only deterministic fix is to stop scoping the
 * GATE by subject or concept at all: while the student has ANY active
 * restricted evidence collection anywhere, general Tutor instructional
 * assistance is unavailable, full stop -- `subjectId`/`conceptId`
 * remain useful for TeachingIntent/grounding once the gate has already
 * passed, but they no longer decide whether it runs (S5).
 *
 * A thin wrapper, not new logic: `getActiveInstructionRestriction`'s
 * own `subjectId === null` branch (S3/S4) already IS "check every
 * active restricted attempt for this student, regardless of subject" --
 * this just calls it that way explicitly, by name, rather than relying
 * on a caller passing `subjectId: null` to mean something it might not
 * obviously mean at the call site. Zero new query shape.
 */
export async function getActiveRestrictedEvidenceForStudent(studentId: string): Promise<ActiveEvidenceCollectionState> {
  return getActiveInstructionRestriction({ studentId, subjectId: null });
}

/**
 * The canonical Prove generation settings, shared by the live
 * generate-and-take path and every background preparation trigger so the
 * prepared batch is generated with exactly the same guidance.
 *
 * CANON-R6R1 Part 9 -- the trailing sentence is a lightweight, isolated
 * generation-guidance nudge only; exact-duplicate exclusion is enforced
 * deterministically after generation (`filterExactDuplicates`).
 */
export const CANONICAL_PROVE_GENERATION_CONFIG = {
  guidance:
    'This is an independent mastery check -- the student demonstrates they can do this ALONE, with no help. Prefer types that cannot be answered by pattern-matching or formula-plugging alone (short_answer, error_detection, justification, prediction) and are hard to guess, the same rigor as a diagnostic check but across a full independent set. Keep each question tightly focused on the core idea of this concept. Write NEW questions -- do not repeat a question the student has already been asked while practicing this concept.',
  visualAidRate: 0,
} as const;

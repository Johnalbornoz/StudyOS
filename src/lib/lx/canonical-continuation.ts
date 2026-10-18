/**
 * C14-P1-03 -- a Learning concept the legacy ranking cannot see, but the canonical engine can act on.
 *
 * Why this exists: LEARN guided understanding (learn-guided.service.ts, operator rule 2026-10-16) records ONE
 * diagnostic learning_evidence row through `recordDiagnosticEvidence` WITHOUT any Knowledge State projection.
 * Phase 3C (adaptive-learning-orchestrator.service.ts) only builds decisions for concepts that HAVE a
 * concept_knowledge_state row. So a concept whose only evidence is a finished LEARN session has no Phase 3C
 * decision at all, while the canonical engine -- which reads learning_evidence directly and is the authority
 * for "the action" under the Canonical V2 gate -- already says PRACTICE (the concept page shows it). Today and
 * Learn then rendered "Estás al día" / "Nada pendiente" for a Student who has a real next step.
 *
 * A continuation is that concept with its canonical launch. It is offered ONLY:
 *   - under the canonical gate (the canonical engine is the authority that launches it; the Start route
 *     resolves it the same way), and
 *   - when Phase 3C has no decision of its own for the concept (its plan always wins), and
 *   - when the canonical launch is executable (READY with an activity). WAITING / CONSOLIDATED / BLOCKED /
 *     LOCKED / NOT_READY concepts are never offered.
 * Candidates come from the Learning evidence stream only (learning_evidence). Exam Prep evidence lives in
 * exam_readiness_evidence (EXAM_EVIDENCE_KNOWLEDGE_STATE=SEPARATED) and can never create a continuation.
 *
 * Pure: no IO. The snapshot boundary (learning-os-snapshot.service.ts) does the reads.
 */
import type { CanonicalLearningSession } from '@/lib/pedagogical-decision/canonical-session-launch';

export interface CanonicalContinuation {
  conceptId: string;
  subjectId: string;
  /** The canonical launch for this concept (the same `resolveCanonicalLaunch` /api/learning/session/start runs). */
  session: CanonicalLearningSession;
  /** Most recent Learning evidence on this concept (ordering only). */
  lastEvidenceAt: string;
}

export interface ContinuationCandidate {
  conceptId: string;
  subjectId: string;
  lastEvidenceAt: string;
}

/** Canonical reads per snapshot are bounded (one per candidate). */
export const MAX_CANONICAL_CONTINUATIONS = 3;

/**
 * The concepts the snapshot asks the canonical engine about: Learning-evidence concepts without a Knowledge
 * State row (the caller's query), minus every concept Phase 3C already decided on, most recent first, bounded.
 */
export function continuationCandidates(
  rows: readonly ContinuationCandidate[],
  decidedConceptIds: ReadonlySet<string>,
  max: number = MAX_CANONICAL_CONTINUATIONS
): ContinuationCandidate[] {
  const seen = new Set<string>();
  const out: ContinuationCandidate[] = [];
  const ordered = [...rows].sort((a, b) => (a.lastEvidenceAt < b.lastEvidenceAt ? 1 : a.lastEvidenceAt > b.lastEvidenceAt ? -1 : a.conceptId.localeCompare(b.conceptId)));
  for (const r of ordered) {
    if (out.length >= max) break;
    if (decidedConceptIds.has(r.conceptId) || seen.has(r.conceptId)) continue;
    seen.add(r.conceptId);
    out.push(r);
  }
  return out;
}

/** Only an executable canonical launch is a next step. */
export function isExecutableContinuation(session: CanonicalLearningSession | null | undefined): session is CanonicalLearningSession {
  return !!session && session.launchStatus === 'READY' && !!session.activityType;
}

/** Learn: this subject's continuation (the most recent one), or null. */
export function subjectContinuation(continuations: readonly CanonicalContinuation[] | null | undefined, subjectId: string): CanonicalContinuation | null {
  return (continuations ?? []).find((c) => c.subjectId === subjectId) ?? null;
}

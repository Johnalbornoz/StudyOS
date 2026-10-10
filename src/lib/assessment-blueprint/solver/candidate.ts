/**
 * B2 -- the solver's candidate: ONE shape for a question of either store, derived from QuestionCoverage (pure).
 *
 * Nothing is invented on the way in. A value the coverage reports as UNKNOWN / NOT_APPLICABLE is `null`
 * here and stays null: the solver never reads null as a default difficulty, a default duration or a
 * default mark.
 *
 * Coverage strength is the coverage's own role, never upgraded:
 *   DIRECT       the question is stated to target the concept (role PRIMARY), or it is anchored on the
 *                learning objective itself (an exam item's own objective)
 *   SUPPORTING   the concept is needed to answer, but is not what the question measures (role SUPPORTING)
 *   DERIVED      the concept is reached only through the objective <-> concept mapping (role UNSPECIFIED):
 *                useful to DISCOVER candidates, never proof that this item assesses that concept
 */
import type { ItemDimensionValues } from '@/lib/exam-core/slot-constraints';
import { questionRefKey, type QuestionCoverage, type QuestionProvenance, type QuestionRef, type QuestionStore } from '@/lib/assessment-foundation/question-coverage';

export type CoverageStrength = 'DIRECT' | 'SUPPORTING' | 'DERIVED';

export type TargetKind = 'CONCEPT' | 'OBJECTIVE';

/** `CONCEPT:<canonical concept id>` or `OBJECTIVE:<learning objective id>`: one id space for the solver. */
export const targetKey = (kind: TargetKind, id: string): string => `${kind}:${id}`;

export interface CandidateCoverage {
  targetKey: string;
  kind: TargetKind;
  id: string;
  strength: CoverageStrength;
}

export interface ExposureFacts {
  /** The Student has been delivered this question before. */
  seen: boolean;
  /** Seen inside the policy's recent window (the caller decides the window against an explicit `asOf`). */
  recent: boolean;
}

export const NO_EXPOSURE: ExposureFacts = { seen: false, recent: false };

export interface SolverCandidate {
  /** Stable canonical key: `<store>:<question id>`. The solver's tie-break and identity. */
  key: string;
  ref: QuestionRef;
  store: QuestionStore;
  coverage: CandidateCoverage[];
  /** 1-5, or null when the source does not record it. */
  difficulty: number | null;
  questionType: string | null;
  marks: number | null;
  /** null when no source records a duration (true of every item today). */
  estimatedSeconds: number | null;
  provenance: QuestionProvenance;
  exposure: ExposureFacts;
  /** Official slot matching only: the item's blueprint dimension values and its template identity. */
  dimensions?: ItemDimensionValues;
  templateKey?: string | null;
}

const ROLE_STRENGTH = { PRIMARY: 'DIRECT', SUPPORTING: 'SUPPORTING', UNSPECIFIED: 'DERIVED' } as const;

/**
 * QuestionCoverage -> SolverCandidate. The coverage already holds CANONICAL concept identities only (a
 * TRANSITIONAL or UNRESOLVED learner link produced no concept), so no identity rule is re-decided here.
 */
export function candidateFromCoverage(coverage: QuestionCoverage, extra: { exposure?: ExposureFacts; dimensions?: ItemDimensionValues; templateKey?: string | null } = {}): SolverCandidate {
  const byTarget = new Map<string, CandidateCoverage>();
  const rank: Record<CoverageStrength, number> = { DIRECT: 3, SUPPORTING: 2, DERIVED: 1 };
  const add = (c: CandidateCoverage) => {
    const prior = byTarget.get(c.targetKey);
    if (!prior || rank[c.strength] > rank[prior.strength]) byTarget.set(c.targetKey, c);
  };
  for (const c of coverage.concepts) add({ targetKey: targetKey('CONCEPT', c.canonicalConceptId), kind: 'CONCEPT', id: c.canonicalConceptId, strength: ROLE_STRENGTH[c.role] });
  // An item is anchored on its own learning objective: that is direct coverage of the OBJECTIVE (not of its concepts).
  if (coverage.learningObjectiveIds.state === 'KNOWN') for (const id of coverage.learningObjectiveIds.value) add({ targetKey: targetKey('OBJECTIVE', id), kind: 'OBJECTIVE', id, strength: 'DIRECT' });
  return {
    key: questionRefKey(coverage.ref),
    ref: coverage.ref,
    store: coverage.ref.store,
    coverage: [...byTarget.values()].sort((a, b) => a.targetKey.localeCompare(b.targetKey)),
    difficulty: coverage.difficulty.state === 'KNOWN' ? coverage.difficulty.value : null,
    questionType: coverage.questionType.state === 'KNOWN' ? coverage.questionType.value : null,
    marks: coverage.marks.state === 'KNOWN' ? coverage.marks.value : null,
    estimatedSeconds: coverage.estimatedSeconds.state === 'KNOWN' ? coverage.estimatedSeconds.value : null,
    provenance: coverage.provenance,
    exposure: extra.exposure ?? NO_EXPOSURE,
    ...(extra.dimensions ? { dimensions: extra.dimensions } : {}),
    ...(extra.templateKey !== undefined ? { templateKey: extra.templateKey } : {}),
  };
}

/** Canonical order of a candidate set: by key. Every solver entry point sorts with this before doing anything. */
export function canonicalCandidateOrder(candidates: readonly SolverCandidate[]): SolverCandidate[] {
  const seen = new Set<string>();
  const out: SolverCandidate[] = [];
  for (const c of [...candidates].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    out.push(c);
  }
  return out;
}

export const strengthOn = (candidate: SolverCandidate, key: string): CoverageStrength | null => candidate.coverage.find((c) => c.targetKey === key)?.strength ?? null;

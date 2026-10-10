/**
 * B2 -- from the solver's outcome to the canonical BlueprintResult (the B1 contract), plus the audit
 * snapshot and diagnostics (pure). No persistence: storing a snapshot belongs to B3, when an attempt exists.
 */
import { createHash } from 'crypto';
import { BlueprintResultSchema, BLUEPRINT_CONTRACT_VERSION, type BlueprintRequirement, type BlueprintResult, type BlueprintResultInput } from '@/lib/assessment-foundation/blueprint-contract';
import type { AssessmentFamily } from '@/lib/assessment-foundation/families';
import type { CurriculumScopeRef } from '@/lib/curriculum/curriculum-scope';
import type { QuestionRef } from '@/lib/assessment-foundation/question-coverage';
import { canonicalCandidateOrder, type SolverCandidate } from './solver/candidate';
import type { SolveOutcome, SolverDiagnostics, SolverPlan, UnmetRequirement } from './solver/plan';
import type { PracticeDepth } from './policy/practice-depth';

export interface EligibilitySummary {
  /** Questions offered to the pipeline. */
  total: number;
  /** Questions that passed QuestionEligibility and reached the solver. */
  eligible: number;
  /** Why the others did not, by reason. */
  rejected: Record<string, number>;
}

export interface BlueprintSnapshot {
  v: 1;
  family: AssessmentFamily;
  policy: { id: string; version: string };
  depth: PracticeDepth | null;
  curriculum: CurriculumScopeRef[];
  /** Target keys the plan asked for (`CONCEPT:<id>` / `OBJECTIVE:<id>`), or the slot ids of an official form. */
  targets: string[];
  /** Identifies the exact candidate set the selection was made from. */
  candidates: { count: number; digest: string };
  /** Identifies the learner evidence the policy read (null for a family that reads none). */
  learnerEvidence: { digest: string; asOf: string | null } | null;
  selected: Array<{ question: QuestionRef; slotIndex: number | null }>;
  unmet: UnmetRequirement[];
  status: SolveOutcome['status'];
}

export interface BlueprintSolution {
  family: AssessmentFamily;
  requirement: BlueprintRequirement | null;
  plan: SolverPlan;
  eligibility: EligibilitySummary;
  outcome: SolveOutcome;
  /** The canonical result. `result.selected.length` IS the question count; nothing else states one. */
  result: BlueprintResult;
  snapshot: BlueprintSnapshot;
  diagnostics: SolverDiagnostics & { eligibleCount: number; policyId: string; policyVersion: string };
}

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);

/** Order-independent identity of a candidate set: the same questions with the same facts give the same digest. */
export function candidateSetDigest(candidates: readonly SolverCandidate[]): string {
  return digest(
    canonicalCandidateOrder(candidates).map((c) => [c.key, c.coverage.map((x) => [x.targetKey, x.strength]), c.difficulty, c.questionType, c.marks, c.estimatedSeconds, c.provenance, c.exposure.seen, c.exposure.recent, c.templateKey ?? null, c.dimensions ?? null])
  );
}

export function evidenceDigest(needs: ReadonlyArray<{ canonicalConceptId: string; basis: unknown; priority: number }>): string {
  return digest([...needs].sort((a, b) => a.canonicalConceptId.localeCompare(b.canonicalConceptId)).map((n) => [n.canonicalConceptId, n.basis, n.priority]));
}

function planTargets(plan: SolverPlan): string[] {
  return plan.mode === 'SLOTS' ? plan.slots.map((s) => `SLOT:${s.index}`) : plan.targets.map((t) => t.targetKey).sort();
}

export function toBlueprintResult(plan: SolverPlan, outcome: SolveOutcome, policy: { id: string; version: string }): BlueprintResult {
  const concepts = new Set<string>();
  const objectives = new Set<string>();
  for (const s of outcome.selected) {
    for (const c of s.contributes) {
      if (c.counted.length === 0) continue;
      const [kind, ...rest] = c.targetKey.split(':');
      (kind === 'CONCEPT' ? concepts : objectives).add(rest.join(':'));
    }
  }
  const asked = plan.mode === 'SLOTS' ? plan.slots.length : plan.targets.length;
  const unmetSubjects = new Set(outcome.unmet.filter((u) => u.requirement !== 'IDENTITY').map((u) => u.subject));
  const satisfied = plan.mode === 'SLOTS' ? plan.slots.length - unmetSubjects.size : plan.targets.filter((t) => !unmetSubjects.has(t.targetKey)).length;
  return BlueprintResultSchema.parse({
    v: BLUEPRINT_CONTRACT_VERSION,
    family: plan.family,
    status: outcome.status,
    policy,
    selected: outcome.selected.map((s) => ({ question: s.question, slotIndex: s.slotIndex, marks: null })),
    coverage: { canonicalConceptIds: [...concepts].sort(), learningObjectiveIds: [...objectives].sort(), percent: asked > 0 ? Math.round((satisfied / asked) * 100) : null },
    unmet: outcome.unmet.map((u) => ({ constraint: `${u.requirement}:${u.cause}`, detail: `${u.subject} missing ${u.missing}`.slice(0, 300) })),
    // Count is a property of the result. Marks / minutes are stated only when every selected question records them.
    estimate: { items: outcome.selected.length, marks: outcome.marks, minutes: outcome.estimatedSeconds === null ? null : Math.round((outcome.estimatedSeconds / 60) * 10) / 10 },
    rationale: outcome.selected.map((s) => `${s.key} ${s.reasons.join(',')}`.slice(0, 300)),
  } satisfies BlueprintResultInput);
}

export function buildSolution(p: {
  requirement: BlueprintRequirement | null;
  plan: SolverPlan;
  policy: { id: string; version: string };
  depth?: PracticeDepth | null;
  candidates: readonly SolverCandidate[];
  eligibility: EligibilitySummary;
  outcome: SolveOutcome;
  curriculum?: readonly CurriculumScopeRef[];
  learnerEvidence?: { digest: string; asOf: string | null } | null;
}): BlueprintSolution {
  const result = toBlueprintResult(p.plan, p.outcome, p.policy);
  return {
    family: p.plan.family,
    requirement: p.requirement,
    plan: p.plan,
    eligibility: p.eligibility,
    outcome: p.outcome,
    result,
    snapshot: {
      v: 1,
      family: p.plan.family,
      policy: p.policy,
      depth: p.depth ?? null,
      curriculum: [...(p.curriculum ?? [])],
      targets: planTargets(p.plan),
      candidates: { count: p.candidates.length, digest: candidateSetDigest(p.candidates) },
      learnerEvidence: p.learnerEvidence ?? null,
      selected: p.outcome.selected.map((s) => ({ question: s.question, slotIndex: s.slotIndex })),
      unmet: p.outcome.unmet,
      status: p.outcome.status,
    },
    diagnostics: { ...p.outcome.diagnostics, eligibleCount: p.eligibility.eligible, policyId: p.policy.id, policyVersion: p.policy.version },
  };
}

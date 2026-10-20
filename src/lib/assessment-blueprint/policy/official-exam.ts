/**
 * B2 -- OFFICIAL_EXAM blueprint policy (pure). It optimises one thing: verified official fidelity.
 *
 * The existing official blueprint stays the authority. This adapter states its positions as a
 * BlueprintRequirement (the B1 contract) and as the solver's slot plan, one slot per position, nothing
 * added, dropped, merged or reweighted.
 *
 * Its input type carries NO learner state: not a gap, not a mastery value, not an evidence need. A
 * learner's weakness therefore cannot reach the slot requirements or the item distribution -- by
 * construction, and the tests assert it. (Which of two equally valid reviewed items is used may prefer one
 * the Student has not seen; that is exposure hygiene of the existing selector, not adaptation.)
 *
 * Whether the resulting form may be an official attempt, and of which type, is B1's decision
 * (`classifyExamFormFidelity` / `deriveInstanceAttemptType`): it is consumed here, never re-implemented.
 */
import type { FormPosition } from '@/lib/exam-core/form-assembly';
import { officialRequirementFromFormPositions, type BlueprintRequirement } from '@/lib/assessment-foundation/blueprint-contract';
import { deriveInstanceAttemptType, type FormFidelity, type InstanceAttemptDecision } from '@/lib/exam-core/form-fidelity';
import type { SlotPlan } from '../solver/plan';
import type { SolveOutcome } from '../solver/plan';

export const OFFICIAL_EXAM_POLICY = { id: 'b2-official-exam', version: '1' } as const;

export interface OfficialExamPolicyInput {
  studentId: string;
  examTargetId: string | null;
  examVersionId: string;
  blueprintId: string | null;
  /** The official blueprint's positions, exactly as the existing selector builds them. */
  positions: readonly FormPosition[];
  officialMinutes?: number | null;
}

export interface OfficialBlueprintPlan {
  requirement: BlueprintRequirement;
  plan: SlotPlan;
}

export function buildOfficialBlueprint(input: OfficialExamPolicyInput): OfficialBlueprintPlan {
  const requirement = officialRequirementFromFormPositions({
    studentId: input.studentId,
    examTargetId: input.examTargetId,
    examVersionId: input.examVersionId,
    blueprintId: input.blueprintId,
    positions: input.positions,
    policy: OFFICIAL_EXAM_POLICY,
    officialMinutes: input.officialMinutes ?? null,
  });
  const plan: SlotPlan = {
    mode: 'SLOTS',
    family: 'OFFICIAL_EXAM',
    slots: [...input.positions]
      .sort((a, b) => a.index - b.index)
      .map((p) => ({
        index: p.index,
        blueprintObjectiveTargetId: p.blueprintObjectiveTargetId,
        assessmentComponentId: p.assessmentComponentId,
        learningObjectiveId: p.learningObjectiveId,
        questionType: p.questionType,
        difficultyRange: p.difficultyRange,
        constraints: [...(p.constraints ?? [])],
      })),
    soft: { avoidSeen: true },
  };
  return { requirement, plan };
}

/**
 * May a solved official form become an official attempt, and of which stored type? The B1 rule, applied:
 * an incomplete selection is not an official form at all; a complete one is FULL_MOCK / REDUCED_MOCK /
 * not startable exactly as B1 decides from the form's verified fidelity.
 */
export function officialAttemptDecision(outcome: Pick<SolveOutcome, 'status'>, fidelity: FormFidelity | null, difficultyBandMet: boolean | null): InstanceAttemptDecision | { startable: false; reason: 'INSUFFICIENT_COVERAGE'; fidelityReasons: [] } {
  if (outcome.status !== 'READY') return { startable: false, reason: 'INSUFFICIENT_COVERAGE', fidelityReasons: [] };
  return deriveInstanceAttemptType({ mode: 'MOCK', fidelity, difficultyBandMet });
}

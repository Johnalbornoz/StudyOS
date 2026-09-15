/**
 * CANON-R4 Part 20/21 -- ENGINE INTERFACE COMPATIBILITY.
 *
 * DOCUMENTED FINDING: `PedagogicalEngineInput`
 * (`src/lib/pedagogical-engine/types.ts`) has NO primitive for "this
 * requirement is already satisfied, but not by a `RawEvidenceItem`."
 * The engine's own `qualifyEvidence` is the ONLY path to
 * `SATISFIED` for any requirement -- there is no
 * `recognizedPrerequisites`-shaped input field, and adding one would be
 * a genuine v1 policy/semantics change (exactly what CANON-R4's own
 * "Engine Freeze Rule," Part 21, forbids doing silently).
 *
 * Per that same instruction ("If the current frozen engine input cannot
 * represent recognition cleanly without fake evidence: STOP and document
 * the minimal interface gap. Do NOT silently inject fabricated rows."),
 * this module does exactly that: it STOPS at the engine's real boundary.
 * `composeEffectiveMigratedDecision` never constructs a fake
 * `RawEvidenceItem` and never calls `evaluateCanonicalLearningState`
 * with anything but real evidence. Instead, it runs the frozen engine
 * completely normally on whatever real v1-qualifying evidence exists
 * (likely none, for most concepts, until v1 cutover), then combines that
 * untouched engine decision with a separately-computed
 * `MigrationBaseline` -- entirely OUTSIDE and AFTER the engine call.
 *
 * `engineInterfaceNote: 'ENGINE_INTERFACE_EXTENSION_REQUIRED'` on every
 * result is the permanent, load-bearing label for this gap. A future,
 * narrowly-reviewed phase (candidate: CANON-R4R1) could propose an
 * actual engine input extension -- that decision is explicitly NOT made
 * here.
 */
import { STAGE_ORDER, type CanonicalPedagogicalDecision, type PedagogicalStage } from '@/lib/pedagogical-engine';
import type { EffectiveMigratedState, EffectiveRequirementView, MigrationBaseline } from './types';

export function composeEffectiveMigratedDecision(params: {
  conceptId: string;
  studentId: string;
  /** The frozen engine's OWN, unmodified decision -- computed by the caller from real evidence only, never touched by this function. */
  engineDecision: CanonicalPedagogicalDecision;
  migrationBaseline: MigrationBaseline;
  activeCriticalMisconception: boolean;
}): EffectiveMigratedState {
  const { conceptId, studentId, engineDecision, migrationBaseline, activeCriticalMisconception } = params;
  const recognizedSet = new Set(migrationBaseline.recognizedRequirements.map((r) => r.requirement));

  const perRequirement: EffectiveRequirementView[] = STAGE_ORDER.map((requirement) => {
    const engineRequirement = engineDecision.requirements.find((r) => r.stage === requirement);
    const satisfiedByV1Evidence = engineRequirement?.status === 'SATISFIED';
    const satisfiedByLegacyRecognition = recognizedSet.has(requirement);
    const satisfied = satisfiedByV1Evidence || satisfiedByLegacyRecognition;
    return {
      requirement,
      satisfied,
      basis: satisfiedByV1Evidence ? 'V1_EVIDENCE' : satisfiedByLegacyRecognition ? 'LEGACY_POLICY_RECOGNITION' : null,
    };
  });

  const firstUnsatisfied = perRequirement.find((r) => !r.satisfied);
  let effectiveStage: PedagogicalStage = firstUnsatisfied ? firstUnsatisfied.requirement : 'CONSOLIDATED';
  // Mirrors the frozen engine's own precedent exactly (CANON-R2 report):
  // a CURRENT, live critical misconception blocks everything except a
  // journey that has not even started.
  if (activeCriticalMisconception && effectiveStage !== 'LEARN') {
    effectiveStage = 'PRACTICE';
  }

  return {
    conceptId,
    studentId,
    effectiveStage,
    perRequirement,
    engineInterfaceNote: 'ENGINE_INTERFACE_EXTENSION_REQUIRED',
  };
}

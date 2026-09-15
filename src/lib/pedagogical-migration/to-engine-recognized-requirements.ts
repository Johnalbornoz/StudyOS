/**
 * CANON-R4R1 Part 9/16 -- converts this layer's own `RequirementRecognition[]`
 * (a `MigrationBaseline`'s output) into the frozen engine's
 * `RecognizedRequirement[]` input shape. Pure, one-way, lossless where
 * it matters (`requirement`, `basis`, `reasonCode`, and a timestamp
 * anchor all carry straight through) -- NEVER constructs a
 * `RawEvidenceItem`.
 *
 * This is the ONE call that makes "real v1 evidence + legacy
 * recognition -> ONE Pedagogical Engine call -> ONE canonical decision"
 * (Part 16's own certification requirement) directly representable,
 * superseding CANON-R4's `composeEffectiveMigratedDecision` as the
 * canonical path (that function remains for side-by-side comparison
 * only -- see the CANON-R4R1 report's ENGINE INPUT EXTENSION section).
 */
import type { RecognizedRequirement } from '@/lib/pedagogical-engine';
import type { RequirementRecognition } from './types';

export function toEngineRecognizedRequirements(recognitions: RequirementRecognition[]): RecognizedRequirement[] {
  return recognitions.map((r) => ({
    requirement: r.requirement,
    basis: r.basis,
    recognitionId: r.id,
    reasonCode: r.reasonCode,
    recognizedAt: r.recognizedAtMigration,
  }));
}

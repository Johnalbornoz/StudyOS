/**
 * The competence x content cells DECLARED by the Saber 11 Matemáticas V2.1 blueprint (50 required slots),
 * read from the vertical configuration itself (never re-typed), as slot signatures.
 */
import { SABER11_MATH_V2 } from '../../verticals/v2/saber11-math';
import { constraintSignature, type SlotConstraint } from '../../slot-constraints';

export function saber11V21DeclaredCells(): Map<string, { objectiveCode: string; count: number }> {
  const out = new Map<string, { objectiveCode: string; count: number }>();
  for (const s of SABER11_MATH_V2.sections ?? []) {
    for (const o of s.objectives ?? []) {
      for (const t of (o as { targets?: Array<{ constraints?: SlotConstraint[]; count?: number }> }).targets ?? []) {
        if (t.constraints?.length) out.set(constraintSignature(t.constraints), { objectiveCode: o.code, count: t.count ?? 0 });
      }
    }
  }
  return out;
}

/**
 * Curriculum convergence -- the governed list of REVIEWED canonical concept aliases (pure data, no IO).
 *
 * An alias states: "this label, typed by a Student in a subject of this canonical subject, means this canonical
 * concept". It is the only ground besides the canonical name itself on which a Student label resolves
 * (catalog-resolution.ts). Every entry is a reviewed decision with its record; the list changes only by review,
 * and a change is a new `version`, never an edit. Nothing here is produced by similarity or by a model.
 *
 * The target is named by its governed stable id where one is certified (PAA: paa-certified-concepts.ts) and is
 * found in the database by canonical subject + canonical name. Applied by
 * `applyReviewedConceptAliases` (catalog/concept-alias.service.ts) into `canonical_concept_aliases`.
 */
export interface ReviewedConceptAlias {
  language: string;
  label: string;
  /** Governed stable id of the target concept (null when the concept has none). */
  stableConceptId: string | null;
  canonicalSubject: string;
  canonicalName: string;
  rationale: string;
  /** The decision record: who reviewed it and where the decision is written. */
  reviewReference: string;
  reviewedAt: string;
  version: number;
}

export const REVIEWED_CONCEPT_ALIASES: readonly ReviewedConceptAlias[] = [
  {
    language: 'es',
    label: 'Exponenciación',
    stableConceptId: 'math.num.powers-scientific-notation',
    canonicalSubject: 'Matemáticas',
    canonicalName: 'Potencias, exponentes enteros y notación científica',
    rationale: 'Exponentiation (raising to a power) is the operation the certified concept "Potencias, exponentes enteros y notación científica" covers (PAA Aritmética, topic "Exponentes enteros").',
    reviewReference: 'John Albornoz, product decision 2026-10-12 (Preview curriculum convergence, B7): "Exponenciación" -> math.num.powers-scientific-notation',
    reviewedAt: '2026-10-12T00:00:00Z',
    version: 1,
  },
];

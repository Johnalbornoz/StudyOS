/**
 * Curriculum convergence -- how a Student's own concept label resolves to a canonical concept (pure rules, no IO).
 *
 * Accepted grounds, in this order, inside the canonical subject that has the Student subject's name:
 *   A. EXACT_LABEL_MATCH  the label is the canonical concept's name;
 *   B. REVIEWED_ALIAS     an ACTIVE reviewed alias of that canonical subject carries the label.
 * Anything else FAILS CLOSED: the concept stays UNRESOLVED (a personal concept). There is no similarity,
 * no partial match, no other subject and no default. Several candidates on one ground are AMBIGUOUS -- none
 * is picked.
 */
export type CatalogResolution =
  | { status: 'MATCHED'; canonicalConceptId: string; method: 'EXACT_LABEL_MATCH'; aliasId: null; candidates: string[] }
  | { status: 'MATCHED'; canonicalConceptId: string; method: 'REVIEWED_ALIAS'; aliasId: string; candidates: string[] }
  | { status: 'AMBIGUOUS'; canonicalConceptId: null; method: null; aliasId: null; candidates: string[] }
  | { status: 'UNRESOLVED'; canonicalConceptId: null; method: null; aliasId: null; candidates: [] };

export function decideCatalogResolution(exactCanonicalConceptIds: readonly string[], aliases: ReadonlyArray<{ aliasId: string; canonicalConceptId: string }>): CatalogResolution {
  const exact = [...new Set(exactCanonicalConceptIds)];
  if (exact.length === 1) return { status: 'MATCHED', canonicalConceptId: exact[0], method: 'EXACT_LABEL_MATCH', aliasId: null, candidates: exact };
  if (exact.length > 1) return { status: 'AMBIGUOUS', canonicalConceptId: null, method: null, aliasId: null, candidates: exact };
  const targets = [...new Set(aliases.map((a) => a.canonicalConceptId))];
  if (targets.length === 1) return { status: 'MATCHED', canonicalConceptId: targets[0], method: 'REVIEWED_ALIAS', aliasId: aliases.find((a) => a.canonicalConceptId === targets[0])!.aliasId, candidates: targets };
  if (targets.length > 1) return { status: 'AMBIGUOUS', canonicalConceptId: null, method: null, aliasId: null, candidates: targets };
  return { status: 'UNRESOLVED', canonicalConceptId: null, method: null, aliasId: null, candidates: [] };
}

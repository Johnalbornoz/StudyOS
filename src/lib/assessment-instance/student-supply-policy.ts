/**
 * QF V5.1 -- the supply policy of the CERTIFIED EXAM BANK (closes OE-015). Pure.
 *
 * SCOPE (Track B, 2026-10-13): this policy governs STANDARDIZED EXAM supply only. It was written as "the one
 * Student supply policy"; that reading is obsolete. Ordinary Learning and Internal Assessment (AD_HOC included)
 * have their own supply -- generated for the Student, see lib/assessment-supply/supply-boundary -- and never pass
 * through this module. "Per-Student generated inventory is never eligible" below means: never eligible AS AN
 * EXAM BANK ITEM. It says nothing about whether a Student may learn from it.
 *
 * A Student's runtime is supplied by exactly two things:
 *   1. an instance rendered on demand from a CERTIFIED core + CERTIFIED adapter + SUPPORTED (or satisfied
 *      CONDITIONAL) applicability + governed blueprint bucket + CERTIFIED renderer; or
 *   2. an already materialised instance that carries the equivalent certified lineage.
 * Nothing else is eligible. In particular, none of these ever is, whatever else is true of it:
 *   - an item with no core lineage (LEGACY item text, including every item generated before construct cores)
 *   - per-Student generated inventory
 *   - an unreviewed generated item
 *   - a fixture
 *   - an item whose reuse rights are missing
 * The supply is GLOBAL: eligibility never depends on who the Student is, so a Student with no history is
 * supplied exactly like any other.
 */
import { lineageClassOf, type ItemInstanceLineage } from './item-instance-lineage';

export const SUPPLY_REFUSALS = [
  'LEGACY_NO_CORE_LINEAGE', 'PER_STUDENT_GENERATED_INVENTORY', 'UNREVIEWED_GENERATED_ITEM', 'FIXTURE', 'RIGHTS_MISSING',
  'CORE_NOT_CERTIFIED', 'ADAPTER_NOT_CERTIFIED', 'APPLICABILITY_NOT_SUPPORTED', 'RENDERER_NOT_CERTIFIED', 'BLUEPRINT_NOT_GOVERNED', 'CERTIFICATION_VERSION_MISMATCH',
] as const;
export type SupplyRefusal = (typeof SUPPLY_REFUSALS)[number];

/** What is known about a candidate for delivery. Every fact is stated; none is defaulted to "fine". */
export interface SupplyCandidate {
  itemId: string;
  lineage: unknown;
  /** How the content came to exist. */
  origin: 'CORE_RENDERED' | 'CORE_MATERIALIZED' | 'LEGACY_GENERATED' | 'PER_STUDENT_GENERATED' | 'FIXTURE' | 'AUTHORED_WITHOUT_CORE';
  reviewed: boolean;
  rightsCleared: boolean;
}
/** The certified state of the things a lineage points at, as the registry / database records it now. */
export interface CertifiedRegistryView {
  core(familyId: string, version: string): { lifecycle: string; certificationVersion: string | null } | null;
  adapter(adapterId: string, version: string): { status: string } | null;
  applicability(familyId: string, version: string, adapterId: string): { status: string } | null;
  renderer(rendererVersion: string): { status: string } | null;
  bucketGoverned(bucketId: string): boolean;
}

export type SupplyDecision = { eligible: true; lineage: ItemInstanceLineage } | { eligible: false; reasons: SupplyRefusal[] };

export function studentSupplyDecision(candidate: SupplyCandidate, registry: CertifiedRegistryView): SupplyDecision {
  const reasons: SupplyRefusal[] = [];
  if (candidate.origin === 'PER_STUDENT_GENERATED') reasons.push('PER_STUDENT_GENERATED_INVENTORY');
  if (candidate.origin === 'FIXTURE') reasons.push('FIXTURE');
  if (!candidate.rightsCleared) reasons.push('RIGHTS_MISSING');
  if ((candidate.origin === 'LEGACY_GENERATED' || candidate.origin === 'PER_STUDENT_GENERATED') && !candidate.reviewed) reasons.push('UNREVIEWED_GENERATED_ITEM');
  if (lineageClassOf(candidate.lineage) === 'LEGACY' || (candidate.origin !== 'CORE_RENDERED' && candidate.origin !== 'CORE_MATERIALIZED')) {
    // a review, a pool membership or a rights record never substitutes for core lineage
    return { eligible: false, reasons: [...new Set<SupplyRefusal>(['LEGACY_NO_CORE_LINEAGE', ...reasons])] };
  }
  const l = candidate.lineage as ItemInstanceLineage;
  const core = registry.core(l.constructFamilyId, l.constructFamilyVersion);
  if (!core || core.lifecycle !== 'CERTIFIED') reasons.push('CORE_NOT_CERTIFIED');
  else if (core.certificationVersion !== l.certificationVersion) reasons.push('CERTIFICATION_VERSION_MISMATCH');
  if (registry.adapter(l.assessmentAdapterId, l.assessmentAdapterVersion)?.status !== 'CERTIFIED') reasons.push('ADAPTER_NOT_CERTIFIED');
  const a = registry.applicability(l.constructFamilyId, l.constructFamilyVersion, l.assessmentAdapterId);
  if (!a || (a.status !== 'SUPPORTED' && a.status !== 'CONDITIONAL')) reasons.push('APPLICABILITY_NOT_SUPPORTED');
  if (registry.renderer(l.rendererVersion)?.status !== 'CERTIFIED') reasons.push('RENDERER_NOT_CERTIFIED');
  if (!registry.bucketGoverned(l.blueprintBucketId)) reasons.push('BLUEPRINT_NOT_GOVERNED');
  return reasons.length === 0 ? { eligible: true, lineage: l } : { eligible: false, reasons };
}

/**
 * The global supply for one bucket, for any Student. `seenParameterSetIds` is the only Student-specific input and
 * it only AVOIDS repeats: it never widens what is eligible. A Student with no history gets the first eligible
 * instances in a stable order.
 */
export function supplyForStudent(candidates: readonly SupplyCandidate[], registry: CertifiedRegistryView, need: number, seenParameterSetIds: ReadonlySet<string> = new Set()): { supplied: SupplyCandidate[]; state: 'READY' | 'NOT_READY'; reason: 'INSUFFICIENT_CERTIFIED_CONTENT' | null; eligible: number } {
  const eligible = candidates
    .map((c) => ({ c, d: studentSupplyDecision(c, registry) }))
    .filter((x): x is { c: SupplyCandidate; d: Extract<SupplyDecision, { eligible: true }> } => x.d.eligible)
    .sort((x, y) => x.d.lineage.parameterSetId.localeCompare(y.d.lineage.parameterSetId) || x.c.itemId.localeCompare(y.c.itemId));
  const fresh = eligible.filter((x) => !seenParameterSetIds.has(x.d.lineage.parameterSetId));
  if (fresh.length < need) return { supplied: [], state: 'NOT_READY', reason: 'INSUFFICIENT_CERTIFIED_CONTENT', eligible: eligible.length };
  return { supplied: fresh.slice(0, need).map((x) => x.c), state: 'READY', reason: null, eligible: eligible.length };
}

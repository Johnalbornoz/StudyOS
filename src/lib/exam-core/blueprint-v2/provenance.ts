/**
 * Blueprint Engine V2 / BP-0 -- provenance and authority (decision K-05).
 *
 * Every academic value a blueprint carries (marks, weights, durations, item
 * counts, scales, boundaries, session dates) is a FACT with a provenance, or
 * it is explicitly UNKNOWN. StudyUs design choices (a reduced form, a pace,
 * a difficulty target) are a different kind of value -- STUDYUS_POLICY -- and
 * never pose as assessment data.
 *
 * The system never invents boundaries, scales, weights, session dates or
 * scoring transformations: a value without an authoritative provenance can be
 * shown for reference but cannot resolve a scoring stage. Third-party
 * references are allowed for research/design and never become official.
 */
import { ASSESSMENT_SOURCES, type AssessmentSourceSeed } from '../catalog/sources';

export const PROVENANCE_KINDS = [
  'OFFICIAL_PUBLIC',
  'OFFICIAL_LICENSED',
  'INSTITUTION_SUPPLIED',
  'VERIFIED_HISTORICAL',
  'THIRD_PARTY_REFERENCE',
  'UNKNOWN',
] as const;
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

/** Who stands behind a value. INSTITUTION authority is valid only inside that institution's scope. */
export type Authority = 'AWARDING_BODY' | 'INSTITUTION' | 'NONE';

export interface Provenance {
  kind: ProvenanceKind;
  authority: Authority;
  /** Registered source keys (catalog/sources.ts); empty only for UNKNOWN. */
  sourceKeys: string[];
}

export const UNKNOWN_PROVENANCE: Provenance = Object.freeze({ kind: 'UNKNOWN', authority: 'NONE', sourceKeys: [] }) as Provenance;

const AUTHORITY_OF: Record<ProvenanceKind, Authority> = {
  OFFICIAL_PUBLIC: 'AWARDING_BODY',
  OFFICIAL_LICENSED: 'AWARDING_BODY',
  VERIFIED_HISTORICAL: 'AWARDING_BODY',
  INSTITUTION_SUPPLIED: 'INSTITUTION',
  THIRD_PARTY_REFERENCE: 'NONE',
  UNKNOWN: 'NONE',
};

/** Strongest first. Used to pick the provenance of a value backed by several sources. */
const RANK: Record<ProvenanceKind, number> = {
  OFFICIAL_LICENSED: 0,
  OFFICIAL_PUBLIC: 1,
  VERIFIED_HISTORICAL: 2,
  INSTITUTION_SUPPLIED: 3,
  THIRD_PARTY_REFERENCE: 4,
  UNKNOWN: 5,
};

export function provenance(kind: ProvenanceKind, sourceKeys: string[] = []): Provenance {
  return { kind, authority: AUTHORITY_OF[kind], sourceKeys: [...sourceKeys].sort() };
}

/** Can this value resolve a scoring stage? Third-party references and unknowns never can. */
export function isAuthoritative(p: Provenance): boolean {
  return p.authority !== 'NONE' && p.sourceKeys.length > 0;
}

/**
 * Registry license/confidence -> provenance kind. Conservative: a LOW or
 * UNVERIFIED source is a reference, never official; GENERATED/INTERNAL
 * entries are not assessment authorities.
 */
export function provenanceKindOfSource(seed: AssessmentSourceSeed): ProvenanceKind {
  if (seed.license === 'GENERATED' || seed.license === 'INTERNAL') return 'UNKNOWN';
  if (seed.confidence === 'LOW' || seed.confidence === 'UNVERIFIED') return 'THIRD_PARTY_REFERENCE';
  return seed.license === 'LICENSED' ? 'OFFICIAL_LICENSED' : 'OFFICIAL_PUBLIC';
}

export type SourceRegistry = ReadonlyMap<string, AssessmentSourceSeed>;

let defaultRegistry: SourceRegistry | null = null;
export function defaultSourceRegistry(): SourceRegistry {
  if (!defaultRegistry) defaultRegistry = new Map(ASSESSMENT_SOURCES.map((s) => [s.key, s]));
  return defaultRegistry;
}

/**
 * Provenance of a value backed by `sourceKeys`: the strongest registered
 * source wins; unregistered keys are returned so the caller can report them.
 */
export function provenanceOfSources(sourceKeys: readonly string[], registry: SourceRegistry): { provenance: Provenance; unregistered: string[] } {
  const unregistered: string[] = [];
  let best: ProvenanceKind = 'UNKNOWN';
  const registered: string[] = [];
  for (const key of sourceKeys) {
    const seed = registry.get(key);
    if (!seed) {
      unregistered.push(key);
      continue;
    }
    registered.push(key);
    const kind = provenanceKindOfSource(seed);
    if (RANK[kind] < RANK[best]) best = kind;
  }
  if (best === 'UNKNOWN') return { provenance: UNKNOWN_PROVENANCE, unregistered };
  return { provenance: provenance(best, registered), unregistered };
}

// ---------------------------------------------------------------------------
// Values: a fact (with provenance), a StudyUs policy choice, or UNKNOWN.
// ---------------------------------------------------------------------------

export type Fact<T> =
  | { status: 'STATED'; value: T; provenance: Provenance }
  /** Not stated by any configured source. Never filled with a default. */
  | { status: 'UNKNOWN'; reason: string };

export type PolicyValue<T> = { origin: 'STUDYUS_POLICY'; value: T; note: string };

export function stated<T>(value: T, p: Provenance): Fact<T> {
  return { status: 'STATED', value, provenance: p };
}

export function unknown<T = never>(reason: string): Fact<T> {
  return { status: 'UNKNOWN', reason };
}

/** A fact that can resolve a scoring stage: stated AND authoritative. */
export function isAuthoritativeFact<T>(f: Fact<T>): f is { status: 'STATED'; value: T; provenance: Provenance } {
  return f.status === 'STATED' && isAuthoritative(f.provenance);
}

export function factValue<T>(f: Fact<T>): T | null {
  return f.status === 'STATED' ? f.value : null;
}

/**
 * Provenance of a value derived from several facts (e.g. a weighting stage
 * built from every component's weight): the WEAKEST kind wins, sources are
 * unioned. One unknown input makes the whole derivation unknown.
 */
export function combineProvenance(parts: readonly Provenance[]): Provenance {
  if (parts.length === 0) return UNKNOWN_PROVENANCE;
  let weakest: ProvenanceKind = 'OFFICIAL_LICENSED';
  const keys = new Set<string>();
  for (const p of parts) {
    if (RANK[p.kind] > RANK[weakest]) weakest = p.kind;
    for (const k of p.sourceKeys) keys.add(k);
  }
  if (weakest === 'UNKNOWN') return UNKNOWN_PROVENANCE;
  return provenance(weakest, [...keys]);
}

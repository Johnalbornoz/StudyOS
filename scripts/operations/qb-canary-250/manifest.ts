/**
 * QUESTION FACTORY CANARY 250 -- the stratified generation manifest (pure, deterministic; reads the stored artifacts
 * of earlier runs only to EXCLUDE what they used). FROZEN.
 *
 * 250 slots, one first attempt each. Every slot is a DISTINCT adaptation specification that `adapt()` accepts for
 * an explicit request (family, target, approach, band, context kind, response format): nothing is forced, and no
 * specification QB-R2D, QB-R2E or the QB-R2F selection generated from (or planned to) is used again.
 *
 * HOW THE 250 ARE CHOSEN (no hand-picked list, no randomness):
 *   1. the SPACE: every combination of the families x targets x {no approach, STEM_PLUS} x bands x context kinds
 *      x the four response formats generator version 3 has a template for, that `adapt()` accepts;
 *   2. QUOTAS per assessment system are stated below; slots are dealt to targets in a fixed interleaved order, so
 *      that any prefix of the manifest is itself spread over the systems;
 *   3. for each slot the least-used value wins, in this order: task family (over the whole manifest, then within the
 *      target), response format (within the target), learning approach (two baseline to one STEM_PLUS), difficulty
 *      band and context kind (within the target and family); remaining ties by a fixed sort key.
 *
 * WHAT THE ARCHITECTURE CANNOT SUPPLY is stated in `CANARY_UNSUPPLIED_STRATA`, not padded over.
 *
 * SLOT GUIDANCE. At 250 slots the do-not-reuse lists of QB-R2F cannot grow with the batch (prompt size is cost), so
 * each slot carries deterministic guidance instead: a scenario DOMAIN, and one PINNED parameter value (or, for the
 * claim-evaluation construct, the verdict and the number of categories) that no other slot of the same construct
 * has and no earlier run used. The batch-diversity validator still MEASURES duplicates; guidance only steers.
 */
import { adapt } from '@/lib/assessment-adaptation/adapt';
import type { AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { MATHEMATICS_ADAPTATION_POLICY } from '@/lib/assessment-adaptation/discipline-policy';
import { MATH_POC_APPLICABILITY } from '@/lib/assessment-adaptation/math-poc-applicability';
import { SCHOOL_STEM_PERFORMANCE_PROFILE } from '@/lib/assessment-adaptation/school-stem-performance';
import { EA1_COMPONENT_PROFILES, EA1_SYSTEM_PROFILES } from '@/lib/assessment-adaptation/system-profiles';
import { MATH_POC_FAMILIES } from '@/lib/exam-core/question-bank/task-families/math-poc-families';
import { mathPocFamilyEa1aOf } from '@/lib/exam-core/question-bank/task-families/math-poc-families-ea1a';
import { STEM_PLUS_APPROACH } from '@/lib/learning-approach/learning-approach-profile';
import type { SpecificationCandidate } from '@/lib/exam-core/question-bank/production/specification-candidate';

export const CANARY_MANIFEST = { id: 'qb-canary-250-manifest', version: '1' } as const;
export const CANARY_SLOTS = 250 as const;
export const CANARY_SLOT_GUIDANCE = { id: 'qb-canary-250-slot-guidance', version: '1' } as const;

/** Slots per target. The five named systems are close to equal; IB is split over its two papers; the school profile is smaller because only three families support it. */
export const CANARY_TARGET_QUOTAS: Readonly<Record<string, number>> = {
  'PAA.MATEMATICAS': 45, 'IB.MATH_AA_HL.P1': 25, 'IB.MATH_AA_HL.P2': 25, 'CAMBRIDGE.9709.P1': 45, 'PISA.MATHEMATICS': 45, 'ICFES.SABER11_MATEMATICAS': 40, SCHOOL_STEM_PERFORMANCE: 25,
};
export const CANARY_TARGET_ORDER = Object.keys(CANARY_TARGET_QUOTAS);
/** The response formats generator version 3 has a template for. */
export const CANARY_FORMATS = ['SELECTED_RESPONSE', 'NUMERIC_ENTRY', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'] as const;
export const CANARY_BANDS = ['FOUNDATIONAL', 'STANDARD', 'CHALLENGE'] as const;
export const CANARY_CONTEXTS = ['ABSTRACT', 'PERSONAL', 'OCCUPATIONAL', 'SOCIETAL', 'SCIENTIFIC'] as const;
export type CanaryApproach = 'STANDARD_BY_ABSENCE' | 'STEM_PLUS';
/** Two baseline slots to one STEM_PLUS slot. */
const APPROACH_WEIGHT: Readonly<Record<CanaryApproach, number>> = { STANDARD_BY_ABSENCE: 2, STEM_PLUS: 1 };
const LANGUAGE: Readonly<Record<string, string>> = { PAA: 'es', IB: 'en', CAMBRIDGE: 'en', PISA: 'es', ICFES: 'es', SCHOOL_STEM_PERFORMANCE: 'es' };

export const CANARY_UNSUPPLIED_STRATA: readonly string[] = [
  'DISCIPLINES: mathematics only. There is no science, language or social-science family, profile component or construct.',
  'CONCEPTS: five canonical concepts only (ratio and proportion, linear functions, quadratics, probability, data representation).',
  'TASK FAMILIES: ten families, all of lifecycle DRAFT; three of them have an EA-1A version. 250 slots over ten families is about 25 slots per family.',
  'CONSTRUCTS: one machine-checkable construct per family (ten constructs).',
  'SCHOOL: the only school profile is SCHOOL_STEM_PERFORMANCE, and only the three EA-1A families support it.',
  'COMPONENTS: one component per system, except IB with two papers (Mathematics AA HL paper 1 and paper 2). No IB paper 3, no Cambridge paper other than 9709 paper 1, no PAA or Icfes component other than mathematics.',
  'RESPONSE FORMATS: MULTI_SELECT and MATH_EXPRESSION are accepted by adapt() on PISA but generator version 3 has no template for them; they are not in the canary. Icfes is selected response only; IB, Cambridge and the school profile are constructed response only; numeric entry exists on PAA and PISA only.',
  'LEARNING APPROACH: STANDARD (recorded by absence) and STEM_PLUS only.',
  'TRANSFER: there is no transfer family. What is reported is the specification\'s own context.transfer expectation.',
  'STIMULI: tables, graphs and data sets a specification asks for as the item\'s OWN stimulus. No shared stimulus, no image, no passage.',
  'DIFFICULTY: three editorial bands (FOUNDATIONAL, STANDARD, CHALLENGE); an editorial estimate, not a calibrated difficulty.',
  'CALCULATOR: whatever the component rules; it is not a free dimension. A family that needs a tool the component forbids is refused by adapt() and is not forced.',
];

/** Scenario domains by context kind. A domain says where the situation is set; the item is the provider's to write. */
export const SCENARIO_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  PERSONAL: ['a household budget', 'a family trip', 'home cooking for guests', 'a personal savings goal', 'a mobile phone or internet plan', 'amateur sport training', 'a hobby collection', 'renting a flat', 'a school fundraising stall', 'a gym or club membership', 'a home garden', 'a birthday party', 'a cycling commute', 'a video game or streaming subscription'],
  OCCUPATIONAL: ['a bakery', 'a parcel delivery company', 'a small farm', 'a print shop', 'a taxi or ride service', 'a construction site', 'a clothing workshop', 'a restaurant kitchen', 'a call centre', 'a car repair garage', 'a fishing cooperative', 'a warehouse', 'a hotel', 'a carpentry workshop'],
  SOCIETAL: ['a city bus network', 'a municipal water supply', 'a public library', 'a recycling programme', 'a vaccination campaign', 'a neighbourhood election', 'a public park', 'a school meals programme', 'a road toll', 'an electricity tariff', 'a community health centre', 'a reforestation project', 'a public swimming pool', 'a census of a small town'],
  SCIENTIFIC: ['a chemistry laboratory', 'an ecology field survey', 'a weather station', 'a physics experiment with motion', 'a plant growth experiment', 'astronomy observations', 'a medical dosage study', 'a water quality study', 'a materials test', 'a study of an animal population', 'an energy consumption study', 'a geology survey', 'a nutrition study', 'a study of sound or light'],
};

export interface SlotGuidance {
  version: typeof CANARY_SLOT_GUIDANCE.version;
  /** null for an ABSTRACT context. */
  scenarioDomain: string | null;
  /** Declared-model parameters this slot must use exactly. Empty for the claim-evaluation construct. */
  pinnedParameters: Readonly<Record<string, number>>;
  /** Claim evaluation only: the verdict the display must give, and how many categories the display has. */
  claim: { verdict: 'SUPPORTED' | 'CONTRADICTED' | 'NOT_DECIDABLE'; categories: number } | null;
}
export const SLOT_GUIDANCE_RULE = 'slotGuidance steers this item away from every other item of the batch. Set the situation in slotGuidance.scenarioDomain (when it is not null), in the context kind the specification asks for. Use every value of slotGuidance.pinnedParameters exactly as the declared-model parameter of that name, and choose the other values so that the item is sound. When slotGuidance.claim is not null, the display must give that verdict for the statement and have that number of categories. The specification, its constraints and every rule above still apply and win over slotGuidance; nothing of slotGuidance is quoted or named in the item.' as const;

export interface CanarySlot {
  slotId: string; index: number; targetId: string; systemId: string; familyId: string; familyVersion: string; construct: string; approach: CanaryApproach;
  request: { difficultyBand: (typeof CANARY_BANDS)[number]; context: (typeof CANARY_CONTEXTS)[number]; responseFormat: (typeof CANARY_FORMATS)[number]; language: string };
  specification: AdaptationSpecification;
  guidance: SlotGuidance;
  strata: { concept: string; responseType: 'SELECTED_RESPONSE' | 'NUMERIC_ENTRY' | 'CONSTRUCTED_RESPONSE'; responseFormat: string; calculator: string; evidenceClass: EvidenceClass; evidenceActions: string; stimulus: string; band: string; contextKind: string; transfer: string; reasoningDepth: string };
}
export type EvidenceClass = 'PROCEDURAL' | 'MODELLING' | 'REASONING' | 'DATA_INTERPRETATION';
/** The class of an evidence target, by rule: EVALUATE or JUSTIFY -> REASONING; else FORMULATE -> MODELLING; else INTERPRET -> DATA_INTERPRETATION; else PROCEDURAL. */
export function evidenceClassOf(actions: readonly string[]): EvidenceClass {
  if (actions.includes('EVALUATE') || actions.includes('JUSTIFY')) return 'REASONING';
  if (actions.includes('FORMULATE')) return 'MODELLING';
  if (actions.includes('INTERPRET')) return 'DATA_INTERPRETATION';
  return 'PROCEDURAL';
}
const constructOf = (s: AdaptationSpecification): string => String((s.invariants.construct as { construct?: unknown }).construct ?? '');
const responseTypeOf = (format: string): CanarySlot['strata']['responseType'] => (format === 'SELECTED_RESPONSE' ? 'SELECTED_RESPONSE' : format === 'NUMERIC_ENTRY' ? 'NUMERIC_ENTRY' : 'CONSTRUCTED_RESPONSE');
/** The family as the canary uses it: its EA-1A version when there is one, else its EA-1 version. */
export const canaryFamilies = () => MATH_POC_FAMILIES.map((f) => mathPocFamilyEa1aOf(f.familyId) ?? f);

interface Cell { key: string; targetId: string; systemId: string; familyId: string; familyVersion: string; approach: CanaryApproach; band: (typeof CANARY_BANDS)[number]; context: (typeof CANARY_CONTEXTS)[number]; format: (typeof CANARY_FORMATS)[number]; language: string; specification: AdaptationSpecification }

/** Every cell of the space that adapt() accepts, one per distinct specification, in a fixed order. */
export function canarySpace(): Cell[] {
  const cells: Cell[] = [];
  const seen = new Set<string>();
  for (const targetId of CANARY_TARGET_ORDER) {
    const component = EA1_COMPONENT_PROFILES.find((c) => c.componentId === targetId);
    const profile = targetId === SCHOOL_STEM_PERFORMANCE_PROFILE.profileId ? SCHOOL_STEM_PERFORMANCE_PROFILE : EA1_SYSTEM_PROFILES.find((p) => p.profileId === component?.systemProfileId);
    if (!profile) throw new Error(`CANARY_TARGET_NOT_FOUND: ${targetId}`);
    const language = LANGUAGE[profile.profileId] ?? 'en';
    for (const family of canaryFamilies()) for (const approach of ['STANDARD_BY_ABSENCE', 'STEM_PLUS'] as const) for (const band of CANARY_BANDS) for (const context of CANARY_CONTEXTS) for (const format of CANARY_FORMATS) {
      const r = adapt({ family, profile, component, applicability: MATH_POC_APPLICABILITY, ...(approach === 'STEM_PLUS' ? { learningApproach: STEM_PLUS_APPROACH } : {}), disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY, request: { purpose: 'PRACTICE', difficultyBand: band, contentUseClass: 'DEV_TEST_CONTENT', language, context, responseFormat: format } });
      if (!r.ok || seen.has(r.specification.specificationId)) continue;
      seen.add(r.specification.specificationId);
      cells.push({ key: [targetId, family.familyId, approach, band, context, format].join('|'), targetId, systemId: profile.profileId, familyId: family.familyId, familyVersion: family.version, approach, band, context, format, language, specification: r.specification });
    }
  }
  return cells;
}

/** The order in which slots are dealt to targets: at every step the target furthest behind its quota. */
export function targetSequence(): string[] {
  const assigned: Record<string, number> = Object.fromEntries(CANARY_TARGET_ORDER.map((t) => [t, 0]));
  const out: string[] = [];
  for (let i = 0; i < CANARY_SLOTS; i += 1) {
    let best = CANARY_TARGET_ORDER[0], bestLag = -Infinity;
    for (const t of CANARY_TARGET_ORDER) { const lag = (CANARY_TARGET_QUOTAS[t] * (i + 1)) / CANARY_SLOTS - assigned[t]; if (lag > bestLag + 1e-12) { best = t; bestLag = lag; } }
    assigned[best] += 1;
    out.push(best);
  }
  return out;
}

export interface PriorUse { specificationIds: ReadonlySet<string>; candidates: readonly SpecificationCandidate[] }
const PINNED: Readonly<Record<string, (n: number) => Record<string, number>>> = {
  DIRECT_PROPORTION_MISSING_VALUE: (n) => ({ a: 3 + n }),
  UNIT_RATE_COMPARISON_OF_TWO_OPTIONS: (n) => ({ p1: 2 + n }),
  LINE_THROUGH_TWO_POINTS: (n) => ({ x1: -8 + (n % 17), y1: -9 + ((n * 5) % 19) }),
  LINEAR_MODEL_FIXED_START_CONSTANT_RATE: (n) => ({ m: 2 + n }),
  QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING: (n) => { const pairs: Array<[number, number]> = []; for (let a = -9; a <= 9; a += 1) for (let b = a + 1; b <= 9; b += 1) if (a !== 0 && b !== 0) pairs.push([a, b]); pairs.sort((x, y) => (((x[0] + 9) * 31 + (x[1] + 9) * 17) % 23) - (((y[0] + 9) * 31 + (y[1] + 9) * 17) % 23) || x[0] - y[0] || x[1] - y[1]); const [r1, r2] = pairs[n % pairs.length]; return { r1, r2 }; },
  QUADRATIC_MODEL_VERTEX_OPTIMUM: (n) => ({ p: 4 + 2 * n }),
  CLASSICAL_PROBABILITY_SINGLE_DRAW: (n) => ({ n: 6 + n }),
  COMPARISON_OF_TWO_CLASSICAL_PROBABILITIES: (n) => ({ n1: 8 + n }),
  RELATIVE_CHANGE_OR_SHARE_FROM_TABULATED_VALUES: (n) => ({ vi: 40 + 12 * n }),
};
const CLAIM_VERDICTS = ['SUPPORTED', 'CONTRADICTED', 'NOT_DECIDABLE'] as const;

export interface CanaryManifest { manifest: typeof CANARY_MANIFEST; slotGuidance: typeof CANARY_SLOT_GUIDANCE; slots: CanarySlot[]; spaceSize: number; excludedSpecifications: number }
export function buildCanaryManifest(prior: PriorUse): CanaryManifest {
  const space = canarySpace();
  const pool = space.filter((c) => !prior.specificationIds.has(c.specification.specificationId));
  const used = new Set<string>();
  const count = new Map<string, number>();
  const n = (k: string): number => count.get(k) ?? 0;
  const bump = (k: string): void => { count.set(k, n(k) + 1); };
  const chosen: Cell[] = [];
  for (const targetId of targetSequence()) {
    const candidates = pool.filter((c) => c.targetId === targetId && !used.has(c.key));
    if (candidates.length === 0) throw new Error(`CANARY_SPACE_EXHAUSTED: ${targetId}`);
    const rank = (c: Cell): number[] => [n(`fam|${c.familyId}`), n(`fam|${c.targetId}|${c.familyId}`), n(`fmt|${c.targetId}|${c.format}`), n(`app|${c.targetId}|${c.approach}`) / APPROACH_WEIGHT[c.approach], n(`band|${c.targetId}|${c.familyId}|${c.band}`), n(`ctx|${c.targetId}|${c.familyId}|${c.context}`), n(`band|${c.band}`), n(`ctx|${c.context}`)];
    let best = candidates[0], bestRank = rank(best);
    for (const c of candidates.slice(1)) {
      const r = rank(c);
      let cmp = 0;
      for (let i = 0; i < r.length && cmp === 0; i += 1) cmp = r[i] - bestRank[i];
      if (cmp < 0 || (cmp === 0 && c.key < best.key)) { best = c; bestRank = r; }
    }
    used.add(best.key);
    for (const k of [`fam|${best.familyId}`, `fam|${best.targetId}|${best.familyId}`, `fmt|${best.targetId}|${best.format}`, `app|${best.targetId}|${best.approach}`, `band|${best.targetId}|${best.familyId}|${best.band}`, `ctx|${best.targetId}|${best.familyId}|${best.context}`, `band|${best.band}`, `ctx|${best.context}`]) bump(k);
    chosen.push(best);
  }
  // guidance: a domain no other slot of the family and context kind has had (until the list is exhausted), and a pinned value no slot of the construct has and no earlier run used
  const ordinal = new Map<string, number>();
  const next = (k: string): number => { const v = ordinal.get(k) ?? 0; ordinal.set(k, v + 1); return v; };
  const priorValues = (construct: string, name: string): Set<number> => new Set(prior.candidates.filter((c) => c.content.declaredModel.construct === construct).map((c) => c.content.declaredModel.parameters[name]).filter((v): v is number => typeof v === 'number'));
  const slots = chosen.map((c, i): CanarySlot => {
    const s = c.specification;
    const construct = constructOf(s);
    const domains = SCENARIO_DOMAINS[c.context];
    const scenarioDomain = domains ? domains[next(`dom|${c.familyId}|${c.context}`) % domains.length] : null;
    let pinnedParameters: Record<string, number> = {};
    let claim: SlotGuidance['claim'] = null;
    if (construct === 'CLAIM_EVALUATION_AGAINST_A_DATA_DISPLAY') { const k = next(`pin|${construct}`); claim = { verdict: CLAIM_VERDICTS[k % 3], categories: 3 + (Math.floor(k / 3) % 4) }; }
    else {
      const make = PINNED[construct];
      if (!make) throw new Error(`CANARY_NO_GUIDANCE_FOR_CONSTRUCT: ${construct}`);
      // the first parameter of the guidance is the one checked against earlier runs
      for (;;) { pinnedParameters = make(next(`pin|${construct}`)); const [name, value] = Object.entries(pinnedParameters)[0]; if (!priorValues(construct, name).has(value)) break; }
    }
    const actions = s.invariants.evidenceTarget.actions as readonly string[];
    return {
      slotId: `c250-${String(i + 1).padStart(3, '0')}`, index: i + 1, targetId: c.targetId, systemId: c.systemId, familyId: c.familyId, familyVersion: c.familyVersion, construct, approach: c.approach,
      request: { difficultyBand: c.band, context: c.context, responseFormat: c.format, language: c.language }, specification: s,
      guidance: { version: CANARY_SLOT_GUIDANCE.version, scenarioDomain, pinnedParameters, claim },
      strata: { concept: s.primaryConcept.stableId, responseType: responseTypeOf(s.variable.responseFormat.format), responseFormat: s.variable.responseFormat.format, calculator: s.variable.toolPolicy.calculator, evidenceClass: evidenceClassOf(actions), evidenceActions: actions.join('+'), stimulus: s.variable.stimulus.mode === 'NONE' ? 'NONE' : s.variable.stimulus.kinds.join('+'), band: s.variable.difficulty.band, contextKind: s.variable.context.kind, transfer: s.variable.context.transfer, reasoningDepth: s.variable.reasoningDepth.depth },
    };
  });
  return { manifest: CANARY_MANIFEST, slotGuidance: CANARY_SLOT_GUIDANCE, slots, spaceSize: space.length, excludedSpecifications: space.length - pool.length };
}

const tally = <T>(xs: readonly T[], key: (x: T) => string): Record<string, number> => { const m: Record<string, number> = {}; for (const x of xs) m[key(x)] = (m[key(x)] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))); };
/** The balance report of a manifest: counts per stratum, and how many slots share a specification or a guidance value. */
export function balanceOf(m: CanaryManifest) {
  const s = m.slots;
  return {
    slots: s.length, distinctSpecifications: new Set(s.map((x) => x.specification.specificationId)).size, slotsSharingASpecification: s.length - new Set(s.map((x) => x.specification.specificationId)).size,
    distinctInvariantHashes: new Set(s.map((x) => x.specification.invariantHash)).size,
    bySystem: tally(s, (x) => x.systemId), byComponent: tally(s, (x) => x.targetId), byFamily: tally(s, (x) => x.familyId), byConcept: tally(s, (x) => x.strata.concept), byApproach: tally(s, (x) => x.approach),
    byResponseType: tally(s, (x) => x.strata.responseType), byResponseFormat: tally(s, (x) => x.strata.responseFormat), byCalculator: tally(s, (x) => x.strata.calculator), byEvidenceClass: tally(s, (x) => x.strata.evidenceClass), byEvidenceActions: tally(s, (x) => x.strata.evidenceActions),
    byStimulus: tally(s, (x) => x.strata.stimulus), byBand: tally(s, (x) => x.strata.band), byContextKind: tally(s, (x) => x.strata.contextKind), byTransfer: tally(s, (x) => x.strata.transfer), byReasoningDepth: tally(s, (x) => x.strata.reasoningDepth),
    bySystemAndResponseType: tally(s, (x) => `${x.systemId} | ${x.strata.responseType}`), byFamilyAndSystem: tally(s, (x) => `${x.familyId} | ${x.systemId}`),
    scenarioDomainReuseWithinFamilyAndContext: s.length - new Set(s.map((x) => `${x.familyId}|${x.request.context}|${x.guidance.scenarioDomain ?? x.slotId}`)).size,
    spaceSize: m.spaceSize, excludedSpecifications: m.excludedSpecifications,
  };
}

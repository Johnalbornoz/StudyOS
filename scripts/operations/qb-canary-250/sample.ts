/**
 * QUESTION FACTORY CANARY 250 -- the HUMAN CALIBRATION SAMPLE: a deterministic selection by uncertainty and
 * information value (pure). FROZEN. It runs after every candidate has been reviewed.
 *
 * THERE IS NO FIXED PERCENTAGE AND NO FIXED SIZE. The size follows from the batch: how many disagreements there
 * are, how many doubts, and how many items each class has. Each step states its own bound, so that one class cannot
 * crowd out the others. Every selected item carries the EXACT reason(s) it was selected for.
 *
 *   S1  DISAGREEMENT          items where the deterministic validators and the AI reviewer contradict each other
 *                             (the three contradiction kinds). All of them, up to 20; beyond that, spread over
 *                             systems, highest uncertainty first.
 *   S2  UNCERTAIN             NEEDS_HUMAN_REVIEW items whose doubt is about the answer, the construct or the
 *                             profile, by uncertainty score. Up to 15, spread over systems.
 *   S3  REVIEWER_FAILURE      candidates the reviewer could not review. Up to 5, spread over systems.
 *   S4  BLIND_AUDIT_APPROVED  APPROVED items, to find what the AI let through: ceil(sqrt(number approved)),
 *                             at least 6 and at most 15 (or all, when fewer), spread over system x response type.
 *   S5  OVER_REJECTION_CHECK  REJECTED items, to find what the AI wrongly refused: ceil(sqrt(number rejected)),
 *                             at least 4 and at most 12 (or all, when fewer), spread over the rule that rejected and the system.
 *   S6  REPRESENTATION        top-ups so that the sample has at least 4 items of every assessment system, at least
 *                             6 of each higher-risk system (IB, Cambridge) and at least 5 of every response type
 *                             -- taken from NEEDS_HUMAN_REVIEW first, then REJECTED, then APPROVED.
 *
 * BLIND ITEMS. An APPROVED or REJECTED item selected ONLY by S4, S5 or S6 is BLIND: the packet a person receives shows it without
 * the AI decision and without the validator outcome, mixed with the others in an order that tells nothing. What was
 * decided about each item is in a separate key file.
 *
 * "Spread" is a round-robin over the named strata in sorted order. Within a stratum the order is by uncertainty
 * score (highest first) where one is defined, else by a hash of the slot id -- fixed, and unrelated to position in
 * the manifest. Nothing is random.
 */
import { createHash } from 'crypto';

export const SAMPLE_PROCEDURE = { id: 'studyus-human-calibration-sample-procedure', version: '1' } as const;
export const HIGHER_RISK_SYSTEMS = ['IB', 'CAMBRIDGE'] as const;
export const SAMPLE_BOUNDS = { disagreementMax: 20, uncertainMax: 15, reviewerFailureMax: 5, blindApproved: { min: 6, max: 15 }, overRejection: { min: 4, max: 12 }, perSystemMin: 4, perHigherRiskSystemMin: 6, perResponseTypeMin: 5 } as const;
export const CONTRADICTIONS = ['VALIDATOR_FAIL_REVIEWER_PASS', 'REVIEWER_REJECTS_A_MACHINE_VERIFIED_KEY', 'REVIEWER_FAIL_VALIDATOR_STRICT_PASS'] as const;
export type SampleReason = 'DISAGREEMENT' | 'UNCERTAIN' | 'REVIEWER_FAILURE' | 'BLIND_AUDIT_APPROVED' | 'OVER_REJECTION_CHECK' | 'REPRESENTATION';
const BLIND_REASONS: readonly SampleReason[] = ['BLIND_AUDIT_APPROVED', 'OVER_REJECTION_CHECK', 'REPRESENTATION'];

export interface SampleCandidate {
  slotId: string; system: string; responseType: string;
  ai: 'APPROVED' | 'NEEDS_HUMAN_REVIEW' | 'REJECTED' | 'REVIEWER_FAILURE' | 'NOT_REVIEWED';
  rule: string | null; disagreements: readonly string[];
  /** Reviewer verdicts that are not PASS / NOT_APPLICABLE, as `DIMENSION=VERDICT`. */
  doubts: readonly string[]; agreement: 'AGREES' | 'DISAGREES' | 'CANNOT_DETERMINE' | null; answerKeyClass: string | null;
}
export interface SampleEntry { slotId: string; system: string; responseType: string; reasons: Array<{ reason: SampleReason; detail: string }>; blind: boolean; uncertaintyScore: number }
export interface SampleSelection { procedure: typeof SAMPLE_PROCEDURE; bounds: typeof SAMPLE_BOUNDS; entries: SampleEntry[]; packetOrder: string[]; counts: { total: number; blind: number; byReason: Record<string, number>; bySystem: Record<string, number>; byResponseType: Record<string, number>; byAi: Record<string, number> }; population: Record<string, number>; shortfalls: string[] }

const hashOrder = (slotId: string, salt: string): string => createHash('sha256').update(`${salt}|${slotId}`).digest('hex');
/** How uncertain the automated verdict on an item is. Answer and key doubts weigh most; a higher-risk system adds one. */
export function uncertaintyScore(c: SampleCandidate): number {
  let n = 0;
  if (c.agreement === 'CANNOT_DETERMINE') n += 4;
  if (c.agreement === 'DISAGREES') n += 4;
  for (const d of c.doubts) n += d.startsWith('ACADEMIC_CORRECTNESS') ? 4 : d.startsWith('CONSTRUCT_VALIDITY') ? 3 : d.startsWith('PROFILE_FIDELITY') || d.startsWith('RESPONSE_CONTRACT') ? 2 : 1;
  if (c.answerKeyClass === 'HUMAN_REVIEW_REQUIRED') n += 1;
  if ((HIGHER_RISK_SYSTEMS as readonly string[]).includes(c.system)) n += 1;
  return n;
}
/** Round-robin over strata in sorted order; within a stratum in the order given. */
function spread<T>(items: readonly T[], stratum: (x: T) => string, limit: number): T[] {
  const groups = new Map<string, T[]>();
  for (const x of items) groups.set(stratum(x), [...(groups.get(stratum(x)) ?? []), x]);
  const keys = [...groups.keys()].sort();
  const out: T[] = [];
  for (let round = 0; out.length < limit; round += 1) {
    let took = false;
    for (const k of keys) { const g = groups.get(k)!; if (round < g.length && out.length < limit) { out.push(g[round]); took = true; } }
    if (!took) break;
  }
  return out;
}
const byScoreThenId = (a: SampleCandidate, b: SampleCandidate): number => uncertaintyScore(b) - uncertaintyScore(a) || (a.slotId < b.slotId ? -1 : 1);
const byHash = (salt: string) => (a: SampleCandidate, b: SampleCandidate): number => (hashOrder(a.slotId, salt) < hashOrder(b.slotId, salt) ? -1 : 1);
const sqrtBound = (n: number, b: { min: number; max: number }): number => Math.min(n, Math.max(b.min, Math.min(b.max, Math.ceil(Math.sqrt(n)))));
const tally = <T>(xs: readonly T[], key: (x: T) => string): Record<string, number> => { const m: Record<string, number> = {}; for (const x of xs) m[key(x)] = (m[key(x)] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1))); };

export function selectCalibrationSample(population: readonly SampleCandidate[]): SampleSelection {
  const B = SAMPLE_BOUNDS;
  const chosen = new Map<string, SampleEntry>();
  const add = (c: SampleCandidate, reason: SampleReason, detail: string): void => {
    const e = chosen.get(c.slotId) ?? { slotId: c.slotId, system: c.system, responseType: c.responseType, reasons: [], blind: false, uncertaintyScore: uncertaintyScore(c) };
    e.reasons.push({ reason, detail });
    chosen.set(c.slotId, e);
  };
  const contradictionsOf = (c: SampleCandidate): string[] => c.disagreements.filter((d) => (CONTRADICTIONS as readonly string[]).includes(d));
  // S1
  for (const c of spread([...population].filter((c) => contradictionsOf(c).length > 0).sort(byScoreThenId), (c) => c.system, B.disagreementMax)) add(c, 'DISAGREEMENT', contradictionsOf(c).join('+'));
  // S2
  const uncertain = population.filter((c) => c.ai === 'NEEDS_HUMAN_REVIEW' && (c.agreement !== 'AGREES' || c.doubts.some((d) => /^(ACADEMIC_CORRECTNESS|CONSTRUCT_VALIDITY|PROFILE_FIDELITY)=/.test(d)))).sort(byScoreThenId);
  for (const c of spread(uncertain, (c) => c.system, B.uncertainMax)) add(c, 'UNCERTAIN', [c.agreement && c.agreement !== 'AGREES' ? `KEY_AGREEMENT=${c.agreement}` : null, ...c.doubts.filter((d) => /^(ACADEMIC_CORRECTNESS|CONSTRUCT_VALIDITY|PROFILE_FIDELITY)=/.test(d))].filter(Boolean).join('+'));
  // S3
  for (const c of spread(population.filter((c) => c.ai === 'REVIEWER_FAILURE').sort(byHash('reviewer-failure')), (c) => c.system, B.reviewerFailureMax)) add(c, 'REVIEWER_FAILURE', c.rule ?? 'no code');
  // S4
  const approved = population.filter((c) => c.ai === 'APPROVED');
  for (const c of spread([...approved].sort(byHash('blind-audit')), (c) => `${c.system}|${c.responseType}`, sqrtBound(approved.length, B.blindApproved))) add(c, 'BLIND_AUDIT_APPROVED', `one of ${approved.length} approved`);
  // S5
  const rejected = population.filter((c) => c.ai === 'REJECTED');
  for (const c of spread([...rejected].sort(byHash('over-rejection')), (c) => `${c.rule ?? 'none'}|${c.system}`, sqrtBound(rejected.length, B.overRejection))) add(c, 'OVER_REJECTION_CHECK', `rejected by ${c.rule ?? 'no rule'}; one of ${rejected.length} rejected`);
  // S6
  const shortfalls: string[] = [];
  const priority: Readonly<Record<string, number>> = { NEEDS_HUMAN_REVIEW: 0, REJECTED: 1, APPROVED: 2, REVIEWER_FAILURE: 3, NOT_REVIEWED: 4 };
  const topUp = (label: string, has: (x: { system: string; responseType: string }) => boolean, minimum: number): void => {
    const pool = population.filter((c) => has(c) && !chosen.has(c.slotId) && c.ai !== 'NOT_REVIEWED').sort((a, b) => priority[a.ai] - priority[b.ai] || byHash('representation')(a, b));
    let have = [...chosen.values()].filter(has).length;
    for (const c of pool) { if (have >= minimum) break; add(c, 'REPRESENTATION', label); have += 1; }
    if (have < minimum && population.some(has)) shortfalls.push(`${label}: ${have} of ${minimum} (the batch has no more reviewed items of it)`);
  };
  for (const system of [...new Set(population.map((c) => c.system))].sort()) topUp(`SYSTEM=${system}`, (x) => x.system === system, (HIGHER_RISK_SYSTEMS as readonly string[]).includes(system) ? B.perHigherRiskSystemMin : B.perSystemMin);
  for (const type of [...new Set(population.map((c) => c.responseType))].sort()) topUp(`RESPONSE_TYPE=${type}`, (x) => x.responseType === type, B.perResponseTypeMin);

  const aiOf = new Map(population.map((c) => [c.slotId, c.ai]));
  // blind: selected only as an audit or a top-up, and decided APPROVED or REJECTED (an item sent to a person comes with its question)
  const entries = [...chosen.values()].map((e) => ({ ...e, blind: e.reasons.every((r) => BLIND_REASONS.includes(r.reason)) && (aiOf.get(e.slotId) === 'APPROVED' || aiOf.get(e.slotId) === 'REJECTED') })).sort((a, b) => (a.slotId < b.slotId ? -1 : 1));
  return {
    procedure: SAMPLE_PROCEDURE, bounds: SAMPLE_BOUNDS, entries,
    // the order a person receives the items in: by a hash, so that position says nothing about why an item is there
    packetOrder: entries.map((e) => e.slotId).sort((a, b) => (hashOrder(a, 'packet-order') < hashOrder(b, 'packet-order') ? -1 : 1)),
    counts: { total: entries.length, blind: entries.filter((e) => e.blind).length, byReason: tally(entries.flatMap((e) => e.reasons.map((r) => r.reason)), (r) => r), bySystem: tally(entries, (e) => e.system), byResponseType: tally(entries, (e) => e.responseType), byAi: tally(entries, (e) => aiOf.get(e.slotId) ?? 'UNKNOWN') },
    population: tally(population, (c) => c.ai), shortfalls,
  };
}

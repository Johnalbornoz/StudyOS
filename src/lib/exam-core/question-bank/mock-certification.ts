/**
 * Exam Assembly Validator + Mock Certification gate. Pure: answers
 * "can this blueprint be built from the current bank?" with PASS or FAIL and
 * the exact positions that are missing, never by intuition.
 *
 * Two profiles, never collapsed:
 *   STRUCTURAL  what the runtime does today: the published (possibly reduced)
 *               blueprint, filled with any mock-eligible item (fixtures count).
 *   CERTIFIED   the MOCK_READY=true gate: a full-length blueprint, filled only
 *               with real content (no DEV fixtures / placeholders), every item
 *               reproducibly gradable, marks reconciled with the official
 *               paper, and a scoring policy that can consume the result.
 *
 * A position is a blueprint objective target (objective + question type +
 * difficulty band). Items are matched to positions by maximum bipartite
 * matching with one item per template fingerprint per form (the same rule
 * form assembly applies), so "available" is a proof, not a count.
 *
 * Coverage status (per profile): NONE -> PARTIAL -> ONE_MOCK_READY ->
 * TWO_MOCKS_READY -> PRODUCTION_DEPTH, where depth is the number of
 * item-disjoint complete forms the bank can produce for this blueprint.
 */
import { isEligible, type EligibilityFacts } from './lifecycle';

export type CertificationProfile = 'STRUCTURAL' | 'CERTIFIED';
export type CoverageStatus = 'NONE' | 'PARTIAL' | 'ONE_MOCK_READY' | 'TWO_MOCKS_READY' | 'PRODUCTION_DEPTH';
export const COVERAGE_ORDER: CoverageStatus[] = ['NONE', 'PARTIAL', 'ONE_MOCK_READY', 'TWO_MOCKS_READY', 'PRODUCTION_DEPTH'];

/** How an item is marked. Only DETERMINISTIC and RUBRIC (criteria + marks) are reproducible. */
export type GradingMode = 'DETERMINISTIC' | 'RUBRIC' | 'SUBMISSION_RUBRIC' | 'UNKEYED';

export interface ComponentSpec {
  key: string;
  name: string;
  /** Published official length; null when the awarding body does not publish it. */
  officialItemCount: number | null;
  officialMarks: number | null;
  simulationCapable: boolean;
}

export interface PositionSpec {
  componentKey: string;
  objectiveId: string;
  objectiveCode: string | null;
  questionType: string | null;
  difficultyMin: number | null;
  difficultyMax: number | null;
}

export interface BankItemFacts extends EligibilityFacts {
  id: string;
  objectiveId: string;
  questionType: string;
  difficulty: number;
  marks: number;
  /** approved_items.content.contentStatus (DEV_CERT_FIXTURE | ORIGINAL | OFFICIAL_LICENSED). */
  contentStatus: string | null;
  templateFingerprint: string | null;
  /** Problems from validateExamItemStructure; ['UNPARSEABLE_CONTENT'] when the content fails the schema. */
  structureProblems: string[];
  grading: GradingMode;
  /** Placeholder / TODO / lorem text, missing explanation, etc. */
  placeholderSignals: string[];
  /** Referenced media / data that does not resolve. */
  unresolvedDependencies: string[];
}

export interface CertificationInput {
  examKey: string;
  examName: string;
  family: string;
  versionLabel: string;
  blueprintPublished: boolean;
  components: ComponentSpec[];
  positions: PositionSpec[];
  items: BankItemFacts[];
  scoring: { policyConfigured: boolean; official: boolean; projectionCalibrated: boolean };
}

export interface MissingPosition {
  componentKey: string;
  objectiveCode: string | null;
  questionType: string | null;
  difficulty: string;
  count: number;
  /** Items that match the spec but were rejected by the profile, by reason (e.g. 3 x DEV_FIXTURE). */
  blockedCandidates: Record<string, number>;
}

export interface ComponentResult {
  key: string;
  name: string;
  officialItemCount: number | null;
  officialMarks: number | null;
  positions: number;
  filled: number;
  plannedMarks: number;
  /** Positions the blueprint itself still lacks to reach the official length (CERTIFIED only). */
  undefinedPositions: number | null;
  missing: MissingPosition[];
}

export interface GateResult {
  gate: number;
  name: string;
  pass: boolean;
  detail: string[];
}

export interface CertificationResult {
  examKey: string;
  examName: string;
  family: string;
  versionLabel: string;
  profile: CertificationProfile;
  verdict: 'PASS' | 'FAIL';
  status: CoverageStatus;
  /** Item-disjoint complete forms (capped at the production target). */
  disjointForms: number;
  eligibleItems: number;
  bankItems: number;
  ineligibleReasons: Record<string, number>;
  components: ComponentResult[];
  gates: GateResult[];
  warnings: string[];
}

export interface CertificationOptions {
  /** Item-disjoint forms required for PRODUCTION_DEPTH (default 5: Mock 1, Mock 2, retake, 2 forms of practice reserve). */
  productionForms?: number;
}

const FIXTURE_STATUSES = new Set(['DEV_CERT_FIXTURE']);
const CERTIFIABLE_PROVENANCE = new Set(['OFFICIAL', 'LICENSED', 'STUDYUS_GENERATED', 'ORIGINAL_HUMAN']);

/** Why an item may not enter a form under a profile (empty = eligible). */
export function itemBlockers(item: BankItemFacts, profile: CertificationProfile): string[] {
  const out: string[] = [];
  const use = profile === 'CERTIFIED' ? 'FULL_MOCK' : 'REDUCED_MOCK';
  if (!isEligible(item, use)) out.push('NOT_MOCK_ELIGIBLE');
  if (item.structureProblems.length) out.push('STRUCTURE_INVALID');
  if (profile === 'CERTIFIED') {
    if ((item.contentStatus && FIXTURE_STATUSES.has(item.contentStatus)) || item.provenance === 'FIXTURE') out.push('DEV_FIXTURE');
    else if (item.provenance && !CERTIFIABLE_PROVENANCE.has(item.provenance)) out.push('UNKNOWN_PROVENANCE');
    if (item.grading === 'UNKEYED') out.push('NOT_REPRODUCIBLY_GRADABLE');
    if (item.placeholderSignals.length) out.push('PLACEHOLDER');
    if (item.unresolvedDependencies.length) out.push('MISSING_DEPENDENCY');
    if (!(item.marks > 0)) out.push('NO_MARKS');
  }
  return out;
}

function fits(item: BankItemFacts, p: PositionSpec): boolean {
  if (item.objectiveId !== p.objectiveId) return false;
  if (p.questionType && item.questionType !== p.questionType) return false;
  if (p.difficultyMin !== null && item.difficulty < p.difficultyMin) return false;
  if (p.difficultyMax !== null && item.difficulty > p.difficultyMax) return false;
  return true;
}

/**
 * Maximum matching positions -> templates (Kuhn's augmenting paths; blueprints
 * have tens of positions, so O(V*E) is fine). Items sharing a template
 * fingerprint form one node: a form never repeats a template.
 * Returns, per position, the chosen item (or null).
 */
export function matchPositions(positions: PositionSpec[], items: BankItemFacts[], excluded: Set<string> = new Set()): (BankItemFacts | null)[] {
  const templateOf = (i: BankItemFacts) => i.templateFingerprint ?? `item:${i.id}`;
  const usable = items.filter((i) => !excluded.has(templateOf(i)));
  // Stable, deterministic candidate order: lowest id first.
  const candidates = positions.map((p) => usable.filter((i) => fits(i, p)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  const owner = new Map<string, number>(); // template -> position index
  const chosen: (BankItemFacts | null)[] = positions.map(() => null);
  const tryAssign = (pi: number, seen: Set<string>): boolean => {
    for (const item of candidates[pi]) {
      const t = templateOf(item);
      if (seen.has(t)) continue;
      seen.add(t);
      const prev = owner.get(t);
      if (prev === undefined || tryAssign(prev, seen)) {
        owner.set(t, pi);
        chosen[pi] = item;
        return true;
      }
    }
    return false;
  };
  // Scarce positions first: fewer candidates -> matched earlier (does not change the maximum, only stability).
  const order = positions.map((_, i) => i).sort((a, b) => candidates[a].length - candidates[b].length || a - b);
  for (const pi of order) tryAssign(pi, new Set());
  return chosen;
}

/** Number of item-disjoint complete forms (greedy packing of maximum matchings; a lower bound). */
export function disjointForms(positions: PositionSpec[], items: BankItemFacts[], cap: number): number {
  if (positions.length === 0) return 0;
  const used = new Set<string>();
  let forms = 0;
  while (forms < cap) {
    const m = matchPositions(positions, items, used);
    if (m.some((x) => x === null)) break;
    for (const it of m) used.add(it!.templateFingerprint ?? `item:${it!.id}`);
    forms += 1;
  }
  return forms;
}

const band = (p: PositionSpec) => (p.difficultyMin === null && p.difficultyMax === null ? 'any' : `${p.difficultyMin ?? 1}-${p.difficultyMax ?? 5}`);

export function certifyBlueprint(input: CertificationInput, profile: CertificationProfile, opts: CertificationOptions = {}): CertificationResult {
  const productionForms = opts.productionForms ?? 5;
  const blockersById = new Map(input.items.map((i) => [i.id, itemBlockers(i, profile)]));
  const eligible = input.items.filter((i) => blockersById.get(i.id)!.length === 0);
  const ineligibleReasons: Record<string, number> = {};
  for (const b of blockersById.values()) for (const r of b) ineligibleReasons[r] = (ineligibleReasons[r] ?? 0) + 1;

  const match = matchPositions(input.positions, eligible);
  const warnings: string[] = [];
  const components: ComponentResult[] = input.components.map((c) => {
    const idx = input.positions.map((p, i) => (p.componentKey === c.key ? i : -1)).filter((i) => i >= 0);
    const missingByKey = new Map<string, MissingPosition>();
    for (const i of idx) {
      if (match[i]) continue;
      const p = input.positions[i];
      const k = `${p.objectiveId}|${p.questionType}|${band(p)}`;
      const m = missingByKey.get(k) ?? { componentKey: c.key, objectiveCode: p.objectiveCode, questionType: p.questionType, difficulty: band(p), count: 0, blockedCandidates: {} };
      m.count += 1;
      if (m.count === 1) for (const it of input.items.filter((x) => fits(x, p))) for (const r of blockersById.get(it.id)!) m.blockedCandidates[r] = (m.blockedCandidates[r] ?? 0) + 1;
      missingByKey.set(k, m);
    }
    const plannedMarks = idx.reduce((n, i) => n + (match[i]?.marks ?? 0), 0);
    const undefinedPositions = profile === 'CERTIFIED' && c.officialItemCount !== null ? Math.max(0, c.officialItemCount - idx.length) : null;
    return { key: c.key, name: c.name, officialItemCount: c.officialItemCount, officialMarks: c.officialMarks, positions: idx.length, filled: idx.filter((i) => match[i]).length, plannedMarks, undefinedPositions, missing: [...missingByKey.values()] };
  });

  const allFilled = input.positions.length > 0 && match.every((m) => m !== null);
  const gates: GateResult[] = [];
  const gate = (n: number, name: string, detail: string[]) => gates.push({ gate: n, name, pass: detail.length === 0, detail });

  // 1. A valid blueprint (CERTIFIED: at the official length of every component).
  const g1: string[] = [];
  if (!input.blueprintPublished) g1.push('NO_PUBLISHED_BLUEPRINT');
  if (input.positions.length === 0) g1.push('BLUEPRINT_HAS_NO_POSITIONS');
  for (const c of components) {
    const spec = input.components.find((s) => s.key === c.key)!;
    if (!spec.simulationCapable) g1.push(`${c.key}: COMPONENT_NOT_SIMULATION_CAPABLE`);
    if (c.positions === 0) g1.push(`${c.key}: NO_POSITIONS`);
    if (profile === 'CERTIFIED') {
      if (spec.officialItemCount === null && spec.officialMarks === null) g1.push(`${c.key}: OFFICIAL_SIZE_UNKNOWN`);
      if (c.undefinedPositions) g1.push(`${c.key}: BLUEPRINT_BELOW_OFFICIAL_LENGTH (${c.positions}/${spec.officialItemCount} items)`);
    }
  }
  gate(1, 'Valid blueprint', g1);

  // 2. Enough eligible items (a complete matching).
  gate(2, 'Enough eligible items', components.flatMap((c) => c.missing.map((m) => `${c.key}: ${m.count} x ${m.objectiveCode ?? '?'} / ${m.questionType ?? 'any type'} / difficulty ${m.difficulty}`)));

  // 3. Every selected item has an answer key / mark scheme / rubric.
  const selected = match.filter((m): m is BankItemFacts => m !== null);
  gate(3, 'Answers / markschemes present', selected.filter((i) => i.grading === 'UNKEYED' || i.structureProblems.length).map((i) => `${i.id}: ${i.grading === 'UNKEYED' ? 'NO_MARKSCHEME' : i.structureProblems.join(',')}`));

  // 4. Marks reconcile with the official paper (when marks are published).
  const g4: string[] = [];
  if (profile === 'CERTIFIED') {
    for (const c of components) {
      if (c.officialMarks !== null && c.filled === c.positions && c.plannedMarks !== c.officialMarks) g4.push(`${c.key}: planned ${c.plannedMarks} marks vs official ${c.officialMarks}`);
      if (c.officialMarks !== null && c.filled < c.positions) g4.push(`${c.key}: marks cannot reconcile, ${c.positions - c.filled} position(s) unfilled`);
    }
  }
  gate(4, 'Marks reconcile', g4);

  // 5. Blueprint distribution met (every objective target filled -- the matching proves it).
  gate(5, 'Blueprint distribution met', allFilled ? [] : [`${match.filter((m) => m === null).length}/${input.positions.length} positions unfilled`]);

  // 6. No dependency on data that does not exist.
  gate(6, 'No missing dependencies', selected.filter((i) => i.unresolvedDependencies.length).map((i) => `${i.id}: ${i.unresolvedDependencies.join(',')}`));

  // 7. No placeholders / fixtures (CERTIFIED only; STRUCTURAL is the runtime view and reports it as a warning).
  const fixtureSelected = selected.filter((i) => i.contentStatus === 'DEV_CERT_FIXTURE' || i.provenance === 'FIXTURE');
  gate(7, 'No placeholders or fixtures', profile === 'CERTIFIED' ? selected.filter((i) => i.placeholderSignals.length).map((i) => `${i.id}: ${i.placeholderSignals.join(',')}`) : []);
  if (profile === 'STRUCTURAL' && fixtureSelected.length) warnings.push(`${fixtureSelected.length}/${selected.length} selected items are DEV fixtures`);

  // 8. Buildable end to end.
  gate(8, 'Mock assembles end to end', allFilled && input.blueprintPublished ? [] : ['FORM_INCOMPLETE']);

  // 9. Gradable end to end (reproducibly).
  const g9 = selected.filter((i) => i.grading === 'UNKEYED').map((i) => `${i.id}: UNKEYED_FREE_TEXT`);
  const assessed = selected.filter((i) => i.grading === 'RUBRIC' || i.grading === 'SUBMISSION_RUBRIC').length;
  if (assessed) warnings.push(`${assessed} item(s) are rubric-marked (double assessor + human review on disagreement)`);
  gate(9, 'Gradable end to end', g9);

  // 10. The result can be consumed by scoring / readiness / prediction.
  gate(10, 'Result consumable by scoring', input.scoring.policyConfigured ? [] : ['NO_SCORING_POLICY']);
  if (!input.scoring.official) warnings.push('Score is a StudyUs practice score (no official scale / grade boundaries)');
  if (!input.scoring.projectionCalibrated) warnings.push('Score prediction is NOT_AVAILABLE (no calibrated conversion model)');

  const verdict = gates.every((g) => g.pass) ? 'PASS' : 'FAIL';
  const forms = verdict === 'PASS' ? disjointForms(input.positions, eligible, productionForms) : 0;
  const status: CoverageStatus =
    eligible.length === 0 ? 'NONE'
      : verdict === 'FAIL' || forms === 0 ? 'PARTIAL'
        : forms >= productionForms ? 'PRODUCTION_DEPTH'
          : forms >= 2 ? 'TWO_MOCKS_READY'
            : 'ONE_MOCK_READY';

  return {
    examKey: input.examKey, examName: input.examName, family: input.family, versionLabel: input.versionLabel, profile, verdict, status,
    disjointForms: forms, eligibleItems: eligible.length, bankItems: input.items.length, ineligibleReasons, components, gates, warnings,
  };
}

/**
 * Exam Assembly Validator + Mock Certification gate. Pure: answers
 * "can this blueprint be built from the current bank?" with PASS or FAIL and
 * the exact positions that are missing, never by intuition.
 *
 * Two profiles, never collapsed (QB-1: engine capability != content readiness):
 *   ENGINE      the engine can assemble / deliver / score the published (possibly
 *               reduced) blueprint in a TECHNICAL_DEMO context: DEV fixtures count.
 *               Says nothing about real content.
 *   CERTIFIED   the MOCK_READY=true gate: a full-length blueprint with a documented
 *               distribution, filled only with eligible real content (never a fixture),
 *               every slot constraint met (count, marks, section, skill, command term),
 *               every item reproducibly gradable, marks reconciled with the official
 *               paper, and a scoring policy that can consume the result.
 *
 * A position is one blueprint objective target (already expanded by its
 * target_item_count). Items are matched to positions by maximum bipartite
 * matching with one item per template fingerprint per form (the rule form
 * assembly applies), so "available" is a proof, not a count. An empty required
 * position is a FAIL: a form is never accepted because "one slot filled".
 *
 * `assessExam` turns both into the content ladder (fidelity.ts):
 *   NONE -> PRACTICE_READY -> SECTION_FIDELITY -> ONE_MOCK_READY -> MULTI_MOCK_READY -> PRODUCTION_DEPTH
 * where mock depth is the number of item-disjoint complete certified forms.
 */
import { blueprintAllocationProblems, constraintMismatches, constraintSignature, normalizeConstraints, type ItemDimensionValues, type SlotConstraint } from '../slot-constraints';
import { isEligible, STUDENT_DELIVERABLE_STATES, type EligibilityFacts, type LifecycleState } from './lifecycle';
import type { ExamAudience } from '../audience';
import { assessmentSemanticsOf, type AssessmentSemantics, type ContentReadiness, type EngineCapability } from '../fidelity';

export type CertificationProfile = 'ENGINE' | 'CERTIFIED';

/** How an item is marked. Only DETERMINISTIC and RUBRIC (criteria + marks) are reproducible. */
export type GradingMode = 'DETERMINISTIC' | 'RUBRIC' | 'SUBMISSION_RUBRIC' | 'UNKEYED';

/** Whether the blueprint's distribution (which objectives / sections / marks a full form holds) is sourced. */
export type BlueprintSpecificationStatus = 'DOCUMENTED' | 'PARTIAL' | 'UNKNOWN';

export interface ComponentSpec {
  key: string;
  name: string;
  /** Published official length; null when the awarding body does not publish it. */
  officialItemCount: number | null;
  officialMarks: number | null;
  simulationCapable: boolean;
  /** D4: a timed single-sitting simulation exists (false: coursework, portfolio, IA, project, oral, practical). */
  mockable: boolean;
  /** Section keys the official paper is divided into (Section A / B ...); empty when it has none. */
  sections: string[];
  /** D2: UNKNOWN stays UNKNOWN until an official / licensed source documents the full-form distribution. */
  blueprintSpecification: BlueprintSpecificationStatus;
  /** Declared allocation (margins / cells) the slots must realise exactly; null when none is declared. */
  allocation?: Parameters<typeof blueprintAllocationProblems>[0] | null;
}

export interface PositionSpec {
  componentKey: string;
  objectiveId: string;
  objectiveCode: string | null;
  questionType: string | null;
  difficultyMin: number | null;
  difficultyMax: number | null;
  /** Optional slot constraints: enforced whenever the blueprint states them. */
  sectionKey?: string | null;
  skillId?: string | null;
  commandTerm?: string | null;
  marks?: number | null;
  /** Structured slot constraints (competence, content category, ...): every one must match. */
  constraints?: SlotConstraint[];
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
  sectionKey?: string | null;
  /** Skills the item evidences (published mappings of its objective). */
  skillIds?: string[];
  commandTerm?: string | null;
  /** Structured dimension values the item declares (itemDimensionValues). */
  dimensions?: ItemDimensionValues;
}

export interface CertificationInput {
  examKey: string;
  examName: string;
  family: string;
  versionLabel: string;
  /** D1: only a STUDENT exam can be content-ready; a technical / internal exam is an engine demo. */
  audience: ExamAudience;
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
  constraints: string[];
  count: number;
  /** Items that match the spec but were rejected by the profile, by reason (e.g. 3 x DEV_FIXTURE). */
  blockedCandidates: Record<string, number>;
}

export interface ComponentResult {
  key: string;
  name: string;
  mockable: boolean;
  officialItemCount: number | null;
  officialMarks: number | null;
  positions: number;
  filled: number;
  plannedMarks: number;
  /** Positions the blueprint itself still lacks to reach the official item count (CERTIFIED only). */
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
  /** Item-disjoint complete forms (capped at the production target); 0 unless PASS. */
  disjointForms: number;
  eligibleItems: number;
  bankItems: number;
  ineligibleReasons: Record<string, number>;
  components: ComponentResult[];
  gates: GateResult[];
  warnings: string[];
}

export interface CertificationOptions {
  /** Item-disjoint forms required for PRODUCTION_DEPTH (default 5: Mock 1, Mock 2, retake, 2 forms of practice / training reserve). */
  productionForms?: number;
}

const FIXTURE_STATUSES = new Set(['DEV_CERT_FIXTURE']);
const CERTIFIABLE_PROVENANCE = new Set(['OFFICIAL', 'LICENSED', 'STUDYUS_GENERATED', 'ORIGINAL_HUMAN']);
const isFixture = (i: Pick<BankItemFacts, 'contentStatus' | 'provenance'>) => (!!i.contentStatus && FIXTURE_STATUSES.has(i.contentStatus)) || i.provenance === 'FIXTURE';

/** Why an item may not enter a form under a profile (empty = eligible). */
export function itemBlockers(item: BankItemFacts, profile: CertificationProfile): string[] {
  const out: string[] = [];
  if (profile === 'CERTIFIED') {
    // Content first: a fixture is never real content, whatever its lifecycle says.
    if (isFixture(item)) out.push('DEV_FIXTURE');
    else if (item.provenance && !CERTIFIABLE_PROVENANCE.has(item.provenance)) out.push('UNKNOWN_PROVENANCE');
    else if (!item.provenance) out.push('MISSING_PROVENANCE');
    // Generated content enters a certified mock only after a HUMAN approval (ACTIVE / CALIBRATED; DB-enforced).
    if (item.provenance === 'STUDYUS_GENERATED' && !STUDENT_DELIVERABLE_STATES.includes((item.lifecycle ?? '') as LifecycleState)) out.push('NOT_HUMAN_APPROVED');
    if (!isEligible(item, 'FULL_MOCK', undefined, 'STUDENT') && !isFixture(item)) out.push('NOT_FULL_MOCK_ELIGIBLE');
    if (item.grading === 'UNKEYED') out.push('NOT_REPRODUCIBLY_GRADABLE');
    if (item.placeholderSignals.length) out.push('PLACEHOLDER');
    if (item.unresolvedDependencies.length) out.push('MISSING_DEPENDENCY');
    if (!(item.marks > 0)) out.push('NO_MARKS');
  } else if (!isEligible(item, 'REDUCED_MOCK', undefined, 'TECHNICAL_DEMO')) out.push('NOT_MOCK_ELIGIBLE');
  if (item.structureProblems.length) out.push('STRUCTURE_INVALID');
  return out;
}

/**
 * What COUNTS toward PRACTICE_READY: approved real content -- deliverable, keyed, and, for StudyUs-generated
 * content, human-approved (ACTIVE / CALIBRATED: the DB only lets generated content reach them with an APPROVED
 * review). A PILOT item may be delivered for practice under the practice policy, but it never makes an exam
 * practice-ready on its own.
 */
export function practiceBlockers(item: BankItemFacts): string[] {
  const out: string[] = [];
  if (isFixture(item)) out.push('DEV_FIXTURE');
  if (!isEligible(item, 'PRACTICE', undefined, 'STUDENT')) out.push('NOT_PRACTICE_ELIGIBLE');
  // Why, for generated content: no human approval yet (PILOT / REVIEW_REQUIRED / ...). Same canonical rule.
  if (item.provenance === 'STUDYUS_GENERATED' && !STUDENT_DELIVERABLE_STATES.includes((item.lifecycle ?? '') as LifecycleState)) out.push('NOT_HUMAN_APPROVED');
  if (item.structureProblems.length) out.push('STRUCTURE_INVALID');
  if (item.grading === 'UNKEYED') out.push('NOT_REPRODUCIBLY_GRADABLE');
  if (item.placeholderSignals.includes('PLACEHOLDER_TEXT')) out.push('PLACEHOLDER');
  return out;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** Unmet slot constraints of an item for a position (empty = fits). */
export function constraintMisses(item: BankItemFacts, p: PositionSpec): string[] {
  const out: string[] = [];
  if (item.objectiveId !== p.objectiveId) out.push('OBJECTIVE');
  if (p.questionType && item.questionType !== p.questionType) out.push('QUESTION_TYPE');
  if (p.difficultyMin !== null && item.difficulty < p.difficultyMin) out.push('DIFFICULTY');
  if (p.difficultyMax !== null && item.difficulty > p.difficultyMax) out.push('DIFFICULTY');
  if (p.sectionKey && item.sectionKey !== p.sectionKey) out.push('SECTION');
  if (p.skillId && !(item.skillIds ?? []).includes(p.skillId)) out.push('SKILL');
  if (p.commandTerm && norm(item.commandTerm) !== norm(p.commandTerm)) out.push('COMMAND_TERM');
  if (p.marks !== null && p.marks !== undefined && item.marks !== p.marks) out.push('MARKS');
  // Structured slot constraints: EVERY declared dimension must match (no fallback on a partial match).
  for (const d of constraintMismatches(p.constraints, item.dimensions)) out.push(d);
  return out;
}
const fits = (item: BankItemFacts, p: PositionSpec) => constraintMisses(item, p).length === 0;

/**
 * Maximum matching positions -> templates (Kuhn's augmenting paths; blueprints
 * have tens to a few hundred positions, so O(V*E) is fine). Items sharing a
 * template fingerprint form one node: a form never repeats a template.
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
const constraintsOf = (p: PositionSpec) => [
  p.sectionKey ? `section ${p.sectionKey}` : '',
  p.skillId ? `skill ${p.skillId}` : '',
  p.commandTerm ? `command term "${p.commandTerm}"` : '',
  p.marks !== null && p.marks !== undefined ? `${p.marks} marks` : '',
  ...normalizeConstraints(p.constraints).map((c) => `${c.dimension}=${c.value}`),
].filter(Boolean);

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
      const k = `${p.objectiveId}|${p.questionType}|${band(p)}|${constraintsOf(p).join(',')}`;
      const m = missingByKey.get(k) ?? { componentKey: c.key, objectiveCode: p.objectiveCode, questionType: p.questionType, difficulty: band(p), constraints: constraintsOf(p), count: 0, blockedCandidates: {} };
      m.count += 1;
      if (m.count === 1) {
        for (const it of input.items.filter((x) => x.objectiveId === p.objectiveId)) {
          // Why the candidates of this objective could not fill it: profile blockers, else unmet slot constraints.
          const reasons = blockersById.get(it.id)!.length ? blockersById.get(it.id)! : constraintMisses(it, p).map((x) => `CONSTRAINT_${x}`);
          for (const r of reasons.length ? reasons : ['ALREADY_USED_IN_FORM']) m.blockedCandidates[r] = (m.blockedCandidates[r] ?? 0) + 1;
        }
      }
      missingByKey.set(k, m);
    }
    const plannedMarks = idx.reduce((n, i) => n + (match[i]?.marks ?? 0), 0);
    const undefinedPositions = profile === 'CERTIFIED' && c.officialItemCount !== null ? Math.max(0, c.officialItemCount - idx.length) : null;
    return { key: c.key, name: c.name, mockable: c.mockable, officialItemCount: c.officialItemCount, officialMarks: c.officialMarks, positions: idx.length, filled: idx.filter((i) => match[i]).length, plannedMarks, undefinedPositions, missing: [...missingByKey.values()] };
  });

  const allFilled = input.positions.length > 0 && match.every((m) => m !== null);
  const gates: GateResult[] = [];
  const gate = (n: number, name: string, detail: string[]) => gates.push({ gate: n, name, pass: detail.length === 0, detail });

  // 1. A valid blueprint (CERTIFIED: official length, documented distribution, every official section present).
  const g1: string[] = [];
  if (!input.blueprintPublished) g1.push('NO_PUBLISHED_BLUEPRINT');
  if (input.positions.length === 0) g1.push('BLUEPRINT_HAS_NO_POSITIONS');
  for (const c of components) {
    const spec = input.components.find((s) => s.key === c.key)!;
    if (!spec.simulationCapable) g1.push(`${c.key}: COMPONENT_NOT_SIMULATION_CAPABLE`);
    if (c.positions === 0) g1.push(`${c.key}: NO_POSITIONS`);
    if (profile === 'CERTIFIED') {
      if (!spec.mockable) g1.push(`${c.key}: COMPONENT_NOT_MOCKABLE`);
      if (spec.officialItemCount === null && spec.officialMarks === null) g1.push(`${c.key}: OFFICIAL_SIZE_UNKNOWN`);
      if (c.undefinedPositions) g1.push(`${c.key}: BLUEPRINT_BELOW_OFFICIAL_LENGTH (${c.positions}/${spec.officialItemCount} items)`);
      if (spec.blueprintSpecification !== 'DOCUMENTED') g1.push(`${c.key}: BLUEPRINT_DISTRIBUTION_${spec.blueprintSpecification}`);
      // A declared allocation (official margins / StudyUs policy cells) must be realised EXACTLY by the slots.
      const sigs = new Map<string, number>();
      for (const p of input.positions.filter((x) => x.componentKey === c.key)) sigs.set(constraintSignature(p.constraints), (sigs.get(constraintSignature(p.constraints)) ?? 0) + 1);
      for (const prob of blueprintAllocationProblems(spec.allocation ?? null, sigs)) g1.push(`${c.key}: ${prob}`);
      const covered = new Set(input.positions.filter((p) => p.componentKey === c.key && p.sectionKey).map((p) => p.sectionKey!));
      for (const sec of spec.sections) if (!covered.has(sec)) g1.push(`${c.key}: REQUIRED_SECTION_MISSING ${sec}`);
    }
  }
  gate(1, 'Valid blueprint', g1);

  // 2. Enough eligible items: a COMPLETE matching (an empty required position is a FAIL).
  gate(2, 'Enough eligible items', components.flatMap((c) => c.missing.map((m) => `${c.key}: ${m.count} x ${m.objectiveCode ?? '?'} / ${m.questionType ?? 'any type'} / difficulty ${m.difficulty}${m.constraints.length ? ` / ${m.constraints.join(' / ')}` : ''}`)));

  // 3. Every selected item has an answer key / mark scheme / rubric.
  const selected = match.filter((m): m is BankItemFacts => m !== null);
  gate(3, 'Answers / markschemes present', selected.filter((i) => i.grading === 'UNKEYED' || i.structureProblems.length).map((i) => `${i.id}: ${i.grading === 'UNKEYED' ? 'NO_MARKSCHEME' : i.structureProblems.join(',')}`));

  // 4. Marks reconcile with the official paper (when marks are published). Marks come from each item's mark scheme.
  const g4: string[] = [];
  if (profile === 'CERTIFIED') {
    for (const c of components) {
      if (c.officialMarks !== null && c.filled === c.positions && c.plannedMarks !== c.officialMarks) g4.push(`${c.key}: planned ${c.plannedMarks} marks vs official ${c.officialMarks}`);
      if (c.officialMarks !== null && c.filled < c.positions) g4.push(`${c.key}: marks cannot reconcile, ${c.positions - c.filled} position(s) unfilled`);
    }
  }
  gate(4, 'Marks reconcile', g4);

  // 5. Blueprint distribution met (every objective target filled, every slot constraint met -- the matching proves it).
  gate(5, 'Blueprint distribution met', allFilled ? [] : [`${match.filter((m) => m === null).length}/${input.positions.length} positions unfilled`]);

  // 6. No dependency on data that does not exist.
  gate(6, 'No missing dependencies', selected.filter((i) => i.unresolvedDependencies.length).map((i) => `${i.id}: ${i.unresolvedDependencies.join(',')}`));

  // 7. No placeholders and no fixtures (CERTIFIED; the ENGINE view reports fixture use as a warning).
  const fixtureSelected = selected.filter(isFixture);
  gate(7, 'No placeholders or fixtures', profile === 'CERTIFIED' ? [...fixtureSelected.map((i) => `${i.id}: DEV_FIXTURE`), ...selected.filter((i) => i.placeholderSignals.length).map((i) => `${i.id}: ${i.placeholderSignals.join(',')}`)] : []);
  if (profile === 'ENGINE' && fixtureSelected.length) warnings.push(`${fixtureSelected.length}/${selected.length} selected items are DEV fixtures (engine capability only)`);

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
  return {
    examKey: input.examKey, examName: input.examName, family: input.family, versionLabel: input.versionLabel, profile, verdict,
    disjointForms: forms, eligibleItems: eligible.length, bankItems: input.items.length, ineligibleReasons, components, gates, warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Exam assessment: engine capability + content ladder                  */
/* ------------------------------------------------------------------ */

export type MockApplicability = 'APPLICABLE' | 'NOT_APPLICABLE_TECHNICAL_EXAM' | 'NOT_APPLICABLE_COMPETENCY_BENCHMARK' | 'NOT_APPLICABLE_NO_MOCKABLE_COMPONENT';

export interface ExamAssessment {
  examKey: string;
  examName: string;
  family: string;
  versionLabel: string;
  audience: ExamAudience;
  semantics: AssessmentSemantics;
  engineCapability: EngineCapability;
  contentReadiness: ContentReadiness;
  /** MOCK_READY: content readiness >= ONE_MOCK_READY, from the CERTIFIED gate only. */
  mockReady: boolean;
  mockApplicability: MockApplicability;
  practice: { objectives: number; covered: number; eligibleItems: number; blockers: Record<string, number> };
  /** Mockable components that pass the CERTIFIED gate on their own. */
  certifiedSections: string[];
  /** Components that count for the exam but are not mockable (D4). */
  nonMockableComponents: string[];
  engine: CertificationResult;
  /** CERTIFIED gate over the mockable components (null when a mock is not applicable). */
  certified: CertificationResult | null;
}

function subset(input: CertificationInput, keys: Set<string>): CertificationInput {
  return { ...input, components: input.components.filter((c) => keys.has(c.key)), positions: input.positions.filter((p) => keys.has(p.componentKey)) };
}

export function assessExam(input: CertificationInput, opts: CertificationOptions = {}): ExamAssessment {
  const productionForms = opts.productionForms ?? 5;
  const semantics = assessmentSemanticsOf(input.family);
  const engine = certifyBlueprint(input, 'ENGINE', opts);
  const engineCapability: EngineCapability = engine.verdict === 'PASS' ? 'TECHNICAL_DEMO' : 'NONE';
  const nonMockableComponents = input.components.filter((c) => !c.mockable).map((c) => c.key);
  const mockKeys = new Set(input.components.filter((c) => c.mockable).map((c) => c.key));

  // Practice: every blueprint objective of a practiceable component has >= 1 eligible real item.
  const practiceKeys = new Set(input.components.filter((c) => c.simulationCapable).map((c) => c.key));
  const objectives = [...new Set(input.positions.filter((p) => practiceKeys.has(p.componentKey)).map((p) => p.objectiveId))];
  const blockers: Record<string, number> = {};
  const practiceOk = input.items.filter((i) => {
    const b = practiceBlockers(i);
    for (const r of b) blockers[r] = (blockers[r] ?? 0) + 1;
    return b.length === 0;
  });
  const covered = objectives.filter((o) => practiceOk.some((i) => i.objectiveId === o)).length;
  const practiceReady = objectives.length > 0 && covered === objectives.length;

  const mockApplicability: MockApplicability =
    input.audience !== 'STUDENT' ? 'NOT_APPLICABLE_TECHNICAL_EXAM'
      : semantics === 'COMPETENCY_BENCHMARK' ? 'NOT_APPLICABLE_COMPETENCY_BENCHMARK'
        : mockKeys.size === 0 ? 'NOT_APPLICABLE_NO_MOCKABLE_COMPONENT'
          : 'APPLICABLE';
  const certified = mockApplicability === 'APPLICABLE' ? certifyBlueprint(subset(input, mockKeys), 'CERTIFIED', opts) : null;
  const certifiedSections = mockApplicability === 'APPLICABLE'
    ? [...mockKeys].filter((k) => certifyBlueprint(subset(input, new Set([k])), 'CERTIFIED', opts).verdict === 'PASS')
    : [];

  let contentReadiness: ContentReadiness = 'NONE';
  if (input.audience === 'STUDENT') {
    if (practiceReady) contentReadiness = 'PRACTICE_READY';
    if (certifiedSections.length > 0) contentReadiness = 'SECTION_FIDELITY';
    if (certified?.verdict === 'PASS') {
      contentReadiness = certified.disjointForms >= productionForms ? 'PRODUCTION_DEPTH' : certified.disjointForms >= 2 ? 'MULTI_MOCK_READY' : 'ONE_MOCK_READY';
    }
  }
  return {
    examKey: input.examKey, examName: input.examName, family: input.family, versionLabel: input.versionLabel, audience: input.audience, semantics,
    engineCapability, contentReadiness, mockReady: certified?.verdict === 'PASS', mockApplicability,
    practice: { objectives: objectives.length, covered, eligibleItems: practiceOk.length, blockers },
    certifiedSections, nonMockableComponents, engine, certified,
  };
}

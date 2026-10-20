/**
 * QF V5.2 -- the EXAM BANK supply authority (pure, no IO).
 *
 *   canonical concept -> exam applicability -> certified adapter -> governed blueprint
 *     -> certified renderer envelope -> certified EXAM_BANK_ITEM -> rights -> numeric difficulty -> exam delivery
 *
 * SCOPE: STANDARDIZED EXAM CONTENT, AND NOTHING ELSE. StudyUs has three kinds of item and three supplies:
 *   LEARNING_ITEM              generated for a learner on an explicit command        -- not this module
 *   INTERNAL_ASSESSMENT_ITEM   generated, validated and frozen before an attempt     -- not this module
 *   EXAM_BANK_ITEM             certified ahead of time, never generated at runtime   -- THIS module
 * Ordinary Learning and Internal Assessment never read this authority and are never blocked by it: an empty Exam
 * Bank makes an exam NOT_READY and makes nothing else anything. A consumer that is not a standardized exam is
 * refused here by name, so that the dependency cannot be reintroduced by accident.
 *
 * An exam consumer states what it needs; the authority answers READY with items, or NOT_READY with the exact
 * shortfall. It never widens a concept scope, never widens a difficulty, never falls back to content outside
 * itself, and never generates anything: provider calls for live exam supply are zero by construction.
 *
 * SUPPLY IS GLOBAL; A STUDENT'S STATE IS PRIVATE. Eligibility depends on nothing about a Student -- not on their
 * history, not on whether they ever used Learning. The only Student-specific input is what that Student has
 * already been served, and it can only AVOID a repeat.
 *
 * ELIGIBILITY IS RE-DECIDED WHEN ASKED. An item that was eligible when it was certified is not trusted for that:
 * its governing objects, its envelope and its rights are read again at selection time and again at start.
 */
import { sha256OfCanonicalJson } from '@/lib/assessment-adaptation/canonical-hash';
import { bandOf, type DifficultyBand } from '@/lib/exam-core/question-bank/quality';
import type { BlueprintClass } from '../blueprint-classification';
import type { ItemInstanceLineage } from '../item-instance-lineage';
import type { InstanceKey, LearnerInstance, RubricPoint } from '../renderer';
import type { ResponseEvaluationPolicy } from '../response-evaluation';
import { DELIVERABLE_CERTIFICATION_STATES, type CertificationStateName, type EligibilityScope } from './certification-policy';
import type { RightsCategory } from './rights-provenance';

/** The three first-class item types. They share response evaluation, concept identity and evidence infrastructure; they do NOT share a supply. */
export const ITEM_TYPES = ['LEARNING_ITEM', 'INTERNAL_ASSESSMENT_ITEM', 'EXAM_BANK_ITEM'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
/** The one item type this authority holds and serves. */
export const EXAM_BANK_ITEM = 'EXAM_BANK_ITEM' as const;
/** The supply families of the product. Only the last one is served from the Exam Bank. */
export const SUPPLY_FAMILIES = ['LEARNING', 'INTERNAL_ASSESSMENT', 'STANDARDIZED_EXAM'] as const;
export type SupplyFamily = (typeof SUPPLY_FAMILIES)[number];
export const EXAM_BANK_SUPPLY_FAMILY = 'STANDARDIZED_EXAM' as const;
/** May this consumer be supplied from the Exam Bank? Only a standardized exam. An unknown family: no. */
export const examBankServes = (family: string): family is typeof EXAM_BANK_SUPPLY_FAMILY => family === EXAM_BANK_SUPPLY_FAMILY;

/** What an Exam Bank item may be used for. */
export const EXAM_USES = ['EXAM_PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK', 'CHALLENGE', 'EXAM_SIMULATION'] as const;
export type ExamUse = (typeof EXAM_USES)[number];

export interface CertifiedInstance {
  itemType: typeof EXAM_BANK_ITEM;
  instanceId: string;
  coreId: string;
  coreVersion: string;
  conceptId: string;
  canonicalSubject: string;
  systemId: string;
  systemVersionId: string;
  adapterId: string;
  adapterVersion: string;
  blueprintId: string;
  blueprintVersion: string;
  blueprintClass: BlueprintClass;
  bucketId: string;
  rendererVersion: string;
  envelopeHash: string;
  seed: string;
  /** What a learner would recognise as "the same question": capacity and repeat-avoidance count in these. */
  recognitionId: string;
  format: string;
  language: string;
  marks: number;
  itemDifficulty: number;
  difficultyBand: DifficultyBand;
  learner: LearnerInstance;
  key: InstanceKey;
  rubric: RubricPoint[];
  responsePolicy: ResponseEvaluationPolicy;
  rightsCategory: RightsCategory;
  certificationState: CertificationStateName;
  certificationMode: 'INHERITED_DETERMINISTIC_CERTIFICATION' | 'INDIVIDUAL_ITEM_REVIEW';
  policyVersion: string;
  policyHash: string;
  lineage: ItemInstanceLineage;
  lineageHash: string;
  eligibilityScopes: EligibilityScope[];
  /** The working is marked: the item needs a marker. It is still an exam item for every exam use. */
  markedOnWorking: boolean;
}

/** Is the working of this item marked (a rubric with method points, parts, or working asked for)? */
export const isMarkedOnWorking = (i: Pick<CertifiedInstance, 'learner' | 'rubric' | 'responsePolicy'>): boolean => i.responsePolicy.kind === 'RUBRIC' || i.learner.parts.length > 0 || i.learner.conditions.workingShown || i.rubric.some((r) => r.kind !== 'ANSWER');

/** The state of the world an instance depends on, as it is NOW. Read at every selection. */
export interface LiveGovernance {
  /** Is this object, at this version, still eligible (certified, not revoked)? */
  objectEligible(objectType: 'CONSTRUCT_CORE' | 'ASSESSMENT_ADAPTER' | 'RENDERER_ENVELOPE' | 'BLUEPRINT_CLASSIFICATION', objectId: string, objectVersion: string): boolean;
  systemVersionActive(systemId: string, systemVersionId: string): boolean;
  /** Envelope hashes frozen by a quality incident. Their instances are quarantined until the incident is closed. */
  quarantinedEnvelopes: ReadonlySet<string>;
  /** Rights states that deliver in a scope, by the policy in force. */
  rightsDeliverable(category: RightsCategory, scope: EligibilityScope): boolean;
  policyHashInForce: string;
}

export const ELIGIBILITY_REFUSALS = ['NOT_AN_EXAM_BANK_ITEM', 'NOT_CERTIFIED', 'SCOPE_NOT_GRANTED', 'QUARANTINED', 'CORE_NOT_ELIGIBLE', 'ADAPTER_NOT_ELIGIBLE', 'RENDERER_ENVELOPE_NOT_ELIGIBLE', 'BLUEPRINT_NOT_ELIGIBLE', 'SYSTEM_VERSION_NOT_ACTIVE', 'RIGHTS_NOT_DELIVERABLE', 'CERTIFIED_UNDER_ANOTHER_POLICY', 'DIFFICULTY_NOT_RECORDED', 'LINEAGE_ALTERED'] as const;
export type EligibilityRefusal = (typeof ELIGIBILITY_REFUSALS)[number];

export const lineageHashOf = (i: Pick<CertifiedInstance, 'lineage' | 'itemDifficulty' | 'envelopeHash' | 'learner' | 'key' | 'rubric' | 'responsePolicy'>): string =>
  sha256OfCanonicalJson({ lineage: i.lineage, itemDifficulty: i.itemDifficulty, envelopeHash: i.envelopeHash, content: { learner: i.learner, key: i.key, rubric: i.rubric, responsePolicy: i.responsePolicy } });

/** Why an instance may not be delivered in a scope, now. Empty = eligible. The one eligibility rule of the system. */
export function eligibilityRefusals(i: CertifiedInstance, scope: EligibilityScope, live: LiveGovernance): EligibilityRefusal[] {
  const out: EligibilityRefusal[] = [];
  if (i.itemType !== EXAM_BANK_ITEM) out.push('NOT_AN_EXAM_BANK_ITEM');
  if (!DELIVERABLE_CERTIFICATION_STATES.includes(i.certificationState)) out.push('NOT_CERTIFIED');
  if (!i.eligibilityScopes.includes(scope)) out.push('SCOPE_NOT_GRANTED');
  if (live.quarantinedEnvelopes.has(i.envelopeHash)) out.push('QUARANTINED');
  if (!live.objectEligible('CONSTRUCT_CORE', i.coreId, i.coreVersion)) out.push('CORE_NOT_ELIGIBLE');
  if (!live.objectEligible('ASSESSMENT_ADAPTER', i.adapterId, i.adapterVersion)) out.push('ADAPTER_NOT_ELIGIBLE');
  if (!live.objectEligible('RENDERER_ENVELOPE', i.rendererVersion, i.coreVersion)) out.push('RENDERER_ENVELOPE_NOT_ELIGIBLE');
  if (!live.objectEligible('BLUEPRINT_CLASSIFICATION', i.blueprintId, i.blueprintVersion)) out.push('BLUEPRINT_NOT_ELIGIBLE');
  if (!live.systemVersionActive(i.systemId, i.systemVersionId)) out.push('SYSTEM_VERSION_NOT_ACTIVE');
  if (!live.rightsDeliverable(i.rightsCategory, scope)) out.push('RIGHTS_NOT_DELIVERABLE');
  if (i.policyHash !== live.policyHashInForce) out.push('CERTIFIED_UNDER_ANOTHER_POLICY');
  if (!Number.isInteger(i.itemDifficulty) || i.itemDifficulty < 1 || i.itemDifficulty > 5 || bandOf(i.itemDifficulty) !== i.difficultyBand) out.push('DIFFICULTY_NOT_RECORDED');
  if (lineageHashOf(i) !== i.lineageHash) out.push('LINEAGE_ALTERED');
  return out;
}
export const eligibleInstances = (all: readonly CertifiedInstance[], scope: EligibilityScope, live: LiveGovernance): CertifiedInstance[] => all.filter((i) => eligibilityRefusals(i, scope, live).length === 0);

// ------------------------------------------------------------------------------------- exam practice by concept
/** What a Student has been served by exam delivery. The only Student-specific input, and it only avoids repeats. */
export interface ServedHistory { instanceIds: ReadonlySet<string>; recognitionIds: ReadonlySet<string> }
export const NO_HISTORY: ServedHistory = { instanceIds: new Set<string>(), recognitionIds: new Set<string>() };

export interface ExamPracticeRequest {
  /** Who is asking. Anything but a standardized exam is refused: Learning and Internal Assessment have their own supply. */
  supplyFamily: string;
  /** The component of the registered assessment system whose exam is being prepared. Exam practice is always OF an exam. */
  adapterId: string;
  scope: EligibilityScope;
  /** Exactly these concepts. An item of any other concept is never supplied. */
  conceptIds: readonly string[];
  /** Items needed for EACH concept. */
  perConcept: number;
  /** A hard filter when stated: only items whose stored difficulty maps to this band. null = any difficulty. */
  difficultyBand: DifficultyBand | null;
  /** Rotates the stable order, so that two requests do not always start at the same item. */
  selectionSeed: string;
}
export type UnmetCause = 'NO_CERTIFIED_ITEM_OF_THE_CONCEPT' | 'ONLY_OTHER_DIFFICULTY' | 'NOT_ENOUGH_DISTINCT_ITEMS';
export type ExamPracticeSupply =
  | { state: 'READY'; instances: CertifiedInstance[]; repeatedRecognition: number }
  | { state: 'NOT_READY'; reason: 'INSUFFICIENT_CERTIFIED_CONTENT'; unmet: { conceptId: string; needed: number; available: number; cause: UnmetCause }[] }
  | { state: 'REFUSED'; reason: 'NOT_AN_EXAM_CONSUMER'; detail: string };

const order = (seed: string, i: CertifiedInstance): string => sha256OfCanonicalJson([seed, i.instanceId]);

/**
 * Exam practice for one component of a registered system, by concept. Deterministic: the same request over the
 * same inventory and history gives the same items. Items a Student has not met come first; one recognition class
 * is never served twice in one answer. Insufficient certified content is NOT_READY: nothing is generated.
 */
export function supplyForExamPractice(all: readonly CertifiedInstance[], request: ExamPracticeRequest, live: LiveGovernance, served: ServedHistory = NO_HISTORY): ExamPracticeSupply {
  if (!examBankServes(request.supplyFamily)) return { state: 'REFUSED', reason: 'NOT_AN_EXAM_CONSUMER', detail: `${request.supplyFamily} is not supplied from the Exam Bank` };
  const eligible = eligibleInstances(all, request.scope, live).filter((i) => i.adapterId === request.adapterId);
  const out: CertifiedInstance[] = [];
  const unmet: { conceptId: string; needed: number; available: number; cause: UnmetCause }[] = [];
  let repeated = 0;
  for (const conceptId of [...new Set(request.conceptIds)]) {
    const ofConcept = eligible.filter((i) => i.conceptId === conceptId);
    const inBand = ofConcept.filter((i) => request.difficultyBand === null || i.difficultyBand === request.difficultyBand);
    // one item per recognition class: two variants a learner takes for one another are one item of supply
    const byClass = new Map<string, CertifiedInstance>();
    for (const i of [...inBand].sort((x, y) => order(request.selectionSeed, x).localeCompare(order(request.selectionSeed, y)))) {
      const held = byClass.get(i.recognitionId);
      if (!held || (served.instanceIds.has(held.instanceId) && !served.instanceIds.has(i.instanceId))) byClass.set(i.recognitionId, i);
    }
    const distinct = [...byClass.values()];
    if (distinct.length < request.perConcept) {
      unmet.push({ conceptId, needed: request.perConcept, available: distinct.length, cause: ofConcept.length === 0 ? 'NO_CERTIFIED_ITEM_OF_THE_CONCEPT' : inBand.length === 0 ? 'ONLY_OTHER_DIFFICULTY' : 'NOT_ENOUGH_DISTINCT_ITEMS' });
      continue;
    }
    const fresh = distinct.filter((i) => !served.recognitionIds.has(i.recognitionId) && !served.instanceIds.has(i.instanceId));
    const picked = [...fresh, ...distinct.filter((i) => !fresh.includes(i))].slice(0, request.perConcept);
    repeated += picked.filter((i) => !fresh.includes(i)).length;
    out.push(...picked);
  }
  return unmet.length > 0 ? { state: 'NOT_READY', reason: 'INSUFFICIENT_CERTIFIED_CONTENT', unmet } : { state: 'READY', instances: out, repeatedRecognition: repeated };
}

// ------------------------------------------------------------------------------------------- blueprint supply
export interface BlueprintDemand { blueprintId: string; blueprintVersion: string; blueprintClass: BlueprintClass; adapterId: string; buckets: readonly { bucketId: string; positions: number }[] }
export type FormUse = 'EXAM_PRACTICE' | 'REDUCED_MOCK' | 'FULL_MOCK' | 'EXAM_SIMULATION';
export type BlueprintSupply =
  | { state: 'READY'; form: { bucketId: string; instances: CertifiedInstance[] }[] }
  | { state: 'NOT_READY'; reason: 'BLUEPRINT_CLASS_DOES_NOT_SATISFY_THE_USE' | 'INSUFFICIENT_CERTIFIED_CONTENT'; unmet: { bucketId: string; needed: number; available: number }[] };
// a full mock and an exam simulation reproduce the official form: only a FULL blueprint can be one, whatever the depth of supply
const CLASSES_FOR: Readonly<Record<FormUse, readonly BlueprintClass[]>> = { EXAM_PRACTICE: ['FULL', 'ALIGNED', 'REDUCED'], REDUCED_MOCK: ['FULL', 'REDUCED'], FULL_MOCK: ['FULL'], EXAM_SIMULATION: ['FULL'] };

/** A form for a governed blueprint: every position of every bucket filled by a distinct certified instance, or nothing. */
export function supplyForBlueprint(all: readonly CertifiedInstance[], demand: BlueprintDemand, use: FormUse, scope: EligibilityScope, live: LiveGovernance, selectionSeed: string): BlueprintSupply {
  if (!CLASSES_FOR[use].includes(demand.blueprintClass)) return { state: 'NOT_READY', reason: 'BLUEPRINT_CLASS_DOES_NOT_SATISFY_THE_USE', unmet: [] };
  const eligible = eligibleInstances(all, scope, live).filter((i) => i.blueprintId === demand.blueprintId && i.blueprintVersion === demand.blueprintVersion && i.adapterId === demand.adapterId);
  const form: { bucketId: string; instances: CertifiedInstance[] }[] = [];
  const unmet: { bucketId: string; needed: number; available: number }[] = [];
  for (const b of demand.buckets) {
    const needed = use === 'EXAM_PRACTICE' ? 1 : b.positions;
    const byClass = new Map<string, CertifiedInstance>();
    for (const i of eligible.filter((x) => x.bucketId === b.bucketId).sort((x, y) => order(selectionSeed, x).localeCompare(order(selectionSeed, y)))) if (!byClass.has(i.recognitionId)) byClass.set(i.recognitionId, i);
    // a form spreads over the concepts and cores of a bucket before it repeats one
    const pool = [...byClass.values()];
    const picked: CertifiedInstance[] = [];
    while (picked.length < needed && pool.length > 0) {
      const used = new Map<string, number>();
      for (const i of picked) used.set(i.coreId, (used.get(i.coreId) ?? 0) + 1);
      pool.sort((x, y) => (used.get(x.coreId) ?? 0) - (used.get(y.coreId) ?? 0));
      picked.push(pool.shift()!);
    }
    if (picked.length < needed) unmet.push({ bucketId: b.bucketId, needed, available: byClass.size }); else form.push({ bucketId: b.bucketId, instances: picked });
  }
  return unmet.length > 0 ? { state: 'NOT_READY', reason: 'INSUFFICIENT_CERTIFIED_CONTENT', unmet } : { state: 'READY', form };
}

/** At the moment a stored form or item is started or retrieved: is each instance STILL eligible? Never trusted from when it was materialised. */
export function revalidateAtStart(instances: readonly CertifiedInstance[], scope: EligibilityScope, live: LiveGovernance): { startable: boolean; refused: { instanceId: string; reasons: EligibilityRefusal[] }[] } {
  const refused = instances.map((i) => ({ instanceId: i.instanceId, reasons: eligibilityRefusals(i, scope, live) })).filter((r) => r.reasons.length > 0);
  return { startable: refused.length === 0, refused };
}

// ---------------------------------------------------------------------------------------------- materialization
/**
 * The delivery representation of a certified instance: a question-bank row's content. The instance is the
 * authority; the row copies it. Nothing is invented here: a field the instance does not carry is not in the row.
 * `response` is the ONE canonical response representation; `math` carries the same key in the shape the existing
 * Student scorer reads, so that an old transport shape never decides what a valid mathematical item may be.
 */
export interface MaterializedItem {
  itemType: typeof EXAM_BANK_ITEM;
  lineageClass: 'CORE_DERIVED';
  itemInstanceId: string;
  provenance: 'STUDYUS_AUTHORED';
  primaryConceptStableId: string;
  canonicalSubject: string;
  eligibilityScopes: EligibilityScope[];
  markedOnWorking: boolean;
  content: {
    key: string; language: string; question: string; itemType: string; marks: number; difficulty: number; difficultyBand: DifficultyBand; options: { label: string; text: string }[]; correctAnswer: string; acceptableAnswers: string[];
    response: { format: string; key: string[]; policy: ResponseEvaluationPolicy };
    math: { kind: 'NUMBER'; answers: string[]; requiredForm: 'ANY' } | null;
    rubric: RubricPoint[];
    lineage: { digest: string; instanceId: string; coreId: string; coreVersion: string; systemId: string; systemVersionId: string; adapterId: string; adapterVersion: string; blueprintId: string; blueprintVersion: string; blueprintClass: BlueprintClass; bucketId: string; rendererVersion: string; envelopeHash: string; seed: string; policyVersion: string; policyHash: string; certificationState: CertificationStateName; certificationMode: string };
    rights: { category: RightsCategory };
  };
}
export function materialize(i: CertifiedInstance): MaterializedItem {
  const numeric = i.responsePolicy.kind === 'NUMERIC';
  return {
    itemType: EXAM_BANK_ITEM, lineageClass: 'CORE_DERIVED', itemInstanceId: i.instanceId, provenance: 'STUDYUS_AUTHORED', primaryConceptStableId: i.conceptId, canonicalSubject: i.canonicalSubject, eligibilityScopes: [...i.eligibilityScopes], markedOnWorking: i.markedOnWorking,
    content: {
      key: `qf52.${i.instanceId.slice(0, 24)}`, language: i.language, question: i.learner.prompt, itemType: i.format, marks: i.marks, difficulty: i.itemDifficulty, difficultyBand: i.difficultyBand, options: i.learner.options.map((o) => ({ ...o })),
      correctAnswer: i.key.answers[0], acceptableAnswers: [...i.key.answers],
      response: { format: i.format, key: [...i.key.answers], policy: i.responsePolicy },
      math: numeric ? { kind: 'NUMBER', answers: [...i.key.answers], requiredForm: 'ANY' } : null,
      rubric: i.rubric.map((r) => ({ ...r })),
      lineage: { digest: i.lineageHash, instanceId: i.instanceId, coreId: i.coreId, coreVersion: i.coreVersion, systemId: i.systemId, systemVersionId: i.systemVersionId, adapterId: i.adapterId, adapterVersion: i.adapterVersion, blueprintId: i.blueprintId, blueprintVersion: i.blueprintVersion, blueprintClass: i.blueprintClass, bucketId: i.bucketId, rendererVersion: i.rendererVersion, envelopeHash: i.envelopeHash, seed: i.seed, policyVersion: i.policyVersion, policyHash: i.policyHash, certificationState: i.certificationState, certificationMode: i.certificationMode },
      rights: { category: i.rightsCategory },
    },
  };
}
/** A materialised row is the instance's or it is nothing: any field that differs is named. */
export function materializationIssues(row: MaterializedItem, i: CertifiedInstance): string[] {
  const expected = materialize(i);
  return sha256OfCanonicalJson(expected) === sha256OfCanonicalJson(row) ? [] : (Object.keys(expected.content) as (keyof MaterializedItem['content'])[]).filter((k) => sha256OfCanonicalJson(expected.content[k]) !== sha256OfCanonicalJson(row.content[k])).map((k) => `content.${k}`).concat(row.itemInstanceId === i.instanceId ? [] : ['itemInstanceId']);
}

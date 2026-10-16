/**
 * TRACK B -- the SCORING-PRESERVING projection of a certified instance into an Exam Bank version (pure, no IO).
 *
 *   certified instance  ->  Exam Bank item content  ->  Exam Core (`examItemFromApproved` + `gradeExamItem`)
 *
 * `exam-bank-projection-2` (bank-projection.ts, the one the publication service uses and the frozen PAA baseline was
 * published with) carries a single-value numeric key only, drops accuracy rules, and refuses every working-marked
 * instance. This module is the generic successor, ISOLATED: nothing publishes with it yet.
 *
 * It carries, without inventing anything:
 *   answer marks         every ACCURACY / ANSWER rubric point becomes the marks of exactly one answer target;
 *   method marks         every METHOD rubric point becomes a method key WITH the certified intermediates;
 *   multi-part / roots   ORDERED_PARTS: one target per certified learner part, in the certified order -- so two roots
 *                        are two marks, never two alternative full-credit answers;
 *   accuracy             significant figures, decimal places, tolerance, units, accepted representations;
 *   provenance           the mark-scheme digest, the rubric digest and the point -> target map, in `certified.scoring`.
 *
 * THE MACHINE MARK SCHEME is certified content: it lives in the instance's response policy (`responsePolicy.markScheme`),
 * so it is inside the instance's lineage hash and certification digest. A scheme added after certification changes
 * that digest: it is new content and needs a new certification. This module never adds one.
 *
 * Fail closed. Anything the Exam Core cannot score deterministically and EXACTLY as certified is refused, by name:
 * a working-marked instance without a machine scheme (the 30 IB quadratic instances today), a method point without
 * intermediates, an unordered solution set, part prompts that are not certified learner content, an accuracy rule the
 * Exam Core cannot express without weakening it.
 */
import { optionIdOf, selectedResponseBankFields, selectedResponseDigest, selectedResponseIssues, type SelectedResponseItem } from './engines/selected-response';
import { SABER_COMPETENCIES, saberCorrespondenceOf } from '@/lib/curriculum/icfes/saber11-content-correspondence';
import { parse } from 'mathjs';
import { z } from 'zod';
import { sha256OfCanonicalJson } from '@/lib/assessment-adaptation/canonical-hash';
import { MethodKeySchema, type ApprovedItemContent, type MathKeyContent, type MethodKey } from '@/lib/exam-core/items';
import { criterionDigestOf } from '@/lib/assessment-scoring/method-rules';
import { DELIVERABLE_CERTIFICATION_STATES, materialize, type CertifiedInstance } from '@/lib/assessment-instance/v52';
import type { ResponseEvaluationPolicy } from '@/lib/assessment-instance/response-evaluation';
import { projectionRefusal as projection2Refusal, type CertifiedBankExtension } from './bank-projection';
import { policyIssues, responseContractOf, type CanonicalNumericPolicy } from '@/lib/assessment-scoring/canonical-response';

export const SCORING_PROJECTION_VERSION = 'exam-bank-projection-3';
export const MACHINE_MARK_SCHEME_VERSION = 1;

const PointIndex = z.number().int().min(0).max(40);
export const MachineMarkSchemeSchema = z.object({
  v: z.literal(MACHINE_MARK_SCHEME_VERSION),
  /** SINGLE: one answer target. ORDERED_PARTS: one target per certified learner part, in order. UNORDERED_SET: a set of values in any order. */
  structure: z.enum(['SINGLE', 'ORDERED_PARTS', 'UNORDERED_SET']),
  /** ORDERED_PARTS of numeric values: the order the certified parts state (checked against the values). */
  order: z.enum(['ASCENDING', 'DESCENDING', 'AS_LISTED']).default('AS_LISTED'),
  targets: z.array(z.object({
    /** SINGLE: 'answer'. ORDERED_PARTS: the certified learner part label (e.g. 'a'). */
    targetId: z.string().min(1).max(20),
    kind: z.enum(['NUMBER', 'EXPRESSION', 'EQUATION']),
    /** The canonical value; `equivalents` are other WRITTEN FORMS of the same value (never other values). */
    value: z.string().min(1).max(300),
    equivalents: z.array(z.string().min(1).max(300)).max(6).default([]),
    /** Indices into the instance rubric: the answer points this target earns. */
    answerPoints: z.array(PointIndex).min(1),
    method: z.object({
      points: z.array(PointIndex).min(1), intermediates: z.array(z.string().min(1).max(300)).min(1).max(10), impliedByCorrectAnswer: z.boolean(),
      /** A form-aware rule (method-rules.ts): it must score exactly the certified point(s) and is never implied. */
      rule: MethodKeySchema.shape.rule,
    }).nullable(),
  })).min(1).max(12),
});
export type MachineMarkScheme = z.infer<typeof MachineMarkSchemeSchema>;

export type ScoringProjectionRefusal =
  | 'NOT_CERTIFIED' | 'HAS_A_STIMULUS' | 'HAS_OPTIONS' | 'NO_ANSWER_KEY' | 'POLICY_NOT_DETERMINISTIC'
  | 'WORKING_MARKED_WITHOUT_MACHINE_MARK_SCHEME' | 'MARK_SCHEME_INVALID' | 'RUBRIC_POINT_NOT_MAPPED' | 'RUBRIC_POINT_MAPPED_TWICE' | 'POINT_KIND_MISMATCH'
  | 'METHOD_POINT_WITHOUT_INTERMEDIATES' | 'MARKS_INCONSISTENT' | 'TARGET_VALUE_NOT_THE_CERTIFIED_KEY' | 'KEY_VALUES_NOT_COVERED' | 'MULTIPLE_KEY_VALUES_WITHOUT_PART_STRUCTURE'
  | 'UNORDERED_SOLUTION_SET_NOT_SCORABLE' | 'PARTS_NOT_IN_CERTIFIED_LEARNER_CONTENT' | 'ORDER_NOT_SATISFIED' | 'INTERMEDIATE_NOT_SATISFIED_BY_THE_KEY' | 'INTERMEDIATE_NOT_VERIFIABLE'
  | 'REPRESENTATION_RULE_NOT_PROJECTABLE' | 'SEPARATOR_RULE_NOT_PROJECTABLE' | 'UNIT_RULE_NOT_PROJECTABLE' | 'SYMBOLIC_RULE_NOT_PROJECTABLE' | 'POLICY_INVALID' | 'METHOD_RULE_NOT_THE_CERTIFIED_POINT';

const ANSWER_KINDS = new Set(['ACCURACY', 'ANSWER']);
const METHOD_KINDS = new Set(['METHOD']);

/** The machine mark scheme the instance's certified response policy carries, or null. */
export const markSchemeOf = (i: CertifiedInstance): unknown => (i.responsePolicy as ResponseEvaluationPolicy & { markScheme?: unknown }).markScheme ?? null;

const numeric = (s: string): number | null => {
  const t = s.replace(',', '.').trim();
  const m = /^(-?\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]) / (m[2] ? Number(m[2]) : 1);
  return Number.isFinite(v) ? v : null;
};

/** Does every key value satisfy the intermediate equation (single variable x)? null = cannot be checked deterministically. */
export function intermediateSatisfiedBy(intermediate: string, values: readonly number[]): boolean | null {
  const sides = intermediate.replace(/[−–]/g, '-').split('=');
  if (sides.length !== 2) return null;
  try {
    const lhs = parse(sides[0]); const rhs = parse(sides[1]);
    const symbols = new Set<string>();
    for (const node of [lhs, rhs]) node.traverse((n: any) => { if (n.isSymbolNode && !['pi', 'e'].includes(n.name)) symbols.add(n.name); });
    if ([...symbols].some((s) => s !== 'x')) return null;
    return values.every((x) => { const d = Number(lhs.evaluate({ x })) - Number(rhs.evaluate({ x })); return Number.isFinite(d) && Math.abs(d) <= 1e-9 * Math.max(1, Math.abs(x)); });
  } catch { return null; }
}

/** The Exam Core accuracy key of a certified response policy, or why it cannot be expressed without weakening it. */
export function accuracyOf(p: ResponseEvaluationPolicy): { ok: true; key: Omit<MathKeyContent, 'kind' | 'answers'> } | { ok: false; refusal: ScoringProjectionRefusal } {
  const reps = new Set(p.acceptedRepresentations);
  let requiredForm: MathKeyContent['requiredForm'];
  if (['INTEGER', 'DECIMAL', 'FRACTION'].every((r) => reps.has(r as never))) requiredForm = 'ANY';
  else if (reps.size === 1 && reps.has('INTEGER')) requiredForm = 'INTEGER';
  else if (reps.size === 1 && reps.has('DECIMAL')) requiredForm = 'DECIMAL';
  else if (reps.size === 1 && reps.has('EXPRESSION')) requiredForm = 'ANY';
  else return { ok: false, refusal: 'REPRESENTATION_RULE_NOT_PROJECTABLE' };
  if (p.kind === 'NUMERIC' && !(p.decimalSeparators.includes('.') && p.decimalSeparators.includes(','))) return { ok: false, refusal: 'SEPARATOR_RULE_NOT_PROJECTABLE' };
  if (p.units.accepted.length > 1) return { ok: false, refusal: 'UNIT_RULE_NOT_PROJECTABLE' };
  if (p.units.required && p.units.accepted.length === 0) return { ok: false, refusal: 'UNIT_RULE_NOT_PROJECTABLE' };
  return {
    ok: true,
    key: {
      requiredForm,
      ...(p.rounding?.kind === 'SIGNIFICANT_FIGURES' ? { significantFigures: p.rounding.digits } : {}),
      ...(p.rounding?.kind === 'DECIMAL_PLACES' ? { decimalPlaces: p.rounding.digits } : {}),
      ...(p.tolerance ? { tolerance: p.tolerance.kind === 'ABSOLUTE' ? { absolute: p.tolerance.value } : { relative: p.tolerance.value } } : {}),
      ...(p.units.accepted.length === 1 ? { units: { expected: p.units.accepted[0], required: p.units.required } } : {}),
      // The certified policy awards nothing for a value that misses a requirement: no partial credit is invented.
      partialCredit: { formNotMet: 0, unitMissing: 0, unitWrong: 0, significantFigures: 0 },
    },
  };
}

interface Plan { scheme: MachineMarkScheme; pointMap: Array<{ rubricIndex: number; code: string; kind: string; marks: number; target: string }> }

/** Why this instance cannot be projected with its scoring semantics intact. null = it can. */
export function scoringProjectionRefusal(i: CertifiedInstance): ScoringProjectionRefusal | null {
  const r = planOf(i);
  return 'refusal' in r ? r.refusal : null;
}

function planOf(i: CertifiedInstance): Plan | { refusal: ScoringProjectionRefusal } {
  if (!DELIVERABLE_CERTIFICATION_STATES.includes(i.certificationState)) return { refusal: 'NOT_CERTIFIED' };
  if (i.learner.stimulus !== null) return { refusal: 'HAS_A_STIMULUS' };
  if (i.learner.options.length > 0) return { refusal: 'HAS_OPTIONS' };
  if (i.key.answers.length === 0 || i.key.answers.some((a) => !a.trim())) return { refusal: 'NO_ANSWER_KEY' };
  const p = i.responsePolicy;
  if (!['NUMERIC', 'SYMBOLIC', 'RUBRIC'].includes(p.kind)) return { refusal: 'POLICY_NOT_DETERMINISTIC' };
  if (p.kind === 'SYMBOLIC' && !p.symbolicEquivalence) return { refusal: 'SYMBOLIC_RULE_NOT_PROJECTABLE' };
  const rawScheme = markSchemeOf(i);
  let scheme: MachineMarkScheme;
  if (rawScheme === null) {
    if (i.markedOnWorking) return { refusal: 'WORKING_MARKED_WITHOUT_MACHINE_MARK_SCHEME' };
    // An answer-only instance: one value (its key may list written forms of that ONE value, never several values).
    const values = new Set(i.key.answers.map((a) => numeric(a) ?? a.trim()));
    if (values.size > 1) return { refusal: 'MULTIPLE_KEY_VALUES_WITHOUT_PART_STRUCTURE' };
    scheme = { v: 1, structure: 'SINGLE', order: 'AS_LISTED', targets: [{ targetId: 'answer', kind: p.kind === 'SYMBOLIC' ? 'EXPRESSION' : 'NUMBER', value: i.key.answers[0], equivalents: i.key.answers.slice(1), answerPoints: i.rubric.length ? i.rubric.map((_, k) => k) : [0], method: null }] };
  } else {
    const parsed = MachineMarkSchemeSchema.safeParse(rawScheme);
    if (!parsed.success) return { refusal: 'MARK_SCHEME_INVALID' };
    scheme = parsed.data;
  }
  if (scheme.structure === 'UNORDERED_SET') return { refusal: 'UNORDERED_SOLUTION_SET_NOT_SCORABLE' };
  if (scheme.structure === 'SINGLE' && scheme.targets.length !== 1) return { refusal: 'MARK_SCHEME_INVALID' };
  if (scheme.structure === 'ORDERED_PARTS') {
    const labels = i.learner.parts.map((x) => x.label);
    if (labels.length !== scheme.targets.length || scheme.targets.some((t, k) => t.targetId !== labels[k])) return { refusal: 'PARTS_NOT_IN_CERTIFIED_LEARNER_CONTENT' };
  } else if (i.learner.parts.length > 0) return { refusal: 'PARTS_NOT_IN_CERTIFIED_LEARNER_CONTENT' };
  // every rubric point is mapped exactly once, to a target of its own kind
  const used = new Map<number, string>();
  for (const t of scheme.targets) {
    for (const k of t.answerPoints) { if (used.has(k)) return { refusal: 'RUBRIC_POINT_MAPPED_TWICE' }; used.set(k, `${t.targetId}.answer`); }
    for (const k of t.method?.points ?? []) { if (used.has(k)) return { refusal: 'RUBRIC_POINT_MAPPED_TWICE' }; used.set(k, `${t.targetId}.method`); }
  }
  if (i.rubric.length > 0) {
    if ([...used.keys()].some((k) => k >= i.rubric.length) || used.size !== i.rubric.length) return { refusal: 'RUBRIC_POINT_NOT_MAPPED' };
    for (const [k, target] of used) {
      const kind = i.rubric[k].kind;
      if (target.endsWith('.answer') ? !ANSWER_KINDS.has(kind) : !METHOD_KINDS.has(kind)) return { refusal: 'POINT_KIND_MISMATCH' };
    }
    const unmappedMethod = i.rubric.some((pt, k) => METHOD_KINDS.has(pt.kind) && !used.get(k)?.endsWith('.method'));
    if (unmappedMethod) return { refusal: 'METHOD_POINT_WITHOUT_INTERMEDIATES' };
    if (i.rubric.reduce((s, pt) => s + pt.marks, 0) !== i.marks) return { refusal: 'MARKS_INCONSISTENT' };
  }
  // ordered parts carry the marks their certified learner parts state
  if (scheme.structure === 'ORDERED_PARTS') {
    for (const [k, t] of scheme.targets.entries()) {
      const marks = [...t.answerPoints, ...(t.method?.points ?? [])].reduce((s, x) => s + (i.rubric[x]?.marks ?? 0), 0);
      if (marks !== i.learner.parts[k].marks) return { refusal: 'MARKS_INCONSISTENT' };
    }
  }
  // every target value is the certified key: the policy's answer point for RUBRIC, the instance key otherwise
  const keyValues = i.key.answers.map((a) => numeric(a) ?? a.trim());
  for (const t of scheme.targets) {
    const v = numeric(t.value) ?? t.value.trim();
    if (p.kind === 'RUBRIC') {
      for (const k of t.answerPoints) {
        const certified = p.partialCredit.filter((pc) => pc.answer !== null)[answerOrdinal(i, k)]?.answer ?? null;
        if (certified === null || (numeric(certified) ?? certified.trim()) !== v) return { refusal: 'TARGET_VALUE_NOT_THE_CERTIFIED_KEY' };
      }
    }
    if (!keyValues.includes(v)) return { refusal: 'TARGET_VALUE_NOT_THE_CERTIFIED_KEY' };
    for (const e of t.equivalents) if ((numeric(e) ?? e.trim()) !== v && t.kind === 'NUMBER') return { refusal: 'TARGET_VALUE_NOT_THE_CERTIFIED_KEY' };
  }
  const targetValues = scheme.targets.map((t) => numeric(t.value) ?? t.value.trim());
  if (scheme.structure !== 'SINGLE' && [...new Set(keyValues)].some((v) => !targetValues.includes(v))) return { refusal: 'KEY_VALUES_NOT_COVERED' };
  if (scheme.structure === 'SINGLE' && new Set(keyValues).size > 1) return { refusal: 'MULTIPLE_KEY_VALUES_WITHOUT_PART_STRUCTURE' };
  if (scheme.structure === 'ORDERED_PARTS' && scheme.order !== 'AS_LISTED') {
    const nums = scheme.targets.map((t) => numeric(t.value));
    if (nums.some((x) => x === null)) return { refusal: 'ORDER_NOT_SATISFIED' };
    const ok = nums.every((x, k) => k === 0 || (scheme.order === 'ASCENDING' ? x! > nums[k - 1]! : x! < nums[k - 1]!));
    if (!ok) return { refusal: 'ORDER_NOT_SATISFIED' };
  }
  // a form-aware rule scores exactly its certified point: same index, same marks, same criterion text; never implied
  for (const t of scheme.targets) {
    const r = t.method?.rule;
    if (!r) continue;
    const pts = t.method!.points;
    const marks = pts.reduce((s, k) => s + (i.rubric[k]?.marks ?? 0), 0);
    if (t.method!.impliedByCorrectAnswer || pts.length !== 1 || pts[0] !== r.provenance.rubricIndex || r.marks !== marks || i.rubric[pts[0]]?.code !== r.provenance.rubricCode || criterionDigestOf(i.rubric[pts[0]]?.criterion ?? '') !== r.provenance.criterionDigest) return { refusal: 'METHOD_RULE_NOT_THE_CERTIFIED_POINT' };
  }
  // intermediates must be TRUE of the key (each equation is satisfied by every key value)
  const numericKey = keyValues.filter((v): v is number => typeof v === 'number');
  for (const t of scheme.targets) for (const m of t.method?.intermediates ?? []) {
    if (!m.includes('=')) continue; // an expression intermediate is matched by equivalence, not by substitution
    const sat = intermediateSatisfiedBy(m, numericKey);
    if (sat === null) return { refusal: 'INTERMEDIATE_NOT_VERIFIABLE' };
    if (!sat) return { refusal: 'INTERMEDIATE_NOT_SATISFIED_BY_THE_KEY' };
  }
  // NUMBER targets are judged by THE canonical contract, which expresses every numeric rule exactly; it must be coherent.
  if (policyIssues(p as unknown as CanonicalNumericPolicy).length > 0) return { refusal: 'POLICY_INVALID' };
  // Other targets go through the math engine: only rules it expresses without weakening them are allowed.
  if (scheme.targets.some((t) => t.kind !== 'NUMBER')) { const acc = accuracyOf(p); if (!acc.ok) return { refusal: acc.refusal }; }
  return { scheme, pointMap: [...used.entries()].filter(([k]) => k < i.rubric.length).sort((a, b) => a[0] - b[0]).map(([k, target]) => ({ rubricIndex: k, code: i.rubric[k].code, kind: i.rubric[k].kind, marks: i.rubric[k].marks, target })) };
}
/** Position of rubric point k among the answer-bearing points (the policy lists them in rubric order). */
const answerOrdinal = (i: CertifiedInstance, k: number): number => i.rubric.slice(0, k).filter((pt) => ANSWER_KINDS.has(pt.kind)).length;

export type ScoringBankContent = ApprovedItemContent & CertifiedBankExtension;

/** The bank-version content that the Exam Core scores exactly as the certified instance says. Throws on a refusal. */
export function scoringBankContentOf(i: CertifiedInstance): ScoringBankContent {
  if (i.format === 'SELECTED_RESPONSE') return selectedResponseBankContentOf(i);
  const plan = planOf(i);
  if ('refusal' in plan) throw new Error(`EXAM_BANK_SCORING_PROJECTION_REFUSED: ${plan.refusal}`);
  const accuracy = accuracyOf(i.responsePolicy);
  // NUMBER targets: the contract decides; the engine fields are informational and never weaker than "exact".
  const acc = accuracy.ok ? accuracy : { ok: true as const, key: { requiredForm: 'ANY' as const, partialCredit: { formNotMet: 0, unitMissing: 0, unitWrong: 0, significantFigures: 0 } } };
  const m = materialize(i);
  const c = m.content;
  const marksOf = (points: number[]): number => (i.rubric.length ? points.reduce((s, k) => s + i.rubric[k].marks, 0) : i.marks);
  // A NUMBER target carries THE canonical response contract: the Exam Core judges it exactly as validation and certification did.
  const contract = responseContractOf(i.responsePolicy as unknown as CanonicalNumericPolicy);
  const mathOf = (t: MachineMarkScheme['targets'][number]): MathKeyContent => ({ kind: t.kind, answers: [t.value, ...t.equivalents], ...acc.key, ...(t.kind === 'NUMBER' ? { responseContract: contract } : {}) } as MathKeyContent);
  const methodOf = (t: MachineMarkScheme['targets'][number]): MethodKey | undefined => (t.method ? { marks: marksOf(t.method.points), criterion: 'M', intermediates: [...t.method.intermediates], impliedByCorrectAnswer: t.method.impliedByCorrectAnswer, ...(t.method.rule ? { rule: t.method.rule } : {}) } : undefined);
  const scoring = { contractVersion: SCORING_PROJECTION_VERSION, responseContract: contract.version, responseContractDigest: sha256OfCanonicalJson(contract), markSchemeVersion: MACHINE_MARK_SCHEME_VERSION, structure: plan.scheme.structure, markSchemeDigest: sha256OfCanonicalJson(plan.scheme), rubricDigest: sha256OfCanonicalJson(i.rubric), responsePolicyDigest: sha256OfCanonicalJson(i.responsePolicy), pointMap: plan.pointMap };
  const delivery: ApprovedItemContent = plan.scheme.structure === 'ORDERED_PARTS'
    ? {
        key: c.key, contentStatus: 'ORIGINAL', contentOrigin: 'AUTHORED', language: c.language, type: 'step_by_step', answerFormat: 'text', question: c.question,
        correctAnswer: plan.scheme.targets.map((t) => `${t.targetId}: ${t.value}`).join('; '), explanation: '', explanationStatus: 'NONE',
        difficulty: c.difficulty, marks: i.marks, calculatorAllowed: i.learner.conditions.calculator !== 'NONE', scoringStrategy: 'MULTI_PART',
        parts: plan.scheme.targets.map((t, k) => ({ id: t.targetId, prompt: i.learner.parts[k].prompt, answerFormat: 'math' as const, math: mathOf(t), ...(t.method ? { method: methodOf(t) } : {}), correctAnswer: t.value, marks: marksOf(t.answerPoints), criterion: 'A' })),
        tags: { responseFormat: c.itemType },
      }
    : (() => {
        const t = plan.scheme.targets[0];
        const method = methodOf(t);
        const math = mathOf(t);
        return {
          key: c.key, contentStatus: 'ORIGINAL', contentOrigin: 'AUTHORED', language: c.language, type: 'numeric_problem', answerFormat: 'text', question: c.question,
          correctAnswer: t.value, acceptableAnswers: [t.value, ...t.equivalents], explanation: '', explanationStatus: 'NONE',
          difficulty: c.difficulty, marks: method ? i.marks - method.marks : i.marks, calculatorAllowed: i.learner.conditions.calculator !== 'NONE',
          scoringStrategy: method ? 'METHOD_MARK' : math.units ? 'UNIT_AWARE' : 'MATHEMATICAL_EQUIVALENCE', math, ...(method ? { method } : {}),
          tags: { responseFormat: c.itemType },
        } as ApprovedItemContent;
      })();
  return {
    ...delivery,
    itemType: c.itemType, difficultyBand: c.difficultyBand, response: c.response, certifiedRubric: c.rubric, lineage: c.lineage, rights: c.rights,
    certified: { itemType: m.itemType, lineageClass: m.lineageClass, itemInstanceId: m.itemInstanceId, provenance: m.provenance, primaryConceptStableId: m.primaryConceptStableId, canonicalSubject: m.canonicalSubject, eligibilityScopes: [...m.eligibilityScopes], markedOnWorking: m.markedOnWorking, recognitionId: i.recognitionId, certificationMode: i.certificationMode, projection: SCORING_PROJECTION_VERSION, generationLineage: i.lineage, scoring } as CertifiedBankExtension['certified'] & { scoring: typeof scoring },
  } as ScoringBankContent;
}

// ------------------------------------------------------------------------------------------------ guarded scope
/**
 * Projection 3 is a GOVERNED capability for NEW IB and Cambridge content only. Every other system keeps projection 2 (the frozen PAA
 * bank was published with it, and its publication path does not change). Within IB, only explicitly governed formats.
 */
// + CAMBRIDGE (2026-10-14): 9709 Paper 1 is published with the same canonical contract (no bank was published for it before)
// + ICFES (2026-10-15): Saber 11 SELECTED_RESPONSE from deterministic constructs, scored by option identity (selected-response engine)
export const PROJECTION_3_SYSTEMS: readonly string[] = ['IB', 'CAMBRIDGE', 'ICFES'];
// + EXTENDED_RESPONSE (2026-10-15): IB Paper 3, answer marks on ONE exact value (the "hence" result), scored by the same canonical contract
export const PROJECTION_3_FORMATS: readonly string[] = ['NUMERIC_ENTRY', 'SHORT_RESPONSE', 'MULTI_PART_MATH', 'SELECTED_RESPONSE', 'EXTENDED_RESPONSE'];
export type BankProjectionChoice = { version: 'exam-bank-projection-2'; refusal: string | null } | { version: typeof SCORING_PROJECTION_VERSION; refusal: ScoringProjectionRefusal | 'FORMAT_NOT_GOVERNED_FOR_PROJECTION_3' | null };
/** Which projection publishes this instance, and whether it may. Fail closed: an IB instance never falls back to projection 2. */
export function bankProjectionFor(i: CertifiedInstance): BankProjectionChoice {
  // + PAA SELECTED_RESPONSE (2026-10-15): NEW multiple-choice PAA Matemáticas content only, scored by option identity;
  //   every other PAA instance keeps projection 2 (the frozen PAA publication path is unchanged)
  const paaSelected = i.systemId === 'PAA' && i.format === 'SELECTED_RESPONSE';
  if (!PROJECTION_3_SYSTEMS.includes(i.systemId) && !paaSelected) return { version: 'exam-bank-projection-2', refusal: projection2Refusal(i) };
  if (!PROJECTION_3_FORMATS.includes(i.format)) return { version: SCORING_PROJECTION_VERSION, refusal: 'FORMAT_NOT_GOVERNED_FOR_PROJECTION_3' };
  return { version: SCORING_PROJECTION_VERSION, refusal: i.format === 'SELECTED_RESPONSE' ? (selectedResponseRefusal(i) as ScoringProjectionRefusal | null) : scoringProjectionRefusal(i) };
}

/** Does this bank version still copy this instance exactly, under projection 3? Every top-level field that differs is named. */
export function scoringBankContentIssues(content: unknown, i: CertifiedInstance): string[] {
  let expected: ScoringBankContent;
  try { expected = scoringBankContentOf(i); } catch (e) { return [e instanceof Error ? e.message : String(e)]; }
  const got = (content ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(expected), ...Object.keys(got)])].filter((k) => sha256OfCanonicalJson((expected as unknown as Record<string, unknown>)[k] ?? null) !== sha256OfCanonicalJson(got[k] ?? null)).map((k) => `content.${k}`);
}

// ------------------------------------------------------------------------------------- selected response (projection 3)
/**
 * A deterministic SELECTED_RESPONSE instance as a governed selected-response item: the four rendered options with
 * opaque ids of their own text, the key, and for every distractor the modelled misconception it comes from. The Exam
 * Core delivers it shuffled and scores it by option identity, exactly as the PAA pilot items.
 */
const misconceptionCode = (id: string): string => `M_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`.slice(0, 80);
export function selectedResponseItemOf(i: CertifiedInstance): SelectedResponseItem {
  const itemId = `qf52.${i.instanceId.slice(0, 24)}`;
  return {
    v: 1, itemId, language: i.language, stem: i.learner.prompt,
    options: i.learner.options.map((o) => {
      const isKey = o.label === i.key.correctOption;
      const l = i.key.distractorLineage[o.label];
      return { id: optionIdOf(itemId, o.text), text: o.text, role: isKey ? 'KEY' as const : 'DISTRACTOR' as const, misconceptionId: isKey ? null : misconceptionCode(l?.misconceptionId ?? 'unmodelled'), rationale: isKey ? 'The value the construct keys, confirmed by an independent check of the shown numbers.' : (i.key.distractorRationales[o.label] ?? `Produced by the modelled error: ${l?.reasoningError ?? 'unrecorded'}.`) };
    }),
    difficulty: Math.min(5, Math.max(1, Math.round(i.itemDifficulty))), conceptStableId: i.conceptId, blueprintBucketId: i.bucketId, stimulus: null,
    rights: { category: i.rightsCategory, basis: 'StudyUs-original deterministic construct (Track B); no ICFES item is copied.' },
    lineage: { source: 'CORE_DERIVED', generator: i.rendererVersion, coverageGap: i.bucketId }, speedStrategyDigest: null,
  };
}
const objectiveOfBucket = (bucketId: string): string | null => /\/([^/#]+)#\d+$/.exec(bucketId)?.[1] ?? null;
/** The official dimensions a Saber item carries: its competency (the objective) and its content category (the governed correspondence). */
export function saberDimensionsOf(i: Pick<CertifiedInstance, 'bucketId' | 'conceptId'>): { competency: string; contentCategory: string } | null {
  const objective = objectiveOfBucket(i.bucketId);
  const competency = SABER_COMPETENCIES.find((c) => c.objectiveCode === objective)?.label ?? null;
  const category = saberCorrespondenceOf(i.conceptId)?.officialContentCategory ?? null;
  return competency && category ? { competency, contentCategory: category } : null;
}
export function selectedResponseRefusal(i: CertifiedInstance): string | null {
  if (i.responsePolicy.kind !== 'OPTION' || !i.key.correctOption || i.learner.options.length < 4) return 'SELECTED_RESPONSE_SHAPE_INVALID';
  if (i.systemId === 'ICFES' && !saberDimensionsOf(i)) return 'SABER_DIMENSION_NOT_GOVERNED';
  const issues = selectedResponseIssues(selectedResponseItemOf(i));
  return issues.length ? `SELECTED_RESPONSE_${issues[0]}` : null;
}
function selectedResponseBankContentOf(i: CertifiedInstance): ScoringBankContent {
  const refusal = selectedResponseRefusal(i);
  if (refusal) throw new Error(`EXAM_BANK_SCORING_PROJECTION_REFUSED: ${refusal}`);
  const m = materialize(i);
  const c = m.content;
  const item = selectedResponseItemOf(i);
  const fields = selectedResponseBankFields(item);
  const dims = i.systemId === 'ICFES' ? saberDimensionsOf(i)! : null;
  const scoring = { contractVersion: SCORING_PROJECTION_VERSION, responseContract: 'selected-response-1', itemDigest: selectedResponseDigest(item), rubricDigest: sha256OfCanonicalJson(i.rubric), responsePolicyDigest: sha256OfCanonicalJson(i.responsePolicy) };
  return {
    key: c.key, contentStatus: 'ORIGINAL', contentOrigin: 'AUTHORED', language: c.language, ...fields, explanation: '', explanationStatus: 'NONE',
    difficulty: c.difficulty, marks: i.marks, calculatorAllowed: i.learner.conditions.calculator !== 'NONE',
    tags: { responseFormat: c.itemType, ...(dims ?? {}) },
    itemType: c.itemType, difficultyBand: c.difficultyBand, response: c.response, certifiedRubric: c.rubric, lineage: c.lineage, rights: c.rights,
    certified: { itemType: m.itemType, lineageClass: m.lineageClass, itemInstanceId: m.itemInstanceId, provenance: m.provenance, primaryConceptStableId: m.primaryConceptStableId, canonicalSubject: m.canonicalSubject, eligibilityScopes: [...m.eligibilityScopes], markedOnWorking: m.markedOnWorking, recognitionId: i.recognitionId, certificationMode: i.certificationMode, projection: SCORING_PROJECTION_VERSION, generationLineage: i.lineage, scoring } as CertifiedBankExtension['certified'] & { scoring: typeof scoring },
  } as unknown as ScoringBankContent;
}

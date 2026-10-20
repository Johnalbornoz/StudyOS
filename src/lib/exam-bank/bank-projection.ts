/**
 * TRACK B -- the runtime projection of a certified Exam Bank instance (pure).
 *
 * The certified instance is the authority. A bank version (`approved_items.content`) is a copy of it in the shape
 * the Exam Core delivers and scores. This module builds that copy and reads it back:
 *
 *   bankContentOf(instance)            the content of the bank version
 *   certifiedMaterializationOf(content) the instance's own materialisation, recovered from a bank version
 *
 * Nothing is invented. Every delivery field is taken from the instance (prompt, key, marks, difficulty, language,
 * calculator condition). ANSWER KEY and EXPLANATION are different things: an instance carries a key and no certified
 * solution, so the version carries the key in its key fields and NO explanation -- never the key relabelled as one.
 *
 * Two records are kept apart and both are kept (they are different facts about the same item):
 *   A. the generation lineage: what the renderer recorded when it rendered the instance, immutable, the input of the
 *      lineage digest. It is copied whole and never rewritten -- including the certification state it had THEN.
 *   B. the publication certification: recorded by the loader when the instance is published (the instance row, the
 *      object certifications, the version's validation report). It never claims to have existed at rendering time.
 *
 * Only what the Exam Core can score WITHOUT a marker is projected: a numeric entry with an answer key. An instance
 * whose working is marked is not projected (`projectionRefusal`): it stays a certified instance with no bank row.
 */
import type { ApprovedItemContent } from '@/lib/exam-core/items';
import { materialize, materializationIssues, type CertifiedInstance, type MaterializedItem } from '@/lib/assessment-instance/v52';

/**
 * 2: an instance has an answer key and no certified explanation, and the version says so (`explanationStatus: NONE`,
 *    empty explanation) instead of presenting the key as if it were an explanation; the immutable generation lineage
 *    is kept whole (`certified.generationLineage`).
 * 1: superseded (it stated the keyed answer in the explanation field).
 */
export const BANK_PROJECTION_VERSION = 'exam-bank-projection-2';
/** What a bank version of a certified instance may be used for. A full mock is a property of the FORM (a FULL blueprint), never claimed here. */
export const CORE_DERIVED_USAGE = ['PRACTICE', 'REDUCED_MOCK'] as const;
export const CORE_DERIVED_ALIGNMENT = 'MOCK_READY' as const;

export type ProjectionRefusal = 'RESPONSE_IS_MARKED_ON_WORKING' | 'RESPONSE_IS_NOT_A_NUMERIC_ENTRY' | 'HAS_A_STIMULUS_OR_PARTS' | 'NO_ANSWER_KEY';
/** Why this instance cannot be a bank version the Exam Core scores on its own. null = it can. */
export function projectionRefusal(i: CertifiedInstance): ProjectionRefusal | null {
  if (i.markedOnWorking) return 'RESPONSE_IS_MARKED_ON_WORKING';
  if (i.responsePolicy.kind !== 'NUMERIC' || i.format !== 'NUMERIC_ENTRY') return 'RESPONSE_IS_NOT_A_NUMERIC_ENTRY';
  if (i.learner.stimulus !== null || i.learner.parts.length > 0 || i.learner.options.length > 0) return 'HAS_A_STIMULUS_OR_PARTS';
  if (i.key.answers.length === 0 || i.key.answers.some((a) => !a.trim())) return 'NO_ANSWER_KEY';
  return null;
}

/** The certified part of a bank version: the instance's materialisation, kept whole beside the delivery fields. */
export interface CertifiedBankExtension {
  itemType: MaterializedItem['content']['itemType'];
  difficultyBand: MaterializedItem['content']['difficultyBand'];
  response: MaterializedItem['content']['response'];
  certifiedRubric: MaterializedItem['content']['rubric'];
  lineage: MaterializedItem['content']['lineage'];
  rights: MaterializedItem['content']['rights'];
  certified: { itemType: MaterializedItem['itemType']; lineageClass: MaterializedItem['lineageClass']; itemInstanceId: string; provenance: MaterializedItem['provenance']; primaryConceptStableId: string; canonicalSubject: string; eligibilityScopes: string[]; markedOnWorking: boolean; recognitionId: string; certificationMode: CertifiedInstance['certificationMode']; projection: string; /** A. The renderer's own lineage record, whole and unchanged: the certification state it names is the state at RENDERING, not the publication's. */ generationLineage: CertifiedInstance['lineage'] };
}
export type CoreDerivedBankContent = ApprovedItemContent & CertifiedBankExtension;

export function bankContentOf(i: CertifiedInstance): CoreDerivedBankContent {
  const refusal = projectionRefusal(i);
  if (refusal) throw new Error(`EXAM_BANK_PROJECTION_REFUSED: ${refusal}`);
  const m = materialize(i);
  const c = m.content;
  return {
    // ---- what the Exam Core delivers and scores
    key: c.key, contentStatus: 'ORIGINAL', contentOrigin: 'AUTHORED', language: c.language, type: 'numeric_problem', answerFormat: 'text', question: c.question,
    correctAnswer: c.correctAnswer, acceptableAnswers: [...c.acceptableAnswers], explanation: '', explanationStatus: 'NONE',
    difficulty: c.difficulty, marks: c.marks, calculatorAllowed: i.learner.conditions.calculator !== 'NONE', scoringStrategy: 'MATHEMATICAL_EQUIVALENCE',
    // all-or-nothing: the instance's response policy awards no partial credit
    math: { kind: 'NUMBER', answers: [...c.acceptableAnswers], requiredForm: 'ANY', partialCredit: { formNotMet: 0, unitMissing: 0, unitWrong: 0, significantFigures: 0 } },
    tags: { responseFormat: c.itemType },
    // ---- the certified instance, whole
    itemType: c.itemType, difficultyBand: c.difficultyBand, response: c.response, certifiedRubric: c.rubric, lineage: c.lineage, rights: c.rights,
    certified: { itemType: m.itemType, lineageClass: m.lineageClass, itemInstanceId: m.itemInstanceId, provenance: m.provenance, primaryConceptStableId: m.primaryConceptStableId, canonicalSubject: m.canonicalSubject, eligibilityScopes: [...m.eligibilityScopes], markedOnWorking: m.markedOnWorking, recognitionId: i.recognitionId, certificationMode: i.certificationMode, projection: BANK_PROJECTION_VERSION, generationLineage: i.lineage },
  };
}

/** The instance's own materialisation, recovered from a bank version. Throws when the content is not a core-derived projection. */
export function certifiedMaterializationOf(content: unknown): MaterializedItem {
  const c = content as Partial<CoreDerivedBankContent>;
  if (!c?.certified || !c.lineage || !c.response || !c.rights || !c.certifiedRubric || !c.math) throw new Error('NOT_A_CORE_DERIVED_BANK_VERSION');
  return {
    itemType: c.certified.itemType, lineageClass: c.certified.lineageClass, itemInstanceId: c.certified.itemInstanceId, provenance: c.certified.provenance, primaryConceptStableId: c.certified.primaryConceptStableId, canonicalSubject: c.certified.canonicalSubject,
    eligibilityScopes: [...c.certified.eligibilityScopes] as MaterializedItem['eligibilityScopes'], markedOnWorking: c.certified.markedOnWorking,
    content: {
      key: c.key!, language: c.language!, question: c.question!, itemType: c.itemType!, marks: c.marks!, difficulty: c.difficulty!, difficultyBand: c.difficultyBand!, options: [], correctAnswer: c.correctAnswer!, acceptableAnswers: [...(c.acceptableAnswers ?? [])],
      response: c.response, math: { kind: 'NUMBER', answers: [...c.math.answers], requiredForm: 'ANY' }, rubric: c.certifiedRubric, lineage: c.lineage, rights: c.rights,
    },
  };
}

/** Does this bank version still copy this instance exactly? Every field that differs is named. Empty = it does. */
export function bankContentIssues(content: unknown, i: CertifiedInstance): string[] {
  let recovered: MaterializedItem;
  try { recovered = certifiedMaterializationOf(content); } catch (e) { return [e instanceof Error ? e.message : String(e)]; }
  return materializationIssues(recovered, i);
}

/**
 * Saber 11 Matemáticas pilot -- HUMAN REVIEW contract (pure): what a qualified human reviewer records per
 * item, how it is checked, and the calibration report computed from the recorded decisions.
 *
 * The AI never decides here. It proposes (competence / content category / StudyUs difficulty / key), the
 * automated pipeline validates, and a HUMAN records, explicitly and for every item:
 *   - the 9 checklist points of REVIEW_CHECKLIST (each explicitly true or false -- never "not answered");
 *   - the competence, content category, StudyUs difficulty and correct option THEY determine;
 *   - for CORRECTION_REQUIRED: the failed points, a comment and correction notes;
 *   - for REJECTED: the failed points and the reason;
 *   - their answer to each attention point raised by the automated pre-review (confirmed / not confirmed).
 *
 * Decision names: the brief's HUMAN_APPROVED / CORRECTION_REQUIRED / REJECTED are the DB contract's
 * APPROVED / CORRECTION_REQUESTED / REJECTED (question_bank_reviews.decision) -- one vocabulary per layer.
 * An automated PASS (PILOT) is NEVER a human decision: an item without a review row is AWAITING_HUMAN_REVIEW.
 */
import { z } from 'zod';
import { COMPETENCIES, CONTENTS, DIFFICULTY_POLICY, REVIEW_CHECKLIST, type ReviewChecklistKey, type Saber11Competency, type Saber11Content, type StudyUsDifficulty } from './saber11-math';
import { dimensionKey } from '../../slot-constraints';
import type { ReviewDecision } from '../quality';

export const PILOT_REVIEW_CONTRACT = 'saber11-math-human-review-1' as const;

/** Brief vocabulary <-> DB contract. */
export const HUMAN_DECISION_LABEL: Record<ReviewDecision, 'HUMAN_APPROVED' | 'CORRECTION_REQUIRED' | 'REJECTED'> = {
  APPROVED: 'HUMAN_APPROVED',
  CORRECTION_REQUESTED: 'CORRECTION_REQUIRED',
  REJECTED: 'REJECTED',
};

const COMPETENCY_KEYS = Object.keys(COMPETENCIES) as Saber11Competency[];
const CONTENT_KEYS = Object.keys(CONTENTS) as Saber11Content[];
const DIFFICULTY_KEYS = Object.keys(DIFFICULTY_POLICY) as StudyUsDifficulty[];
export const NO_SINGLE_ANSWER = 'NO_SINGLE_ANSWER' as const;

export const PilotReviewAssessmentSchema = z.strictObject({
  contract: z.literal(PILOT_REVIEW_CONTRACT),
  reviewedCompetency: z.enum(COMPETENCY_KEYS as [Saber11Competency, ...Saber11Competency[]]),
  reviewedContentCategory: z.enum(CONTENT_KEYS as [Saber11Content, ...Saber11Content[]]),
  reviewedDifficulty: z.enum(DIFFICULTY_KEYS as [StudyUsDifficulty, ...StudyUsDifficulty[]]),
  /** The option the reviewer determines to be the single correct answer, or NO_SINGLE_ANSWER. */
  reviewedAnswer: z.union([z.string().regex(/^[A-Z]$/), z.literal(NO_SINGLE_ANSWER)]),
  correctionNotes: z.string().trim().max(2000).nullable().optional(),
  /** The reviewer's answer to each automated attention point of this item. */
  attentionPoints: z.record(z.string().regex(/^[A-Z0-9_]{2,60}$/), z.enum(['CONFIRMED', 'NOT_CONFIRMED'])).optional(),
});
export type PilotReviewAssessment = z.infer<typeof PilotReviewAssessmentSchema>;

/** What the generator / pipeline PROPOSED for an item (the reviewer confirms or corrects each). */
export interface PilotProposal {
  competency: Saber11Competency | null;
  contentCategory: Saber11Content | null;
  difficulty: StudyUsDifficulty | null;
  answerKey: string | null;
  optionIds: string[];
}

const byLabel = <K extends string>(table: Record<K, { label: string }>, label: unknown): K | null => {
  if (typeof label !== 'string' || !label.trim()) return null;
  const key = dimensionKey(label);
  return (Object.keys(table) as K[]).find((k) => dimensionKey(table[k].label) === key) ?? null;
};

/** The internal 1-5 scale point of a StudyUs difficulty, and back (2 / 3 / 4 only; anything else is unknown). */
export const difficultyInternal = (d: StudyUsDifficulty): number => DIFFICULTY_POLICY[d].internal;
export const studyUsDifficulty = (internal: unknown): StudyUsDifficulty | null => DIFFICULTY_KEYS.find((d) => DIFFICULTY_POLICY[d].internal === internal) ?? null;

/** The proposal as the item itself declares it (tags / difficulty / key). */
export function proposalFromContent(content: { tags?: Record<string, unknown> | null; difficulty?: unknown; correctAnswer?: unknown; options?: Array<{ id: string }> | null } | null | undefined): PilotProposal {
  const tags = (content?.tags ?? {}) as Record<string, unknown>;
  return {
    competency: byLabel(COMPETENCIES, tags.competency),
    contentCategory: byLabel(CONTENTS, tags.contentCategory),
    difficulty: studyUsDifficulty(content?.difficulty),
    answerKey: typeof content?.correctAnswer === 'string' ? content.correctAnswer : null,
    optionIds: (content?.options ?? []).map((o) => o.id),
  };
}

/* ------------------------------------------------------------------ */
/* Attention points (automated pre-review, calibration batch 1)         */
/* ------------------------------------------------------------------ */

/**
 * Observations of the automated pre-review of calibration batch 1, shown to the reviewer as points to
 * CONFIRM OR REJECT -- never decisions. Keyed by item key (DEV, batch calibration-1).
 */
export const CALIBRATION_1_ATTENTION_POINTS: Record<string, Array<{ code: string; text: string }>> = {
  'qb.saber.interpretacion.d1bb446253': [
    { code: 'COMPETENCE_MAY_BE_FORMULATION', text: 'El ítem plantea y resuelve una ecuación (18 − 1,5d = 6): podría corresponder mejor a Formulación y ejecución que a Interpretación y representación.' },
    { code: 'DISTRACTOR_RATIONALES_IMPRECISE', text: 'Algunos racionales de distractores no describen con precisión el error que lleva a esa opción.' },
  ],
  'qb.saber.formulacion.3d04bf73f9': [
    { code: 'DISTRACTOR_RATIONALE_MISPLACED', text: 'El error de intercambiar precios da 100 (opción A), pero el racional de ese error aparece en la opción C.' },
  ],
  'qb.saber.formulacion.aca89de0b2': [{ code: 'DISTRACTOR_RATIONALES_IMPRECISE', text: 'Algunos racionales de distractores no describen con precisión el error que lleva a esa opción.' }],
  'qb.saber.formulacion.f318dfdb74': [{ code: 'DISTRACTOR_RATIONALES_IMPRECISE', text: 'Algunos racionales de distractores no describen con precisión el error que lleva a esa opción.' }],
  'qb.saber.argumentacion.52fc43dc03': [
    { code: 'WEAK_DISTRACTOR_D', text: 'La opción D parece un distractor débil.' },
    { code: 'MATH_DELIMITERS', text: 'Usa delimitadores LaTeX \\( \\) que el renderizador de ítems no muestra (el estudiante vería el texto crudo).' },
    { code: 'EXPLANATION_DOES_NOT_STATE_KEY', text: 'La validación automática advirtió que la explicación no enuncia la clave.' },
  ],
  'qb.saber.argumentacion.cd009f77a3': [
    { code: 'WEAK_DISTRACTOR_A', text: 'La opción A (187,5 %, mayor que 100 %) parece un distractor débil.' },
    { code: 'SKILL_TAG_TRUNCATED', text: 'La etiqueta de habilidad está truncada ("…utilizadas para d").' },
  ],
};

/** Applies to every item that passed automated validation in batch 1. */
export const CALIBRATION_1_COMMON_ATTENTION_POINT = { code: 'VALIDATOR_ESTIMATED_EASIER', text: 'El validador independiente estimó dificultad BAJA; el generador propuso la indicada. ¿La dificultad StudyUs propuesta es razonable?' } as const;

export function attentionPointsFor(itemKey: string, batch: string): Array<{ code: string; text: string }> {
  if (batch !== 'calibration-1') return [];
  return [...(CALIBRATION_1_ATTENTION_POINTS[itemKey] ?? []), CALIBRATION_1_COMMON_ATTENTION_POINT];
}

/* ------------------------------------------------------------------ */
/* Decision rules                                                       */
/* ------------------------------------------------------------------ */

export type ReviewProblem =
  | 'CHECKLIST_POINT_UNANSWERED'
  | 'CHECKLIST_FAILURE_REQUIRED'
  | 'ASSESSMENT_REQUIRED'
  | 'ASSESSMENT_INVALID'
  | 'ANSWER_NOT_AN_OPTION'
  | 'ANSWER_INCONSISTENT'
  | 'COMPETENCE_INCONSISTENT'
  | 'CONTENT_CATEGORY_INCONSISTENT'
  | 'DIFFICULTY_INCONSISTENT'
  | 'CORRECTION_NOTES_REQUIRED'
  | 'ATTENTION_POINT_UNANSWERED';

/**
 * Every problem of a pilot decision (empty = acceptable). Applies to EVERY decision, not only approvals:
 * a correction or a rejection must also answer every point, name what failed and say why.
 */
export function pilotDecisionProblems(p: {
  decision: ReviewDecision;
  checklist: Record<string, boolean> | null | undefined;
  assessment: unknown;
  proposal: PilotProposal;
  requiredChecklist: readonly string[];
  attentionPointCodes?: readonly string[];
}): ReviewProblem[] {
  const out = new Set<ReviewProblem>();
  const cl = p.checklist ?? {};
  if (p.requiredChecklist.some((k) => typeof cl[k] !== 'boolean')) out.add('CHECKLIST_POINT_UNANSWERED');
  const failed = p.requiredChecklist.filter((k) => cl[k] === false);
  if (p.decision !== 'APPROVED' && failed.length === 0) out.add('CHECKLIST_FAILURE_REQUIRED');
  if (p.assessment === null || p.assessment === undefined) {
    out.add('ASSESSMENT_REQUIRED');
    return [...out];
  }
  const parsed = PilotReviewAssessmentSchema.safeParse(p.assessment);
  if (!parsed.success) {
    out.add('ASSESSMENT_INVALID');
    return [...out];
  }
  const a = parsed.data;
  // Each confirmed point must agree with what the reviewer determined (and a disagreement is a failed point).
  const consistent = (point: ReviewChecklistKey, same: boolean, code: ReviewProblem) => {
    if (typeof cl[point] === 'boolean' && cl[point] !== same) out.add(code);
  };
  if (a.reviewedAnswer !== NO_SINGLE_ANSWER && !p.proposal.optionIds.includes(a.reviewedAnswer)) out.add('ANSWER_NOT_AN_OPTION');
  consistent('ANSWER', a.reviewedAnswer === p.proposal.answerKey, 'ANSWER_INCONSISTENT');
  consistent('COMPETENCE', a.reviewedCompetency === p.proposal.competency, 'COMPETENCE_INCONSISTENT');
  consistent('CONTENT_CATEGORY', a.reviewedContentCategory === p.proposal.contentCategory, 'CONTENT_CATEGORY_INCONSISTENT');
  consistent('DIFFICULTY', a.reviewedDifficulty === p.proposal.difficulty, 'DIFFICULTY_INCONSISTENT');
  if (p.decision === 'CORRECTION_REQUESTED' && (a.correctionNotes ?? '').trim().length < 5) out.add('CORRECTION_NOTES_REQUIRED');
  if ((p.attentionPointCodes ?? []).some((c) => !a.attentionPoints?.[c])) out.add('ATTENTION_POINT_UNANSWERED');
  return [...out];
}

/* ------------------------------------------------------------------ */
/* Blueprint V2.1 cell                                                  */
/* ------------------------------------------------------------------ */

/** The V2.1 slot signature of a competence x content cell (COMPETENCE / CONTENT_CATEGORY / MARKS=1). */
export function v21CellSignature(competency: Saber11Competency, content: Saber11Content): string {
  return `COMPETENCE=${dimensionKey(COMPETENCIES[competency].label)};CONTENT_CATEGORY=${dimensionKey(CONTENTS[content].label)};MARKS=1`;
}

/**
 * Does the item's proposed classification land in the cell its generation request asked for, under its
 * objective, and is that a declared cell of the V2.1 blueprint? (The reviewer judges whether it is RIGHT.)
 */
export function v21CellCheck(p: { requested: { competency: Saber11Competency; content: Saber11Content | null }; objectiveCode: string | null; proposal: PilotProposal; marks: unknown; declaredSignatures: ReadonlySet<string> }): { cell: string; matchesRequest: boolean; declaredInV21: boolean; problems: string[] } {
  const problems: string[] = [];
  const comp = p.proposal.competency;
  const cont = p.proposal.contentCategory;
  if (!comp) problems.push('COMPETENCE_TAG_UNRECOGNISED');
  if (!cont) problems.push('CONTENT_TAG_UNRECOGNISED');
  if (p.marks !== 1) problems.push('MARKS_NOT_1');
  if (comp && p.objectiveCode !== COMPETENCIES[comp].objectiveCode) problems.push('OBJECTIVE_NOT_COMPETENCE_OBJECTIVE');
  if (comp && comp !== p.requested.competency) problems.push('COMPETENCE_DIFFERS_FROM_REQUEST');
  if (cont && p.requested.content && cont !== p.requested.content) problems.push('CONTENT_DIFFERS_FROM_REQUEST');
  const sig = comp && cont ? v21CellSignature(comp, cont) : '';
  const declaredInV21 = !!sig && p.declaredSignatures.has(sig);
  if (sig && !declaredInV21) problems.push('CELL_NOT_DECLARED_IN_V2_1');
  const label = comp && cont ? `${comp} × ${cont}` : 'UNKNOWN';
  return { cell: label, matchesRequest: !problems.some((x) => x.endsWith('_FROM_REQUEST')), declaredInV21, problems };
}

/* ------------------------------------------------------------------ */
/* Calibration report                                                   */
/* ------------------------------------------------------------------ */

export interface ReviewReportRow {
  ordinal: number;
  itemKey: string;
  /** Automated outcome of the current version: PASS (sent to human review) or AUTO_REJECTED. */
  autoStatus: 'PASSED_AUTOMATED_VALIDATION' | 'AUTO_REJECTED';
  autoIssues: string[];
  lifecycle: string | null;
  proposal: PilotProposal;
  /** Latest HUMAN decision (null = none recorded). */
  decision: ReviewDecision | null;
  checklist: Record<string, boolean> | null;
  assessment: PilotReviewAssessment | null;
  notes: string | null;
  /** The decision was recorded by the item's author / a system identity (must be 0). */
  invalidReviewer: boolean;
  /** Item-level Student practice eligibility of the current version under the delivery rules. */
  practiceEligible: boolean;
}

export type Batch2Recommendation = 'READY_TO_CALIBRATE_GENERATOR' | 'READY_FOR_BATCH_2_WITHOUT_CHANGES' | 'NOT_READY_FOR_BATCH_2';

const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : null);
/** The planning assumption of the pilot (NOT a measured truth). */
export const ASSUMED_TOTAL_REJECTION_RATE = 0.25;

function confusion<K extends string>(rows: ReviewReportRow[], proposed: (r: ReviewReportRow) => K | null, reviewed: (r: ReviewReportRow) => K | null) {
  const pairs = rows.filter((r) => r.assessment).map((r) => ({ item: r.ordinal, proposed: proposed(r), reviewed: reviewed(r) }));
  const agree = pairs.filter((x) => x.proposed !== null && x.proposed === x.reviewed).length;
  const matrix: Record<string, number> = {};
  for (const x of pairs) matrix[`${x.proposed ?? 'UNKNOWN'} -> ${x.reviewed ?? 'UNKNOWN'}`] = (matrix[`${x.proposed ?? 'UNKNOWN'} -> ${x.reviewed ?? 'UNKNOWN'}`] ?? 0) + 1;
  return { reviewed: pairs.length, agree, accuracy: rate(agree, pairs.length), corrections: pairs.filter((x) => x.proposed !== x.reviewed), matrix };
}

export function buildHumanReviewReport(rows: ReviewReportRow[]) {
  const generated = rows.length;
  const autoRejected = rows.filter((r) => r.autoStatus === 'AUTO_REJECTED').length;
  const sent = rows.filter((r) => r.autoStatus !== 'AUTO_REJECTED');
  const decided = sent.filter((r) => r.decision);
  const approved = decided.filter((r) => r.decision === 'APPROVED').length;
  const correction = decided.filter((r) => r.decision === 'CORRECTION_REQUESTED').length;
  const humanRejected = decided.filter((r) => r.decision === 'REJECTED').length;
  const awaiting = sent.length - decided.length;
  const invalidReviewers = rows.filter((r) => r.invalidReviewer).length;
  const missingAssessment = decided.filter((r) => !r.assessment).length;

  const failures: Record<string, number> = Object.fromEntries(REVIEW_CHECKLIST.map(([k]) => [k, 0]));
  for (const r of decided) for (const [k, v] of Object.entries(r.checklist ?? {})) if (v === false) failures[k] = (failures[k] ?? 0) + 1;
  const attention: Record<string, { confirmed: number; notConfirmed: number }> = {};
  for (const r of decided) for (const [k, v] of Object.entries(r.assessment?.attentionPoints ?? {})) {
    attention[k] ??= { confirmed: 0, notConfirmed: 0 };
    attention[k][v === 'CONFIRMED' ? 'confirmed' : 'notConfirmed'] += 1;
  }
  const withAssessment = decided.filter((r) => r.assessment);
  const answerKeyCorrect = withAssessment.filter((r) => r.assessment!.reviewedAnswer === r.proposal.answerKey).length;
  const competence = confusion(decided, (r) => r.proposal.competency, (r) => r.assessment?.reviewedCompetency ?? null);
  const content = confusion(decided, (r) => r.proposal.contentCategory, (r) => r.assessment?.reviewedContentCategory ?? null);
  const difficulty = confusion(decided, (r) => r.proposal.difficulty, (r) => r.assessment?.reviewedDifficulty ?? null);
  const order: StudyUsDifficulty[] = ['BASIC', 'INTERMEDIATE', 'ADVANCED'];
  const shift = withAssessment.filter((r) => r.proposal.difficulty).map((r) => order.indexOf(r.assessment!.reviewedDifficulty) - order.indexOf(r.proposal.difficulty!));
  const totalRejected = autoRejected + humanRejected;

  const reviewComplete = generated > 0 && awaiting === 0;
  const status = reviewComplete ? 'HUMAN_REVIEW_COMPLETE' : decided.length === 0 ? 'AWAITING_HUMAN_REVIEW' : 'HUMAN_REVIEW_IN_PROGRESS';
  const generatorSignals = [
    ...(Object.values(failures).some((n) => n > 0) ? ['CHECKLIST_FAILURES'] : []),
    ...(competence.corrections.length ? ['COMPETENCE_MISCLASSIFIED'] : []),
    ...(content.corrections.length ? ['CONTENT_CATEGORY_MISCLASSIFIED'] : []),
    ...(difficulty.corrections.length ? ['DIFFICULTY_MISCALIBRATED'] : []),
    ...(withAssessment.length && answerKeyCorrect < withAssessment.length ? ['WRONG_ANSWER_KEYS'] : []),
    ...(autoRejected > 0 ? ['AUTOMATED_REJECTIONS'] : []),
  ];
  let batch2: Batch2Recommendation;
  let batch2Reason: string;
  if (!reviewComplete) [batch2, batch2Reason] = ['NOT_READY_FOR_BATCH_2', `${awaiting} item(s) still await a human decision`];
  else if (invalidReviewers > 0 || missingAssessment > 0) [batch2, batch2Reason] = ['NOT_READY_FOR_BATCH_2', 'a decision lacks a valid human reviewer or its structured assessment'];
  else if (generatorSignals.length === 0) [batch2, batch2Reason] = ['READY_FOR_BATCH_2_WITHOUT_CHANGES', 'every reviewed item approved with no correction, no misclassification and no automated rejection'];
  else [batch2, batch2Reason] = ['READY_TO_CALIBRATE_GENERATOR', `calibrate first: ${generatorSignals.join(', ')}`];

  const deliverableApproved = decided.filter((r) => r.decision === 'APPROVED' && r.practiceEligible).length;
  return {
    status,
    funnel: { generated, autoRejected, sentToHumanReview: sent.length, humanDecided: decided.length, awaitingHumanReview: awaiting, humanApproved: approved, correctionRequired: correction, humanRejected },
    rates: {
      automaticRejectionRate: rate(autoRejected, generated),
      humanApprovalRateAmongReviewed: rate(approved, decided.length),
      finalFirstPassApprovalRateAmongAll: rate(approved, generated),
      correctionRateAmongReviewed: rate(correction, decided.length),
      correctionRateAmongAll: rate(correction, generated),
      /** Automatic + human rejections over all generated (a lower bound while review is pending). */
      totalRejectionRate: rate(totalRejected, generated),
      /** Not accepted on first pass (rejected + correction required) over all generated; null until review is complete. */
      firstPassNonAcceptanceRate: reviewComplete ? rate(totalRejected + correction, generated) : null,
      /** The pilot's PLANNING assumption -- compared with, never used as, the observed rate. */
      assumedRejectionRate: ASSUMED_TOTAL_REJECTION_RATE,
      observedMinusAssumed: reviewComplete && generated ? { totalRejection: Math.round((totalRejected / generated - ASSUMED_TOTAL_REJECTION_RATE) * 1000) / 1000, firstPassNonAcceptance: Math.round(((totalRejected + correction) / generated - ASSUMED_TOTAL_REJECTION_RATE) * 1000) / 1000 } : null,
    },
    checklistFailures: failures,
    /**
     * What the failure counts are measured over. With no human decision yet, every count is 0 because NOTHING
     * HAS BEEN REVIEWED -- never "every point passed".
     */
    checklistFailureBasis: decided.length === 0
      ? { humanDecisions: 0, meaning: 'NO_REVIEWS_YET' as const, text: '0 fallos porque aún no hay revisiones humanas; no significa que todos los puntos hayan pasado.' }
      : { humanDecisions: decided.length, meaning: 'OBSERVED' as const, text: `Fallos observados en ${decided.length} decisión(es) humana(s).` },
    attentionPoints: attention,
    answerKeyAccuracy: { reviewed: withAssessment.length, correct: answerKeyCorrect, accuracy: rate(answerKeyCorrect, withAssessment.length) },
    competence,
    contentCategory: content,
    difficulty: { ...difficulty, meanShiftSteps: shift.length ? Math.round((shift.reduce((a, b) => a + b, 0) / shift.length) * 100) / 100 : null },
    integrity: { invalidReviewers, missingAssessment },
    batch2: { recommendation: batch2, reason: batch2Reason },
    e2e: { approvedPracticeEligible: deliverableApproved, realContentE2EAvailable: deliverableApproved > 0 ? ('YES' as const) : ('NO' as const) },
    items: rows.map((r) => ({
      item: r.ordinal,
      itemKey: r.itemKey,
      autoStatus: r.autoStatus,
      autoIssues: r.autoIssues,
      humanDecision: r.decision ? HUMAN_DECISION_LABEL[r.decision] : r.autoStatus === 'AUTO_REJECTED' ? 'AUTO_REJECTED' : 'AWAITING_HUMAN_REVIEW',
      answerKey: r.proposal.answerKey,
      reviewedAnswer: r.assessment?.reviewedAnswer ?? null,
      competenceProposed: r.proposal.competency,
      competenceReviewed: r.assessment?.reviewedCompetency ?? null,
      contentProposed: r.proposal.contentCategory,
      contentReviewed: r.assessment?.reviewedContentCategory ?? null,
      difficultyProposed: r.proposal.difficulty,
      difficultyReviewed: r.assessment?.reviewedDifficulty ?? null,
      checklistFailures: Object.entries(r.checklist ?? {}).filter(([, v]) => v === false).map(([k]) => k),
      correctionRequired: r.decision === 'CORRECTION_REQUESTED' ? r.assessment?.correctionNotes ?? null : null,
      reviewerNotes: r.notes,
    })),
  };
}
export type HumanReviewReport = ReturnType<typeof buildHumanReviewReport>;

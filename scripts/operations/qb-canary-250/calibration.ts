/**
 * STUDYUS_HUMAN_CALIBRATION_SET -- the structure in which qualified people's judgements of sampled canary items
 * are recorded (pure: a schema, a validator and an empty template; a FILE, no database). FROZEN.
 *
 * WHAT IT IS FOR. Calibration answers improve the NEXT version of the reviewer, the generator and the deterministic
 * rules. THEY MUST NOT BE USED TO RESCORE THE SAME CANARY AS IF THAT WERE INDEPENDENT CERTIFICATION EVIDENCE: a
 * reviewer tuned on these answers has seen them, and its agreement with them proves nothing about new items.
 *
 * A HUMAN_DECISION here is a calibration label on dev-test content. It is not a Question Bank approval, it moves no
 * lifecycle, and it establishes no rights.
 */
import { z } from 'zod';

export const CALIBRATION_SET = { kind: 'STUDYUS_HUMAN_CALIBRATION_SET', version: '1' } as const;
export const DEFECT_CLASS_VOCABULARY = { id: 'studyus-calibration-defect-class', version: '1', status: 'PROPOSED', values: ['NONE', 'WRONG_KEY', 'WRONG_MATHEMATICS', 'AMBIGUOUS_OR_MULTIPLE_ANSWERS', 'CONSTRUCT_NOT_MEASURED', 'ANSWER_GIVEN_AWAY', 'PROFILE_MISMATCH', 'RESPONSE_FORMAT_DEFECT', 'MARK_SCHEME_DEFECT', 'DISTRACTOR_DEFECT', 'STIMULUS_DEFECT', 'DIFFICULTY_MISMATCH', 'LANGUAGE_OR_CLARITY', 'IMPLAUSIBLE_CONTEXT', 'FAIRNESS_OR_BIAS', 'ORIGINALITY_CONCERN', 'LINEAGE_OR_METADATA', 'OTHER'] } as const;
export const SEVERITY_VOCABULARY = { id: 'studyus-calibration-severity', version: '1', status: 'PROPOSED', values: ['NONE', 'MINOR', 'MAJOR', 'CRITICAL'], meanings: { NONE: 'no defect', MINOR: 'usable; a small edit would improve it', MAJOR: 'not usable without a substantive change', CRITICAL: 'wrong or harmful: a learner would be taught or scored wrongly' } } as const;
export const AI_DECISIONS = ['APPROVED', 'NEEDS_HUMAN_REVIEW', 'REJECTED', 'REVIEWER_FAILURE'] as const;
export const HUMAN_DECISIONS = ['APPROVED', 'REJECTED', 'CANNOT_JUDGE'] as const;
export const AGREEMENTS = ['AGREE', 'AI_TOO_LENIENT', 'AI_TOO_STRICT', 'AI_DEFERRED', 'NOT_COMPARABLE'] as const;
export type Agreement = (typeof AGREEMENTS)[number];

const TEXT = z.string().trim().min(1).max(2000);
export const CalibrationRowSchema = z.strictObject({
  ITEM_ID: z.string().regex(/^c250-\d{3}$/),
  AI_DECISION: z.enum(AI_DECISIONS),
  HUMAN_DECISION: z.enum(HUMAN_DECISIONS).nullable(),
  AGREEMENT: z.enum(AGREEMENTS).nullable(),
  HUMAN_REASON: TEXT.nullable(),
  DEFECT_CLASS: z.enum(DEFECT_CLASS_VOCABULARY.values).nullable(),
  SEVERITY: z.enum(SEVERITY_VOCABULARY.values).nullable(),
  /** A rule a deterministic validator could apply to catch this (or to stop catching it), in the reviewer's words. */
  DETERMINISTIC_RULE_CANDIDATE: TEXT.nullable(),
  /** A rule for the generator's templates or harness. */
  GENERATOR_RULE_CANDIDATE: TEXT.nullable(),
  /** A rule for the AI reviewer's prompt or decision policy. */
  REVIEWER_RULE_CANDIDATE: TEXT.nullable(),
  REVIEWER_ID: z.string().trim().min(1).max(120).nullable(),
  REVIEWER_QUALIFICATION: z.string().trim().min(1).max(300).nullable(),
  REVIEWED_AT: z.string().datetime({ offset: true }).nullable(),
  /** Whether the person saw the item without the AI decision and the validator outcome. */
  REVIEWED_BLIND: z.boolean().nullable(),
});
export type CalibrationRow = z.infer<typeof CalibrationRowSchema>;
export const CalibrationSetSchema = z.strictObject({
  kind: z.literal(CALIBRATION_SET.kind), version: z.literal(CALIBRATION_SET.version),
  about: z.string(), notForRescoring: z.string(),
  vocabularies: z.strictObject({ defectClass: z.strictObject({ id: z.string(), version: z.string() }), severity: z.strictObject({ id: z.string(), version: z.string() }) }),
  source: z.strictObject({ canary: z.literal('qb-canary-250'), runId: z.string().nullable(), freezeCommitSha: z.string().nullable(), freezeManifestHash: z.string().nullable(), sampleProcedure: z.strictObject({ id: z.string(), version: z.string() }), reviewerVersion: z.string() }),
  rows: z.array(CalibrationRowSchema),
});
export type CalibrationSet = z.infer<typeof CalibrationSetSchema>;

export const CALIBRATION_ABOUT = 'Judgements of qualified people on a sample of canary items, beside the AI decision on each. Dev-test content; a calibration label is not a Question Bank approval.' as const;
export const CALIBRATION_NOT_FOR_RESCORING = 'Calibration answers improve the NEXT reviewer, generator and validator versions. They must not be used to silently rescore this same canary as independent certification evidence.' as const;

/** What the two decisions say about each other. */
export function agreementOf(ai: CalibrationRow['AI_DECISION'], human: NonNullable<CalibrationRow['HUMAN_DECISION']>): Agreement {
  if (human === 'CANNOT_JUDGE' || ai === 'REVIEWER_FAILURE') return 'NOT_COMPARABLE';
  if (ai === 'NEEDS_HUMAN_REVIEW') return 'AI_DEFERRED';
  if (ai === human) return 'AGREE';
  return ai === 'APPROVED' ? 'AI_TOO_LENIENT' : 'AI_TOO_STRICT';
}
/** Every reason a calibration set is not acceptable. Empty = valid. */
export function calibrationSetIssues(value: unknown): string[] {
  const parsed = CalibrationSetSchema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((i) => `SCHEMA:${i.path.join('.')}: ${i.message}`);
  const set = parsed.data;
  const issues: string[] = [];
  if (set.vocabularies.defectClass.version !== DEFECT_CLASS_VOCABULARY.version || set.vocabularies.severity.version !== SEVERITY_VOCABULARY.version) issues.push('VOCABULARY_VERSION_NOT_THIS_ONE');
  if (set.notForRescoring !== CALIBRATION_NOT_FOR_RESCORING) issues.push('NOT_FOR_RESCORING_STATEMENT_MISSING');
  const seen = new Set<string>();
  for (const r of set.rows) {
    const at = (m: string) => issues.push(`${r.ITEM_ID}:${m}`);
    if (seen.has(r.ITEM_ID)) at('ITEM_ID_REPEATED');
    seen.add(r.ITEM_ID);
    const human = [r.AGREEMENT, r.HUMAN_REASON, r.DEFECT_CLASS, r.SEVERITY, r.DETERMINISTIC_RULE_CANDIDATE, r.GENERATOR_RULE_CANDIDATE, r.REVIEWER_RULE_CANDIDATE, r.REVIEWER_ID, r.REVIEWER_QUALIFICATION, r.REVIEWED_AT, r.REVIEWED_BLIND];
    if (r.HUMAN_DECISION === null) { if (human.some((v) => v !== null)) at('HUMAN_FIELDS_WITHOUT_A_HUMAN_DECISION'); continue; }
    if (r.AGREEMENT !== agreementOf(r.AI_DECISION, r.HUMAN_DECISION)) at(`AGREEMENT_IS_NOT_WHAT_THE_TWO_DECISIONS_GIVE:${agreementOf(r.AI_DECISION, r.HUMAN_DECISION)}`);
    if (r.HUMAN_REASON === null) at('HUMAN_REASON_MISSING');
    if (r.REVIEWER_ID === null || r.REVIEWER_QUALIFICATION === null || r.REVIEWED_AT === null || r.REVIEWED_BLIND === null) at('REVIEWER_IDENTITY_OR_DATE_MISSING');
    if (r.DEFECT_CLASS === null || r.SEVERITY === null) at('DEFECT_CLASS_OR_SEVERITY_MISSING');
    else {
      if ((r.DEFECT_CLASS === 'NONE') !== (r.SEVERITY === 'NONE')) at('DEFECT_CLASS_AND_SEVERITY_DISAGREE_ABOUT_NONE');
      if (r.HUMAN_DECISION === 'REJECTED' && r.DEFECT_CLASS === 'NONE') at('REJECTED_WITHOUT_A_DEFECT_CLASS');
      if (r.HUMAN_DECISION === 'APPROVED' && (r.SEVERITY === 'MAJOR' || r.SEVERITY === 'CRITICAL')) at('APPROVED_WITH_A_MAJOR_OR_CRITICAL_DEFECT');
    }
  }
  return issues;
}
/** The set with one undecided row per sampled item. `aiDecisions` is the key side: this file is not what a blind reviewer is given. */
export function emptyCalibrationSet(p: { items: ReadonlyArray<{ slotId: string; aiDecision: CalibrationRow['AI_DECISION'] }>; runId: string | null; freezeCommitSha: string | null; freezeManifestHash: string | null; sampleProcedure: { id: string; version: string }; reviewerVersion: string }): CalibrationSet {
  return {
    kind: CALIBRATION_SET.kind, version: CALIBRATION_SET.version, about: CALIBRATION_ABOUT, notForRescoring: CALIBRATION_NOT_FOR_RESCORING,
    vocabularies: { defectClass: { id: DEFECT_CLASS_VOCABULARY.id, version: DEFECT_CLASS_VOCABULARY.version }, severity: { id: SEVERITY_VOCABULARY.id, version: SEVERITY_VOCABULARY.version } },
    source: { canary: 'qb-canary-250', runId: p.runId, freezeCommitSha: p.freezeCommitSha, freezeManifestHash: p.freezeManifestHash, sampleProcedure: p.sampleProcedure, reviewerVersion: p.reviewerVersion },
    rows: p.items.map((i) => ({ ITEM_ID: i.slotId, AI_DECISION: i.aiDecision, HUMAN_DECISION: null, AGREEMENT: null, HUMAN_REASON: null, DEFECT_CLASS: null, SEVERITY: null, DETERMINISTIC_RULE_CANDIDATE: null, GENERATOR_RULE_CANDIDATE: null, REVIEWER_RULE_CANDIDATE: null, REVIEWER_ID: null, REVIEWER_QUALIFICATION: null, REVIEWED_AT: null, REVIEWED_BLIND: null })),
  };
}

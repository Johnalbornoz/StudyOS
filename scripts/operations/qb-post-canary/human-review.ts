/**
 * POST-CANARY -- HUMAN REVIEW FORM, VERSION 2 (pure: schemas, rules and renderers; no IO).
 *
 * The 37-item sample of the Canary is reviewed by PEOPLE. This file defines what a person records about one item
 * (ten independent judgements, never one generic pass / fail), when a SECOND person must review it, what a blind
 * reviewer may be shown, and how a response maps into the STUDYUS_HUMAN_CALIBRATION_SET of version 1 (untouched).
 *
 * NO AI IN EITHER SLOT. A reviewer who is, or who used, an AI system is refused for the first review and for the
 * second. The second review is by another person; it is never the AI reviewer and never this lane.
 *
 * NOTHING HERE IS A HUMAN RESPONSE. No label is invented, simulated or pre-filled: templates are empty.
 */
import { z } from 'zod';
import type { CalibrationRow } from '../qb-canary-250/calibration';

export const HUMAN_REVIEW_FORM = { kind: 'STUDYUS_HUMAN_REVIEW_FORM', version: '2' } as const;
export const HUMAN_REVIEW_VOCABULARIES = {
  academic_correctness: ['CORRECT', 'INCORRECT', 'AMBIGUOUS', 'NOT_ASSESSABLE'],
  answer_key_correctness: ['CORRECT', 'INCORRECT', 'AMBIGUOUS', 'NOT_ASSESSABLE'],
  construct_fit: ['FITS', 'PARTIALLY_FITS', 'DOES_NOT_FIT', 'NOT_ASSESSABLE'],
  assessment_system_fidelity: ['FAITHFUL', 'PARTIALLY_FAITHFUL', 'NOT_FAITHFUL', 'NOT_ASSESSABLE'],
  paper_level_fidelity: ['AT_LEVEL', 'BELOW_LEVEL', 'ABOVE_LEVEL', 'NOT_APPLICABLE', 'NOT_ASSESSABLE'],
  difficulty_achieved: ['MATCHES_STATED_BAND', 'EASIER_THAN_STATED_BAND', 'HARDER_THAN_STATED_BAND', 'NOT_ASSESSABLE'],
  originality_material_duplicate: ['NO_CONCERN', 'RESEMBLES_A_PUBLISHED_ITEM', 'DUPLICATES_ANOTHER_ITEM_OF_THE_PACKET', 'NOT_ASSESSABLE'],
  wording_clarity: ['CLEAR', 'MINOR_ISSUES', 'UNCLEAR'],
  final_human_decision: ['APPROVED', 'NEEDS_REVISION', 'REJECTED'],
} as const;
export const HUMAN_REVIEW_FIELDS = ['academic_correctness', 'answer_key_correctness', 'construct_fit', 'assessment_system_fidelity', 'paper_level_fidelity', 'difficulty_achieved', 'originality_material_duplicate', 'wording_clarity', 'final_human_decision', 'reviewer_notes'] as const;
export const FIELD_MEANINGS: Readonly<Record<(typeof HUMAN_REVIEW_FIELDS)[number], string>> = {
  academic_correctness: 'Is the mathematics of the item right (stem, stimulus, every statement in it)? Solve the item yourself first.',
  answer_key_correctness: 'Is the key right -- the keyed option, the numeric key, every final answer and every mark point? AMBIGUOUS when more than one answer is defensible.',
  construct_fit: 'Does answering it require the concept and the evidence actions stated for the item, with nothing given away and nothing else measured instead?',
  assessment_system_fidelity: 'Does it look and behave like an item of the stated assessment system and component (format, tools, language, conventions)?',
  paper_level_fidelity: 'Is its demand at the level of the stated paper? NOT_APPLICABLE when the target is not a specific paper (the school profile).',
  difficulty_achieved: 'Compare the demand you see with the STATED band (FOUNDATIONAL / STANDARD / CHALLENGE).',
  originality_material_duplicate: 'Do you recognise it as a published examination question, or as a duplicate of another item of this packet?',
  wording_clarity: 'Is it clear, natural and unambiguous in its language?',
  final_human_decision: 'APPROVED: usable as it stands. NEEDS_REVISION: sound idea, must be edited before use. REJECTED: must not be used.',
  reviewer_notes: 'What you found, in your own words. Required unless every judgement is the first value of its list.',
};
const enumOf = <K extends keyof typeof HUMAN_REVIEW_VOCABULARIES>(k: K) => z.enum(HUMAN_REVIEW_VOCABULARIES[k]);
export const ReviewerSchema = z.strictObject({
  reviewer_id: z.string().trim().min(2).max(120), reviewer_kind: z.literal('HUMAN'), qualification: z.string().trim().min(3).max(300),
  reviewed_at: z.string().datetime({ offset: true }), minutes_spent: z.number().positive().max(600), reviewed_blind: z.boolean(),
  /** Must be false. A review written with the help of an AI system is not a human review. */
  consulted_ai: z.boolean(),
});
export const HumanResponseSchema = z.strictObject({
  academic_correctness: enumOf('academic_correctness'), answer_key_correctness: enumOf('answer_key_correctness'), construct_fit: enumOf('construct_fit'), assessment_system_fidelity: enumOf('assessment_system_fidelity'),
  paper_level_fidelity: enumOf('paper_level_fidelity'), difficulty_achieved: enumOf('difficulty_achieved'), originality_material_duplicate: enumOf('originality_material_duplicate'), wording_clarity: enumOf('wording_clarity'),
  final_human_decision: enumOf('final_human_decision'), reviewer_notes: z.string().trim().max(4000),
  reviewer: ReviewerSchema,
});
export type HumanResponse = z.infer<typeof HumanResponseSchema>;
export const ItemSlotSchema = z.strictObject({ ITEM_ID: z.string().regex(/^c250-\d{3}$/), first_review: HumanResponseSchema.nullable(), second_review: HumanResponseSchema.nullable() });
export const HumanReviewFormSchema = z.strictObject({
  kind: z.literal(HUMAN_REVIEW_FORM.kind), version: z.literal(HUMAN_REVIEW_FORM.version), about: z.string(), noAi: z.string(), vocabularies: z.unknown(), fieldMeanings: z.unknown(),
  source: z.strictObject({ canary: z.literal('qb-canary-250'), runId: z.string().nullable(), freezeCommitSha: z.string().nullable(), packet: z.string(), sampleSize: z.number().int() }),
  items: z.array(ItemSlotSchema),
});
export type HumanReviewFormFile = z.infer<typeof HumanReviewFormSchema>;
export const FORM_ABOUT = 'One slot per sampled item: a first human review and, when required, a second by another person. Ten independent judgements per review. Dev-test content; a human decision here is a calibration label, not a Question Bank approval.' as const;
export const FORM_NO_AI = 'Both reviews are by people. Do not consult an AI system. A reviewer identity that is an AI or a model, or a review marked as AI-assisted, is refused. The second review is never the AI reviewer.' as const;
/** The empty form for a list of items: every review slot is null. */
export function emptyForm(p: { itemIds: readonly string[]; runId: string | null; freezeCommitSha: string | null; packet: string }): HumanReviewFormFile {
  return { kind: HUMAN_REVIEW_FORM.kind, version: HUMAN_REVIEW_FORM.version, about: FORM_ABOUT, noAi: FORM_NO_AI, vocabularies: HUMAN_REVIEW_VOCABULARIES, fieldMeanings: FIELD_MEANINGS, source: { canary: 'qb-canary-250', runId: p.runId, freezeCommitSha: p.freezeCommitSha, packet: p.packet, sampleSize: p.itemIds.length }, items: p.itemIds.map((ITEM_ID) => ({ ITEM_ID, first_review: null, second_review: null })) };
}

/** Why a reviewer is not acceptable for either slot. Empty = acceptable. */
const AI_IDENTITY = /\b(ai|a\.i\.|gpt|chatgpt|claude|gemini|llama|llm|language model|model|bot|chatbot|assistant|copilot|openai|anthropic|automated|machine)\b/i;
export function reviewerIssues(r: unknown): string[] {
  const o = (r ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  if (o.reviewer_kind !== 'HUMAN') out.push('REVIEWER_IS_NOT_DECLARED_HUMAN');
  if (typeof o.reviewer_id === 'string' && AI_IDENTITY.test(o.reviewer_id)) out.push('REVIEWER_IDENTITY_NAMES_AN_AI_SYSTEM');
  if (typeof o.qualification === 'string' && AI_IDENTITY.test(o.qualification)) out.push('REVIEWER_QUALIFICATION_NAMES_AN_AI_SYSTEM');
  if (o.consulted_ai !== false) out.push('REVIEW_WAS_AI_ASSISTED_OR_DOES_NOT_SAY');
  return out;
}
/** Every reason a filled form is not acceptable. Empty = valid. */
export function formIssues(value: unknown, expectedItemIds?: readonly string[]): string[] {
  const parsed = HumanReviewFormSchema.safeParse(value);
  if (!parsed.success) {
    // a reviewer refused for being an AI is named as such, before the schema's own message
    const items = ((value as { items?: Array<Record<string, { reviewer?: unknown } | null>> } | null)?.items ?? []);
    const ai = items.flatMap((i) => (['first_review', 'second_review'] as const).flatMap((slot) => (i?.[slot] ? reviewerIssues(i[slot]!.reviewer).map((x) => `${String((i as { ITEM_ID?: unknown }).ITEM_ID)}:${slot}:${x}`) : [])));
    return [...ai, ...parsed.error.issues.slice(0, 20).map((i) => `SCHEMA:${i.path.join('.')}: ${i.message}`)];
  }
  const form = parsed.data;
  const out: string[] = [];
  const ids = form.items.map((i) => i.ITEM_ID);
  if (new Set(ids).size !== ids.length) out.push('ITEM_ID_REPEATED');
  if (expectedItemIds && (ids.length !== expectedItemIds.length || ids.some((id) => !expectedItemIds.includes(id)))) out.push('ITEMS_ARE_NOT_THE_SAMPLE');
  if (form.noAi !== FORM_NO_AI) out.push('NO_AI_STATEMENT_MISSING');
  for (const item of form.items) for (const slot of ['first_review', 'second_review'] as const) {
    const r = item[slot];
    if (!r) continue;
    const at = (m: string) => out.push(`${item.ITEM_ID}:${slot}:${m}`);
    for (const x of reviewerIssues(r.reviewer)) at(x);
    const allFirst = (Object.keys(HUMAN_REVIEW_VOCABULARIES) as Array<keyof typeof HUMAN_REVIEW_VOCABULARIES>).every((k) => r[k] === HUMAN_REVIEW_VOCABULARIES[k][0] || (k === 'paper_level_fidelity' && r[k] === 'NOT_APPLICABLE'));
    if (!allFirst && r.reviewer_notes.length < 10) at('REVIEWER_NOTES_REQUIRED_WHEN_ANY_JUDGEMENT_IS_NOT_CLEAN');
    if (r.final_human_decision === 'APPROVED' && (r.academic_correctness === 'INCORRECT' || r.answer_key_correctness === 'INCORRECT')) at('APPROVED_WITH_AN_INCORRECT_ITEM_OR_KEY');
  }
  for (const item of form.items) {
    if (item.second_review && !item.first_review) out.push(`${item.ITEM_ID}:SECOND_REVIEW_WITHOUT_A_FIRST`);
    if (item.second_review && item.first_review && item.second_review.reviewer.reviewer_id.trim().toLowerCase() === item.first_review.reviewer.reviewer_id.trim().toLowerCase()) out.push(`${item.ITEM_ID}:SECOND_REVIEW_BY_THE_SAME_PERSON`);
  }
  return out;
}

/** What the frozen AI review said about an item, as much as the second-review rule needs. Never shown to a first reviewer. */
export interface FrozenAiDecision { classification: 'APPROVED' | 'NEEDS_HUMAN_REVIEW' | 'REJECTED' | null; academicCorrectness: 'PASS' | 'CONCERN' | 'FAIL' | 'NOT_APPLICABLE' | null; agreesWithKey: 'AGREES' | 'DISAGREES' | 'CANNOT_DETERMINE' | null }
export const SECOND_REVIEW_RULE = {
  id: 'studyus-second-human-review-rule', version: '1',
  rule: 'SECOND_HUMAN_REVIEW_REQUIRED = YES when, AFTER the first human review is recorded, any of these holds: (1) FINAL_DECISION_DISAGREES_WITH_THE_AI -- the AI classified APPROVED and the person did not approve, or the AI classified REJECTED and the person approved; (2) CORRECTNESS_OR_KEY_NOT_SETTLED -- the person recorded AMBIGUOUS or NOT_ASSESSABLE for academic correctness or for the key; (3) PERSON_FOUND_AN_ERROR_THE_AI_PASSED -- the person recorded INCORRECT for correctness or key while the AI passed academic correctness and its own solution agreed with the key; (4) AI_FOUND_AN_ERROR_THE_PERSON_PASSED -- the AI failed academic correctness or its solution disagreed with the key, while the person recorded CORRECT for both. An item the AI sent to a person (NEEDS_HUMAN_REVIEW) has no AI decision to disagree with: rule (1) does not apply to it. The determination is computed from the recorded response and the frozen AI decision; it is never shown to the first reviewer and the second reviewer is another person, never an AI.',
} as const;
export interface SecondReviewDetermination { SECOND_HUMAN_REVIEW_REQUIRED: 'YES' | 'NO'; reasons: string[]; rule: { id: string; version: string } }
export function secondHumanReviewRequired(first: HumanResponse, ai: FrozenAiDecision): SecondReviewDetermination {
  const reasons: string[] = [];
  if ((ai.classification === 'APPROVED' && first.final_human_decision !== 'APPROVED') || (ai.classification === 'REJECTED' && first.final_human_decision === 'APPROVED')) reasons.push('FINAL_DECISION_DISAGREES_WITH_THE_AI');
  const unsettled = (v: string) => v === 'AMBIGUOUS' || v === 'NOT_ASSESSABLE';
  if (unsettled(first.academic_correctness) || unsettled(first.answer_key_correctness)) reasons.push('CORRECTNESS_OR_KEY_NOT_SETTLED');
  const aiPassed = ai.academicCorrectness === 'PASS' && ai.agreesWithKey === 'AGREES', aiFailed = ai.academicCorrectness === 'FAIL' || ai.agreesWithKey === 'DISAGREES';
  if (aiPassed && (first.academic_correctness === 'INCORRECT' || first.answer_key_correctness === 'INCORRECT')) reasons.push('PERSON_FOUND_AN_ERROR_THE_AI_PASSED');
  if (aiFailed && first.academic_correctness === 'CORRECT' && first.answer_key_correctness === 'CORRECT') reasons.push('AI_FOUND_AN_ERROR_THE_PERSON_PASSED');
  return { SECOND_HUMAN_REVIEW_REQUIRED: reasons.length > 0 ? 'YES' : 'NO', reasons, rule: { id: SECOND_REVIEW_RULE.id, version: SECOND_REVIEW_RULE.version } };
}
/**
 * THE HUMAN LABEL OF AN ITEM. SETTLED: the first review when no second is required; when one is required, the
 * shared judgement of the two reviews where their FINAL decisions agree (field by field the second review is taken,
 * and a field on which they differ is reported). AWAITING_SECOND_REVIEW: required and not yet there. UNSETTLED: two
 * people decided differently -- a third PERSON adjudicates; it is never settled by an AI.
 */
export type HumanLabel = { state: 'NO_REVIEW' } | { state: 'AWAITING_SECOND_REVIEW'; reasons: string[] } | { state: 'UNSETTLED'; first: HumanResponse; second: HumanResponse } | { state: 'SETTLED'; label: HumanResponse; by: 'FIRST_REVIEW' | 'TWO_REVIEWS_AGREE'; differingFields: string[] };
export function humanLabelOf(slot: { first_review: HumanResponse | null; second_review: HumanResponse | null }, ai: FrozenAiDecision): HumanLabel {
  if (!slot.first_review) return { state: 'NO_REVIEW' };
  const need = secondHumanReviewRequired(slot.first_review, ai);
  if (need.SECOND_HUMAN_REVIEW_REQUIRED === 'NO' && !slot.second_review) return { state: 'SETTLED', label: slot.first_review, by: 'FIRST_REVIEW', differingFields: [] };
  if (!slot.second_review) return { state: 'AWAITING_SECOND_REVIEW', reasons: need.reasons };
  if (slot.first_review.final_human_decision !== slot.second_review.final_human_decision) return { state: 'UNSETTLED', first: slot.first_review, second: slot.second_review };
  const differingFields = (Object.keys(HUMAN_REVIEW_VOCABULARIES) as Array<keyof typeof HUMAN_REVIEW_VOCABULARIES>).filter((k) => slot.first_review![k] !== slot.second_review![k]);
  return { state: 'SETTLED', label: slot.second_review, by: 'TWO_REVIEWS_AGREE', differingFields };
}

/** A form-version-2 label as a row of STUDYUS_HUMAN_CALIBRATION_SET version 1 (whose schema and validator are untouched). */
export function toCalibrationRowV1(itemId: string, aiDecision: CalibrationRow['AI_DECISION'], r: HumanResponse, agreement: (ai: CalibrationRow['AI_DECISION'], human: 'APPROVED' | 'REJECTED' | 'CANNOT_JUDGE') => NonNullable<CalibrationRow['AGREEMENT']>): CalibrationRow {
  // version 1 has two human decisions; NEEDS_REVISION is "not usable as it stands", which version 1 records as REJECTED
  const human = r.final_human_decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
  const defect: NonNullable<CalibrationRow['DEFECT_CLASS']> = r.answer_key_correctness === 'INCORRECT' ? 'WRONG_KEY' : r.academic_correctness === 'INCORRECT' ? 'WRONG_MATHEMATICS' : r.academic_correctness === 'AMBIGUOUS' || r.answer_key_correctness === 'AMBIGUOUS' ? 'AMBIGUOUS_OR_MULTIPLE_ANSWERS'
    : r.construct_fit === 'DOES_NOT_FIT' ? 'CONSTRUCT_NOT_MEASURED' : r.assessment_system_fidelity === 'NOT_FAITHFUL' || r.paper_level_fidelity === 'BELOW_LEVEL' || r.paper_level_fidelity === 'ABOVE_LEVEL' ? 'PROFILE_MISMATCH' : r.difficulty_achieved === 'EASIER_THAN_STATED_BAND' || r.difficulty_achieved === 'HARDER_THAN_STATED_BAND' ? 'DIFFICULTY_MISMATCH'
      : r.wording_clarity !== 'CLEAR' ? 'LANGUAGE_OR_CLARITY' : r.originality_material_duplicate !== 'NO_CONCERN' && r.originality_material_duplicate !== 'NOT_ASSESSABLE' ? 'ORIGINALITY_CONCERN' : human === 'REJECTED' ? 'OTHER' : 'NONE';
  const severity: NonNullable<CalibrationRow['SEVERITY']> = defect === 'NONE' ? 'NONE' : human === 'APPROVED' ? 'MINOR' : defect === 'WRONG_KEY' || defect === 'WRONG_MATHEMATICS' ? 'CRITICAL' : 'MAJOR';
  return { ITEM_ID: itemId, AI_DECISION: aiDecision, HUMAN_DECISION: human, AGREEMENT: agreement(aiDecision, human), HUMAN_REASON: r.reviewer_notes.length > 0 ? r.reviewer_notes : `${r.final_human_decision} (form version 2; no note)`, DEFECT_CLASS: defect, SEVERITY: severity, DETERMINISTIC_RULE_CANDIDATE: null, GENERATOR_RULE_CANDIDATE: null, REVIEWER_RULE_CANDIDATE: null, REVIEWER_ID: r.reviewer.reviewer_id, REVIEWER_QUALIFICATION: r.reviewer.qualification, REVIEWED_AT: r.reviewer.reviewed_at, REVIEWED_BLIND: r.reviewer.reviewed_blind };
}

// ---------------------------------------------------------------------------------------------------------------
// the packet: what a reviewer is shown
// ---------------------------------------------------------------------------------------------------------------
export interface PacketItem { position: number; ITEM_ID: string; presentation: string; target: string; taskFamily: string; learningApproach: string; request: { difficultyBand: string; context: string; responseFormat: string; language: string }; canonicalConcept: { canonicalName?: string; stableId?: string }; evidenceTarget: { actions?: string[]; observablePerformance?: string }; item: Record<string, unknown>; stimulus: { kind: string; text: string[]; structured: { tables?: Array<{ title?: string; columns: Array<{ label?: string; key?: string; unit?: string }>; rows: unknown[][] }>; charts?: Array<{ chartKey?: string; title?: string }> } } | null; [k: string]: unknown }
/** Words that must not appear in what a BLIND reviewer is shown about an item. */
export const AUTOMATED_RESULT_KEYS = ['aiReview', 'validatorGates', 'classification', 'reviewerQuestion', 'independentSolution', 'dimensions', 'decision', 'validatorOutcome', 'aiOutcome', 'reasons', 'uncertaintyScore', 'blind'] as const;
/** Every key of the automated results found anywhere in an item of the packet. Empty for a blind item. */
export function automatedContentIn(item: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if ((AUTOMATED_RESULT_KEYS as readonly string[]).includes(k)) found.add(k); walk(x); } };
  walk(item);
  return [...found].sort();
}
/** The same item with nothing of the automated results: what a fully blind reviewer is shown. */
export function fullyBlind(item: PacketItem): PacketItem {
  const { aiReview: _a, validatorGates: _v, ...rest } = item as PacketItem & { aiReview?: unknown; validatorGates?: unknown };
  return { ...rest, presentation: 'BLIND' } as PacketItem;
}
const esc = (t: unknown): string => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A print-friendly, self-contained HTML packet. Deterministic: the same items give the same bytes. `svgOf` gives the rendered charts of an item, when it has any. */
export function renderPacketHtml(p: { title: string; items: readonly PacketItem[]; showAutomatedResultsForNonBlind: boolean; svgOf: (itemId: string) => string[] }): string {
  const q = (HUMAN_REVIEW_FIELDS.filter((f) => f !== 'reviewer_notes') as Array<keyof typeof HUMAN_REVIEW_VOCABULARIES>).map((f) => `<tr><th>${f}</th><td>${HUMAN_REVIEW_VOCABULARIES[f].map((v) => `&#9744; ${v}`).join(' &nbsp; ')}</td></tr>`).join('');
  const body = p.items.map((it) => {
    const item = it.item as { stem?: string; marks?: number; selected?: { options: Array<{ id: string; text: string }>; answerKey: string } | null; numeric?: { numericKey: unknown } | null; constructed?: { totalMarks: number; parts: Array<{ label: string; prompt: string; commandTerm: string | null; marks: number; markScheme: Array<{ kind: string; marks: number; criterion: string }>; finalAnswer: string }> } | null; credit?: Array<{ code: string; description: string }> | null };
    const stim = it.stimulus ? `<div class="stimulus"><h4>Stimulus</h4>${it.stimulus.text.map((t) => `<p>${esc(t)}</p>`).join('')}${(it.stimulus.structured.tables ?? []).map((t) => `<table><caption>${esc(t.title)}</caption><tr>${t.columns.map((c) => `<th>${esc(c.label ?? c.key)}${c.unit ? ` (${esc(c.unit)})` : ''}</th>`).join('')}</tr>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`).join('')}${p.svgOf(it.ITEM_ID).join('')}</div>` : '';
    const key = item.selected ? `<ol type="A">${item.selected.options.map((o) => `<li>${esc(o.text)}</li>`).join('')}</ol><p class="key"><b>Key:</b> ${esc(item.selected.answerKey)}</p>` : item.numeric ? `<p class="key"><b>Numeric key:</b> ${esc(JSON.stringify(item.numeric.numericKey))}</p>` : item.constructed ? `<p><b>Total marks:</b> ${item.constructed.totalMarks}</p>${item.constructed.parts.map((part) => `<div class="part"><p><b>(${esc(part.label)})</b> [${part.marks}] ${part.commandTerm ? `<i>${esc(part.commandTerm)}</i>: ` : ''}${esc(part.prompt)}</p><p class="key"><b>Answer:</b> ${esc(part.finalAnswer)}</p><ul>${part.markScheme.map((m) => `<li>${esc(m.kind)} ${m.marks}: ${esc(m.criterion)}</li>`).join('')}</ul></div>`).join('')}` : '';
    const credit = item.credit ? `<p><b>Credit levels:</b> ${item.credit.map((c) => `${esc(c.code)}: ${esc(c.description)}`).join(' | ')}</p>` : '';
    const blind = it.presentation === 'BLIND' || !p.showAutomatedResultsForNonBlind;
    const auto = blind ? '' : `<div class="auto"><h4>Automated results (AI review -- not a human review -- and validator gates)</h4><pre>${esc(JSON.stringify({ aiReview: (it as { aiReview?: unknown }).aiReview, validatorGates: (it as { validatorGates?: unknown }).validatorGates }, null, 1))}</pre></div>`;
    return `<section><h2>${it.position}. ${esc(it.ITEM_ID)}</h2><p class="meta"><b>Assessment system / component:</b> ${esc(it.target)} &nbsp; <b>Stated band:</b> ${esc(it.request.difficultyBand)} &nbsp; <b>Format:</b> ${esc(it.request.responseFormat)} &nbsp; <b>Language:</b> ${esc(it.request.language)} &nbsp; <b>Approach:</b> ${esc(it.learningApproach)}</p><p class="meta"><b>Concept:</b> ${esc(it.canonicalConcept.canonicalName ?? it.canonicalConcept.stableId)} &nbsp; <b>Task family:</b> ${esc(it.taskFamily)} &nbsp; <b>Evidence actions:</b> ${esc((it.evidenceTarget.actions ?? []).join(' + '))}</p><p class="meta"><b>Expected performance:</b> ${esc(it.evidenceTarget.observablePerformance)}</p>${stim}<div class="item"><h4>Item</h4><p>${esc(item.stem)}</p>${key}${credit}</div>${auto}<table class="form">${q}<tr><th>reviewer_notes</th><td class="notes"></td></tr></table></section>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(p.title)}</title><style>body{font-family:Georgia,serif;max-width:820px;margin:24px auto;padding:0 16px;color:#111}section{page-break-after:always;border-top:2px solid #111;padding-top:8px;margin-top:24px}h2{font-size:18px}h4{margin:10px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.04em}.meta{font-size:12px;margin:2px 0}table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #777;padding:3px 8px;font-size:13px;text-align:left}.form th{width:230px;font-family:monospace;font-size:11px}.form td{font-size:11px}.notes{height:90px}.key{background:#f1f1f1;padding:2px 6px}.auto pre{font-size:10px;white-space:pre-wrap;border:1px dashed #777;padding:6px}.part{margin-left:12px}svg{max-width:100%;height:auto}@media print{body{margin:0}}</style></head><body><h1>${esc(p.title)}</h1><p>DEV_TEST_CONTENT -- RIGHTS_NOT_ESTABLISHED -- not release content. ${esc(FORM_NO_AI)}</p>\n${body}\n</body></html>\n`;
}
export const REVIEWER_INSTRUCTIONS = `# Reviewer instructions -- Canary 250 human calibration (form version 2)

You are reviewing 37 mathematics items written by a model. They are development-test content: none of them is
released, none is approved, and your decision is a calibration label, not an approval for use.

## Before you start
- **Do not consult any AI system** (chat assistants, solvers that explain, translation by a model). A calculator or
  a computer algebra system to check your own arithmetic is fine. A review made with AI help is not accepted.
- Work from the packet. Some items are shown WITHOUT any automated result (blind items). Do not look for the
  automated results of any item elsewhere, and do not open the key file: it is not for reviewers.
- Solve each item yourself BEFORE you read its key.

## What to record for each item (ten independent judgements)
${HUMAN_REVIEW_FIELDS.map((f) => `- **${f}** -- ${FIELD_MEANINGS[f]}${f in HUMAN_REVIEW_VOCABULARIES ? ` Values: ${HUMAN_REVIEW_VOCABULARIES[f as keyof typeof HUMAN_REVIEW_VOCABULARIES].join(', ')}.` : ''}`).join('\n')}

Judge each one on its own. An item can have a correct key and be far below the level of its paper; say both.
For IB and Cambridge items, **paper_level_fidelity** is your judgement as someone who knows that paper: the
packet states no official level, and no profile in this project is the board's standard.

## Also record
reviewer_id, your qualification, the date and time, the minutes you spent on the item, whether you saw it blind,
and \`consulted_ai: false\`.

## Time
About 5 to 8 minutes for a closed item, 8 to 15 for a constructed one: roughly five to six hours for the packet.
Stop and say so in the notes if an item cannot be judged in that time.

## What happens next
After your review is recorded, some items go to a second reviewer -- another person. You are not told which, and
you are not shown what any automated system decided about a blind item.
`;

/**
 * QB-R2F -- the ITEM DEMAND POLICY: what a marked part must amount to (pure data and one pure function; no IO).
 *
 * WHY IT EXISTS. The items QB-R2D and QB-R2E produced for constructed-response papers were elementary for those
 * papers: a "2-mark" part that was one division, a single mark point carrying two or three marks. Nothing in a
 * specification said how much a mark is.
 *
 * WHAT IT IS, AND IS NOT. StudyUs policy, PROVISIONAL, read by no subject specialist. It states working rules about
 * the RELATION between marks, mark points and steps of working. It states NOTHING about any examination: no figure
 * here is taken from, or claims to describe, a published mark scheme. What the repository records for a component
 * (its marks, its minutes, its command terms) stays where it is, in the profile, and is not restated here.
 *
 * WHERE IT SITS. It is a companion of the discipline policy, applied at generation (the provider reads it) and at
 * validation (revision 4 checks what a rule can check). It is deliberately NOT a member of the adaptation
 * specification: adding one would change every specification id and break the replay of QB-R2D and QB-R2E, whose
 * specifications are historical evidence. Its id and version are part of every prompt (hence of the prompt hash) and
 * of the freeze, so a run records which demand policy it was made under.
 *
 * WHAT A RULE CANNOT CHECK: whether a step is a real step, whether a part is at the level of the paper it is for,
 * whether the reasoning asked for is the reasoning that paper rewards. Those need a subject-matter reviewer.
 */
export const ITEM_DEMAND_POLICY = {
  policyId: 'studyus.item-demand.mathematics', version: '0.1.0-provisional', authority: 'STUDYUS_POLICY', status: 'PROVISIONAL',
  /** A mark point is ONE creditable thing. A part of k marks therefore has at least k mark points. */
  maximumMarksPerMarkPoint: 1,
  /** A part worth two marks or more rewards working, not only a result: at least one of its points is a METHOD or a REASONING point. */
  multiMarkPartNeedsAMethodOrReasoningPoint: true,
  /** The working outline of a full-credit response has at least one line per METHOD or REASONING point of the item. */
  workingOutlineHasALinePerMethodPoint: true,
  /** An item of marked parts gives each action of the evidence target at least one mark, and one more: an item that only touches each action once is not a multi-mark task. */
  minimumTotalMarksOverEvidenceActions: 1,
  /** What each reasoning depth asks of a response, said to the provider. Descriptions of demand, not of any board's practice. */
  demandByReasoningDepth: {
    ANSWER_ONLY: 'One result. The question is built so that the result cannot be reached without the relationships of the construct; nothing is collected but the result.',
    METHOD_SHOWN: 'Each part of two marks or more needs at least two distinct steps of working that a marker can see: the relationship set up, then worked. A part that is a single arithmetic operation is worth one mark, not two.',
    JUSTIFIED_ARGUMENT: 'As METHOD_SHOWN, and the conclusion is argued from the mathematics: which quantities were compared and why that comparison decides the question. The justification is a part of its own with REASONING points.',
  },
  notCheckable: ['whether a step of working is a genuine step', 'whether a part is at the level of the paper it is written for', 'whether the reasoning rewarded is what that paper rewards'],
} as const;

export interface DemandPart { label: string; marks: number; markPoints: ReadonlyArray<{ kind: string; marks: number }> }
/** Which of the policy's checkable rules a constructed item breaks. Empty for a closed item: the policy is about marked parts. */
export function itemDemandIssues(p: { parts: readonly DemandPart[]; workingOutlineLines: number; evidenceActions: number }): string[] {
  const out: string[] = [];
  if (p.parts.length === 0) return out;
  for (const part of p.parts) {
    if (part.markPoints.some((m) => m.marks > ITEM_DEMAND_POLICY.maximumMarksPerMarkPoint)) out.push(`MARK_POINT_CARRIES_MORE_THAN_ONE_MARK:${part.label}`);
    if (part.marks >= 2 && !part.markPoints.some((m) => m.kind === 'METHOD' || m.kind === 'REASONING')) out.push(`MULTI_MARK_PART_WITHOUT_A_METHOD_OR_REASONING_POINT:${part.label}`);
  }
  const methodPoints = p.parts.flatMap((x) => x.markPoints).filter((m) => m.kind === 'METHOD' || m.kind === 'REASONING').length;
  if (p.workingOutlineLines < methodPoints) out.push(`WORKING_OUTLINE_SHORTER_THAN_THE_METHOD_POINTS:${p.workingOutlineLines}/${methodPoints}`);
  const total = p.parts.reduce((n, x) => n + x.marks, 0);
  if (total < p.evidenceActions + ITEM_DEMAND_POLICY.minimumTotalMarksOverEvidenceActions) out.push(`TOTAL_MARKS_BELOW_ONE_PER_EVIDENCE_ACTION_PLUS_ONE:${total}/${p.evidenceActions + ITEM_DEMAND_POLICY.minimumTotalMarksOverEvidenceActions}`);
  return out;
}

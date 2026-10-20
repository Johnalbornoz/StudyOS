/**
 * Who owns the official exam of a family, where StudyUs names it in a disclaimer ("not official content of ...").
 * Absent = the family's own name is used. Presentation only: it states that StudyUs content is NOT theirs.
 */
export const EXAM_FAMILY_OWNER: Readonly<Record<string, string>> = { PAA: 'College Board' };

/**
 * What a Student or Parent reads where an exam's reference is shown. A stored version label is a StudyUs record name
 * and may carry the year of a SOURCE DOCUMENT (the PAA label names the study guide © 2021); shown as "Version: ..."
 * it reads as if the owner called the exam by that year, which it does not. For such a family a governed reference
 * replaces the label ON SCREEN ONLY: the stored label, the bindings and every lineage that names it are untouched.
 */
export const EXAM_FAMILY_REFERENCE: Readonly<Record<string, { messageKey: string; fallback: string }>> = {
  PAA: { messageKey: 'exv2.reference.PAA', fallback: 'PAA revisada · Guía de estudio ©2021' },
};
export function studentFacingExamReference(family: string | null | undefined, versionLabel: string, messages?: Record<string, string>): { governed: boolean; text: string } {
  const ref = family ? EXAM_FAMILY_REFERENCE[family] : undefined;
  return ref ? { governed: true, text: messages?.[ref.messageKey] ?? ref.fallback } : { governed: false, text: versionLabel };
}

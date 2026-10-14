/**
 * Isolated COMPATIBILITY ASSESSMENT of a proposed re-projection of a certified IB instance (pure, no IO).
 *
 * A re-projection may become a NEW governed deliverable version only if EVERY scoring semantic of the certified source
 * is preserved. The certified source is immutable; this module reads it and the proposal and says, semantic by
 * semantic, whether the proposal keeps it. It creates nothing.
 *
 * Semantics checked:
 *   RUBRIC_IDENTICAL            the proposal cites the certified rubric verbatim (codes, kinds, marks, criteria)
 *   MARKS_PRESERVED             total, method and accuracy marks are the certified ones
 *   ANSWER_VALUES_PRESERVED     the proposal's answer values are exactly the certified key values
 *   METHOD_POINTS_EXPRESSIBLE   every certified METHOD point maps to a governed form-aware rule, and the rule awards the
 *                               proposal's own evidence line and refuses a restatement of the given equation
 *   RESPONSE_STRUCTURE_PRESERVED the certified response is ONE answer whose accuracy points match the solutions in ANY
 *                               order (`evaluateResponse` RUBRIC); the proposal must not require an order the source
 *                               does not
 *   LEARNER_CONTENT_PRESERVED   what the Student is asked is the certified learner content (prompt and parts)
 */
import type { CertifiedInstance } from '@/lib/assessment-instance/v52';
import { criterionDigestOf, evaluateMethodRule, toAscii, type MethodRule, type MethodRuleType } from '@/lib/assessment-scoring/method-rules';

export type CompatibilitySemantic = 'RUBRIC_IDENTICAL' | 'MARKS_PRESERVED' | 'ANSWER_VALUES_PRESERVED' | 'METHOD_POINTS_EXPRESSIBLE' | 'RESPONSE_STRUCTURE_PRESERVED' | 'LEARNER_CONTENT_PRESERVED';
export interface CompatibilityCheck { semantic: CompatibilitySemantic; preserved: boolean; detail: string }
export interface CompatibilityResult { instanceId: string; compatible: boolean; checks: CompatibilityCheck[]; rules: MethodRule[] }

/** The governed mapping from a certified METHOD criterion to a form-aware rule. Unknown text maps to nothing. */
export function ruleTypeOfCriterion(criterion: string): MethodRuleType | null {
  if (/^Rearranges to .+= 0\.?$/.test(criterion.trim())) return 'REARRANGE_TO_STANDARD_FORM';
  if (/^Applies a valid method to the equation in standard form/.test(criterion.trim())) return 'QUADRATIC_SOLUTION_METHOD';
  return null;
}
const num = (s: string): number => { const m = /^(-?\d+)(?:\/(\d+))?$/.exec(s.trim()); if (!m) return NaN; return Number(m[1]) / (m[2] ? Number(m[2]) : 1); };

export function assessReprojection(source: CertifiedInstance, spec: any): CompatibilityResult {
  const checks: CompatibilityCheck[] = [];
  const add = (semantic: CompatibilitySemantic, preserved: boolean, detail: string) => checks.push({ semantic, preserved, detail });
  const t = spec.target;
  const verbatim = (t.scoringProvenance ?? spec.scoringProvenance)?.sourceRubricVerbatim ?? [];
  add('RUBRIC_IDENTICAL', JSON.stringify(verbatim) === JSON.stringify(source.rubric.map((r) => ({ code: r.code, kind: r.kind, marks: r.marks, criterion: r.criterion }))), `${verbatim.length} points cited / ${source.rubric.length} certified`);
  const method = source.rubric.filter((r) => r.kind === 'METHOD').reduce((s, r) => s + r.marks, 0);
  add('MARKS_PRESERVED', t.marks?.total === source.marks && t.marks?.method === method && t.marks?.accuracy === source.marks - method, `total ${t.marks?.total}/${source.marks}, method ${t.marks?.method}/${method}`);
  const proposed = (t.learner?.parts ?? []).flatMap((p: any) => p.math?.answers ?? []).map(num).sort((a: number, b: number) => a - b);
  const keyed = source.key.answers.map(num).sort((a, b) => a - b);
  add('ANSWER_VALUES_PRESERVED', proposed.length === keyed.length && proposed.every((v: number, k: number) => Math.abs(v - keyed[k]) < 1e-12), `${proposed.join(',')} vs ${keyed.join(',')}`);

  // method points -> rules, each proven on the proposal's own evidence and on a restatement of the question
  const given = /Solve the equation (.+?)\. Show/.exec(source.learner.prompt)?.[1] ?? '';
  const a = spec.coefficients?.a, b = spec.coefficients?.b, c = spec.coefficients?.c;
  const rules: MethodRule[] = [];
  const failures: string[] = [];
  source.rubric.forEach((r, k) => {
    if (r.kind !== 'METHOD') return;
    const type = ruleTypeOfCriterion(r.criterion);
    if (!type) { failures.push(`point ${k}: no governed rule for "${r.criterion}"`); return; }
    const rule: MethodRule = { ruleType: type, version: 1, givenEquation: toAscii(given), standardForm: { a, b, c }, roots: keyed, marks: r.marks, provenance: { rubricIndex: k, rubricCode: r.code, criterionDigest: criterionDigestOf(r.criterion) } };
    const evidence = (t.method ?? []).find((m: any) => m.criterionVerbatim === r.criterion)?.intermediates?.[0];
    if (!evidence || evaluateMethodRule(rule, evidence).awarded !== r.marks) failures.push(`point ${k}: the proposal's evidence "${evidence}" does not earn the rule`);
    if (evaluateMethodRule(rule, given).awarded !== 0) failures.push(`point ${k}: restating the question would earn it`);
    rules.push(rule);
  });
  add('METHOD_POINTS_EXPRESSIBLE', failures.length === 0, failures.length ? failures.join('; ') : `${rules.length} method point(s) -> ${rules.map((r) => r.ruleType).join(', ')}`);

  // the certified response: one answer, solutions matched in any order (RUBRIC policy) -- the proposal orders them
  const ordered = t.orderedRoots?.order && t.orderedRoots.order !== 'ANY';
  add('RESPONSE_STRUCTURE_PRESERVED', source.responsePolicy.kind !== 'RUBRIC' || !ordered, ordered ? `certified: the solutions in any order (RUBRIC, ${keyed.length} accuracy points); proposed: ${t.orderedRoots.order} ordered parts -- a correct answer in the other order scores 0 instead of full marks` : 'unchanged');
  const sameLearner = (t.learner?.parts ?? []).length === source.learner.parts.length && (t.learner?.stem ?? '') === source.learner.prompt.replace(/\s*\[\d+\]\s*$/, '');
  add('LEARNER_CONTENT_PRESERVED', sameLearner, sameLearner ? 'unchanged' : `certified: one prompt, ${source.learner.parts.length} parts; proposed: ${(t.learner?.parts ?? []).length} new parts (${(t.learner?.parts ?? []).map((p: any) => `"${p.prompt}"`).join(', ')}) that no certification covers`);
  return { instanceId: source.instanceId, compatible: checks.every((x) => x.preserved), checks, rules };
}

/**
 * PAA Mathematics speed strategies: certified families, inherited deterministically, proven per item.
 * The certified supply is rebuilt here from the artefacts (pure): no database, no provider.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildPublicationPlan } from '@/lib/exam-bank/publication-plan';
import { bankContentOf, projectionRefusal } from '@/lib/exam-bank/bank-projection';
import { examItemFromApproved, findAnswerKeyLeak, toExamClientItem, type ExamItem } from '@/lib/exam-core/items';
import { speedStrategyIssues, STRATEGY_TYPES } from '@/lib/exam-bank/engines/speed-strategy';
import { keyValue, PAA_MATH_OFFICIAL, PAA_MATH_STRATEGY_CANDIDATES, provePaaMathStrategy } from '@/lib/exam-bank/strategies/paa-math-strategies';
import { PAA_MATH_STRATEGY_CERTIFICATION, PAA_SPEED_STRATEGY_POLICY } from '@/lib/exam-bank/strategies/paa-math-strategy-certification';
import { certifiedPaaMathStrategies, strategyForBankItem } from '@/lib/exam-bank/strategies/strategy-resolution';
import { coachOfItem, coachRecordOf, speedReviewOf, strategyClientView } from '@/lib/exam-bank/strategies/coach';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const plan = buildPublicationPlan(JSON.parse(read('docs/exams/question-factory/step4b/STEP4B_CERTIFICATION_RECORDS.json')), 'PILOT_PREVIEW');
const items: ExamItem[] = plan.instances.filter((p) => p.instance.systemId === 'PAA' && !projectionRefusal(p.instance)).map((p) => examItemFromApproved({ id: p.instance.instanceId, learning_objective_id: 'lo', content: bankContentOf(p.instance) })!);
const certified = certifiedPaaMathStrategies();

describe('PAA Mathematics speed strategies', () => {
  it('every certified Exam Bank item inherits exactly one certified family, proven for that item', () => {
    expect(items).toHaveLength(296);
    const byType: Record<string, number> = {};
    for (const item of items) {
      const coach = coachOfItem(item);
      expect(coach, item.question).not.toBeNull();
      // the family's own method gives the item's certified key
      expect(Math.abs(provePaaMathStrategy(coach!.strategy.strategyId, item.question)! - keyValue(item.correctAnswer)!)).toBeLessThan(1e-9);
      expect(coach!.inherited).toMatchObject({ itemCertificationState: 'INHERITED_DETERMINISTIC', familyCertificationState: 'AUTOMATED_CERTIFIED_PILOT' });
      byType[coach!.strategy.strategyType] = (byType[coach!.strategy.strategyType] ?? 0) + 1;
    }
    // NO_RELIABLE_SHORTCUT is a governed result, not a gap
    expect(byType.NO_RELIABLE_SHORTCUT).toBe(20);
    expect(Object.values(byType).reduce((n, x) => n + x, 0)).toBe(296);
  });
  it('the certification record names every family at its exact digest, and no person', () => {
    expect(certified).toHaveLength(PAA_MATH_STRATEGY_CANDIDATES.length);
    expect(Object.keys(PAA_MATH_STRATEGY_CERTIFICATION).sort()).toEqual(PAA_MATH_STRATEGY_CANDIDATES.map((s) => s.strategyId).sort());
    expect(Object.values(PAA_MATH_STRATEGY_CERTIFICATION).reduce((n, r) => n + r.itemsProven, 0)).toBe(296);
    for (const s of certified) {
      expect(s.strategyCertificationState).toBe('AUTOMATED_CERTIFIED_PILOT');
      expect(s.certification).toEqual({ decidedBy: PAA_SPEED_STRATEGY_POLICY.decidedBy, policyId: 'PAA_SPEED_STRATEGY_PILOT_POLICY_V1', humanDecisionId: null });
      expect(speedStrategyIssues(s, { official: PAA_MATH_OFFICIAL, items: [{ itemId: 'x', hasOptions: false, keyTexts: [] }] }), s.strategyId).toEqual([]);
      // numeric entry: no family reads answer choices
      expect(STRATEGY_TYPES[s.strategyType].needsOptions).toBe(false);
      expect(s.answerChoiceDependency).toBe('NONE');
      expect(s.targetTimeSeconds).toBe(65);
      expect(s.timingProvenance).toMatchObject({ target: 'OFFICIAL_DERIVED', skipThreshold: 'STUDYUS_HEURISTIC' });
    }
    const report = JSON.parse(read('docs/audits/curriculum-first/exam-bank/PAA_MATH_SPEED_STRATEGY_CERTIFICATION.json'));
    expect(report).toMatchObject({ certifiedInstances: 296, itemsWithAProvenStrategy: 296, humanReviewers: 0, providerCalls: 0, planHash: plan.planHash });
  });
  it('a family that is not the certified digest is a candidate again and reaches no item', () => {
    const edited = { ...PAA_MATH_STRATEGY_CERTIFICATION, 'strat.paa.mat.slope.two-points': { strategyVersion: 1, strategyDigest: 'f'.repeat(64) } };
    const without = certifiedPaaMathStrategies(edited);
    expect(without.some((s) => s.strategyId === 'strat.paa.mat.slope.two-points')).toBe(false);
    const slope = items.find((i) => /pendiente/.test(i.question))!;
    const l = slope.exam.certifiedLineage!;
    expect(strategyForBankItem({ systemId: l.systemId, componentId: l.adapterId, constructFamilyId: l.constructFamilyId, constructFamilyVersion: l.constructFamilyVersion, language: 'es', stem: slope.question, keyText: slope.correctAnswer, hasOptions: false }, without)).toEqual({ ok: false, refusal: 'NO_FAMILY_APPLIES_OR_AMBIGUOUS' });
  });
  it('an item whose key the fast path does not give has no strategy; neither has an item that is not certified', () => {
    const item = items[0];
    expect(coachOfItem({ ...item, correctAnswer: '999999' })).toBeNull();
    expect(coachOfItem({ ...item, exam: { ...item.exam, certifiedLineage: null } })).toBeNull();
    expect(coachOfItem({ ...item, exam: { ...item.exam, studyusCertified: false } })).toBeNull();
    expect(coachOfItem({ ...item, exam: { ...item.exam, source: 'AI_GENERATED' } })).toBeNull();
  });
  it('what the browser gets is the method, never the key or the lineage', () => {
    for (const item of [items[0], items[100], items[295]]) {
      const coach = coachOfItem(item)!;
      const view = strategyClientView(coach.strategy);
      expect(JSON.stringify(view)).not.toContain(`"${item.correctAnswer}"`);
      expect(Object.keys(view)).not.toContain('strategyDigest');
      const client = toExamClientItem(item, 0);
      expect(findAnswerKeyLeak(client)).toBeNull();
      expect(JSON.stringify(client)).not.toMatch(/certifiedLineage|constructFamilyId/);
    }
  });
  it('a strategy opened before answering makes the response ASSISTED; the review compares the time with the target', () => {
    const coach = coachOfItem(items[0])!;
    const t0 = Date.parse('2026-10-14T10:00:00Z');
    const assisted = coachRecordOf(coach, { deliveredAt: new Date(t0).toISOString(), strategyRevealedAt: new Date(t0 + 20_000).toISOString() }, t0 + 50_000);
    expect(assisted).toMatchObject({ assisted: true, elapsedSeconds: 50, targetSeconds: 65, skipThresholdSeconds: 130, targetProvenance: 'OFFICIAL_DERIVED' });
    expect(assisted.strategy).toMatchObject({ strategyId: coach.strategy.strategyId, strategyDigest: coach.strategy.strategyDigest, itemCertificationState: 'INHERITED_DETERMINISTIC' });
    const alone = coachRecordOf(coach, { deliveredAt: new Date(t0).toISOString() }, t0 + 90_000);
    expect(alone.assisted).toBe(false);
    expect(speedReviewOf(alone, coach.strategy, true)).toMatchObject({ correct: true, assisted: false, actualSeconds: 90, deltaSeconds: 25, verdict: 'RIGHT_BUT_SLOW' });
    expect(speedReviewOf(assisted, coach.strategy, true)).toMatchObject({ assisted: true, deltaSeconds: -15, verdict: 'ON_PACE_AND_RIGHT' });
  });
  it('the runtime shows the coach only in coached practice, records the reveal, and keeps assisted answers out of the evidence', () => {
    const resolution = read('src/lib/simulation/item-resolution.service.ts');
    expect(resolution).toMatch(/isCoachedPractice = \(nav: ExamNavState\): boolean => nav\.policy\?\.itemFeedback === 'AFTER_EACH_ITEM'/);
    expect(resolution).toMatch(/if \(!isCoachedPractice\(nav\)\) throw new SimulationNavigationError\('STRATEGY_NOT_AVAILABLE_IN_SIMULATION'\)/);
    expect(resolution).toMatch(/if \(!isCoachedPractice\(nav\) \|\| state\.status !== 'DELIVERED' \|\| !state\.item\) return null/);
    expect(resolution).toMatch(/speedReview: feedbackAllowed && /);
    expect(read('src/lib/assessment-execution/assessment-exam.service.ts')).toMatch(/row\.assisted === true\) return \{ itemKey, responseRef: row\.id, status: 'ASSISTED', fraction: null \}/);
    expect(read('src/lib/assessment-execution/evidence-plan.ts')).toMatch(/r\.status === 'ASSISTED' \? 'ASSISTED_BY_STRATEGY'/);
    expect(read('src/lib/simulation/scoring.service.ts')).toMatch(/const bridge = params\.coach\?\.assisted === true \? null : await resolveActivityMetadataForObjective/);
    // no provider is reachable from the strategy path
    for (const f of ['engines/speed-strategy.ts', 'strategies/paa-math-strategies.ts', 'strategies/strategy-resolution.ts', 'strategies/coach.ts']) expect(read(`src/lib/exam-bank/${f}`).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).not.toMatch(/executeAI|callModel|openai|anthropic|fetch\(|@\/lib\/(db|ai)/i);
  });
});

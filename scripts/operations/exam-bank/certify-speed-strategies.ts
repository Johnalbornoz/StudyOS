/**
 * TRACK B -- certify the PAA Mathematics speed-strategy families (offline, pure, no provider, no database).
 *
 * For every family: the engine's certification gates, then the applicability PROOF against the certified supply --
 * every certified PAA Mathematics instance must inherit exactly one family, and that family's own method must give
 * the instance's certified key. Only when everything passes is the record rewritten
 * (src/lib/exam-bank/strategies/paa-math-strategy-certification.ts + a JSON report). No person is named: the
 * decision is the policy's.
 *
 *   npx tsx scripts/operations/exam-bank/certify-speed-strategies.ts [--write]
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildPublicationPlan } from '@/lib/exam-bank/publication-plan';
import { bankContentOf, projectionRefusal } from '@/lib/exam-bank/bank-projection';
import { speedStrategyIssues, strategyCoverage } from '@/lib/exam-bank/engines/speed-strategy';
import { PAA_MATH_OFFICIAL, PAA_MATH_STRATEGY_CANDIDATES } from '@/lib/exam-bank/strategies/paa-math-strategies';
import { PAA_SPEED_STRATEGY_POLICY } from '@/lib/exam-bank/strategies/paa-math-strategy-certification';
import { strategyForBankItem, type BankItemStrategyFacts } from '@/lib/exam-bank/strategies/strategy-resolution';

const ROOT = process.cwd();
const human = JSON.parse(readFileSync(join(ROOT, 'docs/exams/question-factory/step4b/STEP4B_CERTIFICATION_RECORDS.json'), 'utf8'));
const plan = buildPublicationPlan(human, 'PILOT_PREVIEW');
const items: (BankItemStrategyFacts & { instanceId: string })[] = plan.instances.filter((p) => p.instance.systemId === 'PAA' && !projectionRefusal(p.instance)).map((p) => {
  const c = bankContentOf(p.instance); const g = p.instance.lineage;
  return { instanceId: p.instance.instanceId, systemId: p.instance.systemId, componentId: p.instance.adapterId, constructFamilyId: g.constructFamilyId, constructFamilyVersion: g.constructFamilyVersion, language: c.language, stem: c.question, keyText: c.correctAnswer, hasOptions: (c.options ?? []).length > 0 };
});
// during certification every candidate is treated as if certified: the question is whether it MAY be
const asIf = PAA_MATH_STRATEGY_CANDIDATES.map((s) => ({ ...s, strategyCertificationState: PAA_SPEED_STRATEGY_POLICY.state, certification: { decidedBy: PAA_SPEED_STRATEGY_POLICY.decidedBy, policyId: 'PAA_SPEED_STRATEGY_PILOT_POLICY_V1', humanDecisionId: null } }));
const failures: string[] = [];
const proven = new Map<string, number>();
for (const i of items) {
  const r = strategyForBankItem(i, asIf);
  if (!r.ok) failures.push(`ITEM ${i.instanceId.slice(0, 12)} ${r.refusal}: ${i.stem.slice(0, 90)} => ${i.keyText}`);
  else proven.set(r.strategy.strategyId, (proven.get(r.strategy.strategyId) ?? 0) + 1);
}
for (const s of asIf) {
  const mine = items.filter((i) => { const r = strategyForBankItem(i, asIf); return r.ok && r.strategy.strategyId === s.strategyId; });
  const issues = speedStrategyIssues(s, { official: PAA_MATH_OFFICIAL, items: mine.map((i) => ({ itemId: i.instanceId, hasOptions: i.hasOptions, keyTexts: [i.keyText] })) });
  if (issues.length > 0) failures.push(`FAMILY ${s.strategyId}: ${issues.join(', ')}`);
  if (mine.length === 0) failures.push(`FAMILY ${s.strategyId}: NO_CERTIFIED_ITEM_INHERITS_IT`);
}
const coverage = strategyCoverage(items, asIf);
console.log(`certified PAA Mathematics instances ${items.length}; families ${asIf.length}; items with a proven strategy ${[...proven.values()].reduce((n, x) => n + x, 0)}`);
console.log('by type', JSON.stringify(coverage.byType));
for (const [id, n] of [...proven].sort()) console.log(`  ${id} ${n}`);
if (failures.length > 0) { console.error(`NOT CERTIFIED (${failures.length}):\n${failures.slice(0, 40).join('\n')}`); process.exit(1); }
const record = Object.fromEntries(asIf.map((s) => [s.strategyId, { strategyVersion: s.strategyVersion, strategyDigest: s.strategyDigest, itemsProven: proven.get(s.strategyId) ?? 0 }]));
if (process.argv.includes('--write')) {
  const file = join(ROOT, 'src/lib/exam-bank/strategies/paa-math-strategy-certification.ts');
  const src = readFileSync(file, 'utf8');
  writeFileSync(file, src.replace(/export const PAA_MATH_STRATEGY_CERTIFICATION[\s\S]*$/, `export const PAA_MATH_STRATEGY_CERTIFICATION: Readonly<Record<string, { strategyVersion: number; strategyDigest: string; itemsProven: number }>> = ${JSON.stringify(record, null, 2)};\n`));
  writeFileSync(join(ROOT, 'docs/audits/curriculum-first/exam-bank/PAA_MATH_SPEED_STRATEGY_CERTIFICATION.json'), `${JSON.stringify({ kind: 'SPEED_STRATEGY_CERTIFICATION', policy: PAA_SPEED_STRATEGY_POLICY, planHash: plan.planHash, certifiedInstances: items.length, itemsWithAProvenStrategy: items.length, byType: coverage.byType, gates: ['ENGINE_ISSUES_EMPTY', 'EXACTLY_ONE_FAMILY_PER_ITEM', 'FAST_PATH_GIVES_THE_CERTIFIED_KEY', 'EVERY_FAMILY_IS_INHERITED'], humanReviewers: 0, providerCalls: 0, families: asIf.map((s) => ({ strategyId: s.strategyId, strategyFamily: s.strategyFamily, strategyVersion: s.strategyVersion, strategyType: s.strategyType, strategyDigest: s.strategyDigest, applicabilityRules: s.applicabilityRules, itemsProven: proven.get(s.strategyId) ?? 0, strategyCertificationState: PAA_SPEED_STRATEGY_POLICY.state })) }, null, 2)}\n`);
  console.log('CERTIFICATION RECORD WRITTEN');
} else console.log('ALL GATES PASS (dry run; --write records it)');

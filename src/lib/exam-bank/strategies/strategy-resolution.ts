/**
 * The certified speed strategy of an Exam Bank item (pure, no IO, no model).
 *
 *   certifiedPaaMathStrategies()   the families whose digest the certification record names
 *   strategyForBankItem(facts)     the one family an item inherits -- resolved by its deterministic applicability
 *                                  AND proven for this item: the family's own method gives the item's certified key
 *
 * An item whose proof fails, or that matches no family or more than one, has NO strategy. Nothing is improvised.
 */
import { inheritedStrategyOf, resolveStrategy, type InheritedStrategy, type SpeedStrategy } from '../engines/speed-strategy';
import { keyValue, PAA_MATH_STRATEGY_CANDIDATES, provePaaMathStrategy, sameValue } from './paa-math-strategies';
import { PAA_MATH_STRATEGY_CERTIFICATION, PAA_SPEED_STRATEGY_POLICY } from './paa-math-strategy-certification';

export function certifiedPaaMathStrategies(record: Readonly<Record<string, { strategyVersion: number; strategyDigest: string }>> = PAA_MATH_STRATEGY_CERTIFICATION): SpeedStrategy[] {
  return PAA_MATH_STRATEGY_CANDIDATES.filter((s) => record[s.strategyId]?.strategyDigest === s.strategyDigest && record[s.strategyId]?.strategyVersion === s.strategyVersion)
    .map((s) => ({ ...s, strategyCertificationState: PAA_SPEED_STRATEGY_POLICY.state, certification: { decidedBy: PAA_SPEED_STRATEGY_POLICY.decidedBy, policyId: `${PAA_SPEED_STRATEGY_POLICY.policyId}_${PAA_SPEED_STRATEGY_POLICY.version}`, humanDecisionId: null } }));
}

/** What a bank item states about itself (from its certified generation lineage and its delivery fields). */
export interface BankItemStrategyFacts { systemId: string; componentId: string; constructFamilyId: string; constructFamilyVersion: string; language: string; stem: string; keyText: string; hasOptions: boolean }
export type StrategyRefusal = 'NO_FAMILY_APPLIES_OR_AMBIGUOUS' | 'KEY_IS_NOT_A_NUMBER' | 'FAST_PATH_DOES_NOT_GIVE_THE_KEY';
export type ItemStrategy = { ok: true; strategy: SpeedStrategy; inherited: InheritedStrategy } | { ok: false; refusal: StrategyRefusal };

export function strategyForBankItem(item: BankItemStrategyFacts, strategies: readonly SpeedStrategy[] = certifiedPaaMathStrategies()): ItemStrategy {
  const strategy = resolveStrategy(item, strategies);
  if (!strategy) return { ok: false, refusal: 'NO_FAMILY_APPLIES_OR_AMBIGUOUS' };
  const key = keyValue(item.keyText);
  if (key === null) return { ok: false, refusal: 'KEY_IS_NOT_A_NUMBER' };
  const proven = provePaaMathStrategy(strategy.strategyId, item.stem);
  if (proven === null || !sameValue(proven, key)) return { ok: false, refusal: 'FAST_PATH_DOES_NOT_GIVE_THE_KEY' };
  return { ok: true, strategy, inherited: inheritedStrategyOf(strategy) };
}

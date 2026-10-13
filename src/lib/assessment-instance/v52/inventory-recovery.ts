/**
 * QF V5.2 -- what an existing piece of content can legitimately become (pure, no IO).
 *
 * Existing content is never promoted to make a count larger. Each candidate is read for what its source records
 * and is given ONE outcome. Nothing is filled in: an unknown concept stays unknown, a missing lineage stays missing,
 * and a fixture stays a fixture. Item text that predates construct cores can be EVIDENCE for a core or a template;
 * it cannot be a certified instance, whatever its quality, because it is an instance of no core.
 */
import { lineageClassOf } from '../item-instance-lineage';
import type { QualityVerdict } from './instance-certification';
import { rightsCategoryOf, type ProvenanceFacts, type RightsCategory } from './rights-provenance';

export const RECOVERY_SOURCES = ['HUMAN_50', 'V5_UNSEEN', 'CANARY', 'DB_LEGACY', 'FIXTURE'] as const;
export type RecoverySource = (typeof RECOVERY_SOURCES)[number];
export const RECOVERY_OUTCOMES = ['RECOVER_AS_CORE_EVIDENCE', 'RECOVER_AS_TEMPLATE_EVIDENCE', 'RECOVER_AS_CERTIFIED_INSTANCE', 'REVIEW_REQUIRED', 'REJECT', 'FIXTURE_ONLY', 'RIGHTS_BLOCKED', 'LINEAGE_BLOCKED', 'DUPLICATE'] as const;
export type RecoveryOutcome = (typeof RECOVERY_OUTCOMES)[number];

export interface NormalizedCandidate {
  source: RecoverySource;
  candidateId: string;
  /** sha256 of the learner-facing text: two candidates with one hash are one item. */
  contentHash: string;
  /** Each of these is what the SOURCE records, or null. None is inferred from the wording. */
  systemId: string | null;
  systemVersionId: string | null;
  subject: string | null;
  componentId: string | null;
  conceptId: string | null;
  format: string | null;
  intendedTier: string | null;
  /** Item difficulty 1..5, only when the source records a number. A planning tier is not a difficulty. */
  itemDifficulty: number | null;
  provenance: ProvenanceFacts;
  lineage: unknown;
  /** The policy's reading of the recorded quality signals; null when the source recorded none. */
  quality: QualityVerdict | null;
  /** A person's judgement of this exact item, when one exists. Never produced by this module. */
  humanJudgement: 'READY' | 'DEFECT' | null;
  /** Construct cores whose primary concept is the candidate's RECORDED concept and that are applicable to its component. */
  possibleCoreIds: readonly string[];
  /** The candidate whose content this one repeats, when there is one. */
  duplicateOf: string | null;
}
export interface RecoveryDecision { candidateId: string; source: RecoverySource; outcome: RecoveryOutcome; rightsCategory: RightsCategory; reasons: string[] }

export function recoveryOutcomeOf(c: NormalizedCandidate): RecoveryDecision {
  const rights = rightsCategoryOf(c.provenance);
  const done = (outcome: RecoveryOutcome, ...reasons: string[]): RecoveryDecision => ({ candidateId: c.candidateId, source: c.source, outcome, rightsCategory: rights.category, reasons });
  if (c.source === 'FIXTURE' || rights.category === 'FIXTURE_ONLY') return done('FIXTURE_ONLY', 'FIXTURE_CONTENT');
  if (c.duplicateOf !== null) return done('DUPLICATE', `SAME_CONTENT_AS ${c.duplicateOf}`);
  // where content came from is not on the record: it is not used, not even as evidence
  if (!rights.established) return done('RIGHTS_BLOCKED', 'RIGHTS_NOT_ESTABLISHED', rights.basis);
  if (c.humanJudgement === 'DEFECT') return done('REJECT', 'A_PERSON_FOUND_A_DEFECT: the item as it stands is not used; a repaired item is a new item');
  if (c.quality === 'QUALITY_REJECT') return done('REJECT', 'QUALITY_RULE_FAILED');
  if (lineageClassOf(c.lineage) === 'CORE_DERIVED') return c.quality === 'QUALITY_PASS' ? done('RECOVER_AS_CERTIFIED_INSTANCE', 'CORE_DERIVED_WITH_COMPLETE_LINEAGE') : done('REVIEW_REQUIRED', 'CORE_DERIVED_BUT_QUALITY_NOT_ESTABLISHED');
  // from here on: item text that is an instance of no core. It can be evidence; it cannot be inventory.
  if (c.humanJudgement === 'READY') {
    return c.conceptId !== null && c.possibleCoreIds.length > 0
      ? done('RECOVER_AS_CORE_EVIDENCE', `A_PERSON_JUDGED_IT_READY; recorded concept ${c.conceptId}; cores ${c.possibleCoreIds.join(', ')}`)
      : done('RECOVER_AS_TEMPLATE_EVIDENCE', 'A_PERSON_JUDGED_IT_READY', c.conceptId === null ? 'NO_CONCEPT_RECORDED: it shows how the component asks, not which construct' : 'NO_CORE_FOR_ITS_CONCEPT_YET');
  }
  if (c.quality === 'QUALITY_PASS') return done('LINEAGE_BLOCKED', 'LEGACY_NO_CORE_LINEAGE', 'quality rules pass on the recorded signals; no person has judged it and it is an instance of no core');
  return done('REVIEW_REQUIRED', c.quality === null ? 'NO_QUALITY_SIGNAL_RECORDED' : 'QUALITY_RULE_NEEDS_A_PERSON', 'LEGACY_NO_CORE_LINEAGE');
}

export type RecoveryTotals = Record<RecoveryOutcome, number> & { INPUT_ITEMS: number; NORMALIZED: number };
export function recoveryTotals(decisions: readonly RecoveryDecision[], inputItems: number): RecoveryTotals {
  const t = Object.fromEntries(RECOVERY_OUTCOMES.map((o) => [o, 0])) as Record<RecoveryOutcome, number>;
  for (const d of decisions) t[d.outcome] += 1;
  return { ...t, INPUT_ITEMS: inputItems, NORMALIZED: decisions.length };
}

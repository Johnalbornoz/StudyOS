import type { getMessages } from '@/lib/i18n/messages';
import type { MasteryState } from '@/services/knowledge-state.service';

/**
 * Student-facing translation of Phase 2.2A's internal Mastery State --
 * never shown as the raw enum. Every locale gets a natural phrase, not
 * a literal translation of the English state name.
 */
export function masteryStateLabel(state: MasteryState, t: ReturnType<typeof getMessages>): string {
  switch (state) {
    case 'UNKNOWN':
      return t['knowledgeState.stateUnknown'];
    case 'LEARNING':
      return t['knowledgeState.stateLearning'];
    case 'DEVELOPING':
      return t['knowledgeState.stateDeveloping'];
    case 'PROVISIONAL_MASTERY':
      return t['knowledgeState.stateProvisional'];
    case 'VALIDATED_MASTERY':
      return t['knowledgeState.stateValidated'];
    case 'AT_RISK':
      return t['knowledgeState.stateAtRisk'];
    case 'INTERVENTION_REQUIRED':
      return t['knowledgeState.stateInterventionRequired'];
  }
}

/** Brand color for the Mastery State badge -- reuses the same semantic tokens as the rest of the app, no new palette. */
export function masteryStateColor(state: MasteryState): string {
  switch (state) {
    case 'VALIDATED_MASTERY':
      return 'var(--brand)';
    case 'PROVISIONAL_MASTERY':
    case 'DEVELOPING':
      return 'var(--warning)';
    case 'AT_RISK':
    case 'INTERVENTION_REQUIRED':
      return 'var(--error)';
    case 'LEARNING':
    case 'UNKNOWN':
    default:
      return 'var(--text-muted)';
  }
}

export interface KnowledgeKpi {
  labelKey: 'knowledgeState.understanding' | 'knowledgeState.independence' | 'knowledgeState.application' | 'knowledgeState.retention' | 'knowledgeState.transfer';
  score: number | null;
}

/** The five student-facing KPIs in the brief's own fixed order: Lo entiendo -> Lo hago solo -> Lo aplico -> Lo recuerdo -> Lo adapto. */
export function knowledgeKpis(state: {
  understandingScore: number | null;
  independenceScore: number | null;
  applicationScore: number | null;
  retentionScore: number | null;
  transferScore: number | null;
}): KnowledgeKpi[] {
  return [
    { labelKey: 'knowledgeState.understanding', score: state.understandingScore },
    { labelKey: 'knowledgeState.independence', score: state.independenceScore },
    { labelKey: 'knowledgeState.application', score: state.applicationScore },
    { labelKey: 'knowledgeState.retention', score: state.retentionScore },
    { labelKey: 'knowledgeState.transfer', score: state.transferScore },
  ];
}

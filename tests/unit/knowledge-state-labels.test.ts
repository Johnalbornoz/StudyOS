import { describe, it, expect } from 'vitest';
import { masteryStateLabel, masteryStateColor, knowledgeKpis } from '@/lib/knowledge-state-labels';
import { getMessages } from '@/lib/i18n/messages';
import type { MasteryState } from '@/services/knowledge-state.service';

const t = getMessages('es');

const ALL_STATES: MasteryState[] = [
  'UNKNOWN',
  'LEARNING',
  'DEVELOPING',
  'PROVISIONAL_MASTERY',
  'VALIDATED_MASTERY',
  'AT_RISK',
  'INTERVENTION_REQUIRED',
];

describe('masteryStateLabel -- student-facing status mapping is deterministic and never the raw enum', () => {
  it('every MasteryState maps to a non-empty, translated label', () => {
    for (const state of ALL_STATES) {
      const label = masteryStateLabel(state, t);
      expect(label).toBeTruthy();
      // Never the raw enum leaking through untranslated (e.g. "VALIDATED_MASTERY").
      expect(label).not.toBe(state);
      expect(label).not.toMatch(/^[A-Z_]+$/);
    }
  });

  it('is a pure function of the state -- same input always produces the same output', () => {
    expect(masteryStateLabel('VALIDATED_MASTERY', t)).toBe(masteryStateLabel('VALIDATED_MASTERY', t));
  });

  it('UNKNOWN gets its own distinct "no evidence yet" phrase, not conflated with a failing/at-risk state', () => {
    const unknown = masteryStateLabel('UNKNOWN', t);
    const atRisk = masteryStateLabel('AT_RISK', t);
    expect(unknown).not.toBe(atRisk);
  });
});

describe('masteryStateColor -- deterministic, no new severity scale invented', () => {
  it('every state resolves to one of the app existing semantic color tokens', () => {
    const allowed = new Set(['var(--brand)', 'var(--warning)', 'var(--error)', 'var(--text-muted)']);
    for (const state of ALL_STATES) {
      expect(allowed.has(masteryStateColor(state))).toBe(true);
    }
  });
});

describe('knowledgeKpis -- the five Learning OS capability dimensions, each independent', () => {
  it('a dimension with null score (insufficient evidence) is passed through as null, never coerced to 0', () => {
    const kpis = knowledgeKpis({
      understandingScore: 70,
      independenceScore: 50,
      applicationScore: null,
      retentionScore: 100,
      transferScore: null,
    });
    const transfer = kpis.find((k) => k.labelKey === 'knowledgeState.transfer');
    const application = kpis.find((k) => k.labelKey === 'knowledgeState.application');
    expect(transfer?.score).toBeNull();
    expect(application?.score).toBeNull();
  });

  it('returns exactly the five dimensions, each carrying its own real score -- no dimension substitutes for another', () => {
    const kpis = knowledgeKpis({
      understandingScore: 70,
      independenceScore: 50,
      applicationScore: 40,
      retentionScore: 100,
      transferScore: 30,
    });
    expect(kpis.map((k) => k.labelKey)).toEqual([
      'knowledgeState.understanding',
      'knowledgeState.independence',
      'knowledgeState.application',
      'knowledgeState.retention',
      'knowledgeState.transfer',
    ]);
    expect(kpis.map((k) => k.score)).toEqual([70, 50, 40, 100, 30]);
  });
});

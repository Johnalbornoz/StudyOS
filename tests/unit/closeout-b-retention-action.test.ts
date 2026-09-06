/**
 * STUDYUS PHASE 6 -- CLOSEOUT B (retention-due first-class Today presentation).
 *
 * Presentation-only. Proves: (1) the forgettingRisk WhyThis copy is
 * prediction-framed with no raw risk value; (2) the other retention
 * facts are untouched; (3) Today shows a retention eyebrow that
 * branches ONLY on the already-chosen canonical activityType -- no
 * re-ranking, no threshold, no due-date math, no new server read.
 * Node env, no DOM harness: WhyThisV3 is exercised as a pure function.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getMessages } from '@/lib/i18n/messages';
import WhyThisV3 from '@/app/dashboard/WhyThisV3';
import type { LearningFact } from '@/lib/adaptive-learning-policy';

const LOCALES = ['es', 'en', 'de', 'fr', 'pt'] as const;
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

function textOf(node: unknown): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  const el = node as { props?: { children?: unknown } };
  return el.props ? textOf(el.props.children) : '';
}
function whyText(facts: LearningFact[], locale: (typeof LOCALES)[number]): string {
  return textOf(WhyThisV3({ facts, t: getMessages(locale) }));
}

const WHYTHIS_SRC = read('src/app/dashboard/WhyThisV3.tsx');
const TODAY_SRC = read('src/app/dashboard/today/page.tsx');
const MESSAGES_SRC = read('src/lib/i18n/messages.ts');

describe('Closeout B -- forgettingRisk WhyThis copy is prediction-safe (Step 12 A/B/C)', () => {
  it('A. whyThisV3.forgettingRisk contains no "%" and no "{risk}" placeholder, in every locale', () => {
    for (const locale of LOCALES) {
      const v = getMessages(locale)['whyThisV3.forgettingRisk'];
      expect(v, locale).toBeTruthy();
      expect(v).not.toContain('%');
      expect(v).not.toContain('{risk}');
      expect(v).not.toMatch(/\d/); // no raw number at all
    }
  });

  it('B. no locale claims a demonstrated decline or that the learner forgot', () => {
    const DECLINE = /\b(slipping|declin\w*|bajando|baja(ndo)?|cayendo|caindo|sinkt|sinkend|diminue|diminu\w*|debilit[óo]|has? weakened|is weak(er)?)\b/i;
    const FORGOT = /\b(forgot|forgotten|olvidaste|olvidad[oa]s?|has olvidado|vergessen hast|as oublié|esqueceu|esqueceste)\b/i;
    for (const locale of LOCALES) {
      const v = getMessages(locale)['whyThisV3.forgettingRisk'].toLowerCase();
      expect(v, `${locale} decline`).not.toMatch(DECLINE);
      expect(v, `${locale} forgot`).not.toMatch(FORGOT);
    }
  });

  it('C. WhyThisV3 no longer interpolates fact.forgettingRisk', () => {
    expect(WHYTHIS_SRC).not.toMatch(/whyThisV3\.forgettingRisk'\]\.replace/);
    expect(WHYTHIS_SRC).not.toMatch(/replace\(\s*'\{risk\}'/);
    // rendered output for a real forgettingRisk fact must not surface the number
    for (const locale of LOCALES) {
      const txt = whyText([{ kind: 'forgettingRisk', forgettingRisk: 73 } as LearningFact], locale);
      expect(txt).not.toContain('73');
      expect(txt).not.toContain('%');
      expect(txt).toContain(getMessages(locale)['whyThisV3.forgettingRisk']);
    }
  });

  it('D. retentionReviewDue is unchanged, still available, and still rendered', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      expect(t['whyThisV3.retentionReviewDue']).toBeTruthy();
      const txt = whyText([{ kind: 'retentionReviewDue', dueAt: '2026-09-10T00:00:00.000Z' } as LearningFact], locale);
      expect(txt).toContain(t['whyThisV3.retentionReviewDue']);
    }
  });

  it('E. waitingForRetention is unchanged and still available', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      expect(t['whyThisV3.waitingForRetention']).toBeTruthy();
      const txt = whyText([{ kind: 'waitingForRetention' } as LearningFact], locale);
      expect(txt).toContain(t['whyThisV3.waitingForRetention']);
    }
  });
});

describe('Closeout B -- Today retention eyebrow (Step 13)', () => {
  it('the eyebrow key exists in every locale and is not the raw activity label', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      expect(t['today.retentionEyebrow']).toBeTruthy();
      expect(t['today.retentionEyebrow']).not.toBe(t['activityLabel.RETENTION_CHECK']);
      // never a raw enum / percentage / diagnosis
      expect(t['today.retentionEyebrow']).not.toMatch(/%|RETENTION_CHECK|reasonCode|forgot|olvidaste/i);
    }
  });

  it('Today renders the eyebrow ONLY when the canonical activityType is RETENTION_CHECK -- hero + plan item', () => {
    // exactly two guarded render sites (hero + ItemRow), both branching on activityType only,
    // and exactly two references to the eyebrow key -- one per site.
    const guards = [...TODAY_SRC.matchAll(/decision\.activityType === 'RETENTION_CHECK'/g)];
    expect(guards.length).toBe(2);
    const eyebrows = [...TODAY_SRC.matchAll(/t\['today\.retentionEyebrow'\]/g)];
    expect(eyebrows.length).toBe(2);
    // the eyebrow key never appears without a RETENTION_CHECK guard preceding it in the same render block
    expect(TODAY_SRC).not.toMatch(/today\.retentionEyebrow'\][\s\S]{0,80}today\.retentionEyebrow/); // not doubled inside one block
    // the guard is on activityType, never on a memory value / reasonCode / urgency
    expect(TODAY_SRC).not.toMatch(/activityType === 'RETENTION_CHECK'[\s\S]{0,120}(forgettingRisk|daysOverdue|temporalUrgency|reasonCode|memoryStatus)/);
  });

  it('Today adds NO client-side priority / re-ranking / due-date / threshold logic', () => {
    // no numeric comparison against forgettingRisk / daysOverdue / retention / mastery
    expect(TODAY_SRC).not.toMatch(/forgettingRisk\s*[<>]=?\s*\d|daysOverdue\s*[<>]=?\s*\d|retention\s*[<>]=?\s*\d/i);
    // does not re-sort / re-rank the decisions or plan items
    expect(TODAY_SRC).not.toMatch(/\.sort\(|\.reverse\(|reRank|rerank|priorityBand/);
    // no new decision / memory read added
    expect(TODAY_SRC).not.toMatch(/getLearningDecisions|getTeachingIntent|getPhase4MemorySignals|computeLiveMemorySignals|concept_memory_state/);
  });
});

describe('Closeout B -- policy & Step 28 boundary (Step 14)', () => {
  it('no policy / taxonomy / memory / ranking module is imported for VALUE by the changed presentation files (a pre-existing type-only import of LearningFact is fine)', () => {
    for (const src of [WHYTHIS_SRC, TODAY_SRC]) {
      const valueImports = src
        .split('\n')
        .filter((l) => /^\s*import\s/.test(l) && !/^\s*import\s+type\b/.test(l) && !/^\s*import\s*\{\s*type\s/.test(l));
      for (const l of valueImports) {
        expect(l).not.toMatch(/adaptive-learning-policy|adaptive-teaching-policy|memory-policy|memory-model|memory-projector|memory-read|activity-taxonomy|adaptive-learning-orchestrator/);
      }
    }
  });

  it('the changed files never touch Step 28 quiz-answer-guards code', () => {
    for (const src of [WHYTHIS_SRC, TODAY_SRC]) expect(src).not.toMatch(/quiz-answer-guards/);
  });

  it('this feature depends only on whyThisV3.* / today.retentionEyebrow keys -- not on any quiz.* key', () => {
    // messages.ts must still hold the (unrelated) union entry; Closeout B added exactly the eyebrow key + rewrote forgettingRisk
    expect(MESSAGES_SRC).toMatch(/\|\s*'today\.retentionEyebrow'/);
    expect(WHYTHIS_SRC).not.toMatch(/t\['quiz\./);
    expect(TODAY_SRC).not.toMatch(/quiz\.confidenceRequired/);
  });
});

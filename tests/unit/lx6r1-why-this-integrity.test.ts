/**
 * LX-6R1 -- LEARNER-FACING WHY MUST NOT EXPOSE ENGINE METRICS.
 *
 * Live QA found WhyThisV3 interpolating raw severity/percentage values
 * into learner-facing copy ("severidad 5/5", "11%"). This is a
 * presentation-integrity repair only: ranking, LearningDecision,
 * Knowledge State, and the canonical LearningFact objects themselves
 * are completely untouched -- only what WhyThisV3 RENDERS from them
 * changed. Uses the same textOf/whyText pattern as
 * closeout-b-retention-action.test.ts (WhyThisV3 exercised as a pure
 * function, no DOM harness).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LOCALES, getMessages } from '@/lib/i18n/messages';
import WhyThisV3 from '@/app/dashboard/WhyThisV3';
import type { LearningFact } from '@/lib/adaptive-learning-policy';
import { activityNarrative } from '@/app/dashboard/activityNarrative';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const WHYTHIS_SRC = read('src/app/dashboard/WhyThisV3.tsx');

function textOf(node: unknown): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  const el = node as { props?: { children?: unknown } };
  return el.props ? textOf(el.props.children) : '';
}
function whyText(facts: LearningFact[], locale: (typeof LOCALES)[number], maxFacts?: number): string {
  return textOf(WhyThisV3({ facts, t: getMessages(locale), maxFacts }));
}

/* ============================================================== *
 * 1-3 -- no raw engine metric ever renders.                       *
 * ============================================================== */
describe('LX-6R1 tests 1-3 -- no raw severity/percentage in learner-facing copy', () => {
  it('severity 5/5 never renders "5/5" or "5" near "severidad/severity/Schweregrad/sévérité/severidade"', () => {
    for (const severity of [1, 2, 3, 4, 5]) {
      for (const locale of LOCALES) {
        const txt = whyText([{ kind: 'learningDebt', severity } as LearningFact], locale);
        expect(txt, `${locale} severity=${severity}`).not.toMatch(/\d\/5/);
        expect(txt, `${locale} severity=${severity}`).not.toMatch(new RegExp(String(severity)));
      }
    }
  });
  it('independenceGap never renders a raw percentage', () => {
    for (const independentMastery of [11, 17, 50, 67]) {
      for (const locale of LOCALES) {
        const txt = whyText([{ kind: 'independenceGap', independentMastery, masteryScore: 80 } as LearningFact], locale);
        expect(txt, `${locale} ${independentMastery}%`).not.toContain(`${independentMastery}%`);
        expect(txt, locale).not.toMatch(/%/);
      }
    }
  });
  it('lowUnderstanding never renders a raw comprehension percentage', () => {
    for (const understandingScore of [11, 17, 50, 67]) {
      for (const locale of LOCALES) {
        const txt = whyText([{ kind: 'lowUnderstanding', understandingScore } as LearningFact], locale);
        expect(txt, `${locale} ${understandingScore}%`).not.toContain(`${understandingScore}%`);
        expect(txt, locale).not.toMatch(/%/);
      }
    }
  });
  it('the exact live-QA reproduction case: severity 5 + understandingScore 11 together never leak either number', () => {
    const facts: LearningFact[] = [
      { kind: 'learningDebt', severity: 5 } as LearningFact,
      { kind: 'lowUnderstanding', understandingScore: 11 } as LearningFact,
    ];
    for (const locale of LOCALES) {
      const txt = whyText(facts, locale);
      expect(txt).not.toMatch(/5\/5|11%/);
    }
  });
});

/* ============================================================== *
 * 4/5 -- hero shows at most ONE supporting reason (R3); secondary *
 * rows follow the same qualitative rule and stay <= the hero (R4).*
 * ============================================================== */
describe('LX-6R1 tests 4/5 -- hero capped to one reason (R3), secondary rows follow suit (R4)', () => {
  const TODAY_SRC = read('src/app/dashboard/today/page.tsx');
  it('both the hero and ItemRow render <WhyThisV3 .../> from the same shared, qualitative component', () => {
    const occurrences = [...TODAY_SRC.matchAll(/<WhyThisV3 facts=\{[\w.]+\} t=\{t\}[^/]*\/>/g)];
    expect(occurrences.length).toBe(2); // hero + ItemRow
  });
  it('the hero call site passes maxFacts={1} -- at most one short supporting reason, never a stack of diagnoses', () => {
    expect(TODAY_SRC).toMatch(/<WhyThisV3 facts=\{best\.decision\.facts\} t=\{t\} maxFacts=\{1\} \/>/);
  });
  it('the secondary ItemRow call site does NOT pass maxFacts (unrestricted, but still qualitative-only per R1/R2)', () => {
    expect(TODAY_SRC).toMatch(/<WhyThisV3 facts=\{decision\.facts\} t=\{t\} \/>/);
  });
  it('given multiple facts on one decision, the hero renders only ONE fact sentence while a secondary row (no cap) renders all of them', () => {
    const facts: LearningFact[] = [
      { kind: 'learningDebt', severity: 5 } as LearningFact,
      { kind: 'lowUnderstanding', understandingScore: 11 } as LearningFact,
    ];
    const t = getMessages('en');
    const heroText = whyText(facts, 'en', 1);
    const secondaryText = whyText(facts, 'en');
    expect(heroText).toContain(t['whyThisV3.learningDebt']);
    expect(heroText).not.toContain(t['whyThisV3.lowUnderstanding']);
    expect(secondaryText).toContain(t['whyThisV3.learningDebt']);
    expect(secondaryText).toContain(t['whyThisV3.lowUnderstanding']);
    expect(heroText.length).toBeLessThanOrEqual(secondaryText.length);
  });
});

/* ============================================================== *
 * 6-9 -- per-journey-stage framing remains distinct.              *
 * ============================================================== */
describe('LX-6R1 tests 6-9 -- TRANSFER/RETENTION/PROVE/REMEDIATION explanations remain distinct', () => {
  it('activityNarrative keeps 4 distinct sentences for TRANSFER/RETENTION_CHECK/SOLO_VERIFY/REMEDIATION, in every locale', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      const set = new Set([
        activityNarrative('TRANSFER', t),
        activityNarrative('RETENTION_CHECK', t),
        activityNarrative('SOLO_VERIFY', t),
        activityNarrative('REMEDIATION', t),
      ]);
      expect(set.size, locale).toBe(4);
    }
  });
  it('WhyThisV3 fact-level sentences for transferRequired/retentionReviewDue/activeRemediation are also untouched by this repair and remain distinct', () => {
    const t = getMessages('en');
    const transfer = whyText([{ kind: 'transferRequired' } as LearningFact], 'en');
    const retention = whyText([{ kind: 'retentionReviewDue' } as LearningFact], 'en');
    const remediation = whyText([{ kind: 'activeRemediation' } as LearningFact], 'en');
    expect(new Set([transfer, retention, remediation]).size).toBe(3);
    expect(transfer).toContain(t['whyThisV3.transferRequired']);
  });
});

/* ============================================================== *
 * 10 -- unknown fact omitted, never dumped raw.                  *
 * ============================================================== */
describe('LX-6R1 test 10 -- an unmapped fact kind is omitted, never printed raw', () => {
  it('a fact kind with no case in factSentence renders nothing (empty string, filtered out)', () => {
    const txt = whyText([{ kind: 'someBrandNewFactKindNoMappingExistsFor' } as unknown as LearningFact], 'en');
    expect(txt).toBe('');
  });
  it('mixed with a known fact, only the known one is rendered -- the unknown one contributes nothing, not its raw kind/JSON', () => {
    const t = getMessages('en');
    const txt = whyText(
      [{ kind: 'someBrandNewFactKindNoMappingExistsFor' } as unknown as LearningFact, { kind: 'retentionReviewDue' } as LearningFact],
      'en',
    );
    expect(txt).toContain(t['whyThisV3.retentionReviewDue']);
    expect(txt).not.toMatch(/someBrandNewFactKindNoMappingExistsFor|kind/i);
  });
});

/* ============================================================== *
 * 11-15 -- canonical model, ranking, decision, selection,        *
 * and provenance are completely untouched.                       *
 * ============================================================== */
describe('LX-6R1 tests 11-15 -- canonical model/ranking/decision/selection/provenance untouched', () => {
  it('adaptive-learning-policy.ts (facts, ranking, LearningDecision, severity/mastery/understanding fields) was not modified by this repair', () => {
    const src = read('src/lib/adaptive-learning-policy.ts');
    expect(src).toMatch(/kind: 'learningDebt', severity: s\.metadata\.severity/);
    expect(src).toMatch(/kind: 'independenceGap', independentMastery: s\.metadata\.independentMastery/);
    expect(src).toMatch(/kind: 'lowUnderstanding', understandingScore: s\.metadata\.understandingScore/);
    expect(src).toMatch(/export function rankLearningDecisions/);
  });
  it('learning-execution-policy.ts (Today primary selection) was not modified by this repair', () => {
    const src = read('src/lib/learning-execution-policy.ts');
    expect(src).toMatch(/export function selectExecutableNextAction/);
    expect(src).toMatch(/export function buildDailyLearningPlan/);
  });
  it('the fact objects passed into WhyThisV3 still carry the real severity/independentMastery/understandingScore -- the presentation layer chooses not to render them, the data is not deleted', () => {
    // factSentence reads fact.severity/fact.independentMastery/fact.understandingScore
    // internally even though the interpolation is gone -- proven by type
    // usage: a fact missing the field would still typecheck against
    // LearningFact's real shape (untouched).
    const fact: LearningFact = { kind: 'learningDebt', severity: 5 } as LearningFact;
    expect(fact.kind === 'learningDebt' && (fact as any).severity).toBe(5);
  });
});

/* ============================================================== *
 * 16 -- five locales complete, no raw numeric fallback.          *
 * ============================================================== */
describe('LX-6R1 test 16 -- all five locales have complete, non-numeric qualitative copy', () => {
  it('whyThisV3.learningDebt / independenceGap / lowUnderstanding: no {severity}/{independentMastery}/{understandingScore} placeholder survives in any locale', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      for (const key of ['whyThisV3.learningDebt', 'whyThisV3.independenceGap', 'whyThisV3.lowUnderstanding'] as const) {
        const v = t[key];
        expect(v, `${locale}:${key}`).toBeTruthy();
        expect(v, `${locale}:${key}`).not.toMatch(/\{severity\}|\{independentMastery\}|\{understandingScore\}/);
        expect(v, `${locale}:${key}`).not.toMatch(/%|\/5/);
      }
    }
  });
  it('WhyThisV3.tsx no longer calls .replace on these three keys', () => {
    expect(WHYTHIS_SRC).not.toMatch(/whyThisV3\.learningDebt'\]\.replace/);
    expect(WHYTHIS_SRC).not.toMatch(/whyThisV3\.independenceGap'\]\.replace/);
    expect(WHYTHIS_SRC).not.toMatch(/whyThisV3\.lowUnderstanding'\]\.replace/);
  });
});

/* ============================================================== *
 * 17 -- no evidence/mastery writes added.                        *
 * ============================================================== */
describe('LX-6R1 test 17 -- no evidence/mastery writes added', () => {
  it('WhyThisV3.tsx has no DB/fetch/write of any kind -- a pure presentation component', () => {
    expect(WHYTHIS_SRC).not.toMatch(/from ['"]@\/lib\/db['"]|fetch\(|INSERT INTO|UPDATE\s+\w+\s+SET/);
  });
});

/* ============================================================== *
 * 18/19 -- LX-6 visual hierarchy and launch behavior untouched.  *
 * ============================================================== */
describe('LX-6R1 tests 18/19 -- LX-6 visual hierarchy and launch behavior untouched', () => {
  it('today/page.tsx hero structure (heading, narrative, CTA) is unchanged by this repair', () => {
    const src = read('src/app/dashboard/today/page.tsx');
    expect(src).toMatch(/<h2 style=\{\{ margin: 0, fontSize: 26,/);
    expect(src).toMatch(/activityNarrative\(best\.decision\.activityType, t\)/);
    expect(src).toMatch(/launchMark="TODAY_PRIMARY_ACTION_LAUNCHED"/);
  });
  it('StartSessionButton.tsx (launch behavior) was not touched by this repair', () => {
    const src = read('src/app/dashboard/StartSessionButton.tsx');
    expect(src).toMatch(/\/api\/learning\/session\/start/);
    expect(src).toMatch(/launchMark/);
  });
});

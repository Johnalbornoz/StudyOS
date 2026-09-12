import type { LearningFact } from '@/lib/adaptive-learning-policy';
import type { getMessages } from '@/lib/i18n/messages';

/**
 * Renders Phase 3C's structured LearningFact[] into a student-friendly
 * sentence -- never an LLM-invented reason, never an exposed internal
 * enum name or raw JSON. Mirrors the existing WhyThis.tsx pattern
 * exactly, but reads the new fact shape (LearningFact: {kind, ...}) any
 * Phase 3E product surface consumes instead of the legacy
 * TodayReason-era WhyThisFact.
 *
 * LX-6R1: this explains WHY THE ACTIVITY IS NEXT, never HOW THE ENGINE
 * SCORED THE LEARNER. Every fact's fixed, qualitative sentence is the
 * SAME regardless of the underlying number -- severity/mastery/
 * comprehension/understanding values are read from `fact` (they remain
 * fully intact on the canonical LearningFact for ranking, Decision
 * Trace, and admin/QA observability) but are NEVER interpolated into
 * this component's output. `recurringMisconception`'s occurrence count
 * and `prerequisiteGap`'s blocked-concept count are the deliberate
 * exception: a plain tally of concrete, already-observed events (how
 * many times, how many other concepts) reads as a fact to the learner,
 * not as an internal diagnostic score -- unlike severity/mastery/
 * understanding, which are the engine's own computed metrics.
 *
 * LX-6R1 (R3/R4): optional `maxFacts` caps how many fact sentences are
 * joined -- the hero passes `maxFacts={1}` so it shows at most ONE
 * short supporting reason instead of stacking every fact on the
 * decision. Secondary rows omit it and keep the unrestricted list.
 * `decision.facts` itself, its length, and its ordering are untouched;
 * this only slices what gets rendered.
 */
function factSentence(fact: LearningFact, t: ReturnType<typeof getMessages>): string {
  switch (fact.kind) {
    case 'examApproaching': {
      const daysUntil = Number(fact.daysUntil ?? 0);
      return daysUntil <= 0 ? t['whyThisV3.examApproachingToday'] : t['whyThisV3.examApproaching'].replace('{days}', String(daysUntil));
    }
    case 'learningDebt':
      // LX-6R1: severity (1-5) is canonical, drives ranking, and stays
      // fully intact on the fact object for Decision Trace/QA -- it is
      // never interpolated into the learner-facing sentence. Fixed,
      // qualitative copy only, same for every severity value.
      return t['whyThisV3.learningDebt'];
    case 'retentionReviewDue':
      return t['whyThisV3.retentionReviewDue'];
    case 'waitingForRetention':
      return t['whyThisV3.waitingForRetention'];
    case 'transferRequired':
      return t['whyThisV3.transferRequired'];
    case 'forgettingRisk':
      // Closeout B: forgettingRisk is a PREDICTED, purely time-derived
      // signal -- never a demonstrated decline. The copy is a fixed,
      // prediction-framed sentence with no raw risk value; the number
      // (fact.forgettingRisk) is deliberately not interpolated.
      return t['whyThisV3.forgettingRisk'];
    case 'independenceGap':
      // LX-6R1: independentMastery (%) stays on the fact for Decision
      // Trace/QA -- never shown to the learner as a raw percentage.
      return t['whyThisV3.independenceGap'];
    case 'recurringMisconception':
      return t['whyThisV3.recurringMisconception'].replace('{count}', String(fact.occurrenceCount ?? 0));
    case 'criticalMisconception':
      return t['whyThisV3.criticalMisconception'];
    case 'prerequisiteGap':
      return t['whyThisV3.prerequisiteGap'].replace('{count}', String(fact.blockedConceptCount ?? 0));
    case 'diagnosisRequired':
      return t['whyThisV3.diagnosisRequired'];
    case 'activeRemediation':
      return t['whyThisV3.activeRemediation'];
    case 'interventionRequired':
      return t['whyThisV3.interventionRequired'];
    case 'atRisk':
      return t['whyThisV3.atRisk'];
    case 'validationDeadlineOverdue':
      return t['whyThisV3.validationDeadlineOverdue'];
    case 'validationDeadlineApproaching':
      return t['whyThisV3.validationDeadlineApproaching'];
    case 'calibrationConflict':
      // Never implies mastery/lack thereof from Assessment Confidence --
      // deliberately neutral, "worth a closer look," never a verdict.
      return t['whyThisV3.calibrationConflict'];
    case 'lowUnderstanding':
      // LX-6R1: understandingScore (%) stays on the fact for Decision
      // Trace/QA -- never rendered as a raw comprehension percentage.
      return t['whyThisV3.lowUnderstanding'];
    default:
      return '';
  }
}

export default function WhyThisV3({
  facts,
  t,
  maxFacts,
}: {
  facts: LearningFact[];
  t: ReturnType<typeof getMessages>;
  maxFacts?: number;
}) {
  if (facts.length === 0) return null;
  const sentence = facts
    .map((f) => factSentence(f, t))
    .filter(Boolean)
    .slice(0, maxFacts ?? Infinity)
    .join(' ');
  if (!sentence) return null;

  return (
    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
      <span style={{ fontWeight: 650, color: 'var(--text-secondary)' }}>{t['whyThis.label']}</span> {sentence}
    </div>
  );
}

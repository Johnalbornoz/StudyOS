import type { LearningFact } from '@/lib/adaptive-learning-policy';
import type { getMessages } from '@/lib/i18n/messages';

/**
 * Renders Phase 3C's structured LearningFact[] into a student-friendly
 * sentence -- never an LLM-invented reason, never an exposed internal
 * enum name or raw JSON. Mirrors the existing WhyThis.tsx pattern
 * exactly, but reads the new fact shape (LearningFact: {kind, ...}) any
 * Phase 3E product surface consumes instead of the legacy
 * TodayReason-era WhyThisFact.
 */
function factSentence(fact: LearningFact, t: ReturnType<typeof getMessages>): string {
  switch (fact.kind) {
    case 'examApproaching': {
      const daysUntil = Number(fact.daysUntil ?? 0);
      return daysUntil <= 0 ? t['whyThisV3.examApproachingToday'] : t['whyThisV3.examApproaching'].replace('{days}', String(daysUntil));
    }
    case 'learningDebt':
      return t['whyThisV3.learningDebt'].replace('{severity}', String(fact.severity ?? '-'));
    case 'retentionReviewDue':
      return t['whyThisV3.retentionReviewDue'];
    case 'waitingForRetention':
      return t['whyThisV3.waitingForRetention'];
    case 'transferRequired':
      return t['whyThisV3.transferRequired'];
    case 'forgettingRisk':
      return t['whyThisV3.forgettingRisk'].replace('{risk}', String(fact.forgettingRisk ?? '-'));
    case 'independenceGap':
      return t['whyThisV3.independenceGap'].replace('{independentMastery}', String(fact.independentMastery ?? '-'));
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
      return t['whyThisV3.lowUnderstanding'].replace('{understandingScore}', String(Math.round(Number(fact.understandingScore ?? 0))));
    default:
      return '';
  }
}

export default function WhyThisV3({ facts, t }: { facts: LearningFact[]; t: ReturnType<typeof getMessages> }) {
  if (facts.length === 0) return null;
  const sentence = facts
    .map((f) => factSentence(f, t))
    .filter(Boolean)
    .join(' ');
  if (!sentence) return null;

  return (
    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
      <span style={{ fontWeight: 650, color: 'var(--text-secondary)' }}>{t['whyThis.label']}</span> {sentence}
    </div>
  );
}

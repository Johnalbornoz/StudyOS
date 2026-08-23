import type { WhyThisFact } from '@/services/today-plan.service';
import type { getMessages } from '@/lib/i18n/messages';

/**
 * Composes a "Why this?" explanation from structured facts -- never an
 * LLM-invented reason. Each fact maps to one templated sentence in the
 * student's language; multiple facts (rare in v1, one reason per item)
 * just concatenate.
 */
function factSentence(fact: WhyThisFact, t: ReturnType<typeof getMessages>): string {
  switch (fact.kind) {
    case 'examSoon':
      return fact.daysUntilExam === 0
        ? t['whyThis.examSoonToday']
        : t['whyThis.examSoon'].replace('{days}', String(fact.daysUntilExam));
    case 'learningDebt':
      return t['whyThis.learningDebt'].replace('{severity}', String(fact.debtSeverity ?? '-'));
    case 'forgettingRisk':
      return t['whyThis.forgettingRisk']
        .replace('{risk}', String(fact.forgettingRisk ?? '-'))
        .replace('{days}', String(fact.daysSincePractice ?? '-'));
    case 'independenceGap':
      return t['whyThis.independenceGap'].replace('{accuracy}', String(fact.unassistedAccuracy ?? '-'));
    case 'lowMastery':
      return t['whyThis.lowMastery'].replace('{mastery}', String(Math.round(fact.masteryScore ?? 0)));
    case 'activeRemediation':
      return t['whyThis.activeRemediation'];
    case 'prerequisiteGap':
      return t['whyThis.prerequisiteGap'].replace('{count}', String(fact.blockedConceptCount ?? 0));
    case 'diagnosisRequired':
      return t['whyThis.diagnosisRequired'];
    case 'recurringMisconception':
      return t['whyThis.recurringMisconception'].replace('{count}', String(fact.occurrenceCount ?? 0));
    default:
      return '';
  }
}

export default function WhyThis({ facts, t }: { facts: WhyThisFact[]; t: ReturnType<typeof getMessages> }) {
  if (facts.length === 0) return null;
  const sentence = facts.map((f) => factSentence(f, t)).join(' ');

  return (
    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
      <span style={{ fontWeight: 650, color: 'var(--text-secondary)' }}>{t['whyThis.label']}</span> {sentence}
    </div>
  );
}

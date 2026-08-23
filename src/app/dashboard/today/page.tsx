import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getTodayPlan, buildBestNextAction, TodayItem, UrgencyTier } from '@/services/today-plan.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import WhyThis from '../WhyThis';

const TIER_COLOR: Record<UrgencyTier, { accent: string; subtle: string; ink: string }> = {
  critical: { accent: 'var(--error)', subtle: 'var(--error-subtle)', ink: 'var(--error)' },
  this_week: { accent: 'var(--warning)', subtle: 'var(--warning-subtle)', ink: 'var(--warning)' },
  can_wait: { accent: 'var(--text-muted)', subtle: 'var(--bg-subtle)', ink: 'var(--text-muted)' },
};

function reasonBadge(item: TodayItem, tier: UrgencyTier, t: ReturnType<typeof getMessages>) {
  const colors = TIER_COLOR[tier];
  const badgeStyle = {
    width: 52, height: 52, borderRadius: 'var(--radius-md)', flexShrink: 0,
    background: colors.subtle, color: colors.ink,
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center',
    lineHeight: 1,
  };

  if (item.reason === 'exam_soon' && item.examDate) {
    const d = new Date(item.examDate + 'T00:00:00');
    const day = d.getDate();
    const month = d.toLocaleDateString(undefined, { month: 'short' }).replace('.', '');
    return (
      <div style={badgeStyle}>
        <span className="tabular" style={{ fontSize: 20, fontWeight: 700 }}>{day}</span>
        <span style={{ fontSize: 10, fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{month}</span>
      </div>
    );
  }
  if (item.reason === 'learning_debt' && item.debtSince) {
    const daysSince = Math.max(0, Math.floor((Date.now() - new Date(item.debtSince).getTime()) / 86400000));
    return (
      <div style={badgeStyle}>
        <span className="tabular" style={{ fontSize: 20, fontWeight: 700 }}>{daysSince}</span>
        <span style={{ fontSize: 9.5, fontWeight: 650, textTransform: 'uppercase' }}>{t['common.days']}</span>
      </div>
    );
  }
  if (item.reason === 'forgetting_risk' && item.daysSincePractice !== undefined) {
    return (
      <div style={badgeStyle}>
        <span className="tabular" style={{ fontSize: 20, fontWeight: 700 }}>{item.daysSincePractice}</span>
        <span style={{ fontSize: 9.5, fontWeight: 650, textTransform: 'uppercase' }}>{t['common.days']}</span>
      </div>
    );
  }
  if (item.reason === 'independence_gap' && item.unassistedAccuracy !== undefined) {
    return (
      <div style={badgeStyle}>
        <span className="tabular" style={{ fontSize: 18, fontWeight: 700 }}>{item.unassistedAccuracy}%</span>
        <span style={{ fontSize: 8.5, fontWeight: 650, textTransform: 'uppercase' }}>{t['today.unassistedAccuracy']}</span>
      </div>
    );
  }
  if (item.reason === 'active_remediation') {
    return (
      <div style={badgeStyle}>
        <span style={{ fontSize: 22 }} aria-hidden>🔧</span>
      </div>
    );
  }
  if (item.reason === 'prerequisite_gap') {
    return (
      <div style={badgeStyle}>
        <span className="tabular" style={{ fontSize: 20, fontWeight: 700 }}>{item.blockedConceptCount ?? 0}</span>
        <span style={{ fontSize: 8.5, fontWeight: 650, textTransform: 'uppercase' }}>{t['today.badgeAffects']}</span>
      </div>
    );
  }
  if (item.reason === 'diagnosis_required') {
    return (
      <div style={badgeStyle}>
        <span style={{ fontSize: 24, fontWeight: 700 }}>?</span>
      </div>
    );
  }
  if (item.reason === 'recurring_misconception') {
    return (
      <div style={badgeStyle}>
        <span className="tabular" style={{ fontSize: 20, fontWeight: 700 }}>×{item.occurrenceCount ?? 0}</span>
      </div>
    );
  }
  return (
    <div style={badgeStyle}>
      <span className="tabular" style={{ fontSize: 16, fontWeight: 700 }}>{Math.round(item.masteryScore)}%</span>
    </div>
  );
}

function detailLine(item: TodayItem, t: ReturnType<typeof getMessages>) {
  if (item.reason === 'exam_soon') {
    const suffix =
      item.daysUntilExam === 0 ? t['today.todayWord']
      : item.daysUntilExam === 1 ? t['today.tomorrowWord']
      : `${item.daysUntilExam} ${t['today.daysUntilExam']}`;
    const dateFormatted = item.examDate
      ? new Date(item.examDate + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
      : '';
    return `${item.subjectName} · ${t['today.examLabel']}: ${dateFormatted} (${suffix})`;
  }
  if (item.reason === 'learning_debt') {
    const dateFormatted = item.debtSince
      ? new Date(item.debtSince).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
      : '';
    return `${item.subjectName} · ${t['today.debtSinceLabel']} ${dateFormatted} · ${t['today.severity']} ${item.debtSeverity}/5`;
  }
  if (item.reason === 'forgetting_risk') {
    return `${item.subjectName} · ${t['today.lastPracticedLabel']} ${item.daysSincePractice} ${t['common.days']} · ${item.forgettingRisk}% ${t['today.forgettingRisk']}`;
  }
  if (item.reason === 'independence_gap') {
    return `${item.subjectName} · ${t['today.reasonIndependenceGap']}`;
  }
  if (item.reason === 'active_remediation') {
    return `${item.subjectName} · ${t['today.reasonActiveRemediation']}`;
  }
  if (item.reason === 'prerequisite_gap') {
    return `${item.subjectName} · ${t['today.reasonPrerequisiteGap'].replace('{count}', String(item.blockedConceptCount ?? 0))}`;
  }
  if (item.reason === 'diagnosis_required') {
    return `${item.subjectName} · ${t['today.reasonDiagnosisRequired']}`;
  }
  if (item.reason === 'recurring_misconception') {
    return `${item.subjectName} · ${t['today.reasonRecurringMisconception'].replace('{count}', String(item.occurrenceCount ?? 0))}`;
  }
  return `${item.subjectName} · ${t['today.mastery']}: ${Math.round(item.masteryScore)}%`;
}

function ItemRow({ item, tier, t }: { item: TodayItem; tier: UrgencyTier; t: ReturnType<typeof getMessages> }) {
  const colors = TIER_COLOR[tier];
  return (
    <div
      className="card"
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
        padding: tier === 'can_wait' ? 'var(--space-3) var(--space-4)' : 'var(--space-4)',
        borderLeft: `3px solid ${colors.accent}`,
      }}
    >
      {reasonBadge(item, tier, t)}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: tier === 'can_wait' ? 14 : 15 }}>{item.label}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{detailLine(item, t)}</div>
      </div>
      <Link
        href={`/dashboard/quiz?subjectId=${item.subjectId}&conceptId=${item.conceptId}`}
        className={tier === 'can_wait' ? 'btn btn-ghost' : 'btn btn-secondary'}
        style={{ height: tier === 'can_wait' ? 30 : 34, fontSize: 13, flexShrink: 0 }}
      >
        {t['today.practice']}
      </Link>
    </div>
  );
}

function Section({
  tier, title, subtitle, items, t,
}: {
  tier: UrgencyTier; title: string; subtitle: string; items: TodayItem[]; t: ReturnType<typeof getMessages>;
}) {
  if (items.length === 0) return null;
  const colors = TIER_COLOR[tier];
  return (
    <div style={{ marginBottom: 'var(--space-8)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', marginBottom: 2 }}>
        <h2 style={{ margin: 0, fontSize: tier === 'can_wait' ? 16 : 18 }}>{title}</h2>
        <span
          className="tabular"
          style={{
            fontSize: 12, fontWeight: 650, color: colors.ink, background: colors.subtle,
            borderRadius: 'var(--radius-full)', padding: '2px 9px',
          }}
        >
          {items.length}
        </span>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 var(--space-3)' }}>{subtitle}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: tier === 'can_wait' ? 'var(--space-2)' : 'var(--space-3)' }}>
        {items.map((item) => (
          <ItemRow key={item.conceptId} item={item} tier={tier} t={t} />
        ))}
      </div>
    </div>
  );
}

export default async function TodayPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return (
      <div>
        <h1>Not authenticated</h1>
        <Link href="/sign-in">Sign in</Link>
      </div>
    );
  }

  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId);
  const t = getMessages(locale);

  const { critical, thisWeek, canWait, totalConcepts } = await getTodayPlan(studentId, locale).catch(() => ({
    critical: [] as TodayItem[],
    thisWeek: [] as TodayItem[],
    canWait: [] as TodayItem[],
    totalConcepts: 0,
  }));

  const todayFormatted = new Date().toLocaleDateString(locale, {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const totalPending = critical.length + thisWeek.length + canWait.length;
  const bestNextAction = buildBestNextAction(critical, thisWeek, canWait);

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <p className="label" style={{ color: 'var(--text-muted)', margin: '0 0 4px', textTransform: 'capitalize' }}>
          {todayFormatted}
        </p>
        <h1>{t['today.title']}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15, maxWidth: '58ch' }}>
          {t['today.subtitle']}
        </p>
      </div>

      {bestNextAction && (
        <div
          className="card"
          style={{
            marginBottom: 'var(--space-8)', borderColor: 'var(--brand)', borderWidth: 2,
            display: 'flex', alignItems: 'center', gap: 'var(--space-5)',
          }}
        >
          <div
            aria-hidden
            style={{
              flexShrink: 0, width: 44, height: 44, borderRadius: '50%', background: 'var(--brand)',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
            }}
          >
            ★
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="label" style={{ color: 'var(--brand-ink)', marginBottom: 4 }}>{t['bestNextAction.title']}</div>
            <div style={{ fontSize: 17, fontWeight: 650 }}>{bestNextAction.item.label}</div>
            <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 2 }}>
              {bestNextAction.item.subjectName} · {t['bestNextAction.minutes'].replace('{min}', String(bestNextAction.estimatedMinutes))}
            </div>
            <WhyThis facts={bestNextAction.facts} t={t} />
          </div>
          <Link
            href={`/dashboard/quiz?subjectId=${bestNextAction.item.subjectId}&conceptId=${bestNextAction.item.conceptId}`}
            className="btn btn-primary"
            style={{ flexShrink: 0 }}
          >
            {t['bestNextAction.start']}
          </Link>
        </div>
      )}

      {totalPending > 0 && (
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-8)', flexWrap: 'wrap' }}>
          {(['critical', 'this_week', 'can_wait'] as UrgencyTier[]).map((tier) => {
            const count = tier === 'critical' ? critical.length : tier === 'this_week' ? thisWeek.length : canWait.length;
            if (count === 0) return null;
            const colors = TIER_COLOR[tier];
            const label = tier === 'critical' ? t['today.sectionCritical'] : tier === 'this_week' ? t['today.sectionThisWeek'] : t['today.sectionCanWait'];
            return (
              <div
                key={tier}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
                  borderRadius: 'var(--radius-md)', background: colors.subtle,
                }}
              >
                <span className="tabular" style={{ fontSize: 18, fontWeight: 700, color: colors.ink }}>{count}</span>
                <span style={{ fontSize: 12.5, color: colors.ink, fontWeight: 600 }}>{label}</span>
              </div>
            );
          })}
        </div>
      )}

      {totalPending === 0 ? (
        <div className="card empty-state">
          <strong>{t['today.empty']}</strong>
          {t['today.emptyBody']}
        </div>
      ) : (
        <>
          <Section tier="critical" title={t['today.sectionCritical']} subtitle={t['today.criticalSubtitle']} items={critical} t={t} />
          <Section tier="this_week" title={t['today.sectionThisWeek']} subtitle={t['today.thisWeekSubtitle']} items={thisWeek} t={t} />
          <Section tier="can_wait" title={t['today.sectionCanWait']} subtitle={t['today.canWaitSubtitle']} items={canWait} t={t} />
        </>
      )}

      {totalConcepts > 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 12.5, marginTop: 'var(--space-4)' }}>
          {totalConcepts} {t['today.trackedCount']}
        </p>
      )}
    </div>
  );
}

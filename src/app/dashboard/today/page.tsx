import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getTodayPlan, TodayItem } from '@/services/today-plan.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';

function reasonDot(reason: TodayItem['reason']) {
  if (reason === 'exam_soon') return 'var(--error)';
  if (reason === 'learning_debt') return 'var(--warning)';
  return 'var(--text-muted)';
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

  const { items, totalConcepts } = await getTodayPlan(studentId, locale).catch(() => ({
    items: [] as TodayItem[],
    totalConcepts: 0,
  }));

  const reasonLabel = (reason: TodayItem['reason']) =>
    reason === 'exam_soon'
      ? t['today.reasonExamSoon']
      : reason === 'learning_debt'
      ? t['today.reasonDebt']
      : t['today.reasonLowMastery'];

  const reasonDetail = (item: TodayItem) => {
    if (item.reason === 'exam_soon') return `${item.daysUntilExam} ${t['today.daysUntilExam']}`;
    if (item.reason === 'learning_debt') return `${t['today.severity']} ${item.debtSeverity}`;
    return `${Math.round(item.masteryScore)}% ${t['today.mastery']}`;
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-6)', marginBottom: 'var(--space-8)' }}>
        <div>
          <h1>{t['today.title']}</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15, maxWidth: '58ch' }}>
            {t['today.subtitle']}
          </p>
        </div>
        {totalConcepts > 0 && (
          <span style={{ color: 'var(--text-muted)', fontSize: 13, whiteSpace: 'nowrap' }}>
            {totalConcepts} {t['today.trackedCount']}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="card empty-state">
          <strong>{t['today.empty']}</strong>
          {t['today.emptyBody']}
        </div>
      ) : (
        <div className="card list-card">
          {items.map((item) => (
            <div key={item.conceptId} className="list-row">
              <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: reasonDot(item.reason) }} />
              <div className="row-main">
                <div className="row-title">{item.label}</div>
                <div className="row-sub">
                  {item.subjectName} · {reasonLabel(item.reason)} · {reasonDetail(item)}
                </div>
              </div>
              <Link
                href={`/dashboard/quiz?subjectId=${item.subjectId}&conceptId=${item.conceptId}`}
                className="btn btn-secondary"
                style={{ height: 32, fontSize: 13 }}
              >
                {t['today.practice']}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

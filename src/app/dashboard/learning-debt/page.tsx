import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getActiveDebts } from '@/services/learning-debt.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';

export default async function LearningDebtPage() {
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
  const debts = await getActiveDebts(studentId, undefined, locale).catch(() => []);

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1>{t['debt.title']}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>
          {t['debt.subtitle']}
        </p>
      </div>

      {debts.length === 0 ? (
        <div className="card empty-state">
          <strong>{t['debt.allCaughtUpTitle']}</strong>
          {t['debt.allCaughtUpBody']}
        </div>
      ) : (
        <div className="card list-card">
          {debts.map((d: any) => (
            <div key={d.id} className="list-row">
              <span
                style={{
                  width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                  background: d.severity >= 3 ? 'var(--error)' : 'var(--warning)',
                }}
              />
              <div className="row-main">
                <div className="row-title">{d.concept?.label || d.concept?.canonicalId}</div>
                <div className="row-sub">
                  {t['debt.currentMastery']}: {Math.round(d.mastery ?? 0)}% · {t['debt.severity']} {d.severity}
                </div>
              </div>
              <Link href={`/dashboard/quiz?subjectId=${d.subjectId}&conceptId=${d.conceptId}`} className="btn btn-secondary" style={{ height: 32, fontSize: 13 }}>
                {t['debt.review']}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

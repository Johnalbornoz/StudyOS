import { currentUser } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { isAdminEmail, getStudentById } from '@/services/admin.service';
import { getChildOverview } from '@/services/parent.service';

function masteryFillClass(score: number) {
  if (score >= 75) return 'fill-good';
  if (score >= 50) return 'fill-warn';
  return 'fill-critical';
}

export default async function AdminStudentDetailPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress;
  if (!isAdminEmail(email)) {
    redirect('/dashboard');
  }

  const adminStudentId = await getOrCreateStudentId(user!.id);
  const locale = await getInterfaceLanguage(adminStudentId);
  const t = getMessages(locale);

  const student = await getStudentById(studentId);
  if (!student) notFound();

  const overview = await getChildOverview(studentId, locale).catch(() => null);

  return (
    <div>
      <Link href="/dashboard/admin" style={{ fontSize: 13, color: 'var(--text-muted)' }}>← {t['admin.backToList']}</Link>

      <div style={{ margin: 'var(--space-4) 0 var(--space-8)' }}>
        <h1>{student.name || student.email}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>{student.email}</p>
      </div>

      {overview && (
        <>
          <div style={{ display: 'flex', gap: 'var(--space-6)', marginBottom: 'var(--space-8)', flexWrap: 'wrap' }}>
            <div className="card" style={{ flex: '1 1 200px' }}>
              <div className="label" style={{ color: 'var(--text-muted)' }}>{t['admin.detailActiveDebt']}</div>
              <div className="tabular" style={{ fontSize: 28, fontWeight: 650, marginTop: 6 }}>{overview.totalActiveDebt}</div>
            </div>
            <div className="card" style={{ flex: '1 1 200px' }}>
              <div className="label" style={{ color: 'var(--text-muted)' }}>{t['admin.detailUpcomingExam']}</div>
              {overview.upcomingExams.length > 0 ? (
                <div style={{ fontSize: 14, marginTop: 6 }}>
                  {overview.upcomingExams.slice(0, 1).map((e) => (
                    <span key={e.subjectId}>
                      {e.subjectName} — {e.scheduledDate} ({e.daysUntil}d)
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 6 }}>{t['admin.detailNoUpcomingExam']}</div>
              )}
            </div>
          </div>

          <h2 style={{ marginBottom: 'var(--space-4)' }}>{t['admin.detailSubjects']}</h2>
          <div className="card list-card">
            {overview.subjects.map((s) => (
              <div key={s.subjectId} className="list-row">
                <div className="row-main">
                  <div className="row-title">{s.name}</div>
                </div>
                <div className="mastery-row" style={{ flex: '0 0 160px' }}>
                  <div className="mastery-bar">
                    <span className={masteryFillClass(s.avgMastery ?? 0)} style={{ width: `${s.avgMastery ?? 0}%` }} />
                  </div>
                  <span className="mastery-pct tabular">{s.avgMastery !== null ? `${s.avgMastery}%` : '—'}</span>
                </div>
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)', flexShrink: 0, width: 90, textAlign: 'right' }}>
                  {s.conceptCount} {t['admin.detailConcepts']}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

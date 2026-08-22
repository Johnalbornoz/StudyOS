import { currentUser } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { isAdminEmail, getStudentById } from '@/services/admin.service';
import { getChildOverview } from '@/services/parent.service';
import { getSubscriptionStatus } from '@/services/payment.service';
import AdminSubjectRow from './AdminSubjectRow';
import PaymentStatusEditor from './PaymentStatusEditor';

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
  const subscription = await getSubscriptionStatus(studentId);

  return (
    <div>
      <Link href="/dashboard/admin" style={{ fontSize: 13, color: 'var(--text-muted)' }}>← {t['admin.backToList']}</Link>

      <div style={{ margin: 'var(--space-4) 0 var(--space-8)' }}>
        <h1>{student.name || student.email}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>{student.email}</p>
      </div>

      <div className="card" style={{ marginBottom: 'var(--space-8)' }}>
        <div className="label" style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>{t['admin.paymentSection']}</div>
        <PaymentStatusEditor
          studentId={studentId}
          currentStatus={subscription.status}
          statusLabels={{
            unpaid: t['payment.status.unpaid'],
            active: t['payment.status.active'],
            past_due: t['payment.status.past_due'],
            canceled: t['payment.status.canceled'],
          }}
          saveLabel={t['admin.paymentSave']}
        />
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
              <AdminSubjectRow
                key={s.subjectId}
                subjectId={s.subjectId}
                name={s.name}
                avgMastery={s.avgMastery}
                conceptCount={s.conceptCount}
                confirmLabel={t['admin.deleteSubjectConfirm'].replace('{name}', s.name)}
                deleteLabel={t['common.delete']}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

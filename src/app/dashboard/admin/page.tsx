import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { isAdminEmail, getAllStudents } from '@/services/admin.service';

export default async function AdminPage() {
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress;
  if (!isAdminEmail(email)) {
    redirect('/dashboard');
  }

  const studentId = await getOrCreateStudentId(user!.id);
  const locale = await getInterfaceLanguage(studentId);
  const t = getMessages(locale);

  const students = await getAllStudents();

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1>{t['admin.title']}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>{t['admin.subtitle']}</p>
      </div>

      {students.length === 0 ? (
        <div className="card empty-state">{t['admin.noStudents']}</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                  {[t['admin.colStudent'], t['admin.colEmail'], t['admin.colRegistered'], t['admin.colSubjects'], t['admin.colConcepts'], ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: 'var(--space-3) var(--space-4)', color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border-default)' }}>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600 }}>{s.name || '—'}</td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--text-secondary)' }}>{s.email}</td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--text-muted)' }}>
                      {new Date(s.createdAt).toLocaleDateString(locale)}
                    </td>
                    <td className="tabular" style={{ padding: 'var(--space-3) var(--space-4)' }}>{s.subjectCount}</td>
                    <td className="tabular" style={{ padding: 'var(--space-3) var(--space-4)' }}>{s.conceptCount}</td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right' }}>
                      <Link href={`/dashboard/admin/${s.id}`} className="btn btn-ghost" style={{ fontSize: 13 }}>
                        {t['admin.viewDetail']}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

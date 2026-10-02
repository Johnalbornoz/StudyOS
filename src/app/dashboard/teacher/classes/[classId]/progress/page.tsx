import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getTeacherClass } from '@/lib/teacher/class-assignment.service';
import { getClassLearnerMatrix, MATRIX_BUCKETS } from '@/lib/learning-plan/class-plan.service';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { ClassChrome } from '../class-chrome';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Track A -- class learner matrix: concept × phase, each cell the learners
 * there (expand to see who; each name opens the learner view). Read-only
 * projection of the canonical decision for ACTIVE learners of the class.
 */
export default async function TeacherClassProgressPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  if (!UUID_RE.test(classId)) notFound();
  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const klass = await getTeacherClass(actor.id, classId);
  if (!klass) notFound();
  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);
  if (!klass.subjectId) {
    return (
      <div className="ta-stack">
        <ClassChrome klass={klass} active="progress" t={t} />
        <InlineAlert tone="info" title={t['tc.noSubject.title']} body={t['tcp.plan.noSubject']} />
      </div>
    );
  }
  const matrix = await getClassLearnerMatrix(actor.id, classId, locale);
  const bucketLabel = (b: string) => (b === 'NOT_STARTED' ? t['lp.phase.NOT_STARTED'] : t[`conceptMission.stage.${b}` as MessageKey]);

  return (
    <div className="ta-stack">
      <ClassChrome klass={klass} active="progress" t={t} />
      <h2 style={{ fontSize: 18 }}>{t['tcp.matrix.title']}</h2>
      <p className="ta-msg">{t['tcp.matrix.subtitle']}</p>
      {matrix.rows.length === 0 ? (
        <EmptyState title={t['tcp.matrix.empty']} />
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="ta-matrix">
            <thead>
              <tr>
                <th scope="col">{t['tcp.matrix.concept']}</th>
                {MATRIX_BUCKETS.map((b) => (
                  <th key={b} scope="col">
                    {bucketLabel(b)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.canonicalConceptId}>
                  <th scope="row">{row.label}</th>
                  {MATRIX_BUCKETS.map((b) => {
                    const students = row.cells[b];
                    return (
                      <td key={b} data-bucket={b}>
                        {students.length === 0 ? (
                          <span className="ta-msg">0</span>
                        ) : (
                          <details>
                            <summary aria-label={`${row.label} · ${bucketLabel(b)} · ${fillMessage(t['tcp.matrix.students'], { n: students.length })}`}>{students.length}</summary>
                            <ul className="role-list ta-compact">
                              {students.map((s) => (
                                <li key={s.studentId}>
                                  <Link href={`/dashboard/teacher/classes/${classId}/students/${s.studentId}`}>{s.name}</Link>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

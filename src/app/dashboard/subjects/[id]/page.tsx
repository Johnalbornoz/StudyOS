import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { query } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import { getStudentMastery } from '@/services/mastery.service';
import UploadPanel from './UploadPanel';

function masteryFillClass(score: number) {
  if (score >= 75) return 'fill-good';
  if (score >= 50) return 'fill-warn';
  return 'fill-critical';
}

export default async function SubjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return (
      <div>
        <h1>No autenticado</h1>
        <Link href="/sign-in">Iniciar sesión</Link>
      </div>
    );
  }

  const studentId = await getOrCreateStudentId(clerkUserId);

  const subjectResult = await query(
    `SELECT * FROM subjects WHERE id = $1 AND student_id = $2`,
    [id, studentId]
  );
  const subject = subjectResult.rows[0];
  if (!subject) notFound();

  const concepts = await getStudentMastery(studentId, id, 'es').catch(() => []);
  const avgMastery = concepts.length
    ? Math.round(concepts.reduce((sum: number, c: any) => sum + Number(c.mastery_score), 0) / concepts.length)
    : null;
  const weakest = [...concepts].sort((a: any, b: any) => a.mastery_score - b.mastery_score)[0];

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', gap: 6 }}>
        <Link href="/dashboard" style={{ color: 'var(--text-muted)' }}>Panel</Link> / {subject.name}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-6)', marginBottom: 'var(--space-8)' }}>
        <div>
          <h1>{subject.name}</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>
            {concepts.length} conceptos{avgMastery !== null ? ` · dominio promedio ${avgMastery}%` : ''}
          </p>
        </div>
        {weakest && (
          <Link href={`/dashboard/quiz?subjectId=${id}&conceptId=${weakest.concept_id}`} className="btn btn-primary">
            Practicar concepto débil
          </Link>
        )}
      </div>

      {concepts.length === 0 ? (
        <div className="card empty-state">
          <strong>Aún no hay conceptos aquí</strong>
          Sube material de estudio abajo para que la IA extraiga los conceptos automáticamente.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {concepts.map((c: any) => (
            <div key={c.concept_id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-4)' }}>
              <span style={{ flex: '0 0 190px', fontWeight: 600, fontSize: 14 }}>{c.label || c.canonical_id}</span>
              <div className="mastery-row" style={{ flex: 1 }}>
                <div className="mastery-bar">
                  <span className={masteryFillClass(c.mastery_score)} style={{ width: `${c.mastery_score}%` }} />
                </div>
                <span className="mastery-pct tabular">{Math.round(c.mastery_score)}%</span>
              </div>
              <Link href={`/dashboard/quiz?subjectId=${id}&conceptId=${c.concept_id}`} className="btn btn-ghost">
                Practicar
              </Link>
            </div>
          ))}
        </div>
      )}

      <UploadPanel subjectId={id} subjectName={subject.name} />
    </div>
  );
}

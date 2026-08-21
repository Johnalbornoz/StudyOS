import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getActiveDebts } from '@/services/learning-debt.service';

export default async function LearningDebtPage() {
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
  const debts = await getActiveDebts(studentId).catch(() => []);

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1>Repaso pendiente</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>
          Conceptos con riesgo de olvido, ordenados por severidad.
        </p>
      </div>

      {debts.length === 0 ? (
        <div className="card empty-state">
          <strong>Todo al día</strong>
          No tienes conceptos pendientes de repaso ahora mismo.
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
                  Dominio actual: {Math.round(d.mastery ?? 0)}% · severidad {d.severity}
                </div>
              </div>
              <Link href={`/dashboard/quiz?subjectId=${d.subjectId}&conceptId=${d.conceptId}`} className="btn btn-secondary" style={{ height: 32, fontSize: 13 }}>
                Repasar
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

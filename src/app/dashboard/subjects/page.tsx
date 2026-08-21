import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { query } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';

export default async function SubjectsPage() {
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
  const result = await query(
    `SELECT * FROM subjects WHERE student_id = $1 ORDER BY created_at DESC`,
    [studentId]
  );
  const subjects = result.rows;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 'var(--space-8)' }}>
        <div>
          <h1>Materias</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>Todas tus materias activas.</p>
        </div>
        <Link href="/dashboard/subjects/new" className="btn btn-primary">+ Crear materia</Link>
      </div>

      {subjects.length === 0 ? (
        <div className="card empty-state">
          <strong>Aún no tienes materias</strong>
          Crea tu primera materia para empezar.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 'var(--space-4)' }}>
          {subjects.map((s: any) => (
            <Link key={s.id} href={`/dashboard/subjects/${s.id}`} className="card" style={{ display: 'block' }}>
              <h3>{s.name}</h3>
              <span className="chip chip-good" style={{ marginTop: 10 }}>{s.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

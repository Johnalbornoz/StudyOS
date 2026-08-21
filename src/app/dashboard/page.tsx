import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { query } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import { getActiveDebts } from '@/services/learning-debt.service';
import { getUnreadNotifications } from '@/services/notifications.service';
import { getStudentMastery } from '@/services/mastery.service';

function masteryFillClass(score: number) {
  if (score >= 75) return 'fill-good';
  if (score >= 50) return 'fill-warn';
  return 'fill-critical';
}

function subjectChip(avgMastery: number | null, pendingCount: number) {
  if (avgMastery === null) return { cls: 'chip-warn', label: 'Sin datos aún' };
  if (pendingCount > 0) return { cls: 'chip-warn', label: `${pendingCount} pendientes` };
  if (avgMastery >= 75) return { cls: 'chip-good', label: 'Al día' };
  return { cls: 'chip-critical', label: 'Atrasada' };
}

export default async function DashboardPage() {
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

  const [subjectsResult, debts, notifications] = await Promise.all([
    query(`SELECT * FROM subjects WHERE student_id = $1 ORDER BY created_at DESC`, [studentId]),
    getActiveDebts(studentId).catch(() => []),
    getUnreadNotifications(studentId).catch(() => []),
  ]);
  const subjects = subjectsResult.rows;

  const subjectsWithMastery = await Promise.all(
    subjects.map(async (s: any) => {
      const records = await getStudentMastery(studentId, s.id, 'es').catch(() => []);
      const avg = records.length
        ? Math.round(records.reduce((sum: number, r: any) => sum + Number(r.mastery_score), 0) / records.length)
        : null;
      const pending = debts.filter((d: any) => d.subjectId === s.id).length;
      return { ...s, avgMastery: avg, conceptCount: records.length, pending };
    })
  );

  const allScores = subjectsWithMastery.flatMap((s) => (s.avgMastery !== null ? [s.avgMastery] : []));
  const overallAvg = allScores.length ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : null;

  return (
    <div>
      <div className="view-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-6)', marginBottom: 'var(--space-8)' }}>
        <div>
          <p className="label" style={{ color: 'var(--text-muted)', margin: '0 0 4px' }}>Tu panel</p>
          <h1>Hola de nuevo</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>Esto es lo que necesita tu atención hoy.</p>
        </div>
        <Link href="/dashboard/subjects/new" className="btn btn-primary">+ Crear materia</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <div className="label" style={{ color: 'var(--text-muted)' }}>Conceptos en riesgo</div>
          <div className="tabular" style={{ fontSize: 28, fontWeight: 650, lineHeight: 1 }}>{debts.length}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>requieren repaso</div>
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <div className="label" style={{ color: 'var(--text-muted)' }}>Dominio promedio</div>
          <div className="tabular" style={{ fontSize: 28, fontWeight: 650, lineHeight: 1 }}>
            {overallAvg !== null ? `${overallAvg}%` : '—'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            {overallAvg !== null ? 'en todas tus materias' : 'sube contenido para empezar'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '8px 0 12px' }}>
        <h2>Tus materias</h2>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{subjects.length} activas</span>
      </div>

      {subjects.length === 0 ? (
        <div className="card empty-state">
          <strong>Aún no tienes materias</strong>
          Crea tu primera materia para empezar a subir contenido y practicar.
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Link href="/dashboard/subjects/new" className="btn btn-primary">Crear materia</Link>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
          {subjectsWithMastery.map((s) => {
            const chip = subjectChip(s.avgMastery, s.pending);
            return (
              <Link key={s.id} href={`/dashboard/subjects/${s.id}`} className="card" style={{ cursor: 'pointer', display: 'block' }}>
                <h3 style={{ marginBottom: 10 }}>{s.name}</h3>
                <div className="mastery-row" style={{ marginTop: 6 }}>
                  <div className="mastery-bar">
                    <span className={masteryFillClass(s.avgMastery ?? 0)} style={{ width: `${s.avgMastery ?? 0}%` }} />
                  </div>
                  <span className="mastery-pct tabular">{s.avgMastery !== null ? `${s.avgMastery}%` : '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                  <span className={`chip ${chip.cls}`}>{chip.label}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{s.conceptCount} conceptos</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 'var(--space-6)', alignItems: 'start' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '8px 0 12px' }}>
            <h2>Repaso pendiente</h2>
            <Link href="/dashboard/learning-debt" className="btn btn-ghost">Ver todo</Link>
          </div>
          <div className="card list-card">
            {debts.length === 0 ? (
              <div className="empty-state">Sin conceptos pendientes de repaso.</div>
            ) : (
              debts.slice(0, 3).map((d: any) => (
                <div key={d.id} className="list-row">
                  <span
                    style={{
                      width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                      background: d.severity >= 3 ? 'var(--error)' : 'var(--warning)',
                    }}
                  />
                  <div className="row-main">
                    <div className="row-title">{d.concept?.label || d.concept?.canonicalId}</div>
                    <div className="row-sub">Dominio actual: {Math.round(d.mastery ?? 0)}%</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '8px 0 12px' }}>
            <h2>Notificaciones</h2>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{notifications.length} nuevas</span>
          </div>
          <div className="card list-card">
            {notifications.length === 0 ? (
              <div className="empty-state">No hay notificaciones nuevas.</div>
            ) : (
              notifications.slice(0, 4).map((n: any) => (
                <div key={n.id} className="list-row">
                  <div className="row-main">
                    <div className="row-title">{n.title}</div>
                    <div className="row-sub">{n.message}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

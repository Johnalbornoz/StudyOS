import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getUnreadNotifications } from '@/services/notifications.service';

export default async function NotificationsPage() {
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
  const notifications = await getUnreadNotifications(studentId).catch(() => []);

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1>Notificaciones</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>
          Actividad reciente de tu aprendizaje.
        </p>
      </div>

      {notifications.length === 0 ? (
        <div className="card empty-state">
          <strong>Sin notificaciones nuevas</strong>
          Aquí verás avisos sobre repasos pendientes y progreso reciente.
        </div>
      ) : (
        <div className="card list-card">
          {notifications.map((n: any) => (
            <div key={n.id} className="list-row">
              <div className="row-main">
                <div className="row-title">{n.title}</div>
                <div className="row-sub">{n.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

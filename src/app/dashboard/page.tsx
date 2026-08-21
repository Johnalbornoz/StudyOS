import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { query } from '@/lib/db';

export default async function DashboardPage() {
  const { userId } = await auth();

  if (!userId) {
    return (
      <div style={{ padding: '2rem' }}>
        <h1>Not authenticated</h1>
        <Link href="/sign-in">Sign in</Link>
      </div>
    );
  }

  // Get student subjects
  const result = await query(
    `SELECT * FROM subjects WHERE student_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  const subjects = result.rows;

  return (
    <div style={{ padding: '2rem' }}>
      <h1>StudyOS Dashboard</h1>
      <p>Welcome back!</p>

      <h2>Your Subjects</h2>
      {subjects.length === 0 ? (
        <p>No subjects yet. <Link href="/dashboard/subjects/new">Create one</Link></p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {subjects.map((subject: any) => (
            <li key={subject.id} style={{ marginBottom: '1rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '4px' }}>
              <h3>{subject.name}</h3>
              <p>Status: {subject.status}</p>
              <Link href={`/dashboard/subjects/${subject.id}`}>View</Link>
            </li>
          ))}
        </ul>
      )}

      <hr />
      <Link href="/dashboard/subjects/new">➕ Create Subject</Link>
    </div>
  );
}

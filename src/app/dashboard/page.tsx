import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';

export default async function DashboardPage() {
  const { userId } = await auth();

  if (!userId) {
    return (
      <div>
        <h1>Not authenticated</h1>
        <Link href="/sign-in">Sign in</Link>
      </div>
    );
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome, {userId}</p>
      <Link href="/dashboard/subjects">Subjects</Link>
    </div>
  );
}

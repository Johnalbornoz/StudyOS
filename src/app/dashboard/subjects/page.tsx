import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';

export default async function SubjectsPage() {
  const { userId } = await auth();

  return (
    <div>
      <h1>Subjects</h1>
      <p>Your subjects will appear here</p>
      <Link href="/dashboard">Back</Link>
    </div>
  );
}

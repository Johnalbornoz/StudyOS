import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getMessages } from '@/lib/i18n/messages';

export default async function Home() {
  const { userId } = await auth();
  if (userId) {
    redirect('/dashboard');
  }

  const t = getMessages('es');

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-6)',
        textAlign: 'center',
        padding: 'var(--space-6)',
      }}
    >
      <div>
        <h1>StudyOS</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>
          {t['home.tagline']}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <Link href="/sign-in" className="btn btn-secondary">{t['home.signIn']}</Link>
        <Link href="/sign-up" className="btn btn-primary">{t['home.signUp']}</Link>
      </div>
    </main>
  );
}

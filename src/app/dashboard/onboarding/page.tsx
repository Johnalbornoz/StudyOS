import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { query } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { onboardingRouteRedirect } from '@/lib/lx/first-destination';

/**
 * LX-2D -- first-time onboarding. A short, progressive introduction --
 * NOT a product tour. It explains what StudyUS does, the one thing it
 * needs (a subject), and what happens after setup, then hands off to
 * the existing subject-creation flow.
 *
 * Migration-safe: a learner who already has a subject is bounced to
 * Today, so this route never traps an existing user and never resets
 * anyone. It also cannot loop (Today does not redirect back here).
 */
export default async function OnboardingPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return (
      <div>
        <h1>Not authenticated</h1>
        <Link href="/sign-in">Sign in</Link>
      </div>
    );
  }

  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId);
  const t = getMessages(locale);

  const subjectRes = await query(`SELECT 1 FROM subjects WHERE student_id = $1 LIMIT 1`, [studentId]).catch(() => ({ rows: [] as unknown[] }));
  const bounce = onboardingRouteRedirect({ hasSubject: subjectRes.rows.length > 0 });
  if (bounce) redirect(bounce);

  const points = [
    { title: t['onboarding2.whatTitle'], body: t['onboarding2.whatBody'] },
    { title: t['onboarding2.needTitle'], body: t['onboarding2.needBody'] },
    { title: t['onboarding2.nextTitle'], body: t['onboarding2.nextBody'] },
  ];

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1>{t['onboarding2.title']}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15, maxWidth: '58ch' }}>
          {t['onboarding2.intro']}
        </p>
      </div>

      <ol style={{ listStyle: 'none', margin: '0 0 var(--space-8)', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {points.map((p, i) => (
          <li key={i} className="card" style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start', padding: 'var(--space-4) var(--space-5)' }}>
            <span
              aria-hidden
              style={{
                flexShrink: 0, width: 28, height: 28, borderRadius: '50%', background: 'var(--brand-subtle)', color: 'var(--brand-ink)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13,
              }}
            >
              {i + 1}
            </span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 650 }}>{p.title}</div>
              <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{p.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <Link href="/dashboard/subjects/new" className="btn btn-primary">
        {t['onboarding2.cta']}
      </Link>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 'var(--space-3)' }}>
        {t['onboarding2.laterProfile']}
      </p>
    </div>
  );
}

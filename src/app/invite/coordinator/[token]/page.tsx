import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { resolveClerkIdentity } from '@/lib/auth';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { previewCoordinatorInvitation } from '@/services/institution-admin.service';
import { AcceptCoordinatorInvitation } from './AcceptCoordinatorInvitation';

/**
 * Track A -- coordinator invitation landing page. Shows WHICH institution
 * and WHICH email the invitation is for (never ids or the token). A signed-
 * out visitor is sent to sign in / sign up and brought back here; a signed-
 * in visitor accepts with one click (the server checks the email, expiry
 * and single use). No persona is created: the account gets the coordinator
 * capability of that institution and lands in its workspace.
 */
export default async function CoordinatorInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { userId: clerkUserId } = await auth();
  let locale: 'es' | 'en' | 'de' | 'fr' | 'pt' = 'es';
  let signedInEmail: string | null = null;
  if (clerkUserId) {
    const identity = await resolveClerkIdentity(clerkUserId);
    signedInEmail = identity.email;
    const user = await getOrCreateCanonicalUser(clerkUserId, identity.email);
    locale = await getUserInterfaceLanguage(user.id).catch(() => 'es' as const);
  }
  const t = getMessages(locale);
  const preview = token.length >= 20 && token.length <= 200 ? await previewCoordinatorInvitation(token) : null;
  const here = `/invite/coordinator/${encodeURIComponent(token)}`;

  let body: React.ReactNode;
  if (!preview) body = <p role="alert" className="ta-msg ta-msg-error">{t['ia.accept.error.NOT_FOUND']}</p>;
  else if (preview.status !== 'PENDING')
    body = <p role="alert" className="ta-msg ta-msg-error">{t[`ia.accept.error.${preview.status === 'ACCEPTED' ? 'ALREADY_USED' : preview.status}` as MessageKey]}</p>;
  else if (!clerkUserId)
    body = (
      <>
        <p className="ta-msg">{fillMessage(t['ia.accept.signedOutBody'], { email: preview.email })}</p>
        <div className="ta-actions">
          <Link className="btn btn-primary" href={`/sign-up?redirect_url=${encodeURIComponent(here)}`}>
            {t['ia.accept.signUp']}
          </Link>
          <Link className="btn btn-secondary" href={`/sign-in?redirect_url=${encodeURIComponent(here)}`}>
            {t['ia.accept.signIn']}
          </Link>
        </div>
      </>
    );
  else
    body = (
      <AcceptCoordinatorInvitation
        token={token}
        emailMismatch={!!signedInEmail && signedInEmail.toLowerCase() !== preview.email}
        labels={{
          submit: t['ia.accept.submit'],
          accepting: t['ia.accept.accepting'],
          done: t['ia.accept.done'],
          mismatch: t['ia.accept.error.EMAIL_MISMATCH'],
          errors: {
            NOT_FOUND: t['ia.accept.error.NOT_FOUND'],
            EXPIRED: t['ia.accept.error.EXPIRED'],
            REVOKED: t['ia.accept.error.REVOKED'],
            ALREADY_USED: t['ia.accept.error.ALREADY_USED'],
            EMAIL_MISMATCH: t['ia.accept.error.EMAIL_MISMATCH'],
            INSTITUTION_NOT_AVAILABLE: t['ia.accept.error.INSTITUTION_NOT_AVAILABLE'],
            ROLE_REVOKED: t['ia.accept.error.ROLE_REVOKED'],
          },
          generic: t['ia.accept.error.generic'],
        }}
      />
    );

  return (
    <main className="ta-stack" style={{ maxWidth: 560, margin: '0 auto', padding: 'var(--space-8) var(--space-4)' }}>
      <section className="card ta-card" aria-labelledby="invite-title">
        <h1 id="invite-title" style={{ fontSize: 22 }}>{t['ia.accept.title']}</h1>
        {preview && <p>{fillMessage(t['ia.accept.body'], { institution: preview.institutionName })}</p>}
        {preview && <p className="ta-msg">{fillMessage(t['ia.accept.for'], { email: preview.email })}</p>}
        {body}
      </section>
    </main>
  );
}

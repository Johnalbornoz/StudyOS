/**
 * Track A -- shared server context of every Institution workspace page: the signed-in actor,
 * their locale and messages, and the institution overview -- which re-verifies that the actor
 * is an APPROVED coordinator of THIS institution (anything else -> 404, never a leak).
 */
import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getInstitutionOverview, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';

export async function institutionPageContext(institutionId: string) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);
  let overview;
  try {
    overview = await getInstitutionOverview(actor.id, institutionId);
  } catch (error) {
    if (error instanceof InstitutionIntelligenceAccessDeniedError) notFound();
    throw error;
  }
  const tr = t as unknown as Record<string, string>;
  return { actor, locale, t, tr, overview };
}

/** The iops.* labels (client controls). */
export function opsLabels(tr: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(tr).filter(([k]) => k.startsWith('iops.')));
}

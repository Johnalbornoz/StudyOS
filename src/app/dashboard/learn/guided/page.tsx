import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateStudentId, verifySubjectAccess, verifyConceptsAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { getMessages, isLocale, type Locale } from '@/lib/i18n/messages';
import { resolveLanguageForSubject } from '@/services/subject-generation-context.service';
import { conceptMissionPath } from '@/lib/lx/continuation';
import GuidedLearn from './GuidedLearn';

/**
 * LEARN -- adaptive guided understanding (operator rule 2026-10-16), the canonical LEARN launch target
 * (canonical-session-launch.ts LEARN_GUIDED_PATH).
 *
 * PRESENTATION ONLY. The URL's subjectId/conceptId are honoured only when they are the signed-in Student's
 * own; whether LEARN is executable for the concept is decided by the server on start (fresh canonical
 * decision), never here.
 */
export default async function GuidedLearnPage({ searchParams }: { searchParams: Promise<{ subjectId?: string; conceptId?: string }> }) {
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
  const { subjectId, conceptId } = await searchParams;
  const uuid = /^[0-9a-f-]{36}$/i;
  const owned =
    !!subjectId && !!conceptId && uuid.test(subjectId) && uuid.test(conceptId) &&
    (await verifySubjectAccess(studentId, subjectId)) && (await verifyConceptsAccess(studentId, [conceptId], subjectId));
  if (!owned) {
    const t = getMessages('es');
    return (
      <div className="ls">
        <p>{t['lg.notAuthorizedBody']}</p>
        <Link href="/dashboard/today" className="btn btn-primary">{t['lg.backToConcept']}</Link>
      </div>
    );
  }

  // The activity language governs the whole active learning surface (same rule as the quiz page).
  const resolved = await resolveLanguageForSubject(subjectId!, studentId);
  const language: Locale = isLocale(resolved) ? resolved : 'es';
  const label = await db
    .query(
      `SELECT COALESCE(cl.label, (SELECT anyl.label FROM concept_localizations anyl WHERE anyl.concept_id = c.id ORDER BY anyl.language LIMIT 1), c.canonical_id) AS label, s.name AS subject_name
         FROM concepts c JOIN subjects s ON s.id = c.subject_id
         LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $2
        WHERE c.id = $1`,
      [conceptId, language],
    )
    .then((r) => r.rows[0] ?? null)
    .catch(() => null);

  return (
    <GuidedLearn
      studentId={studentId}
      subjectId={subjectId!}
      conceptId={conceptId!}
      conceptLabel={(label?.label as string) ?? ''}
      subjectName={(label?.subject_name as string) ?? ''}
      locale={language}
      missionHref={conceptMissionPath({ subjectId: subjectId!, conceptId: conceptId! })}
    />
  );
}

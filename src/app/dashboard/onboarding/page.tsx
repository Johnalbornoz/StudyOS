import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { query } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { onboardingRouteRedirect } from '@/lib/lx/first-destination';
import { resolveWorkspaceEntry } from '@/lib/identity/workspace-entry';
import { loadSubjectPickerData } from '@/lib/experience/subject-picker.server';
import { PageIntro } from '@/components/ui/PageIntro';
import SubjectPicker from '../subjects/SubjectPicker';

/**
 * LX-2D / UX-5 closure -- first-time onboarding: no product tour, no
 * StudyUs vocabulary. The page asks "¿Qué quieres aprender?" and offers
 * the subjects the Student's profile implies (SubjectPicker); choosing one
 * continues straight into concept choice in Aprender.
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

  // A01-LOGIC-03: a non-Student workspace (e.g. an admin-only account) is
  // sent to its own home before any Student data is provisioned.
  const entry = await resolveWorkspaceEntry(clerkUserId);
  if (entry.kind === 'REDIRECT') redirect(entry.to);

  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId);
  const t = getMessages(locale);
  const tr = t as Record<string, string>;

  const subjectRes = await query(`SELECT 1 FROM subjects WHERE student_id = $1 LIMIT 1`, [studentId]).catch(() => ({ rows: [] as unknown[] }));
  const goalRes = await query(`SELECT 1 FROM student_exam_profiles WHERE student_id = $1 AND status <> 'ARCHIVED' LIMIT 1`, [studentId]).catch(() => ({ rows: [] as unknown[] }));
  const bounce = onboardingRouteRedirect({ hasSubject: subjectRes.rows.length > 0, hasExamGoal: goalRes.rows.length > 0 });
  if (bounce) redirect(bounce);

  // UX-5 closure: first-run IS the question "¿Qué quieres aprender?" --
  // profile-based subject suggestions, one tap to choose, then the concept.
  const picker = await loadSubjectPickerData(studentId, locale);

  return (
    <div className="xp-page">
      {/* Objective first: two equal entry points -- learning a subject, or preparing an exam (no subject needed first). */}
      <section className="prep-start" aria-labelledby="prep-start-title">
        <h2 id="prep-start-title" className="exv2-title">{tr['prep.onboarding.title']}</h2>
        <div className="prep-start-options">
          <a className="card prep-start-option" href="#sp-learn">
            <strong>{tr['prep.onboarding.learn']}</strong>
            <span className="ui-hint">{tr['prep.onboarding.learnBody']}</span>
          </a>
          <Link className="card prep-start-option" href="/dashboard/exam-prep">
            <strong>{tr['prep.onboarding.exam']}</strong>
            <span className="ui-hint">{tr['prep.onboarding.examBody']}</span>
          </Link>
        </div>
      </section>
      <span id="sp-learn" />
      <PageIntro title={t['sp.title']} lead={t['sp.lead']} />
      <SubjectPicker
        locale={locale}
        suggestions={picker.suggestions}
        owned={picker.owned}
        requiresLevel={picker.context.requiresLevel}
        profileLabel={picker.profileLabel}
      />
    </div>
  );
}

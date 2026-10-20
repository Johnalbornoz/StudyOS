import { auth } from '@clerk/nextjs/server';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { AssessmentAvailability, AssessmentSetup, effortText } from '@/components/assessment/AssessmentExperience';
import { isSnapshotExecutionEnabled } from '@/lib/assessment-execution/assessment-start.service';
import { canonicalConceptLabels, learningSetupForStudent } from '@/lib/assessment-experience/assessment-experience.service';
import { TODAY_HREF } from '@/lib/assessment-experience/continuation';
import { hiddenFieldsOf, launchRequestOfQuery, type LaunchQuery } from './launch-params';
import { isAdHocExamIntent } from '@/lib/assessment-experience/ad-hoc-exam';
import { resolveAdHocExamScope } from '@/services/ad-hoc-exam.service';
import { getScheduledAdHocExam, isScheduledExamDue } from '@/services/ad-hoc-exam-schedule.service';
import { adHocExamReadiness } from '@/lib/assessment-experience/ad-hoc-exam.service';
import { getAdHocExamMessages } from '@/lib/i18n/ad-hoc-exam-messages';
import { getStudentMastery } from '@/services/mastery.service';
import { StartAssessment } from './StartAssessment';

export const dynamic = 'force-dynamic';

/** The page of the Student's own concept, when the request is about exactly one. Read-only; a foreign or unknown id has no link. */
async function ownConceptHref(studentId: string, learnerConceptIds: readonly string[]): Promise<string | undefined> {
  if (learnerConceptIds.length !== 1) return undefined;
  const r = await db
    .query(`SELECT c.id, c.subject_id FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE c.id::text = $1 AND s.student_id = $2`, [learnerConceptIds[0], studentId])
    .catch(() => null);
  const row = r?.rows[0] as { id: string; subject_id: string } | undefined;
  return row ? `/dashboard/subjects/${row.subject_id}/concepts/${row.id}` : undefined;
}

/**
 * B5-R -- Setup and Preview of a learning assessment, under ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED.
 *
 * Setup: what each depth would be, from the Blueprint Core (the same pipeline the start freezes).
 * Preview: the depth the Student chose, before anything is created. Start is the one start authority,
 * reached through POST /api/assessments/learning/start.
 *
 * With the flag off this page does not exist and the existing practice path is the only one.
 * It reads; it selects nothing, counts nothing, creates nothing and queues nothing.
 */
export default async function AssessmentSetupPage({ searchParams }: { searchParams?: Promise<LaunchQuery> } = {}) {
  if (!isSnapshotExecutionEnabled()) notFound();
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');
  const studentId = await getOrCreateStudentId(userId);
  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const t = getMessages(locale);
  const tr = t as Record<string, string>;

  const asked = (await searchParams) ?? {};
  // A check of ONE of the Student's concepts that cannot start is not a dead end: the concept's own page
  // holds its next step (learn, practise), so that is where "unavailable" sends the Student.
  const conceptHref = await ownConceptHref(studentId, launchRequestOfQuery(asked)?.scope.learnerConceptIds ?? []);
  const unavailable = (
    <div className="xp-page">
      <InlineAlert
        tone="warning"
        title={t['ax.avail.UNAVAILABLE']}
        actions={
          <>
            {conceptHref && <Link href={conceptHref} className="btn btn-primary">{t['ax.setup.openConcept']}</Link>}
            <Link href={TODAY_HREF} className={conceptHref ? 'btn btn-ghost' : 'btn btn-primary'}>{t['ax.cont.RETURN']}</Link>
          </>
        }
      />
    </div>
  );
  // A scheduled partial exam: everything it assesses is read from the Student's own schedule. Whatever else the
  // link carries is ignored, so a link cannot change what was scheduled.
  let scheduledAssessmentId: string | null = null;
  let query = asked;
  if (asked.sch) {
    const schedule = await getScheduledAdHocExam(studentId, asked.sch);
    if (!schedule || schedule.status !== 'SCHEDULED' || !schedule.scopeIntact) return unavailable;
    if (!isScheduledExamDue(schedule, new Date())) {
      // shown, not decided, here: the start route refuses an early start whatever this page renders
      const m = getAdHocExamMessages(locale);
      return (
        <div className="xp-page">
          <InlineAlert tone="warning" title={m['adhoc.notDueTitle']} body={`${m['adhoc.notDueBody']} ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: schedule.timezone }).format(new Date(schedule.scheduledAt))}`} actions={<Link href={`/dashboard/subjects/${schedule.subjectId}`} className="btn btn-primary">{m['adhoc.backToSubject']}</Link>} data-state="ASSESSMENT_NOT_DUE" />
        </div>
      );
    }
    scheduledAssessmentId = schedule.id;
    query = { intent: 'AD_HOC_CONCEPT_EXAM', origin: 'SUBJECT', s: schedule.subjectId, lc: schedule.conceptIds.join(','), depth: schedule.depth, m: schedule.availableMinutes ? String(schedule.availableMinutes) : undefined, d: schedule.difficultyBand ?? undefined, confirm: asked.confirm, sch: schedule.id };
  }
  const request = launchRequestOfQuery(query);
  if (!request) return unavailable;
  // A Student's own partial exam ("Crear examen" on a Subject): the scope is the Student's own concepts of that
  // Subject and nothing else. It is checked on every step; canonical ids given directly would skip that check.
  const adHoc = isAdHocExamIntent(request.intent);
  let subjectId: string | null = null;
  if (adHoc) {
    if (request.scope.canonicalConceptIds.length > 0 || request.scope.node) return unavailable;
    const scope = await resolveAdHocExamScope(studentId, query.s, request.scope.learnerConceptIds);
    if (!scope.ok) return unavailable;
    subjectId = scope.subjectId;
  }
  const setup = await learningSetupForStudent(studentId, request, new Date().toISOString());
  if (!setup.ok) return unavailable;

  // from here on the intent names the canonical targets the Blueprint Core resolved (never a learner-local id)
  const launch = setup.canonicalConceptIds.length > 0 ? { ...request, scope: { ...request.scope, canonicalConceptIds: setup.canonicalConceptIds, learnerConceptIds: [] } } : request;
  const labels = await canonicalConceptLabels(setup.canonicalConceptIds);
  const scopeLabel = setup.canonicalConceptIds.map((id) => labels[id]).filter(Boolean).join(' · ') || undefined;
  const chosen = setup.view.depthOptions.find((o) => o.depth === request.depth)?.preview ?? setup.view.preview;
  // the form of a Student's own exam keeps naming the Student's concepts and the Subject, so each step re-checks the scope
  const hidden = hiddenFieldsOf(adHoc ? request : launch, { subjectId, scheduledAssessmentId });
  const startLabels = { start: t['ax.setup.start'], starting: t['ax.state.loading'], failed: t['ax.avail.UNAVAILABLE'], retry: t['ax.state.retry'], back: t['ax.setup.back'], preparing: t['ax.start.preparing'], failedLearning: t['ax.fail.LEARNING'], failedAssessment: t['ax.fail.ASSESSMENT'] };
  const homeHref = subjectId ? `/dashboard/subjects/${subjectId}` : TODAY_HREF;

  if (adHoc && query.confirm === '1') {
    // the same scope check the start performs. Content is not a condition here: a Student's own exam is an
    // Internal Assessment, generated in full and frozen by the start (an explicit command) before it begins.
    const ready = await adHocExamReadiness(studentId, { subjectId, learnerConceptIds: request.scope.learnerConceptIds, depth: request.depth, availableMinutes: request.availableMinutes, difficultyBand: request.difficultyBand }, new Date().toISOString(), { enabled: isSnapshotExecutionEnabled() });
    if (!ready.ok && ready.reason !== 'ASSESSMENT_NOT_GENERATED_YET') return unavailable;
  }

  if (query.confirm === '1' && chosen?.canStart) {
    const effort = effortText(chosen.effort, t);
    const setupHref = `/dashboard/assessment?${new URLSearchParams({ ...hidden, confirm: '', depth: request.depth }).toString()}`;
    return (
      <div className="xp-page">
        <section className="card ax-setup" aria-labelledby="ax-preview-title" data-step="preview">
          <header>
            <h1 id="ax-preview-title" className="xr-section-name">{t['ax.preview.title']}</h1>
            {scopeLabel && <p className="ax-scope">{scopeLabel}</p>}
          </header>
          {setup.view.depthOptions.length > 0 && (
            <p>
              <strong>{tr[`ax.depth.${request.depth}`]}</strong>
              <span className="ui-hint"> — {tr[`ax.depth.${request.depth}.desc`]}</span>
            </p>
          )}
          {effort && <p className="ax-single tabular">{effort}</p>}
          <AssessmentAvailability preview={chosen} t={t} />
          {/* a Student's own partial exam goes to the start as the Student's own concepts under its Subject: the start checks them itself */}
          {adHoc ? (
            <StartAssessment request={{ ...request, scope: { ...request.scope, subjectId, scheduledAssessmentId } }} labels={startLabels} backHref={setupHref} />
          ) : (
            <StartAssessment request={launch} labels={startLabels} backHref={setupHref} />
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="xp-page">
      <AssessmentSetup view={setup.view} t={t} scopeLabel={scopeLabel} action="/dashboard/assessment" hidden={hidden} selectedDepth={request.depth} backHref={homeHref} conceptHref={conceptHref} />
    </div>
  );
}

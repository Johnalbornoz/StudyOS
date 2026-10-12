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

  const query = (await searchParams) ?? {};
  const request = launchRequestOfQuery(query);
  // A check of ONE of the Student's concepts that cannot start is not a dead end: the concept's own page
  // holds its next step (learn, practise), so that is where "unavailable" sends the Student.
  const conceptHref = request ? await ownConceptHref(studentId, request.scope.learnerConceptIds) : undefined;
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
  if (!request) return unavailable;
  // OE-011: the setup is read-only. It never requests supply: what is offered below is what is eligible now,
  // and when nothing is, the answer is "not available" -- never a queued generation.
  const setup = await learningSetupForStudent(studentId, request, new Date().toISOString());
  if (!setup.ok) return unavailable;

  // from here on the intent names the canonical targets the Blueprint Core resolved (never a learner-local id)
  const launch = setup.canonicalConceptIds.length > 0 ? { ...request, scope: { ...request.scope, canonicalConceptIds: setup.canonicalConceptIds, learnerConceptIds: [] } } : request;
  const labels = await canonicalConceptLabels(setup.canonicalConceptIds);
  const scopeLabel = setup.canonicalConceptIds.map((id) => labels[id]).filter(Boolean).join(' · ') || undefined;
  const chosen = setup.view.depthOptions.find((o) => o.depth === request.depth)?.preview ?? setup.view.preview;

  if (query.confirm === '1' && chosen?.canStart) {
    const effort = effortText(chosen.effort, t);
    const setupHref = `/dashboard/assessment?${new URLSearchParams({ ...hiddenFieldsOf(launch), confirm: '', depth: request.depth }).toString()}`;
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
          <StartAssessment
            request={launch}
            labels={{ start: t['ax.setup.start'], starting: t['ax.state.loading'], failed: t['ax.avail.UNAVAILABLE'], retry: t['ax.state.retry'], back: t['ax.setup.back'] }}
            backHref={setupHref}
          />
        </section>
      </div>
    );
  }

  return (
    <div className="xp-page">
      <AssessmentSetup view={setup.view} t={t} scopeLabel={scopeLabel} action="/dashboard/assessment" hidden={hiddenFieldsOf(launch)} selectedDepth={request.depth} backHref={TODAY_HREF} conceptHref={conceptHref} />
    </div>
  );
}

import { auth } from '@clerk/nextjs/server';
import { notFound, redirect } from 'next/navigation';
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

/**
 * B5-R -- Setup and Preview of a learning assessment, under ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED.
 *
 * Setup: what each depth would be, from the Blueprint Core (the same pipeline the start freezes).
 * Preview: the depth the Student chose, before anything is created. Start is the one start authority,
 * reached through POST /api/assessments/learning/start.
 *
 * With the flag off this page does not exist and the existing practice path is the only one.
 * It reads; it selects nothing, counts nothing and creates nothing.
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
  const unavailable = (
    <div className="xp-page">
      <InlineAlert tone="warning" title={t['ax.avail.UNAVAILABLE']} actions={<Link href={TODAY_HREF} className="btn btn-primary">{t['ax.cont.RETURN']}</Link>} />
    </div>
  );
  if (!request) return unavailable;
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
      <AssessmentSetup view={setup.view} t={t} scopeLabel={scopeLabel} action="/dashboard/assessment" hidden={hiddenFieldsOf(launch)} selectedDepth={request.depth} backHref={TODAY_HREF} />
    </div>
  );
}

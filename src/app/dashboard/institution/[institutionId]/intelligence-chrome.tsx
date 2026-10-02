import Link from 'next/link';
import type { getMessages } from '@/lib/i18n/messages';
import { institutionSubNavLabels } from '@/lib/institution/admin-labels';
import { getIntelligenceContext, type IntelligenceContext } from '@/lib/institution/intelligence-context.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { InstitutionSubNav } from './InstitutionSubNav';
import { IntelligenceContextBar } from './IntelligenceContextBar';

type T = ReturnType<typeof getMessages>;
export type IntelligenceTab = 'coverage' | 'readiness' | 'interventions' | 'attention';
type Search = Record<string, string | string[] | undefined>;

const one = (sp: Search, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v) ?? null;
};

/** Resolve the governed context for a tab from the URL (ids never typed; foreign ids ignored). */
export function loadContext(actorUserId: string, institutionId: string, sp: Search, t: T): Promise<IntelligenceContext> {
  return getIntelligenceContext(actorUserId, institutionId, { curriculum: one(sp, 'curriculum'), period: one(sp, 'period'), classId: one(sp, 'class'), exam: one(sp, 'exam') }, { general: t['iix.general'], allGrades: t['iix.allGrades'] });
}

/** Title, sub-navigation, the tab's explanation and its context selectors. */
export function IntelligenceHeader({ t, institutionId, institutionName, tab, ctx, show }: { t: T; institutionId: string; institutionName: string; tab: IntelligenceTab; ctx: IntelligenceContext; show: { curriculum: boolean; period: boolean; class: boolean; exam: boolean } }) {
  const title = t[`institution.${tab}.title` as keyof T];
  return (
    <div className="ta-stack" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
      <div>
        <PageHeader title={institutionName} subtitle={title} />
        <InstitutionSubNav institutionId={institutionId} active={tab} labels={institutionSubNavLabels(t)} />
      </div>
      <p className="ta-msg iix-help" data-help={tab}>
        {t[`iix.help.${tab}` as keyof T]}
      </p>
      {(ctx.curricula.length > 0 || show.period) && (
        <section className="card ta-card" aria-label={t['iix.context']}>
          <IntelligenceContextBar
            curricula={ctx.curricula.map(({ curriculumId, programme, version, grade, subject }) => ({ curriculumId, programme, version, grade, subject }))}
            selectedId={ctx.selected?.curriculumId ?? null}
            period={ctx.period}
            classes={ctx.classes}
            classId={ctx.classId}
            exams={ctx.exams}
            examId={ctx.examVersionId}
            show={show}
            labels={{
              context: t['iix.context'],
              programme: t['iix.programme'],
              version: t['iix.version'],
              grade: t['iix.grade'],
              subject: t['iix.subject'],
              period: t['iix.period'],
              'period.current': t['iix.period.current'],
              'period.30d': t['iix.period.30d'],
              'period.all': t['iix.period.all'],
              class: t['iix.class'],
              allClasses: t['iix.allClasses'],
              exam: t['iix.exam'],
            }}
          />
          {show.period && <p className="ta-msg">{t['iix.periodNote']}</p>}
        </section>
      )}
    </div>
  );
}

export function NoCurriculum({ t, institutionId }: { t: T; institutionId: string }) {
  return (
    <EmptyState
      title={t['iix.noCurriculum.title']}
      body={t['iix.noCurriculum.body']}
      action={
        <Link href={`/dashboard/institution/${institutionId}/curriculum`} className="btn btn-primary">
          {t['iix.noCurriculum.cta']}
        </Link>
      }
    />
  );
}

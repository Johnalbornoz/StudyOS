import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getInstitutionOverview, getInstitutionAttentionAreas, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { IntelligenceHeader, loadContext } from '../intelligence-chrome';
import { getCurriculumAttention } from '@/lib/institution/curriculum-attention.service';

/**
 * F14 / Track A -- attention areas (F12 `getInstitutionAttentionAreas`,
 * rule-based with cited metrics). Optionally narrowed to a class of the
 * selected curriculum's grade / subject; reasons are localized.
 */
export default async function InstitutionAttentionPage({ params, searchParams }: { params: Promise<{ institutionId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { institutionId } = await params;
  const sp = await searchParams;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  let overview;
  let ctx;
  let areas;
  let bySubject: Awaited<ReturnType<typeof getCurriculumAttention>> = [];
  try {
    overview = await getInstitutionOverview(actor.id, institutionId);
    ctx = await loadContext(actor.id, institutionId, sp, t);
    areas = await getInstitutionAttentionAreas(actor.id, institutionId, ctx.classId ? { classId: ctx.classId } : undefined);
    bySubject = ctx.selected ? await getCurriculumAttention(institutionId, ctx.selected.curriculumId, locale) : [];
  } catch (error) {
    if (error instanceof InstitutionIntelligenceAccessDeniedError) notFound();
    throw error;
  }

  return (
    <div>
      <IntelligenceHeader t={t} institutionId={institutionId} institutionName={overview.institutionName} tab="attention" ctx={ctx} show={{ curriculum: true, period: false, class: true, exam: false }} />
      {!ctx.selected && <InlineAlert tone="info" title={t['iix.noCurriculum.title']} body={t['iix.noCurriculum.body']} />}
      {ctx.selected && (
        <section className="card ta-card" aria-labelledby="att-subject" data-section="attention-by-subject" style={{ marginBottom: 'var(--space-4)' }}>
          <h2 id="att-subject" style={{ fontSize: 16 }}>
            {t['cur2.attention.bySubject']} · {ctx.selected.subject}
          </h2>
          {bySubject.length === 0 ? (
            <p className="ta-msg">{t['cur2.attention.none']}</p>
          ) : (
            <ul className="role-list">
              {bySubject.map((r) => (
                <li key={r.conceptId} data-concept={r.conceptId}>
                  {fillMessage(t['cur2.attention.row'], { concept: r.label, students: r.students, classes: r.classes })}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {areas.length === 0 ? (
        <EmptyState title={t['iix.empty.attention']} />
      ) : (
        <ul className="list-card card">
          {areas.map((a, i) => (
            <li key={i} className="list-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-1)' }} data-reason={a.reasonCode}>
              <div className="row-title">{t[`iix.attention.reason.${a.reasonCode}` as MessageKey] ?? a.reasonCode}</div>
              {a.citedDenominator !== null && <div className="row-sub">{fillMessage(t['iix.attention.cited'], { numerator: a.citedNumerator, denominator: a.citedDenominator })}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

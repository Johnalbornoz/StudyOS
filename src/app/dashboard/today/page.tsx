import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { query } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import { getLearningOSSnapshot, type ConceptDisplayInfo } from '@/services/learning-os-snapshot.service';
import { estimateActivityMinutes, type LearningPlanItem } from '@/lib/learning-execution-policy';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import WhyThisV3 from '../WhyThisV3';
import { activityLabel } from '../activityLabel';
import { activityCta } from '../activityCta';
import StartSessionButton from '../StartSessionButton';

/**
 * Today v3 -- entirely Learning-OS-backed (Phase 3C decisions + Phase
 * 3D execution fit), in one atomic migration. No legacy
 * getTodayPlan()/buildBestNextAction()/TodayReason logic remains on
 * this page, so there is never a top card from one authority and a
 * list from another.
 */

function ItemRow({
  item,
  studentId,
  labels,
  t,
  deferred,
}: {
  item: LearningPlanItem;
  studentId: string;
  labels: Map<string, ConceptDisplayInfo>;
  t: ReturnType<typeof getMessages>;
  deferred?: boolean;
}) {
  const { decision } = item;
  const info = labels.get(decision.actionConceptId);
  const label = info?.label ?? decision.actionConceptId;
  const subjectName = info?.subjectName ?? '';

  return (
    <div
      className="card"
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-4)',
        borderLeft: `3px solid ${deferred ? 'var(--text-muted)' : 'var(--brand)'}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{label}</span>
          <span
            className="tabular"
            style={{
              fontSize: 11, fontWeight: 650, color: 'var(--brand-ink)', background: 'var(--brand-subtle)',
              borderRadius: 'var(--radius-full)', padding: '2px 9px',
            }}
          >
            {activityLabel(decision.activityType, t)}
          </span>
          <span className="tabular" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t['bestNextAction.minutes'].replace('{min}', String(item.estimatedMinutes))}
          </span>
          {deferred && (
            <span
              style={{
                fontSize: 10.5, fontWeight: 650, color: 'var(--warning)', background: 'var(--warning-subtle)',
                borderRadius: 'var(--radius-full)', padding: '2px 9px', textTransform: 'uppercase', letterSpacing: '0.02em',
              }}
            >
              {t['today3.deferredBadge']}
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{subjectName}</div>
        <WhyThisV3 facts={decision.facts} t={t} />
      </div>
      <StartSessionButton
        studentId={studentId}
        actionConceptId={decision.actionConceptId}
        label={activityCta(decision.activityType, t)}
        accessibleLabel={`${activityCta(decision.activityType, t)}: ${label}`}
        unavailableLabel={t['today3.unavailableBody']}
        retryLabel={t['today3.retry']}
        variant="secondary"
      />
    </div>
  );
}

export default async function TodayPage() {
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

  const snapshot = await getLearningOSSnapshot(studentId, { preferredLanguage: locale }).catch(() => null);

  const todayFormatted = new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

  const best = snapshot?.nextExecutableItem ?? null;
  const bestLabel = best ? snapshot!.conceptLabels.get(best.decision.actionConceptId) : null;
  const isEmpty = !snapshot || snapshot.decisions.length === 0;

  // Step 6L-A: "nothing to show" has two very different meanings for the
  // student -- a brand-new/cold profile with no evidence yet to build a
  // recommendation from, versus an established student who is genuinely
  // caught up right now. Distinguishing them is a plain existence check
  // over already-canonical data (never a new recommendation/diagnostic
  // policy), so the cold state is never confused with "you're at risk"
  // or "you're behind."
  const isCold = isEmpty
    ? (await query(`SELECT EXISTS (SELECT 1 FROM learning_evidence WHERE student_id = $1) AS has_evidence`, [studentId])).rows[0]
        .has_evidence === false
    : false;

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <p className="label" style={{ color: 'var(--text-muted)', margin: '0 0 4px', textTransform: 'capitalize' }}>
          {todayFormatted}
        </p>
        <h1>{t['today.title']}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15, maxWidth: '58ch' }}>
          {t['today3.subtitle']}
        </p>
      </div>

      {best && (
        <div
          className="card"
          style={{
            marginBottom: 'var(--space-8)', borderColor: 'var(--brand)', borderWidth: 2,
            display: 'flex', alignItems: 'center', gap: 'var(--space-5)',
          }}
        >
          <div
            aria-hidden
            style={{
              flexShrink: 0, width: 44, height: 44, borderRadius: '50%', background: 'var(--brand)',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
            }}
          >
            ★
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="label" style={{ color: 'var(--brand-ink)', marginBottom: 4 }}>{t['bestNextAction.title']}</div>
            <div style={{ fontSize: 17, fontWeight: 650 }}>{bestLabel?.label ?? best.decision.actionConceptId}</div>
            <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 2 }}>
              {bestLabel?.subjectName} · {activityLabel(best.decision.activityType, t)} ·{' '}
              {t['bestNextAction.minutes'].replace('{min}', String(best.estimatedMinutes))}
            </div>
            <WhyThisV3 facts={best.decision.facts} t={t} />
          </div>
          <StartSessionButton
            studentId={studentId}
            actionConceptId={best.decision.actionConceptId}
            label={activityCta(best.decision.activityType, t)}
            unavailableLabel={t['today3.unavailableBody']}
            retryLabel={t['today3.retry']}
            variant="primary"
          />
        </div>
      )}

      {isEmpty ? (
        <div className="card empty-state">
          <strong>{isCold ? t['today3.coldStateTitle'] : t['today3.emptyTitle']}</strong>
          {isCold ? t['today3.coldStateBody'] : t['today3.emptyBody']}
          {isCold && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <Link href="/dashboard/subjects" className="btn btn-primary">
                {t['today3.coldStateCta']}
              </Link>
            </div>
          )}
        </div>
      ) : (
        <>
          {snapshot!.dailyPlan.items.length > 0 && (
            <div style={{ marginBottom: 'var(--space-8)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', marginBottom: 2 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>{t['today3.sessionTitle']}</h2>
                <span
                  className="tabular"
                  style={{ fontSize: 12, fontWeight: 650, color: 'var(--brand-ink)', background: 'var(--brand-subtle)', borderRadius: 'var(--radius-full)', padding: '2px 9px' }}
                >
                  {t['today3.minutesPlanned']
                    .replace('{planned}', String(snapshot!.dailyPlan.plannedMinutes))
                    .replace('{available}', String(snapshot!.dailyPlan.availableMinutes))}
                </span>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 var(--space-3)' }}>{t['today3.sessionSubtitle']}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {snapshot!.dailyPlan.items.map((item) => (
                  <ItemRow key={item.decision.actionConceptId} item={item} studentId={studentId} labels={snapshot!.conceptLabels} t={t} />
                ))}
              </div>
            </div>
          )}

          {snapshot!.dailyPlan.deferred.length > 0 && (
            <div style={{ marginBottom: 'var(--space-8)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', marginBottom: 2 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>{t['today3.deferredTitle']}</h2>
                <span
                  className="tabular"
                  style={{ fontSize: 12, fontWeight: 650, color: 'var(--warning)', background: 'var(--warning-subtle)', borderRadius: 'var(--radius-full)', padding: '2px 9px' }}
                >
                  {snapshot!.dailyPlan.deferred.length}
                </span>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 var(--space-3)' }}>{t['today3.deferredSubtitle']}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {snapshot!.dailyPlan.deferred.map((d) => (
                  <ItemRow
                    key={d.decision.actionConceptId}
                    item={{
                      decision: d.decision,
                      sequence: 0,
                      estimatedMinutes: estimateActivityMinutes(d.decision.activityType),
                      executionReason: 'FITS_IN_ORDER',
                    }}
                    studentId={studentId}
                    labels={snapshot!.conceptLabels}
                    t={t}
                    deferred
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

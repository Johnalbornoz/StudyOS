import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getErrorPatterns } from '@/services/error-intelligence.service';
import { getLearningOSSnapshot } from '@/services/learning-os-snapshot.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import ErrorPatternList from './ErrorPatternList';
import WhyThisV3 from '../WhyThisV3';
import StartSessionButton from '../StartSessionButton';

/**
 * Learning Debt v3 -- an ANALYTICAL view (severity, recurrence,
 * forgetting risk, remediation state). It answers "where does debt
 * exist and how severe is it," never "what should the student do
 * next" with its own ranking -- every section below is filtered from
 * the SAME Learning OS snapshot Today uses, in Phase 3C's own decision
 * order, never re-sorted by severity/count/mastery. No getTodayPlan,
 * no direct getActiveDebts/getActiveDiagnoses/getActiveRemediations/
 * getRecurringMisconceptions calls on this page -- Phase 3C's signal
 * loader already read all of that once, computing the snapshot; a
 * second direct read here would be exactly the duplicate side-effect
 * read Phase 3E is meant to avoid (getActiveDebts in particular can
 * perform lazy-resolution writes on read).
 */
export default async function LearningDebtPage() {
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

  const [snapshot, errorPatterns] = await Promise.all([
    getLearningOSSnapshot(studentId, { preferredLanguage: locale }).catch(() => null),
    getErrorPatterns(studentId, undefined, locale).catch(() => []),
  ]);

  const decisions = snapshot?.decisions ?? [];
  const labels = snapshot?.conceptLabels;

  const hasSignal = (d: (typeof decisions)[number], type: string) => d.signals.some((s) => s.type === type);

  const debtItems = decisions.filter((d) => hasSignal(d, 'LEARNING_DEBT'));
  const foundationalGaps = decisions.filter((d) => hasSignal(d, 'PREREQUISITE_GAP'));
  const activeRepairs = decisions.filter((d) => hasSignal(d, 'REMEDIATION_ACTIVE'));
  const recurringMisconceptions = decisions.filter((d) => hasSignal(d, 'RECURRING_MISCONCEPTION'));
  const atRisk = decisions.filter((d) => hasSignal(d, 'FORGETTING_RISK'));

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1>{t['debt.title']}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>
          {t['debt.subtitle']}
        </p>
      </div>

      <h2 style={{ marginBottom: 4 }}>{t['debt.sectionNeedsAttention']}</h2>
      {debtItems.length === 0 ? (
        <div className="card empty-state">
          <strong>{t['debt.allCaughtUpTitle']}</strong>
          {t['debt.allCaughtUpBody']}
        </div>
      ) : (
        <div className="card list-card">
          {debtItems.map((d) => {
            const debtSignal = d.signals.find((s) => s.type === 'LEARNING_DEBT');
            const severity = Number(debtSignal?.metadata.severity ?? 0);
            const mastery = Number(debtSignal?.metadata.mastery ?? 0);
            const info = labels?.get(d.actionConceptId);
            return (
              <div key={d.actionConceptId} className="list-row">
                <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: severity >= 3 ? 'var(--error)' : 'var(--warning)' }} />
                <div className="row-main">
                  <div className="row-title">{info?.label ?? d.actionConceptId}</div>
                  <div className="row-sub">
                    {t['debt.currentMastery']}: {Math.round(mastery)}% · {t['debt.severity']} {severity}
                  </div>
                  <WhyThisV3 facts={d.facts} t={t} />
                </div>
                <StartSessionButton
                  studentId={studentId}
                  actionConceptId={d.actionConceptId}
                  label={t['debt.review']}
                  unavailableLabel={t['today3.unavailableBody']}
                  retryLabel={t['today3.retry']}
                  variant="secondary"
                />
              </div>
            );
          })}
        </div>
      )}

      {foundationalGaps.length > 0 && (
        <div style={{ marginTop: 'var(--space-8)' }}>
          <h2 style={{ marginBottom: 4 }}>{t['debt.sectionFoundationalGaps']}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 16px', maxWidth: '62ch' }}>
            {t['debt.foundationalGapsSubtitle']}
          </p>
          <ul className="card list-card">
            {foundationalGaps.map((d) => {
              const info = labels?.get(d.actionConceptId);
              return (
                <li key={d.actionConceptId} className="list-row">
                  <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: 'var(--error)' }} />
                  <div className="row-main">
                    <div className="row-title">{info?.label ?? d.actionConceptId}</div>
                    <WhyThisV3 facts={d.facts} t={t} />
                  </div>
                  <StartSessionButton
                    studentId={studentId}
                    actionConceptId={d.actionConceptId}
                    label={t['debt.fixFoundation']}
                    accessibleLabel={`${t['debt.fixFoundation']}: ${info?.label ?? d.actionConceptId}`}
                    unavailableLabel={t['today3.unavailableBody']}
                    retryLabel={t['today3.retry']}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {activeRepairs.length > 0 && (
        <div style={{ marginTop: 'var(--space-8)' }}>
          <h2 style={{ marginBottom: 4 }}>{t['debt.sectionActiveRepairs']}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 16px', maxWidth: '62ch' }}>
            {t['debt.activeRepairsSubtitle']}
          </p>
          <ul className="card list-card">
            {activeRepairs.map((d) => {
              const info = labels?.get(d.actionConceptId);
              return (
                <li key={d.actionConceptId} className="list-row">
                  <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: 'var(--warning)' }} />
                  <div className="row-main">
                    <div className="row-title">{info?.label ?? d.actionConceptId}</div>
                    <div className="row-sub">{info?.subjectName}</div>
                    <WhyThisV3 facts={d.facts} t={t} />
                  </div>
                  <StartSessionButton
                    studentId={studentId}
                    actionConceptId={d.actionConceptId}
                    label={t['debt.continueRepair']}
                    accessibleLabel={`${t['debt.continueRepair']}: ${info?.label ?? d.actionConceptId}`}
                    unavailableLabel={t['today3.unavailableBody']}
                    retryLabel={t['today3.retry']}
                    variant="secondary"
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {recurringMisconceptions.length > 0 && (
        <div style={{ marginTop: 'var(--space-8)' }}>
          <h2 style={{ marginBottom: 4 }}>{t['debt.sectionRecurringMisconceptions']}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 16px', maxWidth: '62ch' }}>
            {t['debt.recurringMisconceptionsSubtitle']}
          </p>
          <ul className="card list-card">
            {recurringMisconceptions.map((d) => {
              const info = labels?.get(d.actionConceptId);
              return (
                <li key={d.actionConceptId} className="list-row">
                  <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: 'var(--warning)' }} />
                  <div className="row-main">
                    <div className="row-title">{info?.label ?? d.actionConceptId} · {info?.subjectName}</div>
                    <WhyThisV3 facts={d.facts} t={t} />
                  </div>
                  <StartSessionButton
                    studentId={studentId}
                    actionConceptId={d.actionConceptId}
                    label={t['debt.review']}
                    accessibleLabel={`${t['debt.review']}: ${info?.label ?? d.actionConceptId}`}
                    unavailableLabel={t['today3.unavailableBody']}
                    retryLabel={t['today3.retry']}
                    variant="secondary"
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {atRisk.length > 0 && (
        <div style={{ marginTop: 'var(--space-8)' }}>
          <h2 style={{ marginBottom: 4 }}>{t['debt.sectionAtRisk']}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 16px', maxWidth: '62ch' }}>
            {t['debt.atRiskSubtitle']}
          </p>
          <div className="card list-card">
            {atRisk.map((d) => {
              const info = labels?.get(d.actionConceptId);
              return (
                <div key={d.actionConceptId} className="list-row">
                  <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: 'var(--warning)' }} />
                  <div className="row-main">
                    <div className="row-title">{info?.label ?? d.actionConceptId}</div>
                    <div className="row-sub">{info?.subjectName}</div>
                    <WhyThisV3 facts={d.facts} t={t} />
                  </div>
                  <StartSessionButton
                    studentId={studentId}
                    actionConceptId={d.actionConceptId}
                    label={t['debt.review']}
                    unavailableLabel={t['today3.unavailableBody']}
                    retryLabel={t['today3.retry']}
                    variant="secondary"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {errorPatterns.length > 0 && (
        <div style={{ marginTop: 'var(--space-8)' }}>
          <h2 style={{ marginBottom: 4 }}>{t['debt.errorPatternsTitle']}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 16px', maxWidth: '62ch' }}>
            {t['debt.errorPatternsSubtitle']}
          </p>
          <ErrorPatternList studentId={studentId} locale={locale} patterns={errorPatterns} />
        </div>
      )}
    </div>
  );
}

import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getActiveDebts } from '@/services/learning-debt.service';
import { getErrorPatterns } from '@/services/error-intelligence.service';
import { getTodayPlan, factsForItem } from '@/services/today-plan.service';
import { getActiveDiagnoses } from '@/services/cognitive-diagnosis.service';
import { getRecurringMisconceptions } from '@/services/misconception.service';
import { getActiveRemediationsWithLabels, remediationStepHref } from '@/services/remediation.service';
import { getBlockedConceptLabels } from '@/services/concept-graph.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import ErrorPatternList from './ErrorPatternList';
import StartRemediationButton from './StartRemediationButton';
import WhyThis from '../WhyThis';

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
  const [debts, errorPatterns, todayPlan, activeDiagnoses, recurringMisconceptions, activeRemediations] = await Promise.all([
    getActiveDebts(studentId, undefined, locale).catch(() => []),
    getErrorPatterns(studentId, undefined, locale).catch(() => []),
    getTodayPlan(studentId, locale).catch(() => ({ critical: [], thisWeek: [], canWait: [], totalConcepts: 0 })),
    getActiveDiagnoses(studentId).catch(() => []),
    getRecurringMisconceptions(studentId).catch(() => []),
    getActiveRemediationsWithLabels(studentId).catch(() => []),
  ]);
  const atRisk = [...todayPlan.critical, ...todayPlan.thisWeek, ...todayPlan.canWait].filter(
    (i) => i.reason === 'forgetting_risk'
  );

  const remediatedDiagnosisIds = new Set(activeRemediations.map((p) => p.diagnosisId).filter((id): id is string => !!id));
  const foundationalGaps = activeDiagnoses.filter((d) => d.state === 'CONFIRMED' && !remediatedDiagnosisIds.has(d.id));
  const foundationalGapsWithAffects = await Promise.all(
    foundationalGaps.map(async (d) => ({ ...d, affects: await getBlockedConceptLabels(d.candidateConceptId).catch(() => []) }))
  );

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1>{t['debt.title']}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>
          {t['debt.subtitle']}
        </p>
      </div>

      <h2 style={{ marginBottom: 4 }}>{t['debt.sectionNeedsAttention']}</h2>
      {debts.length === 0 ? (
        <div className="card empty-state">
          <strong>{t['debt.allCaughtUpTitle']}</strong>
          {t['debt.allCaughtUpBody']}
        </div>
      ) : (
        <div className="card list-card">
          {debts.map((d: any) => (
            <div key={d.id} className="list-row">
              <span
                style={{
                  width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                  background: d.severity >= 3 ? 'var(--error)' : 'var(--warning)',
                }}
              />
              <div className="row-main">
                <div className="row-title">{d.concept?.label || d.concept?.canonicalId}</div>
                <div className="row-sub">
                  {t['debt.currentMastery']}: {Math.round(d.mastery ?? 0)}% · {t['debt.severity']} {d.severity}
                </div>
                <WhyThis facts={[{ kind: 'learningDebt', debtSeverity: d.severity }]} t={t} />
              </div>
              <Link href={`/dashboard/quiz?subjectId=${d.subjectId}&conceptId=${d.conceptId}`} className="btn btn-secondary" style={{ height: 32, fontSize: 13 }}>
                {t['debt.review']}
              </Link>
            </div>
          ))}
        </div>
      )}

      {foundationalGapsWithAffects.length > 0 && (
        <div style={{ marginTop: 'var(--space-8)' }}>
          <h2 style={{ marginBottom: 4 }}>{t['debt.sectionFoundationalGaps']}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 16px', maxWidth: '62ch' }}>
            {t['debt.foundationalGapsSubtitle']}
          </p>
          <div className="card list-card">
            {foundationalGapsWithAffects.map((d) => (
              <div key={d.id} className="list-row">
                <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: 'var(--error)' }} />
                <div className="row-main">
                  <div className="row-title">{d.candidateLabel}</div>
                  {d.affects.length > 0 && (
                    <div className="row-sub">
                      {t['debt.affectsLabel']}: {d.affects.join(', ')}
                    </div>
                  )}
                </div>
                <StartRemediationButton diagnosisId={d.id} label={t['debt.fixFoundation']} />
              </div>
            ))}
          </div>
        </div>
      )}

      {activeRemediations.length > 0 && (
        <div style={{ marginTop: 'var(--space-8)' }}>
          <h2 style={{ marginBottom: 4 }}>{t['debt.sectionActiveRepairs']}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 16px', maxWidth: '62ch' }}>
            {t['debt.activeRepairsSubtitle']}
          </p>
          <div className="card list-card">
            {activeRemediations.map((p) => {
              const activeStep = p.steps.find((s) => s.status === 'active');
              const completedCount = p.steps.filter((s) => s.status === 'completed').length;
              const href = activeStep ? remediationStepHref(activeStep, { id: p.id, subjectId: p.subjectId }) : null;
              return (
                <div key={p.id} className="list-row">
                  <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: 'var(--warning)' }} />
                  <div className="row-main">
                    <div className="row-title">{p.rootCauseLabel}</div>
                    <div className="row-sub">
                      {p.subjectName} · {t['debt.stepOf'].replace('{current}', String(completedCount + 1)).replace('{total}', String(p.steps.length))}
                    </div>
                  </div>
                  {href && (
                    <Link href={href} className="btn btn-secondary" style={{ height: 32, fontSize: 13 }}>
                      {t['debt.continueRepair']}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {recurringMisconceptions.length > 0 && (
        <div style={{ marginTop: 'var(--space-8)' }}>
          <h2 style={{ marginBottom: 4 }}>{t['debt.sectionRecurringMisconceptions']}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 16px', maxWidth: '62ch' }}>
            {t['debt.recurringMisconceptionsSubtitle']}
          </p>
          <div className="card list-card">
            {recurringMisconceptions.map((m) => (
              <div key={m.signatureId} className="list-row">
                <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: 'var(--warning)' }} />
                <div className="row-main">
                  <div className="row-title">{m.conceptLabel} · {m.subjectName}</div>
                  <div className="row-sub">
                    {m.description} · {m.occurrenceCount} {t['debt.occurrences']}
                  </div>
                </div>
                <Link href={`/dashboard/quiz?subjectId=${m.subjectId}&conceptId=${m.conceptId}&mode=topic_practice`} className="btn btn-secondary" style={{ height: 32, fontSize: 13 }}>
                  {t['debt.review']}
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {atRisk.length > 0 && (
        <div style={{ marginTop: 'var(--space-8)' }}>
          <h2 style={{ marginBottom: 4 }}>{t['debt.sectionAtRisk']}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 16px', maxWidth: '62ch' }}>
            {t['debt.atRiskSubtitle']}
          </p>
          <div className="card list-card">
            {atRisk.map((item) => (
              <div key={item.conceptId} className="list-row">
                <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: 'var(--warning)' }} />
                <div className="row-main">
                  <div className="row-title">{item.label}</div>
                  <div className="row-sub">
                    {item.subjectName} · {t['today.mastery']}: {Math.round(item.masteryScore)}% · {item.forgettingRisk}% {t['today.forgettingRisk']}
                  </div>
                  <WhyThis facts={factsForItem(item)} t={t} />
                </div>
                <Link href={`/dashboard/quiz?subjectId=${item.subjectId}&conceptId=${item.conceptId}`} className="btn btn-secondary" style={{ height: 32, fontSize: 13 }}>
                  {t['debt.review']}
                </Link>
              </div>
            ))}
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

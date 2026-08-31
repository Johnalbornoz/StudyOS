import { auth, currentUser } from '@clerk/nextjs/server';
import Link from 'next/link';
import { query } from '@/lib/db';
import { BookOpen, CheckCircle2, Trophy } from 'lucide-react';
import { getSubjectAccentColor } from '@/lib/subject-color';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import OnboardingChecklist from './OnboardingChecklist';
import AcademicProfileCTA from './AcademicProfileCTA';
import { getAcademicProfile } from '@/services/academic-profile.service';
import { getStudentProgressOverview, type SubjectProgress, type ConceptProgress } from '@/services/progress-overview.service';
import { masteryStateLabel, masteryStateColor, knowledgeKpis } from '@/lib/knowledge-state-labels';

function masteryFillClass(score: number) {
  if (score >= 75) return 'fill-good';
  if (score >= 50) return 'fill-warn';
  return 'fill-critical';
}

/**
 * Progress V2 -- the student-facing "what have I achieved / what can I
 * do / what am I working on / what needs attention" view. Every number
 * on this page comes from mastery.service.ts (mastery_records, 0.0-1.0,
 * converted for display via src/lib/mastery-format.ts) or the Phase 2.2
 * Knowledge State projection (concept_knowledge_state, already 0-100)
 * through progress-overview.service.ts -- no new score is computed
 * here, and nothing here re-ranks what Phase 3C/3D already decided.
 */
export default async function DashboardPage() {
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
  const user = await currentUser();
  const firstName = user?.firstName;

  const [overview, quizSessionsResult, academicProfile] = await Promise.all([
    getStudentProgressOverview(studentId, locale),
    query(`SELECT 1 FROM quiz_sessions WHERE student_id = $1 LIMIT 1`, [studentId]).catch(() => ({ rows: [] as unknown[] })),
    getAcademicProfile(studentId).catch(() => null),
  ]);

  const hasPracticed = quizSessionsResult.rows.length > 0;
  const hasSubject = overview.subjects.length > 0;
  const hasContent = overview.subjects.some((s) => s.conceptCount > 0);

  const onboardingSteps = [
    {
      done: hasSubject,
      title: t['onboarding.step1Title'],
      body: t['onboarding.step1Body'],
      cta: t['onboarding.step1Cta'],
      href: '/dashboard/subjects/new',
    },
    {
      done: hasContent,
      title: t['onboarding.step2Title'],
      body: t['onboarding.step2Body'],
      cta: t['onboarding.step2Cta'],
      href: hasSubject ? `/dashboard/subjects/${overview.subjects[0].subjectId}` : '/dashboard/subjects/new',
    },
    {
      done: hasPracticed,
      title: t['onboarding.step3Title'],
      body: t['onboarding.step3Body'],
      cta: t['onboarding.step3Cta'],
      href: hasSubject ? `/dashboard/subjects/${overview.subjects[0].subjectId}` : '/dashboard/subjects/new',
    },
  ];
  const showOnboarding = onboardingSteps.some((s) => !s.done);
  const showAcademicProfileCTA = !academicProfile?.profileCompleted;

  const achievementLines: string[] = [];
  if (overview.achievements.validatedMasteryCount > 0) {
    achievementLines.push(`${overview.achievements.validatedMasteryCount} ${t['progress.achievementValidatedMastery']}`);
  }
  if (overview.achievements.retentionDemonstratedCount > 0) {
    achievementLines.push(`${overview.achievements.retentionDemonstratedCount} ${t['progress.achievementRetention']}`);
  }
  if (overview.achievements.independentEvidenceCount > 0) {
    achievementLines.push(`${overview.achievements.independentEvidenceCount} ${t['progress.achievementIndependent']}`);
  }

  const capabilityKpis = knowledgeKpis({
    understandingScore: overview.capabilities.understandingScore,
    independenceScore: overview.capabilities.independenceScore,
    applicationScore: overview.capabilities.applicationScore,
    retentionScore: overview.capabilities.retentionScore,
    transferScore: overview.capabilities.transferScore,
  });
  const hasAnyCapability = capabilityKpis.some((k) => k.score !== null);

  return (
    <div>
      <div className="view-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-6)', marginBottom: 'var(--space-6)' }}>
        <div>
          <h1>{t['progress.title']}{firstName ? `, ${firstName}` : ''}</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>{t['progress.subtitle']}</p>
          <p style={{ color: 'var(--text-muted)', margin: '10px 0 0', fontSize: 14 }}>
            {t['progress.overallMasteryLabel']}:{' '}
            <strong className="tabular" style={{ color: 'var(--text-primary)' }}>
              {overview.overallMasteryPercent !== null ? `${overview.overallMasteryPercent}%` : t['dashboard.notEnoughEvidence']}
            </strong>
          </p>
        </div>
        <Link href="/dashboard/subjects/new" className="btn btn-primary">{t['dashboard.createSubject']}</Link>
      </div>

      {showOnboarding && (
        <OnboardingChecklist title={t['onboarding.title']} steps={onboardingSteps} dismissLabel={t['onboarding.dismiss']} />
      )}

      {showAcademicProfileCTA && (
        <AcademicProfileCTA
          title={t['profile.ctaTitle']}
          body={t['profile.ctaBody']}
          buttonLabel={t['profile.ctaButton']}
          dismissLabel={t['profile.ctaDismiss']}
        />
      )}

      {/* 1. What I've achieved */}
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h2 style={{ marginBottom: 'var(--space-3)', fontSize: 16 }}>{t['progress.achievementsTitle']}</h2>
        {achievementLines.length === 0 ? (
          <div className="card empty-state">
            <Trophy size={28} strokeWidth={1.5} color="var(--text-muted)" aria-hidden style={{ marginBottom: 'var(--space-2)' }} />
            <div>{t['dashboard.notEnoughEvidence']}</div>
          </div>
        ) : (
          <div className="card list-card">
            {achievementLines.map((line, i) => (
              <div key={i} className="list-row">
                <Trophy size={16} strokeWidth={1.75} color="var(--brand)" aria-hidden style={{ flexShrink: 0 }} />
                <div className="row-main">
                  <div className="row-title">{line}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. My learning capabilities */}
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h2 style={{ marginBottom: 'var(--space-3)', fontSize: 16 }}>{t['progress.capabilitiesTitle']}</h2>
        {hasAnyCapability ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-4)' }}>
            {capabilityKpis.map((kpi) => (
              <div key={kpi.labelKey} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                <div className="label" style={{ color: 'var(--text-muted)' }}>{t[kpi.labelKey]}</div>
                <div className="tabular" style={{ fontSize: 22, fontWeight: 650, lineHeight: 1 }}>
                  {kpi.score !== null ? `${Math.round(kpi.score)}%` : t['knowledgeState.pendingValidation']}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card empty-state">
            <div>{t['dashboard.notEnoughEvidence']}</div>
          </div>
        )}
      </div>

      {/* 3. Progress by subject/concept */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '8px 0 12px' }}>
        <h2>{t['progress.subjectsTitle']}</h2>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{overview.subjects.length} {t['dashboard.active']}</span>
      </div>

      {overview.subjects.length === 0 ? (
        <div className="card empty-state">
          <BookOpen size={32} strokeWidth={1.5} color="var(--brand)" aria-hidden style={{ marginBottom: 'var(--space-3)' }} />
          <strong>{t['dashboard.noSubjectsTitle']}</strong>
          {t['dashboard.noSubjectsBody']}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Link href="/dashboard/subjects/new" className="btn btn-primary">{t['subjectNew.submit']}</Link>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
          {overview.subjects.map((s: SubjectProgress) => {
            const accent = getSubjectAccentColor(s.subjectId);
            return (
              <div key={s.subjectId} className="card subject-accent" style={{ '--accent': accent } as React.CSSProperties}>
                <Link href={`/dashboard/subjects/${s.subjectId}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-4)' }}>
                  <h3 style={{ margin: 0 }}>{s.subjectName}</h3>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    {s.validatedCount}/{s.conceptCount} {t['progress.validatedLabel']}
                  </span>
                </Link>
                <div className="mastery-row" style={{ marginTop: 10 }}>
                  <div className="mastery-bar">
                    <span className={masteryFillClass(s.avgMasteryPercent ?? 0)} style={{ width: `${s.avgMasteryPercent ?? 0}%` }} />
                  </div>
                  <span className="mastery-pct tabular">{s.avgMasteryPercent !== null ? `${s.avgMasteryPercent}%` : '—'}</span>
                </div>

                {s.concepts.length > 0 && (
                  <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {s.concepts.map((c: ConceptProgress) => {
                      const kpis = knowledgeKpis(c.dimensions);
                      return (
                        <div key={c.conceptId} style={{ borderTop: '1px solid var(--border-default)', paddingTop: 'var(--space-3)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{c.label}</span>
                            <span
                              style={{
                                fontSize: 12, fontWeight: 650, color: masteryStateColor(c.masteryState),
                                border: `1px solid ${masteryStateColor(c.masteryState)}`, borderRadius: 999, padding: '2px 9px', flexShrink: 0,
                              }}
                            >
                              {masteryStateLabel(c.masteryState, t)}
                            </span>
                          </div>
                          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
                            {kpis.map((kpi) => (
                              <span key={kpi.labelKey} className="tabular">
                                {t[kpi.labelKey]}: {kpi.score !== null ? `${Math.round(kpi.score)}%` : t['knowledgeState.pendingValidation']}
                              </span>
                            ))}
                          </div>
                          {c.needsAttention.length > 0 && (
                            <div style={{ fontSize: 12.5, color: 'var(--warning)', marginTop: 6 }}>
                              {c.needsAttention.map((n, i) => (
                                <div key={i}>{n.description} · {n.occurrenceCount}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 4. What needs attention */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '8px 0 12px' }}>
        <h2>{t['progress.needsAttentionTitle']}</h2>
        <Link href="/dashboard/learning-debt" className="btn btn-ghost">{t['dashboard.viewAll']}</Link>
      </div>
      <div className="card list-card" style={{ marginBottom: 'var(--space-8)' }}>
        {overview.needsAttention.length === 0 ? (
          <div className="empty-state">
            <CheckCircle2 size={28} strokeWidth={1.5} color="var(--success)" aria-hidden style={{ marginBottom: 'var(--space-2)' }} />
            <div>{t['progress.needsAttentionEmpty']}</div>
          </div>
        ) : (
          overview.needsAttention.slice(0, 5).map((item) => (
            <div key={item.conceptId} className="list-row">
              <span
                style={{
                  width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                  background: item.severity >= 3 ? 'var(--error)' : 'var(--warning)',
                }}
              />
              <div className="row-main">
                <div className="row-title">{item.conceptLabel}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

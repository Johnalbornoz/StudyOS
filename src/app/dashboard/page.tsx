import { auth, currentUser } from '@clerk/nextjs/server';
import { QUANTITY_FILL_CLASS, journeyStageTone, progressFillClass } from '@/lib/experience/progress-tone';
import { PageIntro } from '@/components/ui/PageIntro';
import { Section } from '@/components/ui/Section';
import { Indicator } from '@/components/ui/Indicator';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveWorkspaceEntry } from '@/lib/identity/workspace-entry';
import { query } from '@/lib/db';
import { BookOpen, CheckCircle2, Trophy } from 'lucide-react';
import { getSubjectAccentColor } from '@/lib/subject-color';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getStudentProgressOverview, type SubjectProgress, type ConceptProgress } from '@/services/progress-overview.service';
import { knowledgeKpis } from '@/lib/knowledge-state-labels';
import SubjectSwitcher from './SubjectSwitcher';


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

  // A01-LOGIC-03: a non-Student workspace (e.g. an admin-only account) is
  // sent to its own home before any Student data is provisioned.
  const entry = await resolveWorkspaceEntry(clerkUserId);
  if (entry.kind === 'REDIRECT') redirect(entry.to);

  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId);
  const t = getMessages(locale);
  const user = await currentUser();
  const firstName = user?.firstName;

  // LX-2: Progress is a reporting surface only. First-time setup now
  // lives in /dashboard/onboarding (first-destination routing) and the
  // "what next" nudges belong to Today (LX-6) -- the old dismissible
  // onboarding / academic-profile cards were removed from this page.
  const overview = await getStudentProgressOverview(studentId, locale);

  const achievementLines: string[] = [];
  // UX-4 (GAP-07): "Dominado" is the authoritative journey stage
  // (CONSOLIDATED) -- the same count Mi ruta and Tu conocimiento show --
  // never the knowledge-state VALIDATED_MASTERY flag, a different authority.
  if (overview.achievements.consolidatedCount > 0) {
    achievementLines.push(t['pg.achievementConsolidated'].replace('{n}', String(overview.achievements.consolidatedCount)));
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

  const subjectNameById = new Map(overview.subjects.map((s) => [s.subjectId, s.subjectName]));
  const overall = overview.overallJourneyProgressPercent;

  return (
    <div className="xp-page xp-page--wide">
      <PageIntro
        title={`${t['progress.title']}${firstName ? `, ${firstName}` : ''}`}
        lead={t['pg.lead']}
        actions={
          overview.subjects.length > 0 ? (
            <SubjectSwitcher
              subjects={overview.subjects.map((s) => ({ id: s.subjectId, name: s.subjectName }))}
              currentId={null}
              label={t['ss.label']}
              placeholder={t['ss.label']}
              addLabel={t['ss.add']}
            />
          ) : (
            <Link href="/dashboard/subjects/new" className="btn btn-secondary">{t['dashboard.createSubject']}</Link>
          )
        }
      />

      {/* A -- the one learner-wide number: canonical journey progress (LX-9R5 H). */}
      <section className="card pg-hero" aria-labelledby="pg-overall">
        <div>
          <p id="pg-overall" className="pg-hero-label">{t['progress.overallJourneyLabel']}</p>
          {overall !== null ? (
            <>
              <span className="pg-hero-figure">{overall}%</span>
              <span className="ui-bar" aria-hidden>
                <span className={QUANTITY_FILL_CLASS} style={{ width: `${overall}%` }} />
              </span>
            </>
          ) : (
            <span className="pg-hero-figure pg-hero-figure--pending">{t['dashboard.notEnoughEvidence']}</span>
          )}
        </div>
        <div>
          <p className="pg-hero-label">{t['progress.achievementsTitle']}</p>
          {achievementLines.length === 0 ? (
            <p className="ui-hint" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>{t['dashboard.notEnoughEvidence']}</p>
          ) : (
            <ul className="pg-achievements">
              {achievementLines.map((line, i) => (
                <li key={i}>
                  <Trophy size={16} strokeWidth={1.75} color="var(--brand)" aria-hidden />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* B -- capabilities: existing dimension values; null is "Por validar", never 0%. */}
      <Section id="pg-capabilities" title={t['progress.capabilitiesTitle']}>
        {hasAnyCapability ? (
          <div className="ui-indicators">
            {capabilityKpis.map((kpi) => (
              <Indicator key={kpi.labelKey} label={t[kpi.labelKey]} value={kpi.score} pendingLabel={t['knowledgeState.pendingValidation']} />
            ))}
          </div>
        ) : (
          <div className="card empty-state">{t['dashboard.notEnoughEvidence']}</div>
        )}
      </Section>

      <div className="pg-layout">
        {/* C/D -- by subject, then concept rows with details on demand. */}
        <Section id="pg-subjects" title={t['progress.subjectsTitle']} action={<Link href="/dashboard/knowledge" className="ui-link">{t['kn.seeAll']}</Link>}>
          {overview.subjects.length === 0 ? (
            <div className="card empty-state">
              <BookOpen size={32} strokeWidth={1.5} color="var(--brand)" aria-hidden style={{ marginBottom: 'var(--space-3)' }} />
              <strong>{t['dashboard.noSubjectsTitle']}</strong>
              {t['pg.noSubjectsLead']}
              <div style={{ marginTop: 'var(--space-4)' }}>
                <Link href="/dashboard/subjects/new" className="btn btn-primary">{t['subjectNew.submit']}</Link>
              </div>
            </div>
          ) : (
            <ul className="pg-subjects">
              {overview.subjects.map((s: SubjectProgress) => (
                <li key={s.subjectId} className="card pg-subject subject-accent" style={{ '--accent': getSubjectAccentColor(s.subjectId) } as React.CSSProperties}>
                  <div className="pg-subject-head">
                    <div>
                      <Link href={`/dashboard/learn?subjectId=${s.subjectId}`} className="pg-subject-title">{s.subjectName}</Link>
                      <div className="pg-subject-meta">
                        {t['pg.consolidated'].replace('{n}', String(s.consolidatedCount)).replace('{total}', String(s.hierarchyConceptCount))}
                      </div>
                    </div>
                    {/* LX-9R1-R1: the subject's journey progress, as the service computes it (GAP-07 documented). */}
                    <span className="pg-subject-figure" title={t['subjectDetail.journeyProgressLabel']}>
                      {s.journeyProgressPercent !== null ? `${s.journeyProgressPercent}%` : '—'}
                    </span>
                    <span className="ui-bar" aria-hidden>
                      <span className={QUANTITY_FILL_CLASS} style={{ width: `${s.journeyProgressPercent ?? 0}%` }} />
                    </span>
                  </div>
                  {s.concepts.length > 0 && (
                    <details className="pg-concepts">
                      <summary>{t['pg.conceptsToggle'].replace('{count}', String(s.concepts.length))}</summary>
                      <ul className="pg-concept-list">
                        {s.concepts.map((c: ConceptProgress) => {
                          const kpis = knowledgeKpis(c.dimensions);
                          const tone = journeyStageTone(c.journeyStage);
                          return (
                            <li key={c.conceptId}>
                              <details className="pg-concept">
                                <summary>
                                  <span className="pg-concept-name">{c.label}</span>
                                  {/* LX-9 FINAL M: primary status = the canonical journey stage Concept Mission shows. */}
                                  <span className={`pg-stage${tone === 'active' ? ' pg-stage--active' : tone === 'strong' ? ' pg-stage--strong' : tone === 'attention' ? ' pg-stage--attention' : ''}`}>
                                    {t[c.journeyProgressLabelKey]}
                                  </span>
                                  <span className="pg-concept-pct">
                                    <span>{c.journeyProgressPercent}%</span>
                                    <span className="ui-bar" aria-hidden>
                                      <span className={progressFillClass(tone)} style={{ width: `${c.journeyProgressPercent}%` }} />
                                    </span>
                                  </span>
                                </summary>
                                <div className="pg-concept-detail">
                                  <ul className="pg-dims">
                                    {kpis.map((kpi) => (
                                      <li key={kpi.labelKey}>
                                        <span>{t[kpi.labelKey]}</span>
                                        {kpi.score !== null ? (
                                          <strong>{Math.round(kpi.score)}%</strong>
                                        ) : (
                                          <strong className="pending">{t['knowledgeState.pendingValidation']}</strong>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                  {c.needsAttention.length > 0 && (
                                    <ul className="pg-misconceptions">
                                      {c.needsAttention.map((n, i) => (
                                        <li key={i}>{n.description} · {n.occurrenceCount}</li>
                                      ))}
                                    </ul>
                                  )}
                                  <div style={{ marginTop: 'var(--space-3)' }}>
                                    <Link href={`/dashboard/subjects/${s.subjectId}/concepts/${c.conceptId}`} className="ui-link">{t['xp.openConcept']}</Link>
                                  </div>
                                </div>
                              </details>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* E -- needs attention: the existing list, each item one tap from its concept. */}
        <Section id="pg-attention" title={t['progress.needsAttentionTitle']} action={<Link href="/dashboard/learning-debt" className="ui-link">{t['dashboard.viewAll']}</Link>}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {overview.needsAttention.length === 0 ? (
              <div className="empty-state">
                <CheckCircle2 size={28} strokeWidth={1.5} color="var(--success)" aria-hidden style={{ marginBottom: 'var(--space-2)' }} />
                <div>{t['progress.needsAttentionEmpty']}</div>
              </div>
            ) : (
              <ul className="pg-attention">
                {overview.needsAttention.slice(0, 5).map((item) => (
                  <li key={item.conceptId}>
                    <Link href={`/dashboard/subjects/${item.subjectId}/concepts/${item.conceptId}`}>
                      <span className="pg-attention-dot" style={{ background: item.severity >= 3 ? 'var(--error)' : 'var(--warning)' }} aria-hidden />
                      <span className="pg-attention-name">
                        {item.conceptLabel}
                        {subjectNameById.get(item.subjectId) && <span className="pg-attention-subject">{subjectNameById.get(item.subjectId)}</span>}
                      </span>
                      <span className="pg-attention-cta">{t['pg.workOnIt']}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}

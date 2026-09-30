import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { AlertTriangle, BadgeCheck, CheckCircle2, Circle, CircleDot, Crosshair } from 'lucide-react';
import type { ReactNode } from 'react';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { loadMyPathContext, buildSubjectPathView, type ConceptPathView, type SubjectPathView } from '@/lib/lx/path-view';
import {
  KNOWLEDGE_STATES,
  countKnowledgeStates,
  knowledgeMeaningKey,
  knowledgeMeaningOf,
  knowledgeStateKey,
  knowledgeStateOf,
  type KnowledgeState,
} from '@/lib/experience/knowledge';
import { PageIntro } from '@/components/ui/PageIntro';
import { InlineAlert } from '@/components/ui/InlineAlert';
import StageTrack from '../StageTrack';

/**
 * UX-4 -- TU CONOCIMIENTO.
 *
 * What StudyUS knows about what the Student knows, as a Subject -> Topic ->
 * Concept map. A presentation of the SAME authoritative assembly My Path
 * already builds (`loadMyPathContext` + `buildSubjectPathView`: the
 * hierarchy from `getSubjectHierarchy`, each concept's canonical-aware
 * journey from `resolveConceptJourneyResultAuthoritative`, `hasEvidence`
 * from the hierarchy read). The focus concept is the snapshot's own next
 * executable item -- the one Today launches. No new metric, no edges
 * (DEV holds no `concept_relationships`; none are invented), no stage choice.
 *
 * The map IS the accessible structure: headings, lists and native
 * <details> disclosures -- there is no graphic-only channel.
 */

const STATE_ICON: Record<KnowledgeState, ReactNode> = {
  MASTERED: <CheckCircle2 size={16} strokeWidth={2.2} aria-hidden />,
  DEMONSTRATED: <BadgeCheck size={16} strokeWidth={2.2} aria-hidden />,
  IN_PROGRESS: <CircleDot size={16} strokeWidth={2.2} aria-hidden />,
  ATTENTION: <AlertTriangle size={16} strokeWidth={2.2} aria-hidden />,
  NOT_STARTED: <Circle size={16} strokeWidth={2.2} aria-hidden />,
};

interface ConceptView {
  concept: ConceptPathView;
  state: KnowledgeState;
  isFocus: boolean;
}

function allConcepts(v: SubjectPathView): ConceptPathView[] {
  return [...v.topics.flatMap((t) => t.concepts), ...v.unassigned];
}

export default async function KnowledgePage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return (
      <div>
        <h1>Not authenticated</h1>
        <Link href="/sign-in">Sign in</Link>
      </div>
    );
  }

  // Ownership: every read below is keyed by the signed-in Student's own id.
  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId);
  const t = getMessages(locale);

  const context = await loadMyPathContext(studentId, locale);
  const views: SubjectPathView[] = context.snapshotReadFailed
    ? []
    : await Promise.all(context.activeSubjects.map((s) => buildSubjectPathView(context, s.id, s.name)));
  const focusConceptId = context.snapshot?.nextExecutableItem?.decision.actionConceptId ?? null;

  // "Has this Student worked on it?" -- the canonical engine's own evidence
  // (engineHasEvidence) when available; the hierarchy's flag only on the
  // legacy path. A mastery row with no attempts is NOT work.
  const workedOn = (c: ConceptPathView) => c.journey.engineHasEvidence ?? c.hasEvidence;
  const view = (c: ConceptPathView): ConceptView => ({
    concept: c,
    state: knowledgeStateOf(c.journey, workedOn(c)),
    isFocus: c.conceptId === focusConceptId,
  });
  const everyConcept = views.flatMap(allConcepts).map(view);
  const counts = countKnowledgeStates(everyConcept.map((c) => c.state));
  const hasEvidence = everyConcept.some((c) => workedOn(c.concept));
  const focus = everyConcept.find((c) => c.isFocus) ?? null;
  const focusSubject = focus ? views.find((v) => allConcepts(v).some((c) => c.conceptId === focus.concept.conceptId)) : null;

  const stateLabel = (s: KnowledgeState) => t[knowledgeStateKey(s)];

  const conceptItem = (c: ConceptView, subjectId: string) => (
    <li key={c.concept.conceptId} className="kn-concept" data-state={c.state} data-focus={c.isFocus || undefined}>
      <details className="kn-concept-disclosure">
        <summary>
          <span className="kn-state-icon" aria-hidden>{STATE_ICON[c.state]}</span>
          <span className="kn-concept-name">{c.concept.title}</span>
          <span className="kn-concept-state">
            {c.isFocus && <span className="kn-focus-chip">{t['kn.focus']}</span>}
            <span className="kn-state-label">{stateLabel(c.state)}</span>
          </span>
        </summary>
        <div className="kn-detail">
          <p className="kn-detail-meaning">{t[knowledgeMeaningKey(knowledgeMeaningOf(c.concept.journey, workedOn(c.concept)))]}</p>
          <StageTrack journey={c.concept.journey} t={t} variant="light" />
          <div className="kn-detail-actions">
            {c.isFocus && (
              <Link href="/dashboard/today" className="btn btn-primary">{t['kn.goToChallenge']}</Link>
            )}
            <Link href={`/dashboard/subjects/${subjectId}/concepts/${c.concept.conceptId}`} className="btn btn-secondary">
              {t['kn.viewConcept']}
            </Link>
            {/* UX-5: contextual Tutor entry -- starts a conversation about THIS concept (ownership verified server-side). */}
            <Link href={`/dashboard/tutor?subjectId=${subjectId}&conceptId=${c.concept.conceptId}`} className="btn btn-ghost">
              {t['tt.askTutor']}
            </Link>
          </div>
        </div>
      </details>
    </li>
  );

  return (
    <div className="xp-page xp-page--wide">
      <PageIntro title={t['kn.title']} lead={t['kn.lead']} />

      {context.snapshotReadFailed ? (
        <InlineAlert
          tone="error"
          title={t['kn.loadError']}
          actions={<Link href="/dashboard/knowledge" className="btn btn-secondary">{t['practice.prepareRetry']}</Link>}
        />
      ) : views.length === 0 ? (
        <section className="card kn-empty">
          <p className="kn-empty-title">{t['kn.emptyTitle']}</p>
          <p className="kn-empty-body">{t['kn.emptyBody']}</p>
          <Link href="/dashboard/subjects/new" className="btn btn-primary">{t['dashboard.createSubject']}</Link>
        </section>
      ) : (
        <>
          {/* Overview: how many concepts sit in each state (a count, never a score). */}
          <section className="kn-summary" aria-labelledby="kn-summary-title">
            <h2 id="kn-summary-title" className="sr-only">{t['kn.summaryTitle']}</h2>
            <ul className="kn-counts">
              {KNOWLEDGE_STATES.filter((s) => s !== 'ATTENTION' || counts.ATTENTION > 0).map((s) => (
                <li key={s} className="kn-count" data-state={s}>
                  <span className="kn-state-icon" aria-hidden>{STATE_ICON[s]}</span>
                  <span className="kn-count-value">{counts[s]}</span>
                  <span className="kn-count-label">{stateLabel(s)}</span>
                </li>
              ))}
            </ul>
            {!hasEvidence && <p className="kn-note">{t['kn.noEvidence']}</p>}
            {focus && focusSubject && (
              <div className="kn-focus">
                <span className="kn-state-icon" aria-hidden><Crosshair size={16} strokeWidth={2.2} /></span>
                <p className="kn-focus-text">
                  <span className="kn-focus-label">{t['kn.focusNow']}</span>{' '}
                  <strong>{focus.concept.title}</strong> · {focusSubject.title}
                </p>
                <Link href="/dashboard/today" className="btn btn-primary">{t['kn.goToChallenge']}</Link>
              </div>
            )}
          </section>

          {views.map((v) => {
            const concepts = allConcepts(v).map(view);
            const subjectCounts = countKnowledgeStates(concepts.map((c) => c.state));
            const total = concepts.length;
            const groups = [
              ...v.topics.map((topic) => ({ id: topic.topicId, title: topic.title, concepts: topic.concepts.map(view) })),
              ...(v.unassigned.length > 0 ? [{ id: `${v.subjectId}-other`, title: t['kn.otherConcepts'], concepts: v.unassigned.map(view) }] : []),
            ].filter((g) => g.concepts.length > 0);
            return (
              <section key={v.subjectId} className="kn-subject" aria-labelledby={`kn-s-${v.subjectId}`}>
                <header className="kn-subject-head">
                  <div>
                    <h2 id={`kn-s-${v.subjectId}`} className="kn-subject-title">{v.title}</h2>
                    <p className="kn-subject-meta">
                      {t['pg.consolidated'].replace('{n}', String(subjectCounts.MASTERED)).replace('{total}', String(total))}
                    </p>
                  </div>
                  {/* Distribution of the subject's concepts by state -- each segment is also listed in text below. */}
                  {total > 0 && (
                    <span className="kn-dist" aria-hidden>
                      {KNOWLEDGE_STATES.map((s) =>
                        subjectCounts[s] > 0 ? <span key={s} className="kn-dist-seg" data-state={s} style={{ flexGrow: subjectCounts[s] }} /> : null,
                      )}
                    </span>
                  )}
                </header>
                {total === 0 ? (
                  <p className="kn-note">{t['kn.subjectEmpty']}</p>
                ) : (
                  <div className="kn-topics">
                    {groups.map((g) => {
                      const hasFocus = g.concepts.some((c) => c.isFocus);
                      const gCounts = countKnowledgeStates(g.concepts.map((c) => c.state));
                      return (
                        <details key={g.id} className="kn-topic" open data-focus={hasFocus || undefined}>
                          <summary className="kn-topic-head">
                            <span className="kn-topic-title">{g.title}</span>
                            <span className="kn-topic-meta">
                              {t['kn.topicCount'].replace('{n}', String(gCounts.MASTERED)).replace('{total}', String(g.concepts.length))}
                            </span>
                          </summary>
                          <ul className="kn-concepts">{g.concepts.map((c) => conceptItem(c, v.subjectId))}</ul>
                        </details>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

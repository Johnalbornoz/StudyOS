import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { AlertTriangle, BadgeCheck, CheckCircle2, ChevronRight, Circle, CircleDot } from 'lucide-react';
import type { ReactNode } from 'react';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { loadMyPathContext, buildSubjectPathView, type ConceptPathView, type SubjectPathView } from '@/lib/lx/path-view';
import { isRetentionWaiting } from '@/lib/lx/learner-journey-contract';
import { loadConceptNextChallenge } from '@/lib/experience/next-challenge.server';
import type { NextChallengeView } from '@/lib/experience/next-challenge';
import { knowledgeStateKey, knowledgeStateOf, type KnowledgeState } from '@/lib/experience/knowledge';
import type { FinderConcept } from '@/lib/experience/concept-finder';
import { PageIntro } from '@/components/ui/PageIntro';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { Section } from '@/components/ui/Section';
import NextChallengeCard from '../NextChallengeCard';
import SubjectSwitcher from '../SubjectSwitcher';
import ConceptFinder from './ConceptFinder';

/**
 * UX-5 closure -- APRENDER.
 *
 * One learner-facing place for "what am I learning": the subject (with a
 * switcher), that subject's next canonical challenge, finding / adding a
 * concept, and the subject's topics -> concepts with their state. It
 * absorbs the day-to-day value of Mi ruta, Tu conocimiento and Materias,
 * which stay as detail routes.
 *
 * PRESENTATION ONLY: every read is the same authoritative assembly Mi ruta
 * and Tu conocimiento use (`loadMyPathContext` + `buildSubjectPathView`),
 * the hero is the SAME `loadConceptNextChallenge` presenter + Start button,
 * and the concept order is the engine's own. Nothing is decided here.
 */

const STATE_ICON: Record<KnowledgeState, ReactNode> = {
  MASTERED: <CheckCircle2 size={16} strokeWidth={2.2} aria-hidden />,
  DEMONSTRATED: <BadgeCheck size={16} strokeWidth={2.2} aria-hidden />,
  IN_PROGRESS: <CircleDot size={16} strokeWidth={2.2} aria-hidden />,
  ATTENTION: <AlertTriangle size={16} strokeWidth={2.2} aria-hidden />,
  NOT_STARTED: <Circle size={16} strokeWidth={2.2} aria-hidden />,
};

const allConcepts = (v: SubjectPathView): ConceptPathView[] => [...v.topics.flatMap((t) => t.concepts), ...v.unassigned];

export default async function LearnPage({ searchParams }: { searchParams: Promise<{ subjectId?: string }> }) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return (
      <div>
        <h1>Not authenticated</h1>
        <Link href="/sign-in">Sign in</Link>
      </div>
    );
  }

  // Ownership: every read is keyed by the signed-in Student; a subjectId
  // from the URL is only honoured when it is one of THEIR active subjects.
  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId);
  const t = getMessages(locale);
  const { subjectId: requested } = await searchParams;

  const context = await loadMyPathContext(studentId, locale);
  const subjects = context.activeSubjects;
  const focusDecision = context.snapshot?.nextExecutableItem?.decision ?? null;
  const selected =
    subjects.find((s) => s.id === requested) ??
    subjects.find((s) => s.id === focusDecision?.subjectId) ??
    subjects[0] ??
    null;

  const switcher = (
    <SubjectSwitcher
      subjects={subjects}
      currentId={selected?.id ?? null}
      label={t['ss.label']}
      placeholder={t['ss.placeholder']}
      addLabel={t['ss.add']}
    />
  );

  if (!selected) {
    return (
      <div className="xp-page xp-page--wide">
        <PageIntro title={t['ln.title']} lead={t['ln.lead']} />
        <section className="card kn-empty">
          <p className="kn-empty-title">{t['sp.title']}</p>
          <Link href="/dashboard/subjects/new" className="btn btn-primary">{t['ss.add']}</Link>
        </section>
      </div>
    );
  }

  let view: SubjectPathView | null = null;
  let failed = context.snapshotReadFailed;
  if (!failed) {
    try {
      view = await buildSubjectPathView(context, selected.id, selected.name);
    } catch (err) {
      failed = true;
      console.error('[learn] subject view failed:', err instanceof Error ? err.message : String(err));
    }
  }

  const concepts = view ? allConcepts(view) : [];
  const workedOn = (c: ConceptPathView) => c.journey.engineHasEvidence ?? c.hasEvidence;
  const hasNotStarted = concepts.some((c) => knowledgeStateOf(c.journey, workedOn(c)) === 'NOT_STARTED');

  // The hero: this subject's first executable decision in the engine's OWN
  // order -- the global next challenge when it is in this subject, else the
  // first daily-plan item / decision for this subject. Never a new pick.
  const snapshot = context.snapshot;
  const decision =
    (focusDecision?.subjectId === selected.id ? focusDecision : null) ??
    snapshot?.dailyPlan.items.find((i) => i.decision.subjectId === selected.id)?.decision ??
    snapshot?.decisions.find((d) => d.subjectId === selected.id) ??
    null;
  const heroConcept = decision ? concepts.find((c) => c.conceptId === decision.actionConceptId) ?? null : null;
  const hero: NextChallengeView | null =
    decision && heroConcept
      ? await loadConceptNextChallenge({
          studentId,
          subjectId: selected.id,
          conceptId: decision.actionConceptId,
          legacyDecision: decision,
          snapshot,
          legacyGate: {
            waiting:
              !heroConcept.journey.intervention &&
              isRetentionWaiting(heroConcept.journey.currentStage, context.memorySignals.get(decision.actionConceptId)?.retentionDue),
            nextEligibleAt: context.memorySignals.get(decision.actionConceptId)?.nextReviewAt ?? null,
            zeroGapBlocked: false,
          },
        }).catch(() => null)
      : null;
  const heroMinutes = snapshot?.dailyPlan.items.find((i) => i.decision.actionConceptId === decision?.actionConceptId)?.estimatedMinutes ?? null;

  // Every concept the Student already has, for "find a concept" (resolved
  // against existing concepts before anything new is proposed).
  const otherViews = failed
    ? []
    : await Promise.all(
        subjects.filter((s) => s.id !== selected.id).map((s) => buildSubjectPathView(context, s.id, s.name).catch(() => null)),
      );
  const finderConcepts: FinderConcept[] = [view, ...otherViews]
    .filter((v): v is SubjectPathView => !!v)
    .flatMap((v) => [
      ...v.topics.flatMap((tp) => tp.concepts.map((c) => ({ id: c.conceptId, title: c.title, topic: tp.title, subjectId: v.subjectId, subjectName: v.title }))),
      ...v.unassigned.map((c) => ({ id: c.conceptId, title: c.title, topic: null, subjectId: v.subjectId, subjectName: v.title })),
    ]);

  const groups = view
    ? [
        ...view.topics.map((tp) => ({ id: tp.topicId, title: tp.title, concepts: tp.concepts })),
        ...(view.unassigned.length > 0 ? [{ id: 'other', title: t['kn.otherConcepts'], concepts: view.unassigned }] : []),
      ].filter((g) => g.concepts.length > 0)
    : [];

  return (
    <div className="xp-page xp-page--wide">
      <PageIntro title={t['ln.title']} lead={t['ln.lead']} actions={switcher} />

      {failed ? (
        <InlineAlert
          tone="error"
          title={t['kn.loadError']}
          actions={<a href={`/dashboard/learn?subjectId=${selected.id}`} className="btn btn-secondary">{t['practice.prepareRetry']}</a>}
        />
      ) : concepts.length === 0 ? (
        // First concept of this subject: the question IS the page.
        <section className="card ln-start" aria-labelledby="ln-start-title">
          <h2 id="ln-start-title" className="ln-start-title">{t['ln.startTitle'].replace('{subject}', selected.name)}</h2>
          <p className="ln-start-body">{t['ln.startBody']}</p>
          <ConceptFinder studentId={studentId} subjectId={selected.id} subjectName={selected.name} locale={locale} concepts={finderConcepts} autoFocus />
        </section>
      ) : (
        <>
          {hero && heroConcept ? (
            <NextChallengeCard
              view={hero}
              conceptLabel={heroConcept.title}
              subjectName={selected.name}
              studentId={studentId}
              t={t}
              locale={locale}
              legacyMinutes={heroMinutes}
              fallbackJourney={heroConcept.journey}
              launchMark="LEARN_ACTION_LAUNCHED"
            />
          ) : (
            // No engine decision for this subject right now. When some concept
            // has not been started (e.g. just added), say how to begin --
            // from the concepts' own states; nothing is picked here.
            <section className="xp-hero xp-hero--calm" aria-labelledby="ln-quiet">
              <h2 id="ln-quiet" className="xp-hero-title">{hasNotStarted ? t['ln.pickTitle'] : t['ln.quietTitle']}</h2>
              <p className="xp-hero-why">{hasNotStarted ? t['ln.pickBody'] : t['ln.quietBody']}</p>
            </section>
          )}

          <Section id="ln-find" title={t['ln.findTitle']}>
            <ConceptFinder studentId={studentId} subjectId={selected.id} subjectName={selected.name} locale={locale} concepts={finderConcepts} />
          </Section>

          <Section
            id="ln-topics"
            title={t['ln.topicsTitle'].replace('{subject}', selected.name)}
            action={<Link href={`/dashboard/path/${selected.id}`} className="ui-link">{t['ln.pathLink']}</Link>}
          >
            <div className="ln-topics">
              {groups.map((g) => (
                <section key={g.id} className="ln-topic" aria-labelledby={`ln-t-${g.id}`}>
                  <h3 id={`ln-t-${g.id}`} className="ln-topic-title">{g.title}</h3>
                  <ul className="ln-concepts">
                    {g.concepts.map((c) => {
                      const state = knowledgeStateOf(c.journey, workedOn(c));
                      const isNext = c.conceptId === heroConcept?.conceptId;
                      return (
                        <li key={c.conceptId}>
                          <Link href={`/dashboard/subjects/${selected.id}/concepts/${c.conceptId}`} className="ln-concept" data-state={state}>
                            <span className="kn-state-icon" aria-hidden>{STATE_ICON[state]}</span>
                            <span className="ln-concept-name">{c.title}</span>
                            <span className="ln-concept-state">
                              {isNext && <span className="kn-focus-chip">{t['ln.next']}</span>}
                              <span className="kn-state-label">{t[knowledgeStateKey(state)]}</span>
                            </span>
                            <ChevronRight size={16} strokeWidth={2} aria-hidden className="ln-concept-go" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
            <p className="ln-more">
              <Link href="/dashboard/knowledge" className="ui-link">{t['kn.seeAll']}</Link>
            </p>
          </Section>
        </>
      )}
    </div>
  );
}

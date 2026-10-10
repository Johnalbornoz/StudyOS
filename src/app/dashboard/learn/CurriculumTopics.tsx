'use client';

/**
 * T1 final delta (E) -- "Temas de tu currículo — <programme · subject · level>".
 *
 * The curriculum's own topic structure with the concepts inside each topic (subject-curriculum-topics.ts).
 * Every concept is one ConceptActionRow: its name and, beside it, either "Añadir a mi plan" (an explicit
 * action -- nothing is activated automatically) or the "Añadido" state with a link to open it.
 * A curriculum without a loaded structure says so.
 *
 * M02b: the expanded topics are controlled state (open-topics.ts). A successful add refreshes the server
 * data but the topic stays expanded, the clicked concept turns into "Añadido" in place and its siblings
 * stay visible and actionable.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import Link from 'next/link';
import type { CurriculumTopic } from '@/lib/learning-plan/subject-curriculum-topics';
import { openTopicsStorageKey, parseOpenTopics, toggleOpenTopic } from '@/lib/learning-plan/open-topics';
import { ConceptActionRow } from '@/components/ui/ConceptActionRow';
import { AddToPlanButton } from '../plan/PlanActions';

type L = Record<string, string>;
// Before paint on the client (no flash of a collapsed topic after a remount); a no-op on the server.
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export default function CurriculumTopics({ subjectId, title, reason, topics, labels: l, initialOpen = [] }: {
  subjectId: string;
  /** "Temas de tu currículo — IB Diploma Programme · Física · Nivel Superior (NS)" */
  title: string;
  /** Why this curriculum (exam preparation / academic profile), already in the interface locale; null when unknown. */
  reason: string | null;
  topics: CurriculumTopic[];
  labels: L;
  /** Topic keys expanded from the start (default: all closed). */
  initialOpen?: string[];
}) {
  const [open, setOpen] = useState<string[]>(initialOpen);
  const storageKey = openTopicsStorageKey(subjectId);
  useBeforePaint(() => {
    try {
      const stored = parseOpenTopics(window.sessionStorage.getItem(storageKey), topics.map((t) => t.key));
      if (stored.length) setOpen((current) => [...new Set([...current, ...stored])]);
    } catch {
      /* storage unavailable: the section simply starts collapsed */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const setTopicOpen = (topicKey: string, isOpen: boolean) => {
    setOpen((current) => {
      if (current.includes(topicKey) === isOpen) return current;
      const next = toggleOpenTopic(current, topicKey, isOpen);
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };
  const count = (n: number) => (n === 1 ? l['acp.learn.curriculum.concepts.one'] : (l['acp.learn.curriculum.concepts.other'] ?? '{n}').replace('{n}', String(n)));
  return (
    <section className="ln-curriculum" aria-labelledby="ln-curriculum-title" data-curriculum-topics>
      <div className="ui-section-head">
        <h2 id="ln-curriculum-title" className="ui-section-title">{title}</h2>
      </div>
      <p className="ui-hint">{[reason, l['acp.learn.curriculum.lead']].filter(Boolean).join(' ')}</p>
      {topics.length === 0 ? (
        <p className="card ln-curriculum-empty" data-curriculum-empty>{l['acp.learn.curriculum.empty']}</p>
      ) : (
        <div className="ln-curriculum-list">
          {topics.map((topic, ti) => (
            <details
              key={topic.key}
              className="prep-group ln-curriculum-topic"
              data-curriculum-topic
              open={open.includes(topic.key)}
              onToggle={(e) => setTopicOpen(topic.key, (e.currentTarget as HTMLDetailsElement).open)}
            >
              <summary className="prep-group-head">
                <span className="prep-group-name">{topic.title}</span>
                <span className="ui-hint prep-group-count">{[topic.component, count(topic.concepts.length)].filter(Boolean).join(' · ')}</span>
              </summary>
              <ul className="concept-action-list">
                {topic.concepts.map((c, ci) => {
                  const nameId = `ln-cur-${ti}-${ci}`;
                  return (
                    <li key={c.canonicalConceptId}>
                      {c.added ? (
                        <ConceptActionRow
                          nameId={nameId}
                          name={c.label}
                          state="added"
                          action={
                            <>
                              <span className="xr-pill is-good concept-action-added" data-concept-added>{l['acp.learn.curriculum.added']}</span>
                              {c.learnerConceptId ? (
                                <Link href={`/dashboard/subjects/${c.learnerSubjectId ?? subjectId}/concepts/${c.learnerConceptId}`} className="btn btn-secondary" aria-describedby={nameId}>
                                  {l['acp.learn.curriculum.open']}
                                </Link>
                              ) : null}
                            </>
                          }
                        />
                      ) : (
                        <ConceptActionRow
                          nameId={nameId}
                          name={c.label}
                          action={
                            <AddToPlanButton
                              canonicalConceptId={c.canonicalConceptId}
                              source="CURRICULUM_RECOMMENDATION"
                              describedBy={nameId}
                              // Keep this topic expanded through the refresh that follows the add.
                              onAdded={() => setTopicOpen(topic.key, true)}
                              labels={{ add: l['lp.explore.add'], adding: l['lp.explore.adding'], error: l['lp.error'], added: l['acp.learn.curriculum.added'], addFor: (l['acp.learn.curriculum.addFor'] ?? '{concept}').replace('{concept}', c.label) }}
                            />
                          }
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

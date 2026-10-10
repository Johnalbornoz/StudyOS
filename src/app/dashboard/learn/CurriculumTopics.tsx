/**
 * T1 final delta (E) -- "Temas de tu currículo — <programme · subject · level>".
 *
 * The curriculum's own topic structure with the concepts inside each topic (subject-curriculum-topics.ts).
 * Every concept is one ConceptActionRow: its name and, beside it, either "Añadir a mi plan" (an explicit
 * action -- nothing is activated automatically) or the "Añadido" state with a link to open it.
 * A curriculum without a loaded structure says so.
 */
import Link from 'next/link';
import type { CurriculumTopic } from '@/lib/learning-plan/subject-curriculum-topics';
import { ConceptActionRow } from '@/components/ui/ConceptActionRow';
import { AddToPlanButton } from '../plan/PlanActions';

type L = Record<string, string>;

export default function CurriculumTopics({ subjectId, title, reason, topics, labels: l }: {
  subjectId: string;
  /** "Temas de tu currículo — IB Diploma Programme · Física · Nivel Superior (NS)" */
  title: string;
  /** Why this curriculum (exam preparation / academic profile), already in the interface locale; null when unknown. */
  reason: string | null;
  topics: CurriculumTopic[];
  labels: L;
}) {
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
            <details key={topic.key} className="prep-group ln-curriculum-topic" data-curriculum-topic>
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

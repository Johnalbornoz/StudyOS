/**
 * T1 final delta (E) -- "Temas de tu currículo — <programme · subject · level>".
 *
 * The curriculum's own topic structure with the concepts inside each topic (subject-curriculum-topics.ts).
 * A concept the Student already studies links to it; any other concept can be added to their plan by an
 * explicit action. Nothing is activated automatically, and a curriculum without a loaded structure says so.
 */
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { CurriculumTopic } from '@/lib/learning-plan/subject-curriculum-topics';
import { AddToPlanButton } from '../plan/PlanActions';

type L = Record<string, string>;

export default function CurriculumTopics({ subjectId, title, reason, topics, labels: l }: {
  subjectId: string;
  /** "Temas de tu currículo — IB Diploma Programme · Física · HL" */
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
          {topics.map((topic) => (
            <details key={topic.key} className="prep-group ln-curriculum-topic" data-curriculum-topic>
              <summary className="prep-group-head">
                <span className="prep-group-name">{topic.title}</span>
                <span className="ui-hint prep-group-count">{[topic.component, count(topic.concepts.length)].filter(Boolean).join(' · ')}</span>
              </summary>
              <ul className="ln-concepts">
                {topic.concepts.map((c) => (
                  <li key={c.canonicalConceptId}>
                    {c.learnerConceptId ? (
                      <Link href={`/dashboard/subjects/${subjectId}/concepts/${c.learnerConceptId}`} className="ln-concept">
                        <span className="ln-concept-name">{c.label}</span>
                        <span className="ln-concept-state"><span className="kn-state-label">{l['acp.learn.curriculum.inLearning']}</span></span>
                        <ChevronRight size={16} strokeWidth={2} aria-hidden className="ln-concept-go" />
                      </Link>
                    ) : (
                      <div className="ln-concept ln-concept--catalog">
                        <span className="ln-concept-name">{c.label}</span>
                        <AddToPlanButton canonicalConceptId={c.canonicalConceptId} source="CURRICULUM_RECOMMENDATION" labels={{ add: l['lp.explore.add'], adding: l['lp.explore.adding'], error: l['lp.error'] }} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

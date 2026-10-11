/**
 * L7 PA-3 -- released exam results of the selected child, as summaries.
 * Presentational: the page loads them from /api/parent/learners/[id]/results,
 * which decides what is released. There is no link to a per-question review:
 * a Parent never receives one.
 */
import { fillMessage } from '@/lib/i18n/roles-messages';
import type { ParentHomeMessages } from '@/lib/i18n/parent-home-messages';

export interface ParentResultSummary {
  attemptId: string;
  examName: string;
  versionLabel: string;
  status: 'SCORED' | 'INVALIDATED';
  scoringStatus: 'SCORED' | 'NO_SCORING_POLICY';
  scoredAt: string;
  rawScore: number;
  maxScore: number;
  finalScore: number | null;
  finalLabel: string | null;
  completion: { answered: number; total: number; missing: number } | null;
  minutesUsed: number | null;
  objectives: { strengths: number; developing: number; gaps: number; notAssessed: number };
}

/** The score line for one result: the exam's own final score when it has one, otherwise raw marks. */
export function resultScoreLine(r: ParentResultSummary, l: ParentHomeMessages): string {
  if (r.scoringStatus !== 'SCORED') return l['ph.results.noScore'];
  const raw = fillMessage(l['ph.results.score'], { earned: r.rawScore, max: r.maxScore });
  const final = r.finalLabel ?? (r.finalScore === null ? null : String(r.finalScore));
  return final ? `${fillMessage(l['ph.results.scoreFinal'], { score: final })} · ${raw}` : raw;
}

export default function ParentResultsCard({ results, childName, labels: l, locale }: { results: ParentResultSummary[]; childName: string; labels: ParentHomeMessages; locale: string }) {
  return (
    <section className="card ta-card" aria-labelledby="results-title" data-parent-results>
      <h3 id="results-title">{l['ph.results.title']}</h3>
      <p className="ta-msg">{fillMessage(l['ph.results.body'], { name: childName })}</p>
      {results.length === 0 ? (
        <p className="ta-msg">{l['ph.results.empty']}</p>
      ) : (
        <ul className="role-list">
          {results.map((r) => {
            const assessed = r.objectives.strengths + r.objectives.developing + r.objectives.gaps;
            return (
              <li key={r.attemptId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <strong style={{ fontSize: 14, overflowWrap: 'anywhere' }}>
                    {r.examName} · {r.versionLabel}
                  </strong>
                  <span className="ta-msg">{new Date(r.scoredAt).toLocaleDateString(locale)}</span>
                </div>
                <div className="ta-actions">
                  <span className="ta-msg" style={{ color: 'var(--text-primary)' }}>{resultScoreLine(r, l)}</span>
                  {r.status === 'INVALIDATED' && <span className="chip chip-critical">{l['ph.results.invalidated']}</span>}
                </div>
                {r.status === 'INVALIDATED' && <p className="ta-msg">{l['ph.results.invalidatedNote']}</p>}
                {assessed > 0 && <p className="ta-msg">{fillMessage(l['ph.results.objectives'], r.objectives)}</p>}
                <p className="ta-msg">
                  {[
                    r.completion ? fillMessage(l['ph.results.completion'], { answered: r.completion.answered, total: r.completion.total }) : null,
                    r.minutesUsed === null ? null : fillMessage(l['ph.results.minutes'], { minutes: r.minutesUsed }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

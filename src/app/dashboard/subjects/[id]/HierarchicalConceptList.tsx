'use client';

import { useState } from 'react';
import { getMessages, Locale } from '@/lib/i18n/messages';
import ConceptList from './ConceptList';
import { SubjectHierarchy, HierarchyConcept } from '@/services/topic-hierarchy.service';
import type { MasteryState } from '@/services/knowledge-state.service';
import type { LearnerJourneyStage } from '@/lib/lx/concept-journey';
import { averageJourneyProgress } from '@/lib/lx/journey-progress';

const UNASSIGNED_KEY = '__unassigned__';

/**
 * LX-9R1: topic/subtopic/subject aggregates are now the mean of each
 * concept's canonical journey progress percentage (R7) -- never an
 * average of the raw `mastery_score` values `averageMastery` used to
 * compute. Every concept in the group counts, including ones with no
 * active decision/knowledge-state yet (those resolve to NOT_STARTED,
 * 0% -- never silently excluded to inflate the aggregate).
 */
function averageGroupJourneyProgress(concepts: HierarchyConcept[], journeyStages: Record<string, LearnerJourneyStage>): number | null {
  const stages = concepts.map((c) => journeyStages[c.id] ?? 'NOT_STARTED');
  return averageJourneyProgress(stages);
}

function averageRetention(concepts: HierarchyConcept[]): number | null {
  const scores = concepts.flatMap((c) => (c.retention !== undefined ? [c.retention] : []));
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
}

function averageIndependentMastery(concepts: HierarchyConcept[]): number | null {
  const scores = concepts.flatMap((c) => (c.independentMastery !== undefined ? [c.independentMastery] : []));
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
}

function averageConfidenceCalibration(concepts: HierarchyConcept[]): number | null {
  const scores = concepts.flatMap((c) => (c.confidenceCalibration !== undefined ? [c.confidenceCalibration] : []));
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
}

function evidenceCoveragePercent(concepts: HierarchyConcept[]): number | null {
  if (concepts.length === 0) return null;
  const evidenced = concepts.filter((c) => c.hasEvidence).length;
  return Math.round((evidenced / concepts.length) * 100);
}

function buildSecondaryLine(concepts: HierarchyConcept[], t: ReturnType<typeof getMessages>): string | null {
  const retention = averageRetention(concepts);
  const independentMastery = averageIndependentMastery(concepts);
  const confidenceCalibration = averageConfidenceCalibration(concepts);
  const coverage = evidenceCoveragePercent(concepts);
  return (
    [
      retention !== null ? `${t['subjectDetail.freshness']} ${retention}%` : null,
      independentMastery !== null ? `${t['subjectDetail.independentMastery']} ${independentMastery}%` : null,
      confidenceCalibration !== null ? `${t['subjectDetail.confidenceCalibration']} ${confidenceCalibration}%` : null,
      coverage !== null ? `${t['subjectDetail.evidenceCoverage']} ${coverage}%` : null,
    ]
      .filter(Boolean)
      .join(' · ') || null
  );
}

function masteryFillClass(score: number) {
  if (score >= 75) return 'fill-good';
  if (score >= 50) return 'fill-warn';
  return 'fill-critical';
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      style={{ flexShrink: 0, color: 'var(--text-muted)', transition: 'transform 180ms ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
    >
      <path d="M5 3l6 5-6 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MiniMastery({ score, width = 72 }: { score: number | null; width?: number }) {
  if (score === null) return <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>—</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <div className="mastery-bar" style={{ width, flex: 'none' }}>
        <span className={masteryFillClass(score)} style={{ width: `${score}%` }} />
      </div>
      <span className="mastery-pct tabular" style={{ width: 30 }}>{score}%</span>
    </div>
  );
}

function AccordionHeader({
  open,
  onClick,
  label,
  count,
  countLabel,
  progressPercent,
  secondaryLine,
  size = 'lg',
}: {
  open: boolean;
  onClick: () => void;
  label: string;
  count: number;
  countLabel: string;
  /** LX-9R1: mean canonical journey progress across the group's concepts (R7) -- never a raw mastery-score average. */
  progressPercent: number | null;
  secondaryLine?: string | null;
  size?: 'lg' | 'sm';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="accordion-header"
      style={{
        display: 'flex', flexDirection: 'column', gap: 4, width: '100%',
        background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        padding: size === 'lg' ? 'var(--space-3) var(--space-3)' : 'var(--space-2) var(--space-3)',
        color: 'var(--text-primary)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: size === 'lg' ? 'var(--space-3)' : 'var(--space-2)', minWidth: 0 }}>
          <Chevron open={open} />
          <span
            style={
              size === 'lg'
                ? { fontSize: 16, fontWeight: 650 }
                : { fontSize: 13, fontWeight: 650, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.02em' }
            }
          >
            {label}
          </span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexShrink: 0, marginLeft: 'var(--space-3)' }}>
          <MiniMastery score={progressPercent} width={size === 'lg' ? 80 : 60} />
          <span style={{ fontSize: size === 'lg' ? 13 : 12.5, color: 'var(--text-muted)', minWidth: 76, textAlign: 'right' }}>
            {count} {countLabel}
          </span>
        </span>
      </span>
      {secondaryLine && (
        <span style={{ fontSize: 12, color: 'var(--text-muted)', paddingLeft: size === 'lg' ? 26 : 20 }}>
          {secondaryLine}
        </span>
      )}
    </button>
  );
}

function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className="accordion-collapse" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
      {/* `inert` (not just CSS height) keeps collapsed content out of
          tab order and the accessibility tree, while still letting the
          height transition animate instead of an abrupt display:none. */}
      <div inert={!open || undefined}>{children}</div>
    </div>
  );
}

export default function HierarchicalConceptList({
  subjectId,
  studentId,
  locale,
  hierarchy,
  masteryStates,
  journeyStages,
}: {
  subjectId: string;
  studentId: string;
  locale: Locale;
  hierarchy: SubjectHierarchy;
  /**
   * Step 6L-C2-B1: conceptId -> the already-persisted, canonical
   * MasteryState (knowledge-state.service.ts) for each concept in this
   * subject -- fetched once, in bulk, by the server page. Kept as a
   * SECONDARY analytics input only (R8) -- never the primary progress
   * percentage/label as of LX-9R1.
   */
  masteryStates: Record<string, MasteryState>;
  /**
   * LX-9R1: conceptId -> the canonical LX-1B `LearnerJourneyStage`
   * (`path-view.ts::resolveConceptJourneyStage`, the SAME authority My
   * Path/Concept Mission read) for each concept in this subject --
   * fetched/derived once, in bulk, by the server page. This is now the
   * ONLY input driving the primary progress percentage/label at every
   * level (concept row, subtopic, topic, unassigned group).
   */
  journeyStages: Record<string, LearnerJourneyStage>;
}) {
  const t = getMessages(locale);
  const [openTopics, setOpenTopics] = useState<Set<string>>(new Set());
  const [openSubtopics, setOpenSubtopics] = useState<Set<string>>(new Set());

  function toggleTopic(id: string) {
    setOpenTopics((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSubtopic(id: string) {
    setOpenSubtopics((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {hierarchy.topics.map((topic) => {
        const topicOpen = openTopics.has(topic.id);
        const topicConcepts = topic.subtopics.flatMap((s) => s.concepts);
        const topicConceptCount = topicConcepts.length;
        const topicProgress = averageGroupJourneyProgress(topicConcepts, journeyStages);

        return (
          <div key={topic.id} className="card" style={{ padding: 'var(--space-2)' }}>
            <AccordionHeader
              open={topicOpen}
              onClick={() => toggleTopic(topic.id)}
              label={topic.name}
              count={topicConceptCount}
              countLabel={t['subjectDetail.conceptCount']}
              progressPercent={topicProgress}
              secondaryLine={buildSecondaryLine(topicConcepts, t)}
            />

            <Collapse open={topicOpen}>
              <div
                style={{
                  padding: 'var(--space-1) var(--space-3) var(--space-3) var(--space-6)', marginTop: 4,
                  borderLeft: '2px solid var(--border-default)', marginLeft: 'var(--space-4)',
                  display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
                }}
              >
                {topic.subtopics.map((subtopic) => {
                  const subtopicOpen = openSubtopics.has(subtopic.id);
                  const subtopicProgress = averageGroupJourneyProgress(subtopic.concepts, journeyStages);
                  return (
                    <div key={subtopic.id}>
                      <AccordionHeader
                        open={subtopicOpen}
                        onClick={() => toggleSubtopic(subtopic.id)}
                        label={subtopic.name}
                        count={subtopic.concepts.length}
                        countLabel={t['subjectDetail.conceptCount']}
                        progressPercent={subtopicProgress}
                        secondaryLine={buildSecondaryLine(subtopic.concepts, t)}
                        size="sm"
                      />

                      <Collapse open={subtopicOpen}>
                        <div style={{ marginTop: 'var(--space-3)', paddingLeft: 'var(--space-2)' }}>
                          <ConceptList
                            subjectId={subjectId}
                            studentId={studentId}
                            locale={locale}
                            concepts={subtopic.concepts.map((c) => ({
                              conceptId: c.id,
                              label: c.label,
                              journeyStage: journeyStages[c.id] ?? 'NOT_STARTED',
                              masteryState: masteryStates[c.id] ?? null,
                            }))}
                          />
                        </div>
                      </Collapse>
                    </div>
                  );
                })}
              </div>
            </Collapse>
          </div>
        );
      })}

      {hierarchy.unassigned.length > 0 && (
        <div className="card" style={{ padding: 'var(--space-2)' }}>
          <AccordionHeader
            open={openTopics.has(UNASSIGNED_KEY)}
            onClick={() => toggleTopic(UNASSIGNED_KEY)}
            label={t['hierarchy.unassigned']}
            count={hierarchy.unassigned.length}
            countLabel={t['subjectDetail.conceptCount']}
            progressPercent={averageGroupJourneyProgress(hierarchy.unassigned, journeyStages)}
            secondaryLine={buildSecondaryLine(hierarchy.unassigned, t)}
          />

          <Collapse open={openTopics.has(UNASSIGNED_KEY)}>
            <div style={{ padding: 'var(--space-3) var(--space-3) var(--space-1)' }}>
              <ConceptList
                subjectId={subjectId}
                studentId={studentId}
                locale={locale}
                concepts={hierarchy.unassigned.map((c) => ({
                  conceptId: c.id,
                  label: c.label,
                  journeyStage: journeyStages[c.id] ?? 'NOT_STARTED',
                  masteryState: masteryStates[c.id] ?? null,
                }))}
              />
            </div>
          </Collapse>
        </div>
      )}
    </div>
  );
}

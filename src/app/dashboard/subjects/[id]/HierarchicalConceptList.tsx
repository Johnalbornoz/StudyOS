'use client';

import { useState } from 'react';
import { getMessages, Locale } from '@/lib/i18n/messages';
import ConceptList from './ConceptList';
import { SubjectHierarchy, HierarchyConcept } from '@/services/topic-hierarchy.service';

const UNASSIGNED_KEY = '__unassigned__';

function averageMastery(concepts: HierarchyConcept[]): number | null {
  const scores = concepts.flatMap((c) => (c.masteryScore !== undefined ? [c.masteryScore] : []));
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
}

function averageRetention(concepts: HierarchyConcept[]): number | null {
  const scores = concepts.flatMap((c) => (c.retention !== undefined ? [c.retention] : []));
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
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
  masteryScore,
  retentionLabel,
  size = 'lg',
}: {
  open: boolean;
  onClick: () => void;
  label: string;
  count: number;
  countLabel: string;
  masteryScore: number | null;
  retentionLabel?: string | null;
  size?: 'lg' | 'sm';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="accordion-header"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
        background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        padding: size === 'lg' ? 'var(--space-3) var(--space-3)' : 'var(--space-2) var(--space-3)',
        color: 'var(--text-primary)',
      }}
    >
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
        <MiniMastery score={masteryScore} width={size === 'lg' ? 80 : 60} />
        {retentionLabel && (
          <span style={{ fontSize: size === 'lg' ? 12.5 : 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {retentionLabel}
          </span>
        )}
        <span style={{ fontSize: size === 'lg' ? 13 : 12.5, color: 'var(--text-muted)', minWidth: 76, textAlign: 'right' }}>
          {count} {countLabel}
        </span>
      </span>
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
}: {
  subjectId: string;
  studentId: string;
  locale: Locale;
  hierarchy: SubjectHierarchy;
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
        const topicMastery = averageMastery(topicConcepts);
        const topicRetention = averageRetention(topicConcepts);

        return (
          <div key={topic.id} className="card" style={{ padding: 'var(--space-2)' }}>
            <AccordionHeader
              open={topicOpen}
              onClick={() => toggleTopic(topic.id)}
              label={topic.name}
              count={topicConceptCount}
              countLabel={t['subjectDetail.conceptCount']}
              masteryScore={topicMastery}
              retentionLabel={topicRetention !== null ? `${t['subjectDetail.retention']} ${topicRetention}%` : null}
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
                  const subtopicMastery = averageMastery(subtopic.concepts);
                  const subtopicRetention = averageRetention(subtopic.concepts);
                  return (
                    <div key={subtopic.id}>
                      <AccordionHeader
                        open={subtopicOpen}
                        onClick={() => toggleSubtopic(subtopic.id)}
                        label={subtopic.name}
                        count={subtopic.concepts.length}
                        countLabel={t['subjectDetail.conceptCount']}
                        masteryScore={subtopicMastery}
                        retentionLabel={subtopicRetention !== null ? `${t['subjectDetail.retention']} ${subtopicRetention}%` : null}
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
                              masteryScore: c.masteryScore ?? 0,
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
            masteryScore={averageMastery(hierarchy.unassigned)}
            retentionLabel={
              averageRetention(hierarchy.unassigned) !== null
                ? `${t['subjectDetail.retention']} ${averageRetention(hierarchy.unassigned)}%`
                : null
            }
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
                  masteryScore: c.masteryScore ?? 0,
                }))}
              />
            </div>
          </Collapse>
        </div>
      )}
    </div>
  );
}

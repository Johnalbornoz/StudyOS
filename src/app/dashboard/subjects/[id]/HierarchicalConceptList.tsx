'use client';

import { useState } from 'react';
import { getMessages, Locale } from '@/lib/i18n/messages';
import ConceptList from './ConceptList';
import { SubjectHierarchy } from '@/services/topic-hierarchy.service';

const UNASSIGNED_KEY = '__unassigned__';

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      style={{ flexShrink: 0, color: 'var(--text-muted)', transition: 'transform 150ms ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
    >
      <path d="M5 3l6 5-6 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AccordionHeader({
  open,
  onClick,
  label,
  count,
  countLabel,
  size = 'lg',
}: {
  open: boolean;
  onClick: () => void;
  label: string;
  count: number;
  countLabel: string;
  size?: 'lg' | 'sm';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
        background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0,
        color: 'var(--text-primary)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: size === 'lg' ? 'var(--space-3)' : 'var(--space-2)', minWidth: 0 }}>
        <Chevron open={open} />
        <span
          style={
            size === 'lg'
              ? { fontSize: 17, fontWeight: 650 }
              : { fontSize: 13, fontWeight: 650, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.02em' }
          }
        >
          {label}
        </span>
      </span>
      <span style={{ fontSize: size === 'lg' ? 13 : 12.5, color: 'var(--text-muted)', flexShrink: 0, marginLeft: 'var(--space-3)' }}>
        {count} {countLabel}
      </span>
    </button>
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
        const topicConceptCount = topic.subtopics.reduce((sum, s) => sum + s.concepts.length, 0);
        return (
          <div key={topic.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
              <AccordionHeader
                open={topicOpen}
                onClick={() => toggleTopic(topic.id)}
                label={topic.name}
                count={topicConceptCount}
                countLabel={t['subjectDetail.conceptCount']}
              />
            </div>

            {topicOpen && (
              <div
                style={{
                  padding: '0 var(--space-5) var(--space-5)', borderTop: '1px solid var(--border-default)',
                  display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
                }}
              >
                {topic.subtopics.map((subtopic) => {
                  const subtopicOpen = openSubtopics.has(subtopic.id);
                  return (
                    <div key={subtopic.id} style={{ paddingTop: 'var(--space-4)' }}>
                      <AccordionHeader
                        open={subtopicOpen}
                        onClick={() => toggleSubtopic(subtopic.id)}
                        label={subtopic.name}
                        count={subtopic.concepts.length}
                        countLabel={t['subjectDetail.conceptCount']}
                        size="sm"
                      />

                      {subtopicOpen && (
                        <div style={{ marginTop: 'var(--space-3)' }}>
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
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {hierarchy.unassigned.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
            <AccordionHeader
              open={openTopics.has(UNASSIGNED_KEY)}
              onClick={() => toggleTopic(UNASSIGNED_KEY)}
              label={t['hierarchy.unassigned']}
              count={hierarchy.unassigned.length}
              countLabel={t['subjectDetail.conceptCount']}
            />
          </div>

          {openTopics.has(UNASSIGNED_KEY) && (
            <div style={{ padding: '0 var(--space-5) var(--space-5)', borderTop: '1px solid var(--border-default)' }}>
              <div style={{ marginTop: 'var(--space-4)' }}>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}

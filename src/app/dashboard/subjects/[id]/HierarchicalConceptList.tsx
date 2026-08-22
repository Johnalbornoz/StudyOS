'use client';

import { getMessages, Locale } from '@/lib/i18n/messages';
import ConceptList from './ConceptList';
import { SubjectHierarchy } from '@/services/topic-hierarchy.service';

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      {hierarchy.topics.map((topic) => (
        <div key={topic.id}>
          <h2 style={{ marginBottom: 'var(--space-4)' }}>{topic.name}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {topic.subtopics.map((subtopic) => (
              <div key={subtopic.id}>
                <h4
                  style={{
                    fontSize: 13, fontWeight: 650, color: 'var(--text-muted)', textTransform: 'uppercase',
                    letterSpacing: '0.02em', margin: '0 0 var(--space-3)',
                  }}
                >
                  {subtopic.name}
                </h4>
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
            ))}
          </div>
        </div>
      ))}

      {hierarchy.unassigned.length > 0 && (
        <div>
          <h2 style={{ marginBottom: 'var(--space-4)', color: 'var(--text-muted)' }}>{t['hierarchy.unassigned']}</h2>
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
      )}
    </div>
  );
}

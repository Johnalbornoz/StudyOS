'use client';

import { useState } from 'react';
import { getMessages, Locale } from '@/lib/i18n/messages';
import AddConceptTab from './AddConceptTab';
import DocumentImport from '@/app/dashboard/learn/DocumentImport';

export default function UploadPanel({
  subjectId,
  subjectName,
  studentId,
  locale,
}: {
  subjectId: string;
  subjectName: string;
  studentId: string;
  locale: Locale;
}) {
  const t = getMessages(locale);
  const [tab, setTab] = useState<'file' | 'text'>('file');
  return (
    <div className="card" style={{ marginTop: 'var(--space-8)' }}>
      <h3 style={{ marginBottom: 4 }}>{t['subjectDetail.uploadTitle']}</h3>

      <div style={{ display: 'flex', gap: 'var(--space-2)', margin: 'var(--space-3) 0 var(--space-4)' }}>
        <button
          type="button"
          onClick={() => setTab('file')}
          className={tab === 'file' ? 'btn btn-secondary' : 'btn btn-ghost'}
          style={{ fontSize: 13 }}
        >
          {t['subjectDetail.uploadTabFile']}
        </button>
        <button
          type="button"
          onClick={() => setTab('text')}
          className={tab === 'text' ? 'btn btn-secondary' : 'btn btn-ghost'}
          style={{ fontSize: 13 }}
        >
          {t['subjectDetail.uploadTabText']}
        </button>
      </div>

      {tab === 'file' ? (
        // Document import: the same reviewed flow as Aprender -- topics are
        // proposed, the Student selects, nothing is created silently.
        <DocumentImport subjectId={subjectId} subjectName={subjectName} locale={locale} />
      ) : (
        <AddConceptTab subjectId={subjectId} studentId={studentId} locale={locale} />
      )}
    </div>
  );
}

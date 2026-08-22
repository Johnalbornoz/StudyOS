'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMessages, LOCALES, LOCALE_NAMES, Locale } from '@/lib/i18n/messages';
import StatusToggle from '../StatusToggle';
import { IBFields } from '../IBFields';

interface ContentSourceRow {
  id: string;
  fileName: string;
  sourceType: string | null;
  uploadedAt: string;
}

export default function SubjectSettingsPanel({
  subjectId,
  studentId,
  locale,
  initialName,
  initialStatus,
  initialTargetLanguage,
  initialQuizLanguageMode,
  contentSources,
  conceptCount,
  initialIbProgramme,
  initialIbSubjectGroup,
  initialIbLevel,
}: {
  subjectId: string;
  studentId: string;
  locale: Locale;
  initialName: string;
  initialStatus: string;
  initialTargetLanguage: string | null;
  initialQuizLanguageMode: string;
  contentSources: ContentSourceRow[];
  conceptCount: number;
  initialIbProgramme: 'none' | 'MYP' | 'DP';
  initialIbSubjectGroup: string | null;
  initialIbLevel: 'SL' | 'HL' | null;
}) {
  const t = getMessages(locale);
  const router = useRouter();

  const [name, setName] = useState(initialName);
  const [targetLanguage, setTargetLanguage] = useState<Locale | ''>((initialTargetLanguage as Locale) || '');
  const [quizLanguageMode, setQuizLanguageMode] = useState(initialQuizLanguageMode);
  const [ibProgramme, setIbProgramme] = useState<'none' | 'MYP' | 'DP'>(initialIbProgramme);
  const [ibSubjectGroup, setIbSubjectGroup] = useState(initialIbSubjectGroup || '');
  const [ibLevel, setIbLevel] = useState<'SL' | 'HL'>(initialIbLevel || 'SL');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [sources, setSources] = useState(contentSources);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);

  const archived = initialStatus === 'archived';

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`/api/subjects/${subjectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          name,
          targetLanguage: targetLanguage || null,
          quizLanguageMode,
          ibProgramme,
          ibSubjectGroup: ibProgramme !== 'none' ? ibSubjectGroup || null : null,
          ibLevel: ibProgramme === 'DP' ? ibLevel : null,
        }),
      });
      setSaved(true);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive() {
    setArchiveBusy(true);
    try {
      await fetch(`/api/subjects/${subjectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, status: archived ? 'active' : 'archived' }),
      });
      router.refresh();
    } finally {
      setArchiveBusy(false);
    }
  }

  async function handleDelete() {
    if (deleteText !== initialName) {
      setDeleteError(t['subjects.deleteMismatch']);
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/subjects/${subjectId}?studentId=${studentId}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/dashboard/subjects');
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'HAS_HISTORY') {
          setDeleteError(t['subjects.deleteHasHistory']);
        } else if (body.error === 'HAS_CONCEPTS') {
          setDeleteError(t['subjects.hasConceptsNotice']);
        } else {
          setDeleteError(t['common.error']);
        }
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleDeleteSource(sourceId: string) {
    if (!confirm(t['subjectDetail.contentDeleteConfirm'])) return;
    setDeletingSourceId(sourceId);
    try {
      const res = await fetch(`/api/content/${sourceId}?studentId=${studentId}`, { method: 'DELETE' });
      if (res.ok) {
        setSources((prev) => prev.filter((s) => s.id !== sourceId));
      }
    } finally {
      setDeletingSourceId(null);
    }
  }

  return (
    <div className="card" style={{ marginTop: 'var(--space-8)' }}>
      <h3 style={{ marginBottom: 'var(--space-4)' }}>{t['subjectDetail.settingsTitle']}</h3>

      {archived && (
        <p
          style={{
            fontSize: 13, color: 'var(--warning)', background: 'var(--warning-subtle, transparent)',
            border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-3)', marginBottom: 'var(--space-4)',
          }}
        >
          {t['subjectDetail.archivedNotice']}
        </p>
      )}

      <form onSubmit={handleSave} style={{ marginBottom: 'var(--space-6)' }}>
        <label className="label" style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-2)' }}>
          {t['subjectNew.nameLabel']}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={{
            width: '100%', maxWidth: 360, height: 40, padding: '0 var(--space-3)', marginBottom: 'var(--space-4)',
            borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: 14, fontFamily: 'inherit',
          }}
        />

        {initialTargetLanguage !== null && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label className="label" style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-2)' }}>
              {t['subjectNew.targetLanguageLabel']}
            </label>
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value as Locale)}
              style={{
                width: '100%', maxWidth: 360, height: 40, borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-default)', fontSize: 14, fontFamily: 'inherit',
                padding: '0 var(--space-3)', background: 'var(--bg-base)', color: 'var(--text-primary)',
              }}
            >
              {LOCALES.map((l) => (
                <option key={l} value={l}>{LOCALE_NAMES[l]}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label className="label" style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-2)' }}>
            {t['subjectNew.quizLanguageLabel']}
          </label>
          <select
            value={quizLanguageMode}
            onChange={(e) => setQuizLanguageMode(e.target.value)}
            style={{
              width: '100%', maxWidth: 360, height: 40, borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-default)', fontSize: 14, fontFamily: 'inherit',
              padding: '0 var(--space-3)', background: 'var(--bg-base)', color: 'var(--text-primary)',
            }}
          >
            <option value="match_interface">{t['subjectNew.quizLanguageMatch']}</option>
            <option value="fixed_english">{t['subjectNew.quizLanguageFixed']}</option>
          </select>
        </div>

        <IBFields
          locale={locale}
          programme={ibProgramme}
          setProgramme={setIbProgramme}
          subjectGroup={ibSubjectGroup}
          setSubjectGroup={setIbSubjectGroup}
          level={ibLevel}
          setLevel={setIbLevel}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button type="submit" disabled={saving || !name} className="btn btn-primary">
            {saving ? t['common.creating'] : t['common.save']}
          </button>
          {saved && <span style={{ fontSize: 13, color: 'var(--success)' }}>{t['common.saved']}</span>}
        </div>
      </form>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-default)' }}>
        <StatusToggle
          active={!archived}
          busy={archiveBusy}
          onToggle={toggleArchive}
          labelActive={t['subjects.statusActive']}
          labelInactive={t['subjects.statusArchived']}
        />
        {!showDeleteConfirm && conceptCount === 0 && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ color: 'var(--error)' }}
            onClick={() => setShowDeleteConfirm(true)}
          >
            {t['subjects.deleteAction']}
          </button>
        )}
      </div>

      {conceptCount > 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 'var(--space-3)' }}>
          {t['subjects.hasConceptsNotice']}
        </p>
      )}

      {showDeleteConfirm && (
        <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)', border: '1px solid var(--error)', borderRadius: 'var(--radius-sm)' }}>
          <p style={{ fontSize: 13.5, marginBottom: 'var(--space-3)' }}>{t['subjects.deleteConfirmBody']}</p>
          <input
            type="text"
            value={deleteText}
            onChange={(e) => setDeleteText(e.target.value)}
            placeholder={t['subjects.deleteConfirmPlaceholder']}
            style={{
              width: '100%', maxWidth: 320, height: 38, padding: '0 var(--space-3)', marginBottom: 'var(--space-3)',
              borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: 14, fontFamily: 'inherit',
              display: 'block',
            }}
          />
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ background: 'var(--error)', borderColor: 'var(--error)' }}
              disabled={deleteBusy || deleteText !== initialName}
              onClick={handleDelete}
            >
              {t['subjects.deleteConfirmButton']}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setShowDeleteConfirm(false);
                setDeleteText('');
                setDeleteError(null);
              }}
            >
              {t['common.cancel']}
            </button>
          </div>
          {deleteError && <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 'var(--space-3)' }}>{deleteError}</p>}
        </div>
      )}

      <div style={{ marginTop: 'var(--space-6)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-default)' }}>
        <h4 style={{ marginBottom: 'var(--space-3)', fontSize: 14 }}>{t['subjectDetail.contentTitle']}</h4>
        {sources.length === 0 ? (
          <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>{t['subjectDetail.contentEmpty']}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {sources.map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)',
                  padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.fileName}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {t['subjectDetail.contentUploadedOn']} {new Date(s.uploadedAt).toLocaleDateString(locale)}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 12.5, color: 'var(--error)', flexShrink: 0 }}
                  disabled={deletingSourceId === s.id}
                  onClick={() => handleDeleteSource(s.id)}
                >
                  {t['subjectDetail.contentDeleteAction']}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

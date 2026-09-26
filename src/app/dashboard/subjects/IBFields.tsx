'use client';

import { IB_SUBJECT_GROUPS } from '@/lib/ib';
import { getMessages, Locale } from '@/lib/i18n/messages';
import type { SubjectAcademicContext } from '@/lib/student/subject-academic-context';

const selectStyle: React.CSSProperties = {
  width: '100%', height: 40, borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-default)', fontSize: 14, fontFamily: 'inherit',
  padding: '0 var(--space-3)', background: 'var(--bg-base)', color: 'var(--text-primary)',
};

/**
 * Per-subject IB fields. The programme/year are NOT chosen here: they come
 * from the student's academic profile ("Mi perfil académico") and are only
 * displayed. Non-IB students see nothing. DP subjects require HL/SL.
 */
export function IBFields({
  locale,
  context,
  subjectGroup,
  setSubjectGroup,
  level,
  setLevel,
}: {
  locale: Locale;
  context: SubjectAcademicContext;
  subjectGroup: string;
  setSubjectGroup: (v: string) => void;
  level: '' | 'SL' | 'HL';
  setLevel: (v: '' | 'SL' | 'HL') => void;
}) {
  if (context.programme === 'none') return null;
  const t = getMessages(locale);
  const programmeLabel = context.programme === 'DP' ? t['ib.programmeDP'] : t['ib.programmeMYP'];

  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <div className="label" style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>
        {t['ib.programmeLabel']}
      </div>
      <p style={{ fontSize: 14, margin: 0, fontWeight: 600 }} data-testid="ib-inherited-context">
        IB · {programmeLabel}{context.year ? ` · ${context.year}` : ''}
      </p>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>{t['ib.programmeFromProfile']}</p>

      <div style={{ marginTop: 'var(--space-3)' }}>
        <label className="label" style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-2)' }}>
          {t['ib.subjectGroupLabel']}
        </label>
        <select value={subjectGroup} onChange={(e) => setSubjectGroup(e.target.value)} style={selectStyle}>
          <option value="">—</option>
          {IB_SUBJECT_GROUPS.map((g) => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
      </div>

      {context.requiresLevel && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <label className="label" style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-2)' }}>
            {t['ib.levelLabel']}
          </label>
          <select value={level} onChange={(e) => setLevel(e.target.value as '' | 'SL' | 'HL')} style={selectStyle} required>
            <option value="" disabled>{t['ib.levelChoose']}</option>
            <option value="HL">HL</option>
            <option value="SL">SL</option>
          </select>
          {!level && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>{t['ib.levelRequired']}</p>}
        </div>
      )}
    </div>
  );
}

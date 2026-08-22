'use client';

import { IB_SUBJECT_GROUPS } from '@/lib/ib';
import { getMessages, Locale } from '@/lib/i18n/messages';

const selectStyle: React.CSSProperties = {
  width: '100%', height: 40, borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-default)', fontSize: 14, fontFamily: 'inherit',
  padding: '0 var(--space-3)', background: 'var(--bg-base)', color: 'var(--text-primary)',
};

export function IBFields({
  locale,
  programme,
  setProgramme,
  subjectGroup,
  setSubjectGroup,
  level,
  setLevel,
}: {
  locale: Locale;
  programme: 'none' | 'MYP' | 'DP';
  setProgramme: (v: 'none' | 'MYP' | 'DP') => void;
  subjectGroup: string;
  setSubjectGroup: (v: string) => void;
  level: 'SL' | 'HL';
  setLevel: (v: 'SL' | 'HL') => void;
}) {
  const t = getMessages(locale);

  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <label className="label" style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-2)' }}>
        {t['ib.programmeLabel']}
      </label>
      <select value={programme} onChange={(e) => setProgramme(e.target.value as 'none' | 'MYP' | 'DP')} style={selectStyle}>
        <option value="none">{t['ib.programmeNone']}</option>
        <option value="MYP">{t['ib.programmeMYP']}</option>
        <option value="DP">{t['ib.programmeDP']}</option>
      </select>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>{t['ib.programmeHelp']}</p>

      {programme !== 'none' && (
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
      )}

      {programme === 'DP' && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <label className="label" style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-2)' }}>
            {t['ib.levelLabel']}
          </label>
          <select value={level} onChange={(e) => setLevel(e.target.value as 'SL' | 'HL')} style={selectStyle}>
            <option value="SL">SL</option>
            <option value="HL">HL</option>
          </select>
        </div>
      )}
    </div>
  );
}

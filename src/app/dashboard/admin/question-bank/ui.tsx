/**
 * Question Bank Health -- shared presentational pieces for the Platform Admin
 * pages (server components). Operational language only; raw ids are never shown.
 */
import type { ReactNode } from 'react';

export const TH = ({ children }: { children: ReactNode }) => (
  <th scope="col" style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)', color: 'var(--text-muted)', fontSize: 11.5, fontWeight: 650, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{children}</th>
);
export const TD = ({ children, muted, num }: { children: ReactNode; muted?: boolean; num?: boolean }) => (
  <td style={{ padding: 'var(--space-2) var(--space-3)', color: muted ? 'var(--text-muted)' : undefined, textAlign: num ? 'right' : undefined, whiteSpace: num ? 'nowrap' : undefined }} className={num ? 'tabular' : undefined}>{children}</td>
);

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 'var(--space-6)' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-default)' }}>{head.map((h) => <TH key={h}>{h}</TH>)}</tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export const ROW = { borderBottom: '1px solid var(--border-default)' } as const;

export function YesNo({ value, label }: { value: boolean | null; label?: string }) {
  if (value === null) return <span className="chip">sin calcular</span>;
  return <span className={`chip ${value ? 'chip-good' : 'chip-warn'}`}>{label ?? (value ? 'Sí' : 'No')}</span>;
}

const STATE_LABEL: Record<string, string> = {
  EMPTY: 'Vacía',
  INSUFFICIENT: 'Insuficiente',
  FORM_READY: 'Un formulario',
  VARIETY_LOW: 'Poca variedad',
  HEALTHY: 'Sana',
  CALIBRATED: 'Calibrada',
};
const STATE_TONE: Record<string, string> = { EMPTY: 'chip-critical', INSUFFICIENT: 'chip-warn', FORM_READY: 'chip-warn', VARIETY_LOW: '', HEALTHY: 'chip-good', CALIBRATED: 'chip-good' };
export function CellState({ state }: { state: string }) {
  return <span className={`chip ${STATE_TONE[state] ?? ''}`}>{STATE_LABEL[state] ?? state}</span>;
}

export const LIFECYCLE_LABEL: Record<string, string> = {
  DRAFT_AI: 'Borrador IA',
  VALIDATING: 'Validando',
  VALIDATED: 'Validada',
  PILOT: 'Piloto',
  CALIBRATED: 'Calibrada',
  ACTIVE: 'Activa',
  REPAIR_REQUIRED: 'Requiere reparación',
  REVIEW_REQUIRED: 'Requiere revisión',
  REJECTED: 'Rechazada',
  SUSPENDED: 'Suspendida',
  RETIRED: 'Retirada',
  SUPERSEDED: 'Reemplazada',
};

export const LENGTH_BASIS_LABEL: Record<string, string> = {
  BLUEPRINT_IS_FULL: 'blueprint de longitud completa',
  ITEMS_PROPORTIONAL: 'longitud oficial repartida según el blueprint (política StudyUS)',
  MARKS_ESTIMATED: 'longitud estimada por puntos',
  UNKNOWN: 'longitud oficial no publicada',
};

export function cellLabel(c: { componentName: string; objectiveDescription: string | null; objectiveCode: string; difficultyRange: { min: number; max: number } | null }): string {
  const req = (c.objectiveDescription ?? c.objectiveCode).split(':')[0].replace(/\.$/, '');
  return `${c.componentName} · ${req}${c.difficultyRange ? ` · dificultad ${c.difficultyRange.min}–${c.difficultyRange.max}` : ''}`;
}

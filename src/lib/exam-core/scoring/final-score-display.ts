/**
 * F4 -- how a stored result's final score is SHOWN (presentation only; the engine and the stored values are not touched).
 *
 * The NONE transform always yields a percent (round(fraction*100)), whatever `unit` the policy names; the policy `unit`
 * (e.g. 'marks') describes the raw scale. So a NONE result is shown as the percent, and a count unit is shown with the
 * raw marks ("18 / 25 marks") -- never as "72 marks". Other transforms (LINEAR / PIECEWISE / BANDS) keep their own unit.
 */
export interface StoredFinal { finalScore: number | null; finalLabel: string | null; rawScore: number; maxScore: number; provenance?: { final?: { unit?: string | null } | null; transformations?: Array<{ step: string }> | null } | null }
export interface FinalScoreDisplay { headline: string; unit: string | null; percentIsHeadline: boolean }

export function finalScoreDisplay(r: StoredFinal): FinalScoreDisplay {
  if (r.finalLabel) return { headline: r.finalLabel, unit: null, percentIsHeadline: false };
  if (r.finalScore === null) return { headline: '—', unit: null, percentIsHeadline: false };
  const unit = r.provenance?.final?.unit ?? null;
  const isPercent = unit === '%' || (r.provenance?.transformations ?? []).some((t) => t.step === 'NONE(percent)');
  if (isPercent) return { headline: `${r.finalScore}%`, unit: null, percentIsHeadline: true };
  return { headline: String(r.finalScore), unit, percentIsHeadline: false };
}

/** The raw line: "18 / 25 marks" when the policy's scale is marks; otherwise null (the localised raw line is used). */
export function rawMarksLine(r: StoredFinal): string | null {
  const unit = r.provenance?.final?.unit ?? null;
  return unit && unit !== '%' && r.maxScore > 0 ? `${r.rawScore} / ${r.maxScore} ${unit}` : null;
}

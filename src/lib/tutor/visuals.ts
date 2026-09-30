/**
 * UX-5 -- pedagogical visuals, rendered by StudyUS.
 *
 * The model may propose ONE visual as a small JSON spec inside a fenced
 * ```studyus-visual block. StudyUS validates it strictly and draws it
 * itself (SVG): exact mathematics, no raster generation, nothing the model
 * can put on screen except bars, ticks and short labels. An invalid spec
 * is dropped; the text around it still renders (a visual never blocks the
 * conversation). Function graphs keep using the existing ```function-plot
 * block handled by ChatMessage.
 */

export type FractionBarsSpec = { type: 'fraction-bars'; fractions: [number, number][]; label?: string };
export type NumberLineSpec = { type: 'number-line'; min: number; max: number; step: number; points: { value: number; label: string }[]; label?: string };
export type VisualSpec = FractionBarsSpec | NumberLineSpec;

export type MessageSegment = { kind: 'text'; text: string } | { kind: 'visual'; spec: VisualSpec };

const LABEL_MAX = 40;
const cleanLabel = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= LABEL_MAX && !/[<>{}]/.test(v) ? v.trim() : null;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validateVisualSpec(raw: unknown): VisualSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const label = o.label === undefined ? undefined : cleanLabel(o.label) ?? undefined;
  if (o.type === 'fraction-bars') {
    if (!Array.isArray(o.fractions) || o.fractions.length < 1 || o.fractions.length > 4) return null;
    const fractions: [number, number][] = [];
    for (const f of o.fractions) {
      if (!Array.isArray(f) || f.length !== 2 || !isInt(f[0]) || !isInt(f[1])) return null;
      const [n, d] = f;
      if (d < 1 || d > 24 || n < 0 || n > d) return null;
      fractions.push([n, d]);
    }
    return { type: 'fraction-bars', fractions, ...(label ? { label } : {}) };
  }
  if (o.type === 'number-line') {
    if (!isNum(o.min) || !isNum(o.max) || !isNum(o.step) || o.max <= o.min || o.step <= 0) return null;
    const ticks = (o.max - o.min) / o.step;
    if (ticks > 40 || ticks < 1) return null;
    if (!Array.isArray(o.points) || o.points.length > 6) return null;
    const points: { value: number; label: string }[] = [];
    for (const p of o.points) {
      if (!p || typeof p !== 'object') return null;
      const v = (p as Record<string, unknown>).value;
      const l = cleanLabel((p as Record<string, unknown>).label);
      if (!isNum(v) || v < o.min || v > o.max || !l) return null;
      points.push({ value: v, label: l });
    }
    return { type: 'number-line', min: o.min, max: o.max, step: o.step, points, ...(label ? { label } : {}) };
  }
  return null;
}

const FENCE = /```studyus-visual\s*\n?([\s\S]*?)```/g;

/** Splits a Tutor reply into text and validated visuals. Invalid specs are removed; text is never lost. */
export function splitMessageContent(content: string): MessageSegment[] {
  const out: MessageSegment[] = [];
  let last = 0;
  for (const m of content.matchAll(FENCE)) {
    const before = content.slice(last, m.index);
    if (before.trim()) out.push({ kind: 'text', text: before });
    let spec: VisualSpec | null = null;
    try {
      spec = validateVisualSpec(JSON.parse(m[1].trim()));
    } catch {
      spec = null;
    }
    if (spec) out.push({ kind: 'visual', spec });
    last = (m.index ?? 0) + m[0].length;
  }
  const rest = content.slice(last);
  if (rest.trim() || out.length === 0) out.push({ kind: 'text', text: rest });
  return out;
}

/** The instruction the model receives for visuals (appended to the Tutor system prompt). */
export const VISUAL_PROMPT = `Visuals (use only when a visual genuinely helps -- never decoration):
- For a function graph use the existing "function-plot" block.
- For comparing fractions emit exactly one fenced block tagged "studyus-visual" containing single-line JSON:
  {"type":"fraction-bars","fractions":[[3,4],[2,3]],"label":"3/4 vs 2/3"}  (1-4 fractions, denominators 1-24, numerator <= denominator)
- For positions on a number line:
  {"type":"number-line","min":0,"max":2,"step":0.25,"points":[{"value":0.75,"label":"3/4"}],"label":"..."}  (at most 40 ticks, at most 6 points, short labels)
- Never produce any other kind of image, link or embedded media.`;

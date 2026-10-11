/**
 * QB-R2C -- structured stimuli: DATA FIRST (pure, no IO, no dependency).
 *
 *   data  ->  chart / figure specification  ->  rendered asset (SVG) and its alt text
 *
 * A numerical or visual stimulus is never authored as a picture. It is authored as data (a table, named numeric
 * series) and as a SPECIFICATION that refers to that data (a chart) or states its measures (a geometry figure).
 * The SVG and the alt text are DERIVED by the renderers here, deterministically: the same specification always
 * gives the same bytes, so a stored asset can be re-rendered and compared, and a question can be checked against
 * the numbers it is asked about.
 *
 *   TABLE      columns + typed rows
 *   DATA_SET   named numeric series (with optional category labels)
 *   GRAPH      a chart specification (bar / line / scatter / number line / coordinate plot) that REFERENCES a
 *              table or a data set of the SAME stimulus -- a chart never carries numbers of its own
 *   FIGURE     a geometry specification with its given measures (right triangle, rectangle, circle, angle)
 *   COMPOSITE  text parts plus any of the above
 * Text kinds (PASSAGE, PAIRED_PASSAGE, POEM, NUMBERED_TEXT, DRAFT_PARAGRAPH) keep the stimulus's text parts.
 *
 * A figure is a schematic: it shows the shape and its labels, and is drawn to scale only when every measure is
 * given. A measure with `value: null` is an unknown the question asks for; its label (e.g. "x") is drawn.
 */
import { z } from 'zod';
import type { StimulusKind } from './requirement-cell';

export const STRUCTURED_STIMULUS_VERSION = 1 as const;
export const STIMULUS_RENDERER = { id: 'studyus-svg-renderer', version: '1' } as const;

const KEY = z.string().trim().min(1).max(80);
const LABEL = z.string().trim().min(1).max(200);
const NUM = z.number().finite();

export const TableSpecSchema = z.strictObject({
  tableKey: KEY, title: LABEL,
  columns: z.array(z.strictObject({ key: KEY, label: LABEL, type: z.enum(['TEXT', 'NUMBER']), unit: LABEL.nullable() })).min(1),
  /** One array per row, one cell per column, in column order. */
  rows: z.array(z.array(z.union([z.string().trim().min(1).max(200), NUM]))).min(1),
});
export type TableSpec = z.infer<typeof TableSpecSchema>;

export const DataSetSpecSchema = z.strictObject({
  dataSetKey: KEY, title: LABEL,
  /** Labels of the positions of every series (months, groups ...). null for a plain list of values. */
  categories: z.array(LABEL).min(1).nullable(),
  series: z.array(z.strictObject({ seriesKey: KEY, label: LABEL, unit: LABEL.nullable(), values: z.array(NUM).min(1) })).min(1),
});
export type DataSetSpec = z.infer<typeof DataSetSpecSchema>;

export const CHART_TYPES = ['BAR', 'LINE', 'SCATTER', 'NUMBER_LINE', 'COORDINATE_PLOT'] as const;
export const ChartSpecSchema = z.strictObject({
  chartKey: KEY, chartType: z.enum(CHART_TYPES), title: LABEL, xLabel: LABEL.nullable(), yLabel: LABEL.nullable(),
  /** Where the numbers are. `x` is the column / series of the horizontal axis; null takes the data set's categories. */
  source: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('TABLE'), tableKey: KEY, xColumn: KEY.nullable(), valueColumns: z.array(KEY).min(1) }),
    z.strictObject({ kind: z.literal('DATA_SET'), dataSetKey: KEY, xSeriesKey: KEY.nullable(), seriesKeys: z.array(KEY).min(1) }),
  ]),
});
export type ChartSpec = z.infer<typeof ChartSpecSchema>;

/** A length or an angle of a figure. `value: null` = the unknown; the label is what the figure shows. */
const MeasureSchema = z.strictObject({ label: LABEL, value: NUM.nullable() });
export const FigureSpecSchema = z.discriminatedUnion('shape', [
  z.strictObject({ figureKey: KEY, shape: z.literal('RIGHT_TRIANGLE'), unit: LABEL.nullable(), legA: MeasureSchema, legB: MeasureSchema, hypotenuse: MeasureSchema }),
  z.strictObject({ figureKey: KEY, shape: z.literal('RECTANGLE'), unit: LABEL.nullable(), width: MeasureSchema, height: MeasureSchema }),
  z.strictObject({ figureKey: KEY, shape: z.literal('CIRCLE'), unit: LABEL.nullable(), radius: MeasureSchema, diameter: MeasureSchema.nullable() }),
  z.strictObject({ figureKey: KEY, shape: z.literal('ANGLE_BETWEEN_LINES'), unit: z.literal('°'), angle: MeasureSchema }),
]);
export type FigureSpec = z.infer<typeof FigureSpecSchema>;

export const StructuredStimulusSchema = z.strictObject({ v: z.literal(STRUCTURED_STIMULUS_VERSION), tables: z.array(TableSpecSchema), dataSets: z.array(DataSetSpecSchema), charts: z.array(ChartSpecSchema), figures: z.array(FigureSpecSchema) });
export type StructuredStimulus = z.infer<typeof StructuredStimulusSchema>;

export const RenderedAssetSchema = z.strictObject({ assetKey: KEY, assetKind: z.enum(['CHART', 'FIGURE']), renderer: z.strictObject({ id: KEY, version: KEY }), svg: z.string().min(20).max(60000), altText: z.string().trim().min(10).max(2000) });
export type RenderedAsset = z.infer<typeof RenderedAssetSchema>;

export type StructuredStimulusViolation =
  | 'DUPLICATE_KEY' | 'TABLE_ROW_WIDTH_MISMATCH' | 'TABLE_CELL_TYPE_MISMATCH' | 'SERIES_LENGTH_MISMATCH' | 'CHART_TABLE_NOT_FOUND' | 'CHART_DATA_SET_NOT_FOUND' | 'CHART_COLUMN_NOT_FOUND' | 'CHART_SERIES_NOT_FOUND'
  | 'CHART_VALUES_NOT_NUMERIC' | 'CHART_NEEDS_NUMERIC_X' | 'CHART_NEEDS_CATEGORIES' | 'NON_POSITIVE_MEASURE' | 'RIGHT_TRIANGLE_NOT_PYTHAGOREAN' | 'HYPOTENUSE_IS_NOT_THE_LONGEST_SIDE' | 'CIRCLE_DIAMETER_IS_NOT_TWICE_THE_RADIUS'
  | 'ANGLE_OUT_OF_RANGE' | 'FIGURE_HAS_NO_GIVEN_MEASURE' | 'KIND_NEEDS_A_TABLE' | 'KIND_NEEDS_A_DATA_SET' | 'KIND_NEEDS_A_CHART' | 'KIND_NEEDS_A_FIGURE' | 'COMPOSITE_NEEDS_STRUCTURED_DATA' | 'TEXT_KIND_CARRIES_STRUCTURED_DATA';

export const TEXT_STIMULUS_KINDS: ReadonlySet<StimulusKind> = new Set(['PASSAGE', 'PAIRED_PASSAGE', 'POEM', 'NUMBERED_TEXT', 'DRAFT_PARAGRAPH']);
const PYTHAGORAS_TOLERANCE = 1e-6;

interface ResolvedChart { categories: string[] | null; x: number[] | null; series: Array<{ label: string; values: number[] }> }

/** The numbers a chart shows, read from the data of its stimulus. A reference that does not resolve is a named violation. */
export function resolveChartData(chart: ChartSpec, s: StructuredStimulus): { ok: true; data: ResolvedChart } | { ok: false; violations: StructuredStimulusViolation[] } {
  const bad = new Set<StructuredStimulusViolation>();
  let categories: string[] | null = null;
  let x: number[] | null = null;
  const series: ResolvedChart['series'] = [];
  if (chart.source.kind === 'TABLE') {
    const src = chart.source;
    const table = s.tables.find((t) => t.tableKey === src.tableKey);
    if (!table) return { ok: false, violations: ['CHART_TABLE_NOT_FOUND'] };
    const col = (key: string) => table.columns.findIndex((c) => c.key === key);
    if (src.xColumn !== null) {
      const i = col(src.xColumn);
      if (i < 0) bad.add('CHART_COLUMN_NOT_FOUND');
      else if (table.columns[i].type === 'NUMBER') x = table.rows.map((r) => r[i] as number);
      else categories = table.rows.map((r) => String(r[i]));
    }
    for (const key of src.valueColumns) {
      const i = col(key);
      if (i < 0) bad.add('CHART_COLUMN_NOT_FOUND');
      else if (table.columns[i].type !== 'NUMBER' || table.rows.some((r) => typeof r[i] !== 'number')) bad.add('CHART_VALUES_NOT_NUMERIC');
      else series.push({ label: table.columns[i].label, values: table.rows.map((r) => r[i] as number) });
    }
  } else {
    const src = chart.source;
    const set = s.dataSets.find((d) => d.dataSetKey === src.dataSetKey);
    if (!set) return { ok: false, violations: ['CHART_DATA_SET_NOT_FOUND'] };
    categories = set.categories;
    if (src.xSeriesKey !== null) {
      const xs = set.series.find((q) => q.seriesKey === src.xSeriesKey);
      if (!xs) bad.add('CHART_SERIES_NOT_FOUND');
      else x = xs.values;
    }
    for (const key of src.seriesKeys) {
      const q = set.series.find((z2) => z2.seriesKey === key);
      if (!q) bad.add('CHART_SERIES_NOT_FOUND');
      else series.push({ label: q.label, values: q.values });
    }
  }
  if (bad.size === 0) {
    const pointwise = chart.chartType === 'SCATTER' || chart.chartType === 'COORDINATE_PLOT';
    if (pointwise && x === null) bad.add('CHART_NEEDS_NUMERIC_X');
    if ((chart.chartType === 'BAR' || chart.chartType === 'LINE') && categories === null && x === null) bad.add('CHART_NEEDS_CATEGORIES');
    const n = x?.length ?? categories?.length ?? series[0]?.values.length ?? 0;
    if (chart.chartType !== 'NUMBER_LINE' && series.some((q) => q.values.length !== n)) bad.add('SERIES_LENGTH_MISMATCH');
  }
  return bad.size > 0 ? { ok: false, violations: [...bad] } : { ok: true, data: { categories, x, series } };
}

/** Is the structured content internally consistent, and is it what a stimulus of this kind needs? Empty = yes. */
export function structuredStimulusViolations(kind: StimulusKind, s: StructuredStimulus | undefined | null): StructuredStimulusViolation[] {
  const out = new Set<StructuredStimulusViolation>();
  if (!s) {
    if (kind === 'TABLE') out.add('KIND_NEEDS_A_TABLE');
    if (kind === 'DATA_SET') out.add('KIND_NEEDS_A_DATA_SET');
    if (kind === 'GRAPH') out.add('KIND_NEEDS_A_CHART');
    if (kind === 'FIGURE') out.add('KIND_NEEDS_A_FIGURE');
    if (kind === 'COMPOSITE') out.add('COMPOSITE_NEEDS_STRUCTURED_DATA');
    return [...out];
  }
  if (TEXT_STIMULUS_KINDS.has(kind)) out.add('TEXT_KIND_CARRIES_STRUCTURED_DATA');
  if (kind === 'TABLE' && s.tables.length === 0) out.add('KIND_NEEDS_A_TABLE');
  if (kind === 'DATA_SET' && s.dataSets.length === 0) out.add('KIND_NEEDS_A_DATA_SET');
  if (kind === 'GRAPH' && s.charts.length === 0) out.add('KIND_NEEDS_A_CHART');
  if (kind === 'FIGURE' && s.figures.length === 0) out.add('KIND_NEEDS_A_FIGURE');
  if (kind === 'COMPOSITE' && s.tables.length + s.dataSets.length + s.charts.length + s.figures.length === 0) out.add('COMPOSITE_NEEDS_STRUCTURED_DATA');
  const keys = [...s.tables.map((t) => `t:${t.tableKey}`), ...s.dataSets.map((d) => `d:${d.dataSetKey}`), ...s.charts.map((c) => `c:${c.chartKey}`), ...s.figures.map((f) => `f:${f.figureKey}`)];
  if (new Set(keys).size !== keys.length) out.add('DUPLICATE_KEY');
  for (const t of s.tables) {
    if (new Set(t.columns.map((c) => c.key)).size !== t.columns.length) out.add('DUPLICATE_KEY');
    for (const row of t.rows) {
      if (row.length !== t.columns.length) out.add('TABLE_ROW_WIDTH_MISMATCH');
      else if (row.some((cell, i) => (t.columns[i].type === 'NUMBER') !== (typeof cell === 'number'))) out.add('TABLE_CELL_TYPE_MISMATCH');
    }
  }
  for (const d of s.dataSets) {
    if (new Set(d.series.map((q) => q.seriesKey)).size !== d.series.length) out.add('DUPLICATE_KEY');
    if (d.categories && d.series.some((q) => q.values.length !== d.categories!.length)) out.add('SERIES_LENGTH_MISMATCH');
  }
  for (const c of s.charts) {
    const r = resolveChartData(c, s);
    if (!r.ok) r.violations.forEach((v) => out.add(v));
  }
  for (const f of s.figures) {
    const measures = f.shape === 'RIGHT_TRIANGLE' ? [f.legA, f.legB, f.hypotenuse] : f.shape === 'RECTANGLE' ? [f.width, f.height] : f.shape === 'CIRCLE' ? [f.radius, ...(f.diameter ? [f.diameter] : [])] : [f.angle];
    if (measures.some((m) => m.value !== null && m.value <= 0)) out.add('NON_POSITIVE_MEASURE');
    if (measures.every((m) => m.value === null)) out.add('FIGURE_HAS_NO_GIVEN_MEASURE');
    if (f.shape === 'RIGHT_TRIANGLE') {
      const [a, b, c] = [f.legA.value, f.legB.value, f.hypotenuse.value];
      // checkable only when the three sides are given; with two, the third is what the question asks for
      if (a !== null && b !== null && c !== null && Math.abs(a * a + b * b - c * c) > PYTHAGORAS_TOLERANCE * Math.max(1, c * c)) out.add('RIGHT_TRIANGLE_NOT_PYTHAGOREAN');
      if (c !== null && ((a !== null && a >= c) || (b !== null && b >= c))) out.add('HYPOTENUSE_IS_NOT_THE_LONGEST_SIDE');
    }
    if (f.shape === 'CIRCLE' && f.diameter && f.radius.value !== null && f.diameter.value !== null && Math.abs(f.diameter.value - 2 * f.radius.value) > 1e-9) out.add('CIRCLE_DIAMETER_IS_NOT_TWICE_THE_RADIUS');
    if (f.shape === 'ANGLE_BETWEEN_LINES' && f.angle.value !== null && (f.angle.value <= 0 || f.angle.value >= 180)) out.add('ANGLE_OUT_OF_RANGE');
  }
  return [...out];
}

/** Every number the structured content states: table cells, series values, figure measures. */
export function structuredNumbers(s: StructuredStimulus | undefined | null): number[] {
  if (!s) return [];
  const figure = (f: FigureSpec) => (f.shape === 'RIGHT_TRIANGLE' ? [f.legA, f.legB, f.hypotenuse] : f.shape === 'RECTANGLE' ? [f.width, f.height] : f.shape === 'CIRCLE' ? [f.radius, ...(f.diameter ? [f.diameter] : [])] : [f.angle]).flatMap((m) => (m.value === null ? [] : [m.value]));
  return [...s.tables.flatMap((t) => t.rows.flatMap((r) => r.filter((c): c is number => typeof c === 'number'))), ...s.dataSets.flatMap((d) => d.series.flatMap((q) => q.values)), ...s.figures.flatMap(figure)];
}

// ---------------------------------------------------------------------------------------------------------------
// rendering: small, dependency-free, deterministic
// ---------------------------------------------------------------------------------------------------------------
type Lang = string;
const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = (n: number): string => String(Math.round(n * 100) / 100);
/** A number as the stimulus's language writes it (decimal comma in Spanish). */
export const formatNumber = (n: number, language: Lang): string => (language === 'es' ? r2(n).replace('.', ',') : r2(n));
const withUnit = (text: string, unit: string | null): string => (unit ? (unit === '°' ? `${text}°` : `${text} ${unit}`) : text);
const measureText = (m: { label: string; value: number | null }, unit: string | null, language: Lang): string => (m.value === null ? m.label : withUnit(formatNumber(m.value, language), unit));
const STYLE = 'font-family="sans-serif" font-size="12" fill="#111"';
const open = (w: number, h: number, title: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img"><title>${esc(title)}</title><rect width="${w}" height="${h}" fill="#fff"/>`;
const text = (x: number, y: number, t: string, anchor = 'middle', extra = ''): string => `<text x="${r2(x)}" y="${r2(y)}" text-anchor="${anchor}" ${STYLE}${extra}>${esc(t)}</text>`;
const line = (x1: number, y1: number, x2: number, y2: number, stroke = '#111', width = 1): string => `<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" stroke="${stroke}" stroke-width="${width}"/>`;
const SERIES_FILL = ['#2b6cb0', '#c05621', '#2f855a', '#6b46c1'];

/** A round axis step giving at most about eight ticks. */
function niceStep(span: number): number {
  if (!(span > 0)) return 1;
  const raw = span / 6;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}
function axisRange(values: number[], includeZero: boolean): { min: number; max: number; step: number } {
  const lo = Math.min(...values, ...(includeZero ? [0] : []));
  const hi = Math.max(...values, ...(includeZero ? [0] : []));
  const step = niceStep(hi - lo || Math.abs(hi) || 1);
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  return { min, max: max === min ? min + step : max, step };
}
const ticks = (a: { min: number; max: number; step: number }): number[] => Array.from({ length: Math.round((a.max - a.min) / a.step) + 1 }, (_, i) => Math.round((a.min + i * a.step) * 1e6) / 1e6);

/** Renders a chart from its specification and the data of its stimulus. Throws when a reference does not resolve. */
export function renderChartSvg(chart: ChartSpec, s: StructuredStimulus, language: Lang = 'es'): string {
  const resolved = resolveChartData(chart, s);
  if (!resolved.ok) throw new Error(`CHART_NOT_RENDERABLE: ${resolved.violations.join(',')}`);
  const { categories, x, series } = resolved.data;
  const W = 480, H = 320, L = 56, R = 16, T = 36, B = 56;
  const pw = W - L - R, ph = H - T - B;
  const parts: string[] = [open(W, H, chart.title), text(W / 2, 20, chart.title, 'middle', ' font-weight="bold"')];
  if (chart.chartType === 'NUMBER_LINE') {
    const pts = series.flatMap((q) => q.values);
    const a = axisRange(pts, true);
    const px = (v: number) => L + ((v - a.min) / (a.max - a.min)) * pw;
    const y = H / 2;
    parts.push(line(L - 10, y, W - R + 10, y, '#111', 1.5));
    for (const t of ticks(a)) parts.push(line(px(t), y - 5, px(t), y + 5), text(px(t), y + 22, formatNumber(t, language)));
    for (const v of pts) parts.push(`<circle cx="${r2(px(v))}" cy="${r2(y)}" r="5" fill="${SERIES_FILL[0]}"/>`);
    if (chart.xLabel) parts.push(text(W / 2, H - 16, chart.xLabel));
    return `${parts.join('')}</svg>`;
  }
  const pointwise = chart.chartType === 'SCATTER' || chart.chartType === 'COORDINATE_PLOT';
  const ya = axisRange(series.flatMap((q) => q.values), true);
  const py = (v: number) => T + ph - ((v - ya.min) / (ya.max - ya.min)) * ph;
  for (const t of ticks(ya)) parts.push(line(L, py(t), W - R, py(t), '#ddd'), text(L - 6, py(t) + 4, formatNumber(t, language), 'end'));
  if (pointwise || (x !== null && chart.chartType === 'LINE')) {
    const xa = axisRange(x!, pointwise);
    const px = (v: number) => L + ((v - xa.min) / (xa.max - xa.min)) * pw;
    for (const t of ticks(xa)) parts.push(line(px(t), T, px(t), T + ph, '#eee'), text(px(t), T + ph + 16, formatNumber(t, language)));
    // the axes go through zero when zero is in range (a coordinate plane), otherwise along the frame
    const x0 = xa.min <= 0 && xa.max >= 0 ? px(0) : L;
    const y0 = ya.min <= 0 && ya.max >= 0 ? py(0) : T + ph;
    parts.push(line(L, y0, W - R, y0, '#111', 1.5), line(x0, T, x0, T + ph, '#111', 1.5));
    series.forEach((q, i) => {
      const pts = q.values.map((v, k) => `${r2(px(x![k]))},${r2(py(v))}`);
      if (chart.chartType !== 'SCATTER') parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${SERIES_FILL[i % 4]}" stroke-width="2"/>`);
      q.values.forEach((v, k) => parts.push(`<circle cx="${r2(px(x![k]))}" cy="${r2(py(v))}" r="4" fill="${SERIES_FILL[i % 4]}"/>`));
    });
  } else {
    const labels = categories ?? x!.map((v) => formatNumber(v, language));
    const slot = pw / labels.length;
    parts.push(line(L, T + ph, W - R, T + ph, '#111', 1.5), line(L, T, L, T + ph, '#111', 1.5));
    labels.forEach((label, k) => parts.push(text(L + slot * (k + 0.5), T + ph + 16, label)));
    series.forEach((q, i) => {
      if (chart.chartType === 'BAR') {
        const bw = (slot * 0.7) / series.length;
        q.values.forEach((v, k) => {
          const x0 = L + slot * k + slot * 0.15 + bw * i;
          parts.push(`<rect x="${r2(x0)}" y="${r2(Math.min(py(v), py(0)))}" width="${r2(bw)}" height="${r2(Math.abs(py(0) - py(v)))}" fill="${SERIES_FILL[i % 4]}"/>`, text(x0 + bw / 2, Math.min(py(v), py(0)) - 4, formatNumber(v, language)));
        });
      } else {
        const pts = q.values.map((v, k) => `${r2(L + slot * (k + 0.5))},${r2(py(v))}`);
        parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${SERIES_FILL[i % 4]}" stroke-width="2"/>`);
        q.values.forEach((v, k) => parts.push(`<circle cx="${r2(L + slot * (k + 0.5))}" cy="${r2(py(v))}" r="4" fill="${SERIES_FILL[i % 4]}"/>`));
      }
    });
  }
  if (series.length > 1) series.forEach((q, i) => parts.push(`<rect x="${r2(L + 8 + i * 130)}" y="${T - 10}" width="10" height="10" fill="${SERIES_FILL[i % 4]}"/>`, text(L + 22 + i * 130, T - 1, q.label, 'start')));
  if (chart.xLabel) parts.push(text(L + pw / 2, H - 14, chart.xLabel));
  if (chart.yLabel) parts.push(`<text x="14" y="${r2(T + ph / 2)}" text-anchor="middle" transform="rotate(-90 14 ${r2(T + ph / 2)})" ${STYLE}>${esc(chart.yLabel)}</text>`);
  return `${parts.join('')}</svg>`;
}

/** Renders a geometry figure from its specification. To scale when every measure is given; a schematic otherwise. */
export function renderFigureSvg(f: FigureSpec, language: Lang = 'es'): string {
  const W = 360, H = 260;
  const stroke = 'fill="none" stroke="#111" stroke-width="2"';
  const parts: string[] = [];
  if (f.shape === 'RIGHT_TRIANGLE') {
    // the missing side is completed by Pythagoras when two are given, for the proportions only
    let [a, b] = [f.legA.value, f.legB.value];
    const c = f.hypotenuse.value;
    if (a === null && b !== null && c !== null && c > b) a = Math.sqrt(c * c - b * b);
    if (b === null && a !== null && c !== null && c > a) b = Math.sqrt(c * c - a * a);
    a = a ?? 3;
    b = b ?? 4;
    const k = Math.min(240 / b, 160 / a);
    const x0 = (W - b * k) / 2, y0 = 210;
    const x1 = x0 + b * k, y1 = y0 - a * k;
    parts.push(open(W, H, altText(f, language)), `<polygon points="${r2(x0)},${r2(y0)} ${r2(x1)},${r2(y0)} ${r2(x0)},${r2(y1)}" ${stroke}/>`, `<polyline points="${r2(x0 + 12)},${r2(y0)} ${r2(x0 + 12)},${r2(y0 - 12)} ${r2(x0)},${r2(y0 - 12)}" ${stroke.replace('2"', '1"')}/>`,
      text((x0 + x1) / 2, y0 + 18, measureText(f.legB, f.unit, language)), text(x0 - 8, (y0 + y1) / 2, measureText(f.legA, f.unit, language), 'end'), text((x0 + x1) / 2 + 12, (y0 + y1) / 2 - 8, measureText(f.hypotenuse, f.unit, language), 'start'));
  } else if (f.shape === 'RECTANGLE') {
    const w = f.width.value ?? 4, h = f.height.value ?? 3;
    const k = Math.min(240 / w, 160 / h);
    const x0 = (W - w * k) / 2, y0 = (H - h * k) / 2;
    parts.push(open(W, H, altText(f, language)), `<rect x="${r2(x0)}" y="${r2(y0)}" width="${r2(w * k)}" height="${r2(h * k)}" ${stroke}/>`, text(W / 2, y0 + h * k + 18, measureText(f.width, f.unit, language)), text(x0 - 8, H / 2 + 4, measureText(f.height, f.unit, language), 'end'));
  } else if (f.shape === 'CIRCLE') {
    const cx = W / 2, cy = H / 2, rad = 90;
    parts.push(open(W, H, altText(f, language)), `<circle cx="${cx}" cy="${cy}" r="${rad}" ${stroke}/>`, `<circle cx="${cx}" cy="${cy}" r="3" fill="#111"/>`);
    if (f.diameter) parts.push(line(cx - rad, cy, cx + rad, cy, '#111', 1.5), text(cx, cy + 18, measureText(f.diameter, f.unit, language)));
    else parts.push(line(cx, cy, cx + rad, cy, '#111', 1.5), text(cx + rad / 2, cy - 8, measureText(f.radius, f.unit, language)));
  } else {
    const deg = f.angle.value ?? 60;
    const cx = 80, cy = 200, len = 220, rad = (deg * Math.PI) / 180;
    parts.push(open(W, H, altText(f, language)), line(cx, cy, cx + len, cy, '#111', 2), line(cx, cy, cx + len * Math.cos(rad), cy - len * Math.sin(rad), '#111', 2),
      `<path d="M ${r2(cx + 40)} ${cy} A 40 40 0 0 0 ${r2(cx + 40 * Math.cos(rad))} ${r2(cy - 40 * Math.sin(rad))}" ${stroke.replace('2"', '1"')}/>`, text(cx + 62 * Math.cos(rad / 2), cy - 62 * Math.sin(rad / 2) + 4, measureText(f.angle, '°', language)));
  }
  return `${parts.join('')}</svg>`;
}

const AND: Record<string, string> = { es: 'y', en: 'and' };
const list = (xs: string[], language: Lang): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${AND[language] ?? 'and'} ${xs[xs.length - 1]}`);

/** Alt text of a chart or a figure, generated from the structured data in the stimulus's language (Spanish or English). */
export function altText(spec: FigureSpec | ChartSpec, language: Lang = 'es', s?: StructuredStimulus): string {
  const es = language === 'es';
  if ('chartType' in spec) {
    const resolved = s ? resolveChartData(spec, s) : null;
    const kind = { BAR: es ? 'Gráfico de barras' : 'Bar chart', LINE: es ? 'Gráfico de líneas' : 'Line chart', SCATTER: es ? 'Diagrama de dispersión' : 'Scatter plot', NUMBER_LINE: es ? 'Recta numérica' : 'Number line', COORDINATE_PLOT: es ? 'Plano cartesiano' : 'Coordinate plane' }[spec.chartType];
    if (!resolved || !resolved.ok) return `${kind}: ${spec.title}.`;
    const { categories, x, series } = resolved.data;
    const described = series.map((q) => {
      if (spec.chartType === 'NUMBER_LINE') return `${q.label}: ${list(q.values.map((v) => formatNumber(v, language)), language)}`;
      const positions = x && (spec.chartType === 'SCATTER' || spec.chartType === 'COORDINATE_PLOT') ? q.values.map((v, k) => `(${formatNumber(x[k], language)}; ${formatNumber(v, language)})`) : q.values.map((v, k) => `${categories?.[k] ?? (x ? formatNumber(x[k], language) : String(k + 1))}: ${formatNumber(v, language)}`);
      return `${q.label} — ${positions.join(', ')}`;
    });
    return `${kind}: ${spec.title}. ${described.join('. ')}.`;
  }
  const m = (x: { label: string; value: number | null }, unit: string | null) => (x.value === null ? (es ? `desconocido, marcado ${x.label}` : `unknown, marked ${x.label}`) : withUnit(formatNumber(x.value, language), unit));
  // a given measure is stated by its value; an unknown by the label the figure shows for it
  if (spec.shape === 'RIGHT_TRIANGLE') return es ? `Triángulo rectángulo. Cateto: ${m(spec.legA, spec.unit)}. Cateto: ${m(spec.legB, spec.unit)}. Hipotenusa: ${m(spec.hypotenuse, spec.unit)}.` : `Right triangle. Leg: ${m(spec.legA, spec.unit)}. Leg: ${m(spec.legB, spec.unit)}. Hypotenuse: ${m(spec.hypotenuse, spec.unit)}.`;
  if (spec.shape === 'RECTANGLE') return es ? `Rectángulo. Base: ${m(spec.width, spec.unit)}. Altura: ${m(spec.height, spec.unit)}.` : `Rectangle. Width: ${m(spec.width, spec.unit)}. Height: ${m(spec.height, spec.unit)}.`;
  if (spec.shape === 'CIRCLE') return es ? `Círculo. Radio: ${m(spec.radius, spec.unit)}.${spec.diameter ? ` Diámetro: ${m(spec.diameter, spec.unit)}.` : ''}` : `Circle. Radius: ${m(spec.radius, spec.unit)}.${spec.diameter ? ` Diameter: ${m(spec.diameter, spec.unit)}.` : ''}`;
  return es ? `Dos rectas que se cortan formando un ángulo: ${m(spec.angle, '°')}.` : `Two lines meeting at an angle: ${m(spec.angle, '°')}.`;
}

/** Every derived asset of a stimulus: one per chart, one per figure, in that order. */
export function renderStructuredAssets(s: StructuredStimulus, language: Lang = 'es'): RenderedAsset[] {
  return [
    ...s.charts.map((c) => ({ assetKey: `chart:${c.chartKey}`, assetKind: 'CHART' as const, renderer: { ...STIMULUS_RENDERER }, svg: renderChartSvg(c, s, language), altText: altText(c, language, s) })),
    ...s.figures.map((f) => ({ assetKey: `figure:${f.figureKey}`, assetKind: 'FIGURE' as const, renderer: { ...STIMULUS_RENDERER }, svg: renderFigureSvg(f, language), altText: altText(f, language) })),
  ];
}

/** A table as plain text (a derived, readable form for a text part and for screen readers). */
export function tableAsText(t: TableSpec, language: Lang = 'es'): string {
  const head = t.columns.map((c) => (c.unit ? `${c.label} (${c.unit})` : c.label)).join(' | ');
  return [t.title, head, ...t.rows.map((r) => r.map((c) => (typeof c === 'number' ? formatNumber(c, language) : c)).join(' | '))].join('\n');
}
/** A data set as plain text. */
export function dataSetAsText(d: DataSetSpec, language: Lang = 'es'): string {
  return [d.title, ...d.series.map((q) => `${q.unit ? `${q.label} (${q.unit})` : q.label}: ${q.values.map((v, k) => (d.categories ? `${d.categories[k]} ${formatNumber(v, language)}` : formatNumber(v, language))).join(d.categories ? '; ' : ', ')}`)].join('\n');
}

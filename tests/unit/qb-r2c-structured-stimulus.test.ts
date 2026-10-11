/**
 * QB-R2C -- structured stimuli: data -> chart / figure specification -> rendered asset.
 * The SVG and the alt text are DERIVED and deterministic; a chart carries no numbers of its own.
 */
import { describe, expect, it } from 'vitest';
import { CandidateStimulusSchema } from '@/lib/exam-core/question-bank/production/generation-contract';
import { altText, ChartSpecSchema, dataSetAsText, FigureSpecSchema, formatNumber, renderChartSvg, renderFigureSvg, renderStructuredAssets, resolveChartData, STIMULUS_RENDERER, StructuredStimulusSchema, structuredNumbers, structuredStimulusViolations, tableAsText, type ChartSpec, type FigureSpec, type StructuredStimulus } from '@/lib/exam-core/question-bank/production/stimulus-spec';

const TABLE = { tableKey: 't', title: 'Lluvia por mes', columns: [{ key: 'mes', label: 'Mes', type: 'TEXT' as const, unit: null }, { key: 'mm', label: 'Lluvia', type: 'NUMBER' as const, unit: 'mm' }, { key: 'dias', label: 'Días de lluvia', type: 'NUMBER' as const, unit: null }], rows: [['Enero', 12.5, 3], ['Febrero', 40, 8], ['Marzo', 27.25, 6]] as Array<Array<string | number>> };
const SET = { dataSetKey: 'd', title: 'Puntos', categories: null, series: [{ seriesKey: 'x', label: 'x', unit: null, values: [-2, 0, 1, 3] }, { seriesKey: 'y', label: 'y', unit: null, values: [-3, 1, 3, 7] }] };
const bar: ChartSpec = { chartKey: 'barras', chartType: 'BAR', title: 'Lluvia por mes', xLabel: 'Mes', yLabel: 'mm', source: { kind: 'TABLE', tableKey: 't', xColumn: 'mes', valueColumns: ['mm'] } };
const structured = (over: Partial<StructuredStimulus> = {}): StructuredStimulus => ({ v: 1, tables: [TABLE], dataSets: [SET], charts: [bar], figures: [], ...over });
const triangle = (a: number | null, b: number | null, c: number | null): FigureSpec => ({ figureKey: 'tri', shape: 'RIGHT_TRIANGLE', unit: 'cm', legA: { label: 'a', value: a }, legB: { label: 'b', value: b }, hypotenuse: { label: 'c', value: c } });
const figures = (...fs: FigureSpec[]): StructuredStimulus => ({ v: 1, tables: [], dataSets: [], charts: [], figures: fs });
const wellFormed = (svg: string): boolean => {
  const tags = [...svg.matchAll(/<(\/?)([a-z]+)([^>]*?)(\/?)>/g)];
  const stack: string[] = [];
  for (const [, close, name, , selfClose] of tags) {
    if (selfClose) continue;
    if (close) { if (stack.pop() !== name) return false; } else stack.push(name);
  }
  return stack.length === 0 && svg.startsWith('<svg ') && svg.endsWith('</svg>');
};

describe('data first: tables, data sets, and charts that reference them', () => {
  it('a well-formed structured stimulus parses and has no violation for its kind', () => {
    expect(StructuredStimulusSchema.safeParse(structured()).success).toBe(true);
    expect(structuredStimulusViolations('TABLE', structured())).toEqual([]);
    expect(structuredStimulusViolations('GRAPH', structured())).toEqual([]);
    expect(structuredStimulusViolations('COMPOSITE', structured())).toEqual([]);
    expect(structuredStimulusViolations('DATA_SET', structured())).toEqual([]);
  });

  it('a chart specification carries no numbers: the schema has no field for them', () => {
    expect(ChartSpecSchema.safeParse({ ...bar, values: [1, 2, 3] }).success).toBe(false);
    expect(ChartSpecSchema.safeParse({ ...bar, source: { ...bar.source, data: [[1, 2]] } }).success).toBe(false);
    expect(resolveChartData(bar, structured())).toEqual({ ok: true, data: { categories: ['Enero', 'Febrero', 'Marzo'], x: null, series: [{ label: 'Lluvia', values: [12.5, 40, 27.25] }] } });
  });

  it('NEGATIVE: a chart whose table, column or series does not exist in the stimulus is a named violation', () => {
    const v = (chart: ChartSpec, s: StructuredStimulus = structured()) => structuredStimulusViolations('GRAPH', { ...s, charts: [chart] });
    expect(v({ ...bar, source: { kind: 'TABLE', tableKey: 'otra', xColumn: 'mes', valueColumns: ['mm'] } })).toEqual(['CHART_TABLE_NOT_FOUND']);
    expect(v({ ...bar, source: { kind: 'TABLE', tableKey: 't', xColumn: 'mes', valueColumns: ['nieve'] } })).toEqual(['CHART_COLUMN_NOT_FOUND']);
    expect(v({ ...bar, source: { kind: 'TABLE', tableKey: 't', xColumn: 'mes', valueColumns: ['mes'] } })).toEqual(['CHART_VALUES_NOT_NUMERIC']);
    expect(v({ ...bar, source: { kind: 'DATA_SET', dataSetKey: 'no', xSeriesKey: null, seriesKeys: ['y'] } })).toEqual(['CHART_DATA_SET_NOT_FOUND']);
    expect(v({ ...bar, source: { kind: 'DATA_SET', dataSetKey: 'd', xSeriesKey: 'x', seriesKeys: ['z'] } })).toEqual(['CHART_SERIES_NOT_FOUND']);
    expect(v({ ...bar, chartType: 'SCATTER', source: { kind: 'DATA_SET', dataSetKey: 'd', xSeriesKey: null, seriesKeys: ['y'] } })).toEqual(['CHART_NEEDS_NUMERIC_X']);
    expect(v({ ...bar, source: { kind: 'DATA_SET', dataSetKey: 'd', xSeriesKey: null, seriesKeys: ['y'] } })).toEqual(['CHART_NEEDS_CATEGORIES']);
    expect(() => renderChartSvg({ ...bar, source: { kind: 'TABLE', tableKey: 'otra', xColumn: null, valueColumns: ['mm'] } }, structured())).toThrow(/CHART_NOT_RENDERABLE/);
  });

  it('NEGATIVE: a table row of the wrong width or type, a series of the wrong length, a duplicate key', () => {
    expect(structuredStimulusViolations('TABLE', structured({ charts: [], tables: [{ ...TABLE, rows: [['Enero', 12.5]] }] }))).toEqual(['TABLE_ROW_WIDTH_MISMATCH']);
    expect(structuredStimulusViolations('TABLE', structured({ charts: [], tables: [{ ...TABLE, rows: [['Enero', 'mucho', 3]] }] }))).toEqual(['TABLE_CELL_TYPE_MISMATCH']);
    expect(structuredStimulusViolations('DATA_SET', structured({ charts: [], dataSets: [{ ...SET, categories: ['a', 'b'] }] }))).toEqual(['SERIES_LENGTH_MISMATCH']);
    expect(structuredStimulusViolations('TABLE', structured({ tables: [TABLE, TABLE] }))).toEqual(['DUPLICATE_KEY']);
  });

  it('each kind needs its own data; a text kind carries none', () => {
    const empty: StructuredStimulus = { v: 1, tables: [], dataSets: [], charts: [], figures: [] };
    expect(structuredStimulusViolations('TABLE', empty)).toEqual(['KIND_NEEDS_A_TABLE']);
    expect(structuredStimulusViolations('DATA_SET', null)).toEqual(['KIND_NEEDS_A_DATA_SET']);
    expect(structuredStimulusViolations('GRAPH', empty)).toEqual(['KIND_NEEDS_A_CHART']);
    expect(structuredStimulusViolations('FIGURE', undefined)).toEqual(['KIND_NEEDS_A_FIGURE']);
    expect(structuredStimulusViolations('COMPOSITE', empty)).toEqual(['COMPOSITE_NEEDS_STRUCTURED_DATA']);
    expect(structuredStimulusViolations('PASSAGE', null)).toEqual([]);
    expect(structuredStimulusViolations('NUMBERED_TEXT', structured())).toEqual(['TEXT_KIND_CARRIES_STRUCTURED_DATA']);
  });
});

describe('figures: geometry specifications with consistent measures', () => {
  it('a right triangle with three sides must satisfy Pythagoras; with two, the third is the unknown', () => {
    expect(structuredStimulusViolations('FIGURE', figures(triangle(3, 4, 5)))).toEqual([]);
    expect(structuredStimulusViolations('FIGURE', figures(triangle(7, 24, 25)))).toEqual([]);
    expect(structuredStimulusViolations('FIGURE', figures(triangle(1.5, 2, 2.5)))).toEqual([]);
    expect(structuredStimulusViolations('FIGURE', figures(triangle(null, 24, 25)))).toEqual([]);
    expect(structuredStimulusViolations('FIGURE', figures(triangle(3, 4, null)))).toEqual([]);
    expect(structuredStimulusViolations('FIGURE', figures(triangle(3, 4, 6)))).toEqual(['RIGHT_TRIANGLE_NOT_PYTHAGOREAN']);
    expect(structuredStimulusViolations('FIGURE', figures(triangle(null, 25, 24)))).toEqual(['HYPOTENUSE_IS_NOT_THE_LONGEST_SIDE']);
    expect(structuredStimulusViolations('FIGURE', figures(triangle(null, null, null)))).toEqual(['FIGURE_HAS_NO_GIVEN_MEASURE']);
    expect(structuredStimulusViolations('FIGURE', figures(triangle(-3, 4, null)))).toEqual(['NON_POSITIVE_MEASURE']);
  });

  it('circle, rectangle and angle are checked where they can be', () => {
    const circle = (r: number | null, d: number | null): FigureSpec => ({ figureKey: 'c', shape: 'CIRCLE', unit: 'm', radius: { label: 'r', value: r }, diameter: d === null ? null : { label: 'd', value: d } });
    expect(structuredStimulusViolations('FIGURE', figures(circle(5, 10)))).toEqual([]);
    expect(structuredStimulusViolations('FIGURE', figures(circle(5, null)))).toEqual([]);
    expect(structuredStimulusViolations('FIGURE', figures(circle(5, 11)))).toEqual(['CIRCLE_DIAMETER_IS_NOT_TWICE_THE_RADIUS']);
    expect(structuredStimulusViolations('FIGURE', figures({ figureKey: 'r', shape: 'RECTANGLE', unit: 'm', width: { label: 'b', value: 12 }, height: { label: 'h', value: 0 } }))).toEqual(['NON_POSITIVE_MEASURE']);
    const angle = (deg: number): FigureSpec => ({ figureKey: 'a', shape: 'ANGLE_BETWEEN_LINES', unit: '°', angle: { label: 'α', value: deg } });
    expect(structuredStimulusViolations('FIGURE', figures(angle(60)))).toEqual([]);
    expect(structuredStimulusViolations('FIGURE', figures(angle(180)))).toEqual(['ANGLE_OUT_OF_RANGE']);
    expect(FigureSpecSchema.safeParse({ figureKey: 'x', shape: 'PENTAGON', unit: 'cm' }).success).toBe(false);
  });

  it('every number the stimulus states can be listed, so a question can be checked against them', () => {
    expect(structuredNumbers(structured()).sort((a, b) => a - b)).toEqual([-3, -2, 0, 1, 1, 3, 3, 3, 6, 7, 8, 12.5, 27.25, 40]);
    expect(structuredNumbers(figures(triangle(null, 24, 25)))).toEqual([24, 25]);
    expect(structuredNumbers(null)).toEqual([]);
  });
});

describe('rendering is derived and deterministic', () => {
  const coordinate: ChartSpec = { chartKey: 'plano', chartType: 'COORDINATE_PLOT', title: 'Recta', xLabel: 'x', yLabel: 'y', source: { kind: 'DATA_SET', dataSetKey: 'd', xSeriesKey: 'x', seriesKeys: ['y'] } };
  const charts: ChartSpec[] = [bar, { ...bar, chartKey: 'lineas', chartType: 'LINE' }, { ...coordinate, chartKey: 'dispersion', chartType: 'SCATTER' }, coordinate, { chartKey: 'recta', chartType: 'NUMBER_LINE', title: 'Puntos en la recta', xLabel: null, yLabel: null, source: { kind: 'DATA_SET', dataSetKey: 'd', xSeriesKey: null, seriesKeys: ['x'] } }, { ...bar, chartKey: 'dos', source: { kind: 'TABLE', tableKey: 't', xColumn: 'mes', valueColumns: ['mm', 'dias'] } }];

  it('every chart type renders to a well-formed SVG, the same bytes every time', () => {
    for (const c of charts) {
      const svg = renderChartSvg(c, structured(), 'es');
      expect(wellFormed(svg), c.chartKey).toBe(true);
      expect(renderChartSvg(JSON.parse(JSON.stringify(c)), JSON.parse(JSON.stringify(structured())), 'es'), c.chartKey).toBe(svg);
      expect(svg).toContain(`<title>${c.title}</title>`);
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    }
    // a bar chart draws one bar per value and labels it with the number, in the stimulus's language
    const svg = renderChartSvg(bar, structured(), 'es');
    expect((svg.match(/<rect /g) ?? []).length).toBe(1 + 3);
    expect(svg).toContain('>12,5<');
    expect(renderChartSvg(bar, structured(), 'en')).toContain('>12.5<');
    expect(renderChartSvg(charts[5], structured(), 'es')).toContain('Días de lluvia');
    // a coordinate plot draws its points and joins them; a scatter plot does not join them
    expect(renderChartSvg(coordinate, structured())).toContain('<polyline');
    expect(renderChartSvg(charts[2], structured())).not.toContain('<polyline');
    expect((renderChartSvg(charts[2], structured()).match(/<circle /g) ?? []).length).toBe(4);
  });

  it('the picture changes when the DATA changes, because the chart has no numbers of its own', () => {
    const other = structured({ tables: [{ ...TABLE, rows: [['Enero', 12.5, 3], ['Febrero', 41, 8], ['Marzo', 27.25, 6]] }] });
    expect(renderChartSvg(bar, other)).not.toBe(renderChartSvg(bar, structured()));
    expect(renderChartSvg(bar, other)).toContain('>41<');
  });

  it('figures render to well-formed SVG; given measures are drawn with their unit, the unknown with its label', () => {
    const specs: FigureSpec[] = [triangle(null, 24, 25), triangle(3, 4, 5), { figureKey: 'r', shape: 'RECTANGLE', unit: 'm', width: { label: 'b', value: 12 }, height: { label: 'h', value: 7 } }, { figureKey: 'c', shape: 'CIRCLE', unit: 'cm', radius: { label: 'r', value: 6.5 }, diameter: null }, { figureKey: 'c2', shape: 'CIRCLE', unit: 'cm', radius: { label: 'r', value: null }, diameter: { label: 'd', value: 10 } }, { figureKey: 'a', shape: 'ANGLE_BETWEEN_LINES', unit: '°', angle: { label: 'α', value: 35 } }];
    for (const f of specs) {
      const svg = renderFigureSvg(f, 'es');
      expect(wellFormed(svg), f.figureKey).toBe(true);
      expect(renderFigureSvg(JSON.parse(JSON.stringify(f)), 'es')).toBe(svg);
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    }
    const tri = renderFigureSvg(specs[0], 'es');
    expect(tri).toContain('>24 cm<');
    expect(tri).toContain('>25 cm<');
    expect(tri).toContain('>a<');
    expect(tri).not.toContain('>7 cm<');
    expect(renderFigureSvg(specs[3], 'es')).toContain('>6,5 cm<');
    expect(renderFigureSvg(specs[5], 'es')).toContain('>35°<');
  });

  it('alt text is generated from the structured data, in the stimulus language', () => {
    expect(altText(triangle(null, 24, 25), 'es')).toBe('Triángulo rectángulo. Cateto: desconocido, marcado a. Cateto: 24 cm. Hipotenusa: 25 cm.');
    expect(altText(triangle(null, 24, 25), 'en')).toBe('Right triangle. Leg: unknown, marked a. Leg: 24 cm. Hypotenuse: 25 cm.');
    expect(altText(bar, 'es', structured())).toBe('Gráfico de barras: Lluvia por mes. Lluvia — Enero: 12,5, Febrero: 40, Marzo: 27,25.');
    expect(altText(bar, 'en', structured())).toBe('Bar chart: Lluvia por mes. Lluvia — Enero: 12.5, Febrero: 40, Marzo: 27.25.');
    expect(altText({ figureKey: 'a', shape: 'ANGLE_BETWEEN_LINES', unit: '°', angle: { label: 'α', value: 35 } }, 'en')).toBe('Two lines meeting at an angle: 35°.');
    expect(formatNumber(1 / 3, 'es')).toBe('0,33');
    expect(tableAsText(TABLE, 'es')).toBe('Lluvia por mes\nMes | Lluvia (mm) | Días de lluvia\nEnero | 12,5 | 3\nFebrero | 40 | 8\nMarzo | 27,25 | 6');
    expect(dataSetAsText(SET, 'en')).toBe('Puntos\nx: -2, 0, 1, 3\ny: -3, 1, 3, 7');
  });

  it('a candidate stimulus carries the specification and the assets rendered from it; re-rendering reproduces them', () => {
    const s = figures(triangle(null, 24, 25));
    const assets = renderStructuredAssets(s, 'es');
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ assetKey: 'figure:tri', assetKind: 'FIGURE', renderer: STIMULUS_RENDERER });
    const stimulus = { stimulusKey: 's1', kind: 'FIGURE', language: 'es', parts: [{ label: 'tri', partKind: 'FIGURE', text: assets[0].altText }], provenance: 'STUDYUS_GENERATED', stimulusPlanId: 'SP|x', structured: s, renderedAssets: assets };
    const parsed = CandidateStimulusSchema.parse(stimulus);
    expect(renderStructuredAssets(parsed.structured!, parsed.language)).toEqual(parsed.renderedAssets);
    expect(renderStructuredAssets(structured(), 'es').map((a) => a.assetKey)).toEqual(['chart:barras']);
    // the QB-R2B shape (text parts only, no structured field) is still a valid stimulus
    expect(CandidateStimulusSchema.safeParse({ stimulusKey: 's0', kind: 'POEM', language: 'es', parts: [{ label: null, partKind: 'VERSE', text: 'un verso' }], provenance: 'STUDYUS_GENERATED' }).success).toBe(true);
  });
});

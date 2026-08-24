'use client';

import { useMemo } from 'react';
import { evaluate } from 'mathjs';
import type { FunctionPlotSpec } from '@/lib/chat-markdown';

const WIDTH = 320;
const HEIGHT = 220;
const PADDING = { top: 16, right: 16, bottom: 28, left: 36 };
const SAMPLES = 240;

interface Point {
  x: number;
  y: number;
}

function sample(spec: FunctionPlotSpec): { points: Point[][]; yMin: number; yMax: number } {
  const [xMin, xMax] = spec.domain;
  const step = (xMax - xMin) / SAMPLES;
  const holes = new Set((spec.holes ?? []).map((h) => Math.round(h * 1e6) / 1e6));

  const runs: Point[][] = [];
  let current: Point[] = [];
  const finiteYs: number[] = [];

  for (let i = 0; i <= SAMPLES; i++) {
    const x = xMin + step * i;
    const roundedX = Math.round(x * 1e6) / 1e6;
    let y: number | null = null;
    if (!holes.has(roundedX)) {
      try {
        // mathjs's evaluate is a real expression parser (no arbitrary
        // JS execution) -- safe to run on an AI-supplied expression
        // string, same pattern already used by interactive-formula.service.ts.
        const raw = evaluate(spec.expression, { x });
        if (typeof raw === 'number' && Number.isFinite(raw)) y = raw;
      } catch {
        y = null;
      }
    }
    if (y === null) {
      if (current.length > 1) runs.push(current);
      current = [];
    } else {
      current.push({ x, y });
      finiteYs.push(y);
    }
  }
  if (current.length > 1) runs.push(current);

  if (finiteYs.length === 0) return { points: runs, yMin: -1, yMax: 1 };
  let yMin = Math.min(...finiteYs);
  let yMax = Math.max(...finiteYs);
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const pad = (yMax - yMin) * 0.1;
  return { points: runs, yMin: yMin - pad, yMax: yMax + pad };
}

/** Value at the hole, approached from the left -- for drawing the open circle at the actual limit, not at an arbitrary y. Falls back to the right-hand value, then null (circle omitted) if neither side evaluates. */
function limitApproachValue(expression: string, holeX: number, domain: [number, number]): number | null {
  const epsilon = Math.max((domain[1] - domain[0]) * 1e-4, 1e-4);
  for (const dx of [-epsilon, epsilon]) {
    try {
      const raw = evaluate(expression, { x: holeX + dx });
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    } catch {
      // try the other side
    }
  }
  return null;
}

export default function FunctionPlotChart({ spec }: { spec: FunctionPlotSpec }) {
  const { points, yMin, yMax } = useMemo(() => sample(spec), [spec]);
  const [xMin, xMax] = spec.domain;

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const toSvgX = (x: number) => PADDING.left + ((x - xMin) / (xMax - xMin || 1)) * plotWidth;
  const toSvgY = (y: number) => PADDING.top + (1 - (y - yMin) / (yMax - yMin || 1)) * plotHeight;

  const holePoints = useMemo(
    () =>
      (spec.holes ?? [])
        .filter((h) => h >= xMin && h <= xMax)
        .map((h) => ({ x: h, y: limitApproachValue(spec.expression, h, spec.domain) }))
        .filter((p): p is { x: number; y: number } => p.y !== null),
    [spec]
  );

  const xAxisY = toSvgY(Math.min(Math.max(0, yMin), yMax));
  const yAxisX = toSvgX(Math.min(Math.max(0, xMin), xMax));

  return (
    <div style={{ background: 'var(--bg-base, #fff)', border: '1px solid var(--border-default, #e5e5e5)', borderRadius: 8, padding: 8 }}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" style={{ display: 'block', maxWidth: WIDTH }}>
        {/* gridlines */}
        {Array.from({ length: 5 }, (_, i) => xMin + ((xMax - xMin) * i) / 4).map((gx, i) => (
          <line key={`gx${i}`} x1={toSvgX(gx)} y1={PADDING.top} x2={toSvgX(gx)} y2={HEIGHT - PADDING.bottom} stroke="var(--border-default, #eee)" strokeWidth={1} />
        ))}
        {Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) * i) / 4).map((gy, i) => (
          <line key={`gy${i}`} x1={PADDING.left} y1={toSvgY(gy)} x2={WIDTH - PADDING.right} y2={toSvgY(gy)} stroke="var(--border-default, #eee)" strokeWidth={1} />
        ))}

        {/* axes */}
        <line x1={PADDING.left} y1={xAxisY} x2={WIDTH - PADDING.right} y2={xAxisY} stroke="var(--text-muted, #888)" strokeWidth={1.5} />
        <line x1={yAxisX} y1={PADDING.top} x2={yAxisX} y2={HEIGHT - PADDING.bottom} stroke="var(--text-muted, #888)" strokeWidth={1.5} />

        {/* axis labels */}
        <text x={WIDTH - PADDING.right} y={xAxisY - 4} fontSize={10} textAnchor="end" fill="var(--text-muted, #888)">x</text>
        <text x={yAxisX + 6} y={PADDING.top + 8} fontSize={10} fill="var(--text-muted, #888)">y</text>
        <text x={PADDING.left} y={HEIGHT - PADDING.bottom + 14} fontSize={9} textAnchor="start" fill="var(--text-muted, #888)">{xMin}</text>
        <text x={WIDTH - PADDING.right} y={HEIGHT - PADDING.bottom + 14} fontSize={9} textAnchor="end" fill="var(--text-muted, #888)">{xMax}</text>

        {/* curve, broken across discontinuities */}
        {points.map((run, i) => (
          <polyline
            key={i}
            points={run.map((p) => `${toSvgX(p.x)},${toSvgY(p.y)}`).join(' ')}
            fill="none"
            stroke="var(--brand, #2f6b5e)"
            strokeWidth={2}
          />
        ))}

        {/* holes: open circles at the limiting value, never connected through */}
        {holePoints.map((p, i) => (
          <circle key={i} cx={toSvgX(p.x)} cy={toSvgY(p.y)} r={4} fill="var(--bg-base, #fff)" stroke="var(--brand, #2f6b5e)" strokeWidth={2} />
        ))}
      </svg>
      {spec.label && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 4 }}>{spec.label}</div>
      )}
    </div>
  );
}

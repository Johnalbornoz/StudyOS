import type { VisualSpec } from '@/lib/tutor/visuals';

/**
 * UX-5 -- draws a validated Tutor visual (lib/tutor/visuals.ts) as SVG.
 * Exact geometry from the spec's numbers; the text description is the
 * accessible channel (role="img" + aria-label), the caption is visible.
 */
export default function PedagogicalVisual({ spec, caption }: { spec: VisualSpec; caption: string }) {
  if (spec.type === 'fraction-bars') {
    const W = 320;
    const rowH = 28;
    const gap = 14;
    const labelW = 44;
    const H = spec.fractions.length * (rowH + gap) - gap;
    const desc = spec.fractions.map(([n, d]) => `${n}/${d}`).join(', ');
    return (
      <figure className="tt-visual">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${spec.label ?? caption}: ${desc}`} className="tt-visual-svg">
          {spec.fractions.map(([n, d], row) => {
            const y = row * (rowH + gap);
            const cellW = (W - labelW) / d;
            return (
              <g key={row}>
                <text x={0} y={y + rowH / 2} dominantBaseline="central" className="tt-visual-label">{`${n}/${d}`}</text>
                {Array.from({ length: d }, (_, i) => (
                  <rect key={i} x={labelW + i * cellW} y={y} width={cellW} height={rowH} className={i < n ? 'tt-visual-fill' : 'tt-visual-empty'} />
                ))}
              </g>
            );
          })}
        </svg>
        <figcaption className="tt-visual-caption">{spec.label ?? caption}</figcaption>
      </figure>
    );
  }
  const W = 320;
  const pad = 16;
  const axisY = 30;
  const x = (v: number) => pad + ((v - spec.min) / (spec.max - spec.min)) * (W - 2 * pad);
  const ticks = Math.round((spec.max - spec.min) / spec.step);
  const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
  const desc = spec.points.map((p) => `${p.label} = ${fmt(p.value)}`).join(', ');
  return (
    <figure className="tt-visual">
      <svg viewBox={`0 0 ${W} 64`} role="img" aria-label={`${spec.label ?? caption}: ${desc}`} className="tt-visual-svg">
        <line x1={pad} x2={W - pad} y1={axisY} y2={axisY} className="tt-visual-axis" />
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const v = spec.min + i * spec.step;
          const major = ticks <= 12 || i % Math.ceil(ticks / 8) === 0;
          return (
            <g key={i}>
              <line x1={x(v)} x2={x(v)} y1={axisY - (major ? 6 : 3)} y2={axisY + (major ? 6 : 3)} className="tt-visual-axis" />
              {major && <text x={x(v)} y={axisY + 20} textAnchor="middle" className="tt-visual-tick">{fmt(v)}</text>}
            </g>
          );
        })}
        {spec.points.map((p, i) => (
          <g key={i}>
            <circle cx={x(p.value)} cy={axisY} r={5} className="tt-visual-point" />
            <text x={x(p.value)} y={axisY - 12} textAnchor="middle" className="tt-visual-label">{p.label}</text>
          </g>
        ))}
      </svg>
      <figcaption className="tt-visual-caption">{spec.label ?? caption}</figcaption>
    </figure>
  );
}

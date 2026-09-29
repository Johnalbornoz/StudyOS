import type { CSSProperties } from 'react';

/**
 * UX-2 -- a loading placeholder block. Purely decorative (`aria-hidden`);
 * the surrounding loading UI owns the accessible "loading" announcement.
 * The shimmer stops under `prefers-reduced-motion`.
 */
export function Skeleton({ width = '100%', height = 16, radius, style }: { width?: CSSProperties['width']; height?: CSSProperties['height']; radius?: CSSProperties['borderRadius']; style?: CSSProperties }) {
  return <span className="ui-skeleton" aria-hidden style={{ width, height, borderRadius: radius, ...style }} />;
}

// SVG overlay of dependency arrows, predecessor end to successor start.
import { arrowPath } from './geometry';

export default function DependencyArrows({ links, width, height, rowHeight }) {
  return (
    <svg className="pointer-events-none absolute left-0 top-0" width={width} height={height} aria-hidden="true">
      <defs>
        <marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L8 4L0 8z" fill="var(--color-text-muted)" />
        </marker>
      </defs>
      <g fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5" markerEnd="url(#tl-arrow)">
        {links.map((l) => <path key={l.id} d={arrowPath(l.from, l.to, rowHeight)} />)}
      </g>
    </svg>
  );
}

import { memo } from 'react';
import { applyTransform, holePath, shapePath } from '../geom/shapes';
import type { PartGeometry } from '../model/resolve';
import type { Layer } from '../store/ui';

interface Props {
  g: PartGeometry;
  selected: boolean;
  hovered: boolean;
  locked: boolean;
  layers: Record<Layer, boolean>;
  ghost?: boolean;
}

/** One placed part in the front view, in world coordinates. */
export const PartView = memo(function PartView({ g, selected, hovered, locked, layers, ghost }: Props) {
  const cls = ['part', selected && 'is-selected', hovered && 'is-hovered', locked && 'is-locked', ghost && 'is-ghost', g.part.review !== 'verified' && 'is-unverified']
    .filter(Boolean)
    .join(' ');
  // Parts behind the panel cut nothing; show their body as a hidden (dashed) outline.
  const behind = !g.cutouts.length && !g.bezel && !g.holes.length && g.body;
  return (
    <g className={cls} data-part={g.id}>
      {behind && <path className="behind" d={shapePath(g.body!)} />}
      {layers.bezels && g.bezel && <path className="bezel" d={shapePath(g.bezel)} />}
      {layers.cutouts && g.cutouts.map((s, i) => <path key={i} className="cutout" d={shapePath(s)} />)}
      {layers.holes && g.holes.map((h, i) => <path key={i} className="hole" d={holePath(h)} />)}
    </g>
  );
});

interface RearProps {
  g: PartGeometry;
  selected: boolean;
  hovered: boolean;
  /** 0 at the panel, 1 at the deepest point shown, for shading. */
  shade: number | null;
  clipped: boolean;
  clash: boolean;
}

/** One placed part in the rear view: its body, shaded by how far back it reaches. */
export const RearPartView = memo(function RearPartView({ g, selected, hovered, shade, clipped, clash }: RearProps) {
  if (!g.body) return null;
  const cls = ['rear-part', selected && 'is-selected', hovered && 'is-hovered', clipped && 'is-clipped', shade === null && 'is-unknown', clash && 'is-clash', g.mounted && 'is-mounted']
    .filter(Boolean)
    .join(' ');
  const fill = shade === null ? undefined : `color-mix(in srgb, var(--depth-far) ${Math.round(shade * 100)}%, var(--depth-near))`;
  return (
    <g className={cls} data-rear-part={g.id}>
      <path className="body" d={shapePath(g.body)} style={fill ? { fill } : undefined} />
      {!clipped &&
        g.part.connectors.map((c) => {
          const p = applyTransform(g.transform, { x: c.x, y: c.y });
          return <rect key={c.id} className={`connector face-${c.face}`} x={p.x - 3} y={p.y - 2} width={6} height={4} />;
        })}
    </g>
  );
});

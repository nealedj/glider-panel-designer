/** A small inline icon set in the line style of the drawing (1.5px strokes, 20px grid). */
const paths: Record<string, string> = {
  select: 'M5 3l10 6-4.5 1.2L13 15l-2 1-2.5-4.8L5 14z',
  place: 'M10 4v12M4 10h12M7 3h6M3 7v6M17 7v6M7 17h6',
  move: 'M10 2v16M2 10h16M10 2l-2.5 2.5M10 2l2.5 2.5M10 18l-2.5-2.5M10 18l2.5-2.5M2 10l2.5-2.5M2 10l2.5 2.5M18 10l-2.5-2.5M18 10l-2.5 2.5',
  measure: 'M2 13l11-11 5 5-11 11zM5 10l2 2M8 7l2 2M11 4l2 2',
  keepout: 'M3 3h14v14H3zM3 9l6-6M3 15L15 3M9 17l8-8',
  undo: 'M7 5L3 9l4 4M3 9h9a5 5 0 010 10h-2',
  redo: 'M13 5l4 4-4 4M17 9H8a5 5 0 000 10h2',
  star: 'M10 2.5l2.3 4.8 5.2.7-3.8 3.6.9 5.2L10 14.4l-4.6 2.4.9-5.2L2.5 8l5.2-.7z',
  eye: 'M1.5 10S5 4 10 4s8.5 6 8.5 6-3.5 6-8.5 6S1.5 10 1.5 10zM10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  lock: 'M5 9h10v8H5zM7 9V6a3 3 0 016 0v3',
  unlock: 'M5 9h10v8H5zM7 9V6a3 3 0 015.8-1',
  warn: 'M10 3L2 17h16zM10 8v4M10 14.5v.5',
  error: 'M10 2a8 8 0 100 16 8 8 0 000-16zM7 7l6 6M13 7l-6 6',
  info: 'M10 2a8 8 0 100 16 8 8 0 000-16zM10 9v5M10 6v.5',
  search: 'M8.5 3a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM12.5 12.5L17 17',
  round: 'M10 3a7 7 0 100 14 7 7 0 000-14z',
  rect: 'M3 5h14v10H3z',
  switch: 'M10 3v8M7 11h6v6H7z',
  fuse: 'M3 10h3M14 10h3M6 7h8v6H6z',
  mount: 'M4 12h12v5H4zM10 12V5M7 3h6v2H7z',
  placard: 'M3 7h14v6H3zM6 10h8',
  check: 'M4 10l4 4 8-8',
  edit: 'M3 17l1-4 9-9 3 3-9 9-4 1zM11 6l3 3',
  text: 'M4 5V3h12v2M10 3v14M7.5 17h5',
  dimension: 'M2 6v8M18 6v8M2 10h16M2 10l3-2M2 10l3 2M18 10l-3-2M18 10l-3 2',
  export: 'M10 3v10M6 9l4 4 4-4M3 14v3h14v-3',
  wire: 'M3 15c3 0 3-10 7-10s4 10 7 10M3 15h0M17 15h0',
  route: 'M3 16l4-8 6 3 4-8',
  share: 'M8 12l4-4M7 9.5L5.5 11a2.8 2.8 0 004 4L11 13.5M13 10.5l1.5-1.5a2.8 2.8 0 00-4-4L9 6.5',
};

export function Icon({ name, size = 18, title }: { name: keyof typeof paths | string; size?: number; title?: string }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 20 20" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={paths[name] ?? paths.rect} />
    </svg>
  );
}

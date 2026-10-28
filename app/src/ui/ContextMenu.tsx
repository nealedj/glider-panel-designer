/**
 * The canvas right-click menu. Its entries come from `editor/contextMenu.ts`, so each one is a
 * registry command with the same label and shortcut as in the menu bar.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { COMMAND_BY_ID } from '../editor/commands';
import { contextMenuEntries, type ContextEntry } from '../editor/contextMenu';
import { docs, useDoc } from '../store/app';
import { ui, useUi } from '../store/ui';

export function ContextMenu() {
  const at = useUi((s) => s.contextMenu);
  return at ? <MenuBody key={`${at.x},${at.y}`} at={at} /> : null;
}

const close = () => ui.set({ contextMenu: null });

function MenuBody({ at }: { at: { x: number; y: number; onItem: boolean } }) {
  useDoc();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: at.x, y: at.y, flipSub: false });
  const [sub, setSub] = useState<string | null>(null);
  const entries = contextMenuEntries(docs.doc, ui.state, at.onItem);

  // Keep the menu on screen: open it up or to the left when it would run off the edge.
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const x = at.x + r.width > innerWidth ? Math.max(0, at.x - r.width) : at.x;
    setPos({ x, y: at.y + r.height > innerHeight ? Math.max(0, innerHeight - r.height - 4) : at.y, flipSub: x + 2 * r.width > innerWidth });
  }, [at.x, at.y]);

  useLayoutEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', key, true);
    };
  }, []);

  if (!entries.length) return null;
  return (
    <div ref={ref} className={`menu-items context-menu${pos.flipSub ? ' flip-sub' : ''}`} role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()} data-testid="context-menu">
      <Items entries={entries} sub={sub} setSub={setSub} />
    </div>
  );
}

function Items({ entries, sub, setSub }: { entries: ContextEntry[]; sub?: string | null; setSub?: (s: string | null) => void }) {
  return (
    <>
      {entries.map((e, i) => {
        if (e === '-') return <hr key={i} />;
        if (typeof e === 'string') {
          const c = COMMAND_BY_ID.get(e)!;
          return (
            <button
              key={e}
              role="menuitem"
              onMouseEnter={() => setSub?.(null)}
              onClick={() => {
                close();
                c.run();
              }}
            >
              <span>{c.label}</span>
              {c.shortcut && <kbd>{c.shortcut}</kbd>}
            </button>
          );
        }
        const open = sub === e.label;
        return (
          <div key={e.label} className="context-sub" onMouseEnter={() => setSub?.(e.label)}>
            <button role="menuitem" aria-haspopup="menu" aria-expanded={open} className={open ? 'is-open' : undefined} onClick={() => setSub?.(open ? null : e.label)}>
              <span>{e.label}</span>
              <span aria-hidden>›</span>
            </button>
            {open && (
              <div className="menu-items context-menu context-submenu" role="menu">
                <Items entries={e.items} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

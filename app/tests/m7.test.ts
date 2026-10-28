/**
 * M7: the reference PIK-20D project (clean checks, bend line in the cut file, fixture up to date), the
 * rear layout export, open pins before wiring starts, and key binding conflicts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPik20d } from '../scripts/make-pik20d';
import { runChecks } from '../src/checks/checks';
import { buildDrawing, NOT_APPROVAL } from '../src/export/drawing';
import { depthRows, rearPdf, rearScene } from '../src/export/rear';
import { projectGeometry } from '../src/model/resolve';
import { Project } from '../src/model/schema';
import { keyOf } from '../src/wiring/terminals';
import { parsePdf } from './export-parse';

const root = join(__dirname, '..', '..');
const pik20d = Project.parse(JSON.parse(readFileSync(join(root, 'fixtures', 'projects', 'pik20d.json'), 'utf8')));
const checks = (d: Project) => runChecks(d, projectGeometry(d));

/** Wire ids are random, so compare projects by what the wires join. */
function shape(d: Project) {
  return {
    ...d,
    wires: d.wires.map((w) => ({ ...w, id: '', net: d.nets.find((n) => n.id === w.net)!.name, route: d.routes.find((r) => r.id === w.route)?.label ?? null })),
    nets: d.nets.map((n) => ({ ...n, id: '', members: n.members.map(keyOf).sort() })).sort((a, b) => a.name.localeCompare(b.name)),
    routes: d.routes.map((r) => ({ ...r, id: '' })),
  };
}

describe('PIK-20D example project', () => {
  it('is up to date with its builder (npm run gen:pik20d)', () => {
    expect(shape(buildPik20d())).toEqual(shape(pik20d));
  });

  it('has no errors, and only the expected warnings: unverified placeholders and a draft template', () => {
    const r = checks(pik20d);
    expect(r.filter((x) => x.severity === 'error')).toEqual([]);
    for (const w of r.filter((x) => x.severity === 'warning')) expect(w.message).toMatch(/unverified catalogue values|is a draft/);
  });

  it('puts the flange fold in the cut file on its own layer', () => {
    const d = buildDrawing(pik20d, { date: new Date('2026-10-14') });
    const bends = d.entities.filter((e) => e.layer === 'bends' && e.kind === 'line');
    expect(bends).toHaveLength(1);
    // Seven instruments and displays, the switch and four fuses; the phone mount cuts only screw holes.
    expect(d.entities.filter((e) => e.layer === 'cutouts')).toHaveLength(12);
  });
});

describe('rear layout', () => {
  it('lists every part behind the panel, deepest first, with what it is mounted on', () => {
    const rows = depthRows(pik20d);
    expect(rows.map((r) => r.label)).not.toContain('Battery');
    expect(rows[0]!.z1).toBe(120);
    const flarm = rows.find((r) => r.label === 'FLARM unit')!;
    expect(flarm).toMatchObject({ z0: 45, z1: 75, mountedTo: 'XCTouchNav 5.7"' });
    for (let i = 1; i < rows.length; i++) expect((rows[i - 1]!.z1 ?? Infinity) >= (rows[i]!.z1 ?? Infinity)).toBe(true);
  });

  it('mirrors the view: what is on the pilot’s left is on the fitter’s right', () => {
    const bodies = rearScene(pik20d).groups.find((g) => g.id === 'bodies')!.prims;
    const asi = pik20d.parts.find((p) => p.id === 'asi')!;
    expect(bodies.some((p) => p.kind === 'shape' && p.shape.kind === 'circle' && Math.abs(p.shape.cx + asi.x) < 1e-9 && Math.abs(p.shape.cy - asi.y) < 1e-9)).toBe(true);
  });

  it('is one A3 page with the depth table, the title and the not-an-approval note', () => {
    const pdf = parsePdf(rearPdf(pik20d, new Date('2026-10-14')));
    expect(pdf.xrefOk).toBe(true);
    expect(pdf.pages).toHaveLength(1);
    expect(pdf.pages[0]!.mediaBox[2]! / (72 / 25.4)).toBeCloseTo(420, 1);
    const text = pdf.pages[0]!.texts.join('\n');
    expect(text).toContain('Rear layout: PIK-20D T-panel');
    expect(text).toContain('Depth behind the panel');
    expect(text).toContain('Free depth: unknown (not in the template)');
    expect(text).toContain(NOT_APPROVAL);
  });
});

describe('open pins before any wiring', () => {
  const unwired = Project.parse({ ...pik20d, wires: [], nets: [], routes: [] });

  it('are one note each for wiring and tubing, not an error per pin', () => {
    const r = checks(unwired);
    expect(r.filter((x) => x.severity === 'error')).toEqual([]);
    expect(r.find((x) => x.key === 'wiring:todo')?.message).toBe('Wiring not started: 5 parts with power pins to connect (Wire tool, W)');
    expect(r.find((x) => x.key === 'tubing:todo')?.message).toBe('Tubing not started: 3 parts with pressure ports to connect (Wire tool, W)');
  });

  it('become errors once wiring has started', () => {
    const one = Project.parse({ ...pik20d, wires: pik20d.wires.filter((w) => w.from.part === 'bat' && w.to.part === 'f0') });
    const keys = checks(one).map((x) => x.key);
    expect(keys).toContain('unpowered:xcv/PWR/+');
    expect(keys).not.toContain('wiring:todo');
    // Tubing has not started, so the ports are still one note.
    expect(keys).toContain('tubing:todo');
  });
});

describe('key bindings', () => {
  it('refuse a key another command answers to in the same view, and allow it in another view', async () => {
    const { shortcutConflicts, bindShortcut, COMMAND_BY_ID, DEFAULT_SHORTCUT } = await import('../src/editor/commands');
    expect(shortcutConflicts('view.fit', 'S').map((c) => c.id)).toContain('tool.select');
    // G finds the mat grid, but only in the template editor; zoom to fit is never active there.
    expect(shortcutConflicts('view.fit', 'G')).toEqual([]);
    // The template editor's own F (zoom to fit) does not clash with the panel editor's.
    expect(shortcutConflicts('view.fit', 'F')).toEqual([]);
    bindShortcut('view.fit', 'J');
    expect(COMMAND_BY_ID.get('view.fit')!.shortcut).toBe('J');
    bindShortcut('view.fit', null);
    expect(COMMAND_BY_ID.get('view.fit')!.shortcut).toBe(DEFAULT_SHORTCUT.get('view.fit'));
  });
});

import { describe, expect, it } from 'vitest';
import { buildPik20d } from '../scripts/make-pik20d';
import { runChecks } from '../src/checks/checks';
import { projectGeometry } from '../src/model/resolve';
import type { PlacedPart, Project } from '../src/model/schema';

const place = (id: string, part: string, x: number, y: number): PlacedPart =>
  ({ id, part: { id: part, version: 1 }, x, y, rotation: 0, label: id, mountedTo: null, depthOffset: 0, locked: false, offPanelRunMm: null }) as PlacedPart;

describe('generic.toggle-switch-mini', () => {
  // The reference panel's bottom row, spaced as in its photo: one master toggle, three
  // miniature toggles about 12 mm apart, then four breakers about 18 mm apart.
  it('fits a master, three miniature toggles and four breakers across the PIK-20D stem', () => {
    const y = 20;
    const parts = [
      place('ms', 'generic.toggle-switch', -55, y),
      ...[-38.5, -26.5, -14.5].map((x, i) => place(`s${i}`, 'generic.toggle-switch-mini', x, y)),
      ...[2, 20, 38, 56].map((x, i) => place(`cb${i}`, 'generic.breaker', x, y)),
    ];
    const doc: Project = { ...buildPik20d(), parts, wires: [] };
    const geo = runChecks(doc, projectGeometry(doc)).filter((r) => (r.area === 'front' || r.area === 'rear') && r.severity !== 'info');
    expect(geo.map((r) => r.message)).toEqual([]);
  });
});

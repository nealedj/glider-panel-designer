/**
 * Builds fixtures/projects/pik20d.json: the reference PIK-20D re-panel (M7), on the cardboard
 * mock-up template, through the same ops the editor uses. Run with `npm run gen:pik20d`.
 *
 * Instruments sit where the mock-up laid them out. Every part is a generic placeholder until
 * the real models are reviewed into the catalogue; where a placeholder is sized from the
 * mock-up, that is its only source, and the part stays unverified. Off-panel runs are left
 * unset because nobody has measured them.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project, type PlacedPart, type Terminal } from '../src/model/schema';
import { GRP_SUGGESTED } from '../src/checks/thresholds';
import { applyOps } from '../src/store/doc';
import { addRouteOps, withConnections } from '../src/wiring/ops';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const part = (id: string, gen: string, x: number, y: number, label: string, extra: Partial<PlacedPart> = {}): PlacedPart => ({
  id,
  part: { id: gen, version: 1 },
  x,
  y,
  rotation: 0,
  label,
  mountedTo: null,
  depthOffset: 0,
  locked: false,
  offPanelRunMm: null,
  ...extra,
});

/** Where the loom leaves the panel: down the stem, 130 mm back (behind every body). */
const EXIT = { x: 0, y: 55 };
const LOOM_Z = 130;
const off = (id: string, gen: string, label: string, at = EXIT, extra: Partial<PlacedPart> = {}) => part(id, gen, at.x, at.y, label, { depthOffset: LOOM_Z, ...extra });

export function buildPik20d(): Project {
  let doc = Project.parse({
    schemaVersion: 1,
    id: 'pik20d',
    name: 'PIK-20D T-panel',
    gliderType: 'PIK-20D',
    created: '2026-10-14T00:00:00.000Z',
    modified: '2026-10-14T00:00:00.000Z',
    template: { ref: { id: 'pik20d.t-panel-mockup', version: 1 } },
    settings: { ...GRP_SUGGESTED },
    parts: [
      // ---- the instruments, where the mock-up laid them out
      part('asi', 'generic.asi-80', -102.13, 276.63, 'ASI'),
      // XCTouchNav 5.7", portrait. Placeholder cutout: the mock-up's space less a 5 mm bezel.
      part('xctn', 'generic.flight-computer', -4.24, 240.71, 'XCTouchNav 5.7"', { params: { cutoutW: 100, cutoutH: 156, cutoutR: 4 } }),
      part('xcv', 'generic.vario-electric-80', 100.69, 282.69, 'XCVario'),
      // Placeholder cutout: the mock-up's space less a 4 mm bezel.
      part('fdisp', 'generic.flarm-display', -160.0, 211.63, 'FLARM display', { params: { cutoutW: 47, cutoutH: 14 } }),
      part('compass', 'generic.round-57', -92.08, 193.85, 'Compass'),
      part('radio', 'generic.radio-57', 92.99, 195.76, 'Radio'),
      part('phone', 'generic.phone-mount-base', 161.94, 209.39, 'Phone mount', { params: { plateW: 56, plateH: 49 } }),
      part('alt', 'generic.altimeter-80', 0.74, 100.51, 'Altimeter'),
      // ---- switch and fuses on the stem, either side of the altimeter, clear of the fold
      part('ms', 'generic.toggle-switch', -53, 110, 'Master'),
      part('f1', 'generic.fuse-holder', -53, 88, 'F1 XCVario', { params: { ratingA: 2 } }),
      part('f2', 'generic.fuse-holder', -53, 66, 'F2 FLARM', { params: { ratingA: 2 } }),
      part('f3', 'generic.fuse-holder', 54, 110, 'F3 XCTouchNav', { params: { ratingA: 3 } }),
      part('f4', 'generic.fuse-holder', 54, 88, 'F4 Radio', { params: { ratingA: 5 } }),
      // ---- behind the panel: the FLARM unit on the back of the XCTouchNav
      part('flarm', 'generic.flarm-unit', -4.24, 240.71, 'FLARM unit', { mountedTo: { parent: 'xctn', dx: 0, dy: 0, dz: 45 } }),
      part('tee1', 'generic.tee', -30, 150, 'Pitot tee'),
      part('tee2', 'generic.tee', 0, 150, 'Static tee 1'),
      part('tee3', 'generic.tee', 30, 150, 'Static tee 2'),
      // ---- off the panel, leaving down the stem (the speaker leaves on the right)
      off('bat', 'generic.battery', 'Battery'),
      off('f0', 'generic.inline-fuse', 'F0 Main', EXIT, { params: { ratingA: 5 } }),
      off('ptt', 'generic.ptt', 'Stick PTT'),
      off('vhf', 'generic.antenna', 'VHF antenna'),
      off('fant', 'generic.antenna', 'FLARM antenna'),
      off('pitot', 'generic.pitot', 'Pitot'),
      off('static', 'generic.static', 'Static'),
      off('te', 'generic.te-probe', 'TE probe'),
      off('spk', 'generic.speaker', 'Speaker', { x: 150, y: 250 }),
    ],
  });

  const pin = (p: string, c: string, n: string): Terminal => ({ part: p, connector: c, pin: n });
  const port = (p: string, n: string): Terminal => ({ part: p, port: n });
  const serial = (a: string, ac: string, b: string, bc: string): [Terminal, Terminal][] => [
    [pin(a, ac, 'TX'), pin(b, bc, 'RX')],
    [pin(b, bc, 'TX'), pin(a, ac, 'RX')],
    [pin(a, ac, 'GND'), pin(b, bc, 'GND')],
  ];

  doc = withConnections(doc, [
    // Power: battery → main fuse → master switch → fuse bus → each load.
    [pin('bat', 'T', '+'), pin('f0', 'T', 'LINE')],
    [pin('f0', 'T', 'LOAD'), pin('ms', 'T', '1')],
    [pin('ms', 'T', '2'), pin('f1', 'T', 'LINE')],
    [pin('f1', 'T', 'LINE'), pin('f2', 'T', 'LINE')],
    [pin('f2', 'T', 'LINE'), pin('f3', 'T', 'LINE')],
    [pin('f3', 'T', 'LINE'), pin('f4', 'T', 'LINE')],
    [pin('f1', 'T', 'LOAD'), pin('xcv', 'PWR', '+')],
    [pin('f2', 'T', 'LOAD'), pin('flarm', 'PWR', '+')],
    [pin('f2', 'T', 'LOAD'), pin('fdisp', 'PWR', '+')],
    [pin('f3', 'T', 'LOAD'), pin('xctn', 'PWR', '+')],
    [pin('f4', 'T', 'LOAD'), pin('radio', 'PWR', '+')],
    // Grounds back to the battery.
    [pin('xcv', 'PWR', 'GND'), pin('bat', 'T', '-')],
    [pin('flarm', 'PWR', 'GND'), pin('bat', 'T', '-')],
    [pin('fdisp', 'PWR', 'GND'), pin('bat', 'T', '-')],
    [pin('xctn', 'PWR', 'GND'), pin('bat', 'T', '-')],
    [pin('radio', 'PWR', 'GND'), pin('bat', 'T', '-')],
    // Data: FLARM port 1 to its display, port 2 to the XCVario, which feeds the XCTouchNav.
    ...serial('flarm', 'P1', 'fdisp', 'DATA'),
    ...serial('flarm', 'P2', 'xcv', 'S1'),
    ...serial('xcv', 'S2', 'xctn', 'DATA'),
    // Audio, PTT and antennas.
    [pin('radio', 'AUD', 'SPK+'), pin('spk', 'T', '+')],
    [pin('radio', 'AUD', 'SPK-'), pin('spk', 'T', '-')],
    [pin('radio', 'AUD', 'PTT'), pin('ptt', 'T', '1')],
    [pin('ptt', 'T', '2'), pin('bat', 'T', '-')],
    [pin('radio', 'ANT', 'RF'), pin('vhf', 'ANT', 'RF')],
    [pin('flarm', 'ANT', 'RF'), pin('fant', 'ANT', 'RF')],
    // Pneumatics: pitot to the ASI and XCVario; static to the ASI, altimeter and XCVario; TE to the XCVario.
    [port('pitot', 'P'), port('tee1', 'A')],
    [port('tee1', 'B'), port('asi', 'P')],
    [port('tee1', 'C'), port('xcv', 'P')],
    [port('static', 'S'), port('tee2', 'A')],
    [port('tee2', 'B'), port('asi', 'S')],
    [port('tee2', 'C'), port('tee3', 'A')],
    [port('tee3', 'B'), port('alt', 'S')],
    [port('tee3', 'C'), port('xcv', 'S')],
    [port('te', 'TE'), port('xcv', 'TE')],
  ]);

  // Two looms 130 mm back: up the stem from the exit, then across the top section.
  const stem = addRouteOps([{ ...EXIT, z: LOOM_Z }, { x: 0, y: 165, z: LOOM_Z }], 'Stem loom');
  doc = applyOps(doc, stem.ops)[0];
  const top = addRouteOps([{ x: -150, y: 205, z: LOOM_Z }, { x: 0, y: 165, z: LOOM_Z }, { x: 110, y: 245, z: LOOM_Z }], 'Top loom');
  doc = applyOps(doc, top.ops)[0];

  // Wires between the stem and the off-panel parts go on the stem loom; the rest of the
  // electrical wiring on the top loom. Tubes are cut to fit and left as estimates.
  const STEM = new Set(['bat', 'f0', 'ms', 'f1', 'f2', 'f3', 'f4', 'ptt', 'vhf', 'fant', 'alt']);
  const tube = (w: Project['wires'][number]) => !!w.tubeBoreMm;
  doc = {
    ...doc,
    wires: doc.wires.map((w) => {
      if (tube(w)) return w;
      return { ...w, route: STEM.has(w.from.part) && STEM.has(w.to.part) ? stem.route.id : top.route.id };
    }),
  };
  return Project.parse(doc);
}

export function writePik20d() {
  const out = join(root, 'fixtures', 'projects', 'pik20d.json');
  writeFileSync(out, JSON.stringify(buildPik20d(), null, 2) + '\n');
  return out;
}

/**
 * Generic, parametric parts, so the tool works before any real instrument is catalogued.
 *
 * Every default here is a placeholder, not a datasheet value. Each generated part is marked
 * `unverified` and every geometry field carries a source note saying so. The user overrides
 * the params per placed part once they have measured or looked up their real instrument.
 */
import type { CataloguePart, Connector, FieldSource, PartParam, Pin, Port, Shape } from '../model/schema';

export const GENERIC_MAKER = 'Generic';

const PLACEHOLDER: FieldSource = {
  url: null,
  snippet: null,
  status: 'unverified',
  note: 'Generic placeholder default. Check against the real part or its datasheet before cutting.',
};

type Params = Record<string, PartParam>;
type Values = Record<string, number>;

export interface GenericDef {
  id: string;
  model: string;
  category: CataloguePart['category'];
  description: string;
  params: Params;
  build: (v: Values) => Pick<CataloguePart, 'front' | 'rear'> & Partial<CataloguePart>;
  /** Field-specific provenance notes that replace the generic placeholder note. */
  notes?: Record<string, string>;
}

function p(label: string, value: number, unit: PartParam['unit'] = 'mm', min = 0.1, max?: number): PartParam {
  return max === undefined ? { label, value, unit, min } : { label, value, unit, min, max };
}

function v(values: Values, key: string): number {
  const n = values[key];
  if (n === undefined) throw new Error(`missing param ${key}`);
  return n;
}

const square = (s: number, r: number): Shape => ({ kind: 'rect', cx: 0, cy: 0, w: s, h: s, r });
const circle = (d: number): Shape => ({ kind: 'circle', cx: 0, cy: 0, d });

function squarePattern(spacing: number, d: number) {
  const h = spacing / 2;
  return [
    { x: -h, y: h, d },
    { x: h, y: h, d },
    { x: -h, y: -h, d },
    { x: h, y: -h, d },
  ];
}

// The screw spacings were read off a photo of a pair of 57 and 80 mm panel-marking templates.
// The photo has no scale and some perspective, so the spacing was taken relative to each
// template's cutout ring and is good to a few millimetres only.
const TEMPLATE_PHOTO_NOTE =
  'Estimated from a photo of 57 and 80 mm panel-marking templates (no scale reference, about ±3 mm). Measure your instrument or template before drilling.';

// ---------------------------------------------------------------- pins and ports

const pin = (number: string, fn: string, signal: Pin['signal'], direction?: Pin['direction']): Pin => ({ number, function: fn, signal, ...(direction ? { direction } : {}) });
const conn = (id: string, type: string, x: number, y: number, pins: Pin[]): Connector => ({ id, type, x, y, face: 'rear', clearance: null, pins });
const port = (id: string, kind: Port['kind'], x: number, y: number): Port => ({ id, kind, fitting: null, x, y });
const powerConn = (x = -12, y = -18) => conn('PWR', 'power', x, y, [pin('+', 'supply +', 'power', 'in'), pin('GND', 'ground', 'ground')]);
const dataConn = (id: string, x: number, y: number) => conn(id, 'data', x, y, [pin('TX', 'serial TX', 'serial', 'out'), pin('RX', 'serial RX', 'serial', 'in'), pin('GND', 'signal ground', 'ground')]);

/** Placeholder current draw for generic electronics: flagged unverified like every generic value. */
const currentParam = (a: number) => p('Current draw (placeholder)', a, 'A', 0);

function roundInstrument(size: 57 | 80, screwSpacing: number, screwD: number, bezel: number, depth: number, extra?: { id: string; model: string; category?: CataloguePart['category']; description: string; current?: number; wiring?: Pick<CataloguePart, 'connectors' | 'ports'> }): GenericDef {
  return {
    notes: { 'front.screwHoles': TEMPLATE_PHOTO_NOTE },
    id: extra?.id ?? `generic.round-${size}`,
    model: extra?.model ?? `${size} mm round instrument`,
    category: extra?.category ?? 'instrument',
    description: extra?.description ?? `Standard ${size} mm round instrument with a square bezel and four corner screws.`,
    params: {
      ...(extra?.current !== undefined ? { currentA: currentParam(extra.current) } : {}),
      cutoutD: p('Cutout diameter', size),
      bezel: p('Bezel size', bezel),
      bezelR: p('Bezel corner radius', 5, 'mm', 0),
      screwSpacing: p('Screw spacing (square)', screwSpacing),
      screwD: p('Screw hole diameter', screwD),
      bodyD: p('Body diameter', size),
      depth: p('Body depth', depth),
      protrusion: p('Protrusion', 10, 'mm', 0),
    },
    build: (x) => ({
      front: {
        cutouts: [circle(v(x, 'cutoutD'))],
        bezel: square(v(x, 'bezel'), v(x, 'bezelR')),
        screwHoles: squarePattern(v(x, 'screwSpacing'), v(x, 'screwD')),
        protrusion: v(x, 'protrusion'),
      },
      rear: { body: circle(v(x, 'bodyD')), depth: v(x, 'depth'), bracketPoints: [] },
      ...(extra?.wiring ?? {}),
      ...(extra?.current !== undefined ? { power: { currentA: v(x, 'currentA'), voltage: null } } : {}),
    }),
  };
}

const offPanel = (id: string, model: string, category: CataloguePart['category'], description: string, wiring: Pick<CataloguePart, 'connectors' | 'ports'>, extra: Partial<CataloguePart> = {}, params: Params = {}): GenericDef => ({
  id,
  model,
  category,
  description,
  params,
  build: (x) => ({
    front: { cutouts: [], bezel: null, screwHoles: [], protrusion: 0 },
    rear: { body: null, depth: null, bracketPoints: [] },
    offPanel: true,
    ...wiring,
    ...extra,
    ...(params.capacityAh ? { capacityAh: v(x, 'capacityAh'), power: { currentA: null, voltage: v(x, 'voltage') } } : {}),
    ...(params.ratingA ? { ratingA: v(x, 'ratingA') } : {}),
  }),
});

export const GENERIC_DEFS: GenericDef[] = [
  roundInstrument(57, 47, 3.5, 61, 100),
  roundInstrument(80, 66, 4.2, 81, 120),
  {
    id: 'generic.rect-display',
    model: 'Rectangular display',
    category: 'display',
    description: 'Rectangular display or flight computer with a rectangular cutout.',
    params: {
      cutoutW: p('Cutout width', 100),
      cutoutH: p('Cutout height', 70),
      cutoutR: p('Cutout corner radius', 2, 'mm', 0),
      bezelMargin: p('Bezel margin', 5, 'mm', 0),
      bodyW: p('Body width', 100),
      bodyH: p('Body height', 70),
      depth: p('Body depth', 40),
      protrusion: p('Protrusion', 8, 'mm', 0),
    },
    build: (x) => ({
      front: {
        cutouts: [{ kind: 'rect', cx: 0, cy: 0, w: v(x, 'cutoutW'), h: v(x, 'cutoutH'), r: v(x, 'cutoutR') }],
        bezel: {
          kind: 'rect',
          cx: 0,
          cy: 0,
          w: v(x, 'cutoutW') + 2 * v(x, 'bezelMargin'),
          h: v(x, 'cutoutH') + 2 * v(x, 'bezelMargin'),
          r: v(x, 'cutoutR') + v(x, 'bezelMargin'),
        },
        screwHoles: [],
        protrusion: v(x, 'protrusion'),
      },
      rear: { body: { kind: 'rect', cx: 0, cy: 0, w: v(x, 'bodyW'), h: v(x, 'bodyH'), r: 0 }, depth: v(x, 'depth'), bracketPoints: [] },
    }),
  },
  {
    id: 'generic.toggle-switch',
    model: 'Toggle switch',
    category: 'switch',
    description: 'Bushing-mounted toggle switch.',
    params: {
      holeD: p('Hole diameter', 12.5),
      nutD: p('Nut / bezel diameter', 18),
      bodyW: p('Body width', 15),
      bodyH: p('Body height', 20),
      depth: p('Body depth', 30),
      protrusion: p('Lever protrusion', 25, 'mm', 0),
    },
    build: (x) => ({
      front: { cutouts: [circle(v(x, 'holeD'))], bezel: circle(v(x, 'nutD')), screwHoles: [], protrusion: v(x, 'protrusion') },
      rear: { body: { kind: 'rect', cx: 0, cy: 0, w: v(x, 'bodyW'), h: v(x, 'bodyH'), r: 0 }, depth: v(x, 'depth'), bracketPoints: [] },
      connectors: [
        {
          id: 'T',
          type: 'solder tag',
          x: 0,
          y: 0,
          face: 'rear',
          clearance: null,
          pins: [
            { number: '1', function: 'common', signal: 'switch', direction: 'passive' },
            { number: '2', function: 'on', signal: 'switch', direction: 'passive' },
          ],
        },
      ],
    }),
  },
  {
    id: 'generic.breaker',
    model: 'Push-pull circuit breaker',
    category: 'breaker',
    description: 'Bushing-mounted push-pull circuit breaker. Set the rating per placed part.',
    params: {
      holeD: p('Hole diameter', 9.6),
      nutD: p('Nut / bezel diameter', 16),
      bodyD: p('Body diameter', 18),
      depth: p('Body depth', 50),
      protrusion: p('Button protrusion', 15, 'mm', 0),
      ratingA: p('Rating', 5, 'A'),
    },
    build: (x) => ({
      front: { cutouts: [circle(v(x, 'holeD'))], bezel: circle(v(x, 'nutD')), screwHoles: [], protrusion: v(x, 'protrusion') },
      rear: { body: circle(v(x, 'bodyD')), depth: v(x, 'depth'), bracketPoints: [] },
      ratingA: v(x, 'ratingA'),
      connectors: [
        {
          id: 'T',
          type: 'screw terminal',
          x: 0,
          y: 0,
          face: 'rear',
          clearance: null,
          pins: [
            { number: 'LINE', function: 'line', signal: 'power', direction: 'in' },
            { number: 'LOAD', function: 'load', signal: 'power', direction: 'out' },
          ],
        },
      ],
    }),
  },
  {
    id: 'generic.fuse-holder',
    model: 'Panel-mount fuse holder',
    category: 'fuse',
    description: 'Bushing-mounted fuse holder. Set the fuse rating per placed part.',
    params: {
      holeD: p('Hole diameter', 12.7),
      capD: p('Cap / bezel diameter', 18),
      bodyD: p('Body diameter', 15),
      depth: p('Body depth', 45),
      protrusion: p('Cap protrusion', 15, 'mm', 0),
      ratingA: p('Fuse rating', 3, 'A'),
    },
    build: (x) => ({
      front: { cutouts: [circle(v(x, 'holeD'))], bezel: circle(v(x, 'capD')), screwHoles: [], protrusion: v(x, 'protrusion') },
      rear: { body: circle(v(x, 'bodyD')), depth: v(x, 'depth'), bracketPoints: [] },
      ratingA: v(x, 'ratingA'),
      connectors: [
        {
          id: 'T',
          type: 'solder tag',
          x: 0,
          y: 0,
          face: 'rear',
          clearance: null,
          pins: [
            { number: 'LINE', function: 'line', signal: 'power', direction: 'in' },
            { number: 'LOAD', function: 'load', signal: 'power', direction: 'out' },
          ],
        },
      ],
    }),
  },
  {
    id: 'generic.phone-mount-base',
    model: 'Phone mount base',
    category: 'mount',
    description: 'Screw-on base plate for a phone or tablet mount arm. The arm stands out in front of the panel.',
    params: {
      plateW: p('Plate width', 50),
      plateH: p('Plate height', 50),
      screwSpacing: p('Screw spacing (square)', 38),
      screwD: p('Screw hole diameter', 4.2),
      protrusion: p('Arm protrusion', 150, 'mm', 0),
      depth: p('Screw depth behind panel', 10, 'mm', 0),
    },
    build: (x) => ({
      front: {
        cutouts: [],
        bezel: { kind: 'rect', cx: 0, cy: 0, w: v(x, 'plateW'), h: v(x, 'plateH'), r: 4 },
        screwHoles: squarePattern(v(x, 'screwSpacing'), v(x, 'screwD')),
        protrusion: v(x, 'protrusion'),
      },
      rear: {
        body: { kind: 'rect', cx: 0, cy: 0, w: v(x, 'screwSpacing') + 10, h: v(x, 'screwSpacing') + 10, r: 0 },
        depth: v(x, 'depth'),
        bracketPoints: [],
      },
    }),
  },
  {
    id: 'generic.remote-unit',
    model: 'Behind-panel unit',
    category: 'other',
    description: 'A box that sits behind the panel and cuts nothing, such as a FLARM, audio or interface unit. Mount it to the panel back or to another part.',
    params: {
      w: p('Width', 80),
      h: p('Height', 50),
      depth: p('Depth', 40),
    },
    build: (x) => ({
      front: { cutouts: [], bezel: null, screwHoles: [], protrusion: 0 },
      rear: { body: { kind: 'rect', cx: 0, cy: 0, w: v(x, 'w'), h: v(x, 'h'), r: 2 }, depth: v(x, 'depth'), bracketPoints: [] },
    }),
  },
  {
    id: 'generic.placard',
    model: 'Placard',
    category: 'placard',
    description: 'Stuck-on placard, such as the registration. Nothing is cut.',
    params: {
      w: p('Width', 50),
      h: p('Height', 12),
    },
    build: (x) => ({
      front: { cutouts: [], bezel: { kind: 'rect', cx: 0, cy: 0, w: v(x, 'w'), h: v(x, 'h'), r: 1 }, screwHoles: [], protrusion: 0 },
      rear: { body: null, depth: 0, bracketPoints: [] },
    }),
  },
  // ---- instruments with pneumatic ports and pins (M6)
  roundInstrument(80, 66, 4.2, 81, 120, {
    id: 'generic.asi-80',
    model: '80 mm airspeed indicator',
    description: 'Mechanical airspeed indicator, 80 mm, with pitot and static ports.',
    wiring: { connectors: [], ports: [port('P', 'pitot', -15, -25), port('S', 'static', 15, -25)] },
  }),
  roundInstrument(80, 66, 4.2, 81, 120, {
    id: 'generic.altimeter-80',
    model: '80 mm altimeter',
    description: 'Mechanical altimeter, 80 mm, with a static port.',
    wiring: { connectors: [], ports: [port('S', 'static', 0, -25)] },
  }),
  roundInstrument(57, 47, 3.5, 61, 100, {
    id: 'generic.vario-mech-57',
    model: '57 mm mechanical vario',
    category: 'vario',
    description: 'Mechanical (capacity) variometer, 57 mm, on a TE line.',
    wiring: { connectors: [], ports: [port('TE', 'te', 0, -20)] },
  }),
  roundInstrument(57, 47, 3.5, 61, 100, {
    id: 'generic.vario-electric-57',
    model: '57 mm electric vario',
    category: 'vario',
    description: 'Electric variometer, 57 mm: power, a serial data port, and pitot, static and TE ports.',
    current: 0.15,
    wiring: { connectors: [powerConn(-12, -18), dataConn('DATA', 12, -18)], ports: [port('P', 'pitot', -15, 15), port('S', 'static', 0, 15), port('TE', 'te', 15, 15)] },
  }),
  roundInstrument(80, 66, 4.2, 81, 120, {
    id: 'generic.vario-electric-80',
    model: '80 mm electric vario',
    category: 'vario',
    description: 'Electric variometer, 80 mm: power, two serial data ports, and pitot, static and TE ports.',
    current: 0.15,
    wiring: {
      connectors: [powerConn(-20, -25), dataConn('S1', 0, -25), dataConn('S2', 20, -25)],
      ports: [port('P', 'pitot', -20, 20), port('S', 'static', 0, 20), port('TE', 'te', 20, 20)],
    },
  }),
  roundInstrument(57, 47, 3.5, 61, 100, {
    id: 'generic.radio-57',
    model: '57 mm radio',
    category: 'radio',
    description: 'VHF radio in a 57 mm housing: power, speaker, PTT and antenna.',
    current: 0.25,
    wiring: {
      connectors: [
        powerConn(-12, -18),
        conn('AUD', 'audio', 12, -18, [pin('SPK+', 'speaker +', 'audio', 'out'), pin('SPK-', 'speaker -', 'audio', 'out'), pin('PTT', 'push to talk', 'switch', 'in')]),
        conn('ANT', 'BNC', 0, 18, [pin('RF', 'antenna', 'rf', 'bidi')]),
      ],
      ports: [],
    },
  }),
  {
    id: 'generic.flight-computer',
    model: 'Flight computer display',
    category: 'flight-computer',
    description: 'Rectangular flight computer or navigation display: power and a serial data port.',
    params: {
      cutoutW: p('Cutout width', 125),
      cutoutH: p('Cutout height', 95),
      cutoutR: p('Cutout corner radius', 2, 'mm', 0),
      bezelMargin: p('Bezel margin', 5, 'mm', 0),
      depth: p('Body depth', 45),
      protrusion: p('Protrusion', 8, 'mm', 0),
      currentA: currentParam(0.5),
    },
    build: (x) => ({
      front: {
        cutouts: [{ kind: 'rect', cx: 0, cy: 0, w: v(x, 'cutoutW'), h: v(x, 'cutoutH'), r: v(x, 'cutoutR') }],
        bezel: { kind: 'rect', cx: 0, cy: 0, w: v(x, 'cutoutW') + 2 * v(x, 'bezelMargin'), h: v(x, 'cutoutH') + 2 * v(x, 'bezelMargin'), r: v(x, 'cutoutR') + v(x, 'bezelMargin') },
        screwHoles: [],
        protrusion: v(x, 'protrusion'),
      },
      rear: { body: { kind: 'rect', cx: 0, cy: 0, w: v(x, 'cutoutW'), h: v(x, 'cutoutH'), r: 0 }, depth: v(x, 'depth'), bracketPoints: [] },
      connectors: [powerConn(-30, -30), dataConn('DATA', 30, -30)],
      power: { currentA: v(x, 'currentA'), voltage: null },
    }),
  },
  {
    id: 'generic.flarm-display',
    model: 'FLARM display',
    category: 'flarm',
    description: 'Small rectangular FLARM display: power and a serial port from the FLARM unit.',
    params: {
      cutoutW: p('Cutout width', 45),
      cutoutH: p('Cutout height', 16),
      cutoutR: p('Cutout corner radius', 1, 'mm', 0),
      bezelMargin: p('Bezel margin', 4, 'mm', 0),
      depth: p('Body depth', 25),
      protrusion: p('Protrusion', 5, 'mm', 0),
      currentA: currentParam(0.05),
    },
    build: (x) => ({
      front: {
        cutouts: [{ kind: 'rect', cx: 0, cy: 0, w: v(x, 'cutoutW'), h: v(x, 'cutoutH'), r: v(x, 'cutoutR') }],
        bezel: { kind: 'rect', cx: 0, cy: 0, w: v(x, 'cutoutW') + 2 * v(x, 'bezelMargin'), h: v(x, 'cutoutH') + 2 * v(x, 'bezelMargin'), r: v(x, 'cutoutR') + v(x, 'bezelMargin') },
        screwHoles: [],
        protrusion: v(x, 'protrusion'),
      },
      rear: { body: { kind: 'rect', cx: 0, cy: 0, w: v(x, 'cutoutW'), h: v(x, 'cutoutH'), r: 0 }, depth: v(x, 'depth'), bracketPoints: [] },
      connectors: [powerConn(-12, 0), dataConn('DATA', 12, 0)],
      power: { currentA: v(x, 'currentA'), voltage: null },
    }),
  },
  {
    id: 'generic.flarm-unit',
    model: 'FLARM unit (behind panel)',
    category: 'flarm',
    description: 'Collision-warning unit mounted behind the panel: power, two serial ports and an antenna.',
    params: { w: p('Width', 85), h: p('Height', 60), depth: p('Depth', 30), currentA: currentParam(0.15) },
    build: (x) => ({
      front: { cutouts: [], bezel: null, screwHoles: [], protrusion: 0 },
      rear: { body: { kind: 'rect', cx: 0, cy: 0, w: v(x, 'w'), h: v(x, 'h'), r: 2 }, depth: v(x, 'depth'), bracketPoints: [] },
      connectors: [powerConn(-25, -15), dataConn('P1', 0, -15), dataConn('P2', 25, -15), conn('ANT', 'SMA', 0, 15, [pin('RF', 'FLARM antenna', 'rf', 'bidi')])],
      power: { currentA: v(x, 'currentA'), voltage: null },
    }),
  },
  {
    id: 'generic.tee',
    model: 'Tube tee',
    category: 'pneumatic',
    description: 'A tee joining three tubes of the same line (pitot, static or TE).',
    params: {},
    build: () => ({
      front: { cutouts: [], bezel: null, screwHoles: [], protrusion: 0 },
      rear: { body: { kind: 'circle', cx: 0, cy: 0, d: 12 }, depth: 10, bracketPoints: [] },
      ports: [port('A', 'any', -5, 0), port('B', 'any', 5, 0), port('C', 'any', 0, 5)],
    }),
  },
  // ---- off the panel: they appear in the rear view as the point where the loom leaves it
  offPanel('generic.battery', 'Battery', 'power', 'Main battery, off the panel.', { connectors: [conn('T', 'terminals', 0, 0, [pin('+', 'positive', 'power', 'out'), pin('-', 'negative', 'ground')])], ports: [] }, {}, {
    capacityAh: p('Capacity', 7.2, 'Ah', 0.1),
    voltage: p('Nominal voltage', 12, 'V', 1),
  }),
  offPanel('generic.speaker', 'Speaker', 'audio', 'Cockpit speaker, off the panel.', { connectors: [conn('T', 'tags', 0, 0, [pin('+', 'speaker +', 'audio', 'in'), pin('-', 'speaker -', 'audio', 'in')])], ports: [] }),
  offPanel('generic.antenna', 'Antenna', 'antenna', 'Antenna (VHF, FLARM or transponder), off the panel.', { connectors: [conn('ANT', 'coax', 0, 0, [pin('RF', 'antenna', 'rf', 'bidi')])], ports: [] }),
  offPanel('generic.pitot', 'Pitot source', 'pneumatic', 'Pitot pressure source (nose or fin pitot), off the panel.', { connectors: [], ports: [port('P', 'pitot', 0, 0)] }),
  offPanel('generic.static', 'Static source', 'pneumatic', 'Static pressure source (static ports), off the panel.', { connectors: [], ports: [port('S', 'static', 0, 0)] }),
  offPanel('generic.te-probe', 'TE probe', 'pneumatic', 'Total-energy probe, off the panel.', { connectors: [], ports: [port('TE', 'te', 0, 0)] }),
  offPanel('generic.inline-fuse', 'Inline fuse', 'fuse', 'Inline fuse holder in the loom, e.g. the main fuse at the battery. Set the rating per placed part.', { connectors: [conn('T', 'inline', 0, 0, [pin('LINE', 'line', 'power', 'in'), pin('LOAD', 'load', 'power', 'out')])], ports: [] }, {}, { ratingA: p('Fuse rating', 5, 'A') }),
  offPanel('generic.ptt', 'Stick PTT button', 'switch', 'Push-to-talk button on the stick, off the panel.', { connectors: [conn('T', 'tags', 0, 0, [pin('1', 'PTT', 'switch'), pin('2', 'PTT return', 'ground')])], ports: [] }),
];

export function paramValues(params: Params, overrides?: Values): Values {
  const out: Values = {};
  for (const [k, def] of Object.entries(params)) out[k] = overrides?.[k] ?? def.value;
  return out;
}

/** Build a full catalogue part from a generic definition and optional param overrides. */
export function buildGeneric(def: GenericDef, overrides?: Values): CataloguePart {
  const built = def.build(paramValues(def.params, overrides));
  const sources: Record<string, FieldSource> = {};
  const keys = ['front.cutouts', 'front.bezel', 'front.screwHoles', 'front.protrusion', 'rear.body', 'rear.depth'];
  if (built.connectors?.length) keys.push('connectors');
  if (built.ports?.length) keys.push('ports');
  if (built.power?.currentA != null) keys.push('power.currentA');
  if (built.capacityAh != null) keys.push('capacityAh');
  for (const key of keys) {
    const note = def.notes?.[key];
    sources[key] = note ? { ...PLACEHOLDER, note } : PLACEHOLDER;
  }
  return {
    id: def.id,
    version: 1,
    maker: GENERIC_MAKER,
    model: def.model,
    category: def.category,
    description: def.description,
    generator: def.id,
    params: def.params,
    connectors: [],
    ports: [],
    power: null,
    weightG: null,
    datasheet: null,
    offPanel: false,
    ...built,
    sources,
    review: 'unverified',
  };
}

export const GENERIC_BY_ID = new Map(GENERIC_DEFS.map((d) => [d.id, d]));

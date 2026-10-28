/**
 * Document schemas for projects, panel templates and catalogue parts.
 *
 * Conventions (see docs/adr/0004-coordinates-and-units.md):
 * - All lengths in millimetres, areas in mm², masses in grams, current in amps.
 * - x right, y up, origin at the panel datum, as seen from the front (pilot's view).
 * - z (depth) is measured rearward from the back face of the panel.
 * - Unknown catalogue values are null, never guessed.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------- geometry

export const Vec2 = z.object({ x: z.number(), y: z.number() });
export type Vec2 = z.infer<typeof Vec2>;

/** A polyline vertex; `bulge` is tan(θ/4) of the arc to the next vertex, as in DXF LWPOLYLINE. */
export const PolyVertex = z.object({ x: z.number(), y: z.number(), bulge: z.number().optional() });
export type PolyVertex = z.infer<typeof PolyVertex>;

export const CircleShape = z.object({ kind: z.literal('circle'), cx: z.number(), cy: z.number(), d: z.number().positive() });
export const RectShape = z.object({
  kind: z.literal('rect'),
  cx: z.number(),
  cy: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  /** Corner radius. */
  r: z.number().nonnegative().default(0),
});
export const PolyShape = z.object({
  kind: z.literal('poly'),
  points: z.array(PolyVertex).min(3),
  closed: z.literal(true).default(true),
});
export const Shape = z.discriminatedUnion('kind', [CircleShape, RectShape, PolyShape]);
export type CircleShape = z.infer<typeof CircleShape>;
export type RectShape = z.infer<typeof RectShape>;
export type PolyShape = z.infer<typeof PolyShape>;
export type Shape = z.infer<typeof Shape>;

export const Hole = z.object({ x: z.number(), y: z.number(), d: z.number().positive() });
export type Hole = z.infer<typeof Hole>;

// ---------------------------------------------------------------- provenance

export const ReviewStatus = z.enum(['unverified', 'verified']);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

/** Where a catalogue value came from. Keyed by a field path such as `front.cutout` or `power.currentA`. */
export const FieldSource = z.object({
  url: z.string().nullable(),
  /** The text the value was read from, verbatim. */
  snippet: z.string().nullable(),
  status: ReviewStatus,
  note: z.string().optional(),
});
export type FieldSource = z.infer<typeof FieldSource>;

// ---------------------------------------------------------------- catalogue parts

export const PartCategory = z.enum([
  'instrument',
  'vario',
  'flight-computer',
  'display',
  'radio',
  'transponder',
  'flarm',
  'compass',
  'switch',
  'breaker',
  'fuse',
  'connector',
  'mount',
  'placard',
  'bracket',
  'pneumatic',
  'power',
  'antenna',
  'audio',
  'other',
]);
export type PartCategory = z.infer<typeof PartCategory>;

export const SignalType = z.enum(['power', 'ground', 'serial', 'bus', 'audio', 'rf', 'switch', 'other']);
export type SignalType = z.infer<typeof SignalType>;

export const Pin = z.object({
  number: z.string(),
  function: z.string(),
  signal: SignalType,
  /** For serial lines: tx, rx or bidirectional. */
  direction: z.enum(['in', 'out', 'bidi', 'passive']).optional(),
});
export type Pin = z.infer<typeof Pin>;

export const Connector = z.object({
  id: z.string(),
  type: z.string(),
  /** Position on the rear profile, in part coordinates. */
  x: z.number(),
  y: z.number(),
  face: z.enum(['rear', 'left', 'right', 'top', 'bottom']).default('rear'),
  /** Clearance needed behind the connector for the mating plug and cable bend. */
  clearance: z.number().nonnegative().nullable().default(null),
  pins: z.array(Pin),
});
export type Connector = z.infer<typeof Connector>;

/** `any` is for tees and fittings that pass whatever line they sit in. */
export const PortKind = z.enum(['pitot', 'static', 'te', 'any']);
export const Port = z.object({
  id: z.string(),
  kind: PortKind,
  fitting: z.string().nullable(),
  x: z.number(),
  y: z.number(),
});
export type Port = z.infer<typeof Port>;

export const FrontProfile = z.object({
  /** What gets cut. Several shapes allowed (e.g. a display plus a knob hole). */
  cutouts: z.array(Shape),
  /** What the pilot sees. */
  bezel: Shape.nullable(),
  screwHoles: z.array(Hole),
  /** How far the part stands proud of the panel face, mm. */
  protrusion: z.number().nonnegative().nullable(),
});
export type FrontProfile = z.infer<typeof FrontProfile>;

export const RearProfile = z.object({
  /** Body outline as seen from behind, in part coordinates (front-view orientation; the view mirrors it). */
  body: Shape.nullable(),
  /** Depth behind the panel back face, mm. */
  depth: z.number().nonnegative().nullable(),
  bracketPoints: z.array(Vec2).default([]),
});
export type RearProfile = z.infer<typeof RearProfile>;

/** A numeric parameter of a generic, parametric part. */
export const PartParam = z.object({
  label: z.string(),
  value: z.number(),
  min: z.number().optional(),
  max: z.number().optional(),
  unit: z.enum(['mm', 'deg', 'A', 'g', 'count', 'Ah', 'V']).default('mm'),
});
export type PartParam = z.infer<typeof PartParam>;

export const CataloguePart = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
  version: z.number().int().positive(),
  maker: z.string(),
  model: z.string(),
  category: PartCategory,
  description: z.string().optional(),
  /** Generic parts are parametric: their geometry is generated from `params` by the generator named here. */
  generator: z.string().optional(),
  params: z.record(z.string(), PartParam).optional(),
  front: FrontProfile,
  rear: RearProfile,
  connectors: z.array(Connector).default([]),
  ports: z.array(Port).default([]),
  power: z
    .object({
      currentA: z.number().nonnegative().nullable(),
      voltage: z.number().nullable(),
    })
    .nullable()
    .default(null),
  /** Rating, for fuses and breakers. */
  ratingA: z.number().positive().nullable().optional(),
  /** Capacity, for batteries. */
  capacityAh: z.number().positive().nullable().optional(),
  weightG: z.number().nonnegative().nullable(),
  datasheet: z.string().nullable().default(null),
  sources: z.record(z.string(), FieldSource).default({}),
  review: ReviewStatus,
  /** Parts that sit off the panel (battery, antenna, speaker). */
  offPanel: z.boolean().default(false),
});
export type CataloguePart = z.infer<typeof CataloguePart>;

// ---------------------------------------------------------------- panel templates

export const BendLine = z.object({ a: Vec2, b: Vec2, label: z.string().optional() });
export type BendLine = z.infer<typeof BendLine>;

export const KeepOut = z.object({
  id: z.string(),
  label: z.string(),
  shape: Shape,
});
export type KeepOut = z.infer<typeof KeepOut>;

export const DepthRegion = z.object({ shape: Shape, depth: z.number().nonnegative() });

export const TemplateInputType = z.enum(['scan', 'gridded-mockup', 'tracing', 'straight-photo', 'angled-photo', 'drawn', 'measured']);

export const PanelTemplate = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
  version: z.number().int().positive(),
  name: z.string(),
  /** Closed outline of the flat (developed) panel, including any flange. */
  outline: PolyShape,
  bendLines: z.array(BendLine).default([]),
  thickness: z.number().positive(),
  material: z.string(),
  keepOuts: z.array(KeepOut).default([]),
  /** Forward clearance to the canopy, mm; null if unknown. */
  canopyClearance: z.number().nonnegative().nullable().default(null),
  availableDepth: z
    .object({ default: z.number().nonnegative().nullable(), regions: z.array(DepthRegion).default([]) })
    .default({ default: null, regions: [] }),
  fixings: z.array(Hole).default([]),
  gliderTypes: z.array(z.string()).default([]),
  provenance: z.object({
    inputType: TemplateInputType,
    source: z.string(),
    rights: z.string().optional(),
    /** Estimated error of a distance measured on the template, mm; null if not estimated. */
    accuracyMm: z.number().nonnegative().nullable(),
    /** How the template was scaled and straightened, e.g. "cutting-mat grid, 182 crossings, residual 0.12 mm". */
    method: z.string().optional(),
    /** Spans measured on the real panel or template, compared with the template. */
    checks: z
      .array(z.object({ label: z.string(), a: Vec2, b: Vec2, measuredMm: z.number().positive(), templateMm: z.number().nonnegative() }))
      .default([]),
  }),
  status: z.enum(['draft', 'verified']),
  verifiedNote: z.string().optional(),
  /** Date the template was checked against the real panel, YYYY-MM-DD. */
  verifiedDate: z.string().optional(),
});
export type PanelTemplate = z.infer<typeof PanelTemplate>;

// ---------------------------------------------------------------- project

export const PartRef = z.object({ id: z.string(), version: z.number().int().positive() });
export type PartRef = z.infer<typeof PartRef>;

export const PlacedPart = z.object({
  id: z.string(),
  part: PartRef,
  /** Overrides for a parametric part's params. */
  params: z.record(z.string(), z.number()).optional(),
  x: z.number(),
  y: z.number(),
  /** Degrees, counter-clockwise, as seen from the front. */
  rotation: z.number().default(0),
  label: z.string().default(''),
  mountedTo: z
    .object({
      parent: z.string(),
      dx: z.number(),
      dy: z.number(),
      dz: z.number(),
      bracket: PartRef.optional(),
    })
    .nullable()
    .default(null),
  /** Extra depth behind the panel back face before the part's body starts. */
  depthOffset: z.number().default(0),
  locked: z.boolean().default(false),
  /** Position in the schematic, once the user has moved it; otherwise laid out automatically. */
  schematic: Vec2.optional(),
  /** Off-panel parts: loom length from the panel exit point to the part, mm; null if not measured. */
  offPanelRunMm: z.number().nonnegative().nullable().default(null),
});
export type PlacedPart = z.infer<typeof PlacedPart>;

export const PinRef = z.object({ part: z.string(), connector: z.string(), pin: z.string() });
export const PortRef = z.object({ part: z.string(), port: z.string() });
export const Terminal = z.union([PinRef, PortRef]);
export type Terminal = z.infer<typeof Terminal>;

export const NetType = z.enum(['power', 'ground', 'data', 'audio', 'rf', 'switch', 'pitot', 'static', 'te', 'other']);
export const Net = z.object({
  id: z.string(),
  name: z.string(),
  type: NetType,
  members: z.array(Terminal),
  protection: z.string().nullable().default(null),
});
export type Net = z.infer<typeof Net>;

export const Wire = z.object({
  id: z.string(),
  net: z.string(),
  from: Terminal,
  to: Terminal,
  /** mm² for wire; null for tubing. */
  sizeMm2: z.number().positive().nullable(),
  /** Tube bore, mm, when this is pneumatic tubing. */
  tubeBoreMm: z.number().positive().nullable().default(null),
  colour: z.string(),
  label: z.string(),
  route: z.string().nullable().default(null),
  /** Size chosen automatically from load and length; false once the user sets it. */
  sizeAuto: z.boolean().default(true),
});
export type Wire = z.infer<typeof Wire>;

export const Route = z.object({
  id: z.string(),
  label: z.string().default(''),
  points: z.array(z.object({ x: z.number(), y: z.number(), z: z.number().default(0) })),
  ties: z.array(z.number()).default([]),
});
export type Route = z.infer<typeof Route>;

export const Guide = z.object({ id: z.string(), axis: z.enum(['x', 'y']), value: z.number() });
export type Guide = z.infer<typeof Guide>;

export const TextLabel = z.object({
  id: z.string(),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  size: z.number().positive().default(3.5),
  font: z.string().default('Helvetica'),
  rotation: z.number().default(0),
  layer: z.enum(['engrave', 'print']).default('engrave'),
});
export type TextLabel = z.infer<typeof TextLabel>;

/** A dimension annotation whose ends follow the referenced parts. */
export const DimensionEnd = z.union([
  z.object({ part: z.string() }),
  z.object({ x: z.number(), y: z.number() }),
]);
export const Dimension = z.object({
  id: z.string(),
  a: DimensionEnd,
  b: DimensionEnd,
  /** Offset of the dimension line from the measured points, mm. */
  offset: z.number().default(10),
  kind: z.enum(['aligned', 'horizontal', 'vertical']).default('aligned'),
});
export type Dimension = z.infer<typeof Dimension>;

export const ProjectSettings = z.object({
  units: z.enum(['metric', 'imperial']).default('metric'),
  gridMm: z.number().positive().default(5),
  /** Wire allowance per termination, mm. */
  endAllowanceMm: z.number().nonnegative().default(50),
  /** Minimum ligament between cutouts, mm. Unset until confirmed for the material. */
  minLigamentMm: z.number().nonnegative().nullable().default(null),
  minEdgeDistanceMm: z.number().nonnegative().nullable().default(null),
  minBendDistanceMm: z.number().nonnegative().nullable().default(null),
  compassMinDistanceMm: z.number().nonnegative().nullable().default(null),
  /** Nominal system voltage, V. */
  systemVoltage: z.number().positive().default(12),
  /** Allowable voltage drop from the battery to a load, continuous, V (AC 43.13-1B table 11-6). */
  voltageDropLimitV: z.number().positive().default(0.5),
  /** Insulation temperature rating used to read wire ampacity, °C (AC 43.13-1B table 11-9). */
  wireTempRatingC: z.union([z.literal(105), z.literal(150), z.literal(200)]).default(105),
  /** Continuous load on a fuse or breaker should stay below this fraction of its rating. */
  protectorDerating: z.number().positive().max(1).default(0.8),
  /** Smallest wire the sizing will choose, AWG. */
  minWireAwg: z.number().int().default(22),
  /** Label printer label size, mm. */
  labelWidthMm: z.number().positive().default(40),
  labelHeightMm: z.number().positive().default(12),
});
export type ProjectSettings = z.infer<typeof ProjectSettings>;

export const Project = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  gliderType: z.string().default(''),
  registration: z.string().default(''),
  author: z.string().default(''),
  revision: z.number().int().nonnegative().default(0),
  created: z.string(),
  modified: z.string(),
  /** A library template by reference, or a custom template embedded whole. */
  template: z.union([z.object({ ref: PartRef }), z.object({ embedded: PanelTemplate })]),
  parts: z.array(PlacedPart).default([]),
  /** Parts not in the shipped catalogue, embedded whole. */
  customParts: z.array(CataloguePart).default([]),
  keepOuts: z.array(KeepOut).default([]),
  guides: z.array(Guide).default([]),
  texts: z.array(TextLabel).default([]),
  dimensions: z.array(Dimension).default([]),
  nets: z.array(Net).default([]),
  wires: z.array(Wire).default([]),
  routes: z.array(Route).default([]),
  settings: ProjectSettings.default(ProjectSettings.parse({})),
});
export type Project = z.infer<typeof Project>;
export type ProjectInput = z.input<typeof Project>;

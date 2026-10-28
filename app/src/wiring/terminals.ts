/**
 * Terminals (pins and ports) of the placed parts, with where they are in 3D: x, y on the
 * panel (front-view axes, mm) and z, depth behind the panel back face.
 */
import { applyTransform } from '../geom/shapes';
import type { PartGeometry } from '../model/resolve';
import type { Connector, Pin, PlacedPart, Port, Project, Terminal } from '../model/schema';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TerminalInfo {
  key: string;
  terminal: Terminal;
  partId: string;
  /** "Vario PWR +" or "ASI P". */
  label: string;
  kind: 'pin' | 'port';
  pin?: Pin;
  connector?: Connector;
  port?: Port;
  pos: Vec3;
  offPanel: boolean;
}

export const pinKey = (part: string, connector: string, pin: string) => `${part}/${connector}/${pin}`;
export const portKey = (part: string, port: string) => `${part}//${port}`;

export function keyOf(t: Terminal): string {
  return 'pin' in t ? pinKey(t.part, t.connector, t.pin) : portKey(t.part, t.port);
}

export function isPort(t: Terminal): t is { part: string; port: string } {
  return 'port' in t;
}

export function partLabel(pp: PlacedPart, g: PartGeometry | undefined): string {
  return pp.label || g?.part.model || pp.id;
}

/** Depth of a connector: rear-face connectors at the back of the body, side ones halfway. */
function depthOf(g: PartGeometry, face: Connector['face']): number {
  const back = g.z1 ?? g.z0;
  return face === 'rear' ? back : (g.z0 + back) / 2;
}

export function terminals(doc: Project, geometry: Map<string, PartGeometry>): Map<string, TerminalInfo> {
  const out = new Map<string, TerminalInfo>();
  for (const pp of doc.parts) {
    const g = geometry.get(pp.id);
    if (!g) continue;
    const off = !!g.part.offPanel;
    const name = partLabel(pp, g);
    for (const c of g.part.connectors) {
      const p = applyTransform(g.transform, { x: c.x, y: c.y });
      const pos = off ? { x: pp.x, y: pp.y, z: pp.depthOffset } : { ...p, z: depthOf(g, c.face) };
      for (const pin of c.pins) {
        const key = pinKey(pp.id, c.id, pin.number);
        out.set(key, { key, terminal: { part: pp.id, connector: c.id, pin: pin.number }, partId: pp.id, label: `${name} ${c.pins.length > 1 || c.id !== 'T' ? `${c.id} ` : ''}${pin.number}`.replace(/\s+/g, ' '), kind: 'pin', pin, connector: c, pos, offPanel: off });
      }
    }
    for (const port of g.part.ports) {
      const p = applyTransform(g.transform, { x: port.x, y: port.y });
      const pos = off ? { x: pp.x, y: pp.y, z: pp.depthOffset } : { ...p, z: g.z1 ?? g.z0 };
      const key = portKey(pp.id, port.id);
      out.set(key, { key, terminal: { part: pp.id, port: port.id }, partId: pp.id, label: `${name} ${port.id}`, kind: 'port', port, pos, offPanel: off });
    }
  }
  return out;
}

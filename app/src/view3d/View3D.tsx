/**
 * The 3D view: the panel, bezels, bodies, wires and looms built from the project, to look
 * at the fit from any side. Read-only: clicking selects, and the inspector edits as in the
 * other views. Loaded lazily with three.js (ADR 0014).
 *
 * Axes: three's x and y are the panel's; three's z is minus the depth, so the pilot looks
 * from +z and the fitter from −z.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Vec2 } from '../model/schema';
import { useDoc } from '../store/app';
import { ui, useUi } from '../store/ui';
import type { Vec3 } from '../wiring/terminals';
import { setCameraHandler, type CameraPreset } from './camera';
import { buildModel3d, type Model3D, type Path3, type Solid } from './model3d';

const C = {
  panel: '#d7d9dd',
  bezel: '#2a2e35',
  near: new THREE.Color('#dbe7f3'),
  far: new THREE.Color('#4f82b6'),
  unknown: '#e9c46a',
  clash: '#c8443a',
  loom: '#7a8696',
  edge: '#2a2e35',
  bend: '#118a3a',
  select: '#4a90e2',
};

const NOTE = '3D view built from catalogue data: a planning aid, not to scale for cutting';

interface Pickable {
  id: string;
  mesh: THREE.Mesh;
  edges: THREE.LineSegments | null;
  base: THREE.Color;
}

const toThree = (p: Vec3) => new THREE.Vector3(p.x, p.y, -p.z);

function solidGeometry(s: Solid): THREE.BufferGeometry {
  const path = (pts: Vec2[], P: typeof THREE.Path) => new P(pts.map((p) => new THREE.Vector2(p.x, p.y)));
  const shape = path(s.outline, THREE.Shape) as THREE.Shape;
  shape.closePath();
  for (const h of s.holes) shape.holes.push(path(h, THREE.Path));
  const g = new THREE.ExtrudeGeometry(shape, { depth: s.z1 - s.z0, bevelEnabled: false, curveSegments: 1 });
  // Extrusion runs from three z = 0 forward; the band's back end is at three z = −z1.
  g.translate(0, 0, -s.z1);
  return g;
}

/** Straight tube segments with a ball at each bend; routes and wires have sharp corners. */
function tubeGeometry(points: Vec3[], radius: number, radial: number): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 1; i < points.length; i++) {
    const a = toThree(points[i - 1]!);
    const b = toThree(points[i]!);
    const len = a.distanceTo(b);
    if (len < 1e-6) continue;
    const c = new THREE.CylinderGeometry(radius, radius, len, radial, 1, true);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, b.clone().sub(a).normalize()));
    c.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push(c);
    if (i < points.length - 1) {
      const ball = new THREE.SphereGeometry(radius, radial, Math.max(3, radial / 2));
      ball.translate(b.x, b.y, b.z);
      parts.push(ball);
    }
  }
  if (!parts.length) return null;
  // Cylinders and spheres index differently; merge them as plain triangles.
  const flat = parts.map((p) => p.toNonIndexed());
  const merged = mergeGeometries(flat);
  flat.forEach((p) => p.dispose());
  parts.forEach((p) => p.dispose());
  return merged;
}

function solidColour(s: Solid): THREE.Color {
  if (s.role === 'panel') return new THREE.Color(C.panel);
  if (s.role === 'bezel') return new THREE.Color(C.bezel);
  if (s.clash) return new THREE.Color(C.clash);
  if (s.unknown) return new THREE.Color(C.unknown);
  return C.near.clone().lerp(C.far, s.shade);
}

interface Built {
  group: THREE.Group;
  pickables: Pickable[];
  panel: THREE.Mesh | null;
  wires: THREE.Group;
  looms: THREE.Group;
}

function buildScene(m: Model3D, opts: { seeThrough: boolean }): Built {
  const group = new THREE.Group();
  const wires = new THREE.Group();
  const looms = new THREE.Group();
  const pickables: Pickable[] = [];
  let panel: THREE.Mesh | null = null;
  for (const s of m.solids) {
    const geom = solidGeometry(s);
    const base = solidColour(s);
    const mat = new THREE.MeshStandardMaterial({ color: base, roughness: s.role === 'bezel' ? 0.55 : 0.8, metalness: s.role === 'panel' ? 0.15 : 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    if (s.role === 'panel' && opts.seeThrough) Object.assign(mat, { transparent: true, opacity: 0.35, depthWrite: false });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData = { id: s.partId };
    // Mounted and stacked parts share faces with their neighbours; draw edges for all, so
    // each body reads as its own block, as on a drawing.
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom, 25), new THREE.LineBasicMaterial({ color: s.role === 'bezel' ? '#5b6068' : C.edge, transparent: true, opacity: s.role === 'panel' ? 0.9 : 0.55 }));
    group.add(mesh, edges);
    if (s.role === 'panel') panel = mesh;
    if (s.partId) pickables.push({ id: s.partId, mesh, edges, base });
  }
  // Bend lines on the pilot's face of the plate, which is at three z = thickness.
  const face = m.solids.find((s) => s.role === 'panel');
  const zFace = (face ? -face.z0 : 0) + 0.05;
  for (const b of m.bends) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(b.a.x, b.a.y, zFace), new THREE.Vector3(b.b.x, b.b.y, zFace)]);
    const line = new THREE.Line(g, new THREE.LineDashedMaterial({ color: C.bend, dashSize: 6, gapSize: 3 }));
    line.computeLineDistances();
    group.add(line);
  }
  const addPaths = (paths: Path3[], into: THREE.Group, style: (p: Path3) => THREE.MeshStandardMaterial, radial: number) => {
    for (const p of paths) {
      const geom = tubeGeometry(p.points, p.diameterMm / 2, radial);
      if (!geom) continue;
      const mat = style(p);
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { id: p.id };
      into.add(mesh);
      pickables.push({ id: p.id, mesh, edges: null, base: mat.color.clone() });
    }
  };
  addPaths(m.wires, wires, (p) => new THREE.MeshStandardMaterial({ color: new THREE.Color(p.colour), roughness: 0.6 }), 6);
  addPaths(m.looms, looms, () => new THREE.MeshStandardMaterial({ color: C.loom, roughness: 0.9, transparent: true, opacity: 0.35, depthWrite: false }), 16);
  group.add(wires, looms);
  return { group, pickables, panel, wires, looms };
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const obj = o as THREE.Mesh;
    obj.geometry?.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    mats.forEach((m) => m.dispose());
  });
}

function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export default function View3D() {
  const doc = useDoc();
  const selection = useUi((s) => s.selection);
  const theme = useUi((s) => s.theme);
  const wrap = useRef<HTMLDivElement>(null);
  const [seeThrough, setSeeThrough] = useState(false);
  const [showWires, setShowWires] = useState(true);
  const [showLooms, setShowLooms] = useState(true);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const model = useMemo(() => buildModel3d(doc), [doc]);

  // The renderer, camera and controls live for the life of the view; the scene contents are
  // rebuilt when the document changes.
  const r = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    built: Built | null;
    render: () => void;
    frame: (p: CameraPreset) => void;
  } | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;

  useEffect(() => {
    const el = wrap.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      setFailed('The 3D view needs WebGL, which this browser has turned off or does not support.');
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);
    renderer.domElement.dataset.testid = 'view3d-canvas';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 1, 50000);
    scene.add(new THREE.HemisphereLight('#ffffff', '#8a9099', 1.6));
    const key = new THREE.DirectionalLight('#ffffff', 1.4);
    camera.add(key);
    key.position.set(0.4, 0.8, 1);
    scene.add(camera);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.screenSpacePanning = true;
    let pending = false;
    const render = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        renderer.render(scene, camera);
      });
    };
    controls.addEventListener('change', render);

    let last: Exclude<CameraPreset, 'fit'> = 'iso';
    const frame = (p: CameraPreset) => {
      const m = modelRef.current;
      const centre = new THREE.Vector3((m.box.minX + m.box.maxX) / 2, (m.box.minY + m.box.maxY) / 2, -(m.zMin + m.zMax) / 2);
      const radius = 0.5 * Math.hypot(m.box.maxX - m.box.minX, m.box.maxY - m.box.minY, m.zMax - m.zMin) || 100;
      const dir =
        p === 'fit'
          ? camera.position.clone().sub(controls.target).normalize()
          : p === 'front'
            ? new THREE.Vector3(0, 0, 1)
            : p === 'rear'
              ? new THREE.Vector3(0, 0, -1)
              : new THREE.Vector3(0.55, 0.45, -0.7).normalize();
      if (p !== 'fit') last = p;
      if (dir.lengthSq() === 0) dir.set(0, 0, 1);
      const fov = THREE.MathUtils.degToRad(camera.fov);
      const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * camera.aspect));
      const dist = (radius / Math.sin(fit / 2)) * 1.05;
      controls.target.copy(centre);
      camera.position.copy(centre).addScaledVector(dir, dist);
      camera.up.set(0, 1, 0);
      camera.near = Math.max(0.5, dist / 200);
      camera.far = dist * 20;
      camera.updateProjectionMatrix();
      controls.update();
      render();
    };
    r.current = { renderer, scene, camera, controls, built: null, render, frame };
    setCameraHandler(frame);

    const resize = () => {
      const b = el.getBoundingClientRect();
      const w = Math.max(100, b.width);
      const h = Math.max(100, b.height);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    requestAnimationFrame(() => frame(last));

    // Test hook: where a model point lands on screen, and what the scene holds.
    const gpd = (window as unknown as { gpd?: Record<string, unknown> }).gpd;
    if (gpd)
      gpd.view3d = {
        project: (x: number, y: number, z: number) => {
          const v = new THREE.Vector3(x, y, -z).project(camera);
          const b = renderer.domElement.getBoundingClientRect();
          return { x: b.left + ((v.x + 1) / 2) * b.width, y: b.top + ((1 - v.y) / 2) * b.height };
        },
        counts: () => ({ solids: modelRef.current.solids.length, wires: modelRef.current.wires.length, looms: modelRef.current.looms.length }),
      };

    return () => {
      setCameraHandler(null);
      ro.disconnect();
      controls.dispose();
      if (r.current?.built) disposeGroup(r.current.built.group);
      renderer.dispose();
      renderer.domElement.remove();
      if (gpd) delete gpd.view3d;
      r.current = null;
    };
  }, []);

  // Rebuild the scene when the model or the panel style changes.
  useEffect(() => {
    const c = r.current;
    if (!c) return;
    if (c.built) {
      c.scene.remove(c.built.group);
      disposeGroup(c.built.group);
    }
    c.built = buildScene(model, { seeThrough });
    c.scene.add(c.built.group);
    c.render();
  }, [model, seeThrough]);

  // A different project (opened, or a new one) is framed afresh; edits keep the camera.
  const framedDoc = useRef(doc.id);
  useEffect(() => {
    if (framedDoc.current === doc.id) return;
    framedDoc.current = doc.id;
    r.current?.frame('iso');
  }, [doc.id]);

  useEffect(() => {
    const c = r.current;
    if (!c?.built) return;
    c.built.wires.visible = showWires;
    c.built.looms.visible = showLooms;
    c.render();
  }, [showWires, showLooms, model, seeThrough]);

  // Selection and hover highlight, without a rebuild.
  useEffect(() => {
    const c = r.current;
    if (!c?.built) return;
    const sel = new Set(selection);
    const accent = new THREE.Color(C.select);
    for (const p of c.built.pickables) {
      const mat = p.mesh.material as THREE.MeshStandardMaterial;
      const on = sel.has(p.id);
      const hot = hover?.id === p.id;
      mat.color.copy(p.base);
      if (on) mat.color.lerp(accent, 0.55);
      mat.emissive.set(on ? C.select : '#000000');
      mat.emissiveIntensity = on ? 0.25 : hot ? 0.12 : 0;
      if (hot && !on) mat.emissive.set('#ffffff');
      if (p.edges) {
        const em = p.edges.material as THREE.LineBasicMaterial;
        em.color.set(on ? C.select : C.edge);
        em.opacity = on ? 1 : 0.55;
      }
    }
    c.render();
  }, [selection, hover?.id, model, seeThrough]);

  useEffect(() => {
    // The app sets the theme attribute in its own effect, after this one; read the token a frame on.
    const id = requestAnimationFrame(() => {
      const c = r.current;
      if (!c) return;
      c.scene.background = new THREE.Color(cssVar('--canvas', theme === 'dark' ? '#121417' : '#f4f5f6'));
      c.render();
    });
    return () => cancelAnimationFrame(id);
  }, [theme]);

  const pick = (e: { clientX: number; clientY: number }): string | null => {
    const c = r.current;
    if (!c?.built) return null;
    const b = c.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, c.camera);
    const targets = c.built.pickables.map((p) => p.mesh).filter((m) => m.parent?.visible !== false);
    // The panel itself is not selectable, but it hides what is behind it unless see-through.
    if (c.built.panel && !seeThrough) targets.push(c.built.panel);
    const hit = ray.intersectObjects(targets, false)[0];
    return (hit?.object.userData.id as string | null) ?? null;
  };

  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    const id = pick(e);
    if (!id) return ui.set({ selection: [] });
    ui.set({ selection: e.shiftKey ? (selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]) : [id] });
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.buttons) return;
    const id = pick(e);
    const b = wrap.current!.getBoundingClientRect();
    setHover(id ? { id, x: e.clientX - b.left, y: e.clientY - b.top } : null);
  };

  const hoverLabel = hover ? (model.labels.get(hover.id) ?? doc.wires.find((w) => w.id === hover.id)?.label ?? doc.routes.find((x) => x.id === hover.id)?.label ?? '') : '';

  return (
    <div className="view3d" data-testid="view3d">
      <div ref={wrap} className={`view3d-canvas${hover ? ' is-hot' : ''}`} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerMove={onPointerMove} onPointerLeave={() => setHover(null)} />
      {failed && <div className="view3d-failed">{failed}</div>}
      <div className="schematic-bar view3d-bar">
        <span className="muted small">Look from</span>
        {(['front', 'rear', 'iso'] as const).map((p) => (
          <button key={p} className="btn ghost small" onClick={() => r.current?.frame(p)} data-testid={`view3d-${p}`}>
            {p === 'front' ? 'Front' : p === 'rear' ? 'Rear' : 'Above, behind'}
          </button>
        ))}
        <button className="btn ghost small" onClick={() => r.current?.frame('fit')}>
          Fit
        </button>
        <span className="sep" />
        <label className="chip-check">
          <input type="checkbox" checked={seeThrough} onChange={() => setSeeThrough(!seeThrough)} data-testid="view3d-see-through" />
          See-through panel
        </label>
        <label className="chip-check">
          <input type="checkbox" checked={showWires} onChange={() => setShowWires(!showWires)} />
          Wires
        </label>
        <label className="chip-check">
          <input type="checkbox" checked={showLooms} onChange={() => setShowLooms(!showLooms)} />
          Looms
        </label>
      </div>
      {hover && hoverLabel && (
        <div className="view3d-tip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          {hoverLabel}
        </div>
      )}
      <div className="view3d-notes" data-testid="view3d-notes">
        <div className="small muted">{NOTE}</div>
        {model.notes.length > 0 && (
          <>
            <button className="btn ghost small" onClick={() => setNotesOpen(!notesOpen)}>
              {notesOpen ? 'Hide' : 'Show'} {model.notes.length} note{model.notes.length > 1 ? 's' : ''} on what is approximate
            </button>
            {notesOpen && (
              <ul className="small">
                {model.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="view3d-legend small">
          <span className="swatch" style={{ background: '#dbe7f3' }} /> shallow
          <span className="swatch" style={{ background: '#4f82b6' }} /> deep
          <span className="swatch" style={{ background: C.unknown }} /> depth unknown
          <span className="swatch" style={{ background: C.clash }} /> clash
        </div>
      </div>
    </div>
  );
}

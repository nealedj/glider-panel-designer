/**
 * Grid detection on synthetic photos: a cutting mat with solid inch lines and dashed half
 * lines, seen by a tilted pinhole camera with barrel distortion and sensor noise, partly
 * covered by a cardboard template. The truth is known exactly, so the tests measure the
 * whole chain: detection, distortion, homography and camera height.
 */
import { describe, expect, it } from 'vitest';
import { cameraFromHomography, raisedPlaneCorrection } from '../src/template/camera';
import { autoSeed, fitGrid } from '../src/template/grid';
import { applyH } from '../src/template/homography';
import { inv3 } from '../src/template/linalg';
import { distort, imageToPlane } from '../src/template/mapping';
import { renderMat, type Scene } from './synthetic-mat';

const scene = renderMat({ w: 900, h: 1200, f: 1000, height: 420, tilt: 0.35, yaw: 0.08, k1: -0.035, seed: 2 });
const truthOf = (s: Scene, q: { x: number; y: number }) => distort({ k1: s.k1, width: s.raster.width, height: s.raster.height }, applyH(s.P, q));

describe('cutting-mat grid detection', () => {
  const seed = autoSeed(scene.raster);

  it('finds a seed cell on its own', () => {
    expect(seed).not.toBeNull();
    expect(seed!.points).toHaveLength(4);
  });

  const fit = fitGrid(scene.raster, seed!, 12.7)!;

  it('grows across the template and fits the photo to about a tenth of a millimetre', () => {
    expect(fit.crossings.length).toBeGreaterThan(150);
    expect(fit.rms).toBeLessThan(0.15);
    expect(fit.k1).toBeCloseTo(-0.035, 2);
  });

  it('measures spans across the covered middle correctly', () => {
    // Plane coordinates from the fit are mat-aligned up to a grid offset; compare distances.
    const map = { H: fit.H, k1: fit.k1, width: 900, height: 1200 };
    for (const [a, b] of [
      [
        { x: -110, y: -90 },
        { x: 110, y: -90 },
      ],
      [
        { x: -100, y: 100 },
        { x: 100, y: -80 },
      ],
      [
        { x: 0, y: -95 },
        { x: 0, y: 105 },
      ],
    ] as const) {
      const pa = imageToPlane(map, truthOf(scene, a));
      const pb = imageToPlane(map, truthOf(scene, b));
      const measured = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      expect(Math.abs(measured - Math.hypot(a.x - b.x, a.y - b.y))).toBeLessThan(0.3);
    }
  });

  it('recovers the camera height, to correct for a raised template', () => {
    const cam = cameraFromHomography(inv3(fit.H)!, 900, 1200)!;
    expect(cam.fSource).toBe('estimated');
    expect(Math.abs(cam.height - 420) / 420).toBeLessThan(0.08);
    // A 4 mm card: its features appear about 1 % large; the correction removes that.
    const S = raisedPlaneCorrection(cam, 4);
    expect(S[0]).toBeCloseTo((420 - 4) / 420, 3);
  });
});

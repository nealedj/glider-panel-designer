/**
 * Camera commands for the 3D view. The view itself loads lazily with three.js, so the
 * command registry talks to it through this small bridge instead of importing it.
 */
export type CameraPreset = 'front' | 'rear' | 'iso' | 'fit';

let handler: ((p: CameraPreset) => void) | null = null;

export function setCameraHandler(h: typeof handler) {
  handler = h;
}

export function camera3d(p: CameraPreset) {
  handler?.(p);
}

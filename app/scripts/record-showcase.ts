/**
 * Records the 60 second showcase video: the PIK-20D example in the 3D view, then the front,
 * rear and schematic views. Run with `npm run showcase` (needs ffmpeg with libvpx on the PATH).
 *
 * Every frame is its own screenshot, taken after the mouse has moved one frame's worth, so the
 * motion is smooth at 25 fps however slowly the browser draws WebGL (software rendering in
 * headless Chromium is slow). Headless pages have no pointer, so a red ring stands in for it.
 *
 * Output goes to app/test-results/showcase/: frames/ and showcase.webm (1600 × 900, VP8).
 * SHOWCASE_PREVIEW=n keeps only every nth frame and skips the encode, for checking a change to
 * the script quickly. The timings below fit the PIK-20D example as it is now; if the example
 * changes, check the preview frames before recording again.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Locator, type Page } from '@playwright/test';
import { createServer } from 'vite';

type Part = { id: string; x: number; y: number; label: string };
type Gpd = {
  gpd: {
    docs: { doc: { parts: Part[] } };
    ui: { state: { zoom: number; centre: { x: number; y: number } } };
    view3d?: { project: (x: number, y: number, z: number) => { x: number; y: number }; counts: () => { solids: number } };
  };
};

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(appDir, 'test-results', 'showcase');
const framesDir = join(outDir, 'frames');
const PORT = 5197;
const WIDTH = 1600;
const HEIGHT = 900;
const FPS = 25;
const TOTAL = 60 * FPS;
const PREVIEW = Number(process.env.SHOWCASE_PREVIEW || 0);

let page: Page;
let frame = 0;
let cur = { x: 800, y: 470 };
let pressed = false;
const marks: Record<string, number> = {};
const mark = (name: string) => {
  marks[name] = frame;
};

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const frames = (sec: number) => Math.max(1, Math.round(sec * FPS));

/** One video frame: place the cursor ring, then take the screenshot. */
async function cap() {
  if (!PREVIEW || frame % PREVIEW === 0) {
    await page.evaluate(
      ([x, y, down]) => {
        const c = document.getElementById('showcase-cursor')!;
        c.style.transform = `translate(${x - 11}px, ${y - 11}px) scale(${down ? 0.75 : 1})`;
        c.style.background = down ? 'rgba(208,72,65,0.35)' : 'rgba(208,72,65,0.08)';
      },
      [cur.x, cur.y, pressed] as const,
    );
    await page.screenshot({ path: join(framesDir, `f${String(frame).padStart(5, '0')}.png`) });
  }
  frame++;
}

async function hold(sec: number) {
  for (let i = 0; i < frames(sec); i++) await cap();
}

async function moveTo(x: number, y: number, sec = 0.8) {
  const from = { ...cur };
  const k = frames(sec);
  for (let i = 1; i <= k; i++) {
    const t = ease(i / k);
    cur = { x: from.x + (x - from.x) * t, y: from.y + (y - from.y) * t };
    await page.mouse.move(cur.x, cur.y);
    await cap();
  }
}

async function click() {
  await page.mouse.down();
  pressed = true;
  await cap();
  await cap();
  await page.mouse.up();
  pressed = false;
  await cap();
}

async function drag(x: number, y: number, sec: number, button: 'left' | 'middle' = 'left') {
  await page.mouse.down({ button });
  pressed = true;
  await cap();
  await moveTo(x, y, sec);
  await cap();
  await page.mouse.up({ button });
  pressed = false;
  await cap();
}

/** Scroll in small steps, one per frame, so a zoom plays out smoothly. */
async function wheel(total: number, sec: number) {
  const k = frames(sec);
  let done = 0;
  for (let i = 1; i <= k; i++) {
    const want = total * ease(i / k);
    await page.mouse.wheel(0, want - done);
    done = want;
    await cap();
  }
}

async function clickOn(target: Locator, sec = 0.8) {
  const b = (await target.boundingBox())!;
  await moveTo(b.x + b.width / 2, b.y + b.height / 2, sec);
  await click();
}

const tab = (name: string) => page.locator('.view-tab', { hasText: name });
const part = (label: string) => page.evaluate((l) => (window as unknown as Gpd).gpd.docs.doc.parts.find((p) => p.label === l)!, label);
/** Screen point of a model point in the 3D view; z is rearward from the panel back face. */
const project3d = (x: number, y: number, z: number) => page.evaluate(([x, y, z]) => (window as unknown as Gpd).gpd.view3d!.project(x, y, z), [x, y, z] as const);

/** Screen point of a panel point in the front or rear view (the rear mirrors x). */
async function world(x: number, y: number, rear = false) {
  const box = (await page.locator('svg.canvas').boundingBox())!;
  const st = await page.evaluate(() => (window as unknown as Gpd).gpd.ui.state);
  return { x: box.x + box.width / 2 + (rear ? -1 : 1) * (x - st.centre.x) * st.zoom, y: box.y + box.height / 2 - (y - st.centre.y) * st.zoom };
}

async function script() {
  // ---- 3D: orbit round behind, the front and rear presets, see-through, pick a part ----
  mark('3d');
  await hold(1.2);
  await moveTo(920, 520, 0.7);
  await drag(750, 500, 3.2); // about 75 degrees round, past straight behind
  await hold(0.3);
  await wheel(-220, 1.0);
  await hold(0.3);
  mark('3d-front');
  await clickOn(page.getByTestId('view3d-front'), 0.9);
  await hold(0.9);
  await moveTo(780, 520, 0.5);
  await drag(680, 470, 2.4); // from the front, swing round to show the depth behind
  await hold(0.4);
  mark('3d-rear');
  await clickOn(page.getByTestId('view3d-rear'), 0.9);
  await hold(0.6);
  await clickOn(page.getByTestId('view3d-see-through'), 0.9);
  await hold(0.6);
  await moveTo(800, 520, 0.5);
  await drag(890, 480, 2.0);
  await hold(0.3);
  mark('3d-pick');
  {
    const p = await part('XCVario');
    const at = await project3d(p.x, p.y, 40);
    await moveTo(at.x, at.y, 0.9);
    await click();
  }
  await hold(1.3);

  // ---- Front: drag a part into a clash, undo, measure ----
  mark('front');
  await clickOn(tab('Front'), 0.9);
  await page.keyboard.press('Escape');
  await hold(1.2);
  {
    const p = await part('ADI2');
    const a = await world(p.x, p.y);
    await moveTo(a.x, a.y, 0.9);
    await click();
    await hold(0.8);
    const b = await world(p.x + 48, p.y - 6);
    await drag(b.x, b.y, 2.0); // into the flight computer: the checks flag it
    await hold(1.5);
    await page.keyboard.press('Control+z');
    await hold(1.0);
    await page.keyboard.press('Escape');
  }
  {
    mark('measure');
    await clickOn(page.getByTestId('tool-measure'), 0.8);
    const v = await part('XCVario');
    const c = await part('Compass');
    const a = await world(c.x, c.y);
    const b = await world(v.x, v.y);
    await moveTo(a.x, a.y, 0.8);
    await drag(b.x, b.y, 1.6);
    await hold(1.4);
    await page.keyboard.press('Escape');
    await page.keyboard.press('s');
  }

  // ---- Rear: clip by depth, select a wire ----
  mark('rear');
  await clickOn(tab('Rear'), 0.9);
  await hold(1.4);
  {
    const b = (await page.getByTestId('depth-near').boundingBox())!;
    const x0 = b.x + 6;
    const y = b.y + b.height / 2;
    await moveTo(x0, y, 1.0);
    await drag(b.x + b.width * 0.42, y, 1.8); // hide the shallow parts: only the deep bodies stay
    await hold(1.2);
    await drag(x0 - 6, y, 1.2);
    await hold(0.5);
  }
  {
    // A wire runs over the radio's centre: clicking there selects it and shows its sizing.
    const p = await part('Radio');
    const a = await world(p.x, p.y, true);
    await moveTo(a.x, a.y, 0.9);
    await click();
    await hold(1.7);
    await page.keyboard.press('Escape');
  }

  // ---- Schematic: zoom into the power side, pan, select the main breaker ----
  mark('schematic');
  await clickOn(tab('Schematic'), 0.9);
  await hold(1.0);
  await moveTo(560, 335, 0.8);
  await wheel(-650, 1.6);
  await hold(0.5);
  await moveTo(1000, 620, 0.4);
  await drag(840, 580, 1.3, 'middle');
  await hold(0.5);
  {
    const p = await part('MAIN');
    const b = (await page.getByTestId(`schem-${p.id}`).locator('text.title').boundingBox())!;
    await moveTo(b.x + b.width / 2 + 30, b.y + b.height / 2 + 6, 0.9);
    await click();
  }
  await hold(1.3);
  await page.keyboard.press('Escape');

  // ---- Back to 3D, above and behind, and a slow orbit to the end ----
  mark('close');
  await clickOn(tab('3D'), 0.9);
  await page.keyboard.press('3');
  await moveTo(1050, 500, 0.6);
  const left = TOTAL - frame;
  if (left < 20) throw new Error(`The script runs ${(frame / FPS).toFixed(1)} s before the close; shorten it to fit 60 s.`);
  await page.mouse.down();
  pressed = true;
  await cap();
  await moveTo(960, 440, (left - 4) / FPS);
  await page.mouse.up();
  pressed = false;
  while (frame < TOTAL) await cap();
}

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const server = await createServer({ root: appDir, server: { port: PORT, strictPort: true }, logLevel: 'warn' });
  await server.listen();
  const base = `http://localhost:${PORT}`;
  // CHROMIUM_PATH points at a Chromium other than Playwright's own, if that one isn't installed.
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'] });
  try {
    const ctx = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      // A returning user in the light theme: no welcome dialog.
      storageState: { cookies: [], origins: [{ origin: base, localStorage: [{ name: 'gpd.prefs', value: JSON.stringify({ theme: 'light', onboarded: true, keymap: {} }) }] }] },
    });
    page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.waitForFunction(() => !!(window as unknown as Gpd).gpd);

    // Set up off camera: open the PIK-20D example in the 3D view.
    await page.keyboard.press('Control+k');
    await page.keyboard.type('Open PIK-20D example');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as unknown as Gpd).gpd.docs.doc.parts.length > 10);
    await tab('3D').click();
    await page.waitForFunction(() => ((window as unknown as Gpd).gpd.view3d?.counts().solids ?? 0) > 10);
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const c = document.createElement('div');
      c.id = 'showcase-cursor';
      c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;border:2px solid #d04841;border-radius:50%;box-sizing:border-box;pointer-events:none;z-index:2147483647';
      document.body.appendChild(c);
    });
    await page.mouse.move(cur.x, cur.y);

    await script();
    console.log(`${frame} frames; scenes start at frames ${JSON.stringify(marks)}`);
    if (errors.length) throw new Error(`Page errors while recording:\n${errors.join('\n')}`);
  } finally {
    await browser.close();
    await server.close();
  }

  if (PREVIEW) {
    console.log(`Preview frames (every ${PREVIEW}th) in ${framesDir}`);
    return;
  }
  const video = join(outDir, 'showcase.webm');
  // VP8 like the site's other demo; a high bitrate ceiling keeps UI text sharp.
  execFileSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-framerate', String(FPS), '-i', join(framesDir, 'f%05d.png'), '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-b:v', '1500k', '-crf', '6', '-qmin', '0', '-qmax', '40', '-g', '250', '-auto-alt-ref', '1', '-lag-in-frames', '16', '-deadline', 'good', '-cpu-used', '1', '-an', video],
    { stdio: 'inherit' },
  );
  console.log(`Wrote ${video}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

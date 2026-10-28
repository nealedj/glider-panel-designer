// Writes generated sample projects named in GEN (npm run gen:wiring-sample, npm run gen:pik20d).
import { it } from 'vitest';
import { writeWiringSample } from '../../scripts/make-wiring-sample';
import { writePik20d } from '../../scripts/make-pik20d';

const want = (process.env.GEN ?? '').split(',');

it.runIf(want.includes('wiring-sample'))('writes fixtures/projects/wiring-sample.json', () => console.log('wrote', writeWiringSample()));
it.runIf(want.includes('pik20d'))('writes fixtures/projects/pik20d.json', () => console.log('wrote', writePik20d()));

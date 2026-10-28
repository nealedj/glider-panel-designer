import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Project } from '../src/model/schema';
import { DEFAULT_LINK_LIMIT, decodeProject, encodeProject, fromBase64Url, LinkError, linkData, shareUrl, toBase64Url } from '../src/share/link';

const root = join(__dirname, '..', '..');
const files = readdirSync(join(root, 'fixtures/projects')).filter((f) => f.endsWith('.json'));
const fixture = (name: string) => Project.parse(JSON.parse(readFileSync(join(root, 'fixtures/projects', name), 'utf8')));
const BASE = 'https://example.org/glider-panel-designer/';

function bigProject(n: number): Project {
  const doc = fixture('sample.json');
  const parts = Array.from({ length: n }, (_, i) => ({ ...doc.parts[i % 6]!, id: `big${i}`, x: (i % 20) * 13.37, y: Math.floor(i / 20) * 17.1, label: `Part ${i}` }));
  return { ...doc, parts };
}

describe('share links', () => {
  it.each(files)('%s round-trips through a link unchanged', async (f) => {
    const doc = fixture(f);
    const url = shareUrl(BASE, await encodeProject(doc));
    expect(url.length).toBeLessThan(DEFAULT_LINK_LIMIT);
    const back = await decodeProject(linkData(new URL(url).hash)!);
    expect(back).toEqual(doc);
  });

  it('keeps the design in the fragment, so it never reaches a server', async () => {
    const url = new URL(shareUrl(`${BASE}?x=1#old`, await encodeProject(fixture('sample.json'))));
    expect(url.pathname + url.search).toBe('/glider-panel-designer/?x=1');
    expect(url.hash.startsWith('#p=1.')).toBe(true);
    expect(/^[A-Za-z0-9_.=-]+$/.test(url.hash.slice(1))).toBe(true);
  });

  it('a 200-part design still fits', async () => {
    const url = shareUrl(BASE, await encodeProject(bigProject(200)));
    expect(url.length).toBeLessThan(DEFAULT_LINK_LIMIT);
  });

  it('a design with a finely traced embedded template is too long', async () => {
    const doc = fixture('export-golden.json');
    if (!('embedded' in doc.template)) throw new Error('fixture should embed its template');
    // A traced outline: 1,500 points with sub-millimetre noise, as a scan produces.
    const points = Array.from({ length: 1500 }, (_, i) => {
      const a = (i / 1500) * 2 * Math.PI;
      return { x: Math.round((200 * Math.cos(a) + Math.sin(i * 12.9898) * 0.4) * 1000) / 1000, y: Math.round((120 * Math.sin(a) + Math.cos(i * 78.233) * 0.4) * 1000) / 1000 };
    });
    const big = { ...doc, template: { embedded: { ...doc.template.embedded, outline: { kind: 'poly' as const, closed: true as const, points } } } };
    const url = shareUrl(BASE, await encodeProject(big));
    expect(url.length).toBeGreaterThan(DEFAULT_LINK_LIMIT);
    expect(await decodeProject(linkData(new URL(url).hash)!)).toEqual(big);
  });

  it('base64url round-trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 * 3 + 1 }, (_, i) => (i * 7) % 256);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });

  it('explains damaged, foreign and future links', async () => {
    await expect(decodeProject('nonsense')).rejects.toThrow(LinkError);
    await expect(decodeProject('1.AAAA')).rejects.toThrow(/damaged/);
    await expect(decodeProject('9.AAAA')).rejects.toThrow(/newer version/);
    const notProject = await encodeProject({ hello: 'world' } as unknown as Project);
    await expect(decodeProject(notProject)).rejects.toThrow(/valid design/);
  });

  it('only reads its own fragment key', () => {
    expect(linkData('#p=1.abc')).toBe('1.abc');
    expect(linkData('#section-2')).toBeNull();
    expect(linkData('')).toBeNull();
  });
});

/**
 * The shipped catalogue and template library, loaded from the repo's JSON at build time.
 */
import { CataloguePart, PanelTemplate, type PartRef } from '../model/schema';

const partFiles = import.meta.glob('../../../catalogue/parts/*.json', { eager: true, import: 'default' });
const templateFiles = import.meta.glob('../../../templates/*.json', { eager: true, import: 'default' });

const CATEGORY_ORDER = ['instrument', 'vario', 'flight-computer', 'display', 'radio', 'transponder', 'flarm', 'compass', 'switch', 'breaker', 'fuse', 'mount', 'placard'];
const rank = (c: string) => {
  const i = CATEGORY_ORDER.indexOf(c);
  return i < 0 ? CATEGORY_ORDER.length : i;
};

export const CATALOGUE: CataloguePart[] = Object.values(partFiles)
  .map((j) => CataloguePart.parse(j))
  .sort((a, b) => rank(a.category) - rank(b.category) || a.maker.localeCompare(b.maker) || a.model.localeCompare(b.model, undefined, { numeric: true }));
export const TEMPLATES: PanelTemplate[] = Object.values(templateFiles).map((j) => PanelTemplate.parse(j));

const key = (r: PartRef) => `${r.id}@${r.version}`;
const partIndex = new Map(CATALOGUE.map((p) => [key(p), p]));
const templateIndex = new Map(TEMPLATES.map((t) => [key(t), t]));

export function findPart(ref: PartRef, custom: CataloguePart[] = []): CataloguePart | undefined {
  return custom.find((p) => p.id === ref.id && p.version === ref.version) ?? partIndex.get(key(ref));
}

export function findTemplate(ref: PartRef): PanelTemplate | undefined {
  return templateIndex.get(key(ref));
}

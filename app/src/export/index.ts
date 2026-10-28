/**
 * Every export, by kind: what it is called, whether it is a fabrication output (blocked
 * by open errors unless overridden), and how to build its file.
 */
import type { Project } from '../model/schema';
import { bomCsv } from './bom';
import { buildDrawing, fileStem, NOT_APPROVAL, STAMP } from './drawing';
export { checkSummary } from './drawing';
import { drawingToDxf } from './dxf';
import { frontPdf, frontPng } from './render';
import { rearPdf, rearSvg } from './rear';
import { drawingScene, sceneToSvg } from './scene';
import { templatePdf } from './template-pdf';
import { wireLabelsPdf, wireListCsv, wireListPdf, wiringPdf, wiringSvg } from './wiring';

export { EXPORTS, EXPORT_BY_KIND, type ExportDef, type ExportKind } from './kinds';
import type { ExportKind } from './kinds';

export interface ExportFile {
  name: string;
  mime: string;
  data: string | Uint8Array | Blob;
}

export interface ExportOptions {
  date?: Date;
  /** Exported despite open errors; stamped on fabrication outputs. */
  overridden?: boolean;
}

export function projectJson(doc: Project): string {
  return JSON.stringify(doc, null, 2) + '\n';
}

export async function buildExport(kind: ExportKind, doc: Project, opts: ExportOptions = {}): Promise<ExportFile> {
  const stem = fileStem(doc);
  const date = opts.date ?? new Date();
  switch (kind) {
    case 'cut-svg': {
      const d = buildDrawing(doc, { date, overridden: opts.overridden });
      return {
        name: `${stem}-cut.svg`,
        mime: 'image/svg+xml',
        data: sceneToSvg(drawingScene(d), { title: `${d.title.project} - cut file`, description: `${STAMP}. ${NOT_APPROVAL} Units: mm, scale 1:1.` }),
      };
    }
    case 'cut-dxf':
      return { name: `${stem}-cut.dxf`, mime: 'application/dxf', data: drawingToDxf(buildDrawing(doc, { date, overridden: opts.overridden })) };
    case 'template-pdf':
      return { name: `${stem}-template-A4.pdf`, mime: 'application/pdf', data: templatePdf(doc, { date, overridden: opts.overridden }).bytes };
    case 'render-png':
      return { name: `${stem}-front.png`, mime: 'image/png', data: await frontPng(doc, 2400, date) };
    case 'render-pdf':
      return { name: `${stem}-front.pdf`, mime: 'application/pdf', data: frontPdf(doc, date) };
    case 'rear-pdf':
      return { name: `${stem}-rear-A3.pdf`, mime: 'application/pdf', data: rearPdf(doc, date) };
    case 'rear-svg':
      return { name: `${stem}-rear.svg`, mime: 'image/svg+xml', data: rearSvg(doc) };
    case 'bom-csv':
      return { name: `${stem}-bom.csv`, mime: 'text/csv', data: bomCsv(doc) };
    case 'wires-csv':
      return { name: `${stem}-wire-list.csv`, mime: 'text/csv', data: wireListCsv(doc) };
    case 'wires-pdf':
      return { name: `${stem}-wire-list.pdf`, mime: 'application/pdf', data: wireListPdf(doc, date) };
    case 'labels-pdf':
      return { name: `${stem}-wire-labels.pdf`, mime: 'application/pdf', data: wireLabelsPdf(doc, date) };
    case 'wiring-svg':
      return { name: `${stem}-wiring.svg`, mime: 'image/svg+xml', data: wiringSvg(doc) };
    case 'wiring-pdf':
      return { name: `${stem}-wiring-A3.pdf`, mime: 'application/pdf', data: wiringPdf(doc, date) };
    case 'project-json':
      return { name: `${stem}.panel.json`, mime: 'application/json', data: projectJson({ ...doc, modified: date.toISOString() }) };
  }
}

export { downloadFile } from '../util/download';

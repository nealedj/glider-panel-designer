/**
 * The list of exports, kept apart from the exporters so menus and dialogs can show it
 * without loading them.
 */
export type ExportKind = 'cut-svg' | 'cut-dxf' | 'template-pdf' | 'render-png' | 'render-pdf' | 'rear-pdf' | 'rear-svg' | 'bom-csv' | 'wires-csv' | 'wires-pdf' | 'labels-pdf' | 'wiring-svg' | 'wiring-pdf' | 'project-json';

export interface ExportDef {
  kind: ExportKind;
  label: string;
  format: string;
  description: string;
  /** Used to cut the panel, so open errors block it unless overridden. */
  fabrication: boolean;
}

export const EXPORTS: ExportDef[] = [
  { kind: 'cut-svg', label: 'Cut file', format: 'SVG', description: '1:1 in mm, one layer per cut type, for a laser, router or panel shop.', fabrication: true },
  { kind: 'cut-dxf', label: 'Cut file', format: 'DXF', description: '1:1 in mm, R12, layered; arcs and holes stay exact.', fabrication: true },
  { kind: 'template-pdf', label: 'Printable template', format: 'PDF', description: 'Tiled across A4 at 1:1 with alignment marks and a 100 mm check bar.', fabrication: true },
  { kind: 'render-png', label: 'Front render', format: 'PNG', description: 'An image of the layout for sharing. Not for cutting.', fabrication: false },
  { kind: 'render-pdf', label: 'Front render', format: 'PDF', description: 'The layout on one A4 page with a title block. Not for cutting.', fabrication: false },
  { kind: 'rear-pdf', label: 'Rear layout', format: 'PDF', description: 'The back of the panel on one A3 page: bodies shaded by depth, mounted parts, looms and a depth table.', fabrication: false },
  { kind: 'rear-svg', label: 'Rear layout', format: 'SVG', description: 'The rear layout as a drawing, one layer each for panel, bodies, looms and labels.', fabrication: false },
  { kind: 'bom-csv', label: 'Bill of materials', format: 'CSV', description: 'Parts, quantities, source links, weights and current draw.', fabrication: false },
  { kind: 'wires-csv', label: 'Wire list', format: 'CSV', description: 'Every wire and tube: ends, size, colour, length, route and protection.', fabrication: false },
  { kind: 'wires-pdf', label: 'Wire list', format: 'PDF', description: 'The wire list as a printable table.', fabrication: false },
  { kind: 'labels-pdf', label: 'Wire labels', format: 'PDF', description: 'Two labels per wire, one page per label at the label printer’s size.', fabrication: false },
  { kind: 'wiring-svg', label: 'Wiring diagram', format: 'SVG', description: 'The schematic, for building, fault finding and the aircraft records.', fabrication: false },
  { kind: 'wiring-pdf', label: 'Wiring diagram', format: 'PDF', description: 'The schematic on one A3 page with a title block.', fabrication: false },
  { kind: 'project-json', label: 'Project file', format: 'JSON', description: 'The whole design, for saving, sharing large designs and diffing.', fabrication: false },
];
export const EXPORT_BY_KIND = new Map(EXPORTS.map((e) => [e.kind, e]));

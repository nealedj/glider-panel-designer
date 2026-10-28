/**
 * Published aviation wire charts, as data with their source. See ADR 0012.
 *
 * Transcribed from FAA Advisory Circular AC 43.13-1B (Change 1, 2001-09-27), chapter 11,
 * read from the FAA's PDF. The snippets are the tables' own headings and notes, verbatim.
 * The charts are in AWG; the app works in mm², so each AWG size also carries its area.
 */

export const AC_43_13_1B = {
  title: 'FAA AC 43.13-1B CHG 1, Acceptable Methods, Techniques, and Practices: Aircraft Inspection and Repair, chapter 11',
  url: 'https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_43.13-1B_Full.pdf',
};

/** One circular mil in mm². */
export const MM2_PER_CMIL = 5.067075e-4;

export interface CopperWireRow {
  awg: string;
  /** Continuous duty current in bundles, A, by conductor temperature rating. */
  amps: { 105: number; 150: number; 200: number };
  /** Maximum resistance, tin-plated conductor, ohms per 1000 ft at 20 °C. */
  ohmsPer1000ft: number;
  circMils: number;
}

/** Table 11-9, page 11-23. */
export const TABLE_11_9 = {
  source: { ...AC_43_13_1B, table: 'Table 11-9', page: '11-23' },
  snippet:
    'TABLE 11-9. Current carrying capacity and resistance of copper wire. Continuous duty current (amps)-Wires in bundles, groups, harnesses, or conduits. ' +
    'Note #1: Rating is for 70°C ambient, 33 or more wires in the bundle for sizes 24 through 10, and 9 wires for size 8 and larger, with no more than 20 percent of harness current carrying capacity being used, at an operating altitude of 60,000 feet.',
  rows: [
    { awg: '24', amps: { 105: 2.5, 150: 4, 200: 5 }, ohmsPer1000ft: 28.4, circMils: 475 },
    { awg: '22', amps: { 105: 3, 150: 5, 200: 6 }, ohmsPer1000ft: 16.2, circMils: 755 },
    { awg: '20', amps: { 105: 4, 150: 7, 200: 9 }, ohmsPer1000ft: 9.88, circMils: 1216 },
    { awg: '18', amps: { 105: 6, 150: 9, 200: 12 }, ohmsPer1000ft: 6.23, circMils: 1900 },
    { awg: '16', amps: { 105: 7, 150: 11, 200: 14 }, ohmsPer1000ft: 4.81, circMils: 2426 },
    { awg: '14', amps: { 105: 10, 150: 14, 200: 18 }, ohmsPer1000ft: 3.06, circMils: 3831 },
    { awg: '12', amps: { 105: 13, 150: 19, 200: 25 }, ohmsPer1000ft: 2.02, circMils: 5874 },
    { awg: '10', amps: { 105: 17, 150: 26, 200: 32 }, ohmsPer1000ft: 1.26, circMils: 9354 },
    { awg: '8', amps: { 105: 38, 150: 57, 200: 71 }, ohmsPer1000ft: 0.7, circMils: 16983 },
    { awg: '6', amps: { 105: 50, 150: 76, 200: 97 }, ohmsPer1000ft: 0.44, circMils: 26818 },
    { awg: '4', amps: { 105: 68, 150: 103, 200: 133 }, ohmsPer1000ft: 0.28, circMils: 42615 },
  ] as CopperWireRow[],
};

/** Table 11-3, page 11-15: the largest protector for each copper wire size. */
export const TABLE_11_3 = {
  source: { ...AC_43_13_1B, table: 'Table 11-3', page: '11-15' },
  snippet:
    'TABLE 11-3. DC wire and circuit protector chart. Basis of chart: (1) Wire bundles in 135 °F. ambient and altitudes up to 30,000 feet. ' +
    '(2) Wire bundles of 15 or more wires, with wires carrying no more than 20 percent of the total current carrying capacity of the bundle. ' +
    'Par 11-48: A circuit breaker must be rated so that it will open before the current rating of the wire attached to it is exceeded.',
  rows: [
    { awg: '22', breaker: 5, fuse: 5 },
    { awg: '20', breaker: 7.5, fuse: 5 },
    { awg: '18', breaker: 10, fuse: 10 },
    { awg: '16', breaker: 15, fuse: 10 },
    { awg: '14', breaker: 20, fuse: 15 },
    { awg: '12', breaker: 30, fuse: 20 },
    { awg: '10', breaker: 40, fuse: 30 },
    { awg: '8', breaker: 50, fuse: 50 },
    { awg: '6', breaker: 80, fuse: 70 },
    { awg: '4', breaker: 100, fuse: 70 },
  ],
};

/** Table 11-6, page 11-21: allowable voltage drop between bus and equipment ground. */
export const TABLE_11_6 = {
  source: { ...AC_43_13_1B, table: 'Table 11-6', page: '11-21' },
  snippet: 'TABLE 11-6. Tabulation chart (allowable voltage drop between bus and utilization equipment ground). Nominal system voltage 14: allowable voltage drop continuous operation 0.5, intermittent operation 1.',
  rows: [
    { system: 14, continuous: 0.5, intermittent: 1 },
    { system: 28, continuous: 1, intermittent: 2 },
  ],
};

export const awgArea = (row: { circMils: number }) => row.circMils * MM2_PER_CMIL;

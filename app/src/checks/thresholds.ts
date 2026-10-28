/**
 * Suggested starting thresholds for the front checks, by panel material.
 *
 * These are starting points chosen for this tool, not values from a standard or a maker's
 * guidance. The UI labels them as suggestions, and the user should confirm them for their
 * own panel and thickness.
 */
import type { ProjectSettings } from '../model/schema';

type Thresholds = Pick<ProjectSettings, 'minLigamentMm' | 'minEdgeDistanceMm' | 'minBendDistanceMm'>;

/** Glass-fibre (GRP) panels of about 2 to 3 mm. */
export const GRP_SUGGESTED: Thresholds = {
  // Narrow bridges of laminate between holes crack when drilled or when instruments are
  // tightened; keep at least 5 mm.
  minLigamentMm: 5,
  // Keep cuts well clear of the trimmed edge, which often carries the panel's fixings.
  minEdgeDistanceMm: 8,
  // Clear the moulded radius of a flange plus a margin for the laminate thickening there.
  minBendDistanceMm: 10,
};

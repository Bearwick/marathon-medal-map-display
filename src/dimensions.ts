// Physical dimensions of the supplied display, measured from the assembly STLs in assets/.
// Kept free of Three.js so the map worker and projection helpers can import it cheaply.

export const PLATE_WIDTH = 143;
export const PLATE_HEIGHT = 222;
export const BASE_HEIGHT = 3.5;

/** Visible map window of the lower frame (the area a map's detail should fill). */
export const MAP_WIDTH = 133;
export const MAP_HEIGHT = 117;

/**
 * Full map tile that slides under the frame's side lips (same footprint as the supplied example map).
 * The frame pocket is 144 mm wide with 5 mm lips at z = 13 mm; the map spacer is 8.28 mm on a 3 mm floor.
 */
export const MAP_TILE_WIDTH = 141;
export const MAP_TILE_HEIGHT = 120.91;
/** Thickest a rim may be and still slide under the lip (13 − 3 − 8.28 mm). */
export const MAP_RIM_MAX_THICKNESS = 1.7;
/** Map depth that stays flush with the 16 mm frame front (16 − 3 − 8.28 mm). */
export const MAP_MAX_DEPTH = 4.7;

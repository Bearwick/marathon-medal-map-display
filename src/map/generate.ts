import { MAP_HEIGHT, MAP_MAX_DEPTH, MAP_RIM_MAX_THICKNESS, MAP_TILE_HEIGHT, MAP_TILE_WIDTH, MAP_WIDTH } from '../dimensions';
import type { Line, Polygon } from './geometry2d';
import { clipLine, clipPolygon, densify, rectangle, simplifyLine, simplifyRing } from './geometry2d';
import type { HeightFn, HeightGrid } from './mesh';
import { extrudeConvex, extrudeLine, extrudePolygon, heightfieldSolid, sampleGrid, TriangleBuffer } from './mesh';

export interface MapLayers {
  roads: boolean;
  water: boolean;
  parks: boolean;
  buildings: boolean;
  terrain: boolean;
  route: boolean;
}

export interface MapColours {
  base: string;
  water: string;
  parks: string;
  roads: string;
  buildings: string;
}

export interface MapOptions {
  layers: MapLayers;
  /** Flat base and rim thickness, 1.0–1.7 mm (the rim must slide under the frame lip). */
  baseThickness: number;
  /** Multiplier for road widths, 0.5–2. */
  roadScale: number;
  /** Vertical terrain exaggeration, 1–20 (automatically reduced to fit the depth budget). */
  terrainExaggeration: number;
  /** Multiplier for building heights, 1–6. */
  buildingScale: number;
  colours: MapColours;
}

export function defaultMapOptions(): MapOptions {
  return {
    layers: { roads: true, water: true, parks: true, buildings: false, terrain: true, route: true },
    baseThickness: 1.6, roadScale: 1, terrainExaggeration: 4, buildingScale: 2,
    colours: { base: '#b9b09a', water: '#5b8fbf', parks: '#86a865', roads: '#fbfaf5', buildings: '#8f8676' },
  };
}

export function validateMapOptions(options: MapOptions): void {
  const inRange = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
  if (!inRange(options.baseThickness, 1, MAP_RIM_MAX_THICKNESS)) throw new Error(`Base thickness must be 1–${MAP_RIM_MAX_THICKNESS} mm so the map slides under the frame lip.`);
  if (!inRange(options.roadScale, 0.5, 2)) throw new Error('Road width must be 50–200%.');
  if (!inRange(options.terrainExaggeration, 1, 20)) throw new Error('Terrain exaggeration must be 1–20×.');
  if (!inRange(options.buildingScale, 1, 6)) throw new Error('Building height must be 1–6×.');
  if (!Object.values(options.layers).some(Boolean)) throw new Error('Choose at least one map layer.');
}

export type RoadClass = 'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'minor' | 'service' | 'path';

export interface MapFeatures {
  water: Polygon[];
  waterways: Line[];
  parks: Polygon[];
  roads: { line: Line; kind: RoadClass }[];
  buildings: { polygon: Polygon; heightM: number }[];
}

export function emptyFeatures(): MapFeatures {
  return { water: [], waterways: [], parks: [], roads: [], buildings: [] };
}

/** Terrain elevation in metres on a grid covering the visible window. */
export interface ElevationGrid {
  cols: number;
  rows: number;
  values: Float32Array;
}

export interface GeneratedPart {
  name: string;
  colour: string;
  positions: Float32Array;
  route?: boolean;
}

export interface GenerateResult {
  parts: GeneratedPart[];
  depth: number;
  triangles: number;
  /** Terrain exaggeration actually used after fitting the depth budget (0 without terrain). */
  terrainExaggeration: number;
  warnings: string[];
}

export const LAYER_HEIGHT = { water: 0.3, parks: 0.3, roads: 0.6, route: 1.2, buildingMin: 0.4, buildingMax: 1.6, sink: 0.2 };
export const ROUTE_WIDTH = 1.5;
export const MAX_GENERATED_TRIANGLES = 3_000_000;

const ROAD_WIDTH: Record<RoadClass, number> = { motorway: 1.4, trunk: 1.3, primary: 1.1, secondary: 0.95, tertiary: 0.85, minor: 0.7, service: 0.55, path: 0.5 };

/** Road classes worth printing at a given map width (narrow roads become noise on large areas). */
export function roadClassesFor(widthMeters: number): Set<RoadClass> {
  const all: RoadClass[] = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'path'];
  const count = widthMeters > 25_000 ? 4 : widthMeters > 10_000 ? 5 : widthMeters > 4_000 ? 6 : 8;
  return new Set(all.slice(0, count));
}

/** Gridded window coordinates used for both elevation sampling and the terrain base. */
export function elevationGridShape(stepMm = 1): { cols: number; rows: number; x0: number; y0: number; dx: number; dy: number } {
  const cols = Math.ceil(MAP_WIDTH / stepMm) + 1, rows = Math.ceil(MAP_HEIGHT / stepMm) + 1;
  return { cols, rows, x0: -MAP_WIDTH / 2, y0: -MAP_HEIGHT / 2, dx: MAP_WIDTH / (cols - 1), dy: MAP_HEIGHT / (rows - 1) };
}

function smooth(values: Float32Array, cols: number, rows: number): Float32Array {
  const out = new Float32Array(values.length);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let sum = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const c = i + di, r = j + dj;
        if (c >= 0 && c < cols && r >= 0 && r < rows) { sum += values[r * cols + c]; n++; }
      }
      out[j * cols + i] = sum / n;
    }
  }
  return out;
}

export function generateMap(features: MapFeatures, route: Line[], mmPerMeter: number, options: MapOptions, elevation?: ElevationGrid): GenerateResult {
  validateMapOptions(options);
  const { layers } = options;
  const B = options.baseThickness;
  const warnings: string[] = [];
  const window = rectangle(MAP_WIDTH / 2, MAP_HEIGHT / 2);
  const widthMeters = MAP_WIDTH / mmPerMeter;
  const buildingsOn = layers.buildings && features.buildings.length > 0;
  const topLayer = Math.max(layers.route ? LAYER_HEIGHT.route : 0, layers.roads ? LAYER_HEIGHT.roads : 0, buildingsOn ? LAYER_HEIGHT.buildingMax : 0, LAYER_HEIGHT.water);

  // Terrain base.
  let surface: HeightFn = () => B;
  let grid: HeightGrid | undefined;
  let exaggeration = 0;
  if (layers.terrain && elevation) {
    const shape = elevationGridShape();
    if (elevation.cols !== shape.cols || elevation.rows !== shape.rows) throw new Error('Elevation grid does not match the map window.');
    const metres = smooth(elevation.values, shape.cols, shape.rows);
    let min = Infinity, max = -Infinity;
    for (const v of metres) { if (v < min) min = v; if (v > max) max = v; }
    const budget = Math.max(0, MAP_MAX_DEPTH - B - topLayer);
    const range = (max - min) * mmPerMeter;
    exaggeration = range > 0 ? Math.min(options.terrainExaggeration, budget / range) : options.terrainExaggeration;
    if (exaggeration < options.terrainExaggeration - 1e-6) warnings.push(`Terrain relief reduced to ${exaggeration < 1 ? exaggeration.toFixed(2) : exaggeration.toFixed(1)}× (true scale would be ${range.toFixed(1)} mm high) to keep the map within ${MAP_MAX_DEPTH} mm.`);
    if (range * exaggeration < 0.2) warnings.push('This area is almost flat; terrain adds little relief.');
    const z = new Float32Array(metres.length);
    for (let k = 0; k < metres.length; k++) z[k] = B + (metres[k] - min) * mmPerMeter * exaggeration;
    grid = { ...shape, z };
    const g = grid;
    surface = (x, y) => (Math.abs(x) <= MAP_WIDTH / 2 + 1e-6 && Math.abs(y) <= MAP_HEIGHT / 2 + 1e-6 ? sampleGrid(g, x, y) : B);
  }
  const drape = grid ? 1.5 : Infinity;
  const on = (offset: number): HeightFn => (x, y) => surface(x, y) + offset;
  const sunk = on(-LAYER_HEIGHT.sink);

  const parts: GeneratedPart[] = [];
  let triangles = 0;
  const add = (name: string, colour: string, buffer: TriangleBuffer, route = false) => {
    if (!buffer.triangles) return;
    triangles += buffer.triangles;
    if (triangles > MAX_GENERATED_TRIANGLES) throw new Error('This map is too detailed to print reliably. Turn off buildings, reduce road width or choose a smaller area.');
    parts.push({ name, colour, positions: buffer.toArray(), ...(route ? { route } : {}) });
  };

  // Base: flat slab over the whole tile, or terrain over the window plus a flat rim for the frame lip.
  const base = new TriangleBuffer();
  if (grid) {
    heightfieldSolid(base, grid);
    const ow = MAP_TILE_WIDTH / 2, oh = MAP_TILE_HEIGHT / 2, iw = MAP_WIDTH / 2 - 0.5, ih = MAP_HEIGHT / 2 - 0.5;
    const flat = () => 0, rimTop = () => B;
    for (const [x0, y0, x1, y1] of [[-ow, ih, ow, oh], [-ow, -oh, ow, -ih], [-ow, -ih, -iw, ih], [iw, -ih, ow, ih]]) {
      extrudeConvex(base, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], flat, rimTop);
    }
  } else {
    extrudeConvex(base, rectangle(MAP_TILE_WIDTH / 2, MAP_TILE_HEIGHT / 2), () => 0, () => B);
  }
  add('Map base', options.colours.base, base);

  const tolerance = 0.06;
  const polygons = (items: Polygon[], minArea: number): Polygon[] => items.flatMap((polygon) => {
    const simplified = polygon.map((ring) => simplifyRing(ring, tolerance)).filter((ring) => ring.length >= 3);
    if (!simplified.length) return [];
    const clipped = clipPolygon(simplified, window, minArea);
    if (!clipped) return [];
    return [clipped.map((ring) => (Number.isFinite(drape) ? densify(ring, drape, true) : ring))];
  });
  const lines = (items: Line[]): Line[] => items.flatMap((line) => clipLine(simplifyLine(line, tolerance), window))
    .map((line) => (Number.isFinite(drape) ? densify(line, drape) : line));

  if (layers.water) {
    const water = new TriangleBuffer();
    for (const polygon of polygons(features.water, 0.8)) extrudePolygon(water, polygon, sunk, on(LAYER_HEIGHT.water));
    for (const line of lines(features.waterways)) extrudeLine(water, line, 0.8 * options.roadScale, sunk, on(LAYER_HEIGHT.water));
    add('Water', options.colours.water, water);
  }
  if (layers.parks) {
    const parks = new TriangleBuffer();
    for (const polygon of polygons(features.parks, 1)) extrudePolygon(parks, polygon, sunk, on(LAYER_HEIGHT.parks));
    add('Parks', options.colours.parks, parks);
  }
  if (layers.roads) {
    const roads = new TriangleBuffer();
    const allowed = roadClassesFor(widthMeters);
    for (const { line, kind } of features.roads) {
      if (!allowed.has(kind)) continue;
      const width = Math.max(0.5, ROAD_WIDTH[kind] * options.roadScale);
      for (const piece of lines([line])) extrudeLine(roads, piece, width, sunk, on(LAYER_HEIGHT.roads));
    }
    add('Roads', options.colours.roads, roads);
  }
  if (buildingsOn) {
    const buildings = new TriangleBuffer();
    for (const { polygon, heightM } of features.buildings) {
      const [clipped] = polygons([polygon], 0.15);
      if (!clipped) continue;
      const outer = clipped[0];
      let lowest = Infinity, highest = -Infinity;
      for (const [x, y] of outer) { const h = surface(x, y); lowest = Math.min(lowest, h); highest = Math.max(highest, h); }
      const height = Math.min(LAYER_HEIGHT.buildingMax, Math.max(LAYER_HEIGHT.buildingMin, heightM * mmPerMeter * options.buildingScale));
      extrudePolygon(buildings, clipped, () => lowest - LAYER_HEIGHT.sink, () => highest + height);
    }
    add('Buildings', options.colours.buildings, buildings);
  } else if (layers.buildings) warnings.push('No buildings were found for this area at this zoom level. Choose a smaller area for building detail.');
  if (layers.route) {
    const routeBuffer = new TriangleBuffer();
    const clippedRoute = lines(route);
    for (const line of clippedRoute) extrudeLine(routeBuffer, line, ROUTE_WIDTH, sunk, on(LAYER_HEIGHT.route), true);
    add('Route', '#e97845', routeBuffer, true);
  }

  let depth = B;
  for (const part of parts) for (let k = 2; k < part.positions.length; k += 3) if (part.positions[k] > depth) depth = part.positions[k];
  const routeLength = route.reduce((sum, line) => sum + line.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0), 0);
  if (layers.route && routeLength > 0) {
    const inside = lines(route).reduce((sum, line) => sum + line.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0), 0);
    if (inside < routeLength * 0.98) warnings.push(`${Math.round((1 - inside / routeLength) * 100)}% of the route falls outside the map area.`);
  }
  return { parts, depth, triangles, terrainExaggeration: exaggeration, warnings };
}

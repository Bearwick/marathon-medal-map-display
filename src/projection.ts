import { MAP_HEIGHT, MAP_WIDTH } from './dimensions';

/** Web Mercator (EPSG:3857) radius, matching map tiles. */
export const EARTH_RADIUS = 6378137;
export const MERCATOR_CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS;
const MAX_LAT = 85.05112878;
const rad = Math.PI / 180;

export type LonLat = [number, number];

/**
 * The map area that is printed. `widthMeters` is the ground distance across the visible map window,
 * `rotationDeg` is the clockwise bearing of the frame's top edge relative to north.
 */
export interface Frame {
  center: LonLat;
  widthMeters: number;
  rotationDeg: number;
}

export const MIN_FRAME_METERS = 300;
export const MAX_FRAME_METERS = 120_000;

export function mercator([lon, lat]: LonLat): [number, number] {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  return [EARTH_RADIUS * lon * rad, EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (clamped * rad) / 2))];
}

export function inverseMercator([x, y]: [number, number]): LonLat {
  return [x / EARTH_RADIUS / rad, (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) / rad];
}

export function validateFrame(frame: Frame): void {
  const [lon, lat] = frame.center;
  if (![lon, lat, frame.widthMeters, frame.rotationDeg].every(Number.isFinite) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
    throw new Error('The map area is invalid. Move the frame to a valid location.');
  }
  if (frame.widthMeters < MIN_FRAME_METERS || frame.widthMeters > MAX_FRAME_METERS) {
    throw new Error(`The map width must be between ${MIN_FRAME_METERS / 1000} and ${MAX_FRAME_METERS / 1000} km.`);
  }
}

/** Converts between geographic coordinates and millimetres on the printed map (origin at its centre, +y = frame top). */
export class FrameProjection {
  readonly frame: Frame;
  readonly widthMm: number;
  readonly heightMm: number;
  /** Printed millimetres per ground metre. */
  readonly mmPerMeter: number;
  private readonly cx: number;
  private readonly cy: number;
  private readonly groundScale: number;
  private readonly cos: number;
  private readonly sin: number;

  constructor(frame: Frame, widthMm = MAP_WIDTH, heightMm = MAP_HEIGHT) {
    this.frame = frame;
    this.widthMm = widthMm;
    this.heightMm = heightMm;
    [this.cx, this.cy] = mercator(frame.center);
    this.groundScale = Math.cos(frame.center[1] * rad);
    this.mmPerMeter = widthMm / frame.widthMeters;
    this.cos = Math.cos(frame.rotationDeg * rad);
    this.sin = Math.sin(frame.rotationDeg * rad);
  }

  get heightMeters(): number {
    return this.heightMm / this.mmPerMeter;
  }

  /** Mercator metres → printed mm. */
  fromMercator(mx: number, my: number): [number, number] {
    const e = (mx - this.cx) * this.groundScale;
    const n = (my - this.cy) * this.groundScale;
    return [(e * this.cos - n * this.sin) * this.mmPerMeter, (e * this.sin + n * this.cos) * this.mmPerMeter];
  }

  toMercator(x: number, y: number): [number, number] {
    const lx = x / this.mmPerMeter, ly = y / this.mmPerMeter;
    const e = lx * this.cos + ly * this.sin;
    const n = -lx * this.sin + ly * this.cos;
    return [this.cx + e / this.groundScale, this.cy + n / this.groundScale];
  }

  toLocal(point: LonLat): [number, number] {
    const [mx, my] = mercator(point);
    return this.fromMercator(mx, my);
  }

  toLonLat(x: number, y: number): LonLat {
    return inverseMercator(this.toMercator(x, y));
  }

  /** Corners of a rectangle centred on the map (defaults to the visible window), clockwise from top-left. */
  corners(widthMm = this.widthMm, heightMm = this.heightMm): LonLat[] {
    const w = widthMm / 2, h = heightMm / 2;
    return [[-w, h], [w, h], [w, -h], [-w, -h]].map(([x, y]) => this.toLonLat(x, y));
  }

  contains(point: LonLat, margin = 0): boolean {
    const [x, y] = this.toLocal(point);
    return Math.abs(x) <= this.widthMm / 2 - margin && Math.abs(y) <= this.heightMm / 2 - margin;
  }
}

/** The smallest frame (at a given rotation) that fits all points with `padding` (fraction of the size) on each side. */
export function frameForPoints(points: LonLat[], rotationDeg = 0, padding = 0.08, widthMm = MAP_WIDTH, heightMm = MAP_HEIGHT): Frame {
  if (!points.length) throw new Error('No points to frame.');
  const merc = points.map(mercator);
  const xs = merc.map((p) => p[0]), ys = merc.map((p) => p[1]);
  const start = inverseMercator([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]);
  // Measure extents in the rotated frame at 1 mm per metre, then recentre on the rotated bounding box.
  const probe = new FrameProjection({ center: start, widthMeters: widthMm, rotationDeg }, widthMm, heightMm);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [mx, my] of merc) {
    const [x, y] = probe.fromMercator(mx, my);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const center = probe.toLonLat((minX + maxX) / 2, (minY + maxY) / 2);
  const width = Math.max(maxX - minX, ((maxY - minY) * widthMm) / heightMm) * (1 + 2 * padding);
  return { center, widthMeters: Math.min(MAX_FRAME_METERS, Math.max(MIN_FRAME_METERS, width)), rotationDeg };
}

/** Frame orientation (0 or 90°) that lets the points fill the landscape window best. */
export function bestFrameForPoints(points: LonLat[], padding = 0.08): Frame {
  const candidates = [0, 90, -90].map((rotation) => frameForPoints(points, rotation, padding));
  return candidates.reduce((best, frame) => (frame.widthMeters < best.widthMeters * 0.92 ? frame : best));
}

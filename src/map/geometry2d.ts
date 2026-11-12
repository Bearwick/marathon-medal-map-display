// Small, dependency-free 2D helpers for map generation (millimetre coordinates).

export type Point = [number, number];
export type Ring = Point[];
/** First ring is the outer boundary (counter-clockwise), the rest are holes (clockwise). */
export type Polygon = Ring[];
export type Line = Point[];

export function signedArea(ring: Ring): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return area / 2;
}

export function orient(ring: Ring, counterClockwise: boolean): Ring {
  return (signedArea(ring) > 0) === counterClockwise ? ring : [...ring].reverse();
}

/** Removes the closing duplicate point and consecutive duplicates. */
export function cleanRing(ring: Ring, epsilon = 1e-6): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const last = out.at(-1);
    if (!last || Math.abs(last[0] - p[0]) > epsilon || Math.abs(last[1] - p[1]) > epsilon) out.push(p);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out.at(-1)![0]) <= epsilon && Math.abs(out[0][1] - out.at(-1)![1]) <= epsilon) out.pop();
  return out;
}

/** Douglas–Peucker simplification of an open polyline. */
export function simplifyLine(points: Line, tolerance: number): Line {
  if (points.length < 3 || tolerance <= 0) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-12;
    let worst = -1, index = -1;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((points[i][0] - ax) * dx + (points[i][1] - ay) * dy) / len2));
      const ex = points[i][0] - (ax + t * dx), ey = points[i][1] - (ay + t * dy);
      const d = ex * ex + ey * ey;
      if (d > worst) { worst = d; index = i; }
    }
    if (worst > t2) { keep[index] = 1; stack.push([a, index], [index, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplifies a closed ring by splitting it at its farthest point pair and simplifying both halves. */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length < 5) return ring;
  let far = 1, best = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > best) { best = d; far = i; }
  }
  const first = simplifyLine(ring.slice(0, far + 1), tolerance);
  const second = simplifyLine([...ring.slice(far), ring[0]], tolerance);
  return [...first, ...second.slice(1, -1)];
}

/** Sutherland–Hodgman: clips a ring to a convex polygon given counter-clockwise. */
export function clipRing(ring: Ring, clip: Ring): Ring {
  let output = ring;
  for (let i = 0; i < clip.length && output.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const inside = (p: Point) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    const intersect = (p: Point, q: Point): Point => {
      const x1 = p[0], y1 = p[1], x2 = q[0], y2 = q[1];
      const x3 = a[0], y3 = a[1], x4 = b[0], y4 = b[1];
      const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      const t = den === 0 ? 0 : ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
      return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
    };
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const current = input[j], previous = input[(j + input.length - 1) % input.length];
      const ci = inside(current), pi = inside(previous);
      if (ci) {
        if (!pi) output.push(intersect(previous, current));
        output.push(current);
      } else if (pi) output.push(intersect(previous, current));
    }
  }
  return output;
}

/** Clips a polygon (outer ring + holes) to a convex counter-clockwise polygon. Returns undefined when empty. */
export function clipPolygon(polygon: Polygon, clip: Ring, minArea = 0.01): Polygon | undefined {
  const [outer, ...holes] = polygon;
  const clippedOuter = cleanRing(clipRing(orient(outer, true), clip));
  if (clippedOuter.length < 3 || Math.abs(signedArea(clippedOuter)) < minArea) return undefined;
  const clippedHoles = holes
    .map((hole) => cleanRing(clipRing(orient(hole, true), clip)))
    .filter((hole) => hole.length >= 3 && Math.abs(signedArea(hole)) >= minArea)
    .map((hole) => orient(hole, false));
  return [clippedOuter, ...clippedHoles];
}

/** Cyrus–Beck: clips polylines to a convex counter-clockwise polygon. */
export function clipLine(line: Line, clip: Ring): Line[] {
  const out: Line[] = [];
  let current: Line = [];
  const flush = () => { if (current.length > 1) out.push(current); current = []; };
  for (let i = 1; i < line.length; i++) {
    const p = line[i - 1], q = line[i];
    const d: Point = [q[0] - p[0], q[1] - p[1]];
    let t0 = 0, t1 = 1, visible = true;
    for (let j = 0; j < clip.length && visible; j++) {
      const a = clip[j], b = clip[(j + 1) % clip.length];
      const normal: Point = [-(b[1] - a[1]), b[0] - a[0]]; // inward for CCW
      const num = normal[0] * (p[0] - a[0]) + normal[1] * (p[1] - a[1]);
      const den = normal[0] * d[0] + normal[1] * d[1];
      if (Math.abs(den) < 1e-12) { if (num < 0) visible = false; continue; }
      const t = -num / den;
      if (den > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
      if (t0 > t1) visible = false;
    }
    if (!visible) { flush(); continue; }
    const a: Point = [p[0] + t0 * d[0], p[1] + t0 * d[1]];
    const b: Point = [p[0] + t1 * d[0], p[1] + t1 * d[1]];
    const last = current.at(-1);
    if (!last || Math.abs(last[0] - a[0]) > 1e-9 || Math.abs(last[1] - a[1]) > 1e-9) { flush(); current.push(a); }
    current.push(b);
    if (t1 < 1) flush();
  }
  flush();
  return out;
}

export function rectangle(halfWidth: number, halfHeight: number): Ring {
  return [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight]];
}

/** Inserts points so that no edge is longer than `step` (used to drape outlines over terrain). */
export function densify(points: Line, step: number, closed = false): Line {
  const out: Line = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    out.push(a);
    const pieces = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
    for (let k = 1; k <= pieces; k++) {
      const t = k / (pieces + 1);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  if (!closed) out.push(points.at(-1)!);
  return out;
}

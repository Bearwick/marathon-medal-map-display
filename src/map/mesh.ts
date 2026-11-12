import { ShapeUtils, Vector2 } from 'three';
import type { Point, Polygon, Ring } from './geometry2d';
import { orient, signedArea } from './geometry2d';

export type HeightFn = (x: number, y: number) => number;

/** Growable list of triangle vertex positions (x, y, z per vertex, three vertices per triangle). */
export class TriangleBuffer {
  private data = new Float32Array(9 * 1024);
  private size = 0;

  get triangles(): number {
    return this.size / 9;
  }

  push(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    if (this.size + 9 > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const d = this.data;
    let i = this.size;
    d[i++] = ax; d[i++] = ay; d[i++] = az;
    d[i++] = bx; d[i++] = by; d[i++] = bz;
    d[i++] = cx; d[i++] = cy; d[i++] = cz;
    this.size = i;
  }

  toArray(): Float32Array {
    return this.data.slice(0, this.size);
  }
}

/** Side walls for one ring; solid material must be on the left of the ring direction. */
function walls(buffer: TriangleBuffer, ring: Ring, bottom: HeightFn, top: HeightFn): void {
  for (let i = 0; i < ring.length; i++) {
    const [px, py] = ring[i], [qx, qy] = ring[(i + 1) % ring.length];
    const pb = bottom(px, py), qb = bottom(qx, qy), pt = top(px, py), qt = top(qx, qy);
    buffer.push(px, py, pb, qx, qy, qb, qx, qy, qt);
    buffer.push(px, py, pb, qx, qy, qt, px, py, pt);
  }
}

/** Closed prism of a polygon (outer ring + holes) between two height functions. */
export function extrudePolygon(buffer: TriangleBuffer, polygon: Polygon, bottom: HeightFn, top: HeightFn): void {
  const outer = orient(polygon[0], true);
  const holes = polygon.slice(1).map((hole) => orient(hole, false));
  const contour = outer.map(([x, y]) => new Vector2(x, y));
  const holeVectors = holes.map((hole) => [...hole].reverse().map(([x, y]) => new Vector2(x, y)));
  const faces = ShapeUtils.triangulateShape(contour, holeVectors);
  const points: Point[] = [...outer, ...holes.map((hole) => [...hole].reverse()).flat()];
  for (const [a, b, c] of faces) {
    let [p, q, r] = [points[a], points[b], points[c]];
    if (signedArea([p, q, r]) < 0) [q, r] = [r, q];
    buffer.push(p[0], p[1], top(p[0], p[1]), q[0], q[1], top(q[0], q[1]), r[0], r[1], top(r[0], r[1]));
    buffer.push(p[0], p[1], bottom(p[0], p[1]), r[0], r[1], bottom(r[0], r[1]), q[0], q[1], bottom(q[0], q[1]));
  }
  walls(buffer, outer, bottom, top);
  for (const hole of holes) walls(buffer, hole, bottom, top);
}

/** Closed prism of a convex counter-clockwise ring (fan triangulated). */
export function extrudeConvex(buffer: TriangleBuffer, ring: Ring, bottom: HeightFn, top: HeightFn): void {
  const [o] = ring;
  for (let i = 1; i < ring.length - 1; i++) {
    const p = ring[i], q = ring[i + 1];
    buffer.push(o[0], o[1], top(o[0], o[1]), p[0], p[1], top(p[0], p[1]), q[0], q[1], top(q[0], q[1]));
    buffer.push(o[0], o[1], bottom(o[0], o[1]), q[0], q[1], bottom(q[0], q[1]), p[0], p[1], bottom(p[0], p[1]));
  }
  walls(buffer, ring, bottom, top);
}

/** A raised strip along a polyline: one box per segment plus round-ish joints at bends. */
export function extrudeLine(buffer: TriangleBuffer, line: Point[], width: number, bottom: HeightFn, top: HeightFn, allJoints = false): void {
  const half = width / 2;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    const length = Math.hypot(bx - ax, by - ay);
    if (length < 1e-4) continue;
    const nx = (-(by - ay) / length) * half, ny = ((bx - ax) / length) * half;
    extrudeConvex(buffer, [[ax - nx, ay - ny], [bx - nx, by - ny], [bx + nx, by + ny], [ax + nx, ay + ny]], bottom, top);
  }
  for (let i = allJoints ? 0 : 1; i < (allJoints ? line.length : line.length - 1); i++) {
    if (!allJoints) {
      const [ax, ay] = line[i - 1], [bx, by] = line[i], [cx, cy] = line[i + 1];
      const turn = Math.abs(Math.atan2((bx - ax) * (cy - by) - (by - ay) * (cx - bx), (bx - ax) * (cx - bx) + (by - ay) * (cy - by)));
      if (turn < 0.2) continue;
    }
    const [x, y] = line[i];
    const sides = 8;
    const ring: Ring = [];
    for (let k = 0; k < sides; k++) ring.push([x + half * Math.cos((k / sides) * 2 * Math.PI), y + half * Math.sin((k / sides) * 2 * Math.PI)]);
    extrudeConvex(buffer, ring, bottom, top);
  }
}

export interface HeightGrid {
  cols: number;
  rows: number;
  /** Bottom-left corner and spacing in millimetres. */
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  /** Top surface heights in millimetres, row-major (row = y index). */
  z: Float32Array;
}

/** Bilinear sampling of a height grid, clamped to its edges. */
export function sampleGrid(grid: HeightGrid, x: number, y: number): number {
  const fx = Math.max(0, Math.min(grid.cols - 1, (x - grid.x0) / grid.dx));
  const fy = Math.max(0, Math.min(grid.rows - 1, (y - grid.y0) / grid.dy));
  const i = Math.min(grid.cols - 2, Math.floor(fx)), j = Math.min(grid.rows - 2, Math.floor(fy));
  const tx = fx - i, ty = fy - j;
  const at = (c: number, r: number) => grid.z[r * grid.cols + c];
  return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
}

/** Watertight solid: terrain top surface, flat bottom at z = 0, vertical sides. */
export function heightfieldSolid(buffer: TriangleBuffer, grid: HeightGrid): void {
  const { cols, rows, x0, y0, dx, dy, z } = grid;
  const X = (i: number) => x0 + i * dx, Y = (j: number) => y0 + j * dy, Z = (i: number, j: number) => z[j * cols + i];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      buffer.push(X(i), Y(j), Z(i, j), X(i + 1), Y(j), Z(i + 1, j), X(i + 1), Y(j + 1), Z(i + 1, j + 1));
      buffer.push(X(i), Y(j), Z(i, j), X(i + 1), Y(j + 1), Z(i + 1, j + 1), X(i), Y(j + 1), Z(i, j + 1));
    }
  }
  // Border ring counter-clockwise, as grid indices.
  const border: [number, number][] = [];
  for (let i = 0; i < cols - 1; i++) border.push([i, 0]);
  for (let j = 0; j < rows - 1; j++) border.push([cols - 1, j]);
  for (let i = cols - 1; i > 0; i--) border.push([i, rows - 1]);
  for (let j = rows - 1; j > 0; j--) border.push([0, j]);
  const cx = X((cols - 1) / 2), cy = Y((rows - 1) / 2);
  for (let k = 0; k < border.length; k++) {
    const [pi, pj] = border[k], [qi, qj] = border[(k + 1) % border.length];
    const px = X(pi), py = Y(pj), qx = X(qi), qy = Y(qj);
    buffer.push(px, py, 0, qx, qy, 0, qx, qy, Z(qi, qj));
    buffer.push(px, py, 0, qx, qy, Z(qi, qj), px, py, Z(pi, pj));
    buffer.push(cx, cy, 0, qx, qy, 0, px, py, 0);
  }
}

import { Box3, BoxGeometry, BufferGeometry, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { Font } from 'three/addons/loaders/FontLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ColourKey, Design, KitCounts, ResultKey } from './data';
import { dateText, distanceText, kitCharacters, paceText, resultKeys, unitLabel, validateDesign, validateResults } from './data';
import { projectTrack } from './gpx';
import type { Track } from './gpx';

import { BASE_HEIGHT, MAP_HEIGHT, MAP_RIM_MAX_THICKNESS, MAP_TILE_HEIGHT, MAP_TILE_WIDTH, MAP_WIDTH } from './dimensions';
import type { Frame } from './projection';

export { BASE_HEIGHT, MAP_HEIGHT, MAP_MAX_DEPTH, MAP_TILE_HEIGHT, MAP_TILE_WIDTH, MAP_WIDTH, PLATE_HEIGHT, PLATE_WIDTH } from './dimensions';

export function part(name: string, geometry: BufferGeometry, colour: string): Mesh {
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: colour, roughness: 0.78, metalness: 0 }));
  mesh.name = name;
  return mesh;
}

function text(font: Font, value: string, size: number, maxWidth: number, x: number, y: number, z: number): BufferGeometry {
  for (const character of value) {
    if (!font.data.glyphs[character]) throw new Error(`The print font does not support “${character}”. Choose a Droid font under Colours & font, or use another character.`);
  }
  const extruded = new ExtrudeGeometry(font.generateShapes(value, size), { depth: 0.8, bevelEnabled: false, curveSegments: 6 });
  const geometry = closeTextSeams(extruded);
  extruded.dispose();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const factor = Math.min(1, maxWidth / (box.max.x - box.min.x));
  if (size * factor < 2.2) {
    geometry.dispose();
    throw new Error(`“${value}” is too long to print legibly. Shorten it.`);
  }
  geometry.scale(factor, factor, 1);
  geometry.translate(x - box.min.x * factor, y - box.min.y * factor, z);
  return geometry;
}

function closeTextSeams(geometry: BufferGeometry): BufferGeometry {
  // Earcut may omit a collinear cap vertex that extrusion side walls still use.
  // Split those T-junctions so exported lettering has paired, watertight edges.
  const position = geometry.getAttribute('position');
  const vertices: Vector3[] = [];
  const ids = new Map<string, number>();
  const triangles: number[][] = [];
  const edgeCounts = new Map<string, number>();
  const edgeKey = (a: number, b: number) => a < b ? `${a},${b}` : `${b},${a}`;
  for (let i = 0; i < position.count; i += 3) {
    const triangle: number[] = [];
    for (let j = 0; j < 3; j++) {
      const vertex = new Vector3().fromBufferAttribute(position, i + j);
      const key = vertex.toArray().map((n) => n.toFixed(6)).join(',');
      let id = ids.get(key);
      if (id === undefined) { id = vertices.length; ids.set(key, id); vertices.push(vertex); }
      triangle.push(id);
    }
    if (new Set(triangle).size < 3) continue;
    triangles.push(triangle);
    for (let j = 0; j < 3; j++) {
      const key = edgeKey(triangle[j], triangle[(j + 1) % 3]);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  const boundary = new Set<number>();
  for (const [edge, count] of edgeCounts) if (count === 1) edge.split(',').forEach((id) => boundary.add(Number(id)));
  const output: number[] = [];
  const pending = [...triangles];
  while (pending.length) {
    const triangle = pending.pop()!;
    let split = false;
    for (let j = 0; j < 3; j++) {
      const a = triangle[j], b = triangle[(j + 1) % 3], c = triangle[(j + 2) % 3];
      if (edgeCounts.get(edgeKey(a, b)) !== 1) continue;
      const direction = vertices[b].clone().sub(vertices[a]);
      const lengthSquared = direction.lengthSq();
      const between: { id: number; t: number }[] = [];
      for (const id of boundary) {
        if (id === a || id === b || id === c) continue;
        const t = vertices[id].clone().sub(vertices[a]).dot(direction) / lengthSquared;
        if (t <= 1e-6 || t >= 1 - 1e-6) continue;
        const closest = vertices[a].clone().addScaledVector(direction, t);
        if (closest.distanceToSquared(vertices[id]) < 1e-12) between.push({ id, t });
      }
      if (!between.length) continue;
      const chain = [a, ...between.sort((left, right) => left.t - right.t).map((v) => v.id), b];
      for (let k = 1; k < chain.length; k++) pending.push([chain[k - 1], chain[k], c]);
      split = true;
      break;
    }
    if (!split) triangle.forEach((id) => output.push(...vertices[id].toArray()));
  }
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(output, 3));
  result.computeVertexNormals();
  return result;
}

export function makePlate(design: Design, font: Font, originalBase: BufferGeometry): Group {
  validateDesign(design);
  const plate = new Group();
  plate.name = 'Medal plate';
  const addText = (key: ColourKey, value: string, size: number, width: number, x: number, y: number, target = plate, z = BASE_HEIGHT) => {
    const mesh = part(key, text(font, value, size, width, x, y, z), design.colours[key]);
    target.add(mesh);
    return mesh;
  };
  plate.add(part('Original plate base', originalBase.clone(), design.colours.base));
  addText('title', design.title.toUpperCase(), 8.5, 120, -60, -49);
  addText('location', design.location.toUpperCase(), 5.5, 120, -60, -62);
  addText('date', dateText(design.date), 3.6, 120, -60, -73);
  addText('distance', distanceText(design), 6, 27, -60, -94);
  addText('distance', `DIST / ${unitLabel(design)}`, 2.5, 27, -60, -103);

  const fields = [
    { key: 'time' as const, label: 'TIME', value: design.time },
    { key: 'pace' as const, label: `PACE / ${unitLabel(design)}`, value: design.placements.pace === 'attached' ? paceText(design) : '' },
    { key: 'bib' as const, label: 'BIB', value: `#${design.bib}` },
  ];
  fields.forEach(({ key, label, value }, i) => {
    const placement = design.placements[key];
    if (placement === 'hidden') return;
    const x = -28 + i * 31;
    addText(key, label, 2.5, 28, x, -103).name = `${key} label`;
    if (placement === 'attached') {
      addText(key, value, 5.2, 28, x, -94);
    } else if (key === 'bib') {
      addText(key, '#', 5.2, 3, x, -94).name = 'bib fixed prefix';
    }
  });
  return plate;
}

export function makeGlueCharacters(design: Design, font: Font, selection: 'exact' | ResultKey, counts: KitCounts): Group {
  const keys = resultKeys.filter((key) => design.placements[key] === 'separate');
  if (!keys.length) throw new Error('Choose glue-on digits for at least one result field first.');
  if (selection !== 'exact' && !keys.includes(selection)) throw new Error('Choose a field configured for glue-on digits.');
  const group = new Group();
  group.name = selection === 'exact' ? 'Exact glue-on results' : `${selection} number kit`;
  const characters: { key: ResultKey; character: string }[] = [];
  if (selection === 'exact') {
    validateResults(design, keys);
    keys.forEach((key) => {
      const value = key === 'pace' ? paceText(design) : design[key];
      [...value].forEach((character) => characters.push({ key, character }));
    });
  } else {
    for (const character of kitCharacters) {
      const count = counts[character];
      if (!Number.isInteger(count) || count < 0 || count > 20) throw new Error('Choose 0–20 copies of each kit character.');
      for (let i = 0; i < count; i++) characters.push({ key: selection, character });
    }
  }
  if (!characters.length) throw new Error('Choose at least one kit character.');
  const templates = new Map([...kitCharacters].map((character) => [character, text(font, character, 3.4, Infinity, 0, 0, 0)]));
  const widest = Math.max(...[...templates.values()].map((geometry) => geometry.boundingBox!.max.x - geometry.boundingBox!.min.x));
  const scale = Math.min(1, 2 / widest);
  try {
    characters.forEach(({ key, character }, i) => {
      const glyph = new Group();
      glyph.name = `${key} ${character === ':' ? 'colon' : `digit ${character}`} copy ${i + 1}`;
      // One shared scale preserves digit proportions; 4 + 10 * 2.4 mm fits the BIB field.
      const geometry = templates.get(character)!.clone();
      geometry.scale(scale, scale, 1);
      glyph.add(part(glyph.name, geometry, design.colours[key]));
      glyph.position.set((i % 20) * 5, Math.floor(i / 20) * 8, 0);
      group.add(glyph);
    });
  } finally {
    templates.forEach((geometry) => geometry.dispose());
  }
  return group;
}

export function normalizeBase(geometry: BufferGeometry): BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const center = box.getCenter(new Vector3());
  geometry.translate(-center.x, -center.y, -box.min.z);
  return geometry;
}

export function makeRoutePreview(track: Track, colour: string, baseColour: string, frame?: Frame): Group {
  const group = new Group();
  group.name = 'GPX schematic — no geographic detail';
  const base = new BoxGeometry(MAP_WIDTH, MAP_HEIGHT, 2);
  base.translate(0, 0, 1);
  group.add(part('Schematic tile', base, baseColour));
  const geometries: BufferGeometry[] = [];
  for (const segment of clipPolylines(projectTrack(track, frame), MAP_WIDTH / 2, MAP_HEIGHT / 2)) {
    // At most about 2,000 rendered links; original GPX remains unchanged for export.
    const step = Math.max(1, Math.ceil(segment.length / 2000));
    const points = segment.filter((_, i) => i % step === 0 || i === segment.length - 1);
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i];
      const length = Math.hypot(bx - ax, by - ay);
      if (length < 0.005) continue;
      const link = new BoxGeometry(length, 1.1, 0.8);
      link.rotateZ(Math.atan2(by - ay, bx - ax));
      link.translate((ax + bx) / 2, (ay + by) / 2, 2.4);
      geometries.push(link);
      const joint = new CylinderGeometry(0.55, 0.55, 0.8, 8);
      joint.rotateX(Math.PI / 2);
      joint.translate(bx, by, 2.4);
      geometries.push(joint);
    }
  }
  if (geometries.length) {
    const merged = mergeGeometries(geometries);
    if (!merged) throw new Error('Unable to build route preview.');
    group.add(part('Route preview', merged, colour));
    geometries.forEach((g) => g.dispose());
  }
  return group;
}

/**
 * Places a map flat on Z=0, centred. Maps that already fit the frame tile keep their size; larger maps are
 * shrunk to fit the tile and maps smaller than the visible window are enlarged to fill it (aspect preserved).
 */
export function fitMap(group: Group): { width: number; height: number; depth: number } {
  group.updateMatrixWorld(true);
  const box = new Box3().setFromObject(group);
  const size = box.getSize(new Vector3());
  if (![size.x, size.y, size.z].every(Number.isFinite) || size.x <= 0 || size.y <= 0 || size.z <= 0) throw new Error('The map must contain a solid, finite 3D model with Z pointing up.');
  const tolerance = 1.0005;
  let scale = 1;
  if (size.x > MAP_TILE_WIDTH * tolerance || size.y > MAP_TILE_HEIGHT * tolerance) scale = Math.min(MAP_TILE_WIDTH / size.x, MAP_TILE_HEIGHT / size.y);
  else if (size.x < MAP_WIDTH / tolerance && size.y < MAP_HEIGHT / tolerance) scale = Math.min(MAP_WIDTH / size.x, MAP_HEIGHT / size.y);
  const center = box.getCenter(new Vector3());
  group.scale.multiplyScalar(scale);
  group.position.set(-center.x * scale, -center.y * scale, -box.min.z * scale);
  group.updateMatrixWorld(true);
  return { width: size.x * scale, height: size.y * scale, depth: size.z * scale };
}

/** True when a map's footprint is too small for the frame's side lips to hold it. */
export function needsMountingRim(dimensions: { width: number; height: number }): boolean {
  return dimensions.width < MAP_TILE_WIDTH - 2 || dimensions.height < MAP_TILE_HEIGHT - 2;
}

/**
 * Flat ring from the map's footprint (with 0.5 mm overlap) out to the full frame tile, thin enough to slide
 * under the frame lip. Returned as triangle positions so callers can merge it into a base part.
 */
export function mountingRimGeometry(innerWidth: number, innerHeight: number, thickness = 1.6): BufferGeometry {
  const t = Math.min(thickness, MAP_RIM_MAX_THICKNESS);
  const ow = MAP_TILE_WIDTH / 2, oh = MAP_TILE_HEIGHT / 2;
  const iw = Math.min(innerWidth / 2 - 0.5, ow - 1), ih = Math.min(innerHeight / 2 - 0.5, oh - 1);
  const pieces = [
    [-ow, ih, ow, oh], [-ow, -oh, ow, -ih], // top and bottom strips
    [-ow, -ih, -iw, ih], [iw, -ih, ow, ih], // sides
  ].map(([x0, y0, x1, y1]) => {
    const box = new BoxGeometry(x1 - x0, y1 - y0, t);
    box.translate((x0 + x1) / 2, (y0 + y1) / 2, t / 2);
    return box.toNonIndexed();
  });
  const merged = mergeGeometries(pieces)!;
  pieces.forEach((g) => g.dispose());
  return merged;
}

/** Adds a mounting rim part to an already fitted map when it is smaller than the frame tile. */
export function addMountingRim(group: Group, dimensions: { width: number; height: number }, colour = '#c9c7bc'): boolean {
  if (!needsMountingRim(dimensions)) return false;
  const rim = part('Mounting rim', mountingRimGeometry(dimensions.width, dimensions.height), colour);
  // The fitted group is scaled; add the rim in world units by compensating for the group transform.
  group.updateMatrixWorld(true);
  rim.applyMatrix4(group.matrixWorld.clone().invert());
  group.add(rim);
  return true;
}

/** Clips polylines to an axis-aligned rectangle centred on the origin. */
export function clipPolylines(lines: [number, number][][], halfWidth: number, halfHeight: number): [number, number][][] {
  const out: [number, number][][] = [];
  for (const line of lines) {
    let current: [number, number][] = [];
    for (let i = 1; i < line.length; i++) {
      const clipped = clipSegment(line[i - 1], line[i], halfWidth, halfHeight);
      if (!clipped) { if (current.length > 1) out.push(current); current = []; continue; }
      const [a, b] = clipped;
      const last = current.at(-1);
      if (!last || last[0] !== a[0] || last[1] !== a[1]) { if (current.length > 1) out.push(current); current = [a]; }
      current.push(b);
    }
    if (current.length > 1) out.push(current);
  }
  return out;
}

function clipSegment(a: [number, number], b: [number, number], hw: number, hh: number): [[number, number], [number, number]] | undefined {
  // Liang–Barsky.
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, a[0] + hw], [dx, hw - a[0]], [-dy, a[1] + hh], [dy, hh - a[1]]]) {
    if (p === 0) { if (q < 0) return undefined; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return undefined; if (r > t0) t0 = r; } else { if (r < t0) return undefined; if (r < t1) t1 = r; }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}

export function disposeGroup(group: Group): void {
  group.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

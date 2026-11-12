// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Box3, BufferGeometry, Vector3 } from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { strFromU8, unzipSync } from 'fflate';
import { MAP_HEIGHT, MAP_MAX_DEPTH, MAP_RIM_MAX_THICKNESS, MAP_TILE_HEIGHT, MAP_TILE_WIDTH, MAP_WIDTH } from './dimensions';
import { FrameProjection, bestFrameForPoints, frameForPoints, inverseMercator, mercator, validateFrame } from './projection';
import type { LonLat } from './projection';
import { clipLine, clipPolygon, rectangle, signedArea, simplifyLine } from './map/geometry2d';
import { defaultMapOptions, elevationGridShape, emptyFeatures, generateMap, MAX_GENERATED_TRIANGLES, roadClassesFor, validateMapOptions } from './map/generate';
import type { MapFeatures } from './map/generate';
import { terrariumElevation, tilesCovering, vectorZoom } from './map/tiles';
import { buildGroup } from './map/client';
import { export3mf } from './export';
import { decodeShare, encodeShare, sanitize } from './persist';
import { distanceText, initialDesign, paceText } from './data';
import { addMountingRim, disposeGroup, fitMap, makePlate, normalizeBase, part } from './geometry';
import { Group, BoxGeometry } from 'three';

const oslo: LonLat = [10.7522, 59.9139];

function edgeCounts(positions: Float32Array): Map<string, number> {
  const key = (i: number) => [positions[i], positions[i + 1], positions[i + 2]].map((n) => n.toFixed(4)).join(',');
  const edges = new Map<string, number>();
  for (let t = 0; t < positions.length; t += 9) {
    const v = [key(t), key(t + 3), key(t + 6)];
    for (let i = 0; i < 3; i++) {
      const a = v[i], b = v[(i + 1) % 3];
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(id, (edges.get(id) ?? 0) + 1);
    }
  }
  return edges;
}

function bounds(positions: Float32Array) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], positions[i + a]); max[a] = Math.max(max[a], positions[i + a]); }
  return { min, max };
}

describe('frame projection', () => {
  it('round-trips mercator and local millimetres, including rotation', () => {
    const [x, y] = mercator(oslo);
    const [lon, lat] = inverseMercator([x, y]);
    expect(lon).toBeCloseTo(oslo[0], 9);
    expect(lat).toBeCloseTo(oslo[1], 9);
    for (const rotationDeg of [0, 37, -90, 180]) {
      const projection = new FrameProjection({ center: oslo, widthMeters: 10_000, rotationDeg });
      const point: LonLat = [10.79, 59.93];
      const [mx, my] = projection.toLocal(point);
      const back = projection.toLonLat(mx, my);
      expect(back[0]).toBeCloseTo(point[0], 8);
      expect(back[1]).toBeCloseTo(point[1], 8);
      expect(projection.toLocal(oslo).map((n) => Math.abs(n))).toEqual([expect.closeTo(0, 6), expect.closeTo(0, 6)]);
    }
  });
  it('scales ground distance to the 133 mm window and rotates the frame clockwise', () => {
    const projection = new FrameProjection({ center: oslo, widthMeters: 13_300, rotationDeg: 0 });
    expect(projection.mmPerMeter).toBeCloseTo(0.01, 10);
    // ~1 km east of the centre is ~10 mm right of centre.
    const east = projection.toLocal([oslo[0] + 1000 / (111_320 * Math.cos((oslo[1] * Math.PI) / 180)), oslo[1]]);
    expect(east[0]).toBeCloseTo(10, 0);
    const rotated = new FrameProjection({ center: oslo, widthMeters: 13_300, rotationDeg: 90 });
    const [x, y] = rotated.toLocal([oslo[0] + 0.01, oslo[1]]);
    expect(y).toBeGreaterThan(0); // With the frame top facing east, east is up.
    expect(Math.abs(x)).toBeLessThan(1e-6);
  });
  it('fits points inside the window with padding and prefers the orientation that fills it best', () => {
    const tall: LonLat[] = [[10.70, 59.80], [10.72, 60.00]];
    const frame = frameForPoints(tall, 0, 0.08);
    const projection = new FrameProjection(frame);
    for (const point of tall) expect(projection.contains(point)).toBe(true);
    expect(Math.abs(projection.toLocal(tall[1])[1])).toBeCloseTo(MAP_HEIGHT / 2 / 1.16, 0);
    const best = bestFrameForPoints(tall);
    expect(Math.abs(best.rotationDeg)).toBe(90);
    expect(best.widthMeters).toBeLessThan(frame.widthMeters);
    for (const point of tall) expect(new FrameProjection(best).contains(point)).toBe(true);
  });
  it('rejects invalid frames', () => {
    expect(() => validateFrame({ center: [NaN, 0], widthMeters: 5000, rotationDeg: 0 })).toThrow();
    expect(() => validateFrame({ center: oslo, widthMeters: 10, rotationDeg: 0 })).toThrow('between');
    expect(() => validateFrame({ center: [0, 89], widthMeters: 5000, rotationDeg: 0 })).toThrow();
    expect(() => validateFrame({ center: oslo, widthMeters: 5000, rotationDeg: 10 })).not.toThrow();
  });
});

describe('2D clipping and simplification', () => {
  const window = rectangle(10, 5);
  it('clips polygons and holes to the window', () => {
    const clipped = clipPolygon([[[-20, -20], [20, -20], [20, 20], [-20, 20]], [[-1, -1], [-1, 1], [1, 1], [1, -1]]], window)!;
    expect(Math.abs(signedArea(clipped[0]))).toBeCloseTo(200, 6);
    expect(signedArea(clipped[0])).toBeGreaterThan(0);
    expect(signedArea(clipped[1])).toBeLessThan(0);
    expect(clipPolygon([[[30, 30], [40, 30], [40, 40]]], window)).toBeUndefined();
  });
  it('splits lines that leave and re-enter the window', () => {
    const pieces = clipLine([[-20, 0], [0, 0], [0, 20], [5, 20], [5, 0], [20, 0]], window);
    expect(pieces).toHaveLength(2);
    expect(pieces[0][0]).toEqual([-10, 0]);
    expect(pieces[1].at(-1)).toEqual([10, 0]);
  });
  it('simplifies nearly straight lines', () => {
    expect(simplifyLine([[0, 0], [1, 0.001], [2, 0], [3, 2]], 0.01)).toEqual([[0, 0], [2, 0], [3, 2]]);
  });
});

function features(): MapFeatures {
  const f = emptyFeatures();
  f.water.push([[[-80, -80], [-20, -80], [-20, -30], [-80, -30]]]); // partly outside the window
  f.parks.push([[[10, 10], [30, 10], [30, 30], [10, 30]], [[15, 15], [15, 20], [20, 20], [20, 15]]]);
  f.roads.push({ line: [[-70, 0], [0, 0], [10, 20], [70, 20]], kind: 'primary' }, { line: [[0, -40], [0, 40]], kind: 'path' });
  f.buildings.push({ polygon: [[[40, -20], [45, -20], [45, -15], [40, -15]]], heightM: 30 });
  return f;
}

describe('in-browser map generator', () => {
  const route = [[[-50, -40], [0, 0], [50, 40]] as [number, number][]];
  it('builds named parts on a flat tile that slides under the frame lip', () => {
    const options = defaultMapOptions();
    options.layers.terrain = false;
    options.layers.buildings = true;
    const result = generateMap(features(), route, MAP_WIDTH / 3000, options);
    expect(result.parts.map((p) => p.name)).toEqual(['Map base', 'Water', 'Parks', 'Roads', 'Buildings', 'Route']);
    expect(result.parts.find((p) => p.name === 'Route')!.route).toBe(true);
    const base = bounds(result.parts[0].positions);
    expect(base.max[0] - base.min[0]).toBeCloseTo(MAP_TILE_WIDTH, 3);
    expect(base.max[1] - base.min[1]).toBeCloseTo(MAP_TILE_HEIGHT, 3);
    expect(base.max[2]).toBeCloseTo(options.baseThickness, 5);
    expect(base.min[2]).toBe(0);
    for (const part of result.parts.slice(1)) {
      const b = bounds(part.positions);
      expect(b.min[0]).toBeGreaterThanOrEqual(-MAP_WIDTH / 2 - 0.8);
      expect(b.max[1]).toBeLessThanOrEqual(MAP_HEIGHT / 2 + 0.8);
    }
    expect(result.depth).toBeLessThanOrEqual(MAP_MAX_DEPTH);
    // Watertight base and simple prisms: every edge is shared by exactly two triangles.
    for (const name of ['Map base', 'Water', 'Parks']) {
      const counts = [...edgeCounts(result.parts.find((p) => p.name === name)!.positions).values()];
      expect(counts.every((n) => n === 2), name).toBe(true);
    }
  });
  it('drops narrow streets on large areas', () => {
    expect(roadClassesFor(3000).has('path')).toBe(true);
    expect(roadClassesFor(30_000).has('minor')).toBe(false);
    const options = defaultMapOptions();
    options.layers.terrain = false;
    const small = generateMap(features(), [], MAP_WIDTH / 3000, options);
    const large = generateMap(features(), [], MAP_WIDTH / 30_000, options);
    const roads = (r: typeof small) => r.parts.find((p) => p.name === 'Roads')!.positions.length;
    expect(roads(large)).toBeLessThan(roads(small));
  });
  it('fits terrain into the depth budget and keeps the rim thin', () => {
    const shape = elevationGridShape();
    const values = new Float32Array(shape.cols * shape.rows);
    for (let j = 0; j < shape.rows; j++) for (let i = 0; i < shape.cols; i++) values[j * shape.cols + i] = 400 * Math.sin(i / 15) * Math.cos(j / 20) + 400;
    const options = defaultMapOptions();
    options.terrainExaggeration = 20;
    const result = generateMap(features(), route, MAP_WIDTH / 5000, options, { cols: shape.cols, rows: shape.rows, values });
    expect(result.depth).toBeLessThanOrEqual(MAP_MAX_DEPTH + 1e-6);
    expect(result.terrainExaggeration).toBeLessThan(20);
    expect(result.warnings.join(' ')).toContain('relief reduced');
    const base = result.parts[0].positions;
    const counts = [...edgeCounts(base).values()];
    // Terrain solid plus four rim boxes; each shell is closed.
    expect(counts.filter((n) => n !== 2 && n !== 4)).toHaveLength(0);
    for (let i = 0; i < base.length; i += 3) {
      if (Math.abs(base[i]) > MAP_WIDTH / 2 + 0.01 || Math.abs(base[i + 1]) > MAP_HEIGHT / 2 + 0.01) expect(base[i + 2]).toBeLessThanOrEqual(MAP_RIM_MAX_THICKNESS);
    }
    expect(() => generateMap(features(), route, MAP_WIDTH / 5000, options, { cols: 3, rows: 3, values: new Float32Array(9) })).toThrow('Elevation grid');
  });
  it('warns when the route leaves the frame and validates options', () => {
    const options = defaultMapOptions();
    options.layers.terrain = false;
    const result = generateMap(emptyFeatures(), [[[0, 0], [200, 0]]], 1, options);
    expect(result.warnings.join(' ')).toMatch(/% of the route falls outside/);
    for (const change of [{ baseThickness: 2 }, { roadScale: 3 }, { terrainExaggeration: 0 }, { buildingScale: 9 }]) {
      expect(() => validateMapOptions({ ...defaultMapOptions(), ...change })).toThrow();
    }
    expect(() => validateMapOptions({ ...defaultMapOptions(), layers: { roads: false, water: false, parks: false, buildings: false, terrain: false, route: false } })).toThrow('at least one');
    expect(MAX_GENERATED_TRIANGLES).toBeGreaterThan(1_000_000);
  });
  it('exports generated parts as a named, coloured multipart 3MF with credits', () => {
    const options = defaultMapOptions();
    options.layers.terrain = false;
    const result = generateMap(features(), route, MAP_WIDTH / 3000, options);
    const { group, meshes } = buildGroup(result.parts, '#ff0000');
    expect(meshes.find((m) => m.name === 'Route')!.userData.route).toBe(true);
    const files = unzipSync(export3mf(group, undefined, 'Map data © OpenStreetMap contributors'));
    const xml = strFromU8(files['3D/3dmodel.model']);
    for (const name of ['Map base', 'Water', 'Parks', 'Roads', 'Route']) expect(xml).toContain(`name="${name}"`);
    expect(xml).toContain('#FF0000FF');
    expect(strFromU8(files['Metadata/CREDITS.txt'])).toContain('OpenStreetMap');
    disposeGroup(group);
  });
});

describe('map tiles', () => {
  it('decodes Terrarium elevation', () => {
    expect(terrariumElevation(128, 0, 0)).toBe(0);
    expect(terrariumElevation(128, 100, 128)).toBe(100.5);
  });
  it('covers the window with a bounded number of tiles', () => {
    const projection = new FrameProjection({ center: oslo, widthMeters: 8000, rotationDeg: 30 });
    const zoom = vectorZoom(projection);
    expect(tilesCovering(projection, zoom).length).toBeLessThanOrEqual(36);
    expect(zoom).toBeGreaterThanOrEqual(12);
    expect(vectorZoom(new FrameProjection({ center: oslo, widthMeters: 120_000, rotationDeg: 0 }))).toBeLessThan(zoom);
  });
});

describe('imported map fitting', () => {
  it('keeps maps that fit the tile at 1:1, enlarges tiny maps to the window and adds a rim when needed', () => {
    const make = (w: number, h: number) => { const g = new Group(); g.add(part('Map', new BoxGeometry(w, h, 3), '#cccccc')); return g; };
    const exact = make(133, 117);
    const fitted = fitMap(exact);
    expect(fitted.width).toBeCloseTo(133, 4);
    expect(addMountingRim(exact, fitted)).toBe(true);
    const box = new Box3().setFromObject(exact).getSize(new Vector3());
    expect(box.x).toBeCloseTo(MAP_TILE_WIDTH, 3);
    expect(box.y).toBeCloseTo(MAP_TILE_HEIGHT, 3);
    const tiny = make(66.5, 40);
    expect(fitMap(tiny).width).toBeCloseTo(133, 3);
    const full = make(141, 120.91);
    const fullFit = fitMap(full);
    expect(addMountingRim(full, fullFit)).toBe(false);
    [exact, tiny, full].forEach(disposeGroup);
  });
});

describe('saved designs and share links', () => {
  it('round-trips a design, map style and frame through a share link', () => {
    const design = initialDesign();
    design.title = 'BØRGEN ÅS';
    design.units = 'imperial';
    const mapOptions = defaultMapOptions();
    mapOptions.layers.buildings = true;
    const state = { design, mapOptions, frame: { center: oslo, widthMeters: 5000, rotationDeg: 45 }, courseId: 'boston-osm-marathon' };
    expect(decodeShare(encodeShare(state))).toEqual(state);
  });
  it('drops malformed or hostile values instead of trusting them', () => {
    const result = sanitize({ design: { title: 'x'.repeat(500), raceId: 'nowhere', colours: { base: 'red; background:url(x)' }, font: 'comic', placements: { time: 'everywhere' } }, mapOptions: { baseThickness: 9 }, frame: { center: [500, 0], widthMeters: 1, rotationDeg: 0 }, courseId: '../../x' });
    const defaults = initialDesign();
    expect(result.design.title).toBe(defaults.title);
    expect(result.design.raceId).toBe(defaults.raceId);
    expect(result.design.colours.base).toBe(defaults.colours.base);
    expect(result.design.font).toBe(defaults.font);
    expect(result.design.placements.time).toBe('attached');
    expect(result.mapOptions.baseThickness).toBe(1.6);
    expect(result.frame).toBeUndefined();
    expect(result.courseId).toBeUndefined();
    expect(decodeShare('#s=not-base64!!')).toBeUndefined();
  });
});

describe('plate units and fonts', () => {
  const load = (file: string) => new FontLoader().parse(JSON.parse(readFileSync(`public/generated/fonts/${file}`, 'utf8')));
  const stl = readFileSync('public/generated/plate-base.stl');
  const base = normalizeBase(new STLLoader().parse(stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength)) as BufferGeometry);
  it('prints miles and pace per mile for imperial plates', () => {
    const design = initialDesign();
    design.units = 'imperial';
    expect(distanceText(design)).toBe('26.2MI');
    expect(paceText(design)).toBe('8:29');
    const plate = makePlate(design, load('helvetiker_bold.typeface.json'), base);
    expect(plate.getObjectByName('pace label')).toBeDefined();
    disposeGroup(plate);
  });
  it('supports Nordic and accented letters with the Droid fonts', () => {
    const design = initialDesign();
    design.title = 'TRONDHEIM ÆØÅ';
    design.location = 'TROMSØ · MÜNCHEN · ZÜRICH';
    expect(() => makePlate(design, load('helvetiker_bold.typeface.json'), base)).toThrow('Droid');
    for (const file of ['droid_sans_bold.typeface.json', 'droid_serif_bold.typeface.json']) {
      const plate = makePlate(design, load(file), base);
      const box = new Box3().setFromObject(plate);
      expect(box.max.z).toBeCloseTo(4.3, 4);
      expect(box.getSize(new Vector3()).x).toBeCloseTo(143, 3);
      disposeGroup(plate);
    }
  });
});

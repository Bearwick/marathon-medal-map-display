import { classifyRings, VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { MAP_HEIGHT, MAP_WIDTH } from '../dimensions';
import { FrameProjection, MERCATOR_CIRCUMFERENCE } from '../projection';
import type { ElevationGrid, MapFeatures, MapLayers, RoadClass } from './generate';
import { elevationGridShape, emptyFeatures } from './generate';
import type { Polygon, Ring } from './geometry2d';
import { clipLine, clipPolygon, orient } from './geometry2d';

export const VECTOR_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const MAX_VECTOR_TILES = 36;
export const MAX_TERRAIN_TILES = 16;

export const ATTRIBUTION = [
  'Map data © OpenStreetMap contributors, Open Database License 1.0 (https://www.openstreetmap.org/copyright).',
  'Vector tiles: OpenMapTiles schema (https://openmaptiles.org/) served by OpenFreeMap (https://openfreemap.org/).',
  'Terrain: Terrain Tiles on AWS Open Data (Mapzen/Tilezen; sources include SRTM, GMTED2010, ETOPO1 and national datasets — https://github.com/tilezen/joerd/blob/master/docs/attribution.md).',
].join('\n');

type Progress = (message: string) => void;

export interface TileId { z: number; x: number; y: number }

const C = MERCATOR_CIRCUMFERENCE;

/** Tiles at zoom z covering the map window. */
export function tilesCovering(projection: FrameProjection, z: number): TileId[] {
  const n = 2 ** z;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => projection.toMercator((sx * MAP_WIDTH) / 2, (sy * MAP_HEIGHT) / 2));
  const tx = corners.map(([mx]) => ((mx + C / 2) / C) * n), ty = corners.map(([, my]) => ((C / 2 - my) / C) * n);
  const tiles: TileId[] = [];
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, v));
  for (let y = clamp(Math.floor(Math.min(...ty))); y <= clamp(Math.floor(Math.max(...ty))); y++) {
    for (let x = Math.floor(Math.min(...tx)); x <= Math.floor(Math.max(...tx)); x++) tiles.push({ z, x: ((x % n) + n) % n, y });
  }
  return tiles;
}

export function vectorZoom(projection: FrameProjection): number {
  for (let z = 14; z > 8; z--) if (tilesCovering(projection, z).length <= MAX_VECTOR_TILES) return z;
  return 8;
}

async function fetchBytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer | undefined> {
  const response = await fetch(url, { signal });
  if (response.status === 204 || response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Map data request failed (${response.status}). Try again later.`);
  return response.arrayBuffer();
}

async function inBatches<T, R>(items: T[], size: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) results.push(...await Promise.all(items.slice(i, i + size).map(task)));
  return results;
}

const roadClass: Record<string, RoadClass> = {
  motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary',
  minor: 'minor', service: 'service', track: 'path', path: 'path', pedestrian: 'path',
};

/** Decodes one OpenMapTiles vector tile into map-millimetre features clipped to that tile (avoids duplicates). */
export function decodeVectorTile(data: ArrayBuffer, tile: TileId, projection: FrameProjection, layers: MapLayers, into: MapFeatures): void {
  const vt = new VectorTile(new Pbf(new Uint8Array(data)));
  const n = 2 ** tile.z;
  const toMm = (extent: number) => (px: number, py: number): [number, number] =>
    projection.fromMercator(((tile.x + px / extent) / n) * C - C / 2, C / 2 - ((tile.y + py / extent) / n) * C);
  const tileMm = toMm(1);
  const clip = orient([[0, 0], [1, 0], [1, 1], [0, 1]].map(([px, py]) => tileMm(px, py)), true);
  const each = (name: string, handle: (rings: [number, number][][], type: number, properties: Record<string, unknown>) => void) => {
    const layer = vt.layers[name];
    if (!layer) return;
    const convert = toMm(layer.extent);
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const rings = feature.loadGeometry().map((ring) => ring.map((p) => convert(p.x, p.y)));
      handle(rings, feature.type, feature.properties as Record<string, unknown>);
    }
  };
  const polygonsOf = (rings: [number, number][][]): Polygon[] => {
    // classifyRings works on winding, which is preserved (mirrored consistently) by our transform.
    const fake = rings.map((ring) => ring.map(([x, y]) => ({ x, y })));
    return classifyRings(fake as never).map((polygon) => polygon.map((ring) => ring.map((p) => [p.x, p.y] as [number, number])))
      .map((polygon) => clipPolygon(polygon as Ring[], clip, 1e-4)).filter((p): p is Polygon => !!p);
  };
  const linesOf = (rings: [number, number][][]) => rings.flatMap((line) => clipLine(line, clip));

  if (layers.water) {
    each('water', (rings, type, props) => { if (type === 3 && props.brunnel !== 'tunnel') into.water.push(...polygonsOf(rings)); });
    each('waterway', (rings, type, props) => {
      if (type === 2 && (props.class === 'river' || props.class === 'canal') && props.brunnel !== 'tunnel') into.waterways.push(...linesOf(rings));
    });
  }
  if (layers.parks) {
    each('park', (rings, type) => { if (type === 3) into.parks.push(...polygonsOf(rings)); });
    each('landcover', (rings, type, props) => { if (type === 3 && (props.class === 'wood' || props.subclass === 'park' || props.subclass === 'garden')) into.parks.push(...polygonsOf(rings)); });
  }
  if (layers.roads) {
    each('transportation', (rings, type, props) => {
      const kind = roadClass[String(props.class)];
      if (type !== 2 || !kind || props.brunnel === 'tunnel') return;
      for (const line of linesOf(rings)) into.roads.push({ line, kind });
    });
  }
  if (layers.buildings) {
    each('building', (rings, type, props) => {
      if (type !== 3 || props.hide_3d === true) return;
      const heightM = Number(props.render_height) || 8;
      for (const polygon of polygonsOf(rings)) into.buildings.push({ polygon, heightM });
    });
  }
}

let tileTemplate: string | undefined;

export async function fetchFeatures(projection: FrameProjection, layers: MapLayers, progress: Progress, signal?: AbortSignal): Promise<{ features: MapFeatures; zoom: number }> {
  const features = emptyFeatures();
  if (!layers.roads && !layers.water && !layers.parks && !layers.buildings) return { features, zoom: 0 };
  if (!tileTemplate) {
    const response = await fetch(VECTOR_TILEJSON, { signal });
    if (!response.ok) throw new Error('Map data is unavailable right now. Try again later.');
    const json = await response.json() as { tiles?: unknown[] };
    if (typeof json.tiles?.[0] !== 'string' || !json.tiles[0].startsWith('https://')) throw new Error('Unexpected map data service response.');
    tileTemplate = json.tiles[0];
  }
  const zoom = vectorZoom(projection);
  const tiles = tilesCovering(projection, zoom);
  let done = 0;
  await inBatches(tiles, 6, async (tile) => {
    const data = await fetchBytes(tileTemplate!.replace('{z}', String(tile.z)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y)), signal);
    if (data) decodeVectorTile(data, tile, projection, layers, features);
    progress(`Downloading map data… ${++done}/${tiles.length} tiles`);
  });
  return { features, zoom };
}

/** Decodes Terrarium RGB into metres. */
export function terrariumElevation(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export function terrainZoom(projection: FrameProjection, latitude: number): number {
  const metresPerMm = 1 / projection.mmPerMeter;
  let z = Math.ceil(Math.log2((C * Math.cos((latitude * Math.PI) / 180)) / (256 * metresPerMm)));
  z = Math.max(1, Math.min(14, z));
  while (z > 1 && tilesCovering(projection, z).length > MAX_TERRAIN_TILES) z--;
  return z;
}

async function decodePng(data: ArrayBuffer): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(new Blob([data], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Terrain decoding is not supported in this browser.');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

export async function fetchElevation(projection: FrameProjection, progress: Progress, signal?: AbortSignal): Promise<ElevationGrid> {
  const z = terrainZoom(projection, projection.frame.center[1]);
  const tiles = tilesCovering(projection, z);
  const pixels = new Map<string, Uint8ClampedArray>();
  let done = 0;
  await inBatches(tiles, 6, async (tile) => {
    const data = await fetchBytes(TERRAIN_TILES.replace('{z}', String(tile.z)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y)), signal);
    if (!data) throw new Error('Terrain data is missing for this area. Turn off terrain and try again.');
    pixels.set(`${tile.x}/${tile.y}`, await decodePng(data));
    progress(`Downloading terrain… ${++done}/${tiles.length} tiles`);
  });
  const n = 2 ** z, size = 256 * n;
  const at = (gx: number, gy: number): number => {
    const x = ((Math.floor(gx) % size) + size) % size, y = Math.max(0, Math.min(size - 1, Math.floor(gy)));
    const tile = pixels.get(`${Math.floor(x / 256)}/${Math.floor(y / 256)}`);
    if (!tile) return 0;
    const k = ((y % 256) * 256 + (x % 256)) * 4;
    return terrariumElevation(tile[k], tile[k + 1], tile[k + 2]);
  };
  const shape = elevationGridShape();
  const values = new Float32Array(shape.cols * shape.rows);
  for (let j = 0; j < shape.rows; j++) {
    for (let i = 0; i < shape.cols; i++) {
      const [mx, my] = projection.toMercator(shape.x0 + i * shape.dx, shape.y0 + j * shape.dy);
      const gx = ((mx + C / 2) / C) * size - 0.5, gy = ((C / 2 - my) / C) * size - 0.5;
      const x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx - x0, ty = gy - y0;
      values[j * shape.cols + i] = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    }
  }
  return { cols: shape.cols, rows: shape.rows, values };
}

export function frameProjection(frame: ConstructorParameters<typeof FrameProjection>[0]): FrameProjection {
  return new FrameProjection(frame, MAP_WIDTH, MAP_HEIGHT);
}

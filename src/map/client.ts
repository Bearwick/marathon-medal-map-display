import { BufferGeometry, Float32BufferAttribute, Group } from 'three';
import { MAP_TILE_HEIGHT, MAP_TILE_WIDTH } from '../dimensions';
import { part } from '../geometry';
import type { ImportedMap } from '../import';
import type { Frame, LonLat } from '../projection';
import type { GeneratedPart, MapOptions } from './generate';
import { ATTRIBUTION } from './tiles';
import type { GenerateRequest, WorkerMessage } from './worker';

let worker: Worker | undefined;
let nextId = 0;
let pending: { id: number; reject: (error: Error) => void } | undefined;

/** Identifies the inputs a generated map was built from, so the UI can tell when it is out of date. */
export function generationKey(frame: Frame, route: LonLat[][] | undefined, options: MapOptions, _routeColour?: string): string {
  // Colours are excluded: they are applied to the existing parts without regenerating.
  const { colours: _colours, ...shape } = options;
  return JSON.stringify({ frame, shape, points: route?.reduce((n, s) => n + s.length, 0) ?? 0, first: route?.[0]?.[0], last: route?.at(-1)?.at(-1) });
}

export function cancelGeneration(): void {
  if (pending) {
    pending.reject(new Error('Map generation cancelled.'));
    pending = undefined;
    worker?.terminate();
    worker = undefined;
  }
}

export function buildGroup(parts: GeneratedPart[], routeColour: string): { group: Group; meshes: ReturnType<typeof part>[] } {
  const group = new Group();
  group.name = 'Generated map';
  const meshes = parts.map((item) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(item.positions, 3));
    geometry.computeVertexNormals();
    const mesh = part(item.name, geometry, item.route ? routeColour : item.colour);
    if (item.route) mesh.userData.route = true;
    group.add(mesh);
    return mesh;
  });
  return { group, meshes };
}

export function generateMapInWorker(frame: Frame, route: LonLat[][] | undefined, options: MapOptions, routeColour: string, onProgress: (message: string) => void): Promise<ImportedMap> {
  cancelGeneration();
  worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const id = ++nextId;
  const active = worker;
  return new Promise<ImportedMap>((resolve, reject) => {
    pending = { id, reject };
    active.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === 'progress') { onProgress(message.message); return; }
      pending = undefined;
      if (message.type === 'error') { reject(new Error(message.message)); return; }
      const { result } = message;
      const { group, meshes } = buildGroup(result.parts, routeColour);
      const settings = JSON.stringify({ frame, options, vectorZoom: result.zoom, terrainExaggerationUsed: result.terrainExaggeration }, null, 2);
      resolve({
        group, source: undefined, parts: meshes,
        dimensions: { width: MAP_TILE_WIDTH, height: MAP_TILE_HEIGHT, depth: result.depth },
        generated: { attribution: ATTRIBUTION, settings, key: generationKey(frame, route, options, routeColour) },
        rim: true, warnings: result.warnings,
      });
    };
    active.onerror = (event) => { pending = undefined; reject(new Error(event.message || 'Map generation failed.')); };
    const request: GenerateRequest = { id, frame, route: route ?? [], options };
    active.postMessage(request);
  });
}

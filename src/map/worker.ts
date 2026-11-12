/// <reference lib="webworker" />
import { validateFrame } from '../projection';
import type { Frame, LonLat } from '../projection';
import type { MapOptions } from './generate';
import { generateMap } from './generate';
import { fetchElevation, fetchFeatures, frameProjection } from './tiles';

export interface GenerateRequest { id: number; frame: Frame; route: LonLat[][]; options: MapOptions }
export type WorkerMessage =
  | { id: number; type: 'progress'; message: string }
  | { id: number; type: 'done'; result: ReturnType<typeof generateMap> & { zoom: number } }
  | { id: number; type: 'error'; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<GenerateRequest>) => {
  const { id, frame, route, options } = event.data;
  const post = (message: WorkerMessage, transfer: Transferable[] = []) => scope.postMessage(message, transfer);
  try {
    validateFrame(frame);
    const projection = frameProjection(frame);
    const progress = (message: string) => post({ id, type: 'progress', message });
    const { features, zoom } = await fetchFeatures(projection, options.layers, progress);
    const elevation = options.layers.terrain ? await fetchElevation(projection, progress) : undefined;
    progress('Building printable geometry…');
    const lines = route.map((segment) => segment.map((point) => projection.toLocal(point)));
    const result = generateMap(features, lines, projection.mmPerMeter, options, elevation);
    post({ id, type: 'done', result: { ...result, zoom } }, result.parts.map((part) => part.positions.buffer));
  } catch (error) {
    post({ id, type: 'error', message: error instanceof Error ? error.message : 'Map generation failed.' });
  }
};

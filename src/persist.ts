import { distances, fonts, initialDesign, races } from './data';
import type { ColourKey, Design, Placement } from './data';
import type { MapOptions } from './map/generate';
import { defaultMapOptions } from './map/generate';
import type { Frame } from './projection';
import { MAX_FRAME_METERS, MIN_FRAME_METERS } from './projection';

/** What is saved locally and shared in links. Uploaded files are never included. */
export interface SavedState {
  design: Design;
  mapOptions: MapOptions;
  frame?: Frame;
  courseId?: string;
}

export const STORAGE_KEY = 'finishline:v1';
const HASH_PREFIX = '#s=';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isColour = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const str = (value: unknown, max: number): string | undefined => (typeof value === 'string' && value.length <= max ? value : undefined);
const num = (value: unknown, min: number, max: number): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined);

/** Merges untrusted saved data onto defaults, keeping only well-formed values. */
export function sanitize(value: unknown): SavedState {
  const design = initialDesign();
  const mapOptions = defaultMapOptions();
  const out: SavedState = { design, mapOptions };
  if (!isRecord(value)) return out;
  const d = isRecord(value.design) ? value.design : {};
  if (distances.some((item) => item.id === d.distanceId)) design.distanceId = String(d.distanceId);
  if (d.raceId === 'custom' || races.some((race) => race.id === d.raceId)) design.raceId = String(d.raceId);
  for (const [key, max] of [['customKm', 12], ['title', 40], ['location', 48], ['date', 10], ['time', 9], ['pace', 9], ['bib', 10]] as const) {
    const text = str(d[key], max);
    if (text !== undefined) design[key] = text;
  }
  if (typeof d.autoPace === 'boolean') design.autoPace = d.autoPace;
  if (d.units === 'metric' || d.units === 'imperial') design.units = d.units;
  if (fonts.some((font) => font.id === d.font)) design.font = d.font as Design['font'];
  if (isRecord(d.placements)) {
    for (const key of ['time', 'pace', 'bib'] as const) {
      const placement = d.placements[key];
      if (placement === 'attached' || placement === 'separate' || placement === 'hidden') design.placements[key] = placement as Placement;
    }
  }
  if (isRecord(d.colours)) {
    for (const key of Object.keys(design.colours) as ColourKey[]) if (isColour(d.colours[key])) design.colours[key] = d.colours[key] as string;
  }
  const m = isRecord(value.mapOptions) ? value.mapOptions : {};
  if (isRecord(m.layers)) for (const key of Object.keys(mapOptions.layers) as (keyof MapOptions['layers'])[]) if (typeof m.layers[key] === 'boolean') mapOptions.layers[key] = m.layers[key] as boolean;
  mapOptions.baseThickness = num(m.baseThickness, 1, 1.7) ?? mapOptions.baseThickness;
  mapOptions.roadScale = num(m.roadScale, 0.5, 2) ?? mapOptions.roadScale;
  mapOptions.terrainExaggeration = num(m.terrainExaggeration, 1, 20) ?? mapOptions.terrainExaggeration;
  mapOptions.buildingScale = num(m.buildingScale, 1, 6) ?? mapOptions.buildingScale;
  if (isRecord(m.colours)) for (const key of Object.keys(mapOptions.colours) as (keyof MapOptions['colours'])[]) if (isColour(m.colours[key])) mapOptions.colours[key] = m.colours[key] as string;
  const f = value.frame;
  if (isRecord(f) && Array.isArray(f.center) && f.center.length === 2) {
    const lon = num(f.center[0], -180, 180), lat = num(f.center[1], -85, 85);
    const width = num(f.widthMeters, MIN_FRAME_METERS, MAX_FRAME_METERS), rotation = num(f.rotationDeg, -180, 180);
    if (lon !== undefined && lat !== undefined && width !== undefined && rotation !== undefined) out.frame = { center: [lon, lat], widthMeters: width, rotationDeg: rotation };
  }
  if (typeof value.courseId === 'string' && /^[a-z0-9-]{1,80}$/.test(value.courseId)) out.courseId = value.courseId;
  return out;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function encodeShare(state: SavedState): string {
  return HASH_PREFIX + toBase64Url(JSON.stringify(state));
}

export function decodeShare(hash: string): SavedState | undefined {
  if (!hash.startsWith(HASH_PREFIX) || hash.length > 8000) return undefined;
  try { return sanitize(JSON.parse(fromBase64Url(hash.slice(HASH_PREFIX.length)))); } catch { return undefined; }
}

/** Shared link first, then this browser's autosave, then defaults. */
export function loadState(): { state: SavedState; from: 'link' | 'saved' | 'default' } {
  const shared = typeof location !== 'undefined' ? decodeShare(location.hash) : undefined;
  if (shared) return { state: shared, from: 'link' };
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { state: sanitize(JSON.parse(saved)), from: 'saved' };
  } catch { /* Storage can be unavailable (private mode); fall back to defaults. */ }
  return { state: sanitize(undefined), from: 'default' };
}

export function saveState(state: SavedState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Ignore unavailable storage. */ }
}

export function clearSavedState(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* Ignore unavailable storage. */ }
}

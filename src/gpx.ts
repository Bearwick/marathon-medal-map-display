import { FrameProjection, frameForPoints } from './projection';
import type { Frame, LonLat } from './projection';

export const MAX_GPX_MB = 12;
export const MAX_GPX_BYTES = MAX_GPX_MB * 1024 * 1024;
export const MAX_GPX_POINTS = 50_000;

export interface Track {
  name: string;
  segments: [number, number][][];
  km: number;
  points: number;
  xml: string;
}

export function parseGpx(xml: string, fallbackName: string): Track {
  if (xml.length > MAX_GPX_BYTES) throw new Error(`GPX files must be smaller than ${MAX_GPX_MB} MB.`);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('GPX files with document types or entities are not supported.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'gpx') throw new Error('This is not a valid GPX file.');
  const nodes = [...doc.getElementsByTagNameNS('*', 'trkseg'), ...doc.getElementsByTagNameNS('*', 'rte')];
  const segments: [number, number][][] = [];
  let points = 0;
  let km = 0;
  for (const node of nodes) {
    const segment: [number, number][] = [];
    for (const point of [...node.children].filter((el) => ['trkpt', 'rtept'].includes(el.localName))) {
      const lat = Number(point.getAttribute('lat'));
      const lon = Number(point.getAttribute('lon'));
      if (!point.hasAttribute('lat') || !point.hasAttribute('lon') || !point.getAttribute('lat')?.trim() || !point.getAttribute('lon')?.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        throw new Error('GPX contains an invalid latitude or longitude.');
      }
      if (++points > MAX_GPX_POINTS) throw new Error('Use a GPX with at most 50,000 points. Simplify your track before uploading.');
      const previous = segment.at(-1);
      if (previous) km += haversine(previous, [lat, lon]);
      segment.push([lat, lon]);
    }
    if (segment.length >= 2) segments.push(segment);
  }
  if (!segments.length || km < 0.001) throw new Error('GPX needs a track or route with at least two distinct points.');
  return { name: doc.getElementsByTagNameNS('*', 'name')[0]?.textContent?.trim() || fallbackName, segments, km, points, xml };
}

function haversine(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Track points as [longitude, latitude] pairs, per segment. */
export function trackLonLat(track: Track): LonLat[][] {
  return track.segments.map((segment) => segment.map(([lat, lon]): LonLat => [lon, lat]));
}

/** Projects the track into printed millimetres. Without a frame, a north-up frame is fitted to the track. */
export function projectTrack(track: Track, frame?: Frame): [number, number][][] {
  const segments = trackLonLat(track);
  const projection = new FrameProjection(frame ?? frameForPoints(segments.flat(), 0, 0.04));
  return segments.map((segment) => segment.map((point) => projection.toLocal(point)));
}

export interface Track {
  name: string;
  segments: [number, number][][];
  km: number;
  points: number;
  xml: string;
}

export function parseGpx(xml: string, fallbackName: string): Track {
  if (xml.length > 12 * 1024 * 1024) throw new Error('GPX files must be smaller than 12 MB.');
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
      if (++points > 50000) throw new Error('Use a GPX with at most 50,000 points. Simplify your track before uploading.');
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

export function projectTrack(track: Track): [number, number][][] {
  const points = track.segments.flat();
  const lat = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const anchor = points[0][1];
  const projected = track.segments.map((seg) => seg.map(([y, x]): [number, number] => {
    const wrapped = ((x - anchor + 540) % 360) - 180;
    return [wrapped * Math.cos(lat * Math.PI / 180), y - lat];
  }));
  const flat = projected.flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of flat) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const scale = Math.min(125 / Math.max(maxX - minX, 1e-8), 105 / Math.max(maxY - minY, 1e-8));
  return projected.map((seg) => seg.map(([x, y]) => [(x - (minX + maxX) / 2) * scale, (y - (minY + maxY) / 2) * scale]));
}

#!/usr/bin/env node
// Maintainer tool: export an OpenStreetMap route relation as a simplified, timestamp-free GPX.
// Usage: node scripts/osm-course-to-gpx.mjs <relationId> <out.gpx> [toleranceMetres=5]
// Data © OpenStreetMap contributors, available under the ODbL 1.0. Keep that attribution with the file.
import { writeFile } from 'node:fs/promises';

const [relationArg, out, toleranceArg = '5'] = process.argv.slice(2);
const relationId = Number(relationArg);
if (!Number.isInteger(relationId) || relationId <= 0 || !out) {
  console.error('Usage: node scripts/osm-course-to-gpx.mjs <relationId> <out.gpx> [toleranceMetres=5]');
  process.exit(1);
}
const tolerance = Number(toleranceArg);

const query = `[out:json][timeout:120];relation(${relationId});out body;way(r);out geom;`;
const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter'];
let data;
for (const [attempt, endpoint] of endpoints.entries()) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'finishline-course-tool/1.0' },
    body: new URLSearchParams({ data: query }),
  }).catch((error) => ({ ok: false, status: error.message }));
  if (response.ok) { data = await response.json(); break; }
  console.warn(`Overpass request to ${endpoint} failed (${response.status}); retrying…`);
  await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
}
if (!data) throw new Error('All Overpass requests failed. Try again later.');
const relation = data.elements.find((e) => e.type === 'relation' && e.id === relationId);
if (!relation) throw new Error(`Relation ${relationId} not found.`);
const ways = new Map(data.elements.filter((e) => e.type === 'way').map((e) => [e.id, e.geometry.map((p) => [p.lat, p.lon])]));

// Stitch member ways in relation order, reversing each way so it continues from the previous end.
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const segments = [];
let current = [];
let singleWay = false; // A segment made of one way may be oriented either way round.
for (const member of relation.members.filter((m) => m.type === 'way' && !/^(platform|stop)/.test(m.role))) {
  const points = ways.get(member.ref);
  if (!points || points.length < 2) continue;
  if (singleWay && !same(current.at(-1), points[0]) && !same(current.at(-1), points.at(-1))
    && (same(current[0], points[0]) || same(current[0], points.at(-1)))) current.reverse();
  const end = current.at(-1);
  if (end && same(points[0], end)) current.push(...points.slice(1));
  else if (end && same(points.at(-1), end)) current.push(...[...points].reverse().slice(1));
  else {
    if (current.length) segments.push(current);
    current = [...points];
    singleWay = true;
    continue;
  }
  singleWay = false;
}
if (current.length) segments.push(current);
if (!segments.length) throw new Error('The relation contains no usable ways.');

const R = 6371008.8;
const rad = Math.PI / 180;
function haversine(a, b) {
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}

// Members are not always ordered: greedily join the pieces whose ends are closest (≤ 50 m).
const MAX_GAP_M = 50;
for (;;) {
  let best;
  for (let i = 0; i < segments.length; i++) {
    for (let j = 0; j < segments.length; j++) {
      if (i === j) continue;
      for (const flipI of [false, true]) for (const flipJ of [false, true]) {
        const a = flipI ? segments[i][0] : segments[i].at(-1);
        const b = flipJ ? segments[j].at(-1) : segments[j][0];
        const gap = haversine(a, b);
        if (gap <= MAX_GAP_M && (!best || gap < best.gap)) best = { i, j, flipI, flipJ, gap };
      }
    }
  }
  if (!best) break;
  const a = best.flipI ? [...segments[best.i]].reverse() : segments[best.i];
  const b = best.flipJ ? [...segments[best.j]].reverse() : segments[best.j];
  const joined = [...a, ...(same(a.at(-1), b[0]) ? b.slice(1) : b)];
  segments.splice(Math.max(best.i, best.j), 1);
  segments.splice(Math.min(best.i, best.j), 1);
  segments.unshift(joined);
}
function simplify(points) {
  if (points.length < 3) return points;
  const lat0 = points[0][0] * rad;
  const xy = points.map(([lat, lon]) => [lon * rad * R * Math.cos(lat0), lat * rad * R]);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-12;
    let worst = -1, index = -1;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((xy[i][0] - ax) * dx + (xy[i][1] - ay) * dy) / len2));
      const d = Math.hypot(xy[i][0] - (ax + t * dx), xy[i][1] - (ay + t * dy));
      if (d > worst) { worst = d; index = i; }
    }
    if (worst > tolerance) { keep[index] = 1; stack.push([a, index], [index, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

const simplified = segments.map(simplify);
const km = simplified.reduce((sum, seg) => sum + seg.slice(1).reduce((s, p, i) => s + haversine(seg[i], p), 0), 0) / 1000;
const name = (relation.tags.name ?? `OSM relation ${relationId}`).replace(/[<>&"']/g, '');
const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="finishline osm-course-to-gpx" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>
    <copyright author="OpenStreetMap contributors"><license>https://opendatacommons.org/licenses/odbl/1-0/</license></copyright>
    <link href="https://www.openstreetmap.org/relation/${relationId}"><text>OpenStreetMap relation ${relationId}</text></link>
  </metadata>
  <trk>
    <name>${name}</name>
${simplified.map((seg) => `    <trkseg>\n${seg.map(([lat, lon]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"/>`).join('\n')}\n    </trkseg>`).join('\n')}
  </trk>
</gpx>
`;
await writeFile(out, gpx);
console.log(`${name}: ${segments.length} segment(s), ${simplified.reduce((n, s) => n + s.length, 0)} points, ${km.toFixed(3)} km → ${out}`);
if (segments.length > 1) console.warn('Warning: the relation has gaps or unordered members. Inspect the GPX before publishing.');

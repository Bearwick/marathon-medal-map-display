// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Box3, Group, Mesh, Vector3 } from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import type { Font } from 'three/addons/loaders/FontLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import type { BufferGeometry } from 'three';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { dateText, distances, initialDesign, kitCharacters, paceText, parseTime, validateDesign } from './data';
import { export3mf, exportStls } from './export';
import { disposeGroup, makeGlueCharacters, makePlate, normalizeBase } from './geometry';
import { parseGpx, projectTrack } from './gpx';
import { importMap, MAX_EXPANDED_MAP_BYTES, MAX_MAP_FILE_BYTES, MAX_MAP_TRIANGLES, validateExpandedMapSize, validateMapFileSize, validateMapTriangleCount } from './import';

let font: Font;
let base: BufferGeometry;
beforeAll(() => {
  font = new FontLoader().parse(JSON.parse(readFileSync('node_modules/three/examples/fonts/helvetiker_bold.typeface.json', 'utf8')));
  const file = readFileSync('public/generated/plate-base.stl');
  base = normalizeBase(new STLLoader().parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)));
});

function docFrom3mf(data: Uint8Array): Document {
  const files = unzipSync(data);
  return new DOMParser().parseFromString(strFromU8(files['3D/3dmodel.model']), 'application/xml');
}

describe('race details', () => {
  it('calculates pace from exact distance, including rounding across minutes', () => {
    const design = initialDesign();
    expect(paceText(design)).toBe('5:16');
    design.distanceId = '5k'; design.time = '00:29:59';
    expect(paceText(design)).toBe('6:00');
    design.autoPace = false; design.pace = '5:09';
    expect(paceText(design)).toBe('5:09');
  });
  it('rejects invalid numbers, time, BIB and dates', () => {
    expect(() => parseTime('03:99:00')).toThrow();
    expect(() => parseTime('00:00:00')).toThrow();
    expect(() => dateText('2026-02-30')).toThrow();
    expect(dateText('2024-02-29')).toBe('29 FEB 2024');
    const design = initialDesign();
    design.distanceId = 'custom'; design.customKm = 'NaN';
    expect(() => validateDesign(design)).toThrow('Distance');
    design.customKm = '42'; design.bib = '<script>';
    expect(() => validateDesign(design)).toThrow('BIB');
  });
  it('allows omitted result fields to be blank', () => {
    const design = initialDesign();
    design.placements = { time: 'hidden', pace: 'hidden', bib: 'hidden' };
    design.time = ''; design.pace = ''; design.bib = '';
    expect(() => validateDesign(design)).not.toThrow();
  });
});

describe('print geometry and output', () => {
  it('preserves the original 143 x 222 x 3.5 mm base', () => {
    base.computeBoundingBox();
    const size = base.boundingBox!.getSize(new Vector3());
    expect(size.x).toBeCloseTo(143, 3);
    expect(size.y).toBeCloseTo(222, 3);
    expect(size.z).toBeCloseTo(3.5, 5);
    expect(base.getAttribute('position').count / 3).toBe(2916);
  });
  it('makes every normal distance printable with bounded lettering', () => {
    for (const distance of distances) {
      const design = initialDesign();
      design.distanceId = distance.id;
      design.title = distance.title.replace(' · ', ' ');
      const group = makePlate(design, font, base);
      const box = new Box3().setFromObject(group);
      expect(box.max.z).toBeCloseTo(4.3, 4);
      expect(box.getSize(new Vector3()).x).toBeCloseTo(143, 3);
      disposeGroup(group);
    }
  });
  it('keeps glue-on labels and BIB prefix on the plate but no loose values', () => {
    const design = initialDesign();
    design.placements = { time: 'separate', pace: 'hidden', bib: 'separate' };
    const group = makePlate(design, font, base);
    expect(group.children.filter((c) => c instanceof Group)).toHaveLength(0);
    expect(group.children.filter((c) => c.name === 'time' || c.name === 'pace' || c.name === 'bib')).toHaveLength(0);
    expect(group.getObjectByName('time label')).toBeDefined();
    expect(group.getObjectByName('bib label')).toBeDefined();
    expect(group.getObjectByName('bib fixed prefix')).toBeDefined();
    expect(group.getObjectByName('pace label')).toBeUndefined();
    expect(new Box3().setFromObject(group).min.y).toBeCloseTo(-111, 3);
    const xml = docFrom3mf(export3mf(group));
    expect(xml.querySelectorAll('build > item')).toHaveLength(1);
    disposeGroup(group);
  });
  it('exports welded, finite mesh vertices and actual material colours', () => {
    const design = initialDesign();
    design.title = '5K'; design.colours.title = '#ff0000';
    const group = makePlate(design, font, base);
    const xml = docFrom3mf(export3mf(group));
    expect(xml.querySelector('parsererror')).toBeNull();
    expect([...xml.querySelectorAll('base')].some((el) => el.getAttribute('displaycolor') === '#FF0000FF')).toBe(true);
    for (const mesh of xml.querySelectorAll('mesh')) {
      const count = mesh.querySelectorAll('vertex').length;
      const triangles = [...mesh.querySelectorAll('triangle')];
      expect(count).toBeLessThan(triangles.length * 3);
      const edges = new Map<string, number>();
      for (const t of triangles) {
        const ids = ['v1', 'v2', 'v3'].map((attr) => Number(t.getAttribute(attr)));
        for (const id of ids) expect(id).toBeLessThan(count);
        expect(Number(t.getAttribute('p1'))).toBeGreaterThanOrEqual(0);
        for (let i = 0; i < 3; i++) {
          const a = ids[i], b = ids[(i + 1) % 3];
          const key = a < b ? `${a},${b}` : `${b},${a}`;
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
      const badEdges = [...edges].filter(([, n]) => n !== 2);
      const vertexElements = [...mesh.querySelectorAll('vertex')];
      const detail = badEdges.slice(0, 8).map(([edge, n]) => [n, edge.split(',').map((id) => vertexElements[Number(id)].outerHTML)]);
      expect(badEdges, `${mesh.parentElement?.getAttribute('name')}: ${JSON.stringify(detail)}`).toHaveLength(0);
    }
    const archive = unzipSync(exportStls(group));
    expect(archive['PRINT-INSTRUCTIONS.txt']).toBeDefined();
    const stl = Object.entries(archive).find(([name]) => name.endsWith('.stl'))![1];
    expect(stl.byteLength).toBe(84 + new DataView(stl.buffer, stl.byteOffset).getUint32(80, true) * 50);
    disposeGroup(group);
  });
  it('round-trips 3MF assemblies, colours, dimensions and source provenance', () => {
    const design = initialDesign();
    const group = makePlate(design, font, base);
    const file = export3mf(group);
    const result = importMap(file.slice().buffer, 'plate-test.3mf');
    expect(result.parts.length).toBeGreaterThan(5);
    for (const mesh of result.parts) {
      if (mesh.geometry.groups.length === 0) expect(Array.isArray(mesh.material), 'Ungrouped geometry must retain a single material to render').toBe(false);
      expect(mesh.geometry.hasAttribute('normal'), 'Imported geometry needs normals for lit preview materials').toBe(true);
    }
    expect(result.dimensions.width).toBeLessThanOrEqual(141.001);
    expect(result.dimensions.height).toBeLessThanOrEqual(120.915);
    expect(result.rim, 'A narrow 3D model gets a mounting rim for the frame lip').toBe(true);
    const red = result.parts.find((m) => m.name === 'title')!;
    expect(red).toBeInstanceOf(Mesh);
    const output = unzipSync(export3mf(result.group, result.source));
    expect(output['Metadata/OriginalSource.3mf']).toEqual(file);
    disposeGroup(group); disposeGroup(result.group);
  });
  it('preserves unofficial course attribution in both export formats', () => {
    const group = makePlate(initialDesign(), font, base);
    const credits = 'Community map — unofficial\nCC BY 4.0\nCourse creator';
    const model = unzipSync(export3mf(group, undefined, credits));
    expect(strFromU8(model['Metadata/CREDITS.txt'])).toBe(credits);
    const stls = unzipSync(exportStls(group, undefined, credits));
    expect(strFromU8(stls['CREDITS.txt'])).toBe(credits);
    disposeGroup(group);
  });
  it('rejects unsupported characters and illegibly long text', () => {
    const design = initialDesign(); design.title = '🏃';
    expect(() => makePlate(design, font, base)).toThrow('does not support');
    design.title = 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW';
    expect(() => makePlate(design, font, base)).toThrow('too long');
  });
});

describe('loose result characters', () => {
  const counts = Object.fromEntries([...kitCharacters].map((character) => [character, 2]));
  it('prints the plate and a kit before results are known', () => {
    const design = initialDesign();
    design.placements = { time: 'separate', pace: 'separate', bib: 'separate' };
    design.time = ''; design.pace = ''; design.bib = '';
    const plate = makePlate(design, font, base);
    expect(plate.getObjectByName('pace label')).toBeDefined();
    const kit = makeGlueCharacters(design, font, 'time', counts);
    expect(kit.children).toHaveLength(22);
    const height = (digit: string) => new Box3().setFromObject(kit.children.find((c) => c.name.includes(`digit ${digit}`))!).getSize(new Vector3()).y;
    expect(height('1') / height('8')).toBeGreaterThan(0.95);
    expect(height('1') / height('8')).toBeLessThan(1.05);
    for (const character of kit.children) {
      const box = new Box3().setFromObject(character);
      expect(box.min.z).toBeCloseTo(0);
      expect(box.max.z).toBeCloseTo(0.8);
      expect(box.getSize(new Vector3()).x).toBeLessThanOrEqual(2.001);
      expect(character.children).toHaveLength(1);
      expect(character.children[0].name).toMatch(/digit \d|colon/);
    }
    expect(() => makeGlueCharacters(design, font, 'exact', counts)).toThrow('finish time');
    const xml = docFrom3mf(export3mf(kit));
    expect(xml.querySelectorAll('build > item')).toHaveLength(22);
    const zip = unzipSync(exportStls(kit));
    expect(Object.keys(zip).filter((name) => name.endsWith('.stl'))).toHaveLength(22);
    expect(Object.keys(zip).some((name) => /backing|label|prefix/.test(name))).toBe(false);
    disposeGroup(plate); disposeGroup(kit);
  });
  it('exports exactly the required characters, repeated digits and separators', () => {
    const design = initialDesign();
    design.placements = { time: 'separate', pace: 'hidden', bib: 'separate' };
    design.time = '01:11:10'; design.bib = '1100';
    const exact = makeGlueCharacters(design, font, 'exact', counts);
    expect(exact.children).toHaveLength(12);
    expect(exact.children.filter((c) => c.name.includes('colon'))).toHaveLength(2);
    expect(exact.children.filter((c) => c.name.includes('digit 1'))).toHaveLength(6);
    expect(exact.children.some((c) => c.name.includes('#') || c.name.includes('pace'))).toBe(false);
    const kit = makeGlueCharacters(design, font, 'time', counts);
    const exactDigit = new Box3().setFromObject(exact.children.find((c) => c.name.includes('digit 1'))!).getSize(new Vector3());
    const kitDigit = new Box3().setFromObject(kit.children.find((c) => c.name.includes('digit 1'))!).getSize(new Vector3());
    expect(exactDigit.distanceTo(kitDigit)).toBeCloseTo(0);
    disposeGroup(exact); disposeGroup(kit);
  });
  it('validates quantities and glue-on BIB digits without blocking the plate', () => {
    const design = initialDesign(); design.placements.bib = 'separate';
    for (const quantity of [-1, 21, 1.5, NaN]) {
      expect(() => makeGlueCharacters(design, font, 'bib', { ...counts, '0': quantity })).toThrow('0–20');
    }
    expect(() => makeGlueCharacters(design, font, 'bib', Object.fromEntries([...kitCharacters].map((c) => [c, 0])))).toThrow('at least one');
    expect(() => makeGlueCharacters(design, font, 'time', counts)).toThrow('configured');
    design.bib = 'A12';
    expect(() => validateDesign(design)).not.toThrow();
    expect(() => makeGlueCharacters(design, font, 'exact', counts)).toThrow('1–10 digits');
  });
});

const gpx = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Test route</name><trkseg><trkpt lat="59.90" lon="10.70"/><trkpt lat="59.91" lon="10.71"/></trkseg><trkseg><trkpt lat="59.92" lon="10.72"/><trkpt lat="59.93" lon="10.73"/></trkseg></trk></gpx>`;
describe('personal GPX', () => {
  it('preserves segments, calculates distance and fits the map footprint', () => {
    const track = parseGpx(gpx, 'Fallback');
    expect(track.name).toBe('Test route');
    expect(track.segments).toHaveLength(2);
    expect(track.points).toBe(4);
    expect(track.km).toBeGreaterThan(2);
    const projected = projectTrack(track).flat();
    expect(Math.max(...projected.map((p) => Math.abs(p[0])))).toBeLessThanOrEqual(66.501);
    expect(Math.max(...projected.map((p) => Math.abs(p[1])))).toBeLessThanOrEqual(58.501);
  });
  it('rejects malformed, empty and invalid-coordinate GPX', () => {
    for (const xml of ['not xml', '<gpx/>', gpx.replace('lat="59.90"', 'lat=""'), gpx.replace('lat="59.90"', 'lat="190"'), '<!DOCTYPE gpx><gpx/>']) {
      expect(() => parseGpx(xml, 'Invalid')).toThrow();
    }
  });
  it('accepts route-only GPX and handles the antimeridian', () => {
    const track = parseGpx('<gpx><rte><rtept lat="1" lon="179.99"/><rtept lat="1.001" lon="-179.99"/></rte></gpx>', 'Date line');
    expect(track.km).toBeLessThan(3);
    expect(projectTrack(track).flat().every((p) => p.every(Number.isFinite))).toBe(true);
  });
});

describe('map input validation', () => {
  it('accepts five million triangles and rejects one triangle over', () => {
    expect(MAX_MAP_TRIANGLES).toBe(5_000_000);
    expect(() => validateMapTriangleCount(1_200_001)).not.toThrow();
    expect(() => validateMapTriangleCount(MAX_MAP_TRIANGLES)).not.toThrow();
    expect(() => validateMapTriangleCount(MAX_MAP_TRIANGLES + 1)).toThrow('at most 5 million');
  });
  it('accepts expanded archives through 512 MB and rejects one byte over', () => {
    expect(MAX_EXPANDED_MAP_BYTES).toBe(512 * 1024 * 1024);
    expect(() => validateExpandedMapSize(121 * 1024 * 1024)).not.toThrow();
    expect(() => validateExpandedMapSize(MAX_EXPANDED_MAP_BYTES)).not.toThrow();
    expect(() => validateExpandedMapSize(MAX_EXPANDED_MAP_BYTES + 1)).toThrow('exceeds 512 MB');
  });
  it('accepts map files through 100 MB and rejects even one byte over', () => {
    expect(MAX_MAP_FILE_BYTES).toBe(100 * 1024 * 1024);
    expect(() => validateMapFileSize(36 * 1024 * 1024)).not.toThrow();
    expect(() => validateMapFileSize(MAX_MAP_FILE_BYTES)).not.toThrow();
    expect(() => validateMapFileSize(MAX_MAP_FILE_BYTES + 1)).toThrow('at most 100 MB');
  });
  it('rejects unsupported files and invalid units', () => {
    expect(() => importMap(new ArrayBuffer(4), 'map.txt')).toThrow('Choose');
    const file = zipSync({ '3D/map.model': strToU8('<model unit="inch"/>') });
    expect(() => importMap(file.slice().buffer, 'map.3mf')).toThrow('millimetres');
  });
  it('rejects colour representations that cannot be preserved', () => {
    for (const resource of ['<texture2d/>', '<colorgroup/>', '<multiproperties/>']) {
      const file = zipSync({ '3D/map.model': strToU8(`<model unit="millimeter"><resources>${resource}</resources></model>`) });
      expect(() => importMap(file.slice().buffer, 'map.3mf')).toThrow(/not supported|cannot be recoloured/);
    }
  });
  it('fits the actual supplied map without changing its aspect ratio', () => {
    const file = readFileSync('assets/obj_2_Map Example.stl');
    const result = importMap(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), 'example.stl');
    expect(result.parts).toHaveLength(1);
    expect(result.dimensions.width).toBeCloseTo(141, 2);
    expect(result.dimensions.height).toBeCloseTo(120.9136, 2);
    expect(result.dimensions.depth).toBeCloseTo(4.41154, 2);
    disposeGroup(result.group);
  });
});

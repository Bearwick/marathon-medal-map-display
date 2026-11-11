// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BoxGeometry, Group, Vector3 } from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import type { Font } from 'three/addons/loaders/FontLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import type { BufferGeometry } from 'three';
import { strFromU8, unzipSync } from 'fflate';
import { initialDesign, kitCharacters } from './data';
import { disposeGroup, makeGlueCharacters, makePlate, normalizeBase, part } from './geometry';
import { exportCompleteDisplay, parseAssemblyFiles, wholeModelStl } from './complete';

let font: Font;
let base: BufferGeometry;
beforeAll(() => {
  font = new FontLoader().parse(JSON.parse(readFileSync('public/generated/font.json', 'utf8')));
  const file = readFileSync('public/generated/plate-base.stl');
  base = normalizeBase(new STLLoader().parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)));
});
afterEach(() => vi.unstubAllGlobals());

function mockAssets(missing?: string): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = decodeURIComponent(url.replace(/^\/generated\//, ''));
    if (path === missing) return new Response('Missing', { status: 404 });
    const bytes = new Uint8Array(readFileSync(`public/generated/${path}`));
    return new Response(bytes);
  }));
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('complete display ZIP', () => {
  it('includes every original assembly part and whole customized plate and map', async () => {
    mockAssets();
    const design = initialDesign();
    const plate = makePlate(design, font, base);
    const map = new Group();
    map.add(part('Map base', new BoxGeometry(100, 80, 2), '#cccccc'));
    map.add(part('Route', new BoxGeometry(20, 1, 1), '#ff0000'));
    const source = new Uint8Array([1, 2, 3]);
    const files = unzipSync(await exportCompleteDisplay({
      plate, map, characters: [], usesExample: false,
      originalMapSource: source, credits: 'Unofficial community map / creator credits',
    }));
    const originals = readdirSync('assets').filter((name) => name.endsWith('.stl') && !/^obj_[12]_/.test(name));
    expect(originals).toHaveLength(8);
    originals.forEach((name) => expect(digest(files[name])).toBe(digest(readFileSync(`assets/${name}`))));
    expect(Object.keys(files).filter((name) => name.endsWith('.stl'))).toHaveLength(10);
    expect(files['obj_1_Plate Small Medal.stl']).toBeUndefined();
    expect(files['obj_2_Map Example.stl']).toBeUndefined();
    const stl = files['obj_1_Customized Plate.stl'];
    const geometry = new STLLoader().parse(new Uint8Array(stl).buffer);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.getSize(new Vector3()).x).toBeCloseTo(143, 3);
    expect(geometry.boundingBox!.max.z).toBeCloseTo(4.3, 3);
    expect(new DataView(files['obj_2_Customized Map.stl'].buffer).getUint32(80, true)).toBe(24);
    expect(files['source-credits/OriginalMapSource.3mf']).toEqual(source);
    expect(strFromU8(files['source-credits/COMMUNITY-CREDITS.txt'])).toContain('Unofficial');
    geometry.dispose(); disposeGroup(plate); disposeGroup(map);
  });
  it('explicitly labels and includes the supplied example when a map is absent', async () => {
    mockAssets();
    const plate = makePlate(initialDesign(), font, base);
    const files = unzipSync(await exportCompleteDisplay({ plate, characters: [], usesExample: true }));
    const name = 'obj_2_EXAMPLE Map - NOT SELECTED RACE.stl';
    expect(digest(files[name])).toBe(digest(readFileSync('assets/obj_2_Map Example.stl')));
    expect(files['obj_2_Customized Map.stl']).toBeUndefined();
    expect(strFromU8(files['PRINT-INSTRUCTIONS.txt'])).toContain('NOT a course for the selected race');
    disposeGroup(plate);
  });
  it('includes individual loose digits in the same ZIP without splitting plate text', async () => {
    mockAssets();
    const design = initialDesign();
    design.placements.time = 'separate';
    const plate = makePlate(design, font, base);
    const counts = Object.fromEntries([...kitCharacters].map((c) => [c, c === '1' || c === ':' ? 1 : 0]));
    const kit = makeGlueCharacters(design, font, 'time', counts);
    const map = new Group(); map.add(part('Map', new BoxGeometry(100, 80, 2), '#cccccc'));
    const files = unzipSync(await exportCompleteDisplay({ plate, map, characters: [kit], usesExample: false }));
    const glyphs = Object.keys(files).filter((name) => name.startsWith('glue-on-digits/'));
    expect(glyphs).toHaveLength(2);
    for (const name of glyphs) {
      const geometry = new STLLoader().parse(new Uint8Array(files[name]).buffer);
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.min.z).toBeCloseTo(0);
      expect(geometry.boundingBox!.max.z).toBeCloseTo(0.8);
      geometry.dispose();
    }
    expect(Object.keys(files).some((name) => /time-label|plate-base|backing/.test(name))).toBe(false);
    disposeGroup(plate); disposeGroup(map); disposeGroup(kit);
  });
  it('fails explicitly if any required original asset is missing', async () => {
    const manifest = parseAssemblyFiles(JSON.parse(readFileSync('public/generated/assembly.json', 'utf8')));
    mockAssets(`assembly/${manifest[0]}`);
    const plate = makePlate(initialDesign(), font, base);
    await expect(exportCompleteDisplay({ plate, characters: [], usesExample: true })).rejects.toThrow('required display asset (404)');
    disposeGroup(plate);
  });
  it('rejects incomplete manifests and empty printable models', () => {
    expect(() => parseAssemblyFiles([])).toThrow('incomplete');
    expect(() => parseAssemblyFiles(Array(8).fill('obj_3_Frame.stl'))).toThrow();
    expect(() => wholeModelStl(new Group())).toThrow('no printable triangles');
    const model = new Group();
    model.add(part('Offset', new BoxGeometry(1, 1, 1), '#cccccc'));
    model.position.set(50, 40, 0.5);
    const stl = new STLLoader().parse(new Uint8Array(wholeModelStl(model)).buffer);
    stl.computeBoundingBox();
    expect(stl.boundingBox!.min.x).toBeCloseTo(49.5);
    stl.dispose(); disposeGroup(model);
  });
  it('does not package a successful HTTP response containing a corrupt STL', async () => {
    const manifest = readFileSync('public/generated/assembly.json');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(
      url.endsWith('assembly.json') ? new Uint8Array(manifest) : 'HTML fallback, not an STL',
    )));
    const plate = makePlate(initialDesign(), font, base);
    await expect(exportCompleteDisplay({ plate, characters: [], usesExample: true })).rejects.toThrow('corrupt or incomplete');
    disposeGroup(plate);
  });
});

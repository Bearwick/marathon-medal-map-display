import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'public/generated');
await mkdir(out, { recursive: true });
const source = await readFile(path.join(root, 'assets/obj_1_Plate Small Medal.stl'));
const count = source.readUInt32LE(80);
if (source.length !== 84 + count * 50) throw new Error('Unexpected plate STL format.');
// The supplied text consists of disconnected shells above the 3.5 mm base.
const faces = [];
for (let i = 0; i < count; i++) {
  const offset = 84 + i * 50;
  const z = [20, 32, 44].map((n) => source.readFloatLE(offset + n));
  if (z.every((v) => v <= 3.50001) && !z.every((v) => Math.abs(v - 3.485) < 0.00001)) {
    faces.push(source.subarray(offset, offset + 50));
  }
}
if (faces.length !== 2916) throw new Error(`Unexpected base geometry: ${faces.length} faces.`);
const header = Buffer.alloc(84);
header.write('Original plate base; source dimensions preserved');
header.writeUInt32LE(faces.length, 80);
await writeFile(path.join(out, 'plate-base.stl'), Buffer.concat([header, ...faces]));
await copyFile(path.join(root, 'assets/obj_2_Map Example.stl'), path.join(out, 'example-map.stl'));
// A lighter copy of the 26 MB example map for the on-screen preview (vertex clustering on a 1 mm grid).
// The complete ZIP still uses the original file.
{
  const map = await readFile(path.join(root, 'assets/obj_2_Map Example.stl'));
  const triangles = map.readUInt32LE(80);
  const cell = 1.0;
  const key = (o) => [0, 1, 2].map((a) => Math.round(map.readFloatLE(o + a * 4) / cell)).join(',');
  const representative = new Map();
  const kept = [];
  const seen = new Set();
  for (let i = 0; i < triangles; i++) {
    const offset = 84 + i * 50;
    const keys = [12, 24, 36].map((v) => key(offset + v));
    if (new Set(keys).size < 3) continue;
    const id = [...keys].sort().join('|');
    if (seen.has(id)) continue;
    seen.add(id);
    const vertices = keys.map((k, v) => {
      if (!representative.has(k)) representative.set(k, [0, 1, 2].map((a) => map.readFloatLE(offset + 12 + v * 12 + a * 4)));
      return representative.get(k);
    });
    kept.push(vertices);
  }
  const preview = Buffer.alloc(84 + kept.length * 50);
  preview.write('Decimated preview of the supplied example map');
  preview.writeUInt32LE(kept.length, 80);
  kept.forEach((vertices, i) => vertices.forEach((vertex, v) => vertex.forEach((value, a) => preview.writeFloatLE(value, 84 + i * 50 + 12 + v * 12 + a * 4))));
  await writeFile(path.join(out, 'example-map-preview.stl'), preview);
}
const assemblyOut = path.join(out, 'assembly');
await mkdir(assemblyOut, { recursive: true });
const assemblyFiles = (await readdir(path.join(root, 'assets')))
  .filter((name) => name.endsWith('.stl') && !['obj_1_Plate Small Medal.stl', 'obj_2_Map Example.stl'].includes(name))
  .sort((a, b) => Number(a.match(/^obj_(\d+)/)?.[1]) - Number(b.match(/^obj_(\d+)/)?.[1]));
if (assemblyFiles.length !== 8) throw new Error(`Expected 8 original assembly parts, found ${assemblyFiles.length}.`);
await Promise.all(assemblyFiles.map((name) => copyFile(path.join(root, 'assets', name), path.join(assemblyOut, name))));
await writeFile(path.join(out, 'assembly.json'), JSON.stringify(assemblyFiles));
const fontDir = path.join(root, 'node_modules/three/examples/fonts');
const fontPath = path.join(fontDir, 'helvetiker_bold.typeface.json');
await mkdir(path.join(out, 'fonts'), { recursive: true });
await copyFile(fontPath, path.join(out, 'fonts/helvetiker_bold.typeface.json'));
for (const name of ['droid_sans_bold.typeface.json', 'droid_serif_bold.typeface.json']) await copyFile(path.join(fontDir, 'droid', name), path.join(out, 'fonts', name));
const font = JSON.parse(await readFile(fontPath, 'utf8'));
const licence = async (title, file) => `${title}\n\n${await readFile(path.join(root, 'node_modules', file), 'utf8')}`;
const notices = [
  await licence('THREE.JS', 'three/LICENSE'),
  await licence('FFLATE', 'fflate/LICENSE'),
  await licence('MAPLIBRE GL JS', 'maplibre-gl/LICENSE.txt'),
  await licence('@MAPBOX/VECTOR-TILE', '@mapbox/vector-tile/LICENSE.txt'),
  await licence('PBF', 'pbf/LICENSE'),
  'HELVETIKER BOLD / MAGENTA\n\n' + font.original_font_information.license_description,
  await licence('DROID SANS / DROID SERIF (Apache License 2.0)', 'three/examples/fonts/droid/NOTICE'),
  await licence('DM SANS (SIL Open Font License 1.1)', '@fontsource/dm-sans/LICENSE'),
  await licence('MANROPE (SIL Open Font License 1.1)', '@fontsource/manrope/LICENSE'),
  'MAP DATA\n\nGenerated maps use © OpenStreetMap contributors data under the Open Database License 1.0 (https://www.openstreetmap.org/copyright), vector tiles in the OpenMapTiles schema served by OpenFreeMap (https://openfreemap.org/), and Terrain Tiles on AWS Open Data (https://github.com/tilezen/joerd/blob/master/docs/attribution.md). Known courses traced from OpenStreetMap are also ODbL 1.0.',
];
await writeFile(path.join(out, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n--------------------\n\n'));
console.log('Prepared original plate base, reference map (+ preview), all assembly parts, fonts and notices.');

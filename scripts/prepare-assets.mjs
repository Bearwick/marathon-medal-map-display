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
const assemblyOut = path.join(out, 'assembly');
await mkdir(assemblyOut, { recursive: true });
const assemblyFiles = (await readdir(path.join(root, 'assets')))
  .filter((name) => name.endsWith('.stl') && !['obj_1_Plate Small Medal.stl', 'obj_2_Map Example.stl'].includes(name))
  .sort((a, b) => Number(a.match(/^obj_(\d+)/)?.[1]) - Number(b.match(/^obj_(\d+)/)?.[1]));
if (assemblyFiles.length !== 8) throw new Error(`Expected 8 original assembly parts, found ${assemblyFiles.length}.`);
await Promise.all(assemblyFiles.map((name) => copyFile(path.join(root, 'assets', name), path.join(assemblyOut, name))));
await writeFile(path.join(out, 'assembly.json'), JSON.stringify(assemblyFiles));
const fontPath = path.join(root, 'node_modules/three/examples/fonts/helvetiker_bold.typeface.json');
await copyFile(fontPath, path.join(out, 'font.json'));
const font = JSON.parse(await readFile(fontPath, 'utf8'));
const notices = [
  'THREE.JS\n\n' + await readFile(path.join(root, 'node_modules/three/LICENSE'), 'utf8'),
  'FFLATE\n\n' + await readFile(path.join(root, 'node_modules/fflate/LICENSE'), 'utf8'),
  'HELVETIKER BOLD / MAGENTA\n\n' + font.original_font_information.license_description,
];
await writeFile(path.join(out, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n--------------------\n\n'));
console.log('Prepared original plate base, reference map, all assembly parts and bundled font.');

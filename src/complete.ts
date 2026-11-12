import type { Group } from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { strToU8, zipSync } from 'fflate';

interface CompleteDisplay {
  plate: Group;
  map?: Group;
  characters: Group[];
  originalMapSource?: Uint8Array;
  credits?: string;
  /** Settings a generated map was built from (JSON), so it can be reproduced. */
  mapSettings?: string;
  usesExample: boolean;
}

export function wholeModelStl(model: Group): Uint8Array {
  model.updateWorldMatrix(true, true);
  const data = new STLExporter().parse(model, { binary: true });
  if (data.byteLength <= 84) throw new Error('The complete model contains no printable triangles.');
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

async function readAsset(path: string): Promise<Uint8Array> {
  const response = await fetch(`${import.meta.env.BASE_URL}generated/${path}`);
  if (!response.ok) throw new Error(`Could not load a required display asset (${response.status}): ${path}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (path.endsWith('.stl')) {
    const triangles = bytes.length >= 84 ? new DataView(bytes.buffer).getUint32(80, true) : 0;
    if (!triangles || bytes.length !== 84 + triangles * 50) throw new Error(`A required display STL is corrupt or incomplete: ${path}`);
  }
  return bytes;
}

export function parseAssemblyFiles(value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== 8 || !value.every((name: unknown) => typeof name === 'string' && /^obj_(?:3|4|5|6|7|8|9|11)_[A-Za-z0-9 _-]+\.stl$/.test(name)) || new Set(value).size !== value.length) {
    throw new Error('The original assembly asset manifest is invalid or incomplete.');
  }
  const files: string[] = value;
  if (new Set(files.map((name) => name.split('_')[1])).size !== 8) throw new Error('The assembly manifest contains duplicate part numbers.');
  return files;
}

export async function exportCompleteDisplay(input: CompleteDisplay): Promise<Uint8Array> {
  if (!input.map && !input.usesExample) throw new Error('Choose a map or explicitly include the supplied example.');
  const files: Record<string, Uint8Array> = { 'obj_1_Customized Plate.stl': wholeModelStl(input.plate) };
  if (input.map) files['obj_2_Customized Map.stl'] = wholeModelStl(input.map);
  for (const [setIndex, set] of input.characters.entries()) {
    for (const [characterIndex, character] of set.children.entries()) {
      const model = set.clone(false);
      model.add(character.clone());
      model.updateMatrixWorld(true);
      const name = `${setIndex + 1}-${characterIndex + 1}-${character.name}`.replace(/[^a-zA-Z0-9-]/g, '-');
      files[`glue-on-digits/${name}.stl`] = wholeModelStl(model);
    }
  }
  if (input.originalMapSource) files['source-credits/OriginalMapSource.3mf'] = input.originalMapSource;
  if (input.credits) files['source-credits/CREDITS.txt'] = strToU8(input.credits);
  if (input.mapSettings) files['source-credits/MAP-SETTINGS.json'] = strToU8(input.mapSettings);
  const manifest = parseAssemblyFiles(JSON.parse(new TextDecoder().decode(await readAsset('assembly.json'))));
  const originals = await Promise.all(manifest.map(async (name) => [name, await readAsset(`assembly/${encodeURIComponent(name)}`)] as const));
  originals.forEach(([name, bytes]) => { files[name] = bytes; });
  if (!input.map) files['obj_2_EXAMPLE Map - NOT SELECTED RACE.stl'] = await readAsset('example-map.stl');
  files['PRINT-INSTRUCTIONS.txt'] = strToU8([
    'FINISHLINE / COMPLETE DISPLAY',
    '',
    'One STL per complete printable display part. The customized plate includes its base, attached text, fixed labels and BIB prefix in one file. The customized map includes all its bodies in one file. No separate text/base/map-layer STL imports are needed.',
    'STL contains triangle surfaces, not filament colours. Keep connected/touching shells together and slice as a union; do not split the complete plate or map into independently placed bodies.',
    '',
    input.usesExample ? 'WARNING: The map is the supplied EXAMPLE. It is NOT a course for the selected race or an organizer-verified map. Any GPX preview is not a detailed printable map.' : input.mapSettings ? 'Map: generated from OpenStreetMap data for the framed area (see source-credits/). Confirm the route, edition and distance. Known/community courses remain unofficial.' : 'Map: customized imported geometry. Confirm the route, edition and distance. Community maps remain unofficial.',
    '',
    'Original assembly files: lower and upper frames, ribbon holder, lid, plate/map spacers and both alternative medal spacers. Original geometry and coordinates are preserved. Position/rotate each part on the bed in your slicer; choose the medal spacer that suits your medal.',
    'Plate footprint: 143 x 222 mm, 3.5 mm base, 0.8 mm raised text. Maps fill the 133 x 117 mm frame window; a thin flat rim (at most 1.7 mm) extends them to the 141 x 120.9 mm tile that slides under the frame lip. Maps up to 4.7 mm deep sit flush with the frame front. Dry-fit all parts before gluing.',
    '',
    'Loose glue-on characters, when selected, are in glue-on-digits/. Each file contains only a digit or the two colon dots, with no backing. Print at 100% scale, Z=0, 0.8 mm thick. Keep colon dots in relative position. Place above matching labels using 2.4 mm character spacing; start BIB digits 4 mm right of the fixed #. Handle tiny parts with tweezers and keep away from children.',
    'Inspect sliced small text and thin map features. A 0.4 mm nozzle / 0.2 mm layers is a starting point, not a guarantee; loose digits may need a finer nozzle.',
    '',
    'Retain source-credits/ files when redistributing. OriginalMapSource.3mf preserves the complete source with its embedded licence and credits. Check source permissions before redistribution or sale.',
  ].join('\n'));
  return zipSync(files, { level: 6 });
}

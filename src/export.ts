import { Box3, Color, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { Material } from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { strToU8, zipSync } from 'fflate';

export function xmlEscape(value: string): string {
  return value.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

interface Assembly { name: string; meshes: Mesh[] }

function assemblies(group: Group): Assembly[] {
  group.updateMatrixWorld(true);
  const main: Assembly = { name: group.name || 'Print', meshes: [] };
  const result = [main];
  for (const child of group.children) {
    if (child instanceof Mesh) main.meshes.push(child);
    else {
      const assembly: Assembly = { name: child.name || 'Part', meshes: [] };
      child.traverse((object) => { if (object instanceof Mesh) assembly.meshes.push(object); });
      if (assembly.meshes.length) result.push(assembly);
    }
  }
  return result.filter((item) => item.meshes.length);
}

function colour(material: Material | undefined): string {
  return `#${(material instanceof MeshStandardMaterial ? material.color : new Color('#dddddd')).getHexString().toUpperCase()}FF`;
}

export function export3mf(group: Group, originalSource?: Uint8Array, credits?: string): Uint8Array {
  const resources: string[] = [];
  const build: string[] = [];
  const materials: string[] = [];
  let nextId = 2;
  for (const assembly of assemblies(group)) {
    const components: string[] = [];
    for (const mesh of assembly.meshes) {
      const id = nextId++;
      const geometry = mesh.geometry;
      const position = geometry.getAttribute('position');
      const index = geometry.getIndex();
      const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const materialIndices = meshMaterials.map((material) => {
        const index = materials.length;
        materials.push(`<base name="${xmlEscape(mesh.name)}" displaycolor="${colour(material)}"/>`);
        return index;
      });
      const vertices: string[] = [];
      const welded = new Map<string, number>();
      const vertexIndices: number[] = [];
      const vertex = new Vector3();
      for (let i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite)) throw new Error('Cannot export non-finite geometry.');
        const coordinates = [vertex.x, vertex.y, vertex.z].map((n) => n.toFixed(5));
        const key = coordinates.join(',');
        let vertexIndex = welded.get(key);
        if (vertexIndex === undefined) {
          vertexIndex = vertices.length;
          welded.set(key, vertexIndex);
          vertices.push(`<vertex x="${coordinates[0]}" y="${coordinates[1]}" z="${coordinates[2]}"/>`);
        }
        vertexIndices.push(vertexIndex);
      }
      const triangles: string[] = [];
      const count = index?.count ?? position.count;
      for (let i = 0; i < count; i += 3) {
        const materialGroup = geometry.groups.find((g) => i >= g.start && i < g.start + g.count);
        const materialIndex = materialIndices[materialGroup?.materialIndex ?? 0] ?? materialIndices[0];
        const ids = [0, 1, 2].map((offset) => vertexIndices[index ? index.getX(i + offset) : i + offset]);
        if (new Set(ids).size < 3) continue;
        triangles.push(`<triangle v1="${ids[0]}" v2="${ids[1]}" v3="${ids[2]}" pid="1" p1="${materialIndex}"/>`);
      }
      resources.push(`<object id="${id}" type="model" name="${xmlEscape(mesh.name)}"><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object>`);
      components.push(`<component objectid="${id}"/>`);
    }
    const id = nextId++;
    resources.push(`<object id="${id}" type="model" name="${xmlEscape(assembly.name)}"><components>${components.join('')}</components></object>`);
    build.push(`<item objectid="${id}"/>`);
  }
  if (!build.length) throw new Error('There is no printable geometry to export.');
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">Finishline medal and map studio</metadata><metadata name="Description">Named printable parts. Assign filaments in your slicer. ${originalSource ? 'Original source and its attribution are embedded in Metadata/OriginalSource.3mf; retain source credits.' : ''}</metadata><resources><basematerials id="1">${materials.join('')}</basematerials>${resources.join('')}</resources><build>${build.join('')}</build></model>`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="3mf" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+zip"/><Default Extension="txt" ContentType="text/plain"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8(model),
  };
  if (originalSource) files['Metadata/OriginalSource.3mf'] = originalSource;
  if (credits) files['Metadata/CREDITS.txt'] = strToU8(credits);
  return zipSync(files, { level: 6 });
}

export function exportStls(group: Group, originalSource?: Uint8Array, credits?: string): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const exporter = new STLExporter();
  for (const [i, assembly] of assemblies(group).entries()) {
    for (const [j, mesh] of assembly.meshes.entries()) {
      const safeName = `${i + 1}-${assembly.name}-${j + 1}-${mesh.name}`.replace(/[^a-zA-Z0-9-]/g, '-');
      const data = exporter.parse(mesh, { binary: true });
      files[`${safeName}.stl`] = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
  }
  if (originalSource) files['OriginalSource.3mf'] = originalSource;
  if (credits) files['CREDITS.txt'] = strToU8(credits);
  files['PRINT-INSTRUCTIONS.txt'] = strToU8(
    'FINISHLINE / PRINT PARTS\n\nUnits: millimetres. Z is up.\nSTL does not store colour. Prefer the multipart 3MF download for colour printing.\n\nFor each numbered assembly, import its STL files together as ONE object with multiple parts. Keep their original relative positions. Do not drop attached text bodies to the bed independently. Assign filament to the named parts, then slice the object as a union.\n\nGlue-on mode keeps TIME, PACE / KM, BIB labels and the BIB # on the display. Digits are downloaded separately: either entered results or a reusable 0-9 and colon kit. Character files contain only 0.8 mm thick digits or colon dots, with no backing plates, labels or #. Each numbered character is a separate assembly on Z=0. Print at 100% scale, face-up, then glue above the matching label using 2.4 mm character spacing. Start BIB digits 4 mm right of the fixed #. Colons have two disconnected dots: retain their relative positions and use tweezers. Inspect small parts in your slicer; a finer nozzle may be necessary. Keep loose pieces away from children.\n\nPlate: 143 x 222 x 3.5 mm base; text reaches 4.3 mm. Use a bed that fits the plate, or rotate it in your slicer. Start with a 0.4 mm nozzle and 0.2 mm layers; inspect small text and thin walls in the sliced preview. Some fonts or imported maps may need finer settings.\n\nColour previews are suggestions, not printer instructions. A manual filament change can change all features above a layer; different colours at the same height require multi-material hardware or separately printed parts.\n\nFor imported maps, retain original source attribution and check its licence before redistribution or sale. If present, OriginalSource.3mf preserves the complete original file and credits.\n'
  );
  return zipSync(files, { level: 6 });
}

export function download(data: Uint8Array | string, filename: string, type: string): void {
  const bytes = typeof data === 'string' ? data : new Uint8Array(data).buffer;
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function printSize(group: Group): Vector3 {
  return new Box3().setFromObject(group).getSize(new Vector3());
}

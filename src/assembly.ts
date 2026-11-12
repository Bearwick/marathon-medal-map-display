import { Group, Mesh, MeshStandardMaterial } from 'three';
import type { BufferGeometry } from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { MAP_TILE_HEIGHT, PLATE_HEIGHT } from './dimensions';

// Approximate assembly, derived from the supplied STLs: the frames have a 3 mm floor and 16 mm walls;
// the plate sits on its 5.98 mm spacer and the map on its 8.28 mm spacer, below the 13 mm side lips.
const FILES = {
  upper: 'obj_8_Frame Upper.stl',
  lower: 'obj_3_Frame Lower.stl',
  lid: 'obj_5_Lid.stl',
  mapSpacer: 'obj_7_Map Spacer.stl',
} as const;
type PartKey = keyof typeof FILES;
const FLOOR = 3, PLATE_SPACER = 5.98, MAP_SPACER = 8.28;
const UPPER_LENGTH = 225, LOWER_LENGTH = 125;

let cache: Promise<Record<PartKey, BufferGeometry>> | undefined;

function normalize(geometry: BufferGeometry): BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -box.min.z);
  geometry.computeVertexNormals();
  return geometry;
}

export function loadAssemblyParts(): Promise<Record<PartKey, BufferGeometry>> {
  cache ??= (async () => {
    const loader = new STLLoader();
    const entries = await Promise.all((Object.entries(FILES) as [PartKey, string][]).map(async ([key, file]) => {
      const response = await fetch(`${import.meta.env.BASE_URL}generated/assembly/${encodeURIComponent(file)}`);
      if (!response.ok) throw new Error('The frame models could not be loaded for the assembled preview.');
      return [key, normalize(loader.parse(await response.arrayBuffer()))] as const;
    }));
    return Object.fromEntries(entries) as Record<PartKey, BufferGeometry>;
  })().catch((error: unknown) => { cache = undefined; throw error; });
  return cache;
}

/**
 * Builds a display preview. Plate and map are shallow clones sharing geometry/materials with the originals,
 * so only dispose the frame materials (via `disposeAssembly`), never the shared geometry.
 */
export function buildAssembly(parts: Record<PartKey, BufferGeometry>, plate: Group, map: Group): Group {
  const group = new Group();
  group.name = 'Assembled display (approximate)';
  const frameMaterial = new MeshStandardMaterial({ color: '#f1efe7', roughness: 0.65, transparent: true, opacity: 0.92 });
  const spacerMaterial = new MeshStandardMaterial({ color: '#8b8f86', roughness: 0.8 });
  const add = (geometry: BufferGeometry, material: MeshStandardMaterial, x: number, y: number, z: number, rotation = 0) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rotation;
    mesh.userData.assemblyOnly = true;
    group.add(mesh);
  };
  // Upper frame (plate) above, lower frame (map) below, joined at their low end walls.
  add(parts.upper, frameMaterial, 0, UPPER_LENGTH / 2, 0);
  add(parts.lower, frameMaterial, 0, -LOWER_LENGTH / 2, 0, Math.PI);
  add(parts.lid, frameMaterial, 0, UPPER_LENGTH + 4, 0, Math.PI / 2);
  const mapCenter = -(LOWER_LENGTH - 3.5 - MAP_TILE_HEIGHT / 2) - 0.8;
  add(parts.mapSpacer, spacerMaterial, 0, mapCenter, FLOOR, Math.PI / 2);
  const plateClone = plate.clone();
  plateClone.position.set(0, 3 + PLATE_HEIGHT / 2, FLOOR + PLATE_SPACER);
  const mapClone = map.clone();
  // Keep the map's own fitted transform, then lift it onto the spacer.
  mapClone.position.set(map.position.x, map.position.y + mapCenter, map.position.z + FLOOR + MAP_SPACER);
  group.add(plateClone, mapClone);
  return group;
}

export function disposeAssembly(group: Group): void {
  const materials = new Set<MeshStandardMaterial>();
  group.children.forEach((child) => { if (child instanceof Mesh && child.userData.assemblyOnly) materials.add(child.material as MeshStandardMaterial); });
  materials.forEach((material) => material.dispose());
}

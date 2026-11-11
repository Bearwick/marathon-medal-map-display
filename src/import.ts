import { Box3, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { strFromU8, unzipSync } from 'fflate';
import { disposeGroup, fitMap, part } from './geometry';

export const MAX_MAP_FILE_MB = 100;
export const MAX_MAP_FILE_BYTES = MAX_MAP_FILE_MB * 1024 * 1024;
export const MAX_EXPANDED_MAP_MB = 512;
export const MAX_EXPANDED_MAP_BYTES = MAX_EXPANDED_MAP_MB * 1024 * 1024;
export const MAX_MAP_TRIANGLES = 5_000_000;

export function validateMapTriangleCount(count: number): void {
  if (count > MAX_MAP_TRIANGLES) throw new Error('Use a map with at most 5 million triangles, including repeated instances.');
}

export function validateMapFileSize(bytes: number): void {
  if (bytes > MAX_MAP_FILE_BYTES) throw new Error(`Map files must be at most ${MAX_MAP_FILE_MB} MB.`);
}

export function validateExpandedMapSize(bytes: number): void {
  if (bytes > MAX_EXPANDED_MAP_BYTES) throw new Error(`The expanded 3MF exceeds ${MAX_EXPANDED_MAP_MB} MB. Export a simpler map.`);
}

export interface ImportedMap {
  group: Group;
  source: Uint8Array | undefined;
  parts: Mesh[];
  dimensions: { width: number; height: number; depth: number };
}

export function importMap(buffer: ArrayBuffer, filename: string): ImportedMap {
  validateMapFileSize(buffer.byteLength);
  let group: Group;
  let source: Uint8Array | undefined;
  if (filename.toLowerCase().endsWith('.3mf')) {
    let expanded = 0;
    let entries = 0;
    const files = unzipSync(new Uint8Array(buffer), { filter: (file) => {
      if (++entries > 10000) throw new Error('The 3MF contains too many archive entries.');
      expanded += file.originalSize;
      validateExpandedMapSize(expanded);
      return true;
    } });
    const models = Object.entries(files).filter(([name]) => name.endsWith('.model'));
    if (!models.length) throw new Error('The 3MF does not contain a model.');
    let triangles = 0;
    for (const [, bytes] of models) {
      const xml = strFromU8(bytes);
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('3MF XML entities are not supported.');
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('The 3MF contains invalid XML.');
      if (doc.getElementsByTagNameNS('*', 'texture2d').length || doc.getElementsByTagNameNS('*', 'texture2dgroup').length) {
        throw new Error('Textured 3MF files cannot be recoloured reliably. Export named solid-colour parts instead.');
      }
      if (doc.getElementsByTagNameNS('*', 'colorgroup').length || doc.getElementsByTagNameNS('*', 'multiproperties').length) {
        throw new Error('Per-vertex or mixed-property 3MF colours are not supported. Export named parts with base-material colours instead.');
      }
      const unit = doc.documentElement.getAttribute('unit') || 'millimeter';
      if (unit !== 'millimeter') throw new Error('Please export the 3MF in millimetres before importing.');
      triangles += doc.getElementsByTagNameNS('*', 'triangle').length;
      validateMapTriangleCount(triangles);
    }
    group = new ThreeMFLoader().parse(buffer);
    source = new Uint8Array(buffer);
  } else if (filename.toLowerCase().endsWith('.stl')) {
    group = new Group();
    group.add(part('Map (single STL body)', new STLLoader().parse(buffer), '#c9c7bc'));
  } else {
    throw new Error('Choose a .3mf or .stl file.');
  }
  try {
    const parts: Mesh[] = [];
    let triangleCount = 0;
    group.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      triangleCount += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
      validateMapTriangleCount(triangleCount);
      if (!object.geometry.hasAttribute('normal')) object.geometry.computeVertexNormals();
      object.name ||= `Map part ${parts.length + 1}`;
      const originalMaterial = object.material;
      const materials = Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial];
      const replacements = materials.map((material) => new MeshStandardMaterial({
        color: 'color' in material ? material.color : '#c9c7bc', roughness: 0.8,
      }));
      object.material = Array.isArray(originalMaterial) ? replacements : replacements[0];
      parts.push(object);
    });
    if (!parts.length) throw new Error('The map file contains no printable meshes.');
    const size = new Box3().setFromObject(group).getSize(new Vector3());
    if (size.z > Math.max(size.x, size.y)) throw new Error('The map appears upright. Export it flat with Z pointing up.');
    group.name = 'Custom detailed map';
    const dimensions = fitMap(group);
    return { group, source, parts, dimensions };
  } catch (error) {
    disposeGroup(group);
    throw error;
  }
}

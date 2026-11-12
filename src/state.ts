import type { BufferGeometry, Group } from 'three';
import type { Font } from 'three/addons/loaders/FontLoader.js';
import { kitCharacters } from './data';
import type { Design, KitCounts, ResultKey } from './data';
import type { CommunityCourse } from './community';
import type { Track } from './gpx';
import type { ImportedMap } from './import';
import type { MapOptions } from './map/generate';
import type { Frame } from './projection';
import type { Viewer } from './viewer';

export type Step = 'plate' | 'map' | 'print';

/** All mutable studio state. Rendering reads it; actions in main.ts change it. */
export interface StudioState {
  design: Design;
  mapOptions: MapOptions;
  frame?: Frame;
  active: Step;
  assembled: boolean;
  fonts: Map<string, Font>;
  base?: BufferGeometry;
  plate?: Group;
  example?: Group;
  routePreview?: Group;
  assembly?: Group;
  track?: Track;
  imported?: ImportedMap;
  mapFile?: { name: string; bytes: Uint8Array };
  communityCourses: CommunityCourse[];
  catalogueState: 'loading' | 'ready' | 'error';
  catalogueError: string;
  /** Invalid catalogue entries that were skipped (shown to the user; the valid ones still load). */
  catalogueWarnings: string[];
  activeCourse?: CommunityCourse;
  /** Course to restore from a saved design or shared link once the catalogue has loaded. */
  pendingCourseId?: string;
  proposalError: string;
  courseController?: AbortController;
  viewer?: Viewer;
  plateError: string;
  mapError: string;
  glueError: string;
  completeError: string;
  completeCharacters: 'kit' | 'exact';
  completeExporting: boolean;
  generating: boolean;
  generateStatus: string;
  pickerError: string;
  notice: string;
  kitField: ResultKey;
  kitCounts: KitCounts;
  ready: boolean;
  busy: boolean;
  revision: number;
}

export function createState(design: Design, mapOptions: MapOptions, frame?: Frame, pendingCourseId?: string): StudioState {
  return {
    design, mapOptions, frame, pendingCourseId, active: 'plate', assembled: false, fonts: new Map(),
    communityCourses: [], catalogueState: 'loading', catalogueError: '', catalogueWarnings: [], proposalError: '',
    plateError: '', mapError: '', glueError: '', completeError: '', completeCharacters: 'kit', completeExporting: false,
    generating: false, generateStatus: '', pickerError: '', notice: '',
    kitField: 'time', kitCounts: Object.fromEntries([...kitCharacters].map((character) => [character, 2])),
    ready: false, busy: false, revision: 0,
  };
}

export function errorMessage(error: unknown): string {
  console.error(error);
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

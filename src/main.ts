import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import './style.css';
import { Color, Group, MeshStandardMaterial } from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import type { Font } from 'three/addons/loaders/FontLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { strToU8, zipSync } from 'fflate';
import { distances, fonts, paceText, races, resultKeys } from './data';
import type { ColourKey, FontId, Placement, ResultKey } from './data';
import { download, export3mf, exportStls } from './export';
import { disposeGroup, makeGlueCharacters, makePlate, makeRoutePreview, normalizeBase, part } from './geometry';
import { MAX_GPX_BYTES, MAX_GPX_MB, parseGpx, trackLonLat } from './gpx';
import { importMap, MAX_MAP_FILE_BYTES, validateMapFileSize } from './import';
import { Viewer } from './viewer';
import { catalogueEntryForProposal, raceFolder, fetchCommunityFile, matchingCourses, parseCatalogueEntries, proposalIssueUrl, repositoryUrl, validateProposal } from './community';
import type { CommunityCourse, Proposal } from './community';
import { exportCompleteDisplay } from './complete';
import { bestFrameForPoints } from './projection';
import type { Frame } from './projection';
import { cancelGeneration, generateMapInWorker } from './map/client';
import type { MapOptions } from './map/generate';
import { buildAssembly, disposeAssembly, loadAssemblyParts } from './assembly';
import { clearSavedState, encodeShare, loadState, saveState } from './persist';
import { createState, errorMessage } from './state';
import type { Step } from './state';
import { courseHint, platePanel } from './ui/plate';
import { frameSummary, generatedIsStale, mapPanel, sliderToWidth, widthToSlider } from './ui/map';
import { printPanel } from './ui/print';
import type { AreaPicker } from './map/picker';

const app = document.querySelector<HTMLDivElement>('#app')!;
const loaded = loadState();
const state = createState(loaded.state.design, loaded.state.mapOptions, loaded.state.frame, loaded.state.courseId);
if (loaded.from === 'link') {
  state.notice = 'Loaded a shared design. Shared links never contain uploaded files; generate the map again in step 02.';
  history.replaceState(null, '', location.pathname + location.search);
}
let timer: ReturnType<typeof setTimeout>;
let saveTimer: ReturnType<typeof setTimeout>;
let previewTimer: ReturnType<typeof setTimeout>;
let picker: AreaPicker | undefined;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => app.querySelector<T>(selector)!;
const BASE = import.meta.env.BASE_URL;

app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="./" aria-label="Finishline home"><span class="brand-mark" aria-hidden="true">f<span>.</span></span>finishline<span class="brand-sub">MEDAL & MAP STUDIO</span></a>
    <a class="header-link" href="${repositoryUrl}" target="_blank" rel="noopener noreferrer">Open source <span aria-hidden="true">↗</span></a>
  </header>
  <main>
    <section class="intro"><h1>Make your<br><em>race tangible.</em></h1></section>
    <div id="notice" class="notice-banner" role="status" hidden></div>
    <div class="workspace">
      <section class="editor" aria-label="Design controls">
        <nav class="steps" role="tablist" aria-label="Design steps">
          <button role="tab" id="tab-plate" data-tab="plate" aria-controls="panel" aria-selected="true" class="selected"><span>01</span> The plate</button>
          <button role="tab" id="tab-map" data-tab="map" aria-controls="panel" aria-selected="false" tabindex="-1"><span>02</span> The map</button>
          <button role="tab" id="tab-print" data-tab="print" aria-controls="panel" aria-selected="false" tabindex="-1"><span>03</span> Make it</button>
        </nav>
        <div id="panel" class="panel" role="tabpanel" aria-labelledby="tab-plate"></div>
        <div id="editor-error" class="error" role="alert" hidden></div>
        <div class="editor-tools"><button class="text-button" id="share-link">Copy share link</button><button class="text-button" id="start-over">Start over</button><span id="tools-status" role="status"></span></div>
      </section>
      <section class="preview-section" aria-label="Model preview">
        <div class="preview-top"><span><span class="status-dot"></span> LIVE PREVIEW</span><span id="preview-type">MEDAL PLATE</span></div>
        <div id="viewer"><p class="loading">Preparing your studio…</p></div>
        <div class="preview-overlay"><span id="preview-badge">143 × 222 MM · ORIGINAL FIT</span><div class="view-actions"><button id="assembled-view" aria-pressed="false" title="Show the plate and map in the frame">Assembled</button><button id="top-view" title="View model from above">Top view</button><button id="reset-view" title="Reset model view">Reset view ↗</button></div></div>
        <div class="preview-bottom"><span>↔ Drag to rotate <span class="hint-divider">/</span> Scroll to zoom</span></div>
      </section>
    </div>
  </main>
  <footer><span class="footer-brand">finishline.</span><a href="${BASE}generated/THIRD-PARTY-NOTICES.txt" target="_blank" rel="noopener noreferrer">Third-party notices</a><a href="${repositoryUrl}#readme" target="_blank" rel="noopener noreferrer">Print guide ↗</a></footer>
`;

// ---------- Persistence ----------

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState({ design: state.design, mapOptions: state.mapOptions, frame: state.frame, courseId: state.activeCourse?.id }), 400);
}

function showNotice(): void {
  $('#notice').textContent = state.notice;
  $('#notice').hidden = !state.notice;
}

// ---------- Rendering ----------

function renderPanel(): void {
  const panel = $('#panel');
  panel.setAttribute('aria-labelledby', `tab-${state.active}`);
  panel.innerHTML = state.active === 'plate' ? platePanel(state) : state.active === 'map' ? mapPanel(state) : printPanel(state);
  if (state.active === 'map') void attachPicker();
  updateStatus();
}

function updateStatus(): void {
  const controls = app.querySelector<HTMLElement>('[aria-label="Design controls"]');
  if (controls) controls.inert = state.completeExporting;
  const { active, mapError, plateError, glueError, completeError, busy, ready, imported } = state;
  const error = active === 'map' ? mapError : active === 'print' ? [plateError, mapError, glueError, completeError].filter(Boolean).join(' ') : plateError;
  $('#editor-error').textContent = error;
  $('#editor-error').hidden = !error;
  for (const button of app.querySelectorAll<HTMLButtonElement>('[data-export]')) {
    const isMap = button.dataset.export!.startsWith('map');
    button.disabled = !ready || busy || (isMap ? !imported || !!mapError || state.generating : !!plateError);
  }
  for (const button of app.querySelectorAll<HTMLButtonElement>('[data-community], #prepare-proposal')) button.disabled = busy || !ready || state.generating;
  const completeButton = app.querySelector<HTMLButtonElement>('#complete-download');
  if (completeButton) completeButton.disabled = busy || !ready || !!plateError || !!mapError || state.generating;
  const generateButton = app.querySelector<HTMLButtonElement>('#generate-map');
  if (generateButton) generateButton.disabled = state.generating || busy || !state.frame;
  $<HTMLButtonElement>('#assembled-view').setAttribute('aria-pressed', String(state.assembled));
}

function refreshCourseHint(): void {
  const hint = app.querySelector('#course-hint');
  if (hint) hint.innerHTML = courseHint(state);
}

// ---------- Fonts and plate ----------

async function loadFont(id: FontId): Promise<Font> {
  const cached = state.fonts.get(id);
  if (cached) return cached;
  const file = fonts.find((font) => font.id === id)!.file;
  const response = await fetch(`${BASE}generated/fonts/${file}`);
  if (!response.ok) throw new Error('The plate font could not be loaded. Refresh the page to try again.');
  const font = new FontLoader().parse(await response.json());
  state.fonts.set(id, font);
  return font;
}

function rebuildPlate(): void {
  if (!state.ready || !state.base) return;
  const font = state.fonts.get(state.design.font);
  if (!font) {
    state.plateError = 'Loading font…';
    updateStatus();
    void loadFont(state.design.font).then(rebuildPlate, (error: unknown) => { state.plateError = errorMessage(error); updateStatus(); });
    return;
  }
  try {
    const next = makePlate(state.design, font, state.base);
    if (state.plate) disposeGroup(state.plate);
    state.plate = next;
    state.plateError = '';
    const pace = app.querySelector<HTMLInputElement>('[data-field="pace"]');
    if (pace && state.design.autoPace && state.design.placements.pace !== 'hidden') {
      try { pace.value = paceText(state.design); } catch (error) {
        if (state.design.placements.pace === 'attached') throw error;
        pace.value = '';
      }
    }
    if (state.assembled) void showPreview(false);
    else if (state.active !== 'map') state.viewer?.show(state.plate);
  } catch (error) {
    state.plateError = errorMessage(error);
  }
  updateStatus();
}

// ---------- Preview ----------

async function loadExample(): Promise<Group> {
  if (!state.example) {
    const response = await fetch(`${BASE}generated/example-map-preview.stl`);
    if (!response.ok) throw new Error('Unable to load the reference map.');
    const geometry = normalizeBase(new STLLoader().parse(await response.arrayBuffer()));
    geometry.computeVertexNormals(); // The decimated preview stores no facet normals.
    state.example = new Group();
    state.example.add(part('Supplied reference map', geometry, '#c6cbbb'));
  }
  return state.example;
}

function setBadge(type: string, badge: string): void {
  $('#preview-type').textContent = type;
  $('#preview-badge').textContent = badge;
}

async function showMap(reset: boolean): Promise<void> {
  const { imported, track, activeCourse } = state;
  setBadge(imported ? (imported.generated ? 'GENERATED MAP' : 'DETAILED MAP') : track ? 'GPX SCHEMATIC' : 'REFERENCE MAP',
    imported ? (imported.generated ? '133 × 117 MM WINDOW · 141 × 121 TILE' : 'SCALED TO FIT · CHECK HEIGHT') : track ? 'ROUTE ONLY · GENERATE FOR A MAP' : 'SUPPLIED EXAMPLE · NOT YOUR COURSE');
  if (activeCourse && !imported?.generated) $('#preview-badge').textContent = `${activeCourse.curation === 'maintainer' ? 'KNOWN COURSE' : 'COMMUNITY'} · UNOFFICIAL · ${activeCourse.year}`;
  if (imported) state.viewer?.show(imported.group, reset);
  else if (track) {
    if (state.routePreview) disposeGroup(state.routePreview);
    state.routePreview = makeRoutePreview(track, state.design.colours.route, '#c6cbbb', state.frame);
    state.viewer?.show(state.routePreview, reset);
  } else {
    const example = await loadExample();
    if (state.active === 'map' && !state.track && !state.imported && !state.assembled) state.viewer?.show(example, reset);
  }
}

async function showAssembled(reset: boolean): Promise<void> {
  if (!state.plate) return;
  setBadge('ASSEMBLED DISPLAY', state.imported ? 'APPROXIMATE FIT · CHECK BY DRY-FITTING' : 'WITH EXAMPLE MAP · NOT YOUR COURSE');
  const [parts, map] = await Promise.all([loadAssemblyParts(), state.imported ? Promise.resolve(state.imported.group) : loadExample()]);
  if (!state.assembled || !state.plate) return;
  const next = buildAssembly(parts, state.plate, map);
  if (state.assembly) disposeAssembly(state.assembly);
  state.assembly = next;
  state.viewer?.show(next, reset);
}

async function showPreview(reset: boolean): Promise<void> {
  try {
    if (state.assembled) await showAssembled(reset);
    else if (state.active === 'map') await showMap(reset);
    else {
      setBadge('MEDAL PLATE', '143 × 222 MM · ORIGINAL FIT');
      if (state.plate) state.viewer?.show(state.plate, reset);
    }
  } catch (error) {
    state.mapError = errorMessage(error);
    updateStatus();
  }
}

// ---------- Map area picker ----------

function defaultFrame(): Frame {
  if (state.track) return bestFrameForPoints(trackLonLat(state.track).flat());
  const race = races.find((r) => r.id === state.design.raceId);
  return { center: race?.center ?? [10.7522, 59.9139], widthMeters: 8000, rotationDeg: 0 };
}

async function attachPicker(): Promise<void> {
  state.frame ??= defaultFrame();
  try {
    if (!picker) {
      const { AreaPicker } = await import('./map/picker');
      picker = new AreaPicker(state.frame, (frame) => setFrame(frame, { fromPicker: true }));
    }
    const slot = app.querySelector('#picker-slot');
    if (!slot || state.active !== 'map') return;
    slot.replaceChildren(picker.element);
    picker.setRoute(state.track ? trackLonLat(state.track) : []);
    picker.setFrame(state.frame);
    picker.resize();
    picker.fit(false);
  } catch (error) {
    state.pickerError = `Interactive map unavailable (${errorMessage(error)}). Use the sliders, “Fit to route” and “Centre on city” to set the area.`;
    const slot = app.querySelector('#picker-slot');
    if (slot) slot.innerHTML = `<p class="picker-fallback">${state.pickerError}</p>`;
  }
}

function setFrame(frame: Frame, { fit = false, fromPicker = false } = {}): void {
  state.frame = frame;
  const width = app.querySelector<HTMLInputElement>('#frame-width');
  if (width) {
    width.value = String(widthToSlider(frame.widthMeters));
    $('#frame-width-value').textContent = frame.widthMeters >= 1000 ? `${(frame.widthMeters / 1000).toFixed(frame.widthMeters >= 10_000 ? 0 : 1)} km` : `${Math.round(frame.widthMeters)} m`;
    $<HTMLInputElement>('#frame-rotation').value = String(Math.round(frame.rotationDeg));
    $('#frame-rotation-value').textContent = `${Math.round(frame.rotationDeg)}°`;
    $('#frame-summary').textContent = frameSummary(frame);
  }
  if (!fromPicker) picker?.setFrame(frame, fit);
  refreshStale();
  if (state.track && !state.imported && state.active === 'map' && !state.assembled) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => void showMap(false), 150);
  }
  scheduleSave();
}

function refreshStale(): void {
  const card = app.querySelector('#map-result');
  if (card && state.imported?.generated) {
    const stale = generatedIsStale(state);
    card.classList.toggle('stale', stale);
    const title = card.querySelector('strong');
    if (title) title.textContent = stale ? 'Map out of date — generate again to apply your changes' : 'Map ready';
  }
}

// ---------- Map state ----------

function clearMapState(): void {
  state.revision++;
  state.courseController?.abort();
  state.courseController = undefined;
  cancelGeneration();
  state.generating = false;
  state.busy = false;
  if (state.imported) disposeGroup(state.imported.group);
  state.imported = undefined;
  state.mapFile = undefined;
  state.activeCourse = undefined;
  state.proposalError = '';
  state.track = undefined;
  if (state.routePreview) disposeGroup(state.routePreview);
  state.routePreview = undefined;
  state.mapError = '';
  state.generateStatus = '';
  picker?.setRoute([]);
}

function communityCredits(course: CommunityCourse): string {
  return [
    `${course.curation === 'maintainer' ? 'KNOWN COURSE' : 'COMMUNITY COURSE'} — UNOFFICIAL / NOT ORGANIZER-VERIFIED`,
    course.title, `Race: ${course.raceId}`, `Edition: ${course.year}`,
    `Distance: ${course.distanceKm} km`, `Source: ${course.sourceUrl}`, ...(course.reviewUrl ? [`Review: ${course.reviewUrl}`] : []),
    `Licence: ${course.license}`, `Attribution: ${course.attribution}`,
    `Limitations: ${course.notes}`, 'Check edition, course accuracy, geometry and print fit before use.',
  ].join('\n');
}

/** All credits that must travel with the current map. */
function mapCredits(includeSettings = false): string | undefined {
  const parts: string[] = [];
  if (state.imported?.generated) {
    parts.push(`GENERATED MAP — DATA CREDITS\n${state.imported.generated.attribution}`);
    if (includeSettings) parts.push(`Generation settings:\n${state.imported.generated.settings}`);
  }
  if (state.activeCourse) parts.push(communityCredits(state.activeCourse));
  return parts.length ? parts.join('\n\n') : undefined;
}

function useTrack(next: ReturnType<typeof parseGpx> | undefined, fitFrame: boolean): void {
  state.track = next;
  picker?.setRoute(next ? trackLonLat(next) : []);
  if (next && fitFrame) state.frame = bestFrameForPoints(trackLonLat(next).flat());
  if (state.frame && fitFrame) picker?.setFrame(state.frame, true);
}

async function useCommunityCourse(id: string, restoring = false): Promise<void> {
  const course = restoring ? state.communityCourses.find((item) => item.id === id) : matchingCourses(state.communityCourses, state.design).find((item) => item.id === id);
  if (!course || state.busy || !state.ready) return;
  const token = ++state.revision;
  state.courseController?.abort();
  const controller = new AbortController();
  state.courseController = controller;
  state.busy = true;
  state.mapError = '';
  updateStatus();
  let nextMap: ReturnType<typeof importMap> | undefined;
  try {
    const [gpxBytes, mapBytes] = await Promise.all([
      course.files.gpx ? fetchCommunityFile(course.files.gpx, MAX_GPX_BYTES, controller.signal) : undefined,
      course.files.map ? fetchCommunityFile(course.files.map, MAX_MAP_FILE_BYTES, controller.signal) : undefined,
    ]);
    if (token !== state.revision) return;
    const nextTrack = gpxBytes ? parseGpx(new TextDecoder().decode(gpxBytes), course.title) : undefined;
    if (mapBytes && course.files.map) nextMap = importMap(new Uint8Array(mapBytes).buffer, course.files.map);
    if (state.imported) disposeGroup(state.imported.group);
    state.imported = nextMap;
    nextMap = undefined;
    useTrack(nextTrack, !(restoring && state.frame));
    state.mapFile = mapBytes && course.files.map ? { name: `map.${course.files.map.split('.').pop()}`, bytes: mapBytes } : undefined;
    state.activeCourse = course;
    state.proposalError = '';
    if (!restoring && course.date && course.date !== state.design.date) {
      state.design.date = course.date;
      rebuildPlate();
    }
    scheduleSave();
    if (state.active === 'map') renderPanel();
    if (state.active === 'map' || state.assembled) await showPreview(true);
  } catch (error) {
    controller.abort();
    if (nextMap) disposeGroup(nextMap.group);
    if (token === state.revision) state.mapError = errorMessage(error);
  } finally {
    if (token === state.revision) {
      state.busy = false;
      state.courseController = undefined;
      updateStatus();
    }
  }
}

async function loadCatalogue(): Promise<void> {
  state.catalogueState = 'loading';
  state.catalogueError = '';
  const refresh = () => {
    if (state.active === 'map' && app.querySelector('.community-section')) renderPanel();
    refreshCourseHint();
  };
  refresh();
  try {
    const bytes = await fetchCommunityFile('catalogue.json', 1024 * 1024);
    const { courses, errors } = parseCatalogueEntries(JSON.parse(new TextDecoder().decode(bytes)));
    state.communityCourses = courses;
    state.catalogueWarnings = errors;
    if (errors.length) console.warn(`Skipped ${errors.length} invalid course catalogue entr${errors.length === 1 ? 'y' : 'ies'}:`, errors);
    state.catalogueState = 'ready';
  } catch (error) {
    state.catalogueError = errorMessage(error);
    state.catalogueState = 'error';
  }
  refresh();
  const pending = state.pendingCourseId;
  state.pendingCourseId = undefined;
  if (pending && state.catalogueState === 'ready') {
    const waitReady = async () => { while (!state.ready) await new Promise((resolve) => setTimeout(resolve, 100)); };
    await waitReady();
    await useCommunityCourse(pending, true);
  }
}

async function generate(): Promise<void> {
  if (!state.frame || state.generating || state.busy) return;
  state.generating = true;
  state.mapError = '';
  state.generateStatus = 'Starting…';
  renderPanel();
  const token = state.revision;
  try {
    const result = await generateMapInWorker(state.frame, state.track ? trackLonLat(state.track) : undefined, state.mapOptions, state.design.colours.route, (message) => {
      state.generateStatus = message;
      const status = app.querySelector('#generate-status');
      if (status) status.textContent = message;
    });
    if (token !== state.revision) { disposeGroup(result.group); return; }
    if (state.imported) disposeGroup(state.imported.group);
    state.imported = result;
    state.mapFile = undefined;
    state.generateStatus = `Generated ${result.parts.length} named parts.`;
  } catch (error) {
    if (token === state.revision) {
      state.mapError = errorMessage(error);
      state.generateStatus = 'Map generation failed. See the error below.';
    }
  } finally {
    if (token === state.revision) {
      state.generating = false;
      if (state.active === 'map') renderPanel();
      await showPreview(true);
      updateStatus();
    }
  }
}

function recolourMap(): void {
  const map = state.imported;
  if (!map) return;
  if (map.generated) {
    const colours: Record<string, string> = { 'Map base': state.mapOptions.colours.base, Water: state.mapOptions.colours.water, Parks: state.mapOptions.colours.parks, Roads: state.mapOptions.colours.roads, Buildings: state.mapOptions.colours.buildings };
    for (const mesh of map.parts) {
      const colour = mesh.userData.route ? state.design.colours.route : colours[mesh.name];
      if (colour && mesh.material instanceof MeshStandardMaterial) mesh.material.color.set(colour);
    }
    return;
  }
  map.parts.forEach((mesh) => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.userData.originalColours ??= materials.map((m) => (m instanceof MeshStandardMaterial ? m.color.getHex() : 0xcccccc));
    materials.forEach((m, i) => {
      if (m instanceof MeshStandardMaterial) m.color.copy(new Color(mesh.userData.route ? state.design.colours.route : mesh.userData.originalColours[i]));
    });
  });
}

// ---------- Tabs ----------

async function switchTab(tab: Step): Promise<void> {
  clearTimeout(timer);
  rebuildPlate();
  state.active = tab;
  // Make it shows the assembled display by default; the other steps show their own part.
  state.assembled = tab === 'print';
  if (!state.assembled && state.assembly) { disposeAssembly(state.assembly); state.assembly = undefined; }
  for (const button of app.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    const selected = button.dataset.tab === tab;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  renderPanel();
  $('#panel').scrollIntoView({ block: 'nearest' });
  if (state.ready) await showPreview(true);
}

// ---------- Events ----------

app.addEventListener('keydown', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.dataset.tab || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const tabs: Step[] = ['plate', 'map', 'print'];
  const next = tabs[(tabs.indexOf(target.dataset.tab as Step) + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
  void switchTab(next).then(() => $<HTMLButtonElement>(`#tab-${next}`).focus());
});

app.addEventListener('input', (event) => {
  const target = event.target;
  const { design } = state;
  if (target instanceof Element && target.closest('#proposal-form')) {
    const link = $('#proposal-issue');
    link.hidden = true;
    link.removeAttribute('href');
    $('#proposal-status').textContent = 'Details changed. Prepare a new ZIP before opening the proposal.';
    return;
  }
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
  if (target.dataset.kit) { state.kitCounts[target.dataset.kit] = target.value === '' ? NaN : Number(target.value); state.glueError = ''; updateStatus(); }
  if (target.id === 'kit-field' && resultKeys.some((key) => key === target.value)) {
    state.kitField = target.value as ResultKey;
    state.glueError = '';
    updateStatus();
  }
  if (target.id === 'complete-characters' && (target.value === 'kit' || target.value === 'exact')) {
    state.completeCharacters = target.value;
    state.completeError = '';
    updateStatus();
  }
  // Map area and style.
  if (target.id === 'frame-width' && state.frame) setFrame({ ...state.frame, widthMeters: sliderToWidth(Number(target.value)) }, {});
  if (target.id === 'frame-rotation' && state.frame) setFrame({ ...state.frame, rotationDeg: Number(target.value) }, {});
  const optionSliders: Record<string, [keyof MapOptions, (v: number) => string]> = {
    'base-thickness': ['baseThickness', (v) => `${v.toFixed(1)} mm`],
    'road-scale': ['roadScale', (v) => `${Math.round(v * 100)}%`],
    'terrain-exaggeration': ['terrainExaggeration', (v) => `${v}×`],
    'building-scale': ['buildingScale', (v) => `${v}×`],
  };
  if (optionSliders[target.id]) {
    const [key, label] = optionSliders[target.id];
    (state.mapOptions[key] as number) = Number(target.value);
    $(`#${target.id}-value`).textContent = label(Number(target.value));
    refreshStale();
    scheduleSave();
  }
  if (target instanceof HTMLInputElement && target.dataset.layer) {
    state.mapOptions.layers[target.dataset.layer as keyof MapOptions['layers']] = target.checked;
    refreshStale();
    scheduleSave();
  }
  if (target.dataset.mapColour) {
    state.mapOptions.colours[target.dataset.mapColour as keyof MapOptions['colours']] = target.value;
    recolourMap();
    scheduleSave();
  }
  // Plate design.
  if (target instanceof HTMLInputElement && target.name === 'units' && (target.value === 'metric' || target.value === 'imperial')) {
    design.units = target.value;
    renderPanel();
  }
  const field = target.dataset.field;
  if (field && field in design) {
    const value = target.value;
    switch (field) {
      case 'distanceId':
        design.distanceId = value;
        design.title = distances.find((d) => d.id === value)!.title.replace(' · ', ' ');
        $<HTMLInputElement>('[data-field="title"]').value = design.title;
        $('#custom-distance').hidden = value !== 'custom';
        if (state.activeCourse && !matchingCourses([state.activeCourse], design).length) clearMapState();
        break;
      case 'raceId': {
        design.raceId = value;
        const race = races.find((r) => r.id === value);
        design.location = race?.city.toUpperCase() ?? '';
        if (race) design.units = race.units;
        $<HTMLInputElement>('[data-field="location"]').value = design.location;
        clearMapState();
        state.frame = race ? { center: race.center, widthMeters: 8000, rotationDeg: 0 } : state.frame;
        if (state.frame) picker?.setFrame(state.frame, true);
        renderPanel();
        break;
      }
      case 'customKm':
        design.customKm = value;
        if (state.activeCourse && !matchingCourses([state.activeCourse], design).length) clearMapState();
        break;
      case 'title': design.title = value; break;
      case 'location': design.location = value; break;
      case 'date': design.date = value; break;
      case 'time': design.time = value; break;
      case 'pace': design.pace = value; break;
      case 'bib': design.bib = value; break;
      case 'font':
        if (fonts.some((font) => font.id === value)) design.font = value as FontId;
        break;
    }
    refreshCourseHint();
  }
  if (target.dataset.placement) {
    const key = target.dataset.placement as 'time' | 'pace' | 'bib';
    design.placements[key] = target.value as Placement;
  }
  if (target.dataset.colour) {
    const key = target.dataset.colour as ColourKey;
    design.colours[key] = target.value;
    if (key === 'route') {
      if (state.imported) recolourMap();
      else if (state.active === 'map') void showMap(false);
    }
  }
  if (target.id === 'auto-pace' && target instanceof HTMLInputElement) {
    if (!target.checked) {
      try { design.pace = paceText(design); } catch (error) { state.plateError = errorMessage(error); }
    }
    design.autoPace = target.checked;
    const paceInput = $<HTMLInputElement>('[data-field="pace"]');
    paceInput.readOnly = design.autoPace;
    if (!design.autoPace) paceInput.value = design.pace;
  }
  scheduleSave();
  if (state.active === 'plate') {
    state.glueError = '';
    state.completeError = '';
    clearTimeout(timer);
    state.plateError = 'Updating printable geometry…';
    updateStatus();
    timer = setTimeout(rebuildPlate, 120);
  }
});

app.addEventListener('change', (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.id === 'route-part' && state.imported) {
    state.imported.parts.forEach((mesh, i) => { mesh.userData.route = target.value !== '' && i === Number(target.value); });
    recolourMap();
  }
  if (!(target instanceof HTMLInputElement) || target.type !== 'file') return;
  const file = target.files?.[0];
  if (!file) return;
  const token = ++state.revision;
  state.courseController?.abort();
  state.courseController = undefined;
  cancelGeneration();
  state.generating = false;
  state.busy = true;
  state.mapError = '';
  updateStatus();
  void (async () => {
    try {
      if (target.id === 'gpx-upload') {
        if (file.size > MAX_GPX_BYTES) throw new Error(`GPX files must be smaller than ${MAX_GPX_MB} MB.`);
        const parsed = parseGpx(await file.text(), file.name.replace(/\.gpx$/i, ''));
        if (token !== state.revision) return;
        if (state.imported) disposeGroup(state.imported.group);
        state.imported = undefined;
        state.mapFile = undefined;
        useTrack(parsed, true);
      } else {
        validateMapFileSize(file.size);
        const bytes = await file.arrayBuffer();
        if (token !== state.revision) return;
        const next = importMap(bytes, file.name);
        if (state.imported) disposeGroup(state.imported.group);
        if (state.activeCourse) useTrack(undefined, false);
        state.imported = next;
        state.mapFile = { name: `map.${file.name.toLowerCase().endsWith('.3mf') ? '3mf' : 'stl'}`, bytes: new Uint8Array(bytes) };
      }
      state.activeCourse = undefined;
      state.proposalError = '';
      state.generateStatus = '';
      scheduleSave();
      if (state.active === 'map') {
        renderPanel();
        await showPreview(true);
      }
    } catch (error) {
      if (token === state.revision) state.mapError = errorMessage(error);
    } finally {
      if (token === state.revision) { state.busy = false; updateStatus(); }
    }
  })();
});

app.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'proposal-form') return;
  event.preventDefault();
  if (state.busy || !state.ready) return;
  const issueLink = $<HTMLAnchorElement>('#proposal-issue');
  issueLink.hidden = true;
  issueLink.removeAttribute('href');
  try {
    if (!form.reportValidity()) return;
    const fields = new FormData(form);
    if (!['rights', 'privacy', 'public'].every((key) => fields.get(key) === 'on')) throw new Error('Confirm sharing permissions, privacy checks and public submission first.');
    const courseFiles: Record<string, Uint8Array> = {};
    if (state.track) courseFiles['route.gpx'] = strToU8(state.track.xml);
    if (state.mapFile) courseFiles[state.mapFile.name] = state.mapFile.bytes;
    const proposal: Proposal = {
      raceId: state.design.raceId, raceName: String(fields.get('raceName') ?? ''),
      year: Number(fields.get('year')), distanceKm: Number(fields.get('distanceKm')),
      sourceUrl: String(fields.get('sourceUrl') ?? ''), license: String(fields.get('license') ?? ''),
      attribution: String(fields.get('attribution') ?? ''), notes: String(fields.get('notes') ?? ''),
      files: Object.keys(courseFiles),
    };
    validateProposal(proposal);
    const issueUrl = proposalIssueUrl(proposal);
    // Same layout and schema as public/community/: copy the folder in and paste the entry into catalogue.json.
    const entry = catalogueEntryForProposal(proposal, Object.keys(courseFiles));
    const folder = `${raceFolder(proposal.raceId, proposal.raceName)}/${String(entry.id)}`;
    const files: Record<string, Uint8Array> = Object.fromEntries(Object.entries(courseFiles).map(([name, bytes]) => [`${folder}/${name}`, bytes]));
    files['catalogue-entry.json'] = strToU8(`${JSON.stringify(entry, null, 2)}\n`);
    files['SUBMISSION-INSTRUCTIONS.txt'] = strToU8([
      `Submitter: open ${repositoryUrl}/issues/new?template=community-map.md and attach this ZIP (or a public download link if too large). Nothing is published until a maintainer reviews and merges it.`,
      'The original files have NOT been anonymized. Inspect private locations, waypoints, timestamps and embedded 3MF source metadata before sharing. Retain all source credits and permissions.',
      '',
      `Maintainer: add the label approve-course to the issue to open a pull request automatically, or run: npm run course:add -- <this ZIP> --issue <number>. Manually: copy ${folder}/ into public/community/ (one folder per race, one subfolder per course) and add catalogue-entry.json as a new item in public/community/catalogue.json.`,
      'Replace ISSUE_NUMBER in reviewUrl with the review issue or pull request number (or set "curation": "maintainer" and remove reviewUrl for a course you add yourself).',
      state.design.raceId === 'custom' ? 'The race is not in src/data.ts yet: add it there and set raceId to its id before publishing.' : '',
      'Optionally add "date": "YYYY-MM-DD" for the edition. Then run npm test.',
    ].filter((line, i, all) => line || all[i - 1]).join('\n') + '\n');
    download(zipSync(files, { level: 6 }), 'finishline-community-proposal.zip', 'application/zip');
    issueLink.href = issueUrl;
    issueLink.hidden = false;
    state.proposalError = '';
    $('#proposal-status').textContent = 'ZIP prepared locally, not submitted. Open GitHub, attach the ZIP, review the details and submit the issue.';
  } catch (error) {
    state.proposalError = errorMessage(error);
    $('#proposal-status').textContent = 'Proposal preparation failed. Nothing was submitted.';
  }
  $('#proposal-error').textContent = state.proposalError;
  $('#proposal-error').hidden = !state.proposalError;
});

async function copyShareLink(): Promise<void> {
  const url = `${location.origin}${location.pathname}${encodeShare({ design: state.design, mapOptions: state.mapOptions, frame: state.frame, courseId: state.activeCourse?.id })}`;
  const status = $('#tools-status');
  try {
    await navigator.clipboard.writeText(url);
    status.textContent = 'Link copied. It includes your plate text, results and map area — not uploaded files.';
  } catch {
    status.innerHTML = '';
    const input = document.createElement('input');
    input.value = url;
    input.readOnly = true;
    input.setAttribute('aria-label', 'Share link');
    status.append('Copy this link (includes plate text and results): ', input);
    input.select();
  }
}

app.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button, a') : null;
  if (!target) return;
  if (target.id === 'complete-download') void downloadCompleteDisplay();
  if (target.id === 'retry-catalogue') void loadCatalogue();
  if (target.dataset.community) void useCommunityCourse(target.dataset.community);
  const tab = target.dataset.tab ?? target.dataset.go;
  if (tab === 'plate' || tab === 'map' || tab === 'print') void switchTab(tab);
  if (target.id === 'top-view') state.viewer?.reset(true);
  if (target.id === 'reset-view') state.viewer?.reset();
  if (target.id === 'assembled-view' || target.id === 'show-assembled') {
    state.assembled = !state.assembled;
    if (!state.assembled && state.assembly) { disposeAssembly(state.assembly); state.assembly = undefined; }
    if (state.active === 'print') renderPanel();
    updateStatus();
    void showPreview(true);
  }
  if (target.id === 'share-link') void copyShareLink();
  if (target.id === 'start-over' && confirm('Start over? This clears your saved design and map on this device.')) {
    clearSavedState();
    location.replace(location.pathname + location.search);
  }
  if (target.id === 'generate-map') void generate();
  if (target.id === 'cancel-generate') {
    cancelGeneration();
    state.revision++;
    state.generating = false;
    state.generateStatus = 'Cancelled.';
    renderPanel();
  }
  if (target.id === 'fit-route' && state.track) setFrame(bestFrameForPoints(trackLonLat(state.track).flat()), { fit: true });
  if (target.id === 'rotate-frame' && state.frame) setFrame({ ...state.frame, rotationDeg: ((state.frame.rotationDeg + 270) % 360) - 180 }, {});
  if (target.id === 'center-city') {
    const race = races.find((r) => r.id === state.design.raceId);
    if (race && state.frame) setFrame({ ...state.frame, center: race.center }, { fit: true });
  }
  if (target.id === 'clear-map') {
    state.revision++;
    state.courseController?.abort();
    state.courseController = undefined;
    state.busy = false;
    if (state.imported) disposeGroup(state.imported.group);
    if (state.activeCourse && state.imported && !state.imported.generated) useTrack(undefined, false);
    state.imported = undefined;
    state.mapFile = undefined;
    if (!state.track) state.activeCourse = undefined;
    state.mapError = '';
    state.generateStatus = '';
    renderPanel();
    void showPreview(true);
  }
  if (target.id === 'download-gpx' && state.track) {
    if (state.activeCourse) {
      download(zipSync({ 'route.gpx': strToU8(state.track.xml), 'CREDITS.txt': strToU8(communityCredits(state.activeCourse)) }), 'finishline-course-route.zip', 'application/zip');
    } else download(state.track.xml, 'finishline-route.gpx', 'application/gpx+xml');
  }
  if (target.dataset.export) exportPart(target.dataset.export);
});

function exportPart(kind: string): void {
  clearTimeout(timer);
  rebuildPlate();
  const isMap = kind.startsWith('map');
  const isGlue = kind.startsWith('exact') || kind.startsWith('kit');
  const existing = isMap ? state.imported?.group : state.plate;
  const font = state.fonts.get(state.design.font);
  if (!existing || !font || (isMap ? state.mapError : state.plateError) || state.busy) return;
  state.glueError = '';
  const selection = kind.startsWith('exact') ? 'exact' : state.kitField;
  const counts = { ...state.kitCounts };
  state.busy = true;
  updateStatus();
  const status = $('#download-status');
  status.textContent = 'Preparing your printable file…';
  setTimeout(() => {
    let generated: Group | undefined;
    try {
      if (isGlue) generated = makeGlueCharacters(state.design, font, selection, counts);
      const group = generated ?? existing;
      const source = isMap ? state.imported?.source : undefined;
      const is3mf = kind.endsWith('3mf');
      const credits = isMap ? mapCredits(true) : undefined;
      const bytes = is3mf ? export3mf(group, source, credits) : exportStls(group, source, credits);
      download(bytes, `finishline-${isGlue ? kind.startsWith('exact') ? 'exact-digits' : `${selection}-number-kit` : isMap ? 'map' : 'plate'}.${is3mf ? '3mf' : 'zip'}`, is3mf ? 'model/3mf' : 'application/zip');
      status.textContent = 'File prepared. Check your browser downloads, then open it in your slicer.';
    } catch (error) {
      const message = errorMessage(error);
      if (isGlue) state.glueError = message; else if (isMap) state.mapError = message; else state.plateError = message;
      status.textContent = 'Export failed. See the error below.';
    } finally {
      if (generated) disposeGroup(generated);
      state.busy = false;
      updateStatus();
    }
  }, 40);
}

async function downloadCompleteDisplay(): Promise<void> {
  if (!state.ready || state.busy || state.completeExporting) return;
  clearTimeout(timer);
  rebuildPlate();
  const font = state.fonts.get(state.design.font);
  if (!state.ready || state.busy || !state.plate || !font || state.plateError || state.mapError) return;
  const snapshot = structuredClone(state.design);
  const counts = { ...state.kitCounts };
  const selection = state.completeCharacters;
  const currentPlate = state.plate;
  const currentMap = state.imported;
  const credits = mapCredits();
  const status = $('#download-status');
  state.busy = true;
  state.completeExporting = true;
  state.completeError = '';
  status.textContent = 'Preparing all display models in one ZIP…';
  updateStatus();
  const characters: Group[] = [];
  try {
    const keys = resultKeys.filter((key) => snapshot.placements[key] === 'separate');
    if (keys.length) {
      if (selection === 'exact') characters.push(makeGlueCharacters(snapshot, font, 'exact', counts));
      else keys.forEach((key) => characters.push(makeGlueCharacters(snapshot, font, key, counts)));
    }
    const bytes = await exportCompleteDisplay({
      plate: currentPlate, map: currentMap?.group, characters,
      originalMapSource: currentMap?.source, credits, mapSettings: currentMap?.generated?.settings, usesExample: !currentMap,
    });
    download(bytes, 'finishline-complete-display.zip', 'application/zip');
    status.textContent = `Complete ZIP prepared.${currentMap ? '' : ' Includes the supplied EXAMPLE map, not your race course.'} Check your browser downloads.`;
  } catch (error) {
    state.completeError = errorMessage(error);
    status.textContent = 'Complete ZIP failed. No partial package was downloaded.';
  } finally {
    characters.forEach(disposeGroup);
    state.busy = false;
    state.completeExporting = false;
    updateStatus();
  }
}

// ---------- Start ----------

async function start(): Promise<void> {
  showNotice();
  renderPanel();
  try {
    const [font, baseResponse] = await Promise.all([
      loadFont(state.design.font),
      fetch(`${BASE}generated/plate-base.stl`),
    ]);
    if (!font || !baseResponse.ok) throw new Error('Studio assets could not be loaded. Refresh the page to try again.');
    state.base = normalizeBase(new STLLoader().parse(await baseResponse.arrayBuffer()));
    $('#viewer').replaceChildren();
    try { state.viewer = new Viewer($('#viewer')); } catch (error) {
      $('#viewer').textContent = `3D preview unavailable: ${errorMessage(error)}. Enable WebGL to see your model. Printable exports remain available.`;
    }
    state.ready = true;
    rebuildPlate();
    await showPreview(true);
  } catch (error) {
    state.plateError = errorMessage(error);
    $('#viewer').textContent = state.plateError;
    updateStatus();
  }
}

void start();
void loadCatalogue();

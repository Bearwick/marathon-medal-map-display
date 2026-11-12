import { races } from '../data';
import { MAP_HEIGHT, MAP_MAX_DEPTH, MAP_RIM_MAX_THICKNESS, MAP_WIDTH } from '../dimensions';
import { xmlEscape } from '../export';
import { MAX_GPX_MB } from '../gpx';
import { MAX_EXPANDED_MAP_MB, MAX_MAP_FILE_MB } from '../import';
import { generationKey } from '../map/client';
import { roadClassesFor } from '../map/generate';
import { trackLonLat } from '../gpx';
import { MAX_FRAME_METERS, MIN_FRAME_METERS } from '../projection';
import type { Frame } from '../projection';
import type { StudioState } from '../state';
import { colourControls } from './plate';
import { coursesPanel, proposalPanel } from './courses';

const SLIDER_STEPS = 1000;
export function widthToSlider(meters: number): number {
  return Math.round((Math.log(meters / MIN_FRAME_METERS) / Math.log(MAX_FRAME_METERS / MIN_FRAME_METERS)) * SLIDER_STEPS);
}
export function sliderToWidth(value: number): number {
  return MIN_FRAME_METERS * (MAX_FRAME_METERS / MIN_FRAME_METERS) ** (value / SLIDER_STEPS);
}

function distanceLabel(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km` : `${Math.round(meters)} m`;
}

export function frameSummary(frame: Frame | undefined): string {
  if (!frame) return 'Move the frame over your course.';
  const height = (frame.widthMeters * MAP_HEIGHT) / MAP_WIDTH;
  const detail = roadClassesFor(frame.widthMeters).size >= 7 ? 'all streets' : roadClassesFor(frame.widthMeters).size >= 6 ? 'local streets' : 'main roads only';
  return `${distanceLabel(frame.widthMeters)} × ${distanceLabel(height)} · 1 mm ≈ ${distanceLabel(frame.widthMeters / MAP_WIDTH)} · ${detail}`;
}

/** Whether the shown generated map no longer matches the chosen area/settings. */
export function generatedIsStale(state: StudioState): boolean {
  const generated = state.imported?.generated;
  if (!generated || !state.frame) return false;
  return generated.key !== generationKey(state.frame, state.track ? trackLonLat(state.track) : undefined, state.mapOptions, state.design.colours.route);
}

function toggle(state: StudioState, key: keyof StudioState['mapOptions']['layers'], label: string, help = ''): string {
  return `<label class="checkbox"><input type="checkbox" data-layer="${key}" ${state.mapOptions.layers[key] ? 'checked' : ''}> ${label}${help ? ` <span class="help-inline">${help}</span>` : ''}</label>`;
}

function slider(id: string, label: string, min: number, max: number, step: number, value: number, output: string): string {
  return `<label class="slider">${label}<span class="slider-row"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"><output for="${id}" id="${id}-value">${output}</output></span></label>`;
}

export function mapStylePanel(state: StudioState): string {
  const o = state.mapOptions;
  return `<details class="guide map-style" ${state.imported?.generated ? '' : 'open'}><summary>Map style</summary>
    <div class="layer-grid">
      ${toggle(state, 'route', 'Route')}${toggle(state, 'roads', 'Roads')}${toggle(state, 'water', 'Water')}
      ${toggle(state, 'parks', 'Parks & woods')}${toggle(state, 'terrain', 'Terrain relief')}${toggle(state, 'buildings', 'Buildings', '(small areas)')}
    </div>
    ${slider('base-thickness', 'Base thickness', 1, MAP_RIM_MAX_THICKNESS, 0.1, o.baseThickness, `${o.baseThickness.toFixed(1)} mm`)}
    ${slider('road-scale', 'Road width', 0.5, 2, 0.05, o.roadScale, `${Math.round(o.roadScale * 100)}%`)}
    ${slider('terrain-exaggeration', 'Terrain exaggeration', 1, 20, 0.5, o.terrainExaggeration, `${o.terrainExaggeration}×`)}
    ${slider('building-scale', 'Building height', 1, 6, 0.5, o.buildingScale, `${o.buildingScale}×`)}
    <div class="colour-grid">${(['base', 'water', 'parks', 'roads', 'buildings'] as const).map((key) => `<label class="colour-control"><input type="color" data-map-colour="${key}" value="${o.colours[key]}" aria-label="Map ${key} colour"><span>${key[0].toUpperCase()}${key.slice(1)}</span></label>`).join('')}</div>
    ${colourControls(state, ['route'])}
    <p class="help">The map is ${MAP_WIDTH} × ${MAP_HEIGHT} mm with a thin flat rim for the frame lip, at most ${MAP_MAX_DEPTH} mm deep. Terrain is scaled down automatically to fit.</p>
  </details>`;
}

function generatedCard(state: StudioState): string {
  const map = state.imported;
  if (!map) return '';
  const stale = generatedIsStale(state);
  const warnings = map.warnings.map((warning) => `<p class="warning-text">${xmlEscape(warning)}</p>`).join('');
  return `<div id="map-result" class="notice ${stale ? 'stale' : 'success'}"><strong>${map.generated ? (stale ? 'Map out of date — generate again to apply your changes' : 'Map ready') : 'Imported map ready'}</strong>
    <p>${map.dimensions.width.toFixed(1)} × ${map.dimensions.height.toFixed(1)} × ${map.dimensions.depth.toFixed(1)} mm${map.generated ? ' · generated from map data' : ' · scaled to fit'}.</p>
    ${warnings}
    ${map.generated ? '' : `<label>Route highlight<select id="route-part"><option value="">Choose route part</option>${map.parts.map((mesh, i) => `<option value="${i}" ${mesh.userData.route ? 'selected' : ''}>${xmlEscape(mesh.name)} (${i + 1})</option>`).join('')}</select></label><p class="help">Highlighting requires a separate named route part.</p>`}
    <button id="clear-map" class="text-button">Remove map</button></div>`;
}

export function mapPanel(state: StudioState): string {
  const { track, imported, design } = state;
  const race = races.find((r) => r.id === design.raceId);
  const generating = state.generating;
  return `
    <div class="section-heading"><h2>Route map</h2><span class="small-tag">02 / 03</span></div>
    ${race ? `<p class="help">${xmlEscape(race.name)} · <a href="${race.url}" target="_blank" rel="noopener noreferrer">Race organizer ↗</a></p>` : ''}
    ${coursesPanel(state)}
    <label class="upload-zone"><span class="upload-icon">↥</span><strong>${track ? 'Replace GPX route' : 'Upload your own GPX'}</strong><span>.gpx · max ${MAX_GPX_MB} MB</span><input id="gpx-upload" type="file" accept=".gpx,application/gpx+xml"><span class="upload-button">Choose GPX</span></label>
    ${track ? `<div class="track-card"><span class="status-dot"></span><strong>${xmlEscape(track.name)}</strong><span>${track.km.toFixed(2)} km · ${track.points.toLocaleString()} points</span><button class="text-button" id="download-gpx">${state.activeCourse ? 'Download GPX + credits' : 'Download GPX ↗'}</button></div>` : ''}
    <details class="guide"><summary>Get a GPX route</summary><p>Export your activity as GPX from Strava or draw one with <a href="https://onthegomap.com/" target="_blank" rel="noopener noreferrer">On The Go Map</a>. Check the course against your race edition.</p><a href="https://support.strava.com/hc/en-us/articles/216918437-Exporting-your-Data-and-Bulk-Export" target="_blank" rel="noopener noreferrer">Strava export guide ↗</a></details>
    <div class="divider"></div>
    <div class="subheading"><h3>Frame the map</h3><span>DRAG THE FRAME</span></div>
    <div id="picker-slot" class="picker-slot">${state.pickerError ? `<p class="picker-fallback">${xmlEscape(state.pickerError)}</p>` : '<p class="picker-fallback">Loading map…</p>'}</div>
    ${slider('frame-width', 'Area width', 0, 1000, 1, widthToSlider(state.frame?.widthMeters ?? 8000), state.frame ? distanceLabel(state.frame.widthMeters) : '')}
    ${slider('frame-rotation', 'Rotation', -180, 180, 1, Math.round(state.frame?.rotationDeg ?? 0), `${Math.round(state.frame?.rotationDeg ?? 0)}°`)}
    <p class="help" id="frame-summary">${frameSummary(state.frame)}</p>
    <div class="button-row"><button class="text-button" id="fit-route" ${track ? '' : 'disabled'}>Fit to route</button><button class="text-button" id="rotate-frame">Rotate 90°</button>${race ? '<button class="text-button" id="center-city">Centre on city</button>' : ''}</div>
    <p class="help">Generating downloads street, water, park and terrain data for the framed area from OpenFreeMap and AWS Terrain Tiles. Your GPX itself is never sent.</p>
    ${mapStylePanel(state)}
    <button class="primary" id="generate-map" ${generating || !state.frame ? 'disabled' : ''}>${generating ? 'Generating…' : imported?.generated ? 'Generate again' : 'Generate 3D map'} <span>⌁</span></button>
    ${generating ? '<button class="text-button" id="cancel-generate">Cancel</button>' : ''}
    <p class="help" id="generate-status" role="status">${xmlEscape(state.generateStatus)}</p>
    ${generatedCard(state)}
    ${!imported ? `<p class="help">${track ? 'Until you generate a map, the preview shows a route-only schematic.' : 'Until you choose a map, the example map is for reference only, not your race course.'}</p>` : ''}
    <details class="guide"><summary>Advanced: import your own 3MF/STL map</summary>
      <p>Made a map elsewhere (for example <a href="https://miniskyline.com/map" target="_blank" rel="noopener noreferrer">Mini Skyline</a>)? Use a ${MAP_WIDTH} × ${MAP_HEIGHT} mm footprint, keep the route as a separate named part and export a multipart 3MF. Smaller maps get a thin mounting rim for the frame lip.</p>
      <label class="file-label">Import map<input id="map-upload" type="file" accept=".3mf,.stl"><span class="help">3MF or STL · max ${MAX_MAP_FILE_MB} MB compressed / ${MAX_EXPANDED_MAP_MB} MB expanded · 5 million triangles.</span></label>
    </details>
    ${proposalPanel(state)}
    <button class="primary next-step" data-go="print">Next <span>→</span></button>`;
}

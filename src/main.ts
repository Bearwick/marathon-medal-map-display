import './style.css';
import { Color, Group, MeshStandardMaterial } from 'three';
import type { BufferGeometry } from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import type { Font } from 'three/addons/loaders/FontLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { distances, initialDesign, kitCharacters, paceText, races, resultKeys } from './data';
import type { ColourKey, KitCounts, Placement, ResultKey } from './data';
import { download, export3mf, exportStls, xmlEscape } from './export';
import { disposeGroup, makeGlueCharacters, makePlate, makeRoutePreview, normalizeBase, part } from './geometry';
import { parseGpx } from './gpx';
import type { Track } from './gpx';
import { importMap, MAX_EXPANDED_MAP_MB, MAX_MAP_FILE_BYTES, MAX_MAP_FILE_MB, validateMapFileSize } from './import';
import type { ImportedMap } from './import';
import { Viewer } from './viewer';
import { fetchCommunityFile, matchingCourses, parseCatalogue, proposalIssueUrl, repositoryUrl, validateProposal } from './community';
import type { CommunityCourse, Proposal } from './community';
import { strToU8, zipSync } from 'fflate';
import { exportCompleteDisplay } from './complete';

const app = document.querySelector<HTMLDivElement>('#app')!;
const design = initialDesign();
let active: 'plate' | 'map' | 'print' = 'plate';
let font: Font;
let base: BufferGeometry;
let plate: Group | undefined;
let example: Group | undefined;
let routePreview: Group | undefined;
let track: Track | undefined;
let imported: ImportedMap | undefined;
let mapFile: { name: string; bytes: Uint8Array } | undefined;
let communityCourses: CommunityCourse[] = [];
let catalogueState: 'loading' | 'ready' | 'error' = 'loading';
let catalogueError = '';
let activeCourse: CommunityCourse | undefined;
let proposalError = '';
let courseController: AbortController | undefined;
let viewer: Viewer | undefined;
let plateError = '';
let mapError = '';
let glueError = '';
let completeError = '';
let completeCharacters: 'kit' | 'exact' = 'kit';
let completeExporting = false;
let kitField: ResultKey = 'time';
const kitCounts: KitCounts = Object.fromEntries([...kitCharacters].map((character) => [character, 2]));
let ready = false;
let busy = false;
let revision = 0;
let timer: ReturnType<typeof setTimeout>;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => app.querySelector<T>(selector)!;

app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="./" aria-label="Finishline home"><span class="brand-mark" aria-hidden="true">f<span>.</span></span>finishline<span class="brand-sub">MEDAL & MAP STUDIO</span></a>
    <a class="header-link" href="https://github.com/Bearwick/marathon-medal-map-display" target="_blank" rel="noopener noreferrer">Open source <span aria-hidden="true">↗</span></a>
  </header>
  <main>
    <section class="intro"><h1>Make your<br><em>race tangible.</em></h1></section>
    <div class="workspace">
      <section class="editor" aria-label="Design controls">
        <nav class="steps" aria-label="Design steps">
          <button data-tab="plate" class="selected" aria-current="step"><span>01</span> The plate</button>
          <button data-tab="map"><span>02</span> The map</button>
          <button data-tab="print"><span>03</span> Make it</button>
        </nav>
        <div id="panel" class="panel"></div>
        <div id="editor-error" class="error" role="alert" hidden></div>
      </section>
      <section class="preview-section" aria-label="Model preview">
        <div class="preview-top"><span><span class="status-dot"></span> LIVE PREVIEW</span><span id="preview-type">MEDAL PLATE</span></div>
        <div id="viewer"><p class="loading">Preparing your studio…</p></div>
        <div class="preview-overlay"><span id="preview-badge">143 × 222 MM · ORIGINAL FIT</span><div class="view-actions"><button id="top-view" title="View model from above">Top view</button><button id="reset-view" title="Reset model view">Reset view ↗</button></div></div>
        <div class="preview-bottom"><span>↔ Drag to rotate <span class="hint-divider">/</span> Scroll to zoom</span></div>
      </section>
    </div>
  </main>
  <footer><span class="footer-brand">finishline.</span><a href="${import.meta.env.BASE_URL}generated/THIRD-PARTY-NOTICES.txt" target="_blank" rel="noopener noreferrer">Third-party notices</a><a href="https://github.com/Bearwick/marathon-medal-map-display#readme" target="_blank" rel="noopener noreferrer">Print guide ↗</a></footer>
`;

const colourLabels: Record<ColourKey, string> = { base: 'Plate base', title: 'Title', location: 'Location', date: 'Date', distance: 'Distance', time: 'Time', pace: 'Pace', bib: 'BIB', route: 'Route highlight' };

function colours(keys: ColourKey[]): string {
  return `<div class="colour-grid">${keys.map((key) => `<label class="colour-control"><input type="color" data-colour="${key}" value="${design.colours[key]}" aria-label="${colourLabels[key]} colour"><span>${colourLabels[key]}</span></label>`).join('')}</div>`;
}

function resultField(key: 'time' | 'pace' | 'bib', label: string, value: string, placeholder: string): string {
  return `<div class="result-row"><label>${label}<input data-field="${key}" value="${xmlEscape(value)}" placeholder="${placeholder}" maxlength="${key === 'bib' ? 10 : 9}" ${key === 'pace' && design.autoPace ? 'readonly aria-describedby="pace-help"' : ''}></label><label class="placement-label"><span>Print placement</span><select data-placement="${key}" aria-label="${label} print placement">${(['attached', 'separate', 'hidden'] as const).map((value) => `<option value="${value}" ${design.placements[key] === value ? 'selected' : ''}>${{ attached: 'On plate', separate: 'Glue-on digits', hidden: 'Do not print' }[value]}</option>`).join('')}</select></label></div>`;
}

function communityPanel(): string {
  const matches = matchingCourses(communityCourses, design);
  return `<section class="community-section" aria-label="Community courses">
    <h3>Community courses</h3>
    <p class="help">Unofficial maps match race, year and distance. Verify the course before printing.</p>
    ${catalogueState === 'loading' ? '<p role="status">Loading community recommendations…</p>' : catalogueState === 'error'
      ? `<div class="notice"><strong>Recommendations unavailable</strong><p>${xmlEscape(catalogueError)}</p><button class="text-button" id="retry-catalogue">Retry catalogue</button></div>`
      : matches.length ? matches.map((course) => `<article class="notice community-course">
        <strong>${xmlEscape(course.title)}</strong><p class="community-tag">COMMUNITY MAP — UNOFFICIAL</p>
        <p>${course.year} · ${course.distanceKm} km · ${course.files.gpx ? 'GPX track' : ''}${course.files.gpx && course.files.map ? ' + ' : ''}${course.files.map ? 'Printable map' : ''}</p>
        ${course.notes ? `<p>${xmlEscape(course.notes)}</p>` : ''}
        <p>Licence: ${xmlEscape(course.license)}<br>Credits: ${xmlEscape(course.attribution)}</p>
        <a href="${xmlEscape(course.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source ↗</a> · <a href="${xmlEscape(course.reviewUrl)}" target="_blank" rel="noopener noreferrer">Maintainer review ↗</a>
        <button class="secondary" data-community="${course.id}">Use this ${course.files.map ? 'map' : 'track'} <span>→</span></button>
      </article>`).join('') : '<p class="help">No matching community course yet. Upload yours to suggest one.</p>'}
    ${activeCourse ? `<div class="notice"><strong>Community course selected · unofficial</strong><p>Replacing its GPX or map removes this association.</p></div>` : ''}
  </section>`;
}

function proposalPanel(): string {
  if (!track && !mapFile) return '';
  const race = races.find((item) => item.id === design.raceId);
  return `<details class="guide" id="proposal-details"><summary>Suggest this course</summary>
    <p class="help">Prepare a ZIP and submit it with a public GitHub issue. Nothing is uploaded automatically; a maintainer must approve it.</p>
    <form id="proposal-form">
      <label>Race name<input name="raceName" required maxlength="100" value="${xmlEscape(race?.name || design.location)}"></label>
      <div class="field-grid"><label>Edition year<input name="year" type="number" required min="1900" max="2100" step="1" value="${xmlEscape(design.date.slice(0, 4))}"></label>
      <label>Official distance / km<input name="distanceKm" type="number" required min="0.1" max="1000" step="any" value="${design.distanceId === 'custom' ? xmlEscape(design.customKm) : distances.find((d) => d.id === design.distanceId)!.km}"></label></div>
      <label>Course source URL<input name="sourceUrl" type="url" required maxlength="500" placeholder="https://…"></label>
      <label>Redistribution licence or permission<input name="license" required maxlength="500" placeholder="For example CC BY 4.0, with source evidence"></label>
      <label>Required credits / attribution<input name="attribution" required maxlength="500" placeholder="Creator and all map-data sources"></label>
      <label>Course differences and print limitations<textarea name="notes" maxlength="1500" rows="3"></textarea></label>
      <p class="help">Included: ${track ? 'route.gpx' : ''}${track && mapFile ? ', ' : ''}${mapFile ? xmlEscape(mapFile.name) : ''}. Original files and metadata are not anonymized.</p>
      <label class="checkbox"><input type="checkbox" name="rights" required> I have permission to share these files with the stated credits.</label>
      <label class="checkbox"><input type="checkbox" name="privacy" required> I removed private locations, timestamps and personal data, including embedded 3MF metadata.</label>
      <label class="checkbox"><input type="checkbox" name="public" required> I understand this submission and attachments will be public and unofficial.</label>
      <button class="secondary" type="submit" id="prepare-proposal">Prepare ZIP <span>↧</span></button>
    </form>
    <p class="error" id="proposal-error" role="alert" hidden></p>
    <p class="help" id="proposal-status" role="status"></p>
    <a class="secondary" id="proposal-issue" target="_blank" rel="noopener noreferrer" hidden>Open GitHub issue <span>↗</span></a>
    <p class="help">Attach the ZIP. If it is too large, link to a public download you may redistribute.</p>
  </details>`;
}

function renderPanel(): void {
  if (active === 'plate') {
    let pace = design.pace;
    try { if (design.autoPace) pace = paceText(design); } catch { pace = ''; /* Validation is surfaced by rebuildPlate. */ }
    $('#panel').innerHTML = `
      <div class="section-heading"><h2>Medal plate</h2><span class="small-tag">01 / 03</span></div>
      <div class="field-grid"><label>Race distance<select data-field="distanceId">${distances.map((d) => `<option value="${d.id}" ${d.id === design.distanceId ? 'selected' : ''}>${d.title.replace(' · ', ' / ')}${d.id === 'custom' ? '' : ` · ${d.km} km`}</option>`).join('')}</select></label><label id="custom-distance" ${design.distanceId !== 'custom' ? 'hidden' : ''}>Distance / km<input data-field="customKm" type="number" min="0.1" max="1000" step="0.001" value="${xmlEscape(design.customKm)}"></label></div>
      <label>Plate title<input data-field="title" value="${xmlEscape(design.title)}" maxlength="40"></label>
      <label>Find your race<select data-field="raceId"><option value="custom" ${design.raceId === 'custom' ? 'selected' : ''}>My own adventure / enter manually</option>${races.map((r) => `<option value="${r.id}" ${r.id === design.raceId ? 'selected' : ''}>${r.name} · ${r.country}</option>`).join('')}</select></label>
      <div class="field-grid location-date"><label>Location / custom race name<input data-field="location" value="${xmlEscape(design.location)}" maxlength="48"></label><label>Race date<input data-field="date" type="date" value="${design.date}"></label></div>
      <div class="divider"></div>
      <div class="subheading"><h3>Race results</h3><span>OPTIONAL</span></div>
      ${resultField('time', 'Finish time', design.time, '03:42:18')}
      ${resultField('pace', 'Pace / km', pace, '5:16')}
      <label class="checkbox"><input type="checkbox" id="auto-pace" ${design.autoPace ? 'checked' : ''}> Calculate pace from time and distance</label>
      <p id="pace-help" class="help">Time: H:MM:SS · Pace: M:SS/km. Glue-on fields keep their labels on the plate.</p>
      ${resultField('bib', 'BIB number', design.bib, '2048')}
      <details class="colour-details"><summary><span class="colour-dots"><i></i><i></i><i></i></span> Colours <span>Customize ↗</span></summary>${colours(['base', 'title', 'location', 'date', 'distance', 'time', 'pace', 'bib'])}<p class="help">Different colours at the same height need a multi-material printer.</p></details>
      <button class="primary next-step" data-go="map">Next: make your map <span>→</span></button>
      `;
  } else if (active === 'map') {
    const race = races.find((r) => r.id === design.raceId);
    $('#panel').innerHTML = `
      <div class="section-heading"><h2>Route map</h2><span class="small-tag">02 / 03</span></div>
      <div class="notice"><strong>${race ? xmlEscape(race.name) : 'Your own race'}</strong><p>No verified course is included. Upload a GPX or get the course from the organizer.</p>${race ? `<a href="${race.url}" target="_blank" rel="noopener noreferrer">Race organizer ↗</a>` : ''}</div>
      ${communityPanel()}
      <label class="upload-zone"><span class="upload-icon">↥</span><strong>${track ? 'Replace GPX route' : 'Upload GPX route'}</strong><span>.gpx · max 12 MB</span><input id="gpx-upload" type="file" accept=".gpx,application/gpx+xml"><span class="upload-button">Choose GPX</span></label>
      ${track ? `<div class="track-card"><span class="status-dot"></span><strong>${xmlEscape(track.name)}</strong><span>${track.km.toFixed(2)} km · ${track.points.toLocaleString()} points</span><button class="text-button" id="download-gpx">${activeCourse ? 'Download GPX + credits' : 'Download GPX ↗'}</button></div><p class="help">GPX preview shows the route only, not terrain.</p>` : imported ? '' : '<p class="help">The example map is for reference only, not your race course.</p>'}
      ${colours(['route'])}
      <details class="guide"><summary>Get a GPX route</summary><p>Export your activity as GPX from Strava or draw one with <a href="https://onthegomap.com/" target="_blank" rel="noopener noreferrer">On The Go Map</a>. Check the course against your race edition.</p><a href="https://support.strava.com/hc/en-us/articles/216918437-Exporting-your-Data-and-Bulk-Export" target="_blank" rel="noopener noreferrer">Strava export guide ↗</a></details>
      <details class="guide"><summary>Create a detailed map</summary><p>Use Mini Skyline with your GPX. Set the footprint to 133 × 117 mm, keep the route as a separate named part, and export a multipart 3MF.</p><p class="help">To reduce file size, turn off landmark models, detailed stadiums, dormers and chimneys, stepped towers, church towers, minarets and domes, window detail, and bay windows. Choose thicker detail.</p><a class="secondary external-button" href="https://miniskyline.com/map" target="_blank" rel="noopener noreferrer">Open Mini Skyline <span>↗</span></a></details>
      <label class="file-label">Import detailed map<input id="map-upload" type="file" accept=".3mf,.stl"><span class="help">3MF or STL · max ${MAX_MAP_FILE_MB} MB compressed / ${MAX_EXPANDED_MAP_MB} MB expanded · 5 million triangles. Uniformly scaled to fit.</span></label>
      ${imported ? `<div class="notice success"><strong>Map ready</strong><p>${imported.dimensions.width.toFixed(1)} × ${imported.dimensions.height.toFixed(1)} × ${imported.dimensions.depth.toFixed(1)} mm · scaled to fit. Check height before printing.</p></div><label>Route highlight<select id="route-part"><option value="">Choose route part</option>${imported.parts.map((mesh, i) => `<option value="${i}" ${mesh.userData.route ? 'selected' : ''}>${xmlEscape(mesh.name)} (${i + 1})</option>`).join('')}</select></label><p class="help">Highlighting requires a separate named route part.</p><button id="clear-map" class="text-button">Remove map</button>` : ''}
      ${proposalPanel()}
      <button class="primary next-step" data-go="print">Next <span>→</span></button>`;
  } else {
    const glueKeys = resultKeys.filter((key) => design.placements[key] === 'separate');
    if (!glueKeys.includes(kitField)) kitField = glueKeys[0] ?? 'time';
    $('#panel').innerHTML = `
      <div class="section-heading"><h2>Print</h2><span class="small-tag">03 / 03</span></div>
      ${!imported ? '<div class="notice"><strong>Example map</strong><p>The ZIP includes the supplied example, not your race course.</p></div>' : ''}
      ${glueKeys.length ? `<label>Digits in complete ZIP<select id="complete-characters"><option value="kit" ${completeCharacters === 'kit' ? 'selected' : ''}>Number kits</option><option value="exact" ${completeCharacters === 'exact' ? 'selected' : ''}>Entered results only</option></select></label>` : ''}
      <button class="primary export-button" id="complete-download">Download complete display · ZIP <span>↧</span></button>
      <p class="help">One STL per display part. STL does not store colour.</p>
      <div class="divider"></div>
      <div class="export-card"><div class="export-icon">↧</div><div><h3>Medal plate</h3><p>143 × 222 mm · original base and slot</p></div></div>
      ${glueKeys.length ? `<div class="divider"></div><h3>Glue-on digits</h3>
      <p class="help">Print flat at 100%; glue above labels with 2.4 mm spacing. Start BIB digits 4 mm after #. Keep colon dots in position; use tweezers and keep small parts from children.</p>
      <button class="secondary" data-export="exact-3mf">Entered digits · 3MF <span>↧</span></button>
      <button class="secondary" data-export="exact-stl">Entered digits · STL ZIP <span>↧</span></button>
      <p class="help">Exact digits need entered results; number kits work before the race.</p>
      <label>Number kit field<select id="kit-field">${glueKeys.map((key) => `<option value="${key}" ${key === kitField ? 'selected' : ''}>${key.toUpperCase()} · matching colour</option>`).join('')}</select></label>
      <div class="kit-grid">${[...kitCharacters].map((character) => `<label>${character === ':' ? ': (colon)' : character}<input type="number" min="0" max="20" step="1" data-kit="${character}" aria-label="Copies of ${character === ':' ? 'colon' : character}" value="${kitCounts[character]}"></label>`).join('')}</div>
      <button class="secondary" data-export="kit-3mf">Number kit · 3MF <span>↧</span></button>
      <button class="secondary" data-export="kit-stl">Number kit · STL ZIP <span>↧</span></button>
      <p class="help">Choose 0–20 copies of each character.</p>` : ''}
      <div class="divider"></div>
      ${imported ? `<div class="export-card"><div class="export-icon">⌁</div><div><h3>Route map</h3><p>${imported.dimensions.width.toFixed(1)} × ${imported.dimensions.height.toFixed(1)} mm · imported</p></div></div>` : ''}
      ${activeCourse ? `<div class="notice"><strong>Community map — unofficial</strong><p>${xmlEscape(activeCourse.title)} · ${activeCourse.year} · ${activeCourse.distanceKm} km<br>Credits: ${xmlEscape(activeCourse.attribution)}<br>Licence: ${xmlEscape(activeCourse.license)}</p><a href="${xmlEscape(activeCourse.reviewUrl)}" target="_blank" rel="noopener noreferrer">View review and source details ↗</a></div>` : ''}
      ${imported ? '<p class="help">Map source and credits are included. Keep attribution and check its licence.</p>' : ''}
      <details class="guide"><summary>Print tips</summary><ul><li>Start with a 0.4 mm nozzle and 0.2 mm layers; inspect small details in the slicer.</li><li>Check the 143 × 222 mm bed fit, map clearance and dry-fit before gluing.</li><li>For a single-colour printer, add a layer change at 3.5 mm.</li></ul></details>
      <button class="text-button" data-go="plate">← Back</button>
      <div id="download-status" role="status" class="download-status"></div>`;
  }
  updateStatus();
}

function updateStatus(): void {
  const controls = app.querySelector<HTMLElement>('[aria-label="Design controls"]');
  if (controls) controls.inert = completeExporting;
  const error = active === 'map' ? mapError : active === 'print' ? [plateError, mapError, glueError, completeError].filter(Boolean).join(' ') : plateError;
  $('#editor-error').textContent = error;
  $('#editor-error').hidden = !error;
  for (const button of app.querySelectorAll<HTMLButtonElement>('[data-export]')) {
    const isMap = button.dataset.export!.startsWith('map');
    button.disabled = !ready || busy || (isMap ? !imported || !!mapError : !!plateError);
  }
  for (const button of app.querySelectorAll<HTMLButtonElement>('[data-community], #prepare-proposal')) button.disabled = busy || !ready;
  const completeButton = app.querySelector<HTMLButtonElement>('#complete-download');
  if (completeButton) completeButton.disabled = busy || !ready || !!plateError || !!mapError;
}

async function loadCatalogue(): Promise<void> {
  catalogueState = 'loading';
  catalogueError = '';
  const refresh = () => {
    const section = app.querySelector('.community-section');
    if (active === 'map' && section) {
      section.outerHTML = communityPanel();
      updateStatus();
    }
  };
  refresh();
  try {
    const bytes = await fetchCommunityFile('catalogue.json', 1024 * 1024);
    communityCourses = parseCatalogue(JSON.parse(new TextDecoder().decode(bytes)));
    catalogueState = 'ready';
  } catch (error) {
    catalogueError = errorMessage(error);
    catalogueState = 'error';
  }
  refresh();
}

function communityCredits(course: CommunityCourse): string {
  return [
    'COMMUNITY COURSE — UNOFFICIAL / NOT ORGANIZER-VERIFIED',
    course.title, `Race: ${course.raceId}`, `Edition: ${course.year}`,
    `Distance: ${course.distanceKm} km`, `Source: ${course.sourceUrl}`, `Review: ${course.reviewUrl}`,
    `Licence: ${course.license}`, `Attribution: ${course.attribution}`,
    `Limitations: ${course.notes}`, 'Check edition, course accuracy, geometry and print fit before use.',
  ].join('\n');
}

async function useCommunityCourse(id: string): Promise<void> {
  const course = matchingCourses(communityCourses, design).find((item) => item.id === id);
  if (!course || busy || !ready) return;
  const token = ++revision;
  courseController?.abort();
  const controller = new AbortController();
  courseController = controller;
  busy = true;
  mapError = '';
  updateStatus();
  let nextMap: ImportedMap | undefined;
  try {
    const [gpxBytes, mapBytes] = await Promise.all([
      course.files.gpx ? fetchCommunityFile(course.files.gpx, 12 * 1024 * 1024, controller.signal) : undefined,
      course.files.map ? fetchCommunityFile(course.files.map, MAX_MAP_FILE_BYTES, controller.signal) : undefined,
    ]);
    if (token !== revision) return;
    const nextTrack = gpxBytes ? parseGpx(new TextDecoder().decode(gpxBytes), course.title) : undefined;
    if (mapBytes && course.files.map) nextMap = importMap(new Uint8Array(mapBytes).buffer, course.files.map);
    if (imported) disposeGroup(imported.group);
    imported = nextMap;
    nextMap = undefined;
    track = nextTrack;
    mapFile = mapBytes && course.files.map ? { name: `map.${course.files.map.split('.').pop()}`, bytes: mapBytes } : undefined;
    activeCourse = course;
    proposalError = '';
    if (active === 'map') {
      renderPanel();
      await showMap(true);
    }
  } catch (error) {
    controller.abort();
    if (nextMap) disposeGroup(nextMap.group);
    if (token === revision) mapError = errorMessage(error);
  } finally {
    if (token === revision) {
      busy = false;
      courseController = undefined;
      updateStatus();
    }
  }
}

function rebuildPlate(): void {
  if (!ready) return;
  try {
    const next = makePlate(design, font, base);
    if (plate) disposeGroup(plate);
    plate = next;
    plateError = '';
    const pace = app.querySelector<HTMLInputElement>('[data-field="pace"]');
    if (pace && design.autoPace && design.placements.pace !== 'hidden') {
      try { pace.value = paceText(design); } catch (error) {
        if (design.placements.pace === 'attached') throw error;
        pace.value = '';
      }
    }
    if (active !== 'map') viewer?.show(plate);
  } catch (error) {
    plateError = errorMessage(error);
  }
  updateStatus();
}

function errorMessage(error: unknown): string {
  console.error(error);
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

async function showMap(reset: boolean): Promise<void> {
  $('#preview-type').textContent = imported ? 'DETAILED MAP' : track ? 'GPX SCHEMATIC' : 'REFERENCE MAP';
  $('#preview-badge').textContent = imported ? 'SCALED TO FIT · CHECK HEIGHT' : track ? 'ROUTE ONLY · NOT TERRAIN' : 'SUPPLIED EXAMPLE · NOT YOUR COURSE';
  if (activeCourse) $('#preview-badge').textContent = `COMMUNITY · UNOFFICIAL · ${activeCourse.year}`;
  if (imported) viewer?.show(imported.group, reset);
  else if (track) {
    if (routePreview) disposeGroup(routePreview);
    routePreview = makeRoutePreview(track, design.colours.route, '#c6cbbb');
    viewer?.show(routePreview, reset);
  } else {
    if (!example) {
      const response = await fetch(`${import.meta.env.BASE_URL}generated/example-map.stl`);
      if (!response.ok) throw new Error('Unable to load the reference map.');
      const geometry = normalizeBase(new STLLoader().parse(await response.arrayBuffer()));
      example = new Group();
      example.add(part('Supplied reference map', geometry, '#c6cbbb'));
    }
    if (active === 'map' && !track && !imported) viewer?.show(example, reset);
  }
}

async function switchTab(tab: typeof active): Promise<void> {
  clearTimeout(timer);
  rebuildPlate();
  active = tab;
  for (const button of app.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    const selected = button.dataset.tab === tab;
    button.classList.toggle('selected', selected);
    if (selected) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  renderPanel();
  if (!ready) return;
  if (tab === 'map') {
    try { await showMap(true); } catch (error) { mapError = errorMessage(error); updateStatus(); }
  } else {
    $('#preview-type').textContent = 'MEDAL PLATE';
    $('#preview-badge').textContent = '143 × 222 MM · ORIGINAL FIT';
    if (plate) viewer?.show(plate, true);
  }
}

function clearMapState(): void {
  revision++;
  courseController?.abort();
  courseController = undefined;
  busy = false;
  if (imported) disposeGroup(imported.group);
  imported = undefined;
  mapFile = undefined;
  activeCourse = undefined;
  proposalError = '';
  track = undefined;
  if (routePreview) disposeGroup(routePreview);
  routePreview = undefined;
  mapError = '';
}

app.addEventListener('input', (event) => {
  const target = event.target;
  if (target instanceof Element && target.closest('#proposal-form')) {
    const link = $('#proposal-issue');
    link.hidden = true;
    link.removeAttribute('href');
    $('#proposal-status').textContent = 'Details changed. Prepare a new ZIP before opening the proposal.';
    return;
  }
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
  if (target.dataset.kit) { kitCounts[target.dataset.kit] = target.value === '' ? NaN : Number(target.value); glueError = ''; updateStatus(); }
  if (target.id === 'kit-field' && resultKeys.some((key) => key === target.value)) {
    kitField = target.value as ResultKey;
    glueError = '';
    updateStatus();
  }
  if (target.id === 'complete-characters' && (target.value === 'kit' || target.value === 'exact')) {
    completeCharacters = target.value;
    completeError = '';
    updateStatus();
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
        clearMapState();
        break;
      case 'raceId': {
        design.raceId = value;
        design.location = races.find((r) => r.id === value)?.city.toUpperCase() ?? '';
        $<HTMLInputElement>('[data-field="location"]').value = design.location;
        clearMapState();
        break;
      }
      case 'customKm': design.customKm = value; clearMapState(); break;
      case 'title': design.title = value; break;
      case 'location': design.location = value; break;
      case 'date': design.date = value; clearMapState(); break;
      case 'time': design.time = value; break;
      case 'pace': design.pace = value; break;
      case 'bib': design.bib = value; break;
    }
  }
  if (target.dataset.placement) {
    const key = target.dataset.placement as 'time' | 'pace' | 'bib';
    design.placements[key] = target.value as Placement;
  }
  if (target.dataset.colour) {
    const key = target.dataset.colour as ColourKey;
    design.colours[key] = target.value;
    if (key === 'route' && active === 'map') {
      if (imported) recolourRoute();
      else void showMap(false).catch((error: unknown) => { mapError = errorMessage(error); updateStatus(); });
    }
  }
  if (target.id === 'auto-pace' && target instanceof HTMLInputElement) {
    if (!target.checked) {
      try { design.pace = paceText(design); } catch (error) { plateError = errorMessage(error); }
    }
    design.autoPace = target.checked;
    const paceInput = $<HTMLInputElement>('[data-field="pace"]');
    paceInput.readOnly = design.autoPace;
    if (!design.autoPace) paceInput.value = design.pace;
  }
  if (active === 'plate') {
    glueError = '';
    completeError = '';
    clearTimeout(timer);
    plateError = 'Updating printable geometry…';
    updateStatus();
    timer = setTimeout(rebuildPlate, 120);
  }
});

function recolourRoute(): void {
  if (!imported) return;
  imported.parts.forEach((mesh) => {
    if (!mesh.userData.originalColours) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mesh.userData.originalColours = materials.map((m) => m instanceof MeshStandardMaterial ? m.color.getHex() : 0xcccccc);
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((m, i) => {
      if (m instanceof MeshStandardMaterial) m.color.copy(new Color(mesh.userData.route ? design.colours.route : mesh.userData.originalColours[i]));
    });
  });
}

app.addEventListener('change', (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.id === 'route-part' && imported) {
    imported.parts.forEach((mesh, i) => { mesh.userData.route = target.value !== '' && i === Number(target.value); });
    recolourRoute();
  }
  if (!(target instanceof HTMLInputElement) || target.type !== 'file') return;
  const file = target.files?.[0];
  if (!file) return;
  const token = ++revision;
  courseController?.abort();
  courseController = undefined;
  busy = true;
  mapError = '';
  updateStatus();
  void (async () => {
    try {
      if (target.id === 'gpx-upload') {
        if (file.size > 12 * 1024 * 1024) throw new Error('GPX files must be smaller than 12 MB.');
        const parsed = parseGpx(await file.text(), file.name.replace(/\.gpx$/i, ''));
        if (token !== revision) return;
        if (imported) disposeGroup(imported.group);
        imported = undefined;
        mapFile = undefined;
        track = parsed;
      } else {
        validateMapFileSize(file.size);
        const bytes = await file.arrayBuffer();
        if (token !== revision) return;
        const next = importMap(bytes, file.name);
        if (imported) disposeGroup(imported.group);
        if (activeCourse) track = undefined;
        imported = next;
        mapFile = { name: `map.${file.name.toLowerCase().endsWith('.3mf') ? '3mf' : 'stl'}`, bytes: new Uint8Array(bytes) };
      }
      activeCourse = undefined;
      proposalError = '';
      if (active === 'map') {
        renderPanel();
        await showMap(true);
      }
    } catch (error) {
      if (token === revision) mapError = errorMessage(error);
    } finally {
      if (token === revision) { busy = false; updateStatus(); }
    }
  })();
});

app.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'proposal-form') return;
  event.preventDefault();
  if (busy || !ready) return;
  const issueLink = $<HTMLAnchorElement>('#proposal-issue');
  issueLink.hidden = true;
  issueLink.removeAttribute('href');
  try {
    if (!form.reportValidity()) return;
    const fields = new FormData(form);
    if (!['rights', 'privacy', 'public'].every((key) => fields.get(key) === 'on')) throw new Error('Confirm sharing permissions, privacy checks and public submission first.');
    const files: Record<string, Uint8Array> = {};
    if (track) files['route.gpx'] = strToU8(track.xml);
    if (mapFile) files[mapFile.name] = mapFile.bytes;
    if (activeCourse) files['COMMUNITY-CREDITS.txt'] = strToU8(communityCredits(activeCourse));
    const proposal: Proposal = {
      raceId: design.raceId, raceName: String(fields.get('raceName') ?? ''),
      year: Number(fields.get('year')), distanceKm: Number(fields.get('distanceKm')),
      sourceUrl: String(fields.get('sourceUrl') ?? ''), license: String(fields.get('license') ?? ''),
      attribution: String(fields.get('attribution') ?? ''), notes: String(fields.get('notes') ?? ''),
      files: Object.keys(files),
    };
    validateProposal(proposal);
    const issueUrl = proposalIssueUrl(proposal);
    files['proposal.json'] = strToU8(JSON.stringify({ ...proposal, status: 'pending-review', unofficial: true }, null, 2));
    files['SUBMISSION-INSTRUCTIONS.txt'] = strToU8(`Open ${repositoryUrl}/issues/new?template=community-map.md and attach this ZIP (or a public download link if too large). Copy proposal.json details into the issue if the prefilled form does not open. Nothing is published until a maintainer reviews and merges the files into the catalogue.\nThe original files have NOT been anonymized. Inspect private locations, timestamps and embedded 3MF source metadata before sharing. Retain all source credits and permissions.\n`);
    download(zipSync(files, { level: 6 }), 'finishline-community-proposal.zip', 'application/zip');
    issueLink.href = issueUrl;
    issueLink.hidden = false;
    proposalError = '';
    $('#proposal-status').textContent = 'ZIP prepared locally, not submitted. Open GitHub, attach the ZIP, review the details and submit the issue.';
  } catch (error) {
    proposalError = errorMessage(error);
    $('#proposal-status').textContent = 'Proposal preparation failed. Nothing was submitted.';
  }
  $('#proposal-error').textContent = proposalError;
  $('#proposal-error').hidden = !proposalError;
});

app.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button, a') : null;
  if (!target) return;
  if (target.id === 'complete-download') void downloadCompleteDisplay();
  if (target.id === 'retry-catalogue') void loadCatalogue();
  if (target.dataset.community) void useCommunityCourse(target.dataset.community);
  const tab = target.dataset.tab ?? target.dataset.go;
  if (tab === 'plate' || tab === 'map' || tab === 'print') void switchTab(tab);
  if (target.id === 'top-view') viewer?.reset(true);
  if (target.id === 'reset-view') viewer?.reset();
  if (target.id === 'clear-map') {
    revision++;
    courseController?.abort();
    courseController = undefined;
    busy = false;
    if (imported) disposeGroup(imported.group);
    if (activeCourse) track = undefined;
    imported = undefined;
    mapFile = undefined;
    activeCourse = undefined;
    mapError = '';
    renderPanel();
    void showMap(true).catch((error: unknown) => { mapError = errorMessage(error); updateStatus(); });
  }
  if (target.id === 'download-gpx' && track) {
    if (activeCourse) {
      download(zipSync({ 'route.gpx': strToU8(track.xml), 'COMMUNITY-CREDITS.txt': strToU8(communityCredits(activeCourse)) }), 'finishline-community-route.zip', 'application/zip');
    } else download(track.xml, 'finishline-route.gpx', 'application/gpx+xml');
  }
  if (target.dataset.export) {
    const kind = target.dataset.export;
    clearTimeout(timer);
    rebuildPlate();
    const isMap = kind.startsWith('map');
    const isGlue = kind.startsWith('exact') || kind.startsWith('kit');
    const existing = isMap ? imported?.group : plate;
    if (!existing || (isMap ? mapError : plateError) || busy) return;
    glueError = '';
    const selection = kind.startsWith('exact') ? 'exact' : kitField;
    const counts = { ...kitCounts };
    busy = true;
    updateStatus();
    const status = $('#download-status');
    status.textContent = 'Preparing your printable file…';
    setTimeout(() => {
      let generated: Group | undefined;
      try {
        if (isGlue) generated = makeGlueCharacters(design, font, selection, counts);
        const group = generated ?? existing;
        const source = isMap ? imported?.source : undefined;
        const is3mf = kind.endsWith('3mf');
        const credits = isMap && activeCourse ? communityCredits(activeCourse) : undefined;
        const bytes = is3mf ? export3mf(group, source, credits) : exportStls(group, source, credits);
        download(bytes, `finishline-${isGlue ? kind.startsWith('exact') ? 'exact-digits' : `${selection}-number-kit` : isMap ? 'map' : 'plate'}.${is3mf ? '3mf' : 'zip'}`, is3mf ? 'model/3mf' : 'application/zip');
        status.textContent = 'File prepared. Check your browser downloads, then open it in your slicer.';
      } catch (error) {
        const message = errorMessage(error);
        if (isGlue) glueError = message; else if (isMap) mapError = message; else plateError = message;
        status.textContent = 'Export failed. See the error below.';
      } finally {
        if (generated) disposeGroup(generated);
        busy = false;
        updateStatus();
      }
    }, 40);
  }
});

async function downloadCompleteDisplay(): Promise<void> {
  if (!ready || busy || completeExporting) return;
  clearTimeout(timer);
  rebuildPlate();
  if (!ready || busy || !plate || plateError || mapError) return;
  const snapshot = structuredClone(design);
  const counts = { ...kitCounts };
  const selection = completeCharacters;
  const currentPlate = plate;
  const currentMap = imported;
  const credits = activeCourse ? communityCredits(activeCourse) : undefined;
  const status = $('#download-status');
  busy = true;
  completeExporting = true;
  completeError = '';
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
      originalMapSource: currentMap?.source, credits, usesExample: !currentMap,
    });
    download(bytes, 'finishline-complete-display.zip', 'application/zip');
    status.textContent = `Complete ZIP prepared.${currentMap ? '' : ' Includes the supplied EXAMPLE map, not your race course.'} Check your browser downloads.`;
  } catch (error) {
    completeError = errorMessage(error);
    status.textContent = 'Complete ZIP failed. No partial package was downloaded.';
  } finally {
    characters.forEach(disposeGroup);
    busy = false;
    completeExporting = false;
    updateStatus();
  }
}

async function start(): Promise<void> {
  renderPanel();
  try {
    const [fontResponse, baseResponse] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}generated/font.json`),
      fetch(`${import.meta.env.BASE_URL}generated/plate-base.stl`),
    ]);
    if (!fontResponse.ok || !baseResponse.ok) throw new Error('Studio assets could not be loaded. Refresh the page to try again.');
    font = new FontLoader().parse(await fontResponse.json());
    base = normalizeBase(new STLLoader().parse(await baseResponse.arrayBuffer()));
    $('#viewer').replaceChildren();
    try { viewer = new Viewer($('#viewer')); } catch (error) {
      $('#viewer').textContent = `3D preview unavailable: ${errorMessage(error)}. Enable WebGL to see your model. Printable exports remain available.`;
    }
    ready = true;
    rebuildPlate();
    if (active === 'map') await showMap(true);
    else if (plate) viewer?.show(plate, true);
  } catch (error) {
    plateError = errorMessage(error);
    $('#viewer').textContent = plateError;
    updateStatus();
  }
}

void start();
void loadCatalogue();

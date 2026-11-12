import { kitCharacters, resultKeys } from '../data';
import { xmlEscape } from '../export';
import type { StudioState } from '../state';
import { courseTag } from './courses';

export function printPanel(state: StudioState): string {
  const { design, imported, activeCourse } = state;
  const glueKeys = resultKeys.filter((key) => design.placements[key] === 'separate');
  if (!glueKeys.includes(state.kitField)) state.kitField = glueKeys[0] ?? 'time';
  return `
    <div class="section-heading"><h2>Print</h2><span class="small-tag">03 / 03</span></div>
    ${!imported ? '<div class="notice"><strong>Example map</strong><p>No map is chosen yet, so the ZIP includes the supplied example, not your race course. Generate one in step 02.</p></div>' : ''}
    ${glueKeys.length ? `<label>Digits in complete ZIP<select id="complete-characters"><option value="kit" ${state.completeCharacters === 'kit' ? 'selected' : ''}>Number kits</option><option value="exact" ${state.completeCharacters === 'exact' ? 'selected' : ''}>Entered results only</option></select></label>` : ''}
    <button class="primary export-button" id="complete-download">Download complete display · ZIP <span>↧</span></button>
    <p class="help">One STL per display part. STL does not store colour; use the 3MF downloads below for multi-colour printing.</p>
    <button class="text-button" id="show-assembled">${state.assembled ? 'Hide assembled preview' : 'Preview the assembled display'}</button>
    <div class="divider"></div>
    <div class="export-card"><div class="export-icon">↧</div><div><h3>Medal plate</h3><p>143 × 222 mm · original base and slot</p></div></div>
    <button class="secondary" data-export="plate-3mf">Plate · 3MF <span>↧</span></button>
    <button class="secondary" data-export="plate-stl">Plate · STL ZIP <span>↧</span></button>
    ${imported ? `<div class="divider"></div><div class="export-card"><div class="export-icon">⌁</div><div><h3>Route map</h3><p>${imported.dimensions.width.toFixed(1)} × ${imported.dimensions.height.toFixed(1)} × ${imported.dimensions.depth.toFixed(1)} mm · ${imported.generated ? 'generated' : 'imported'}</p></div></div>
    <button class="secondary" data-export="map-3mf">Map · 3MF (named colour parts) <span>↧</span></button>
    <button class="secondary" data-export="map-stl">Map · STL ZIP <span>↧</span></button>
    <p class="help">${imported.generated ? 'Map data credits (OpenStreetMap, ODbL) and generation settings are included. Keep the attribution when sharing prints or files.' : 'Map source and credits are included. Keep attribution and check its licence.'}</p>` : ''}
    ${activeCourse ? `<div class="notice"><strong>${courseTag(activeCourse)}</strong><p>${xmlEscape(activeCourse.title)} · ${activeCourse.year} · ${activeCourse.distanceKm} km<br>Credits: ${xmlEscape(activeCourse.attribution)}<br>Licence: ${xmlEscape(activeCourse.license)}</p><a href="${xmlEscape(activeCourse.reviewUrl ?? activeCourse.sourceUrl)}" target="_blank" rel="noopener noreferrer">View source details ↗</a></div>` : ''}
    ${glueKeys.length ? `<div class="divider"></div><h3>Glue-on digits</h3>
    <p class="help">Print flat at 100%; glue above labels with 2.4 mm spacing. Start BIB digits 4 mm after #. Keep colon dots in position; use tweezers and keep small parts from children.</p>
    <button class="secondary" data-export="exact-3mf">Entered digits · 3MF <span>↧</span></button>
    <button class="secondary" data-export="exact-stl">Entered digits · STL ZIP <span>↧</span></button>
    <p class="help">Exact digits need entered results; number kits work before the race.</p>
    <label>Number kit field<select id="kit-field">${glueKeys.map((key) => `<option value="${key}" ${key === state.kitField ? 'selected' : ''}>${key.toUpperCase()} · matching colour</option>`).join('')}</select></label>
    <div class="kit-grid">${[...kitCharacters].map((character) => `<label>${character === ':' ? ': (colon)' : character}<input type="number" min="0" max="20" step="1" data-kit="${character}" aria-label="Copies of ${character === ':' ? 'colon' : character}" value="${state.kitCounts[character]}"></label>`).join('')}</div>
    <button class="secondary" data-export="kit-3mf">Number kit · 3MF <span>↧</span></button>
    <button class="secondary" data-export="kit-stl">Number kit · STL ZIP <span>↧</span></button>
    <p class="help">Choose 0–20 copies of each character.</p>` : ''}
    <div class="divider"></div>
    <details class="guide"><summary>Print tips</summary><ul><li>Start with a 0.4 mm nozzle and 0.2 mm layers; inspect small details in the slicer.</li><li>Check the 143 × 222 mm bed fit, map clearance and dry-fit before gluing.</li><li>For a single-colour plate, add a filament change at 3.5 mm. For a generated map, change filament at the base thickness to colour all raised detail, or use the 3MF parts on a multi-material printer.</li></ul></details>
    <button class="text-button" data-go="map">← Back</button>
    <div id="download-status" role="status" class="download-status"></div>`;
}

import { distances, fonts, paceText, races } from '../data';
import type { ColourKey } from '../data';
import { matchingCourses } from '../community';
import { xmlEscape } from '../export';
import type { StudioState } from '../state';

const colourLabels: Record<ColourKey, string> = { base: 'Plate base', title: 'Title', location: 'Location', date: 'Date', distance: 'Distance', time: 'Time', pace: 'Pace', bib: 'BIB', route: 'Route highlight' };

export function colourControls(state: StudioState, keys: ColourKey[]): string {
  return `<div class="colour-grid">${keys.map((key) => `<label class="colour-control"><input type="color" data-colour="${key}" value="${state.design.colours[key]}" aria-label="${colourLabels[key]} colour"><span>${colourLabels[key]}</span></label>`).join('')}</div>`;
}

function resultField(state: StudioState, key: 'time' | 'pace' | 'bib', label: string, value: string, placeholder: string): string {
  const { design } = state;
  return `<div class="result-row"><label>${label}<input data-field="${key}" value="${xmlEscape(value)}" placeholder="${placeholder}" maxlength="${key === 'bib' ? 10 : 9}" ${key === 'pace' && design.autoPace ? 'readonly aria-describedby="pace-help"' : ''}></label><label class="placement-label"><span>Print placement</span><select data-placement="${key}" aria-label="${label} print placement">${(['attached', 'separate', 'hidden'] as const).map((option) => `<option value="${option}" ${design.placements[key] === option ? 'selected' : ''}>${{ attached: 'On plate', separate: 'Glue-on digits', hidden: 'Do not print' }[option]}</option>`).join('')}</select></label></div>`;
}

export function courseHint(state: StudioState): string {
  const courses = state.catalogueState === 'ready' ? matchingCourses(state.communityCourses, state.design) : [];
  return courses.length ? `<p class="course-hint"><span class="status-dot"></span> ${courses.length === 1 ? 'A course map is' : `${courses.length} course maps are`} available for this race in step 02.</p>` : '';
}

export function platePanel(state: StudioState): string {
  const { design } = state;
  let pace = design.pace;
  try { if (design.autoPace) pace = paceText(design); } catch { pace = ''; /* Validation is surfaced by rebuildPlate. */ }
  const unit = design.units === 'imperial' ? 'mi' : 'km';
  return `
    <div class="section-heading"><h2>Medal plate</h2><span class="small-tag">01 / 03</span></div>
    <label>Find your race<select data-field="raceId"><option value="custom" ${design.raceId === 'custom' ? 'selected' : ''}>My own adventure / enter manually</option>${races.map((r) => `<option value="${r.id}" ${r.id === design.raceId ? 'selected' : ''}>${r.name} · ${r.country}</option>`).join('')}</select></label>
    <div id="course-hint">${courseHint(state)}</div>
    <div class="field-grid"><label>Race distance<select data-field="distanceId">${distances.map((d) => `<option value="${d.id}" ${d.id === design.distanceId ? 'selected' : ''}>${d.title.replace(' · ', ' / ')}${d.id === 'custom' ? '' : ` · ${d.km} km`}</option>`).join('')}</select></label><label id="custom-distance" ${design.distanceId !== 'custom' ? 'hidden' : ''}>Distance / km<input data-field="customKm" type="number" min="0.1" max="1000" step="any" value="${xmlEscape(design.customKm)}"></label></div>
    <label>Plate title<input data-field="title" value="${xmlEscape(design.title)}" maxlength="40"></label>
    <div class="field-grid location-date"><label>Location / custom race name<input data-field="location" value="${xmlEscape(design.location)}" maxlength="48"></label><label>Race date<input data-field="date" type="date" value="${design.date}"></label></div>
    <div class="divider"></div>
    <div class="subheading"><h3>Race results</h3><span>OPTIONAL</span></div>
    ${resultField(state, 'time', 'Finish time', design.time, '03:42:18')}
    ${resultField(state, 'pace', `Pace / ${unit}`, pace, '5:16')}
    <label class="checkbox"><input type="checkbox" id="auto-pace" ${design.autoPace ? 'checked' : ''}> Calculate pace from time and distance</label>
    <p id="pace-help" class="help">Time: H:MM:SS · Pace: M:SS per ${unit}. Glue-on fields keep their labels on the plate.</p>
    ${resultField(state, 'bib', 'BIB number', design.bib, '2048')}
    <fieldset class="segmented"><legend>Units on the plate</legend>
      <label><input type="radio" name="units" value="metric" ${design.units === 'metric' ? 'checked' : ''}> Kilometres</label>
      <label><input type="radio" name="units" value="imperial" ${design.units === 'imperial' ? 'checked' : ''}> Miles</label>
    </fieldset>
    <details class="colour-details"><summary><span class="colour-dots"><i></i><i></i><i></i></span> Colours &amp; font <span>Customize ↗</span></summary>
      <label>Plate font<select data-field="font">${fonts.map((font) => `<option value="${font.id}" ${design.font === font.id ? 'selected' : ''}>${font.name}</option>`).join('')}</select></label>
      ${colourControls(state, ['base', 'title', 'location', 'date', 'distance', 'time', 'pace', 'bib'])}
      <p class="help">Different colours at the same height need a multi-material printer.</p>
    </details>
    <button class="primary next-step" data-go="map">Next: make your map <span>→</span></button>`;
}

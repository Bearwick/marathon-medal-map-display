import { distances, races } from '../data';
import { editionWarning, matchingCourses } from '../community';
import type { CommunityCourse } from '../community';
import { xmlEscape } from '../export';
import type { StudioState } from '../state';

export function courseTag(course: CommunityCourse): string {
  return course.curation === 'maintainer' ? 'KNOWN COURSE — UNOFFICIAL' : 'COMMUNITY MAP — UNOFFICIAL';
}

export function coursesPanel(state: StudioState): string {
  const matches = matchingCourses(state.communityCourses, state.design);
  const body = state.catalogueState === 'loading' ? '<p role="status">Loading known courses…</p>'
    : state.catalogueState === 'error'
      ? `<div class="notice"><strong>Courses unavailable</strong><p>${xmlEscape(state.catalogueError)}</p><button class="text-button" id="retry-catalogue">Retry</button></div>`
      : matches.length ? matches.map((course) => {
        const warning = editionWarning(course, state.design);
        const selected = state.activeCourse?.id === course.id;
        return `<article class="notice community-course${selected ? ' selected-course' : ''}">
          <strong>${xmlEscape(course.title)}</strong><p class="community-tag">${courseTag(course)}</p>
          <p>${course.year} · ${course.distanceKm} km · ${course.files.gpx ? 'GPX route' : ''}${course.files.gpx && course.files.map ? ' + ' : ''}${course.files.map ? 'Printable map' : ''}</p>
          ${warning ? `<p class="warning-text">${xmlEscape(warning)}</p>` : ''}
          ${course.notes ? `<p>${xmlEscape(course.notes)}</p>` : ''}
          <p>Licence: ${xmlEscape(course.license)}<br>Credits: ${xmlEscape(course.attribution)}</p>
          <a href="${xmlEscape(course.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source ↗</a>${course.reviewUrl ? ` · <a href="${xmlEscape(course.reviewUrl)}" target="_blank" rel="noopener noreferrer">Maintainer review ↗</a>` : ''}
          ${selected ? '<p class="selected-label"><span class="status-dot"></span> Selected</p>' : `<button class="secondary" data-community="${course.id}">Use this course <span>→</span></button>`}
        </article>`;
      }).join('') : `<p class="help">No known course for this race and distance yet. Upload a GPX below${state.design.raceId === 'custom' ? '' : ', and suggest it to the community'}.</p>`;
  const skipped = state.catalogueWarnings.length
    ? `<details class="catalogue-warnings"><summary>${state.catalogueWarnings.length} catalogue entr${state.catalogueWarnings.length === 1 ? 'y was' : 'ies were'} skipped</summary><ul>${state.catalogueWarnings.map((warning) => `<li>${xmlEscape(warning)}</li>`).join('')}</ul></details>`
    : '';
  return `<section class="community-section" aria-label="Known courses"><h3>Known courses</h3>
    <p class="help">Unofficial routes. Courses change between editions — compare with the organizer before printing.</p>${body}${skipped}</section>`;
}

export function proposalPanel(state: StudioState): string {
  const { track, mapFile, design } = state;
  if (!track && !mapFile) return '';
  if (state.activeCourse) return '';
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

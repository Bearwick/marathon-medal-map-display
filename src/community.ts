import { distanceKm, distances, races } from './data';
import type { Design } from './data';

export type Curation = 'maintainer' | 'community';

export interface CommunityCourse {
  id: string;
  raceId: string;
  /** maintainer: added by the repository maintainer (e.g. traced from OpenStreetMap); community: reviewed proposal. */
  curation: Curation;
  year: number;
  /** Optional ISO race date of this edition, used to fill the plate date. */
  date?: string;
  distanceKm: number;
  title: string;
  sourceUrl: string;
  /** Required for community entries: the repository issue or pull request where it was reviewed. */
  reviewUrl?: string;
  license: string;
  attribution: string;
  notes: string;
  files: { gpx?: string; map?: string };
}

export interface Proposal {
  raceId: string;
  raceName: string;
  year: number;
  distanceKm: number;
  sourceUrl: string;
  license: string;
  attribution: string;
  notes: string;
  files: string[];
}

export const repositoryUrl = 'https://github.com/Bearwick/marathon-medal-map-display';

function httpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validIsoDate(value: string): boolean {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILE_PATH = /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(gpx|3mf|stl)$/;

/** Validates one catalogue entry. `label` names it in errors (its id, or its position when the id is missing). */
function parseCatalogueEntry(entry: unknown, label: string, ids: Set<string>): CommunityCourse {
  if (!isRecord(entry)) throw new Error(`${label}: each entry must be an object.`);
  if (typeof entry.id !== 'string' || !SLUG.test(entry.id)) {
    const hint = 'raceName' in entry || Array.isArray(entry.files) ? ' It looks like a proposal.json — use the catalogue-entry.json from the proposal ZIP instead (see README).' : '';
    throw new Error(`${label}: missing or invalid id. Use a unique lowercase slug such as "oslo-2026-half".${hint}`);
  }
  const id = entry.id;
  if (ids.has(id)) throw new Error(`${label}: duplicate id "${id}". Course ids must be unique.`);
  ids.add(id);
  if (!races.some((race) => race.id === entry.raceId)) throw new Error(`Unknown race in community course ${id}. Add the race to src/data.ts first.`);
  if (!Number.isInteger(entry.year) || Number(entry.year) < 1900 || Number(entry.year) > 2100) throw new Error(`Invalid edition in ${id}.`);
  if (typeof entry.distanceKm !== 'number' || !Number.isFinite(entry.distanceKm) || entry.distanceKm < 0.1 || entry.distanceKm > 1000) throw new Error(`Invalid distance in ${id}.`);
  for (const key of ['title', 'license', 'attribution'] as const) {
    if (typeof entry[key] !== 'string' || !entry[key].trim() || entry[key].length > 500) throw new Error(`Missing or invalid ${key} in ${id}.`);
  }
  if (typeof entry.notes !== 'string' || entry.notes.length > 2000) throw new Error(`Invalid notes in ${id}.`);
  const curation: Curation = entry.curation === undefined ? 'community' : entry.curation === 'maintainer' || entry.curation === 'community' ? entry.curation : (() => { throw new Error(`Invalid curation in ${id} (use "maintainer" or "community").`); })();
  const reviewed = httpsUrl(entry.reviewUrl) && new RegExp(`^${repositoryUrl}/(?:issues|pull)/[1-9]\\d*$`).test(entry.reviewUrl);
  if (!httpsUrl(entry.sourceUrl)) throw new Error(`Missing or non-HTTPS source link in ${id}.`);
  if (curation === 'community' ? !reviewed : entry.reviewUrl !== undefined && !reviewed) throw new Error(`Missing repository review link in ${id}: community entries need the issue or pull request URL in this repository.`);
  if (entry.date !== undefined && (typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || Number(entry.date.slice(0, 4)) !== entry.year || !validIsoDate(entry.date))) throw new Error(`Invalid edition date in ${id} (YYYY-MM-DD within the edition year).`);
  if (!isRecord(entry.files) || (!entry.files.gpx && !entry.files.map)) throw new Error(`No files in ${id}: use "files": { "gpx": "<folder>/route.gpx" } and/or "map".`);
  const files: CommunityCourse['files'] = {};
  const folder = `${String(entry.raceId)}/${id}/`;
  for (const key of ['gpx', 'map'] as const) {
    const path = entry.files[key];
    if (path === undefined) continue;
    if (typeof path !== 'string' || !FILE_PATH.test(path) || (key === 'gpx' ? !path.endsWith('.gpx') : !/\.(3mf|stl)$/.test(path))) throw new Error(`Invalid ${key} file path in ${id}.`);
    if (!path.startsWith(folder) || path.slice(folder.length).includes('/')) throw new Error(`Invalid ${key} file path in ${id}: courses live in one folder per race, e.g. "${folder}${key === 'gpx' ? 'route.gpx' : 'map.3mf'}".`);
    files[key] = path;
  }
  return {
    id, raceId: String(entry.raceId), curation, year: Number(entry.year),
    ...(typeof entry.date === 'string' ? { date: entry.date } : {}),
    distanceKm: entry.distanceKm, title: String(entry.title), sourceUrl: entry.sourceUrl as string,
    reviewUrl: typeof entry.reviewUrl === 'string' ? entry.reviewUrl : undefined, license: String(entry.license), attribution: String(entry.attribution),
    notes: entry.notes, files,
  };
}

/** Parses the catalogue, keeping valid entries and reporting invalid ones (used by the app so one bad entry hides nothing else). */
export function parseCatalogueEntries(value: unknown): { courses: CommunityCourse[]; errors: string[] } {
  if (!Array.isArray(value)) throw new Error('Community catalogue must be a list.');
  const ids = new Set<string>();
  const courses: CommunityCourse[] = [];
  const errors: string[] = [];
  value.forEach((entry: unknown, index) => {
    const label = isRecord(entry) && typeof entry.id === 'string' && entry.id ? `Entry ${index + 1} (${entry.id})` : `Entry ${index + 1}`;
    try { courses.push(parseCatalogueEntry(entry, label, ids)); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  });
  return { courses, errors };
}

/** Strict parsing for tests and tooling: any invalid entry is an error. */
export function parseCatalogue(value: unknown): CommunityCourse[] {
  const { courses, errors } = parseCatalogueEntries(value);
  if (errors.length) throw new Error(errors.join(' '));
  return courses;
}

/** Folder for a race's courses: its catalogue race id, or a slug of the name for races not yet in src/data.ts. */
export function raceFolder(raceId: string, raceName: string): string {
  const letters: Record<string, string> = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', þ: 'th' };
  return (raceId === 'custom' ? raceName : raceId).toLowerCase().replace(/[øæœßłđþ]/g, (c) => letters[c]).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'race';
}

/** Catalogue id for a proposal, e.g. "oslo-2026-half" or "my-race-2026-12-5km". */
export function courseId(raceId: string, raceName: string, year: number, km: number): string {
  const standard = distances.find((d) => d.id !== 'custom' && Math.abs(d.km - km) < 0.00001);
  return `${raceFolder(raceId, raceName)}-${year}-${standard ? standard.id : `${String(km).replace('.', '-')}km`}`;
}

/**
 * The catalogue entry a maintainer pastes into public/community/catalogue.json for a proposal — the same schema
 * the app reads. Community entries need the review issue URL, which only exists after the issue is opened.
 */
export function catalogueEntryForProposal(proposal: Proposal, fileNames: string[]): Record<string, unknown> {
  const id = courseId(proposal.raceId, proposal.raceName, proposal.year, proposal.distanceKm);
  const folder = `${raceFolder(proposal.raceId, proposal.raceName)}/${id}`;
  const gpx = fileNames.find((name) => name.endsWith('.gpx'));
  const map = fileNames.find((name) => /\.(3mf|stl)$/.test(name));
  return {
    id, raceId: proposal.raceId, curation: 'community', year: proposal.year, distanceKm: proposal.distanceKm,
    title: `${proposal.raceName.trim()} ${proposal.year} course`,
    sourceUrl: proposal.sourceUrl, reviewUrl: `${repositoryUrl}/issues/ISSUE_NUMBER`,
    license: proposal.license, attribution: proposal.attribution, notes: proposal.notes,
    files: { ...(gpx ? { gpx: `${folder}/${gpx}` } : {}), ...(map ? { map: `${folder}/${map}` } : {}) },
  };
}

/**
 * Courses for the selected race and official distance, best first: the exact edition year, then the most
 * recent earlier editions, then later ones. Courses change between editions, so callers must flag non-exact years.
 */
export function matchingCourses(courses: CommunityCourse[], design: Design): CommunityCourse[] {
  const year = Number(design.date.slice(0, 4));
  const km = distanceKm(design);
  const rank = (course: CommunityCourse) => course.year === year ? 0 : course.year < year ? 1 + (year - course.year) : 1000 + course.year;
  return courses
    .filter((course) => course.raceId === design.raceId && Math.abs(course.distanceKm - km) < 0.00001)
    .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}

/** Warning for a course whose edition differs from the plate's race date, or '' when it matches. */
export function editionWarning(course: CommunityCourse, design: Design): string {
  const year = Number(design.date.slice(0, 4));
  return course.year === year ? '' : `${course.year} course — may differ from your ${Number.isFinite(year) ? year : 'selected'} edition.`;
}

export function validateProposal(proposal: Proposal): void {
  if (!proposal.raceName.trim() || proposal.raceName.length > 100) throw new Error('Enter the race name (up to 100 characters).');
  if (!Number.isInteger(proposal.year) || proposal.year < 1900 || proposal.year > 2100) throw new Error('Enter an edition year between 1900 and 2100.');
  if (!Number.isFinite(proposal.distanceKm) || proposal.distanceKm < 0.1 || proposal.distanceKm > 1000) throw new Error('Enter a distance between 0.1 and 1,000 km.');
  if (!httpsUrl(proposal.sourceUrl) || proposal.sourceUrl.length > 500) throw new Error('Provide an HTTPS source link (up to 500 characters).');
  if (!proposal.license.trim() || !proposal.attribution.trim() || proposal.license.length > 500 || proposal.attribution.length > 500) throw new Error('Provide redistribution licence/permission and attribution (up to 500 characters each).');
  if (proposal.notes.length > 1500) throw new Error('Keep course notes under 1,501 characters.');
  if (!proposal.files.length) throw new Error('Upload a GPX or printable map first.');
}

export function proposalIssueUrl(proposal: Proposal): string {
  validateProposal(proposal);
  const body = [
    '## Community course proposal — unofficial',
    `Race: ${proposal.raceName} (${proposal.raceId})`,
    `Edition: ${proposal.year}`,
    `Distance: ${proposal.distanceKm} km`,
    `Source: ${proposal.sourceUrl}`,
    `Redistribution licence / permission: ${proposal.license}`,
    `Attribution: ${proposal.attribution}`,
    `Known limitations: ${proposal.notes || 'None specified; reviewer must check.'}`,
    `Files in proposal ZIP: ${proposal.files.join(', ')} (in the ${raceFolder(proposal.raceId, proposal.raceName)}/${courseId(proposal.raceId, proposal.raceName, proposal.year, proposal.distanceKm)}/ folder, plus catalogue-entry.json)`,
    '',
    '- [x] I have permission to publish and redistribute these files with the stated credits.',
    '- [x] I have inspected the files and removed private locations, timestamps and personal data, including embedded 3MF source metadata.',
    '- [x] I understand the files and this issue will be public and that approval does not mean organizer verification.',
    '',
    '**Before submitting:** attach the downloaded proposal ZIP here. For a large ZIP, link to a publicly accessible download that the maintainer may redistribute. This app does not upload files or create an issue automatically.',
    '',
    '**Maintainer:** an automatic course intake report will be posted below. Complete its checklist (licence, edition, distance, privacy, geometry), then add the `approve-course` label to open a pull request. Only merging that pull request publishes the course.',
  ].join('\n\n');
  const url = new URL(`${repositoryUrl}/issues/new`);
  url.searchParams.set('template', 'community-map.md');
  url.searchParams.set('title', `[Community course] ${proposal.raceName} ${proposal.year} / ${proposal.distanceKm} km`);
  url.searchParams.set('body', body);
  return url.href;
}

export async function fetchCommunityFile(path: string, limit: number, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(`${import.meta.env.BASE_URL}community/${path}`, { signal });
  if (!response.ok) throw new Error(`Unable to load community file (${response.status}): ${path}`);
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Community file exceeds the upload limit.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('This browser cannot read community file downloads.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error('Community file exceeds the upload limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.byteLength; });
  return bytes;
}

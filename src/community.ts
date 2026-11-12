import { distanceKm, races } from './data';
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

export function parseCatalogue(value: unknown): CommunityCourse[] {
  if (!Array.isArray(value)) throw new Error('Community catalogue must be a list.');
  const ids = new Set<string>();
  return value.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !/^[a-z0-9-]+$/.test(entry.id) || ids.has(entry.id)) throw new Error('Community course IDs must be unique slugs.');
    ids.add(entry.id);
    if (!races.some((race) => race.id === entry.raceId)) throw new Error(`Unknown race in community course ${entry.id}.`);
    if (!Number.isInteger(entry.year) || Number(entry.year) < 1900 || Number(entry.year) > 2100) throw new Error(`Invalid edition in ${entry.id}.`);
    if (typeof entry.distanceKm !== 'number' || !Number.isFinite(entry.distanceKm) || entry.distanceKm < 0.1 || entry.distanceKm > 1000) throw new Error(`Invalid distance in ${entry.id}.`);
    for (const key of ['title', 'license', 'attribution'] as const) {
      if (typeof entry[key] !== 'string' || !entry[key].trim() || entry[key].length > 500) throw new Error(`Missing or invalid ${key} in ${entry.id}.`);
    }
    if (typeof entry.notes !== 'string' || entry.notes.length > 2000) throw new Error(`Invalid notes in ${entry.id}.`);
    const curation: Curation = entry.curation === undefined ? 'community' : entry.curation === 'maintainer' || entry.curation === 'community' ? entry.curation : (() => { throw new Error(`Invalid curation in ${entry.id}.`); })();
    const reviewed = httpsUrl(entry.reviewUrl) && new RegExp(`^${repositoryUrl}/(?:issues|pull)/[1-9]\\d*$`).test(entry.reviewUrl);
    if (!httpsUrl(entry.sourceUrl) || (curation === 'community' ? !reviewed : entry.reviewUrl !== undefined && !reviewed)) throw new Error(`Missing source or repository review link in ${entry.id}.`);
    if (entry.date !== undefined && (typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || Number(entry.date.slice(0, 4)) !== entry.year || !validIsoDate(entry.date))) throw new Error(`Invalid edition date in ${entry.id}.`);
    if (!isRecord(entry.files) || (!entry.files.gpx && !entry.files.map)) throw new Error(`No files in ${entry.id}.`);
    const files: CommunityCourse['files'] = {};
    for (const key of ['gpx', 'map'] as const) {
      const path = entry.files[key];
      if (path === undefined) continue;
      if (typeof path !== 'string' || !/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(gpx|3mf|stl)$/.test(path) || (key === 'gpx' ? !path.endsWith('.gpx') : !/\.(3mf|stl)$/.test(path))) throw new Error(`Invalid ${key} file path in ${entry.id}.`);
      files[key] = path;
    }
    return {
      id: entry.id, raceId: String(entry.raceId), curation, year: Number(entry.year),
      ...(typeof entry.date === 'string' ? { date: entry.date } : {}),
      distanceKm: entry.distanceKm, title: String(entry.title), sourceUrl: entry.sourceUrl as string,
      reviewUrl: typeof entry.reviewUrl === 'string' ? entry.reviewUrl : undefined, license: String(entry.license), attribution: String(entry.attribution),
      notes: entry.notes, files,
    };
  });
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
    `Files in proposal ZIP: ${proposal.files.join(', ')}`,
    '',
    '- [x] I have permission to publish and redistribute these files with the stated credits.',
    '- [x] I have inspected the files and removed private locations, timestamps and personal data, including embedded 3MF source metadata.',
    '- [x] I understand the files and this issue will be public and that approval does not mean organizer verification.',
    '',
    '**Before submitting:** attach the downloaded proposal ZIP here. For a large ZIP, link to a publicly accessible download that the maintainer may redistribute. This app does not upload files or create an issue automatically.',
    '',
    '**Maintainer:** review the attached files, edition, distance, privacy, licence, geometry and frame fit. Publish only by merging files and metadata into the curated catalogue. An issue or label alone never publishes a recommendation.',
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

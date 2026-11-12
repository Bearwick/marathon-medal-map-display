// Turns a proposal ZIP (from the app's "Suggest this course") into catalogue changes plus a review report.
// Pure: no file system or network access, so the CLI (scripts/add-course.mjs), CI and tests share it.
import { unzipSync } from 'fflate';
import { parseCatalogue, repositoryUrl } from './community';
import { MAP_MAX_DEPTH } from './dimensions';
import { MAX_GPX_BYTES, parseGpx } from './gpx';
import { importMap, MAX_MAP_FILE_BYTES } from './import';
import { disposeGroup } from './geometry';

export interface IntakeOptions {
  /** The review issue number; fills `reviewUrl`. Required unless `maintainer`. */
  issue?: number;
  /** Publish as a maintainer-curated course (no review link). */
  maintainer?: boolean;
  /** Allow replacing an existing course with the same id. */
  replace?: boolean;
  /** Paths (relative to public/community) that already exist, used to detect clashes. */
  existingPaths?: Set<string>;
}

export interface IntakeResult {
  ok: boolean;
  id?: string;
  folder?: string;
  /** Files to write, relative to public/community. Empty when not ok. */
  files: Record<string, Uint8Array>;
  /** New catalogue.json text. Undefined when not ok. */
  catalogue?: string;
  /** Markdown review report (always present). */
  report: string;
  problems: string[];
}

const MAX_ENTRY_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
const MAX_GAP_WARN_M = 500;
const DISTANCE_TOLERANCE = 0.03;
const COURSE_FILE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(route\.gpx|map\.3mf|map\.stl)$/;
const EXTRA_FILES = new Set(['catalogue-entry.json', 'SUBMISSION-INSTRUCTIONS.txt']);

/** Submitter text is untrusted: keep it from rendering HTML, links, tables or @-mentions in GitHub Markdown. */
export function safeMarkdown(value: unknown, max = 300): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return text.replace(/[\\`*_[\]<>|#]/g, (c) => `\\${c}`).replace(/@/g, '@​') || '—';
}

export interface GpxCleanup { xml: string; removed: Record<string, number> }

/** Removes data that is private or unnecessary for a published course: timestamps, waypoints, extensions, author/email. */
export function cleanGpx(xml: string): GpxCleanup {
  const removed: Record<string, number> = {};
  let out = xml;
  const strip = (label: string, pattern: RegExp) => {
    out = out.replace(pattern, () => { removed[label] = (removed[label] ?? 0) + 1; return ''; });
  };
  strip('timestamps', /<(?:[\w-]+:)?time\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?time>/g);
  strip('waypoints', /<(?:[\w-]+:)?wpt\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:[\w-]+:)?wpt>)/g);
  strip('extensions (heart rate, cadence, device data)', /<(?:[\w-]+:)?extensions\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?extensions>/g);
  strip('author/email details', /<(?:[\w-]+:)?(?:author|email)\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:[\w-]+:)?(?:author|email)>)/g);
  return { xml: out, removed };
}

function metres(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1, h)));
}

const osm = ([lat, lon]: [number, number]) => `[${lat.toFixed(5)}, ${lon.toFixed(5)}](https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=16/${lat.toFixed(5)}/${lon.toFixed(5)})`;

export function intakeProposal(zip: Uint8Array, catalogueText: string, options: IntakeOptions = {}): IntakeResult {
  const problems: string[] = [];
  const checks: string[] = [];
  const sections: string[] = [];
  const pass = (text: string) => checks.push(`- ✅ ${text}`);
  const warn = (text: string) => checks.push(`- ⚠️ ${text}`);
  const fail = (text: string) => { problems.push(text); checks.push(`- ❌ ${text}`); };
  const result = (summary: string[] = [], extra: Partial<IntakeResult> = {}): IntakeResult => {
    const ok = problems.length === 0;
    const report = [
      `## Course intake report${extra.id ? ` — \`${extra.id}\`` : ''}`,
      ok ? 'All automatic checks passed. A maintainer still needs to complete the checklist below.' : `**${problems.length} problem${problems.length === 1 ? '' : 's'} must be fixed before this course can be added.**`,
      ...summary, '### Automatic checks', checks.join('\n'), ...sections,
      '### Reviewer checklist',
      [
        '- [ ] The licence or permission is real and allows redistribution (check the source link).',
        '- [ ] The route matches the organizer\'s course for this edition and distance.',
        '- [ ] Start and finish are public places (no home or other private locations).',
        '- [ ] Title, credits and notes read correctly in the app.',
      ].join('\n'),
    ].join('\n\n');
    return { ok, files: {}, report, problems, ...(ok ? extra : { id: extra.id, folder: extra.folder }) };
  };

  // 1. Unpack with size limits.
  let archive: Record<string, Uint8Array>;
  try {
    let total = 0, count = 0;
    archive = unzipSync(zip, {
      filter: (file) => {
        if (++count > 20) throw new Error('The ZIP contains too many files.');
        total += file.originalSize;
        if (total > MAX_TOTAL_BYTES) throw new Error('The ZIP expands to more than 150 MB.');
        return true;
      },
    });
  } catch (error) {
    fail(`Could not read the ZIP: ${error instanceof Error ? error.message : String(error)}`);
    return result();
  }
  const names = Object.keys(archive).filter((name) => !name.endsWith('/') && !name.startsWith('__MACOSX/') && !name.endsWith('.DS_Store'));

  // 2. Catalogue entry.
  const entryBytes = archive['catalogue-entry.json'];
  if (!entryBytes) {
    fail('The ZIP has no catalogue-entry.json. Ask the submitter to prepare the ZIP again with the current app (Suggest this course → Prepare ZIP).');
    return result();
  }
  let entry: Record<string, unknown>;
  try {
    if (entryBytes.length > MAX_ENTRY_BYTES) throw new Error('too large');
    const parsed: unknown = JSON.parse(new TextDecoder().decode(entryBytes));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    entry = parsed as Record<string, unknown>;
  } catch (error) {
    fail(`catalogue-entry.json is not valid JSON (${error instanceof Error ? error.message : String(error)}).`);
    return result();
  }
  const id = String(entry.id ?? '');
  const raceId = String(entry.raceId ?? '');
  const folder = `${raceId}/${id}`;

  // 3. Structure: only the entry, instructions and files in <race>/<course-id>/.
  const courseFiles: Record<string, Uint8Array> = {};
  for (const name of names) {
    if (EXTRA_FILES.has(name)) continue;
    const match = COURSE_FILE.exec(name);
    if (!match) { fail(`Unexpected file in ZIP: \`${safeMarkdown(name, 120)}\` (allowed: <race>/<course-id>/route.gpx, map.3mf or map.stl).`); continue; }
    if (`${match[1]}/${match[2]}` !== folder) { fail(`\`${safeMarkdown(name, 120)}\` is not in the course folder \`${safeMarkdown(folder)}/\` given by catalogue-entry.json.`); continue; }
    courseFiles[name] = archive[name];
  }
  const gpxName = Object.keys(courseFiles).find((name) => name.endsWith('.gpx'));
  const mapName = Object.keys(courseFiles).find((name) => /\.(3mf|stl)$/.test(name));
  if (!gpxName && !mapName) fail('The ZIP contains no route.gpx or map file.');
  if (Object.keys(courseFiles).filter((name) => /\.(3mf|stl)$/.test(name)).length > 1) fail('The ZIP contains more than one map file.');
  if (!problems.length) pass(`ZIP structure: \`${safeMarkdown(folder)}/\` with ${Object.keys(courseFiles).map((name) => name.split('/').pop()).join(' + ')}.`);

  // 4. Fill in the review link (or maintainer curation) and file paths.
  if (options.maintainer) {
    entry.curation = 'maintainer';
    delete entry.reviewUrl;
  } else if (options.issue && Number.isInteger(options.issue) && options.issue > 0) {
    entry.curation = 'community';
    entry.reviewUrl = `${repositoryUrl}/issues/${options.issue}`;
  } else if (typeof entry.reviewUrl !== 'string' || entry.reviewUrl.includes('ISSUE_NUMBER')) {
    fail('No review issue: pass the issue number (--issue <n>), or --maintainer for a course you add yourself.');
  }
  entry.files = { ...(gpxName ? { gpx: gpxName } : {}), ...(mapName ? { map: mapName } : {}) };

  // 5. Clashes with existing courses.
  let catalogue: unknown[];
  try {
    const parsed: unknown = JSON.parse(catalogueText);
    if (!Array.isArray(parsed)) throw new Error('not a list');
    catalogue = parsed;
  } catch (error) {
    fail(`public/community/catalogue.json is not valid JSON (${error instanceof Error ? error.message : String(error)}).`);
    return result([], { id, folder });
  }
  const existingIndex = catalogue.findIndex((item) => typeof item === 'object' && item !== null && (item as Record<string, unknown>).id === id);
  const folderExists = [...(options.existingPaths ?? [])].some((path) => path === folder || path.startsWith(`${folder}/`));
  if ((existingIndex >= 0 || folderExists) && !options.replace) fail(`A course with id \`${safeMarkdown(id)}\` already exists. Use --replace to update it.`);
  else if (existingIndex >= 0) warn(`Replaces the existing course \`${safeMarkdown(id)}\`.`);

  // 6. GPX: privacy clean-up and distance.
  const output: Record<string, Uint8Array> = {};
  if (gpxName) {
    const bytes = courseFiles[gpxName];
    if (bytes.length > MAX_GPX_BYTES) fail('route.gpx is larger than 12 MB.');
    else {
      const cleaned = cleanGpx(new TextDecoder().decode(bytes));
      const removed = Object.entries(cleaned.removed);
      if (removed.length) warn(`Removed for privacy: ${removed.map(([what, n]) => `${n} ${what}`).join(', ')}.`);
      else pass('No timestamps, waypoints, extensions or author details in the GPX.');
      try {
        const track = parseGpx(cleaned.xml, String(entry.title ?? id));
        const official = Number(entry.distanceKm);
        const diff = (track.km - official) / official;
        const text = `GPX distance ${track.km.toFixed(2)} km (${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(1)} % vs official ${official} km).`;
        if (!Number.isFinite(diff) || Math.abs(diff) > DISTANCE_TOLERANCE) fail(`${text} More than 3 % off — wrong distance, an incomplete track, or a GPS recording with detours.`);
        else pass(text);
        let maxGap = 0;
        for (const segment of track.segments) for (let i = 1; i < segment.length; i++) maxGap = Math.max(maxGap, metres(segment[i - 1], segment[i]));
        if (track.segments.length > 1) warn(`The track has ${track.segments.length} separate segments; check that gaps between them are intended.`);
        if (maxGap > MAX_GAP_WARN_M) warn(`Largest step between points is ${Math.round(maxGap)} m; it will print as a straight line. Check it follows the road.`);
        const points = track.segments.flat();
        const lats = points.map((p) => p[0]), lons = points.map((p) => p[1]);
        sections.push('### Route', [
          `- Points: ${track.points.toLocaleString('en')} in ${track.segments.length} segment${track.segments.length === 1 ? '' : 's'}; largest step ${Math.round(maxGap)} m`,
          `- Start: ${osm(points[0])}`,
          `- Finish: ${osm(points.at(-1)!)}`,
          `- Area: ${(metres([Math.min(...lats), Math.min(...lons)], [Math.min(...lats), Math.max(...lons)]) / 1000).toFixed(1)} × ${(metres([Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.min(...lons)]) / 1000).toFixed(1)} km`,
        ].join('\n'));
        output[gpxName] = new TextEncoder().encode(cleaned.xml);
      } catch (error) {
        fail(`route.gpx cannot be read: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // 7. Printable map.
  if (mapName) {
    const bytes = courseFiles[mapName];
    if (bytes.length > MAX_MAP_FILE_BYTES) fail('The map file is larger than 100 MB.');
    else {
      try {
        const map = importMap(bytes.slice().buffer, mapName);
        const { width, height, depth } = map.dimensions;
        pass(`Map imports: ${width.toFixed(1)} × ${height.toFixed(1)} × ${depth.toFixed(1)} mm, ${map.parts.length} part${map.parts.length === 1 ? '' : 's'}.`);
        if (depth > MAP_MAX_DEPTH + 0.01) warn(`Map is ${depth.toFixed(1)} mm deep; it will stand proud of the ${MAP_MAX_DEPTH} mm frame front.`);
        if (map.rim) warn('Map is smaller than the frame tile; the app adds a mounting rim.');
        if (mapName.endsWith('.stl')) warn('STL map: the route cannot be recoloured separately.');
        sections.push('### Map', `- Parts: ${map.parts.map((mesh) => `\`${safeMarkdown(mesh.name, 60)}\``).join(', ')}`);
        disposeGroup(map.group);
        output[mapName] = bytes;
      } catch (error) {
        fail(`The map cannot be imported: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // 8. Validate the whole catalogue as the app and tests will.
  const nextCatalogue = existingIndex >= 0 ? catalogue.map((item, i) => (i === existingIndex ? entry : item)) : [...catalogue, entry];
  try {
    parseCatalogue(nextCatalogue);
    pass('Catalogue entry is valid (same rules as the app and `npm test`).');
  } catch (error) {
    fail(`Catalogue entry is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  const summary = [
    '| | |', '|---|---|',
    `| Title | ${safeMarkdown(entry.title)} |`,
    `| Race / edition / distance | \`${safeMarkdown(raceId)}\` · ${safeMarkdown(entry.year)} · ${safeMarkdown(entry.distanceKm)} km${entry.date ? ` · ${safeMarkdown(entry.date)}` : ''} |`,
    `| Folder | \`public/community/${safeMarkdown(folder)}/\` |`,
    `| Curation | ${entry.curation === 'maintainer' ? 'maintainer' : `community${typeof entry.reviewUrl === 'string' && !entry.reviewUrl.includes('ISSUE_NUMBER') ? ` (review #${safeMarkdown(entry.reviewUrl.split('/').pop())})` : ''}`} |`,
    `| Source | ${safeMarkdown(entry.sourceUrl)} |`,
    `| Licence | ${safeMarkdown(entry.license)} |`,
    `| Attribution | ${safeMarkdown(entry.attribution)} |`,
    `| Notes | ${safeMarkdown(entry.notes, 600)} |`,
  ].join('\n');

  const done = result([summary], { id, folder });
  if (!done.ok) return done;
  const files = Object.fromEntries(Object.entries(output));
  return { ...done, id, folder, files, catalogue: `${JSON.stringify(nextCatalogue, null, '\t')}\n` };
}

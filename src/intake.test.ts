// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, zipSync } from 'fflate';
import { BoxGeometry, Group } from 'three';
import { catalogueEntryForProposal, parseCatalogue, repositoryUrl } from './community';
import type { Proposal } from './community';
import { export3mf } from './export';
import { part } from './geometry';
import { cleanGpx, intakeProposal, safeMarkdown } from './intake';

const catalogue = readFileSync('public/community/catalogue.json', 'utf8');
// A real 42 km track, re-used as a new Bergen marathon proposal.
const bostonGpx = readFileSync('public/community/boston/boston-osm-marathon/route.gpx', 'utf8');
const gpx = bostonGpx.replace('<trkpt', '<wpt lat="59.9" lon="10.7"><name>Home</name></wpt><trkpt').replace(/(<trkpt [^>]+?)\/>/, '$1><time>2026-04-20T10:00:00Z</time></trkpt>');
const proposal: Proposal = {
  raceId: 'bergen', raceName: 'Bergen City Marathon', year: 2026, distanceKm: 42.195,
  sourceUrl: 'https://example.org/bergen-course', license: 'CC BY 4.0', attribution: 'Course traced by a runner',
  notes: 'Unofficial @maintainer <b>test</b>', files: ['route.gpx'],
};

function proposalZip(files: Record<string, string | Uint8Array>, entry: Record<string, unknown> = catalogueEntryForProposal(proposal, Object.keys(files).map((f) => f.split('/').pop()!))): Uint8Array {
  return zipSync({
    'catalogue-entry.json': strToU8(JSON.stringify(entry)),
    'SUBMISSION-INSTRUCTIONS.txt': strToU8('…'),
    ...Object.fromEntries(Object.entries(files).map(([name, data]) => [name, typeof data === 'string' ? strToU8(data) : data])),
  });
}

describe('course intake', () => {
  it('adds a proposal in the race folder with the review link filled in and private data removed', () => {
    const result = intakeProposal(proposalZip({ 'bergen/bergen-2026-marathon/route.gpx': gpx }), catalogue, { issue: 42 });
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.folder).toBe('bergen/bergen-2026-marathon');
    expect(Object.keys(result.files)).toEqual(['bergen/bergen-2026-marathon/route.gpx']);
    const written = strFromU8(result.files['bergen/bergen-2026-marathon/route.gpx']);
    expect(written).not.toMatch(/<time>|<wpt|Home/);
    const courses = parseCatalogue(JSON.parse(result.catalogue!));
    const added = courses.find((c) => c.id === 'bergen-2026-marathon')!;
    expect(added).toMatchObject({ curation: 'community', reviewUrl: `${repositoryUrl}/issues/42`, files: { gpx: 'bergen/bergen-2026-marathon/route.gpx' } });
    expect(courses).toHaveLength(JSON.parse(catalogue).length + 1);
    expect(result.catalogue).toContain('\n\t{'); // keeps the catalogue's tab indentation
    expect(result.report).toContain('Removed for privacy: 1 timestamps, 1 waypoints');
    expect(result.report).toContain('GPX distance 42.38 km');
    expect(result.report).toContain('openstreetmap.org/?mlat=');
    // Untrusted text cannot ping people or inject HTML.
    expect(result.report).toContain('@​maintainer');
    expect(result.report).not.toContain('<b>');
  });
  it('supports maintainer courses without an issue', () => {
    const result = intakeProposal(proposalZip({ 'bergen/bergen-2026-marathon/route.gpx': bostonGpx }), catalogue, { maintainer: true });
    expect(result.ok).toBe(true);
    const added = parseCatalogue(JSON.parse(result.catalogue!)).find((c) => c.id === 'bergen-2026-marathon')!;
    expect(added.curation).toBe('maintainer');
    expect(added.reviewUrl).toBeUndefined();
    expect(result.report).toContain('No timestamps, waypoints');
  });
  it('accepts a printable map and reports it', () => {
    const map = new Group();
    map.add(part('Route', new BoxGeometry(133, 117, 3), '#ff0000'));
    const result = intakeProposal(proposalZip({ 'bergen/bergen-2026-marathon/map.3mf': export3mf(map) }), catalogue, { issue: 7 });
    expect(result.problems).toEqual([]);
    expect(result.report).toContain('Map imports: 141.0 × 120.9');
    expect(result.report).toContain('mounting rim');
  });
  it('rejects bad structure, missing review, clashes and wrong distance without writing anything', () => {
    const cases: [Uint8Array, object, RegExp][] = [
      [zipSync({ 'route.gpx': strToU8(gpx) }), { issue: 1 }, /no catalogue-entry\.json/],
      [proposalZip({ 'bergen/bergen-2026-marathon/route.gpx': gpx, 'bergen/bergen-2026-marathon/notes.txt': 'x' }), { issue: 1 }, /Unexpected file/],
      [proposalZip({ '../../evil/route.gpx': gpx }), { issue: 1 }, /Unexpected file/],
      [proposalZip({ 'bergen-2026-marathon/route.gpx': gpx }), { issue: 1 }, /Unexpected file/],
      [proposalZip({ 'oslo/bergen-2026-marathon/route.gpx': gpx }), { issue: 1 }, /not in the course folder/],
      [proposalZip({ 'bergen/bergen-2026-marathon/route.gpx': gpx }), {}, /No review issue/],
      [proposalZip({ 'bergen/bergen-2026-half/route.gpx': gpx }, { ...catalogueEntryForProposal({ ...proposal, distanceKm: 21.0975 }, ['route.gpx']) }), { issue: 1 }, /More than 3 % off/],
      [proposalZip({ 'oslo/oslo-2026-half/route.gpx': gpx }, { ...catalogueEntryForProposal({ ...proposal, raceId: 'oslo', distanceKm: 42.195 }, ['route.gpx']), id: 'oslo-2026-half' }), { issue: 1, existingPaths: new Set(['oslo/oslo-2026-half']) }, /already exists/],
      [proposalZip({ 'bergen/bergen-2026-marathon/route.gpx': gpx }, { ...catalogueEntryForProposal(proposal, ['route.gpx']), license: '' }), { issue: 1 }, /Catalogue entry is invalid/],
    ];
    for (const [zip, options, problem] of cases) {
      const result = intakeProposal(zip, catalogue, options);
      expect(result.ok, String(problem)).toBe(false);
      expect(result.problems.join(' ')).toMatch(problem);
      expect(result.files).toEqual({});
      expect(result.catalogue).toBeUndefined();
      expect(result.report).toContain('must be fixed');
    }
  });
});

describe('GPX privacy clean-up', () => {
  it('removes timestamps, waypoints, extensions and author details but keeps the track', () => {
    const { xml, removed } = cleanGpx('<gpx><metadata><author><name>Me</name><email id="me" domain="x.no"/></author><copyright author="OSM"/></metadata><wpt lat="1" lon="2"/><trk><trkseg><trkpt lat="1" lon="2"><ele>3</ele><time>t</time><extensions><hr>150</hr></extensions></trkpt></trkseg></trk></gpx>');
    expect(xml).toBe('<gpx><metadata><copyright author="OSM"/></metadata><trk><trkseg><trkpt lat="1" lon="2"><ele>3</ele></trkpt></trkseg></trk></gpx>');
    expect(removed).toEqual({ timestamps: 1, waypoints: 1, 'extensions (heart rate, cadence, device data)': 1, 'author/email details': 1 });
  });
  it('escapes Markdown from untrusted text', () => {
    expect(safeMarkdown('| [x](javascript:1) @bob <img>')).toBe('\\| \\[x\\](javascript:1) @​bob \\<img\\>');
  });
});

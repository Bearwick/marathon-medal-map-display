// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { initialDesign } from './data';
import { fetchCommunityFile, matchingCourses, parseCatalogue, proposalIssueUrl, repositoryUrl, validateProposal } from './community';
import type { CommunityCourse, Proposal } from './community';
import { MAX_MAP_FILE_BYTES } from './import';

const course: CommunityCourse = {
  id: 'oslo-2026-marathon', raceId: 'oslo', year: 2026, distanceKm: 42.195,
  title: 'Oslo community course', sourceUrl: 'https://example.org/course',
  reviewUrl: `${repositoryUrl}/issues/1`, license: 'CC BY 4.0',
  attribution: 'Test fixture only; not a published map.', notes: 'Inspect the course.',
  files: { gpx: 'oslo-2026/route.gpx', map: 'oslo-2026/map.3mf' },
};
const proposal: Proposal = {
  raceId: 'oslo', raceName: 'Oslo Maraton', year: 2026, distanceKm: 42.195,
  sourceUrl: 'https://example.org/course', license: 'CC BY 4.0', attribution: 'Creator',
  notes: 'Unofficial personal track.', files: ['route.gpx'],
};

afterEach(() => vi.unstubAllGlobals());

describe('curated community catalogue', () => {
  it('validates every published entry and checks its bundled file limits', () => {
    const catalogue = parseCatalogue(JSON.parse(readFileSync('public/community/catalogue.json', 'utf8')));
    for (const item of catalogue) {
      for (const [type, file] of Object.entries(item.files)) {
        expect(statSync(resolve('public/community', file)).size).toBeLessThanOrEqual(type === 'gpx' ? 12 * 1024 * 1024 : MAX_MAP_FILE_BYTES);
      }
    }
  });
  it('matches only the exact race, year and official distance', () => {
    const catalogue = parseCatalogue([course]);
    const design = initialDesign();
    expect(matchingCourses(catalogue, design)).toHaveLength(1);
    design.date = '2025-09-12';
    expect(matchingCourses(catalogue, design)).toHaveLength(0);
    design.date = '2026-09-12'; design.raceId = 'helsinki';
    expect(matchingCourses(catalogue, design)).toHaveLength(0);
    design.raceId = 'oslo'; design.distanceId = 'half';
    expect(matchingCourses(catalogue, design)).toHaveLength(0);
    design.distanceId = 'custom'; design.customKm = '42.195';
    expect(matchingCourses(catalogue, design)).toHaveLength(1);
  });
  it('requires review, source, permission, unique IDs and safe local paths', () => {
    const invalid = [
      { ...course, reviewUrl: 'https://example.org/approved' },
      { ...course, reviewUrl: `${repositoryUrl}/issues/1?unreviewed=true` },
      { ...course, sourceUrl: 'javascript:alert(1)' },
      { ...course, sourceUrl: 'https://user:password@example.org' },
      { ...course, raceId: 'unknown' }, { ...course, year: 2026.5 },
      { ...course, license: '' }, { ...course, distanceKm: NaN }, { ...course, files: {} },
      ...['../private.gpx', '/private.gpx', 'https://example.org/track.gpx', 'track%2egpx', 'track\\route.gpx'].map((gpx) => ({ ...course, files: { gpx } })),
    ];
    for (const entry of invalid) expect(() => parseCatalogue([entry])).toThrow();
    expect(() => parseCatalogue([course, course])).toThrow('unique');
  });
});

describe('GitHub course proposals', () => {
  it('prefills a public, unofficial proposal with required review and attachment steps', () => {
    const url = new URL(proposalIssueUrl(proposal));
    expect(url.origin + url.pathname).toBe(`${repositoryUrl}/issues/new`);
    expect(url.searchParams.get('template')).toBe('community-map.md');
    const body = url.searchParams.get('body')!;
    expect(body).toContain('Edition: 2026');
    expect(body).toContain('Distance: 42.195 km');
    expect(body).toContain('unofficial');
    expect(body).toContain('attach the downloaded proposal ZIP');
    expect(body).toContain('does not upload files');
    expect(body).toContain('removed private locations');
    expect(body).toContain('CC BY 4.0');
  });
  it('encodes user content without injecting URL parameters', () => {
    const url = new URL(proposalIssueUrl({ ...proposal, raceName: 'Race & title=Injected #1', notes: 'Line one\nLine two & assignees=someone' }));
    expect(url.searchParams.has('assignees')).toBe(false);
    expect(url.searchParams.get('body')).toContain('Line two & assignees=someone');
  });
  it('rejects missing files, permissions, source and invalid edition or distance', () => {
    for (const change of [{ files: [] }, { sourceUrl: 'http://example.org' }, { license: '' }, { attribution: '' }, { year: 0 }, { distanceKm: 0 }, { distanceKm: NaN }]) {
      expect(() => validateProposal({ ...proposal, ...change })).toThrow();
    }
  });
});

describe('community file downloads', () => {
  it('fetches same-site catalogue assets and preserves bytes', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchCommunityFile('fixture/route.gpx', 10)).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetch.mock.calls[0][0]).toBe('/community/fixture/route.gpx');
  });
  it('reports unavailable and oversized downloads, including streamed sizes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Missing', { status: 404 })));
    await expect(fetchCommunityFile('missing.gpx', 10)).rejects.toThrow('404');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('abc', { headers: { 'content-length': '100' } })));
    await expect(fetchCommunityFile('large.gpx', 2)).rejects.toThrow('limit');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('abc')));
    await expect(fetchCommunityFile('stream.gpx', 2)).rejects.toThrow('limit');
  });
});

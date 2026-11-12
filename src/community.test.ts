// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { distanceKm, initialDesign } from './data';
import { parseGpx } from './gpx';
import { catalogueEntryForProposal, courseId, editionWarning, fetchCommunityFile, matchingCourses, parseCatalogue, parseCatalogueEntries, proposalIssueUrl, repositoryUrl, validateProposal } from './community';
import type { CommunityCourse, Proposal } from './community';
import { MAX_MAP_FILE_BYTES } from './import';

const course: CommunityCourse = {
  id: 'oslo-2026-marathon', raceId: 'oslo', curation: 'community', year: 2026, distanceKm: 42.195,
  title: 'Oslo community course', sourceUrl: 'https://example.org/course',
  reviewUrl: `${repositoryUrl}/issues/1`, license: 'CC BY 4.0',
  attribution: 'Test fixture only; not a published map.', notes: 'Inspect the course.',
  files: { gpx: 'oslo/oslo-2026-marathon/route.gpx', map: 'oslo/oslo-2026-marathon/map.3mf' },
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
  it('bundles curated GPX that parses, has no timestamps and matches the official distance within 3%', () => {
    const catalogue = parseCatalogue(JSON.parse(readFileSync('public/community/catalogue.json', 'utf8')));
    expect(catalogue.some((item) => item.curation === 'maintainer')).toBe(true);
    for (const item of catalogue.filter((entry) => entry.files.gpx)) {
      const xml = readFileSync(resolve('public/community', item.files.gpx!), 'utf8');
      expect(xml).not.toMatch(/<time>/);
      const track = parseGpx(xml, item.title);
      expect(Math.abs(track.km - item.distanceKm) / item.distanceKm, item.id).toBeLessThan(0.03);
    }
  });
  it('matches race and official distance, ranking the exact edition before older and newer ones', () => {
    const edition = (year: number) => ({ ...course, id: `oslo-${year}`, year, files: { gpx: `oslo/oslo-${year}/route.gpx` } });
    const older = edition(2024), old = edition(2025), newer = edition(2027);
    const catalogue = parseCatalogue([newer, older, course, old]);
    const design = initialDesign();
    expect(matchingCourses(catalogue, design).map((c) => c.id)).toEqual(['oslo-2026-marathon', 'oslo-2025', 'oslo-2024', 'oslo-2027']);
    expect(editionWarning(catalogue[2], design)).toBe('');
    design.date = '2025-09-12';
    expect(matchingCourses(catalogue, design)[0].id).toBe('oslo-2025');
    expect(editionWarning(catalogue[2], design)).toContain('may differ from your 2025 edition');
    design.date = '2026-09-12'; design.raceId = 'helsinki';
    expect(matchingCourses(catalogue, design)).toHaveLength(0);
    design.raceId = 'oslo'; design.distanceId = 'half';
    expect(matchingCourses(catalogue, design)).toHaveLength(0);
    design.distanceId = 'custom'; design.customKm = '42.195';
    expect(matchingCourses(catalogue, design)).toHaveLength(4);
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
    // One folder per race, one subfolder per course.
    for (const gpx of ['oslo/route.gpx', 'oslo-2026-marathon/route.gpx', 'bergen/oslo-2026-marathon/route.gpx', 'oslo/oslo-2026-marathon/extra/route.gpx']) {
      expect(() => parseCatalogue([{ ...course, files: { gpx } }])).toThrow('one folder per race');
    }
    expect(() => parseCatalogue([course, course])).toThrow('unique');
  });
  it('lets maintainer-curated courses omit a review link but validates dates and curation', () => {
    const { reviewUrl: _omit, ...withoutReview } = course;
    expect(() => parseCatalogue([{ ...withoutReview, curation: 'maintainer', date: '2026-04-20' }])).not.toThrow();
    expect(() => parseCatalogue([withoutReview])).toThrow('review');
    expect(() => parseCatalogue([{ ...withoutReview, curation: 'maintainer', reviewUrl: 'https://example.org/x' }])).toThrow('review');
    expect(() => parseCatalogue([{ ...course, curation: 'official' }])).toThrow('curation');
    for (const date of ['2025-04-20', '2026-02-30', '20-04-2026', 20260420]) expect(() => parseCatalogue([{ ...course, date }])).toThrow('date');
    expect(parseCatalogue([{ ...course, curation: undefined }])[0].curation).toBe('community');
    expect(distanceKm(initialDesign())).toBe(42.195);
  });
});

describe('catalogue resilience', () => {
  it('keeps valid courses when another entry is invalid, and explains proposal-shaped entries', () => {
    const proposalShaped = { raceId: 'oslo', raceName: 'Oslo Maraton', year: 2026, distanceKm: 21.0975, files: ['oslo/route.gpx'], unofficial: true };
    const { courses, errors } = parseCatalogueEntries([course, proposalShaped]);
    expect(courses.map((c) => c.id)).toEqual(['oslo-2026-marathon']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Entry 2: missing or invalid id');
    expect(errors[0]).toContain('catalogue-entry.json');
    expect(() => parseCatalogue([course, proposalShaped])).toThrow('Entry 2');
    expect(parseCatalogueEntries([course, course]).errors[0]).toContain('duplicate id "oslo-2026-marathon"');
  });
});

describe('GitHub course proposals', () => {
  it('produces a catalogue entry in the same schema the app reads', () => {
    const entry = catalogueEntryForProposal({ ...proposal, distanceKm: 21.0975 }, ['route.gpx', 'map.3mf']);
    expect(entry.id).toBe('oslo-2026-half');
    expect(entry.files).toEqual({ gpx: 'oslo/oslo-2026-half/route.gpx', map: 'oslo/oslo-2026-half/map.3mf' });
    // Rejected until the maintainer fills in the review issue…
    expect(() => parseCatalogue([entry])).toThrow('review link');
    // …then accepted as-is.
    const [parsed] = parseCatalogue([{ ...entry, reviewUrl: `${repositoryUrl}/issues/7` }]);
    expect(parsed).toMatchObject({ id: 'oslo-2026-half', raceId: 'oslo', curation: 'community', year: 2026, distanceKm: 21.0975, title: 'Oslo Maraton 2026 course', license: 'CC BY 4.0' });
    expect(courseId('custom', 'Fjellløpet Ål', 2025, 12.5)).toBe('fjelllopet-al-2025-12-5km');
    expect(courseId('oslo', 'ignored', 2026, 42.195)).toBe('oslo-2026-marathon');
  });
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

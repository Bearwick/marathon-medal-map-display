import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';

const gpx = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Fjord loop</name><trkseg>
${Array.from({ length: 40 }, (_, i) => `<trkpt lat="${(59.9 + 0.02 * Math.sin(i / 6)).toFixed(5)}" lon="${(10.7 + i * 0.002).toFixed(5)}"/>`).join('')}
</trkseg></trk></gpx>`;

test.beforeEach(async ({ page }) => {
  // Keep the test offline and deterministic: block third-party map tiles and styles.
  await page.route(/^https:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
});

test('designs a plate, generates a route map and downloads the complete display', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#viewer canvas')).toBeVisible({ timeout: 30_000 });

  await page.selectOption('[data-field="raceId"]', 'oslo');
  await page.fill('[data-field="title"]', 'HOLMENKOLLSTAFETTEN ØÆÅ');
  await page.fill('[data-field="time"]', '01:45:00');
  await expect(page.locator('#editor-error')).toBeHidden();

  await page.getByRole('tab', { name: /The map/ }).click();
  await page.setInputFiles('#gpx-upload', { name: 'fjord.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx) });
  await expect(page.locator('.track-card')).toContainText('Fjord loop');
  await expect(page.locator('#frame-summary')).toContainText('1 mm ≈');

  // Route-only generation needs no map data downloads.
  await page.locator('summary', { hasText: 'Map style' }).isVisible();
  for (const layer of ['roads', 'water', 'parks', 'terrain', 'buildings']) await page.locator(`[data-layer="${layer}"]`).setChecked(false);
  await page.click('#generate-map');
  await expect(page.locator('#map-result')).toContainText('Map ready', { timeout: 60_000 });
  await expect(page.locator('#map-result')).toContainText('141.0 × 120.9');

  await page.click('#assembled-view');
  await expect(page.locator('#preview-type')).toHaveText('ASSEMBLED DISPLAY');
  await page.click('#assembled-view');

  await page.getByRole('tab', { name: /Make it/ }).click();
  await expect(page.locator('#preview-type')).toHaveText('ASSEMBLED DISPLAY');
  await expect(page.locator('#assembled-view')).toHaveAttribute('aria-pressed', 'true');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#complete-download')]);
  const files = unzipSync(new Uint8Array(await readFile(await download.path())));
  expect(Object.keys(files)).toEqual(expect.arrayContaining(['obj_1_Customized Plate.stl', 'obj_2_Customized Map.stl', 'obj_8_Frame Upper.stl', 'source-credits/CREDITS.txt', 'source-credits/MAP-SETTINGS.json']));
  expect(Object.keys(files).some((name) => name.includes('EXAMPLE'))).toBe(false);
  expect(strFromU8(files['source-credits/CREDITS.txt'])).toContain('OpenStreetMap');

  await page.getByRole('tab', { name: /The plate/ }).click();
  await expect(page.locator('#preview-type')).toHaveText('MEDAL PLATE');
  await expect(page.locator('#assembled-view')).toHaveAttribute('aria-pressed', 'false');

  // The design survives a reload, and the share link round-trips it.
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('[data-field="title"]')).toHaveValue('HOLMENKOLLSTAFETTEN ØÆÅ');
  expect(errors).toEqual([]);
});

test('offers the bundled Boston course for the Boston Marathon', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.selectOption('[data-field="raceId"]', 'boston');
  await expect(page.locator('#course-hint')).toContainText('course map');
  await expect(page.locator('input[name=units][value=imperial]')).toBeChecked();
  await page.getByRole('tab', { name: /The map/ }).click();
  await page.click('[data-community="boston-osm-marathon"]');
  await expect(page.locator('.selected-course')).toContainText('KNOWN COURSE — UNOFFICIAL');
  await expect(page.locator('.track-card')).toContainText('42.38 km');
  await page.getByRole('tab', { name: /The plate/ }).click();
  await expect(page.locator('[data-field="date"]')).toHaveValue('2026-04-20');
});

test('offers the bundled Oslo half marathon course', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.selectOption('[data-field="raceId"]', 'oslo');
  await page.selectOption('[data-field="distanceId"]', 'half');
  await expect(page.locator('#course-hint')).toContainText('course map');
  await page.getByRole('tab', { name: /The map/ }).click();
  await expect(page.locator('.catalogue-warnings')).toHaveCount(0);
  await page.click('[data-community="oslo-2026-half"]');
  await expect(page.locator('.track-card')).toContainText('21.37 km');
});

test('loads each added 2026 marathon from the known-course picker', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  for (const [raceId, km] of [
    ['tokyo', '42.29'], ['london', '42.25'], ['sydney', '42.24'],
    ['berlin', '42.18'], ['chicago', '42.19'], ['new-york', '42.57'], ['paris', '42.18'],
  ]) {
    await test.step(raceId, async () => {
      await page.getByRole('tab', { name: /The plate/ }).click();
      await page.selectOption('[data-field="raceId"]', raceId);
      await expect(page.locator('#course-hint')).toContainText('course map');
      await page.getByRole('tab', { name: /The map/ }).click();
      await expect(page.locator('.catalogue-warnings')).toHaveCount(0);
      await page.click(`[data-community="${raceId}-2026-marathon"]`);
      await expect(page.locator('.selected-course')).toContainText('GPL-3.0');
      await expect(page.locator('.track-card')).toContainText(`${km} km`);
      await expect(page.locator('#frame-summary')).toContainText('1 mm ≈');
    });
  }
});

test('loads shorter courses and the exact combined Oslo challenge distance', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  for (const [raceId, distanceId, courseId] of [
    ['oslo', '10k', 'oslo-2026-10k'], ['oslo', 'half', 'oslo-2026-half'],
    ['helsinki', '5k', 'helsinki-2027-5k'], ['helsinki', 'half', 'helsinki-2027-half'],
    ['oslo', 'custom', 'oslo-2026-triple'],
  ]) {
    await test.step(courseId, async () => {
      await page.getByRole('tab', { name: /The plate/ }).click();
      await page.selectOption('[data-field="raceId"]', raceId);
      await page.selectOption('[data-field="distanceId"]', distanceId);
      if (distanceId === 'custom') {
        await page.fill('[data-field="customKm"]', '73.2925');
        expect(await page.locator('[data-field="customKm"]').evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(true);
      }
      await expect(page.locator('#course-hint')).toContainText('course map');
      await page.getByRole('tab', { name: /The map/ }).click();
      await expect(page.locator('[data-community]')).toHaveCount(1);
      await page.click(`[data-community="${courseId}"]`);
      await expect(page.locator('.selected-course')).toBeVisible();
      await expect(page.locator('.track-card')).toContainText('km');
      await expect(page.locator('#frame-summary')).toContainText('1 mm ≈');
    });
  }
});

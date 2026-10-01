import { PDFDocument } from 'pdf-lib';
import { download, expect, rowFor, test, waitForQueue } from './fixtures';

const toFile = (f: { name: string; mimeType: string; buffer: Buffer }) => ({
  name: f.name,
  mimeType: f.mimeType,
  buffer: f.buffer,
});

test('loads without third-party requests or heavy libraries', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/', { waitUntil: 'networkidle' });
  const external = requests.filter((u) => !u.startsWith('http://localhost:4173'));
  expect(external).toEqual([]);
  expect(requests.some((u) => /ffmpeg|pdf\.worker|heic|avif/.test(u))).toBe(false);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
});

test('compresses every supported type', async ({ page, files }) => {
  await page.setInputFiles(
    'input[type="file"]',
    [files.jpg, files.png, files.svg, files.pdf, files.wav, files.webm, files.txt].map(toFile),
  );
  await expect(rowFor(page, 'notes.txt')).toContainText('File type not supported');
  await page.getByRole('button', { name: 'Compress All', exact: true }).click();
  await waitForQueue(page);

  for (const name of ['photo.jpg', 'shot.png', 'icon.svg', 'doc.pdf', 'tone.wav', 'clip.webm']) {
    await expect(rowFor(page, name)).toContainText('New:');
  }
  await expect(page.getByRole('status')).toContainText('Saved');

  // PDF keeps its pages and page size.
  const pdf = await download(page, 'doc.pdf');
  const doc = await PDFDocument.load(pdf.bytes);
  expect(doc.getPageCount()).toBe(3);
  expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  expect(pdf.bytes.length).toBeLessThan(files.pdf.buffer.length);

  // Formats that change get the right extension.
  expect((await download(page, 'clip.webm')).name).toBe('compressed_clip.mp4');
  expect((await download(page, 'tone.wav')).name).toBe('compressed_tone.mp3');
});

test('converts images to AVIF and WebP and compares before/after', async ({ page, files }) => {
  await page.setInputFiles('input[type="file"]', [toFile(files.jpg)]);
  await page.selectOption('#image-format', 'avif');
  await page.getByRole('button', { name: 'Compress', exact: true }).click();
  await waitForQueue(page);
  expect((await download(page, 'photo.jpg')).name).toBe('compressed_photo.avif');
  await expect(rowFor(page, 'photo.jpg')).toContainText('Location & camera data removed');

  await rowFor(page, 'photo.jpg').getByRole('button', { name: /^Compare/ }).click();
  await expect(page.getByRole('dialog').locator('img')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.selectOption('#image-format', 'webp');
  await page.getByRole('button', { name: 'Re-compress All', exact: true }).click();
  await waitForQueue(page);
  expect((await download(page, 'photo.jpg')).name).toBe('compressed_photo.webp');
});

test('hits a custom target size', async ({ page, files }) => {
  await page.setInputFiles('input[type="file"]', [toFile(files.jpg)]);
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.getByRole('button', { name: '100 KB' }).click();
  await page.getByRole('button', { name: 'Compress', exact: true }).click();
  await waitForQueue(page);
  const out = await download(page, 'photo.jpg');
  expect(out.bytes.length).toBeLessThanOrEqual(100 * 1024);
});

test('video to GIF with trim, then GIF compression', async ({ page, files }) => {
  await page.setInputFiles('input[type="file"]', [toFile(files.webm)]);
  await page.selectOption('#video-format', 'gif');
  await page.selectOption('#video-resolution', '480');
  const row = rowFor(page, 'clip.webm');
  await row.getByRole('button', { name: /^Options/ }).click();
  await row.getByLabel('Start (seconds)').fill('0.2');
  await row.getByLabel('End (seconds)').fill('1.2');
  await page.getByRole('button', { name: 'Compress', exact: true }).click();
  await waitForQueue(page);
  const gif = await download(page, 'clip.webm');
  expect(gif.name).toBe('compressed_clip.gif');

  await page.getByRole('button', { name: /Clear Queue/ }).click();
  await page.setInputFiles('input[type="file"]', [
    { name: 'anim.gif', mimeType: 'image/gif', buffer: gif.bytes },
  ]);
  await page.getByRole('button', { name: 'High', exact: true }).click();
  await page.getByRole('button', { name: 'Compress', exact: true }).click();
  await waitForQueue(page);
  await expect(rowFor(page, 'anim.gif')).toContainText(/New:|Already optimized/);
});

test('cancel returns the file to the queue', async ({ page, files }) => {
  await page.setInputFiles('input[type="file"]', [toFile(files.png)]);
  await page.selectOption('#image-format', 'avif');
  await page.getByRole('button', { name: 'Compress', exact: true }).click();
  await page.locator('[aria-label^="Cancel "]').click();
  await waitForQueue(page);
  await expect(rowFor(page, 'shot.png')).not.toContainText('New:');
  await expect(page.getByRole('button', { name: 'Compress', exact: true })).toBeEnabled();
});

test('remembers settings and theme', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /theme/i }).click(); // system -> light
  await page.getByRole('button', { name: /theme/i }).click(); // light -> dark
  await page.evaluate(() =>
    localStorage.setItem(
      'compressly:settings:v1',
      JSON.stringify({ level: 'High', targetValue: '', targetUnit: 'MB' }),
    ),
  );
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await page.setInputFiles('input[type="file"]', [
    { name: 'a.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') },
  ]);
  await expect(page.getByRole('button', { name: 'High', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('landing page has its own metadata and preset', async ({ page }) => {
  await page.goto('/compress-pdf-to-100kb/');
  await expect(page).toHaveTitle(/Compress PDF to 100 KB/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/compress-pdf-to-100kb\/$/);
  await page.setInputFiles('input[type="file"]', [
    { name: 'a.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') },
  ]);
  await expect(page.locator('#target-size')).toHaveValue('100');
});

test('works offline after the first visit', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('h1')).toContainText('Compressly');
  await context.setOffline(false);
});

test('receives files shared from other apps', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(async () => {
    const form = new FormData();
    form.append('files', new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'shared.svg', { type: 'image/svg+xml' }));
    await fetch('/share-target', { method: 'POST', body: form });
  });
  await page.goto('/?shared=1');
  await expect(rowFor(page, 'shared.svg')).toBeVisible();
});

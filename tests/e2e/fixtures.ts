import { test as base, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import fs from 'node:fs';
import path from 'node:path';

export interface Fixture {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** Noisy photo-like image rendered in the browser, as JPEG or PNG. */
async function makeImage(page: Page, type: 'image/jpeg' | 'image/png'): Promise<Buffer> {
  const base64 = await page.evaluate((type) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1200;
    const g = canvas.getContext('2d')!;
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `hsl(${(i * 37) % 360},70%,50%)`;
      g.fillRect((i * 97) % 1600, (i * 53) % 1200, 40, 40);
    }
    return canvas.toDataURL(type, 0.98).split(',')[1];
  }, type);
  return Buffer.from(base64, 'base64');
}

/** Two-second WebM recorded from a canvas animation. */
async function makeVideo(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const g = canvas.getContext('2d')!;
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.start();
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `hsl(${i * 6},70%,50%)`;
      g.fillRect(0, 0, 640, 360);
      g.fillStyle = '#fff';
      g.fillRect(i * 10, 100, 80, 80);
      await new Promise((r) => setTimeout(r, 33));
    }
    recorder.stop();
    await new Promise((r) => (recorder.onstop = r));
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  return Buffer.from(bytes);
}

/** Five seconds of stereo tone as 16-bit WAV. */
function makeWav(): Buffer {
  const rate = 44100;
  const samples = rate * 5;
  const data = Buffer.alloc(samples * 4);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(8000 * Math.sin(i * 0.05)), i * 4);
    data.writeInt16LE(Math.round(8000 * Math.sin(i * 0.07)), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Three-page PDF with text and a large photo on each page. */
async function makePdf(jpeg: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const image = await doc.embedJpg(jpeg);
  for (let i = 1; i <= 3; i++) {
    const page = doc.addPage([612, 792]);
    page.drawImage(image, { x: 0, y: 200, width: 612, height: 459 });
    page.drawText(`Page ${i}`, { x: 50, y: 100, size: 24, font });
  }
  return Buffer.from(await doc.save());
}

const SVG = Buffer.from(
  '<?xml version="1.0"?>\n<!-- comment -->\n<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">\n  <g>\n    <circle cx="50.123456" cy="50.654321" r="40.000001" fill="#ff0000"/>\n  </g>\n</svg>\n',
);

export const test = base.extend<{ files: Record<string, Fixture> }>({
  page: async ({ page, context }, use) => {
    // Optional local copy of the FFmpeg core, for environments without
    // access to unpkg.com: FFMPEG_CORE_DIR=node_modules/@ffmpeg/core/dist/esm
    const coreDir = process.env.FFMPEG_CORE_DIR;
    if (coreDir) {
      await context.route('https://unpkg.com/@ffmpeg/core@*/dist/esm/*', (route) =>
        route.fulfill({
          path: path.join(coreDir, route.request().url().split('/dist/esm/')[1]),
          headers: { 'Access-Control-Allow-Origin': '*' },
        }),
      );
    }
    await use(page);
  },
  files: async ({ page }, use) => {
    await page.goto('/');
    const jpeg = await makeImage(page, 'image/jpeg');
    const files: Record<string, Fixture> = {
      jpg: { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpeg },
      png: { name: 'shot.png', mimeType: 'image/png', buffer: await makeImage(page, 'image/png') },
      svg: { name: 'icon.svg', mimeType: 'image/svg+xml', buffer: SVG },
      pdf: { name: 'doc.pdf', mimeType: 'application/pdf', buffer: await makePdf(jpeg) },
      wav: { name: 'tone.wav', mimeType: 'audio/wav', buffer: makeWav() },
      webm: { name: 'clip.webm', mimeType: 'video/webm', buffer: await makeVideo(page) },
      txt: { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
    };
    await use(files);
  },
});

export { expect } from '@playwright/test';

export const rowFor = (page: Page, name: string) =>
  page.locator('div.shadow-lg.overflow-hidden', { hasText: name }).last();

/** Waits until no file is compressing (no Cancel buttons left). */
export async function waitForQueue(page: Page) {
  await page.waitForTimeout(500);
  await page.waitForFunction(() => !document.querySelector('[aria-label^="Cancel "]'), null, {
    timeout: 170_000,
  });
}

export async function download(page: Page, name: string) {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    rowFor(page, name).getByRole('button', { name: /^Download/ }).click(),
  ]);
  const target = path.join(test.info().outputDir, file.suggestedFilename());
  await file.saveAs(target);
  return { name: file.suggestedFilename(), bytes: fs.readFileSync(target) };
}

// The legacy build polyfills newer JS APIs (e.g. Map.getOrInsertComputed)
// that the modern build of pdf.js 5 requires and most browsers don't ship yet.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
// @ts-ignore
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { PDFDocument } from "pdf-lib";
import {
  type CompressionSettings,
  getPdfRenderOptions,
  getTargetRatio,
} from "./settings";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const THUMBNAIL_WIDTH = 160;

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed"))),
      type,
      quality,
    ),
  );
}

/** Frees the canvas backing store right away instead of waiting for GC. */
function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

async function renderPage(
  page: pdfjsLib.PDFPageProxy,
  scale: number,
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context unavailable");
  await page.render({ canvasContext: context, viewport } as any).promise;
  return canvas;
}

export async function generatePdfThumbnail(file: File): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() })
    .promise;
  try {
    const page = await pdf.getPage(1);
    const scale = THUMBNAIL_WIDTH / page.getViewport({ scale: 1 }).width;
    const canvas = await renderPage(page, scale);
    const blob = await canvasToBlob(canvas, "image/jpeg", 0.8);
    releaseCanvas(canvas);
    page.cleanup();
    return URL.createObjectURL(blob);
  } finally {
    await pdf.destroy();
  }
}

/**
 * Rasterizes each page to a JPEG and rebuilds the PDF from those images.
 * Text becomes non-selectable, so callers should keep the original when the
 * result isn't smaller.
 */
export async function compressPdf(
  file: File,
  settings: CompressionSettings,
  onProgress: (percent: number) => void,
): Promise<Blob> {
  const { scale, quality } = getPdfRenderOptions(
    settings.level,
    getTargetRatio(settings, file.size),
  );
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() })
    .promise;
  try {
    const newPdf = await PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      // Keep the page's physical size; only the embedded image resolution changes.
      const pageSize = page.getViewport({ scale: 1 });
      const canvas = await renderPage(page, scale);
      const jpeg = await canvasToBlob(canvas, "image/jpeg", quality);
      releaseCanvas(canvas);
      page.cleanup();

      const image = await newPdf.embedJpg(await jpeg.arrayBuffer());
      const pdfPage = newPdf.addPage([pageSize.width, pageSize.height]);
      pdfPage.drawImage(image, {
        x: 0,
        y: 0,
        width: pageSize.width,
        height: pageSize.height,
      });
      onProgress(Math.round((i / pdf.numPages) * 100));
    }
    const bytes = await newPdf.save();
    return new Blob([bytes], { type: "application/pdf" });
  } finally {
    await pdf.destroy();
  }
}

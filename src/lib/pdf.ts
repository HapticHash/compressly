// The legacy build polyfills newer JS APIs (e.g. Map.getOrInsertComputed)
// that the modern build of pdf.js 5 requires and most browsers don't ship yet.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
// @ts-ignore
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { isAbortError, runWorkerJob } from "./abort";
import { compressPdfBytes, pdfAssetOptions, type PdfSettings } from "./pdf-core";
import type { CompressionSettings } from "./settings";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const THUMBNAIL_WIDTH = 160;

export async function generatePdfThumbnail(file: File): Promise<string> {
  const pdf = await pdfjsLib.getDocument({
    data: await file.arrayBuffer(),
    ...pdfAssetOptions(location.origin),
  }).promise;
  try {
    const page = await pdf.getPage(1);
    const scale = THUMBNAIL_WIDTH / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    await page.render({ canvas, viewport } as any).promise;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.8),
    );
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
    if (!blob) throw new Error("Canvas export failed");
    return URL.createObjectURL(blob);
  } finally {
    await pdf.destroy();
  }
}

/**
 * Compresses in a worker; falls back to the main thread if the browser can't
 * run pdf.js there (e.g. no OffscreenCanvas or nested workers).
 */
export async function compressPdf(
  file: File,
  settings: CompressionSettings,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const pdfSettings: PdfSettings = {
    level: settings.level,
    targetBytes: settings.targetBytes,
    pdfMode: settings.pdfMode,
  };
  let bytes: Uint8Array;
  try {
    const worker = new Worker(new URL("./pdf.worker-job.ts", import.meta.url), {
      type: "module",
    });
    bytes = await runWorkerJob<Uint8Array>(
      worker,
      { data: await file.arrayBuffer(), settings: pdfSettings },
      onProgress,
      signal,
    );
  } catch (error) {
    if (isAbortError(error)) throw error;
    console.warn("PDF worker failed, compressing on the main thread", error);
    bytes = await compressPdfBytes(await file.arrayBuffer(), pdfSettings, onProgress, signal);
  }
  return new Blob([bytes], { type: "application/pdf" });
}

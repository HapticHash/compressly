// PDF compression that runs either in a worker or on the main thread. It only
// uses APIs available in both (OffscreenCanvas, createImageBitmap).
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  type PDFContext,
  type PDFDict,
  type PDFObject,
} from "pdf-lib";
import { throwIfAborted } from "./abort";
import {
  type CompressionSettings,
  getPdfImageOptions,
  getPdfRenderOptions,
  getTargetRatio,
  PDF_TARGET_STEPS,
} from "./settings";

export type PdfSettings = Pick<CompressionSettings, "level" | "targetBytes" | "pdfMode">;

/** Base URL of the pdf.js fonts, cMaps and wasm decoders copied into /pdfjs/. */
export function pdfAssetOptions(origin: string) {
  return {
    standardFontDataUrl: `${origin}/pdfjs/standard_fonts/`,
    cMapUrl: `${origin}/pdfjs/cmaps/`,
    cMapPacked: true,
    wasmUrl: `${origin}/pdfjs/wasm/`,
    iccUrl: `${origin}/pdfjs/iccs/`,
  };
}

/** Lets pdf.js render without `document`, e.g. inside a worker. */
class OffscreenCanvasFactory {
  constructor(_options?: unknown) {}
  create(width: number, height: number) {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(item: { canvas: OffscreenCanvas }, width: number, height: number) {
    item.canvas.width = width;
    item.canvas.height = height;
  }
  destroy(item: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (item.canvas) {
      item.canvas.width = 0;
      item.canvas.height = 0;
    }
    item.canvas = null;
    item.context = null;
  }
}

export async function compressPdfBytes(
  data: ArrayBuffer,
  settings: PdfSettings,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  return settings.pdfMode === "smallest"
    ? rasterizePdf(data, settings, onProgress, signal)
    : recompressPdfImages(data, settings, onProgress, signal);
}

type PdfJsDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>;
type RenderStep = { scale: number; quality: number };

async function renderPage(page: pdfjsLib.PDFPageProxy, scale: number): Promise<OffscreenCanvas> {
  const viewport = page.getViewport({ scale });
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.floor(viewport.width)),
    Math.max(1, Math.floor(viewport.height)),
  );
  await page.render({ canvas: null, canvasContext: canvas.getContext("2d")!, viewport } as any)
    .promise;
  return canvas;
}

/** Builds a PDF whose pages are JPEGs rendered at `step`. */
async function buildRasterPdf(
  pdf: PdfJsDocument,
  step: RenderStep,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const newPdf = await PDFDocument.create();
  for (let i = 1; i <= pdf.numPages; i++) {
    throwIfAborted(signal);
    const page = await pdf.getPage(i);
    // Keep the page's physical size; only the embedded image resolution changes.
    const pageSize = page.getViewport({ scale: 1 });
    const canvas = await renderPage(page, step.scale);
    const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality: step.quality });
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();

    const image = await newPdf.embedJpg(await jpeg.arrayBuffer());
    const pdfPage = newPdf.addPage([pageSize.width, pageSize.height]);
    pdfPage.drawImage(image, { x: 0, y: 0, width: pageSize.width, height: pageSize.height });
    onProgress(i / pdf.numPages);
  }
  return newPdf.save();
}

/**
 * Picks the best render step expected to fit `targetBytes`, by encoding the
 * first page at each step and extrapolating to the whole document.
 */
async function pickStepForTarget(pdf: PdfJsDocument, targetBytes: number): Promise<number> {
  const page = await pdf.getPage(1);
  const canvases = new Map<number, OffscreenCanvas>();
  try {
    for (const [index, step] of PDF_TARGET_STEPS.entries()) {
      let canvas = canvases.get(step.scale);
      if (!canvas) {
        canvas = await renderPage(page, step.scale);
        canvases.set(step.scale, canvas);
      }
      const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality: step.quality });
      // ~1.5 KB of PDF structure plus a little per page.
      const estimate = jpeg.size * pdf.numPages * 1.03 + 1500 + 300 * pdf.numPages;
      if (estimate <= targetBytes * 0.95) return index;
    }
    return PDF_TARGET_STEPS.length - 1;
  } finally {
    for (const canvas of canvases.values()) {
      canvas.width = 0;
      canvas.height = 0;
    }
    page.cleanup();
  }
}

/**
 * Rasterizes each page to a JPEG and rebuilds the PDF from those images.
 * Smallest output, but text is no longer selectable. With a Custom target it
 * uses the highest quality that fits instead of a fixed formula.
 */
async function rasterizePdf(
  data: ArrayBuffer,
  settings: PdfSettings,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const inWorker = typeof document === "undefined";
  const pdf = await pdfjsLib.getDocument({
    data,
    ...pdfAssetOptions(self.location.origin),
    CanvasFactory: OffscreenCanvasFactory,
    // FontFace needs `document`; in a worker pdf.js draws glyphs as paths.
    disableFontFace: inWorker,
    useWorkerFetch: true,
  } as any).promise;
  try {
    const targetBytes = settings.level === "Custom" ? settings.targetBytes : null;
    if (!targetBytes) {
      const step = getPdfRenderOptions(settings.level, getTargetRatio(settings, data.byteLength));
      return await buildRasterPdf(pdf, step, (f) => onProgress(Math.round(f * 100)), signal);
    }

    onProgress(5);
    let index = await pickStepForTarget(pdf, targetBytes);
    // If the estimate was optimistic, step down (at most three more passes).
    for (let attempt = 0; ; attempt++) {
      throwIfAborted(signal);
      const base = 10 + attempt * 10;
      const bytes = await buildRasterPdf(
        pdf,
        PDF_TARGET_STEPS[index],
        (f) => onProgress(Math.min(99, Math.round(base + f * (90 - base)))),
        signal,
      );
      if (bytes.length <= targetBytes || index === PDF_TARGET_STEPS.length - 1 || attempt === 3) {
        return bytes;
      }
      index++;
    }
  } finally {
    await pdf.destroy();
  }
}

const N = {
  Subtype: PDFName.of("Subtype"),
  Image: PDFName.of("Image"),
  Filter: PDFName.of("Filter"),
  DecodeParms: PDFName.of("DecodeParms"),
  Width: PDFName.of("Width"),
  Height: PDFName.of("Height"),
  BitsPerComponent: PDFName.of("BitsPerComponent"),
  ColorSpace: PDFName.of("ColorSpace"),
  Decode: PDFName.of("Decode"),
  ImageMask: PDFName.of("ImageMask"),
  DCTDecode: PDFName.of("DCTDecode"),
  FlateDecode: PDFName.of("FlateDecode"),
  DeviceRGB: PDFName.of("DeviceRGB"),
  DeviceGray: PDFName.of("DeviceGray"),
  ICCBased: PDFName.of("ICCBased"),
  N: PDFName.of("N"),
};

// Re-encoding small flate images (logos, icons, line art) as JPEG adds
// visible artifacts for little gain, so only large ones are touched.
const MIN_FLATE_PIXELS = 200_000;

function getNumber(context: PDFContext, value: PDFObject | undefined): number | null {
  const resolved = value ? context.lookup(value) : undefined;
  return resolved instanceof PDFNumber ? resolved.asNumber() : null;
}

/** Only one-step DCT or Flate filters are handled; anything else is skipped. */
function getFilter(context: PDFContext, dict: PDFDict): PDFName | null {
  const filter = context.lookup(dict.get(N.Filter));
  if (filter instanceof PDFName) return filter;
  if (filter instanceof PDFArray && filter.size() === 1) {
    const only = context.lookup(filter.get(0));
    return only instanceof PDFName ? only : null;
  }
  return null;
}

function getChannels(context: PDFContext, dict: PDFDict): 1 | 3 | null {
  const space = context.lookup(dict.get(N.ColorSpace));
  if (space === N.DeviceRGB) return 3;
  if (space === N.DeviceGray) return 1;
  if (space instanceof PDFArray && context.lookup(space.get(0)) === N.ICCBased) {
    const profile = context.lookup(space.get(1));
    const n = profile instanceof PDFRawStream ? getNumber(context, profile.dict.get(N.N)) : null;
    return n === 3 ? 3 : n === 1 ? 1 : null;
  }
  return null;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decodeImage(
  stream: PDFRawStream,
  filter: PDFName,
  width: number,
  height: number,
  channels: 1 | 3,
): Promise<ImageBitmap | null> {
  if (filter === N.DCTDecode) {
    return createImageBitmap(new Blob([stream.contents], { type: "image/jpeg" }));
  }
  const raw = await inflate(stream.contents);
  if (raw.length < width * height * channels) return null;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    rgba[i * 4] = raw[j];
    rgba[i * 4 + 1] = raw[channels === 3 ? j + 1 : j];
    rgba[i * 4 + 2] = raw[channels === 3 ? j + 2 : j];
    rgba[i * 4 + 3] = 255;
  }
  return createImageBitmap(new ImageData(rgba, width, height));
}

/**
 * Re-compresses the photos embedded in a PDF and leaves text, vector
 * graphics and links untouched, so the document stays searchable.
 */
async function recompressPdfImages(
  data: ArrayBuffer,
  settings: PdfSettings,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const { maxDimension, quality } = getPdfImageOptions(
    settings.level,
    getTargetRatio(settings, data.byteLength),
  );
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  const context = doc.context;
  const images = context
    .enumerateIndirectObjects()
    .filter(
      ([, obj]) =>
        obj instanceof PDFRawStream && obj.dict.get(N.Subtype) === N.Image,
    ) as [any, PDFRawStream][];

  for (const [index, [ref, stream]] of images.entries()) {
    throwIfAborted(signal);
    onProgress(Math.round((index / Math.max(1, images.length)) * 100));
    const dict = stream.dict;
    const filter = getFilter(context, dict);
    const width = getNumber(context, dict.get(N.Width));
    const height = getNumber(context, dict.get(N.Height));
    const bits = getNumber(context, dict.get(N.BitsPerComponent));
    const channels = getChannels(context, dict);
    if (
      !filter ||
      !width ||
      !height ||
      bits !== 8 ||
      !channels ||
      dict.has(N.Decode) ||
      dict.has(N.ImageMask) ||
      (filter === N.FlateDecode &&
        (dict.has(N.DecodeParms) || width * height < MIN_FLATE_PIXELS)) ||
      (filter !== N.DCTDecode && filter !== N.FlateDecode)
    ) {
      continue;
    }

    try {
      const bitmap = await decodeImage(stream, filter, width, height, channels);
      if (!bitmap) continue;
      const scale = Math.min(1, maxDimension / Math.max(width, height));
      const newWidth = Math.max(1, Math.round(width * scale));
      const newHeight = Math.max(1, Math.round(height * scale));
      const canvas = new OffscreenCanvas(newWidth, newHeight);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, newWidth, newHeight);
      bitmap.close();
      const jpeg = new Uint8Array(
        await (await canvas.convertToBlob({ type: "image/jpeg", quality })).arrayBuffer(),
      );
      canvas.width = 0;
      canvas.height = 0;
      // Not worth replacing (and possibly losing quality) for under 10%.
      if (jpeg.length >= stream.contents.length * 0.9) continue;

      const newDict = dict.clone(context);
      newDict.set(N.Width, PDFNumber.of(newWidth));
      newDict.set(N.Height, PDFNumber.of(newHeight));
      newDict.set(N.Filter, N.DCTDecode);
      newDict.set(N.ColorSpace, N.DeviceRGB);
      newDict.set(N.BitsPerComponent, PDFNumber.of(8));
      newDict.delete(N.DecodeParms);
      context.assign(ref, PDFRawStream.of(newDict, jpeg));
    } catch (error) {
      // An image the browser can't decode is left as it was.
      console.warn("Skipping PDF image", error);
    }
  }

  onProgress(100);
  return doc.save({ useObjectStreams: true });
}

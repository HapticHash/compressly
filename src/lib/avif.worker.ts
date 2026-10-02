// Encodes images to AVIF off the main thread. AVIF encoding is CPU-heavy and
// would otherwise freeze the page for seconds per photo.
import encode from "@jsquash/avif/encode.js";

interface AvifJob {
  blob: Blob;
  maxDimension: number | null;
  /** Qualities to try in order; stops at the first result under targetBytes. */
  qualities: number[];
  targetBytes: number | null;
}

self.onmessage = async (event: MessageEvent<AvifJob>) => {
  const { blob, maxDimension, qualities, targetBytes } = event.data;
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = maxDimension
      ? Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
      : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const imageData = context.getImageData(0, 0, width, height);

    let result: ArrayBuffer | null = null;
    for (const [i, quality] of qualities.entries()) {
      result = await encode(imageData, { quality });
      self.postMessage({ type: "progress", progress: Math.round(((i + 1) / qualities.length) * 100) });
      if (!targetBytes || result.byteLength <= targetBytes) break;
    }
    self.postMessage({ type: "result", result }, { transfer: [result!] });
  } catch (error) {
    self.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
  }
};

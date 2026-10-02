import imageCompression from "browser-image-compression";
// Self-hosted copy of the library for its web worker; by default it would be
// downloaded from a CDN, which the privacy promise rules out.
import imageCompressionLibUrl from "browser-image-compression/dist/browser-image-compression.js?url";
import { runWorkerJob, throwIfAborted } from "./abort";
import { readExif, resetOrientation, writeExif } from "./metadata";
import {
  AVIF_CUSTOM_QUALITIES,
  type CompressionSettings,
  getAvifQuality,
  getTargetRatio,
} from "./settings";

/**
 * What happened to the photo's EXIF data: "removed" (stripped, the default),
 * "kept" (copied into the output), "unsupported" (the user asked to keep it
 * but the output format can't hold it). Undefined when the original had none.
 */
export type MetadataOutcome = "removed" | "kept" | "unsupported";

export interface ImageResult {
  blob: Blob;
  /** True when the user asked for a different format or size, so the result must be used. */
  converted: boolean;
  metadata?: MetadataOutcome;
}

export function isHeic(file: File): boolean {
  return (
    /^image\/hei[cf]/.test(file.type) || /\.(heic|heif)$/i.test(file.name)
  );
}

/** Decodes an iPhone HEIC/HEIF photo to JPEG. */
export async function heicToJpeg(file: File, quality = 0.92): Promise<File> {
  const { heicTo } = await import("heic-to");
  const blob = await heicTo({ blob: file, type: "image/jpeg", quality });
  const name = file.name.replace(/\.(heic|heif)$/i, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
}

const FORMAT_TYPES = {
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
} as const;

export async function compressImage(
  file: File,
  settings: CompressionSettings,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<ImageResult> {
  const { format, maxDimension, keepMetadata } = settings.image;
  const heic = isHeic(file);
  const input = heic ? await heicToJpeg(file) : file;
  throwIfAborted(signal);

  const outputType = format === "original" ? input.type : FORMAT_TYPES[format];
  const converted =
    heic || outputType !== file.type || maxDimension !== null;
  const ratio = getTargetRatio(settings, input.size);
  const isCustom = settings.level === "Custom";

  // Read EXIF from the original (before any HEIC conversion, which drops it).
  const exif = await readExif(file).catch(() => null);
  throwIfAborted(signal);

  let blob: Blob;
  if (outputType === "image/avif") {
    const worker = new Worker(new URL("./avif.worker.ts", import.meta.url), {
      type: "module",
    });
    const buffer = await runWorkerJob<ArrayBuffer>(
      worker,
      {
        blob: input,
        maxDimension,
        qualities:
          settings.level === "Custom"
            ? AVIF_CUSTOM_QUALITIES
            : [getAvifQuality(settings.level)],
        targetBytes: isCustom ? settings.targetBytes : null,
      },
      onProgress,
      signal,
    );
    blob = new Blob([buffer], { type: "image/avif" });
  } else {
    const targetMB = (input.size * ratio) / (1024 * 1024);
    blob = await imageCompression(input, {
      // Undershoot custom targets by 25% so the result stays under them.
      maxSizeMB: Math.max(isCustom ? targetMB * 0.75 : targetMB, 0.01),
      maxWidthOrHeight: maxDimension ?? undefined,
      // Low/Medium keep the original dimensions; stronger levels may downscale,
      // which is the only way lossless formats like PNG get meaningfully smaller.
      alwaysKeepResolution:
        maxDimension === null &&
        (settings.level === "Low" || settings.level === "Medium"),
      fileType: outputType,
      // Metadata is handled below for every format, not just JPEG to JPEG.
      preserveExif: false,
      useWebWorker: true,
      libURL: new URL(imageCompressionLibUrl, location.href).href,
      maxIteration: 30,
      initialQuality: isCustom ? 0.6 : 0.8,
      signal,
      onProgress,
    });
  }

  if (!exif) return { blob, converted };
  if (!keepMetadata) return { blob, converted, metadata: "removed" };
  const withExif = await writeExif(blob, resetOrientation(exif));
  return withExif
    ? { blob: withExif, converted, metadata: "kept" }
    : { blob, converted, metadata: "unsupported" };
}

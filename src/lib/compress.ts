import type { CompressionSettings } from "./settings";

export type FileKind = "image" | "svg" | "media" | "pdf";

// GIFs are excluded: re-encoding them through a canvas drops the animation.
const RASTER_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
]);

export function getFileKind(file: File): FileKind | null {
  if (file.type === "image/svg+xml") return "svg";
  if (RASTER_IMAGE_TYPES.has(file.type)) return "image";
  if (file.type.startsWith("video/") || file.type.startsWith("audio/"))
    return "media";
  if (file.type === "application/pdf") return "pdf";
  return null;
}

export interface CompressResult {
  blob: Blob;
  /** True when compression didn't make the file smaller, so the original is returned. */
  keptOriginal: boolean;
}

/** Each compressor is loaded on demand so its library stays out of the main bundle. */
export async function compressFile(
  file: File,
  id: string,
  settings: CompressionSettings,
  onProgress: (percent: number) => void,
): Promise<CompressResult> {
  const kind = getFileKind(file);
  let blob: Blob;
  switch (kind) {
    case "image":
      blob = await (await import("./image")).compressImage(file, settings, onProgress);
      break;
    case "svg":
      blob = await (await import("./svg")).compressSvg(file, settings);
      break;
    case "media":
      blob = await (await import("./media")).compressMedia(file, id, settings, onProgress);
      break;
    case "pdf":
      blob = await (await import("./pdf")).compressPdf(file, settings, onProgress);
      break;
    default:
      throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
  }
  if (blob.size >= file.size) return { blob: file, keptOriginal: true };
  return { blob, keptOriginal: false };
}

export async function createZip(
  entries: { name: string; blob: Blob }[],
): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  entries.forEach(({ name, blob }) => zip.file(name, blob));
  // Media is already compressed; deflating it again costs time for ~0% gain.
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

import type { CompressionSettings, FileOverrides } from "./settings";

export type FileKind = "image" | "gif" | "svg" | "media" | "pdf";

const RASTER_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/heic",
  "image/heif",
]);

export const ACCEPTED_TYPES =
  "image/jpeg,image/png,image/webp,image/bmp,image/gif,image/svg+xml," +
  "image/heic,image/heif,.heic,.heif,video/*,audio/*,application/pdf";

export function getFileKind(file: File): FileKind | null {
  if (file.type === "image/svg+xml") return "svg";
  if (file.type === "image/gif") return "gif";
  // Some browsers report HEIC files with an empty type.
  if (RASTER_IMAGE_TYPES.has(file.type) || /\.(heic|heif)$/i.test(file.name))
    return "image";
  if (file.type.startsWith("video/") || file.type.startsWith("audio/"))
    return "media";
  if (file.type === "application/pdf") return "pdf";
  return null;
}

/** Whether the browser can show the original file in an <img>. */
export function canPreviewOriginal(file: File): boolean {
  const kind = getFileKind(file);
  return (
    (kind === "image" || kind === "gif" || kind === "svg") &&
    !/^image\/hei[cf]/.test(file.type) &&
    !/\.(heic|heif)$/i.test(file.name)
  );
}

export interface CompressResult {
  blob: Blob;
  /** True when compression didn't make the file smaller, so the original is returned. */
  keptOriginal: boolean;
  /** True when image metadata such as GPS location was stripped. */
  metadataRemoved: boolean;
}

/** Each compressor is loaded on demand so its library stays out of the main bundle. */
export async function compressFile(
  file: File,
  id: string,
  settings: CompressionSettings,
  overrides: FileOverrides | undefined,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<CompressResult> {
  const kind = getFileKind(file);
  let blob: Blob;
  // A conversion the user asked for (new format, size or length) is always
  // returned, even when it isn't smaller than the original.
  let converted = false;
  switch (kind) {
    case "image": {
      const result = await (await import("./image")).compressImage(
        file,
        settings,
        onProgress,
        signal,
      );
      ({ blob, converted } = result);
      break;
    }
    case "gif":
      blob = await (await import("./gif")).compressGif(file, settings, signal);
      break;
    case "svg":
      blob = await (await import("./svg")).compressSvg(file, settings);
      break;
    case "media": {
      const result = await (await import("./media")).compressMedia(
        file,
        id,
        settings,
        overrides,
        onProgress,
        signal,
      );
      ({ blob, converted } = result);
      break;
    }
    case "pdf":
      blob = await (await import("./pdf")).compressPdf(
        file,
        settings,
        onProgress,
        signal,
      );
      break;
    default:
      throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
  }
  if (!converted && blob.size >= file.size) {
    return { blob: file, keptOriginal: true, metadataRemoved: false };
  }
  return {
    blob,
    keptOriginal: false,
    metadataRemoved:
      kind === "image" &&
      !(settings.image.keepMetadata && file.type === "image/jpeg" && blob.type === "image/jpeg"),
  };
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

/** Recursively collects files from dropped folders. */
export async function filesFromDataTransfer(
  dataTransfer: DataTransfer,
): Promise<File[]> {
  const entries = Array.from(dataTransfer.items)
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry);
  if (entries.length === 0) return Array.from(dataTransfer.files);

  const files: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.name.startsWith(".")) return; // .DS_Store and other hidden files
    if (entry.isFile) {
      files.push(
        await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        ),
      );
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns results in batches until it returns an empty one.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (batch.length === 0) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const entry of entries) await walk(entry);
  return files;
}

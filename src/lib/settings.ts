export type CompressionLevel = "Low" | "Medium" | "High" | "Extreme" | "Custom";

export const LEVELS: CompressionLevel[] = [
  "Low",
  "Medium",
  "High",
  "Extreme",
  "Custom",
];

export interface CompressionSettings {
  level: CompressionLevel;
  /** Per-file target size in bytes; only used when level is "Custom". */
  targetBytes: number | null;
}

const PRESET_RATIOS: Record<Exclude<CompressionLevel, "Custom">, number> = {
  Low: 0.8,
  Medium: 0.5,
  High: 0.3,
  Extreme: 0.15,
};

/** Parses the "Target (MB)" input. Returns bytes, or null if not a positive number. */
export function parseTargetMB(value: string): number | null {
  const mb = parseFloat(value);
  if (!Number.isFinite(mb) || mb <= 0) return null;
  return mb * 1024 * 1024;
}

export function isSettingsValid(settings: CompressionSettings): boolean {
  return settings.level !== "Custom" || settings.targetBytes !== null;
}

/** Expected output size as a fraction of the original. */
export function getTargetRatio(
  settings: CompressionSettings,
  originalSize: number,
): number {
  if (settings.level !== "Custom") return PRESET_RATIOS[settings.level];
  if (!settings.targetBytes || originalSize <= 0) return PRESET_RATIOS.Medium;
  return Math.min(settings.targetBytes / originalSize, 0.9);
}

export function getVideoCrf(level: CompressionLevel, ratio: number): number {
  switch (level) {
    case "Low":
      return 23;
    case "Medium":
      return 28;
    case "High":
      return 32;
    case "Extreme":
      return 36;
    case "Custom":
      return Math.min(51, Math.max(18, Math.round(51 - ratio * 33)));
  }
}

export function getAudioBitrateKbps(
  level: CompressionLevel,
  ratio: number,
): number {
  switch (level) {
    case "Low":
      return 192;
    case "Medium":
      return 128;
    case "High":
      return 64;
    case "Extreme":
      return 32;
    case "Custom":
      // Undershoot by 25% to stay under the target.
      return Math.max(16, Math.round(256 * ratio * 0.75));
  }
}

/**
 * Video bitrate (kbps) needed to land under targetBytes for a clip of the
 * given duration, leaving room for the audio track and container overhead.
 */
export function getVideoBitrateForTarget(
  targetBytes: number,
  durationSec: number,
  audioKbps: number,
): number {
  const totalKbps = (targetBytes * 8 * 0.92) / durationSec / 1000;
  return Math.max(50, Math.floor(totalKbps - audioKbps));
}

export function getPdfRenderOptions(
  level: CompressionLevel,
  ratio: number,
): { scale: number; quality: number } {
  switch (level) {
    case "Low":
      return { scale: 2.0, quality: 0.8 };
    case "Medium":
      return { scale: 1.5, quality: 0.6 };
    case "High":
      return { scale: 1.0, quality: 0.5 };
    case "Extreme":
      return { scale: 0.8, quality: 0.4 };
    case "Custom":
      return {
        scale: Math.max(0.3, ratio * 1.5),
        quality: Math.max(0.05, ratio * 0.7),
      };
  }
}

/** Estimated bytes saved across all files, or null when it can't be estimated. */
export function estimateSavings(
  sizes: number[],
  settings: CompressionSettings,
): { saved: number; percentage: number } | null {
  if (sizes.length === 0 || !isSettingsValid(settings)) return null;
  const totalOriginal = sizes.reduce((acc, s) => acc + s, 0);
  if (totalOriginal === 0) return null;
  const totalCompressed = sizes.reduce(
    (acc, s) => acc + s * getTargetRatio(settings, s),
    0,
  );
  const saved = totalOriginal - totalCompressed;
  return { saved, percentage: Math.round((saved / totalOriginal) * 100) };
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1,
  );
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

const EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "image/svg+xml": "svg",
};

/** Download name for a compressed file, with the extension matching its real format. */
export function getOutputName(originalName: string, outputType: string): string {
  const ext = EXTENSIONS[outputType];
  const dot = originalName.lastIndexOf(".");
  const base = dot > 0 ? originalName.slice(0, dot) : originalName;
  const currentExt = dot > 0 ? originalName.slice(dot + 1).toLowerCase() : "";
  const sameFormat =
    !ext || currentExt === ext || (ext === "jpg" && currentExt === "jpeg");
  return sameFormat
    ? `compressed_${originalName}`
    : `compressed_${base}.${ext}`;
}

/** Makes names unique so files in a zip don't overwrite each other. */
export function dedupeNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf(".");
    return dot > 0
      ? `${name.slice(0, dot)} (${count})${name.slice(dot)}`
      : `${name} (${count})`;
  });
}

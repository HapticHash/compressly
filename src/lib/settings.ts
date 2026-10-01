export type CompressionLevel = "Low" | "Medium" | "High" | "Extreme" | "Custom";

export const LEVELS: CompressionLevel[] = [
  "Low",
  "Medium",
  "High",
  "Extreme",
  "Custom",
];

export type PresetLevel = Exclude<CompressionLevel, "Custom">;
export const PRESET_LEVELS: PresetLevel[] = ["Low", "Medium", "High", "Extreme"];

/** The part of the settings that decides how small each file should get. */
export interface TargetSettings {
  level: CompressionLevel;
  /** Per-file target size in bytes; only used when level is "Custom". */
  targetBytes: number | null;
}

export type ImageFormat = "original" | "jpeg" | "webp" | "avif";
export type PdfMode = "keep-text" | "smallest";
export type VideoFormat = "mp4" | "webm" | "gif";

export interface ImageOptions {
  format: ImageFormat;
  /** Longest side in pixels; null keeps the original dimensions. */
  maxDimension: number | null;
  /** Keep EXIF data (camera, date, GPS). Only possible for JPEG to JPEG. */
  keepMetadata: boolean;
}

export interface VideoOptions {
  format: VideoFormat;
  /** Short side in pixels (1080 = 1080p); null keeps the original. */
  resolution: number | null;
  removeAudio: boolean;
}

export interface CompressionSettings extends TargetSettings {
  image: ImageOptions;
  pdfMode: PdfMode;
  video: VideoOptions;
}

/** Settings a single file can override. */
export interface FileOverrides {
  level?: PresetLevel;
  /** Trim range in seconds, for video and audio. */
  trimStart?: number;
  trimEnd?: number;
}

export const DEFAULT_SETTINGS: CompressionSettings = {
  level: "Medium",
  targetBytes: null,
  image: { format: "original", maxDimension: null, keepMetadata: false },
  pdfMode: "keep-text",
  video: { format: "mp4", resolution: null, removeAudio: false },
};

export function applyOverrides(
  settings: CompressionSettings,
  overrides?: FileOverrides,
): CompressionSettings {
  return overrides?.level ? { ...settings, level: overrides.level } : settings;
}

export type TargetUnit = "KB" | "MB";

/** One-click Custom targets for common upload limits. */
export const TARGET_PRESETS: { label: string; value: string; unit: TargetUnit }[] = [
  { label: "WhatsApp · 16 MB", value: "16", unit: "MB" },
  { label: "Discord · 10 MB", value: "10", unit: "MB" },
  { label: "Email · 25 MB", value: "25", unit: "MB" },
  { label: "Forms · 200 KB", value: "200", unit: "KB" },
  { label: "100 KB", value: "100", unit: "KB" },
];

export const MAX_DIMENSIONS = [3840, 2560, 1920, 1280, 800];
export const VIDEO_RESOLUTIONS = [1080, 720, 480];

const PRESET_RATIOS: Record<Exclude<CompressionLevel, "Custom">, number> = {
  Low: 0.8,
  Medium: 0.5,
  High: 0.3,
  Extreme: 0.15,
};

/** Parses the target size input. Returns bytes, or null if not a positive number. */
export function parseTarget(value: string, unit: TargetUnit = "MB"): number | null {
  const amount = parseFloat(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount * 1024 * (unit === "MB" ? 1024 : 1);
}

export function isSettingsValid(settings: TargetSettings): boolean {
  return settings.level !== "Custom" || settings.targetBytes !== null;
}

/** Expected output size as a fraction of the original. */
export function getTargetRatio(
  settings: TargetSettings,
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

/**
 * CRF for VP8 (WebM), whose scale runs 4-63. VP9 would compress better but
 * hangs in the FFmpeg WebAssembly build, so WebM output uses VP8.
 */
export function getVp8Crf(level: CompressionLevel, ratio: number): number {
  switch (level) {
    case "Low":
      return 10;
    case "Medium":
      return 20;
    case "High":
      return 30;
    case "Extreme":
      return 40;
    case "Custom":
      return Math.min(63, Math.max(4, Math.round(63 - ratio * 60)));
  }
}

/** Palette size when converting video to GIF. */
export function getGifColors(level: CompressionLevel, ratio: number): number {
  switch (level) {
    case "Low":
      return 256;
    case "Medium":
      return 192;
    case "High":
      return 128;
    case "Extreme":
      return 64;
    case "Custom":
      return Math.min(256, Math.max(32, Math.round(ratio * 320)));
  }
}

/** Lossy level for gifsicle (0 = lossless, ~200 = very lossy) and palette size. */
export function getGifsicleOptions(
  level: CompressionLevel,
  ratio: number,
): { lossy: number; colors: number | null } {
  switch (level) {
    case "Low":
      return { lossy: 20, colors: null };
    case "Medium":
      return { lossy: 60, colors: null };
    case "High":
      return { lossy: 100, colors: 128 };
    case "Extreme":
      return { lossy: 150, colors: 64 };
    case "Custom":
      return ratio > 0.6
        ? { lossy: 40, colors: null }
        : ratio > 0.3
          ? { lossy: 100, colors: 128 }
          : { lossy: 180, colors: 48 };
  }
}

/** AVIF quality (0-100) per level. Custom targets search downwards from 65. */
export function getAvifQuality(level: PresetLevel): number {
  return { Low: 70, Medium: 55, High: 40, Extreme: 28 }[level];
}

export const AVIF_CUSTOM_QUALITIES = [65, 50, 38, 28, 20, 12];

/** JPEG quality and longest side used when re-compressing images inside a PDF. */
export function getPdfImageOptions(
  level: CompressionLevel,
  ratio: number,
): { maxDimension: number; quality: number } {
  switch (level) {
    case "Low":
      return { maxDimension: 2400, quality: 0.8 };
    case "Medium":
      return { maxDimension: 1800, quality: 0.65 };
    case "High":
      return { maxDimension: 1400, quality: 0.5 };
    case "Extreme":
      return { maxDimension: 1000, quality: 0.4 };
    case "Custom":
      return {
        maxDimension: Math.round(Math.max(600, Math.min(2400, ratio * 3000))),
        quality: Math.max(0.2, Math.min(0.8, ratio)),
      };
  }
}

/**
 * FFmpeg scale filter capping the short side at `resolution`, so 720 means
 * 720p for both landscape and portrait video. Dimensions stay even (-2).
 */
export function getScaleFilter(resolution: number): string {
  return (
    `scale='if(gt(iw,ih),-2,min(${resolution},iw))'` +
    `:'if(gt(iw,ih),min(${resolution},ih),-2)'`
  );
}

/** Estimated bytes saved across all files, or null when it can't be estimated. */
export function estimateSavings(
  sizes: number[],
  settings: TargetSettings,
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
  "video/webm": "webm",
  "image/gif": "gif",
  "image/avif": "avif",
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

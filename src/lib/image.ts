import imageCompression from "browser-image-compression";
import { type CompressionSettings, getTargetRatio } from "./settings";

export async function compressImage(
  file: File,
  settings: CompressionSettings,
  onProgress: (percent: number) => void,
): Promise<Blob> {
  const isCustom = settings.level === "Custom";
  const targetMB =
    (file.size * getTargetRatio(settings, file.size)) / (1024 * 1024);
  return imageCompression(file, {
    // Undershoot custom targets by 25% so the result stays under them.
    maxSizeMB: Math.max(isCustom ? targetMB * 0.75 : targetMB, 0.01),
    // Low/Medium keep the original dimensions; stronger levels may downscale,
    // which is the only way lossless formats like PNG get meaningfully smaller.
    alwaysKeepResolution:
      settings.level === "Low" || settings.level === "Medium",
    useWebWorker: true,
    maxIteration: 30,
    initialQuality: isCustom ? 0.6 : 0.8,
    onProgress,
  });
}

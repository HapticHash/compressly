import { optimize } from "svgo/browser";
import type { CompressionSettings } from "./settings";

const FLOAT_PRECISION: Record<CompressionSettings["level"], number> = {
  Low: 4,
  Medium: 3,
  High: 2,
  Extreme: 1,
  Custom: 2,
};

export async function compressSvg(
  file: File,
  settings: CompressionSettings,
): Promise<Blob> {
  const { data } = optimize(await file.text(), {
    multipass: settings.level !== "Low",
    floatPrecision: FLOAT_PRECISION[settings.level],
  });
  return new Blob([data], { type: "image/svg+xml" });
}

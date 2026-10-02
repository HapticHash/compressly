import gifsicle from "gifsicle-wasm-browser";
import { throwIfAborted } from "./abort";
import {
  type CompressionSettings,
  getGifsicleOptions,
  getTargetRatio,
} from "./settings";

/** Shrinks animated GIFs with gifsicle, keeping every frame. */
export async function compressGif(
  file: File,
  settings: CompressionSettings,
  signal?: AbortSignal,
): Promise<Blob> {
  const { lossy, colors } = getGifsicleOptions(
    settings.level,
    getTargetRatio(settings, file.size),
  );
  const maxDimension = settings.image.maxDimension;
  const command = [
    "-O3",
    `--lossy=${lossy}`,
    colors ? `--colors ${colors}` : "",
    maxDimension ? `--resize-fit ${maxDimension}x${maxDimension}` : "",
    "1.gif -o /out/out.gif",
  ]
    .filter(Boolean)
    .join(" ");

  // gifsicle runs in its own worker and can't be interrupted; a cancelled
  // job is simply discarded when it finishes.
  const [output] = await gifsicle.run({
    input: [{ file, name: "1.gif" }],
    command: [command],
  });
  throwIfAborted(signal);
  if (!output) throw new Error("gifsicle produced no output");
  return new Blob([output], { type: "image/gif" });
}

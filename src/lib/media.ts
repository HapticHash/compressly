import type { FFmpeg } from "@ffmpeg/ffmpeg";
import {
  type CompressionSettings,
  getAudioBitrateKbps,
  getTargetRatio,
  getVideoBitrateForTarget,
  getVideoCrf,
} from "./settings";

// Pinned to the same version as the core the @ffmpeg/ffmpeg wrapper expects.
// The ~31 MB wasm is too large to deploy on Cloudflare Pages (25 MiB file limit),
// so it is fetched from the CDN, but only once a video or audio file is added.
const CORE_BASE_URL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";

let ffmpegPromise: Promise<FFmpeg> | null = null;

/** Loads FFmpeg once; later calls reuse the same instance. */
export function loadFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/util"),
      ]);
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL(
          `${CORE_BASE_URL}/ffmpeg-core.js`,
          "text/javascript",
        ),
        wasmURL: await toBlobURL(
          `${CORE_BASE_URL}/ffmpeg-core.wasm`,
          "application/wasm",
        ),
      });
      return ffmpeg;
    })();
    // Allow a retry after a failed load (e.g. a network blip).
    ffmpegPromise.catch(() => {
      ffmpegPromise = null;
    });
  }
  return ffmpegPromise;
}

// FFmpeg has a single virtual FS and can only run one command at a time.
let queue: Promise<unknown> = Promise.resolve();
function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.catch(() => undefined);
  return result;
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "bin";
}

/** Reads the duration from the file's metadata; null if the browser can't. */
function getMediaDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(
      file.type.startsWith("video/") ? "video" : "audio",
    );
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      el.removeAttribute("src");
      resolve(value);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () =>
      done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.onerror = () => done(null);
    el.src = url;
  });
}

export async function compressMedia(
  file: File,
  id: string,
  settings: CompressionSettings,
  onProgress: (percent: number) => void,
): Promise<Blob> {
  const isVideo = file.type.startsWith("video/");
  const ratio = getTargetRatio(settings, file.size);
  const duration =
    isVideo && settings.level === "Custom" && settings.targetBytes
      ? await getMediaDuration(file)
      : null;
  const [ffmpeg, { fetchFile }] = await Promise.all([
    loadFFmpeg(),
    import("@ffmpeg/util"),
  ]);

  return runExclusive(async () => {
    const inputName = `input_${id}.${getExtension(file.name)}`;
    const outputName = `output_${id}.${isVideo ? "mp4" : "mp3"}`;

    let args: string[];
    if (isVideo) {
      const audioKbps = 96;
      const video: string[] =
        duration && settings.targetBytes
          ? (() => {
              const kbps = getVideoBitrateForTarget(
                settings.targetBytes,
                duration,
                audioKbps,
              );
              return [
                "-b:v", `${kbps}k`,
                "-maxrate", `${kbps}k`,
                "-bufsize", `${kbps * 2}k`,
              ];
            })()
          : ["-crf", String(getVideoCrf(settings.level, ratio))];
      args = [
        "-i", inputName,
        "-c:v", "libx264",
        ...video,
        "-preset", "veryfast",
        ...(settings.level === "Extreme"
          ? ["-vf", "scale='min(1280,iw)':-2"]
          : []),
        "-c:a", "aac",
        "-b:a", `${audioKbps}k`,
        "-movflags", "+faststart",
        outputName,
      ];
    } else {
      const kbps = getAudioBitrateKbps(settings.level, ratio);
      args = ["-i", inputName, "-vn", "-b:a", `${kbps}k`, outputName];
    }

    const handleProgress = ({ progress }: { progress: number }) => {
      if (Number.isFinite(progress)) {
        onProgress(Math.min(100, Math.max(0, Math.round(progress * 100))));
      }
    };

    ffmpeg.on("progress", handleProgress);
    try {
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      const exitCode = await ffmpeg.exec(args);
      if (exitCode !== 0) {
        throw new Error(`FFmpeg exited with code ${exitCode}`);
      }
      const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
      return new Blob([data], { type: isVideo ? "video/mp4" : "audio/mpeg" });
    } finally {
      ffmpeg.off("progress", handleProgress);
      await ffmpeg.deleteFile(inputName).catch(() => {});
      await ffmpeg.deleteFile(outputName).catch(() => {});
    }
  });
}

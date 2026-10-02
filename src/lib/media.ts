import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { abortError, throwIfAborted } from "./abort";
import { CompressionError } from "./errors";
import {
  type CompressionSettings,
  type FileOverrides,
  getAudioBitrateKbps,
  getGifColors,
  getScaleFilter,
  getTargetRatio,
  getVideoBitrateForTarget,
  getVideoCrf,
  getVp8Crf,
} from "./settings";

// Pinned to the same version as the core the @ffmpeg/ffmpeg wrapper expects.
// The ~31 MB wasm is too large to deploy on Cloudflare (25 MiB file limit),
// so it is fetched from the CDN, once a video or audio file is added. The
// service worker caches it after the first download.
//
// The multi-threaded core (@ffmpeg/core-mt) was tried: it crashes with
// "null function or function signature mismatch" in Chromium on simple
// encodes, so the single-threaded core is used.
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
      try {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
        });
      } catch {
        throw new CompressionError(
          navigator.onLine === false
            ? "Video and audio need an internet connection the first time, to download the 31 MB video engine. It works offline after that."
            : "Couldn't download the video engine. Check your connection and try again.",
        );
      }
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

interface MediaInfo {
  /** Seconds, or null when the browser can't tell. */
  duration: number | null;
  /** False for audio-only files, null when the browser can't tell. */
  hasVideo: boolean | null;
}

/** Reads duration and whether there's a video track from the file's metadata. */
function probeMedia(file: File): Promise<MediaInfo> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const isVideoType = file.type.startsWith("video/");
    const el = document.createElement(isVideoType ? "video" : "audio");
    const done = (info: MediaInfo) => {
      URL.revokeObjectURL(url);
      el.removeAttribute("src");
      resolve(info);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () =>
      done({
        // Recordings from MediaRecorder report Infinity until fully read.
        duration: Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null,
        hasVideo: isVideoType ? (el as HTMLVideoElement).videoWidth > 0 : false,
      });
    el.onerror = () => done({ duration: null, hasVideo: null });
    el.src = url;
  });
}

const seconds = (value: number) => `${Math.round(value * 10) / 10} s`;

const OUTPUT = {
  mp4: { ext: "mp4", type: "video/mp4" },
  webm: { ext: "webm", type: "video/webm" },
  gif: { ext: "gif", type: "image/gif" },
  audio: { ext: "mp3", type: "audio/mpeg" },
} as const;

export interface MediaResult {
  blob: Blob;
  /** True when the user changed format, size or length, so the result must be used. */
  converted: boolean;
}

export async function compressMedia(
  file: File,
  id: string,
  settings: CompressionSettings,
  overrides: FileOverrides | undefined,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<MediaResult> {
  const trimStart = overrides?.trimStart && overrides.trimStart > 0 ? overrides.trimStart : null;
  const trimEnd = overrides?.trimEnd && overrides.trimEnd > 0 ? overrides.trimEnd : null;
  if (trimEnd !== null && trimEnd <= (trimStart ?? 0)) {
    throw new CompressionError("The trim end must be after the start.");
  }

  const info = await probeMedia(file);
  if (info.duration !== null && trimStart !== null && trimStart >= info.duration) {
    throw new CompressionError(
      `The trim start (${seconds(trimStart)}) is past the end of the clip (${seconds(info.duration)}).`,
    );
  }
  // Voice recordings often come as video/webm with no picture: treat as audio.
  const isVideo = file.type.startsWith("video/") && info.hasVideo !== false;
  const { format, resolution, removeAudio } = settings.video;
  const output = isVideo ? OUTPUT[format] : OUTPUT.audio;
  const ratio = getTargetRatio(settings, file.size);

  const end = Math.min(trimEnd ?? Infinity, info.duration ?? Infinity);
  const duration =
    info.duration === null && trimEnd === null ? null : end - (trimStart ?? 0);
  const { fetchFile } = await import("@ffmpeg/util");
  throwIfAborted(signal);

  return runExclusive(async () => {
    throwIfAborted(signal);
    const ffmpeg = await loadFFmpeg();
    const inputName = `input_${id}.${getExtension(file.name)}`;
    const outputName = `output_${id}.${output.ext}`;

    const args: string[] = [];
    // -ss before -i seeks quickly; -t then counts from the new start.
    if (trimStart !== null) args.push("-ss", String(trimStart));
    args.push("-i", inputName);
    if (trimEnd !== null) args.push("-t", String(trimEnd - (trimStart ?? 0)));

    if (!isVideo) {
      args.push("-vn", "-b:a", `${getAudioBitrateKbps(settings.level, ratio)}k`);
    } else if (format === "gif") {
      const width = resolution ? getScaleFilter(resolution) : "scale='min(480,iw)':-2";
      const colors = getGifColors(settings.level, ratio);
      args.push(
        "-filter_complex",
        `fps=12,${width}:flags=lanczos,split[a][b];` +
          `[a]palettegen=max_colors=${colors}[p];[b][p]paletteuse=dither=bayer`,
        "-loop", "0",
      );
    } else {
      const audioKbps = 96;
      const targetKbps =
        duration && settings.level === "Custom" && settings.targetBytes
          ? getVideoBitrateForTarget(
              settings.targetBytes,
              duration,
              removeAudio ? 0 : audioKbps,
            )
          : null;
      const filters: string[] = [];
      if (resolution) filters.push(getScaleFilter(resolution));
      else if (settings.level === "Extreme") filters.push(getScaleFilter(720));
      if (filters.length) args.push("-vf", filters.join(","));

      if (format === "webm") {
        // VP8 rather than VP9: libvpx-vp9 hangs in the WebAssembly build.
        // With VP8, -crf sets quality and -b:v is the upper bitrate bound.
        args.push(
          "-c:v", "libvpx",
          ...(targetKbps
            ? ["-b:v", `${targetKbps}k`]
            : ["-crf", String(getVp8Crf(settings.level, ratio)), "-b:v", "8M"]),
          "-deadline", "realtime",
          "-cpu-used", "8",
        );
        args.push(...(removeAudio ? ["-an"] : ["-c:a", "libopus", "-b:a", `${audioKbps}k`]));
      } else {
        args.push(
          "-c:v", "libx264",
          ...(targetKbps
            ? ["-b:v", `${targetKbps}k`, "-maxrate", `${targetKbps}k`, "-bufsize", `${targetKbps * 2}k`]
            : ["-crf", String(getVideoCrf(settings.level, ratio))]),
          "-preset", "veryfast",
          "-pix_fmt", "yuv420p",
          "-movflags", "+faststart",
        );
        args.push(...(removeAudio ? ["-an"] : ["-c:a", "aac", "-b:a", `${audioKbps}k`]));
      }
    }
    args.push(outputName);

    const handleProgress = ({ progress }: { progress: number }) => {
      if (Number.isFinite(progress)) {
        onProgress(Math.min(100, Math.max(0, Math.round(progress * 100))));
      }
    };
    // FFmpeg can't interrupt a running command; terminating the worker is the
    // only way. The next job loads a fresh instance.
    const onAbort = () => {
      ffmpeg.terminate();
      ffmpegPromise = null;
    };

    ffmpeg.on("progress", handleProgress);
    signal?.addEventListener("abort", onAbort);
    try {
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      const exitCode = await ffmpeg.exec(args);
      throwIfAborted(signal);
      if (exitCode !== 0) {
        throw new CompressionError(
          "Couldn't process this file. It may be damaged or use a format the video engine doesn't support.",
        );
      }
      const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
      // A trim outside the clip (when the length couldn't be read up front)
      // yields a container with no frames.
      if (data.length < 1024 && file.size > 8 * 1024) {
        throw new CompressionError("Nothing was left after compressing. Check the trim range.");
      }
      return {
        blob: new Blob([data], { type: output.type }),
        converted:
          trimStart !== null ||
          trimEnd !== null ||
          (isVideo && (format !== "mp4" || resolution !== null || removeAudio)),
      };
    } catch (error) {
      if (signal?.aborted) throw abortError();
      throw error;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      if (!signal?.aborted) {
        ffmpeg.off("progress", handleProgress);
        await ffmpeg.deleteFile(inputName).catch(() => {});
        await ffmpeg.deleteFile(outputName).catch(() => {});
      }
    }
  });
}

import { memo, useState } from "react";
import { Select } from "./Select";
import { motion } from "motion/react";
import {
  Columns2,
  Download,
  File,
  FileText,
  Image as ImageIcon,
  MapPin,
  MapPinOff,
  Music,
  Share2,
  SlidersHorizontal,
  Square,
  Video,
  X,
} from "lucide-react";
import type { FileKind } from "../lib/compress";
import type { MetadataOutcome } from "../lib/image";
import { type FileOverrides, PRESET_LEVELS, formatSize } from "../lib/settings";

export interface FileItem {
  id: string;
  file: File;
  kind: FileKind | null;
  status: "idle" | "compressing" | "done" | "error" | "unsupported";
  progress: number;
  /** Compressing, but still waiting for a free slot. */
  waiting?: boolean;
  originalSize: number;
  compressedSize?: number;
  keptOriginal?: boolean;
  /** The original already met the Custom target, so it was left as is. */
  underTarget?: boolean;
  /** The Custom target in bytes, when the result is still larger. */
  missedTarget?: number;
  missedTargetHint?: string;
  /** Why the file failed or can't be compressed, for the user. */
  error?: string;
  metadata?: MetadataOutcome;
  previewUrl?: string;
  compressedBlob?: Blob;
  overrides?: FileOverrides;
}

function getFileIcon(type: string) {
  if (type.startsWith("image/")) return <ImageIcon className="w-6 h-6 text-primary" />;
  if (type.startsWith("video/")) return <Video className="w-6 h-6 text-accent" />;
  if (type.startsWith("audio/")) return <Music className="w-6 h-6 text-accent-light" />;
  if (type === "application/pdf") return <FileText className="w-6 h-6 text-accent" />;
  return <File className="w-6 h-6 text-text-muted" />;
}

const ICON_BUTTON =
  "p-2 sm:p-2.5 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

interface FileRowProps {
  file: FileItem;
  canShare: boolean;
  onRemove: (id: string) => void;
  onCancel: (id: string) => void;
  onDownload: (id: string) => void;
  onShare: (id: string) => void;
  onCompare: (id: string) => void;
  onOverrides: (id: string, overrides: FileOverrides) => void;
}

function parseSeconds(value: string): number | undefined {
  const n = parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// Memoized so a progress update on one file doesn't re-render every row.
export const FileRow = memo(function FileRow({
  file,
  canShare,
  onRemove,
  onCancel,
  onDownload,
  onShare,
  onCompare,
  onOverrides,
}: FileRowProps) {
  const [showOptions, setShowOptions] = useState(false);
  const isMedia = file.kind === "media";
  const hasOptions = file.status !== "unsupported";
  const busy = file.status === "compressing";
  const overrides = file.overrides ?? {};

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-surface/60 rounded-2xl border border-border shadow-lg relative overflow-hidden"
    >
      {busy && (
        <div
          className="absolute left-0 top-0 bottom-0 bg-accent-light/30 transition-all duration-300 ease-out"
          style={{ width: `${file.progress}%` }}
        />
      )}

      <div className="relative p-3 sm:p-4 flex flex-row items-center gap-3 sm:gap-5">
        <div className="w-20 h-20 sm:w-16 sm:h-16 rounded-xl bg-surface border border-border flex items-center justify-center shrink-0 overflow-hidden">
          {file.previewUrl ? (
            file.file.type.startsWith("video/") ? (
              <video
                src={`${file.previewUrl}#t=0.1`}
                className="w-full h-full object-cover"
                preload="metadata"
                muted
                playsInline
              />
            ) : (
              <img
                src={file.previewUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            )
          ) : (
            getFileIcon(file.file.type)
          )}
        </div>

        <div className="flex-grow min-w-0 flex flex-col justify-center">
          <p className="text-sm sm:text-base font-medium text-text truncate mb-1">
            {file.file.name}
          </p>
          <div className="flex flex-col text-xs sm:text-sm text-text-muted gap-0.5">
            <span>Original: {formatSize(file.originalSize)}</span>
            {file.status === "done" && file.keptOriginal && (
              <span className="text-text">
                {file.underTarget
                  ? "Already under your target, original kept"
                  : "Already optimized, original kept"}
              </span>
            )}
            {file.status === "done" && file.missedTarget !== undefined && (
              <span className="text-xs text-accent">
                Couldn't get under {formatSize(file.missedTarget)}; this is as small as it gets.
                {file.missedTargetHint && ` ${file.missedTargetHint}`}
              </span>
            )}
            {file.status === "done" && !file.keptOriginal && file.compressedSize !== undefined && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-text font-semibold">
                  New: {formatSize(file.compressedSize)}
                </span>
                <span className="text-[10px] sm:text-xs bg-primary/10 text-primary px-1.5 sm:px-2 py-0.5 rounded-md font-medium border border-primary/20">
                  {file.compressedSize <= file.originalSize ? "-" : "+"}
                  {Math.abs(Math.round((1 - file.compressedSize / file.originalSize) * 100))}%
                </span>
              </div>
            )}
            {file.status === "done" && file.metadata === "removed" && (
              <span className="flex items-center gap-1 text-xs">
                <MapPinOff className="w-3.5 h-3.5" aria-hidden="true" />
                Location &amp; camera data removed
              </span>
            )}
            {file.status === "done" && file.metadata === "kept" && (
              <span className="flex items-center gap-1 text-xs">
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                Photo metadata kept
              </span>
            )}
            {file.status === "done" && file.metadata === "unsupported" && (
              <span className="flex items-center gap-1 text-xs text-accent">
                <MapPinOff className="w-3.5 h-3.5" aria-hidden="true" />
                Metadata removed: AVIF can't store it
              </span>
            )}
            {file.status === "unsupported" && (
              <span className="text-accent">{file.error ?? "File type not supported"}</span>
            )}
            {file.status === "error" && (
              <span className="text-danger">{file.error ?? "Compression failed"}</span>
            )}
            {overrides.level && (
              <span className="text-xs">Level for this file: {overrides.level}</span>
            )}
          </div>
        </div>

        <div className="shrink-0 grid grid-cols-2 sm:flex sm:flex-row items-center gap-1 sm:gap-2 self-center ml-auto">
          {busy && (
            <>
              <span className="text-sm font-medium text-primary text-center">
                {file.waiting ? "Waiting" : `${Math.round(file.progress)}%`}
              </span>
              <button
                onClick={() => onCancel(file.id)}
                className={`${ICON_BUTTON} text-text-muted hover:text-danger hover:bg-danger/10`}
                title="Cancel"
                aria-label={`Cancel ${file.file.name}`}
              >
                <Square className="w-4 h-4" />
              </button>
            </>
          )}
          {file.status === "done" && !file.keptOriginal && file.kind !== "media" && file.kind !== "pdf" && (
            <button
              onClick={() => onCompare(file.id)}
              className={`${ICON_BUTTON} text-primary hover:bg-primary/10`}
              title="Compare before and after"
              aria-label={`Compare ${file.file.name} before and after`}
            >
              <Columns2 className="w-5 h-5" />
            </button>
          )}
          {file.status === "done" && canShare && (
            <button
              onClick={() => onShare(file.id)}
              className={`${ICON_BUTTON} text-primary hover:bg-primary/10`}
              title="Share"
              aria-label={`Share ${file.file.name}`}
            >
              <Share2 className="w-5 h-5" />
            </button>
          )}
          {file.status === "done" && (
            <button
              onClick={() => onDownload(file.id)}
              className={`${ICON_BUTTON} text-primary hover:bg-primary/10`}
              title="Download"
              aria-label={`Download ${file.file.name}`}
            >
              <Download className="w-5 h-5" />
            </button>
          )}
          {hasOptions && !busy && (
            <button
              onClick={() => setShowOptions((v) => !v)}
              className={`${ICON_BUTTON} text-text-muted hover:text-primary hover:bg-primary/10`}
              title="Options for this file"
              aria-label={`Options for ${file.file.name}`}
              aria-expanded={showOptions}
            >
              <SlidersHorizontal className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={() => onRemove(file.id)}
            className={`${ICON_BUTTON} text-text-muted hover:text-danger hover:bg-danger/10`}
            title="Remove"
            aria-label={`Remove ${file.file.name}`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {showOptions && hasOptions && !busy && (
        <div className="relative border-t border-border/60 px-4 py-3 flex flex-wrap items-end gap-4 text-sm">
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Level
            <Select
              value={overrides.level ?? ""}
              onChange={(e) =>
                onOverrides(file.id, {
                  ...overrides,
                  level: (e.target.value || undefined) as FileOverrides["level"],
                })
              }
              className="h-9 bg-bg border border-border rounded-lg text-sm text-text"
            >
              <option value="">Same as settings</option>
              {PRESET_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </Select>
          </label>
          {isMedia && (
            <>
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                Start (seconds)
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  inputMode="decimal"
                  placeholder="0"
                  value={overrides.trimStart ?? ""}
                  onChange={(e) =>
                    onOverrides(file.id, { ...overrides, trimStart: parseSeconds(e.target.value) })
                  }
                  className="h-9 w-28 bg-bg border border-border rounded-lg px-2 text-sm text-text"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                End (seconds)
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  inputMode="decimal"
                  placeholder="End"
                  value={overrides.trimEnd ?? ""}
                  onChange={(e) =>
                    onOverrides(file.id, { ...overrides, trimEnd: parseSeconds(e.target.value) })
                  }
                  className="h-9 w-28 bg-bg border border-border rounded-lg px-2 text-sm text-text"
                />
              </label>
            </>
          )}
          {isMedia &&
            overrides.trimEnd !== undefined &&
            overrides.trimEnd <= (overrides.trimStart ?? 0) && (
              <p role="alert" className="text-xs text-danger basis-full">
                The end must be after the start.
              </p>
            )}
          <p className="text-xs text-text-muted basis-full">
            Changes apply the next time this file is compressed.
          </p>
        </div>
      )}
    </motion.div>
  );
});

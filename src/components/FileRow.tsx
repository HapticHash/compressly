import { memo } from "react";
import { motion } from "motion/react";
import {
  Download,
  File,
  FileText,
  Image as ImageIcon,
  Music,
  Video,
  X,
} from "lucide-react";
import { formatSize } from "../lib/settings";

export interface FileItem {
  id: string;
  file: File;
  status: "idle" | "compressing" | "done" | "error" | "unsupported";
  progress: number;
  originalSize: number;
  compressedSize?: number;
  keptOriginal?: boolean;
  previewUrl?: string;
  compressedBlob?: Blob;
}

function getFileIcon(type: string) {
  if (type.startsWith("image/"))
    return <ImageIcon className="w-6 h-6 text-primary" />;
  if (type.startsWith("video/"))
    return <Video className="w-6 h-6 text-accent" />;
  if (type.startsWith("audio/"))
    return <Music className="w-6 h-6 text-accent-light" />;
  if (type === "application/pdf")
    return <FileText className="w-6 h-6 text-accent" />;
  return <File className="w-6 h-6 text-text-muted" />;
}

interface FileRowProps {
  file: FileItem;
  onRemove: (id: string) => void;
  onDownload: (id: string) => void;
}

// Memoized so a progress update on one file doesn't re-render every row.
export const FileRow = memo(function FileRow({
  file,
  onRemove,
  onDownload,
}: FileRowProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-surface/60 rounded-2xl p-3 sm:p-4 border border-border flex flex-row items-center gap-3 sm:gap-5 shadow-lg relative overflow-hidden"
    >
      {/* Progress Background */}
      {file.status === "compressing" && (
        <div
          className="absolute left-0 top-0 bottom-0 bg-[#dda15e]/30 transition-all duration-300 ease-out"
          style={{ width: `${file.progress}%` }}
        />
      )}

      <div className="w-20 h-20 sm:w-16 sm:h-16 rounded-xl bg-surface border border-border flex items-center justify-center shrink-0 z-10 overflow-hidden">
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

      <div className="flex-grow min-w-0 z-10 flex flex-col justify-center">
        <p className="text-sm sm:text-base font-medium text-text truncate mb-1">
          {file.file.name}
        </p>
        <div className="flex flex-col text-xs sm:text-sm text-text-muted gap-0.5">
          <span>Original: {formatSize(file.originalSize)}</span>
          {file.status === "done" && file.keptOriginal && (
            <span className="text-text">
              Already optimized, original kept
            </span>
          )}
          {file.status === "done" &&
            !file.keptOriginal &&
            file.compressedSize !== undefined && (
              <div className="flex items-center gap-2">
                <span className="text-text font-semibold">
                  New: {formatSize(file.compressedSize)}
                </span>
                <span className="text-[10px] sm:text-xs bg-primary/10 text-primary px-1.5 sm:px-2 py-0.5 rounded-md font-medium border border-primary/20">
                  -
                  {Math.round(
                    (1 - file.compressedSize / file.originalSize) * 100,
                  )}
                  %
                </span>
              </div>
            )}
          {file.status === "unsupported" && (
            <span className="text-accent">File type not supported</span>
          )}
          {file.status === "error" && (
            <span className="text-red-600">Compression failed</span>
          )}
        </div>
      </div>

      <div className="shrink-0 flex flex-col sm:flex-row items-center gap-2 sm:gap-3 z-10 self-center ml-auto">
        {file.status === "compressing" && (
          <span className="text-sm font-medium text-primary">
            {Math.round(file.progress)}%
          </span>
        )}
        {file.status === "done" && (
          <button
            onClick={() => onDownload(file.id)}
            className="p-2 sm:p-2.5 text-primary hover:bg-primary/10 rounded-full transition-colors"
            title="Download"
            aria-label={`Download ${file.file.name}`}
          >
            <Download className="w-5 h-5" />
          </button>
        )}
        <button
          onClick={() => onRemove(file.id)}
          className="p-2 sm:p-2.5 text-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-full transition-colors"
          title="Remove"
          aria-label={`Remove ${file.file.name}`}
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </motion.div>
  );
});

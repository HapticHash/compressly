import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { formatSize } from "../lib/settings";

interface CompareModalProps {
  name: string;
  originalUrl: string | null;
  compressedUrl: string;
  originalSize: number;
  compressedSize: number;
  onClose: () => void;
}

/** Before/after slider: the compressed image is revealed from the left. */
export function CompareModal({
  name,
  originalUrl,
  compressedUrl,
  originalSize,
  compressedSize,
  onClose,
}: CompareModalProps) {
  const [position, setPosition] = useState(50);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Compare ${name}`}
        tabIndex={-1}
        className="bg-surface rounded-3xl border border-border shadow-2xl w-full max-w-4xl max-h-full flex flex-col overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <p className="font-medium text-text truncate">{name}</p>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-text-muted hover:bg-primary/10"
            aria-label="Close comparison"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="relative flex-1 min-h-0 bg-[repeating-conic-gradient(#8882_0%_25%,transparent_0%_50%)] bg-[length:20px_20px] select-none">
          {originalUrl ? (
            <>
              <img
                src={originalUrl}
                alt="Original"
                className="block w-full max-h-[70vh] object-contain"
              />
              <img
                src={compressedUrl}
                alt="Compressed"
                className="absolute inset-0 w-full h-full object-contain"
                style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)] pointer-events-none"
                style={{ left: `${position}%` }}
              />
              <span className="absolute top-3 left-3 text-xs bg-black/60 text-white px-2 py-1 rounded-md">
                Compressed · {formatSize(compressedSize)}
              </span>
              <span className="absolute top-3 right-3 text-xs bg-black/60 text-white px-2 py-1 rounded-md">
                Original · {formatSize(originalSize)}
              </span>
            </>
          ) : (
            <img
              src={compressedUrl}
              alt="Compressed"
              className="block w-full max-h-[70vh] object-contain"
            />
          )}
        </div>
        {originalUrl && (
          <div className="px-5 py-4 border-t border-border">
            <input
              type="range"
              min={0}
              max={100}
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
              className="w-full accent-[var(--color-primary)]"
              aria-label="Comparison position"
            />
          </div>
        )}
      </div>
    </div>
  );
}

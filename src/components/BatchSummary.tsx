import { CheckCircle, X } from "lucide-react";
import { formatSize } from "../lib/settings";

export interface Summary {
  files: number;
  failed: number;
  originalBytes: number;
  savedBytes: number;
  seconds: number;
}

export function BatchSummary({ summary, onClose }: { summary: Summary; onClose: () => void }) {
  const percent =
    summary.originalBytes > 0 ? Math.round((summary.savedBytes / summary.originalBytes) * 100) : 0;
  return (
    <div
      role="status"
      className="flex items-start gap-3 bg-primary/10 border border-primary/30 rounded-2xl p-4 text-sm text-text"
    >
      <CheckCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
      <p className="flex-1">
        {summary.savedBytes > 0 ? (
          <>
            Saved <strong>{formatSize(summary.savedBytes)}</strong> ({percent}%) across{" "}
            {summary.files} {summary.files === 1 ? "file" : "files"}
          </>
        ) : (
          <>
            Processed {summary.files} {summary.files === 1 ? "file" : "files"}
          </>
        )}{" "}
        in {summary.seconds < 1 ? "under a second" : `${Math.round(summary.seconds)}s`}.
        {summary.failed > 0 && (
          <span className="text-danger">
            {" "}
            {summary.failed} {summary.failed === 1 ? "file" : "files"} failed.
          </span>
        )}
      </p>
      <button onClick={onClose} className="text-text-muted hover:text-text" aria-label="Dismiss summary">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

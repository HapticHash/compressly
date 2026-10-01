import { ShieldCheck } from "lucide-react";
import { formatSize } from "../lib/settings";

/**
 * The app never sends file contents anywhere; the only request it makes with
 * user activity is the anonymous file count and bytes-saved total.
 */
export function PrivacyBadge({ processedBytes }: { processedBytes: number }) {
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-text-muted"
      title="Compression runs in your browser. Only an anonymous count of files and bytes saved is sent for the stats below."
    >
      <ShieldCheck className="w-4 h-4 text-primary" aria-hidden="true" />
      {processedBytes > 0 && (
        <>
          <span>{formatSize(processedBytes)} processed on this device</span>
          <span aria-hidden="true">·</span>
        </>
      )}
      <span className="font-semibold text-primary-dark">0 bytes of your files uploaded</span>
    </div>
  );
}

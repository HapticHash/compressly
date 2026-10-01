import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { UploadCloud, X, Download, ArrowRight, Activity, HardDrive } from "lucide-react";
import { BatchSummary, type Summary } from "./components/BatchSummary";
import { CompareModal } from "./components/CompareModal";
import { FileRow, type FileItem } from "./components/FileRow";
import { FloatingBadges } from "./components/FloatingBadges";
import { PrivacyBadge } from "./components/PrivacyBadge";
import { SettingsPanel } from "./components/SettingsPanel";
import { ThemeToggle } from "./components/ThemeToggle";
import { useSettings } from "./hooks/useSettings";
import { isAbortError } from "./lib/abort";
import {
  ACCEPTED_TYPES,
  canPreviewOriginal,
  compressFile,
  createZip,
  downloadBlob,
  filesFromDataTransfer,
  getFileKind,
} from "./lib/compress";
import { getLandingPage } from "./lib/landing";
import {
  type FileOverrides,
  applyOverrides,
  dedupeNames,
  estimateSavings,
  formatSize,
  getOutputName,
  isSettingsValid,
} from "./lib/settings";
import { takeSharedFiles } from "./lib/share-target";

/** Files compressed in parallel. FFmpeg jobs are still serialized internally. */
const CONCURRENCY = 3;

type CompressionScope = "all" | "new" | "old";

function createId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function isInScope(f: FileItem, scope: CompressionScope): boolean {
  if (f.status === "compressing" || f.status === "unsupported") return false;
  if (scope === "new") return f.status === "idle";
  if (scope === "old") return f.status === "done";
  return true;
}

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await worker(items[next++]);
    }),
  );
}

function outputFile(item: FileItem): File {
  const blob = item.compressedBlob || item.file;
  return new File([blob], getOutputName(item.file.name, blob.type), { type: blob.type });
}

const landing = getLandingPage(location.pathname);

export default function App() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const { stored, settings, update } = useSettings(landing?.preset);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mirrors `files` so async handlers always see the latest list.
  const filesRef = useRef(files);
  filesRef.current = files;

  // Global Stats
  const [totalFilesCompressed, setTotalFilesCompressed] = useState(0);
  const [totalDataSaved, setTotalDataSaved] = useState(0); // in bytes
  const [isSystemActive, setIsSystemActive] = useState(true);
  const [processedBytes, setProcessedBytes] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [compare, setCompare] = useState<{
    id: string;
    originalUrl: string | null;
    compressedUrl: string;
  } | null>(null);

  const settingsValid = isSettingsValid(settings);
  const isCompressing = files.some((f) => f.status === "compressing");
  const [canShareFiles] = useState(() => {
    try {
      return (
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [new File([""], "test.txt", { type: "text/plain" })] })
      );
    } catch {
      return false;
    }
  });

  // One AbortController per file being compressed, for the cancel buttons.
  const controllers = useRef(new Map<string, AbortController>());

  // Progress events arrive many times per second; batch them into one
  // state update per animation frame.
  const pendingProgress = useRef(new Map<string, number>());
  const progressFrame = useRef<number | null>(null);

  const setProgress = useCallback((id: string, progress: number) => {
    pendingProgress.current.set(id, progress);
    if (progressFrame.current !== null) return;
    progressFrame.current = requestAnimationFrame(() => {
      progressFrame.current = null;
      const updates = new Map(pendingProgress.current);
      pendingProgress.current.clear();
      setFiles((prev) =>
        prev.map((f) =>
          updates.has(f.id) && f.status === "compressing"
            ? { ...f, progress: updates.get(f.id)! }
            : f,
        ),
      );
    });
  }, []);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/stats");
        if (res.ok) {
          const data = await res.json();
          setTotalFilesCompressed(data.totalFilesCompressed || 0);
          setTotalDataSaved(data.totalDataSaved || 0);
        }
      } catch (e) {
        console.error("Failed to fetch stats", e);
      }
    };

    const checkHealth = async () => {
      try {
        const res = await fetch("/api/health");
        setIsSystemActive(res.ok);
      } catch (e) {
        setIsSystemActive(false);
      }
    };

    // Re-check when the tab regains focus instead of polling in the background.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") checkHealth();
    };

    fetchStats();
    checkHealth();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (progressFrame.current !== null)
        cancelAnimationFrame(progressFrame.current);
    };
  }, []);

  // Release preview object URLs when the app unmounts.
  useEffect(
    () => () =>
      filesRef.current.forEach(
        (f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl),
      ),
    [],
  );

  // Closing the tab mid-compression would silently lose the work.
  useEffect(() => {
    if (!isCompressing) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isCompressing]);

  const addFiles = useCallback((newFiles: File[]) => {
    if (newFiles.length === 0) return;
    const newItems: FileItem[] = newFiles.map((f) => {
      const kind = getFileKind(f);
      return {
        id: createId(),
        file: f,
        kind,
        status: kind ? "idle" : "unsupported",
        progress: 0,
        originalSize: f.size,
        previewUrl:
          canPreviewOriginal(f) || f.type.startsWith("video/")
            ? URL.createObjectURL(f)
            : undefined,
      };
    });
    setFiles((prev) => [...prev, ...newItems]);
    setSummary(null);

    // Start downloading FFmpeg as soon as it's needed, not on page load.
    if (newItems.some((item) => item.kind === "media")) {
      import("./lib/media")
        .then((m) => m.loadFFmpeg())
        .catch((e) => console.error("Failed to load FFmpeg", e));
    }

    const setPreview = (id: string, url: string) => {
      // The file may have been removed while the preview rendered.
      if (!filesRef.current.some((f) => f.id === id)) {
        URL.revokeObjectURL(url);
        return;
      }
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, previewUrl: url } : f)));
    };

    const pdfs = newItems.filter((item) => item.kind === "pdf");
    if (pdfs.length > 0) {
      import("./lib/pdf").then(({ generatePdfThumbnail }) =>
        pdfs.forEach(async (item) => {
          try {
            setPreview(item.id, await generatePdfThumbnail(item.file));
          } catch (error) {
            console.error("Error generating PDF thumbnail:", error);
          }
        }),
      );
    }

    // Browsers other than Safari can't show HEIC, so convert a small preview.
    const heics = newItems.filter((item) => item.kind === "image" && !canPreviewOriginal(item.file));
    if (heics.length > 0) {
      import("./lib/image").then(({ heicToJpeg }) =>
        heics.forEach(async (item) => {
          try {
            const jpeg = await heicToJpeg(item.file, 0.6);
            setPreview(item.id, URL.createObjectURL(jpeg));
          } catch (error) {
            console.error("Error generating HEIC preview:", error);
          }
        }),
      );
    }
  }, []);

  // Files shared to the installed app from another app (Android share sheet).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has("shared")) return;
    history.replaceState(null, "", location.pathname);
    takeSharedFiles().then(addFiles).catch(console.error);
  }, [addFiles]);

  // Paste files or screenshots with Ctrl+V / Cmd+V.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (pasted.length === 0) return;
      e.preventDefault();
      addFiles(pasted);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Ignore leave events fired when moving over child elements.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      // Must start synchronously: the DataTransfer is cleared after the event.
      filesFromDataTransfer(e.dataTransfer).then(addFiles).catch(console.error);
    },
    [addFiles],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(Array.from(e.target.files));
      }
      // Allow selecting the same file again.
      e.target.value = "";
    },
    [addFiles],
  );

  const cancelFile = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
  }, []);

  const removeFile = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    setFiles((prev) => {
      const fileToRemove = prev.find((f) => f.id === id);
      if (fileToRemove?.previewUrl) {
        URL.revokeObjectURL(fileToRemove.previewUrl);
      }
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  const downloadFile = useCallback((id: string) => {
    const item = filesRef.current.find((f) => f.id === id);
    if (!item) return;
    const file = outputFile(item);
    downloadBlob(file, file.name);
  }, []);

  const shareFile = useCallback((id: string) => {
    const item = filesRef.current.find((f) => f.id === id);
    if (!item) return;
    navigator.share({ files: [outputFile(item)] }).catch((error) => {
      // AbortError just means the user closed the share sheet.
      if (error?.name !== "AbortError") console.error("Share failed", error);
    });
  }, []);

  const setOverrides = useCallback((id: string, overrides: FileOverrides) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, overrides } : f)));
  }, []);

  const openCompare = useCallback(async (id: string) => {
    const item = filesRef.current.find((f) => f.id === id);
    if (!item?.compressedBlob) return;
    let originalUrl: string | null = null;
    if (canPreviewOriginal(item.file)) {
      originalUrl = URL.createObjectURL(item.file);
    } else {
      try {
        const { heicToJpeg } = await import("./lib/image");
        originalUrl = URL.createObjectURL(await heicToJpeg(item.file, 0.95));
      } catch {
        originalUrl = null;
      }
    }
    setCompare({ id, originalUrl, compressedUrl: URL.createObjectURL(item.compressedBlob) });
  }, []);

  const closeCompare = useCallback(() => {
    setCompare((current) => {
      if (current) {
        if (current.originalUrl) URL.revokeObjectURL(current.originalUrl);
        URL.revokeObjectURL(current.compressedUrl);
      }
      return null;
    });
  }, []);

  const handleCompression = async (scope: CompressionScope = "all") => {
    if (!settingsValid) return;
    const selected = filesRef.current.filter((f) => isInScope(f, scope));
    if (selected.length === 0) return;

    const ids = new Set(selected.map((f) => f.id));
    setSummary(null);
    setFiles((prev) =>
      prev.map((f) =>
        ids.has(f.id)
          ? {
              ...f,
              status: "compressing",
              progress: 0,
              compressedSize: undefined,
              compressedBlob: undefined,
              keptOriginal: false,
              metadataRemoved: false,
            }
          : f,
      ),
    );

    const startedAt = performance.now();
    let filesCount = 0;
    let bytesSaved = 0;
    let processed = 0;
    let originalBytes = 0;
    let failed = 0;

    await runPool(selected, CONCURRENCY, async (fileItem: FileItem) => {
      const controller = new AbortController();
      controllers.current.set(fileItem.id, controller);
      try {
        const { blob, keptOriginal, metadataRemoved } = await compressFile(
          fileItem.file,
          fileItem.id,
          applyOverrides(settings, fileItem.overrides),
          fileItem.overrides,
          (progress) => setProgress(fileItem.id, progress),
          controller.signal,
        );
        if (controller.signal.aborted) throw new DOMException("", "AbortError");
        pendingProgress.current.delete(fileItem.id);
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileItem.id
              ? {
                  ...f,
                  status: "done",
                  progress: 100,
                  compressedSize: blob.size,
                  compressedBlob: blob,
                  keptOriginal,
                  metadataRemoved,
                }
              : f,
          ),
        );
        processed += 1;
        originalBytes += fileItem.originalSize;
        if (!keptOriginal) {
          filesCount += 1;
          bytesSaved += Math.max(0, fileItem.originalSize - blob.size);
        }
      } catch (error) {
        pendingProgress.current.delete(fileItem.id);
        const cancelled = isAbortError(error) || controller.signal.aborted;
        if (!cancelled) {
          console.error("Compression error:", error);
          failed += 1;
        }
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileItem.id
              ? { ...f, status: cancelled ? "idle" : "error", progress: 0 }
              : f,
          ),
        );
      } finally {
        controllers.current.delete(fileItem.id);
      }
    });

    setProcessedBytes((prev) => prev + originalBytes);
    if (processed + failed > 0) {
      setSummary({
        files: processed,
        failed,
        originalBytes,
        savedBytes: bytesSaved,
        seconds: (performance.now() - startedAt) / 1000,
      });
    }

    if (filesCount > 0) {
      setTotalFilesCompressed((prev) => prev + filesCount);
      setTotalDataSaved((prev) => prev + bytesSaved);
      // One request per batch instead of one per file.
      fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filesCount, bytesSaved }),
      }).catch(console.error);
    }
  };

  const handleDownloadAll = async () => {
    const doneFiles = files.filter((f) => f.status === "done");
    if (doneFiles.length === 0) return;

    const outputs = doneFiles.map(outputFile);
    const names = dedupeNames(outputs.map((f) => f.name));
    const zip = await createZip(names.map((name, i) => ({ name, blob: outputs[i] })));
    downloadBlob(zip, `compressly_${Date.now()}.zip`);
  };

  const clearQueue = () => {
    controllers.current.forEach((controller) => controller.abort());
    files.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
    setFiles([]);
    setSummary(null);
  };

  const compressible = files.filter((f) => f.status !== "unsupported");
  const isBusy =
    compressible.length === 0 ||
    compressible.every((f) => f.status === "compressing") ||
    !settingsValid;

  const kinds = useMemo(
    () => ({
      image: files.some((f) => f.kind === "image" || f.kind === "gif"),
      pdf: files.some((f) => f.kind === "pdf"),
      video: files.some((f) => f.kind === "media" && f.file.type.startsWith("video/")),
    }),
    [files],
  );

  const estimate = useMemo(
    () =>
      estimateSavings(
        files.filter((f) => isInScope(f, "all")).map((f) => f.originalSize),
        settings,
      ),
    [files, settings],
  );

  const compareItem = compare && files.find((f) => f.id === compare.id);

  const handleTitleClick = () => {
    if (landing) location.href = "/";
    else window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const actionButtons =
    files.some((f) => f.status === "idle") && files.some((f) => f.status === "done") ? (
      <div className="flex flex-col gap-3 w-full sm:w-auto items-center">
        <button
          onClick={() => handleCompression("new")}
          disabled={isBusy}
          className="w-full sm:w-auto h-12 px-8 rounded-full bg-primary text-on-accent hover:bg-primary-hover hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium whitespace-nowrap"
        >
          Compress New <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => handleCompression("old")}
          disabled={isBusy}
          className="w-full sm:w-auto h-12 px-8 rounded-full bg-accent text-on-accent hover:bg-accent-hover hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium whitespace-nowrap"
        >
          Re-compress Old <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    ) : (
      <button
        onClick={() => handleCompression("all")}
        disabled={isBusy}
        className="w-full sm:w-auto h-12 px-8 rounded-full bg-primary text-on-accent hover:bg-primary-hover hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium"
      >
        {compressible.length > 0 && compressible.every((f) => f.status === "done")
          ? "Re-compress All"
          : compressible.length === 1
            ? "Compress"
            : "Compress All"}{" "}
        <ArrowRight className="w-4 h-4" />
      </button>
    );

  return (
    <div className="min-h-screen flex flex-col items-center py-16 px-4 sm:px-6 lg:px-8 relative overflow-hidden selection:bg-primary/30">
      {/* Decorative Background Elements (gradients instead of costly blur filters) */}
      <div className="absolute top-[-20%] left-[-10%] w-[60vw] h-[60vw] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-primary)_12%,transparent)_0%,transparent_70%)] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-accent)_12%,transparent)_0%,transparent_70%)] pointer-events-none" />

      <ThemeToggle />

      {/* Subtle Decorative Icons */}
      <FloatingBadges />

      <div className="w-full max-w-4xl z-10 flex flex-col">
        {/* Header */}
        <header className="text-center mb-16 mt-8">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`${landing ? "text-4xl md:text-5xl" : "text-6xl md:text-7xl"} font-display font-bold text-primary-dark mb-6 tracking-tight`}
          >
            {landing ? (
              <>
                <button
                  onClick={handleTitleClick}
                  className="block mx-auto mb-3 text-lg font-semibold text-primary hover:opacity-80 transition-opacity"
                >
                  Compressly
                </button>
                {landing.heading}
              </>
            ) : (
              <button onClick={handleTitleClick} className="hover:opacity-80 transition-opacity">
                Compressly
              </button>
            )}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg md:text-xl text-text-muted max-w-2xl mx-auto font-light leading-relaxed"
          >
            {landing
              ? landing.intro
              : "Shrink your files, keep the magic. Premium compression for creators who care about quality."}
          </motion.p>
        </header>

        {/* Main Interface */}
        <main className="flex flex-col gap-8">
          {/* Upload Area */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className={`relative border-2 border-dashed rounded-[2rem] p-8 sm:p-12 flex flex-col items-center justify-center text-center transition-all duration-300 bg-surface/30 backdrop-blur-xl shadow-2xl
              ${isDragging ? "border-primary bg-primary/5 scale-[1.02]" : "border-border hover:border-primary/50 hover:bg-surface/50"}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              type="file"
              multiple
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileInput}
              accept={ACCEPTED_TYPES}
            />
            <div className="w-24 h-24 rounded-full bg-surface border border-border flex items-center justify-center mb-6 shadow-lg shadow-black/5">
              <UploadCloud className="w-10 h-10 text-primary" strokeWidth={1.5} />
            </div>
            <h3 className="text-3xl font-display font-semibold text-text mb-3">
              Drop your files here
            </h3>
            <p className="text-text-muted mb-2 text-lg">
              PDF, JPG, PNG, HEIC, WebP, GIF, SVG, MP4, MP3 and more
            </p>
            <p className="text-text-muted mb-8 text-sm">
              Drop whole folders, or paste with Ctrl+V
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-10 py-4 rounded-full bg-primary text-on-accent hover:bg-primary-hover hover:shadow-lg transition-all duration-300 font-medium tracking-wide text-sm"
            >
              Select Files
            </button>
          </motion.div>

          <PrivacyBadge processedBytes={processedBytes} />

          {/* Settings & File List */}
          <AnimatePresence>
            {files.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-col gap-6"
              >
                <SettingsPanel
                  stored={stored}
                  update={update}
                  targetValid={settingsValid}
                  estimate={estimate}
                  kinds={kinds}
                  actions={actionButtons}
                />

                {summary && <BatchSummary summary={summary} onClose={() => setSummary(null)} />}

                {/* File List */}
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2 px-2">
                    <h4 className="text-lg font-display font-medium text-text">
                      Queue ({files.length})
                    </h4>
                    <div className="flex items-center justify-between sm:justify-end gap-4 sm:gap-6 w-full sm:w-auto">
                      {files.some((f) => f.status === "done") && (
                        <button
                          onClick={handleDownloadAll}
                          className="text-sm font-medium text-accent hover:text-accent-dark flex items-center gap-1.5 transition-colors"
                        >
                          <Download className="w-4 h-4" /> Download All
                        </button>
                      )}
                      <button
                        onClick={clearQueue}
                        className="text-sm font-medium text-text-muted hover:text-danger flex items-center gap-1.5 transition-colors"
                      >
                        <X className="w-4 h-4" /> Clear Queue
                      </button>
                    </div>
                  </div>
                  <AnimatePresence>
                    {files.map((file) => (
                      <FileRow
                        key={file.id}
                        file={file}
                        canShare={canShareFiles}
                        onRemove={removeFile}
                        onCancel={cancelFile}
                        onDownload={downloadFile}
                        onShare={shareFile}
                        onCompare={openCompare}
                        onOverrides={setOverrides}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {compare && compareItem && (
        <CompareModal
          name={compareItem.file.name}
          originalUrl={compare.originalUrl}
          compressedUrl={compare.compressedUrl}
          originalSize={compareItem.originalSize}
          compressedSize={compareItem.compressedSize ?? compareItem.originalSize}
          onClose={closeCompare}
        />
      )}

      {/* How it Works Section */}
      <section className="w-full max-w-5xl mt-32 mb-12 z-10">
        <h2 className="text-4xl font-display font-bold text-center text-text mb-16">
          How it works
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
          {/* Connecting line for desktop */}
          <div className="hidden md:block absolute top-10 left-[16%] right-[16%] h-[2px] bg-primary/20 -z-10" />

          <div className="flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-accent text-on-accent flex items-center justify-center mb-6 text-2xl font-display font-bold shadow-lg shadow-black/5">
              1
            </div>
            <h3 className="text-2xl font-display font-semibold text-text mb-3">
              Upload
            </h3>
            <p className="text-text-muted font-light leading-relaxed">
              Drag and drop your heavy media files into our secure, private
              dropzone.
            </p>
          </div>
          <div className="flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-accent text-on-accent flex items-center justify-center mb-6 text-2xl font-display font-bold shadow-lg shadow-black/5">
              2
            </div>
            <h3 className="text-2xl font-display font-semibold text-text mb-3">
              Configure
            </h3>
            <p className="text-text-muted font-light leading-relaxed">
              Select your desired compression level or set an exact target size
              for precision.
            </p>
          </div>
          <div className="flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-accent text-on-accent flex items-center justify-center mb-6 text-2xl font-display font-bold shadow-lg shadow-black/5">
              3
            </div>
            <h3 className="text-2xl font-display font-semibold text-text mb-3">
              Compress
            </h3>
            <p className="text-text-muted font-light leading-relaxed">
              Download your newly optimized files, ready to be shared with the
              world.
            </p>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="w-full max-w-5xl mt-16 pt-12 border-t border-border grid grid-cols-1 md:grid-cols-2 gap-8 z-10"
      >
        <div className="flex items-center gap-6 bg-surface/40 backdrop-blur-xl p-8 rounded-[2rem] border border-border shadow-xl">
          <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center text-primary shadow-inner">
            <Activity className="w-7 h-7" />
          </div>
          <div>
            <p className="text-xs text-text-muted uppercase tracking-widest font-semibold mb-1">
              Files Compressed
            </p>
            <p className="text-4xl font-display font-bold text-primary-dark">
              {totalFilesCompressed.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6 bg-surface/40 backdrop-blur-xl p-8 rounded-[2rem] border border-border shadow-xl">
          <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center text-accent shadow-inner">
            <HardDrive className="w-7 h-7" />
          </div>
          <div>
            <p className="text-xs text-text-muted uppercase tracking-widest font-semibold mb-1">
              Data Saved
            </p>
            <p className="text-4xl font-display font-bold text-primary-dark">
              {formatSize(totalDataSaved).split(" ")[0]}{" "}
              <span className="text-2xl text-text-muted">
                {formatSize(totalDataSaved).split(" ")[1] || "B"}
              </span>
            </p>
          </div>
        </div>
      </motion.div>

      {/* Mini Footer */}
      <footer className="w-full max-w-5xl mt-16 pb-8 z-10 flex flex-col md:flex-row items-center justify-between gap-6 text-xs sm:text-sm text-text-muted border-t border-border pt-8">
        <div className="flex flex-col items-center md:items-start gap-1 text-center md:text-left">
          <p className="font-medium text-text">
            &copy; {new Date().getFullYear()} Compressly. All rights reserved.
          </p>
          <p>Fast, secure, and local file compression.</p>
        </div>

        <div className="flex flex-col items-center md:items-end gap-3">
          <div className="flex items-center gap-2 bg-surface/50 px-3 py-1.5 rounded-full border border-border shadow-sm">
            <span className="relative flex h-2 w-2">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isSystemActive ? "bg-primary" : "bg-danger"}`}
              ></span>
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${isSystemActive ? "bg-primary" : "bg-danger"}`}
              ></span>
            </span>
            <span
              className={`font-medium text-xs uppercase tracking-wider ${isSystemActive ? "text-primary-dark" : "text-danger"}`}
            >
              {isSystemActive ? "Systems Active" : "Systems Offline"}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  UploadCloud,
  Settings,
  X,
  Download,
  ArrowRight,
  Activity,
  HardDrive,
} from "lucide-react";
import { FileRow, type FileItem } from "./components/FileRow";
import { FloatingBadges } from "./components/FloatingBadges";
import {
  compressFile,
  createZip,
  downloadBlob,
  getFileKind,
} from "./lib/compress";
import {
  type CompressionLevel,
  type CompressionSettings,
  LEVELS,
  dedupeNames,
  estimateSavings,
  formatSize,
  getOutputName,
  isSettingsValid,
  parseTargetMB,
} from "./lib/settings";

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

export default function App() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [compressionLevel, setCompressionLevel] =
    useState<CompressionLevel>("Medium");
  const [targetSize, setTargetSize] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mirrors `files` so async handlers always see the latest list.
  const filesRef = useRef(files);
  filesRef.current = files;

  // Global Stats
  const [totalFilesCompressed, setTotalFilesCompressed] = useState(0);
  const [totalDataSaved, setTotalDataSaved] = useState(0); // in bytes
  const [isSystemActive, setIsSystemActive] = useState(true);

  const settings: CompressionSettings = useMemo(
    () => ({ level: compressionLevel, targetBytes: parseTargetMB(targetSize) }),
    [compressionLevel, targetSize],
  );
  const settingsValid = isSettingsValid(settings);

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

  const addFiles = useCallback((newFiles: File[]) => {
    const newItems: FileItem[] = newFiles.map((f) => {
      const kind = getFileKind(f);
      return {
        id: createId(),
        file: f,
        status: kind ? "idle" : "unsupported",
        progress: 0,
        originalSize: f.size,
        previewUrl:
          kind === "image" || kind === "svg" || f.type.startsWith("video/")
            ? URL.createObjectURL(f)
            : undefined,
      };
    });
    setFiles((prev) => [...prev, ...newItems]);

    // Start downloading FFmpeg as soon as it's needed, not on page load.
    if (newItems.some((item) => getFileKind(item.file) === "media")) {
      import("./lib/media")
        .then((m) => m.loadFFmpeg())
        .catch((e) => console.error("Failed to load FFmpeg", e));
    }

    const pdfs = newItems.filter((item) => getFileKind(item.file) === "pdf");
    if (pdfs.length > 0) {
      import("./lib/pdf").then(({ generatePdfThumbnail }) =>
        pdfs.forEach(async (item) => {
          try {
            const thumbUrl = await generatePdfThumbnail(item.file);
            // The file may have been removed while the thumbnail rendered.
            if (!filesRef.current.some((f) => f.id === item.id)) {
              URL.revokeObjectURL(thumbUrl);
              return;
            }
            setFiles((prev) =>
              prev.map((f) =>
                f.id === item.id ? { ...f, previewUrl: thumbUrl } : f,
              ),
            );
          } catch (error) {
            console.error("Error generating PDF thumbnail:", error);
          }
        }),
      );
    }
  }, []);

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
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFiles(Array.from(e.dataTransfer.files));
      }
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

  const removeFile = useCallback((id: string) => {
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
    const blob = item.compressedBlob || item.file;
    downloadBlob(blob, getOutputName(item.file.name, blob.type));
  }, []);

  const handleCompression = async (scope: CompressionScope = "all") => {
    if (!settingsValid) return;
    const selected = filesRef.current.filter((f) => isInScope(f, scope));
    if (selected.length === 0) return;

    const ids = new Set(selected.map((f) => f.id));
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
            }
          : f,
      ),
    );

    let filesCount = 0;
    let bytesSaved = 0;

    await runPool(selected, CONCURRENCY, async (fileItem: FileItem) => {
      try {
        const { blob, keptOriginal } = await compressFile(
          fileItem.file,
          fileItem.id,
          settings,
          (progress) => setProgress(fileItem.id, progress),
        );
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
                }
              : f,
          ),
        );
        if (!keptOriginal) {
          filesCount += 1;
          bytesSaved += fileItem.originalSize - blob.size;
        }
      } catch (error) {
        console.error("Compression error:", error);
        pendingProgress.current.delete(fileItem.id);
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileItem.id ? { ...f, status: "error" } : f,
          ),
        );
      }
    });

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

    const blobs = doneFiles.map((f) => f.compressedBlob || f.file);
    const names = dedupeNames(
      doneFiles.map((f, i) => getOutputName(f.file.name, blobs[i].type)),
    );
    const zip = await createZip(
      names.map((name, i) => ({ name, blob: blobs[i] })),
    );
    downloadBlob(zip, `compressly_${Date.now()}.zip`);
  };

  const clearQueue = () => {
    files.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
    setFiles([]);
  };

  const compressible = files.filter((f) => f.status !== "unsupported");
  const isBusy =
    compressible.length === 0 ||
    compressible.every((f) => f.status === "compressing") ||
    !settingsValid;

  const estimate = useMemo(
    () =>
      estimateSavings(
        files
          .filter((f) => isInScope(f, "all"))
          .map((f) => f.originalSize),
        settings,
      ),
    [files, settings],
  );

  return (
    <div className="min-h-screen flex flex-col items-center py-16 px-4 sm:px-6 lg:px-8 relative overflow-hidden selection:bg-primary/30">
      {/* Decorative Background Elements (gradients instead of costly blur filters) */}
      <div className="absolute top-[-20%] left-[-10%] w-[60vw] h-[60vw] rounded-full bg-[radial-gradient(circle,rgb(96_108_56/0.12)_0%,transparent_70%)] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] rounded-full bg-[radial-gradient(circle,rgb(188_108_37/0.12)_0%,transparent_70%)] pointer-events-none" />

      {/* Subtle Decorative Icons */}
      <FloatingBadges />

      <div className="w-full max-w-4xl z-10 flex flex-col">
        {/* Header */}
        <header className="text-center mb-16 mt-8">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => window.location.reload()}
            className="text-6xl md:text-7xl font-display font-bold text-primary-dark mb-6 tracking-tight cursor-pointer hover:opacity-80 transition-opacity"
          >
            Compressly
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg md:text-xl text-text-muted max-w-2xl mx-auto font-light leading-relaxed"
          >
            Shrink your files, keep the magic. Premium compression for creators
            who care about quality.
          </motion.p>
        </header>

        {/* Main Interface */}
        <main className="flex flex-col gap-8">
          {/* Upload Area */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className={`relative border-2 border-dashed rounded-[2rem] p-12 flex flex-col items-center justify-center text-center transition-all duration-300 bg-surface/30 backdrop-blur-xl shadow-2xl
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
              accept="image/jpeg,image/png,image/webp,image/bmp,image/svg+xml,video/*,audio/*,application/pdf"
            />
            <div className="w-24 h-24 rounded-full bg-surface border border-border flex items-center justify-center mb-6 shadow-lg shadow-black/5">
              <UploadCloud
                className="w-10 h-10 text-primary"
                strokeWidth={1.5}
              />
            </div>
            <h3 className="text-3xl font-display font-semibold text-text mb-3">
              Drop your files here
            </h3>
            <p className="text-text-muted mb-8 text-lg">
              Supports PDF, JPG, PNG, WebP, SVG, MP4, MP3 and more
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-10 py-4 rounded-full bg-primary text-surface hover:bg-[#4a532b] hover:shadow-lg transition-all duration-300 font-medium tracking-wide text-sm"
            >
              Select Files
            </button>
          </motion.div>

          {/* Settings & File List */}
          <AnimatePresence>
            {files.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-col gap-6"
              >
                {/* Settings Panel */}
                <div className="bg-surface/40 backdrop-blur-xl rounded-3xl p-8 border border-border shadow-xl">
                  <div className="flex items-center gap-3 mb-6">
                    <Settings className="w-5 h-5 text-primary" />
                    <h4 className="text-xl font-display font-medium text-text">
                      Compression Settings
                    </h4>
                  </div>

                  <div className="flex flex-col gap-6">
                    <div className="w-full flex flex-col gap-4">
                      <div>
                        <label className="block text-xs uppercase tracking-widest text-text-muted mb-3 font-semibold">
                          Level
                        </label>
                        <div
                          role="group"
                          aria-label="Compression level"
                          className="flex flex-wrap sm:flex-nowrap bg-bg rounded-2xl p-1 border border-border min-h-[3rem]"
                        >
                          {LEVELS.map((level) => (
                            <button
                              key={level}
                              onClick={() => setCompressionLevel(level)}
                              aria-pressed={compressionLevel === level}
                              className={`flex-1 min-w-[30%] sm:min-w-0 h-10 sm:h-auto flex items-center justify-center px-2 sm:px-3 text-xs sm:text-sm rounded-xl transition-all duration-200 ${
                                compressionLevel === level
                                  ? "bg-accent text-surface shadow-md font-medium"
                                  : "text-text-muted hover:text-accent hover:bg-accent/10"
                              }`}
                            >
                              {level}
                            </button>
                          ))}
                        </div>
                      </div>

                      <AnimatePresence>
                        {compressionLevel === "Custom" && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="w-full overflow-hidden"
                          >
                            <label
                              htmlFor="target-size"
                              className="block text-xs uppercase tracking-widest text-text-muted mb-3 font-semibold"
                            >
                              Target per file (MB)
                            </label>
                            <input
                              id="target-size"
                              type="number"
                              min="0"
                              step="any"
                              value={targetSize}
                              onChange={(e) => setTargetSize(e.target.value)}
                              placeholder="e.g. 5"
                              aria-invalid={!settingsValid}
                              aria-describedby="target-size-hint"
                              className="w-full h-12 bg-bg border border-border rounded-2xl px-4 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all text-text"
                            />
                            {!settingsValid && (
                              <p
                                id="target-size-hint"
                                className="mt-2 text-xs text-accent"
                              >
                                Enter a target size greater than 0.
                              </p>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {estimate && (
                      <motion.div
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full text-sm text-text-muted flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 bg-primary/5 p-3.5 rounded-xl border border-primary/10"
                      >
                        <div className="flex items-center gap-2">
                          <Activity className="w-4 h-4 text-primary shrink-0" />
                          <span>Estimated savings:</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="font-semibold text-primary-dark">
                            {formatSize(estimate.saved)}
                          </span>
                          <span>({estimate.percentage}%)</span>
                        </div>
                      </motion.div>
                    )}

                    <div className="w-full flex justify-center sm:justify-end">
                      {files.some((f) => f.status === "idle") &&
                      files.some((f) => f.status === "done") ? (
                        <div className="flex flex-col gap-3 w-full sm:w-auto items-center">
                          <button
                            onClick={() => handleCompression("new")}
                            disabled={isBusy}
                            className="w-full sm:w-auto h-12 px-8 rounded-full bg-primary text-surface hover:bg-[#4a532b] hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium whitespace-nowrap"
                          >
                            Compress New <ArrowRight className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleCompression("old")}
                            disabled={isBusy}
                            className="w-full sm:w-auto h-12 px-8 rounded-full bg-accent text-surface hover:bg-[#a65d1f] hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium whitespace-nowrap"
                          >
                            Re-compress Old <ArrowRight className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleCompression("all")}
                          disabled={isBusy}
                          className="w-full sm:w-auto h-12 px-8 rounded-full bg-primary text-surface hover:bg-[#4a532b] hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium"
                        >
                          {compressible.length > 0 &&
                          compressible.every((f) => f.status === "done")
                            ? "Re-compress All"
                            : compressible.length === 1
                              ? "Compress"
                              : "Compress All"}{" "}
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

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
                          className="text-sm font-medium text-accent hover:text-[#8b4513] flex items-center gap-1.5 transition-colors"
                        >
                          <Download className="w-4 h-4" /> Download All
                        </button>
                      )}
                      <button
                        onClick={clearQueue}
                        className="text-sm font-medium text-text-muted hover:text-red-500 flex items-center gap-1.5 transition-colors"
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
                        onRemove={removeFile}
                        onDownload={downloadFile}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* How it Works Section */}
      <section className="w-full max-w-5xl mt-32 mb-12 z-10">
        <h2 className="text-4xl font-display font-bold text-center text-text mb-16">
          How it works
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
          {/* Connecting line for desktop */}
          <div className="hidden md:block absolute top-10 left-[16%] right-[16%] h-[2px] bg-primary/20 -z-10" />

          <div className="flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-accent text-surface flex items-center justify-center mb-6 text-2xl font-display font-bold shadow-lg shadow-black/5">
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
            <div className="w-20 h-20 rounded-full bg-accent text-surface flex items-center justify-center mb-6 text-2xl font-display font-bold shadow-lg shadow-black/5">
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
            <div className="w-20 h-20 rounded-full bg-accent text-surface flex items-center justify-center mb-6 text-2xl font-display font-bold shadow-lg shadow-black/5">
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
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isSystemActive ? "bg-primary" : "bg-red-500"}`}
              ></span>
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${isSystemActive ? "bg-primary" : "bg-red-500"}`}
              ></span>
            </span>
            <span
              className={`font-medium text-xs uppercase tracking-wider ${isSystemActive ? "text-primary-dark" : "text-red-600"}`}
            >
              {isSystemActive ? "Systems Active" : "Systems Offline"}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

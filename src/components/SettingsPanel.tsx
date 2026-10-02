import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Activity, FileText, Image as ImageIcon, Settings, Video } from "lucide-react";
import { Select } from "./Select";
import type { StoredSettings } from "../hooks/useSettings";
import {
  LEVELS,
  MAX_DIMENSIONS,
  TARGET_PRESETS,
  VIDEO_RESOLUTIONS,
  formatSize,
} from "../lib/settings";

const LABEL_CLASS =
  "block text-xs uppercase tracking-widest text-text-muted mb-3 font-semibold";
const SELECT_CLASS =
  "h-11 bg-bg border border-border rounded-xl text-sm text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary";

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap sm:flex-nowrap bg-bg rounded-2xl p-1 border border-border min-h-[3rem]"
    >
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`flex-1 min-w-[30%] sm:min-w-0 h-10 sm:h-auto flex items-center justify-center px-2 sm:px-3 text-xs sm:text-sm rounded-xl transition-all duration-200 ${
            value === option.value
              ? "bg-accent text-on-accent shadow-md font-medium"
              : "text-text-muted hover:text-accent hover:bg-accent/10"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-border/60 pt-5">
      <legend className="flex items-center gap-2 text-sm font-semibold text-text mb-4 pr-2">
        {icon}
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

interface SettingsPanelProps {
  stored: StoredSettings;
  update: (patch: Partial<StoredSettings>) => void;
  targetValid: boolean;
  estimate: { saved: number; percentage: number } | null;
  estimateLabel: string;
  kinds: { image: boolean; pdf: boolean; video: boolean };
  actions: ReactNode;
}

export function SettingsPanel({
  stored,
  update,
  targetValid,
  estimate,
  estimateLabel,
  kinds,
  actions,
}: SettingsPanelProps) {
  return (
    <div className="bg-surface/40 backdrop-blur-xl rounded-3xl p-6 sm:p-8 border border-border shadow-xl">
      <div className="flex items-center gap-3 mb-6">
        <Settings className="w-5 h-5 text-primary" />
        <h4 className="text-xl font-display font-medium text-text">Compression Settings</h4>
      </div>

      <div className="flex flex-col gap-6">
        <div>
          <span className={LABEL_CLASS}>Level</span>
          <Segmented
            label="Compression level"
            options={LEVELS.map((level) => ({ value: level, label: level }))}
            value={stored.level}
            onChange={(level) => update({ level })}
          />
        </div>

        <AnimatePresence>
          {stored.level === "Custom" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full overflow-hidden"
            >
              <label htmlFor="target-size" className={LABEL_CLASS}>
                Target per file
              </label>
              <div className="flex gap-2">
                <input
                  id="target-size"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={stored.targetValue}
                  onChange={(e) => update({ targetValue: e.target.value })}
                  placeholder="e.g. 5"
                  aria-invalid={!targetValid}
                  aria-describedby="target-size-hint"
                  className="flex-1 min-w-0 h-12 bg-bg border border-border rounded-2xl px-4 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all text-text"
                />
                <Select
                  aria-label="Target size unit"
                  value={stored.targetUnit}
                  onChange={(e) => update({ targetUnit: e.target.value as "KB" | "MB" })}
                  wrapperClassName="shrink-0"
                  className="h-12 bg-bg border border-border rounded-2xl text-sm text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="KB">KB</option>
                  <option value="MB">MB</option>
                </Select>
              </div>
              <div className="flex flex-wrap gap-2 mt-3" role="group" aria-label="Common targets">
                {TARGET_PRESETS.map((preset) => {
                  const active =
                    stored.targetValue === preset.value && stored.targetUnit === preset.unit;
                  return (
                    <button
                      key={preset.label}
                      onClick={() => update({ targetValue: preset.value, targetUnit: preset.unit })}
                      aria-pressed={active}
                      className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                        active
                          ? "bg-primary text-on-accent border-primary"
                          : "border-border text-text-muted hover:border-primary hover:text-primary"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              {!targetValid && (
                <p id="target-size-hint" className="mt-2 text-xs text-accent">
                  Enter a target between 1 KB and 100 GB.
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {kinds.image && (
          <Section icon={<ImageIcon className="w-4 h-4 text-primary" />} title="Images">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="image-format" className={LABEL_CLASS}>
                  Output format
                </label>
                <Select
                  id="image-format"
                  className={SELECT_CLASS}
                  value={stored.image.format}
                  onChange={(e) =>
                    update({ image: { ...stored.image, format: e.target.value as any } })
                  }
                >
                  <option value="original">Same as original</option>
                  <option value="jpeg">JPG (works everywhere)</option>
                  <option value="webp">WebP (smaller)</option>
                  <option value="avif">AVIF (smallest, slower)</option>
                </Select>
              </div>
              <div>
                <label htmlFor="image-size" className={LABEL_CLASS}>
                  Max size
                </label>
                <Select
                  id="image-size"
                  className={SELECT_CLASS}
                  value={stored.image.maxDimension ?? ""}
                  onChange={(e) =>
                    update({
                      image: {
                        ...stored.image,
                        maxDimension: e.target.value ? Number(e.target.value) : null,
                      },
                    })
                  }
                >
                  <option value="">Original dimensions</option>
                  {MAX_DIMENSIONS.map((size) => (
                    <option key={size} value={size}>
                      Longest side {size}px
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <label className="flex items-start gap-3 mt-4 text-sm text-text cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 accent-[var(--color-primary)]"
                checked={stored.image.keepMetadata}
                onChange={(e) =>
                  update({ image: { ...stored.image, keepMetadata: e.target.checked } })
                }
              />
              <span>
                Keep photo metadata
                <span className="block text-xs text-text-muted">
                  Camera, date and GPS location. Off by default so your location isn't shared.
                  Kept for JPG, PNG and WebP output; AVIF can't store it.
                </span>
              </span>
            </label>
          </Section>
        )}

        {kinds.pdf && (
          <Section icon={<FileText className="w-4 h-4 text-primary" />} title="PDF">
            <Segmented
              label="PDF mode"
              options={[
                { value: "keep-text", label: "Keep text selectable" },
                { value: "smallest", label: "Smallest size" },
              ]}
              value={stored.pdfMode}
              onChange={(pdfMode) => update({ pdfMode })}
            />
            <p className="mt-2 text-xs text-text-muted">
              {stored.pdfMode === "keep-text"
                ? "Compresses the images inside the PDF; text, links and layout stay as they are."
                : "Turns every page into an image. Much smaller, but text can no longer be selected or searched."}
            </p>
          </Section>
        )}

        {kinds.video && (
          <Section icon={<Video className="w-4 h-4 text-primary" />} title="Video">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="video-format" className={LABEL_CLASS}>
                  Format
                </label>
                <Select
                  id="video-format"
                  className={SELECT_CLASS}
                  value={stored.video.format}
                  onChange={(e) =>
                    update({ video: { ...stored.video, format: e.target.value as any } })
                  }
                >
                  <option value="mp4">MP4 (works everywhere)</option>
                  <option value="webm">WebM (smaller, for the web)</option>
                  <option value="gif">GIF (animated image)</option>
                </Select>
              </div>
              <div>
                <label htmlFor="video-resolution" className={LABEL_CLASS}>
                  Resolution
                </label>
                <Select
                  id="video-resolution"
                  className={SELECT_CLASS}
                  value={stored.video.resolution ?? ""}
                  onChange={(e) =>
                    update({
                      video: {
                        ...stored.video,
                        resolution: e.target.value ? Number(e.target.value) : null,
                      },
                    })
                  }
                >
                  <option value="">Original</option>
                  {VIDEO_RESOLUTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}p
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {stored.video.format !== "gif" && (
              <label className="flex items-center gap-3 mt-4 text-sm text-text cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-[var(--color-primary)]"
                  checked={stored.video.removeAudio}
                  onChange={(e) =>
                    update({ video: { ...stored.video, removeAudio: e.target.checked } })
                  }
                />
                Remove audio
              </label>
            )}
            <p className="mt-2 text-xs text-text-muted">
              To trim a video, open its options in the queue below.
            </p>
          </Section>
        )}

        {estimate && (
          <div className="w-full text-sm text-text-muted flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 bg-primary/5 p-3.5 rounded-xl border border-primary/10">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary shrink-0" />
              <span>{estimateLabel}:</span>
            </div>
            {estimate.saved > 0 ? (
              <div className="flex items-center gap-1">
                <span className="font-semibold text-primary-dark">≈ {formatSize(estimate.saved)}</span>
                <span>({estimate.percentage}%)</span>
              </div>
            ) : (
              <span>none, the files are already within your target</span>
            )}
          </div>
        )}

        <div className="w-full flex justify-center sm:justify-end">{actions}</div>
      </div>
    </div>
  );
}

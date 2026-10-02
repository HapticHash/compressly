import { useEffect, useMemo, useRef, useState } from "react";
import { readStorage, writeStorage } from "../lib/storage";
import type { LandingPreset } from "../lib/landing";
import {
  type CompressionLevel,
  type CompressionSettings,
  DEFAULT_SETTINGS,
  type ImageOptions,
  type PdfMode,
  type TargetUnit,
  type VideoOptions,
  parseTarget,
} from "../lib/settings";

const STORAGE_KEY = "compressly:settings:v1";

export interface StoredSettings {
  level: CompressionLevel;
  targetValue: string;
  targetUnit: TargetUnit;
  image: ImageOptions;
  pdfMode: PdfMode;
  video: VideoOptions;
}

const DEFAULTS: StoredSettings = {
  level: DEFAULT_SETTINGS.level,
  targetValue: "",
  targetUnit: "MB",
  image: DEFAULT_SETTINGS.image,
  pdfMode: DEFAULT_SETTINGS.pdfMode,
  video: DEFAULT_SETTINGS.video,
};

function initialSettings(preset?: LandingPreset): StoredSettings {
  const stored = readStorage<Partial<StoredSettings>>(STORAGE_KEY) ?? {};
  // A landing page's preset wins over remembered settings.
  const base = { ...DEFAULTS, ...stored };
  return {
    ...base,
    ...preset,
    image: { ...DEFAULTS.image, ...stored.image, ...preset?.image },
    video: { ...DEFAULTS.video, ...stored.video, ...preset?.video },
  };
}

/** Compression settings, remembered between visits. */
export function useSettings(preset?: LandingPreset) {
  const [stored, setStored] = useState<StoredSettings>(() => initialSettings(preset));

  // Save only after the user changes something, so a landing page's preset
  // doesn't overwrite the settings remembered from earlier visits.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    writeStorage(STORAGE_KEY, stored);
  }, [stored]);

  const settings: CompressionSettings = useMemo(
    () => ({
      level: stored.level,
      targetBytes: parseTarget(stored.targetValue, stored.targetUnit),
      image: stored.image,
      pdfMode: stored.pdfMode,
      video: stored.video,
    }),
    [stored],
  );

  const update = (patch: Partial<StoredSettings>) =>
    setStored((current) => ({ ...current, ...patch }));

  return { stored, settings, update };
}

import { describe, expect, it } from "vitest";
import {
  dedupeNames,
  estimateSavings,
  formatSize,
  getOutputName,
  getTargetRatio,
  getVideoBitrateForTarget,
  getVideoCrf,
  isSettingsValid,
  parseTargetMB,
} from "./settings";

const MB = 1024 * 1024;

describe("parseTargetMB", () => {
  it("converts megabytes to bytes", () => {
    expect(parseTargetMB("2")).toBe(2 * MB);
    expect(parseTargetMB("0.5")).toBe(0.5 * MB);
  });

  it("rejects empty, zero, negative and non-numeric input", () => {
    for (const value of ["", "0", "-3", "abc"]) {
      expect(parseTargetMB(value)).toBeNull();
    }
  });
});

describe("settings", () => {
  it("requires a target for Custom", () => {
    expect(isSettingsValid({ level: "Custom", targetBytes: null })).toBe(false);
    expect(isSettingsValid({ level: "Custom", targetBytes: MB })).toBe(true);
    expect(isSettingsValid({ level: "High", targetBytes: null })).toBe(true);
  });

  it("computes the custom ratio per file, capped at 0.9", () => {
    const settings = { level: "Custom" as const, targetBytes: 2 * MB };
    expect(getTargetRatio(settings, 10 * MB)).toBeCloseTo(0.2);
    expect(getTargetRatio(settings, 1 * MB)).toBe(0.9);
  });

  it("maps levels to CRF and clamps custom CRF to 18..51", () => {
    expect(getVideoCrf("Low", 0)).toBe(23);
    expect(getVideoCrf("Custom", 0)).toBe(51);
    expect(getVideoCrf("Custom", 0.9)).toBe(21);
    expect(getVideoCrf("Custom", 1)).toBe(18);
  });

  it("derives a video bitrate that fits the target", () => {
    // 10 MB over 60 s ≈ 1286 kbps total, minus 96 kbps audio.
    expect(getVideoBitrateForTarget(10 * MB, 60, 96)).toBe(1190);
    expect(getVideoBitrateForTarget(1024, 600, 96)).toBe(50);
  });
});

describe("estimateSavings", () => {
  it("applies the custom target to each file separately", () => {
    const estimate = estimateSavings([10 * MB, 10 * MB], {
      level: "Custom",
      targetBytes: 2 * MB,
    });
    expect(estimate?.saved).toBeCloseTo(16 * MB);
    expect(estimate?.percentage).toBe(80);
  });

  it("returns null without files or a valid target", () => {
    expect(estimateSavings([], { level: "Low", targetBytes: null })).toBeNull();
    expect(
      estimateSavings([MB], { level: "Custom", targetBytes: null }),
    ).toBeNull();
  });
});

describe("formatSize", () => {
  it("formats bytes", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(5 * 1024 ** 5)).toBe("5120 TB");
  });
});

describe("getOutputName", () => {
  it("fixes the extension when the format changed", () => {
    expect(getOutputName("clip.mov", "video/mp4")).toBe("compressed_clip.mp4");
    expect(getOutputName("song.wav", "audio/mpeg")).toBe("compressed_song.mp3");
  });

  it("keeps the name when the format is unchanged", () => {
    expect(getOutputName("photo.JPEG", "image/jpeg")).toBe(
      "compressed_photo.JPEG",
    );
    expect(getOutputName("doc.pdf", "application/pdf")).toBe(
      "compressed_doc.pdf",
    );
    expect(getOutputName("notes", "")).toBe("compressed_notes");
  });
});

describe("dedupeNames", () => {
  it("suffixes duplicates", () => {
    expect(dedupeNames(["a.jpg", "a.jpg", "b.png", "a.jpg"])).toEqual([
      "a.jpg",
      "a (1).jpg",
      "b.png",
      "a (2).jpg",
    ]);
  });
});

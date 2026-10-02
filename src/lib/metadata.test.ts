import { describe, expect, it } from "vitest";
import { readExif, resetOrientation, stripMetadata, writeExif } from "./metadata";

/** Little-endian TIFF with IFD0 = { Orientation: 6 (rotated), Make: "Cam" }. */
function makeTiff(orientation = 6): Uint8Array {
  const bytes = new Uint8Array(8 + 2 + 2 * 12 + 4);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49, 0x2a, 0x00]);
  view.setUint32(4, 8, true);
  view.setUint16(8, 2, true);
  // Make (0x010f), ASCII, count 4, value inline "Cam\0"
  view.setUint16(10, 0x010f, true);
  view.setUint16(12, 2, true);
  view.setUint32(14, 4, true);
  bytes.set([0x43, 0x61, 0x6d, 0x00], 18);
  // Orientation (0x0112), SHORT, count 1
  view.setUint16(22, 0x0112, true);
  view.setUint16(24, 3, true);
  view.setUint32(26, 1, true);
  view.setUint16(30, orientation, true);
  return bytes;
}

const orientationOf = (tiff: Uint8Array) => new DataView(tiff.buffer, tiff.byteOffset).getUint16(30, true);

/** Minimal JPEG: SOI, APP0 (JFIF), SOS with a few bytes, EOI. */
function makeJpeg(): Blob {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sos = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9];
  return new Blob([new Uint8Array([0xff, 0xd8, ...app0, ...sos])], { type: "image/jpeg" });
}

/** Minimal PNG: signature, IHDR, IDAT, IEND (CRCs aren't checked by the reader). */
function makePng(): Blob {
  const chunk = (type: string, data: number[]) => {
    const len = data.length;
    return [0, 0, 0, len, ...Array.from(type, (c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  };
  const bytes = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    ...chunk("IDAT", [1, 2, 3]),
    ...chunk("IEND", []),
  ];
  return new Blob([new Uint8Array(bytes)], { type: "image/png" });
}

/** Minimal lossy WebP: RIFF + VP8 chunk with a 640x480 frame header. */
function makeWebp(): Blob {
  const vp8 = [0x9d, 0x01, 0x2a, 0x9d, 0x01, 0x2a, 0x80, 0x02, 0xe0, 0x01];
  const body = [..."WEBP"].map((c) => c.charCodeAt(0)).concat(
    [..."VP8 "].map((c) => c.charCodeAt(0)),
    [vp8.length, 0, 0, 0],
    vp8,
  );
  const riff = [..."RIFF"].map((c) => c.charCodeAt(0)).concat([body.length, 0, 0, 0], body);
  return new Blob([new Uint8Array(riff)], { type: "image/webp" });
}

describe("metadata", () => {
  it("resets the orientation tag to upright", () => {
    const tiff = makeTiff(6);
    expect(orientationOf(resetOrientation(tiff))).toBe(1);
    expect(orientationOf(tiff)).toBe(6); // original untouched
  });

  for (const [name, make] of [
    ["JPEG", makeJpeg],
    ["PNG", makePng],
    ["WebP", makeWebp],
  ] as const) {
    it(`round-trips EXIF through ${name}`, async () => {
      const image = make();
      expect(await readExif(image)).toBeNull();
      const tiff = makeTiff();
      const withExif = await writeExif(image, tiff);
      expect(withExif).not.toBeNull();
      expect(withExif!.type).toBe(image.type);
      expect(Array.from((await readExif(withExif!))!)).toEqual(Array.from(tiff));

      const stripped = await stripMetadata(withExif!);
      expect(stripped).not.toBeNull();
      expect(await readExif(stripped!)).toBeNull();
      // WebP keeps its (now flag-less) extended VP8X header.
      expect(stripped!.size).toBeLessThan(withExif!.size);
    });
  }

  it("keeps the JFIF segment first in JPEG", async () => {
    const out = new Uint8Array(await (await writeExif(makeJpeg(), makeTiff()))!.arrayBuffer());
    expect(Array.from(out.subarray(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it("marks WebP as extended with the EXIF flag", async () => {
    const out = new Uint8Array(await (await writeExif(makeWebp(), makeTiff()))!.arrayBuffer());
    expect(String.fromCharCode(...out.subarray(12, 16))).toBe("VP8X");
    expect(out[20] & 0x08).toBe(0x08);
    // Canvas size 640x480, stored minus one in 24 bits.
    expect(out[24] | (out[25] << 8)).toBe(639);
    expect(out[27] | (out[28] << 8)).toBe(479);
  });

  it("can't write EXIF into AVIF", async () => {
    expect(await writeExif(new Blob([new Uint8Array(16)], { type: "image/avif" }), makeTiff())).toBeNull();
  });

  it("returns null when there's nothing to strip", async () => {
    expect(await stripMetadata(makeJpeg())).toBeNull();
  });
});

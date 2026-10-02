// Copies EXIF metadata (camera, date, GPS) from the original image into the
// compressed one. Canvas re-encoding always drops it, so it is read from the
// source file as raw TIFF bytes and written back into the output container.
//
// Read: JPEG (APP1), PNG (eXIf), WebP (EXIF chunk), HEIC/HEIF (Exif item).
// Write: JPEG, PNG, WebP. AVIF can't carry it in a way browsers keep.

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

function startsWithExifHeader(bytes: Uint8Array, offset = 0) {
  return EXIF_HEADER.every((b, i) => bytes[offset + i] === b);
}

function isTiff(bytes: Uint8Array) {
  return (
    bytes.length >= 8 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a))
  );
}

/** Strips an optional "Exif\0\0" prefix and checks for a TIFF header. */
function toTiff(bytes: Uint8Array): Uint8Array | null {
  const tiff = startsWithExifHeader(bytes) ? bytes.subarray(6) : bytes;
  return isTiff(tiff) ? tiff : null;
}

function readJpegExif(bytes: Uint8Array): Uint8Array | null {
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xe1 && startsWithExifHeader(bytes, offset + 4)) {
      return toTiff(bytes.subarray(offset + 4, offset + 2 + length));
    }
    offset += 2 + length;
  }
  return null;
}

function readPngExif(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    if (type === "eXIf") return toTiff(bytes.subarray(offset + 8, offset + 8 + length));
    if (type === "IDAT" || type === "IEND") break;
    offset += 12 + length;
  }
  return null;
}

interface RiffChunk {
  type: string;
  data: Uint8Array;
}

function readRiffChunks(bytes: Uint8Array): RiffChunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: RiffChunk[] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    chunks.push({ type, data: bytes.subarray(offset + 8, offset + 8 + size) });
    offset += 8 + size + (size % 2);
  }
  return chunks;
}

function readWebpExif(bytes: Uint8Array): Uint8Array | null {
  const chunk = readRiffChunks(bytes).find((c) => c.type === "EXIF");
  return chunk ? toTiff(chunk.data) : null;
}

/** Finds the "Exif" item in a HEIF container (meta → iinf + iloc). */
function readHeifExif(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readUint = (offset: number, size: number) =>
    size === 0 ? 0 : size === 2 ? view.getUint16(offset) : size === 4 ? view.getUint32(offset) : Number(view.getBigUint64(offset));

  const boxes = (start: number, end: number) => {
    const found: { type: string; start: number; end: number }[] = [];
    let offset = start;
    while (offset + 8 <= end) {
      let size = view.getUint32(offset);
      const type = ascii(bytes, offset + 4, 4);
      let header = 8;
      if (size === 1) {
        size = Number(view.getBigUint64(offset + 8));
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header) break;
      found.push({ type, start: offset + header, end: offset + size });
      offset += size;
    }
    return found;
  };

  const meta = boxes(0, bytes.length).find((b) => b.type === "meta");
  if (!meta) return null;
  const children = boxes(meta.start + 4, meta.end); // meta is a full box
  const iinf = children.find((b) => b.type === "iinf");
  const iloc = children.find((b) => b.type === "iloc");
  if (!iinf || !iloc) return null;

  // Item info: which item ID is the Exif block?
  const iinfVersion = bytes[iinf.start];
  const entriesStart = iinf.start + 4 + (iinfVersion === 0 ? 2 : 4);
  let exifId: number | null = null;
  for (const infe of boxes(entriesStart, iinf.end)) {
    if (infe.type !== "infe") continue;
    const version = bytes[infe.start];
    if (version < 2) continue;
    const idSize = version === 2 ? 2 : 4;
    const id = readUint(infe.start + 4, idSize);
    if (ascii(bytes, infe.start + 4 + idSize + 2, 4) === "Exif") {
      exifId = id;
      break;
    }
  }
  if (exifId === null) return null;

  // Item location: where are its bytes in the file?
  const version = bytes[iloc.start];
  let offset = iloc.start + 4;
  const offsetSize = bytes[offset] >> 4;
  const lengthSize = bytes[offset] & 0xf;
  const baseOffsetSize = bytes[offset + 1] >> 4;
  const indexSize = version === 1 || version === 2 ? bytes[offset + 1] & 0xf : 0;
  offset += 2;
  const itemCount = readUint(offset, version < 2 ? 2 : 4);
  offset += version < 2 ? 2 : 4;
  for (let i = 0; i < itemCount; i++) {
    const id = readUint(offset, version < 2 ? 2 : 4);
    offset += version < 2 ? 2 : 4;
    let constructionMethod = 0;
    if (version === 1 || version === 2) {
      constructionMethod = view.getUint16(offset) & 0xf;
      offset += 2;
    }
    offset += 2; // data_reference_index
    const baseOffset = readUint(offset, baseOffsetSize);
    offset += baseOffsetSize;
    const extentCount = view.getUint16(offset);
    offset += 2;
    const extents: { start: number; length: number }[] = [];
    for (let e = 0; e < extentCount; e++) {
      offset += indexSize;
      const extentOffset = readUint(offset, offsetSize);
      offset += offsetSize;
      const extentLength = readUint(offset, lengthSize);
      offset += lengthSize;
      extents.push({ start: baseOffset + extentOffset, length: extentLength });
    }
    if (id !== exifId) continue;
    if (constructionMethod !== 0 || extents.length !== 1) return null;
    const { start, length } = extents[0];
    const item = bytes.subarray(start, start + length);
    // The item starts with a 4-byte offset to the TIFF header.
    const tiffOffset = 4 + new DataView(item.buffer, item.byteOffset).getUint32(0);
    return toTiff(item.subarray(tiffOffset));
  }
  return null;
}

/** Raw EXIF (TIFF) bytes from an image file, or null if it has none. */
export async function readExif(file: Blob): Promise<Uint8Array | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpegExif(bytes);
    if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return readPngExif(bytes);
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return readWebpExif(bytes);
    if (ascii(bytes, 4, 4) === "ftyp") return readHeifExif(bytes);
  } catch {
    // Malformed container: treat as no metadata.
  }
  return null;
}

/**
 * Sets the Orientation tag to 1 (upright). The browser already rotated the
 * pixels when decoding, so keeping the old value would rotate them twice.
 */
export function resetOrientation(tiff: Uint8Array): Uint8Array {
  const copy = tiff.slice();
  const view = new DataView(copy.buffer);
  const little = copy[0] === 0x49;
  const ifd = view.getUint32(4, little);
  if (ifd + 2 > copy.length) return copy;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > copy.length) break;
    if (view.getUint16(entry, little) === 0x0112 && view.getUint16(entry + 2, little) === 3) {
      view.setUint16(entry + 8, 1, little);
    }
  }
  return copy;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function writeJpegExif(jpeg: Uint8Array, tiff: Uint8Array): Uint8Array | null {
  const segmentLength = 2 + EXIF_HEADER.length + tiff.length;
  if (segmentLength > 0xffff) return null;
  const app1 = concat([
    new Uint8Array([0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff]),
    new Uint8Array(EXIF_HEADER),
    tiff,
  ]);
  // Keep the JFIF (APP0) segment first if present; drop any existing Exif APP1.
  const parts: Uint8Array[] = [jpeg.subarray(0, 2)];
  let offset = 2;
  let inserted = false;
  while (offset + 4 <= jpeg.length && jpeg[offset] === 0xff) {
    const marker = jpeg[offset + 1];
    if (marker === 0xda) break;
    const length = (jpeg[offset + 2] << 8) | jpeg[offset + 3];
    const segment = jpeg.subarray(offset, offset + 2 + length);
    if (!inserted && marker !== 0xe0) {
      parts.push(app1);
      inserted = true;
    }
    if (!(marker === 0xe1 && startsWithExifHeader(jpeg, offset + 4))) parts.push(segment);
    offset += 2 + length;
  }
  if (!inserted) parts.push(app1);
  parts.push(jpeg.subarray(offset));
  return concat(parts);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writePngExif(png: Uint8Array, tiff: Uint8Array): Uint8Array | null {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ihdrEnd = 8 + 12 + view.getUint32(8);
  const typeAndData = concat([new TextEncoder().encode("eXIf"), tiff]);
  const chunk = new Uint8Array(12 + tiff.length);
  const chunkView = new DataView(chunk.buffer);
  chunkView.setUint32(0, tiff.length);
  chunk.set(typeAndData, 4);
  chunkView.setUint32(8 + tiff.length, crc32(typeAndData));
  return concat([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)]);
}

function riffChunk(type: string, data: Uint8Array): Uint8Array {
  const header = new Uint8Array(8);
  header.set(new TextEncoder().encode(type), 0);
  new DataView(header.buffer).setUint32(4, data.length, true);
  return concat([header, data, new Uint8Array(data.length % 2)]);
}

function writeWebpExif(webp: Uint8Array, tiff: Uint8Array): Uint8Array | null {
  const chunks = readRiffChunks(webp).filter((c) => c.type !== "EXIF");
  let vp8x = chunks.find((c) => c.type === "VP8X")?.data.slice();
  if (!vp8x) {
    // Simple format (VP8 or VP8L only): an extended VP8X header is needed
    // before metadata chunks are allowed.
    const image = chunks[0];
    let width: number;
    let height: number;
    let alpha = false;
    if (image?.type === "VP8 ") {
      const d = new DataView(image.data.buffer, image.data.byteOffset);
      width = d.getUint16(6, true) & 0x3fff;
      height = d.getUint16(8, true) & 0x3fff;
    } else if (image?.type === "VP8L") {
      const bits = new DataView(image.data.buffer, image.data.byteOffset).getUint32(1, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
      alpha = ((bits >> 28) & 1) === 1;
    } else {
      return null;
    }
    vp8x = new Uint8Array(10);
    if (alpha) vp8x[0] |= 0x10;
    const w = width - 1;
    const h = height - 1;
    vp8x.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 4);
  }
  vp8x[0] |= 0x08; // EXIF flag
  const body = concat([
    riffChunk("VP8X", vp8x),
    ...chunks.filter((c) => c.type !== "VP8X").map((c) => riffChunk(c.type, c.data)),
    riffChunk("EXIF", tiff),
  ]);
  const header = new Uint8Array(12);
  header.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  header.set(new TextEncoder().encode("WEBP"), 8);
  return concat([header, body]);
}

/** Returns the image with the EXIF block inserted, or null if its format can't hold it. */
export async function writeExif(image: Blob, tiff: Uint8Array): Promise<Blob | null> {
  const bytes = new Uint8Array(await image.arrayBuffer());
  let out: Uint8Array | null = null;
  try {
    if (image.type === "image/jpeg") out = writeJpegExif(bytes, tiff);
    else if (image.type === "image/png") out = writePngExif(bytes, tiff);
    else if (image.type === "image/webp") out = writeWebpExif(bytes, tiff);
  } catch {
    out = null;
  }
  return out ? new Blob([out], { type: image.type }) : null;
}

const XMP_HEADER = "http://ns.adobe.com/xap/1.0/\0";

/**
 * Removes EXIF and XMP (which can also hold GPS) without re-encoding the
 * image. Returns null when there was nothing to remove or the format isn't
 * handled.
 */
export async function stripMetadata(image: Blob): Promise<Blob | null> {
  const bytes = new Uint8Array(await image.arrayBuffer());
  let out: Uint8Array | null = null;
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      const parts: Uint8Array[] = [bytes.subarray(0, 2)];
      let offset = 2;
      let removed = false;
      while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
        const marker = bytes[offset + 1];
        if (marker === 0xda) break;
        const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
        const isMetadata =
          marker === 0xe1 &&
          (startsWithExifHeader(bytes, offset + 4) ||
            ascii(bytes, offset + 4, XMP_HEADER.length) === XMP_HEADER);
        if (isMetadata) removed = true;
        else parts.push(bytes.subarray(offset, offset + 2 + length));
        offset += 2 + length;
      }
      parts.push(bytes.subarray(offset));
      out = removed ? concat(parts) : null;
    } else if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") {
      const view = new DataView(bytes.buffer);
      const parts: Uint8Array[] = [bytes.subarray(0, 8)];
      let offset = 8;
      let removed = false;
      while (offset + 12 <= bytes.length) {
        const length = view.getUint32(offset);
        const type = ascii(bytes, offset + 4, 4);
        const chunk = bytes.subarray(offset, offset + 12 + length);
        const isXmp = type === "iTXt" && ascii(bytes, offset + 8, 17) === "XML:com.adobe.xmp";
        if (type === "eXIf" || isXmp) removed = true;
        else parts.push(chunk);
        offset += 12 + length;
      }
      out = removed ? concat(parts) : null;
    } else if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
      const chunks = readRiffChunks(bytes);
      if (chunks.some((c) => c.type === "EXIF" || c.type === "XMP ")) {
        const kept = chunks.filter((c) => c.type !== "EXIF" && c.type !== "XMP ");
        const body = concat(
          kept.map((c) => {
            if (c.type !== "VP8X") return riffChunk(c.type, c.data);
            const flags = c.data.slice();
            flags[0] &= ~(0x08 | 0x04); // clear EXIF and XMP flags
            return riffChunk("VP8X", flags);
          }),
        );
        const header = new Uint8Array(12);
        header.set(new TextEncoder().encode("RIFF"), 0);
        new DataView(header.buffer).setUint32(4, body.length + 4, true);
        header.set(new TextEncoder().encode("WEBP"), 8);
        out = concat([header, body]);
      }
    }
  } catch {
    out = null;
  }
  return out ? new Blob([out], { type: image.type }) : null;
}

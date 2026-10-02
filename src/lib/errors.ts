import type { FileKind } from "./compress";

/** An error whose message is written for the user and shown as-is. */
export class CompressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompressionError";
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toUpperCase() : "";
}

/** Turns any compression failure into a short explanation for the file's row. */
export function describeError(error: unknown, kind: FileKind | null, file: File): string {
  if (error instanceof CompressionError) return error.message;
  const message = error instanceof Error ? error.message : "";
  if (file.size === 0) return "This file is empty.";
  switch (kind) {
    case "image":
    case "gif":
    case "svg": {
      const ext = extensionOf(file.name);
      return `Couldn't read this image. It may be damaged${ext ? `, or not really a ${ext} file` : ""}.`;
    }
    case "pdf":
      return /encrypt|password/i.test(message)
        ? "Password-protected PDFs can't be compressed. Remove the password and try again."
        : "Couldn't read this PDF. It may be damaged.";
    case "media":
      return "Couldn't process this file. It may be damaged or use a format the video engine doesn't support.";
    default:
      return "This file type isn't supported.";
  }
}

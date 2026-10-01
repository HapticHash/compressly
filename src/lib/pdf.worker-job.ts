// Runs PDF compression off the main thread so large documents don't freeze the page.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
// @ts-ignore
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { compressPdfBytes, type PdfSettings } from "./pdf-core";

// Give pdf.js its own nested worker. Without an explicit port it falls back
// to a "fake worker" in this scope, which posts its own messages here.
pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(new URL(pdfWorker, self.location.href), {
  type: "module",
});

self.onmessage = async (event: MessageEvent<{ data: ArrayBuffer; settings: PdfSettings }>) => {
  try {
    const result = await compressPdfBytes(event.data.data, event.data.settings, (progress) =>
      self.postMessage({ type: "progress", progress }),
    );
    self.postMessage({ type: "result", result }, { transfer: [result.buffer] });
  } catch (error) {
    self.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
  }
};

export function abortError(): DOMException {
  return new DOMException("Compression cancelled", "AbortError");
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Runs a module worker for one job. Workers post {type: "progress" | "result" | "error"}.
 * Aborting terminates the worker immediately.
 */
export function runWorkerJob<T>(
  worker: Worker,
  message: unknown,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      finish();
      reject(abortError());
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort);
    // Only messages tagged by our workers count; libraries running inside a
    // worker (e.g. pdf.js) may post their own.
    worker.onmessage = ({ data }) => {
      if (data?.type === "progress") return onProgress(data.progress);
      if (data?.type === "result") {
        finish();
        resolve(data.result as T);
      } else if (data?.type === "error") {
        finish();
        reject(new Error(data.error));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "Worker failed"));
    };
    worker.postMessage(message);
  });
}

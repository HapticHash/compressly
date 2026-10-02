/** Cache the service worker stores shared files in (see src/sw.ts). */
export const SHARE_CACHE = "compressly-share-target";

/** Reads and clears the files another app shared to Compressly. */
export async function takeSharedFiles(): Promise<File[]> {
  if (typeof caches === "undefined") return [];
  const cache = await caches.open(SHARE_CACHE);
  const requests = await cache.keys();
  const files = await Promise.all(
    requests.map(async (request) => {
      const response = await cache.match(request);
      if (!response) return null;
      const blob = await response.blob();
      const name = decodeURIComponent(response.headers.get("x-file-name") ?? "shared-file");
      return new File([blob], name, { type: blob.type });
    }),
  );
  await caches.delete(SHARE_CACHE);
  return files.filter((file): file is File => file !== null);
}

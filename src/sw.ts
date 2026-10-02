/// <reference lib="webworker" />
// Service worker: makes Compressly installable and usable offline, caches the
// FFmpeg core after its first download, and receives files shared from other
// apps (Web Share Target).
import {
  cleanupOutdatedCaches,
  matchPrecache,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { SHARE_CACHE } from "./lib/share-target";

declare const self: ServiceWorkerGlobalScope;

// The app shell (HTML, main JS/CSS, font, icons) is precached at install.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// Files shared from another app arrive as a multipart POST. They are stored
// in a cache, and the page picks them up after the redirect.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.pathname !== "/share-target") return;
  event.respondWith(
    (async () => {
      const form = await event.request.formData();
      const files = form.getAll("files").filter((f): f is File => f instanceof File);
      await caches.delete(SHARE_CACHE);
      const cache = await caches.open(SHARE_CACHE);
      await Promise.all(
        files.map((file, i) =>
          cache.put(
            `/shared/${i}`,
            new Response(file, {
              headers: {
                "content-type": file.type || "application/octet-stream",
                "x-file-name": encodeURIComponent(file.name),
              },
            }),
          ),
        ),
      );
      return Response.redirect("/?shared=1", 303);
    })(),
  );
});

// Pages: network first so updates show up, precached copy when offline.
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: "pages",
      networkTimeoutSeconds: 4,
      plugins: [
        {
          handlerDidError: async ({ request }) =>
            (await matchPrecache(new URL(request.url).pathname.replace(/\/?$/, "/index.html"))) ??
            (await matchPrecache("/index.html")),
        },
      ],
    }),
  ),
);

// Lazily loaded chunks (PDF, AVIF, HEIC...) have hashed names, so they never
// change: cache them the first time they're used.
registerRoute(
  ({ url, request }) =>
    url.origin === self.location.origin &&
    request.method === "GET" &&
    (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/pdfjs/")),
  new CacheFirst({
    cacheName: "assets",
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 300, purgeOnQuotaError: true }),
    ],
  }),
);

// The ~31 MB FFmpeg core is pinned to an exact version, so it's safe to keep.
registerRoute(
  ({ url }) => url.origin === "https://unpkg.com" && url.pathname.startsWith("/@ffmpeg/"),
  new CacheFirst({
    cacheName: "ffmpeg-core",
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 8, purgeOnQuotaError: true }),
    ],
  }),
);

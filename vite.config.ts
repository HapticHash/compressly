/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';
import {LANDING_PAGES, getLandingPage, type LandingPage} from './src/lib/landing';

const SITE_URL = (process.env.VITE_SITE_URL || 'https://compressly.harshitks2203.workers.dev').replace(/\/$/, '');

const HOME = {
  title: 'Compressly – Free, Private File Compression for Creators',
  description:
    'Compress PDFs, images, videos and audio right in your browser. Hit an exact target size, convert HEIC, WebP and AVIF, and never upload a file.',
  heading: 'Compressly',
  intro: 'Shrink your files, keep the magic. Premium compression for creators who care about quality.',
};

const apiMock = () => {
  let totalFilesCompressed = 0;
  let totalDataSaved = 0;

  return (req: any, res: any, next: any) => {
    if (req.url === '/api/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url === '/api/stats') {
      if (req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ totalFilesCompressed, totalDataSaved }));
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: any) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            totalFilesCompressed += Number(data.filesCount) || 0;
            totalDataSaved += Number(data.bytesSaved) || 0;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }
    }
    next();
  };
};

/** Stands in for the Cloudflare Worker API in `vite dev` and `vite preview`. */
const apiMockPlugin = (): Plugin => ({
  name: 'api-mock',
  configureServer(server) {
    server.middlewares.use(apiMock());
  },
  configurePreviewServer(server) {
    server.middlewares.use(apiMock());
  },
});

// pdf.js needs these at runtime for non-embedded fonts, CJK text and
// JPEG 2000 / JBIG2 images. They are served from /pdfjs/.
const PDFJS_DIRS = ['standard_fonts', 'cmaps', 'wasm', 'iccs'];
const pdfjsRoot = path.resolve(__dirname, 'node_modules/pdfjs-dist');

const pdfjsAssetsPlugin = (): Plugin => ({
  name: 'pdfjs-assets',
  configureServer(server) {
    server.middlewares.use('/pdfjs', (req, res, next) => {
      const file = path.join(pdfjsRoot, decodeURIComponent((req.url || '').split('?')[0]));
      if (!file.startsWith(pdfjsRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
      fs.createReadStream(file).pipe(res);
    });
  },
  writeBundle(options) {
    for (const dir of PDFJS_DIRS) {
      fs.cpSync(path.join(pdfjsRoot, dir), path.join(options.dir!, 'pdfjs', dir), { recursive: true });
    }
  },
});

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fillPage(html: string, page?: LandingPage) {
  const meta = page ?? HOME;
  const url = page ? `${SITE_URL}/${page.slug}/` : `${SITE_URL}/`;
  const content =
    `<main style="max-width:40rem;margin:4rem auto;padding:0 1rem;font-family:system-ui,sans-serif">` +
    `<h1>${escapeHtml(meta.heading)}</h1><p>${escapeHtml(meta.intro)}</p>` +
    `<p>Compressly compresses PDFs, images, videos and audio in your browser. Files never leave your device.</p>` +
    `<ul>${LANDING_PAGES.map((p) => `<li><a href="/${p.slug}/">${escapeHtml(p.heading)}</a></li>`).join('')}</ul>` +
    `</main>`;
  return html
    .replaceAll('__PAGE_TITLE__', escapeHtml(meta.title))
    .replaceAll('__PAGE_DESCRIPTION__', escapeHtml(meta.description))
    .replaceAll('__PAGE_URL__', url)
    .replaceAll('__SITE_URL__', SITE_URL)
    .replace('__PAGE_CONTENT__', content);
}

/**
 * Emits a static copy of index.html for each landing page (own title,
 * description and canonical URL), plus sitemap.xml and robots.txt.
 * Optionally injects Cloudflare Web Analytics when CF_ANALYTICS_TOKEN is set.
 */
const landingPagesPlugin = (): Plugin => ({
  name: 'landing-pages',
  enforce: 'post',
  transformIndexHtml: {
    order: 'pre',
    handler(html, ctx) {
      if (ctx.server) {
        return fillPage(html, getLandingPage(new URL(ctx.originalUrl ?? '/', 'http://localhost').pathname));
      }
      const token = process.env.CF_ANALYTICS_TOKEN;
      if (!token) return html;
      // Cookieless, privacy-friendly page view counts.
      return html.replace(
        '</head>',
        `  <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({ token })}'></script>\n  </head>`,
      );
    },
  },
  generateBundle(_, bundle) {
    const index = bundle['index.html'];
    if (!index || index.type !== 'asset') return;
    const template = String(index.source);
    for (const page of LANDING_PAGES) {
      this.emitFile({ type: 'asset', fileName: `${page.slug}/index.html`, source: fillPage(template, page) });
    }
    index.source = fillPage(template);

    const urls = ['', ...LANDING_PAGES.map((p) => `${p.slug}/`)];
    this.emitFile({
      type: 'asset',
      fileName: 'sitemap.xml',
      source:
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        urls.map((u) => `  <url><loc>${SITE_URL}/${u}</loc></url>`).join('\n') +
        `\n</urlset>\n`,
    });
    this.emitFile({
      type: 'asset',
      fileName: 'robots.txt',
      source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
    });
  },
});

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      apiMockPlugin(),
      pdfjsAssetsPlugin(),
      landingPagesPlugin(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'autoUpdate',
        injectRegister: 'script-defer',
        manifest: {
          name: 'Compressly – Private File Compression',
          short_name: 'Compressly',
          description: 'Compress PDFs, images, videos and audio on your device. Nothing is uploaded.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#fefae0',
          theme_color: '#606c38',
          categories: ['utilities', 'productivity', 'photo'],
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
          // Lets Android users pick Compressly from the share sheet.
          share_target: {
            action: '/share-target',
            method: 'POST',
            enctype: 'multipart/form-data',
            params: {
              files: [
                {
                  name: 'files',
                  accept: ['image/*', 'video/*', 'audio/*', 'application/pdf', '.heic', '.heif', '.pdf'],
                },
              ],
            },
          },
        } as any,
        injectManifest: {
          // Only the app shell is precached; compressors are cached on first use.
          globPatterns: [
            '**/index.html',
            'assets/index-*.{js,css}',
            'assets/nunito-sans-latin-wght-normal-*.woff2',
            'favicon.svg',
            'icons/*.png',
          ],
          globIgnores: ['pdfjs/**'],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      // FFmpeg and jSquash spawn their own workers/wasm; pre-bundling breaks their URLs in dev.
      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@jsquash/avif'],
    },
    worker: {
      // Module workers, so worker code can use dynamic imports.
      format: 'es' as const,
    },
    build: {
      // PDF, HEIC and SVG libraries are large but only load when those files are added.
      chunkSizeWarningLimit: 3200,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
    },
    preview: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
    },
    test: {
      include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
    },
  };
});

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

const apiMockPlugin = () => {
  let totalFilesCompressed = 0;
  let totalDataSaved = 0;

  return {
    name: 'api-mock',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
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
      });
    }
  };
};

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), apiMockPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      // FFmpeg spawns its own worker; pre-bundling breaks the worker URL in dev.
      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
    },
    build: {
      // PDF and SVG libraries are large but only load when those files are added.
      chunkSizeWarningLimit: 1000,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
  };
});

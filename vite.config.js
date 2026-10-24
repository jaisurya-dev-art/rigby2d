import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

// Python scripting runs on Pyodide, shipped with the editor: these files are served at /pyodide/
// during development and copied into the build, so scripts work offline.
const PYODIDE_FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
const PYODIDE_DIR = path.resolve('node_modules/pyodide');
const MIME = { '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.zip': 'application/zip', '.json': 'application/json' };

function pyodideAssets() {
  return {
    name: 'rigby-pyodide-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/pyodide\/([^?]+)/.exec(req.url ?? '');
        if (!m || !PYODIDE_FILES.includes(m[1])) return next();
        res.setHeader('Content-Type', MIME[path.extname(m[1])] ?? 'application/octet-stream');
        fs.createReadStream(path.join(PYODIDE_DIR, m[1])).pipe(res);
      });
    },
    generateBundle() {
      for (const file of PYODIDE_FILES) this.emitFile({ type: 'asset', fileName: `pyodide/${file}`, source: fs.readFileSync(path.join(PYODIDE_DIR, file)) });
    },
  };
}

// Vite serves and bundles the editor UI; Tauri hosts it in a native window.
export default defineConfig({
  clearScreen: false,
  plugins: [pyodideAssets()],
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2021',
    outDir: 'dist',
    emptyOutDir: true,
    // The editor, the splash screen window and the detached panel windows (panel.html).
    rollupOptions: { input: { main: 'index.html', splash: 'splash.html', panel: 'panel.html' } },
  },
});

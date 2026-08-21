import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// vitest/config, not vite: the `test` block below is a Vitest extension that
// plain vite's defineConfig rejects under excess-property checking.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
  },
  resolve: {
    alias: {
      // libsodium.js 0.7.16 ships a broken ESM entry (it imports
      // "./libsodium.mjs", which lives in the sibling `libsodium` package);
      // the CJS entry resolves `require("libsodium")` correctly.
      'libsodium-wrappers': fileURLToPath(
        new URL('./node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js', import.meta.url),
      ),
    },
  },
  worker: {
    // Classic (iife) workers keep the search worker a single self-contained
    // file, which is the only worker shape all QDN hosts allow (Qortal's CSP
    // blocks blob: workers, and module workers are newer than some WebViews).
    format: 'iife',
  },
  define: {
    __APP_VERSION__: JSON.stringify(`v${packageJson.version}`),
  },
  plugins: [
    react(),
    {
      // Emits the QAVS manifest (see qortium-home docs/APP_VERSIONING.md) at
      // the root of the published resource.
      name: 'qortium-app-manifest',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'qortium-app.json',
          source: `${JSON.stringify({ name: 'Keygen', version: packageJson.version }, null, 2)}\n`,
        });
      },
    },
  ],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});

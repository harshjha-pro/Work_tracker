/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Bundles the SQLite WebAssembly as base64 so the app never fetches it (works offline and as one file). */
function sqliteWasmInline(): Plugin {
  const id = 'virtual:sqljs-wasm';
  return {
    name: 'sqljs-wasm-inline',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(source) {
      if (source !== `\0${id}`) return null;
      const bytes = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'));
      return `export default ${JSON.stringify(bytes.toString('base64'))};`;
    },
  };
}

// `--mode single` inlines all JS/CSS into one HTML file (dist-single/) so the
// prototype can be shared as a single page with no server.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'single' ? [react(), sqliteWasmInline(), viteSingleFile()] : [react(), sqliteWasmInline()],
  base: './',
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
  test: { include: ['tests/**/*.test.ts', 'src/**/*.test.ts'], setupFiles: ['tests/setup.ts'], testTimeout: 30000 },
}));

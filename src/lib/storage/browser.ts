// Registers the in-browser SQLite engine. The WebAssembly is bundled as base64
// (see vite.config.ts) so the single-file build works offline and fetches nothing.
import initSqlJs from 'sql.js';
import wasmBase64 from 'virtual:sqljs-wasm';
import { setSqlJsLoader } from './sqlite';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

setSqlJsLoader(() => initSqlJs({ wasmBinary: base64ToBytes(wasmBase64).buffer as ArrayBuffer }));

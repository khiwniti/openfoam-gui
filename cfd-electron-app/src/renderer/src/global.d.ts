/**
 * Ambient type declarations that aren't bundled as a module.
 *
 * - `wasm`: the global set by chili-wasm.js's Emscripten factory when initWasm() runs
 * - `cfd`: the API exposed by preload/index.ts via contextBridge
 */
import type { MainModule } from "./lib/wasm-bridge";
import type {} from "./cfd-api";

declare global {
  // eslint-disable-next-line no-var
  var wasm: MainModule;
}

interface Window {
  cfd: import("./cfd-api").CfdApi;
}

export {};

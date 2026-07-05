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
  interface Window {
    cfd: import("./cfd-api").CfdApi;
  }
}

// V1.30 — the `/wasm/chili-wasm.js` dynamic import in
//  src/renderer/src/lib/wasm-bridge.ts is annotated with
//  `@ts-expect-error`. Wildcard `declare module` blocks don't
//  resolve absolute /wasm/* URLs under bundler resolution.

export {};

# OpenFOAM GUI Monorepo

End-to-end CFD simulation desktop environment built on Electron + React + OpenFOAM.
The active project at V1.35c is `cfd-electron-app`; the two other top-level
subtrees are upstream source + historical predecessor, neither shipped or built.

## Layout

| Path | Status | Role |
| --- | --- | --- |
| **`cfd-electron-app/`** | **Active (V1.7 → V1.35c)** | Electron + Vite + React + Zod desktop app. Case-management UI, IPC bridge, OpenFOAM execution pipeline. Vitest test suite runs from here. |
| `vendor/chili3d/` | Upstream source (vendored) | Source for the prebuilt wasm CAD engine consumed by `cfd-electron-app`. Not built locally by default. See `vendor/README.md`. |
| `legacy/splash-legacy/` | Predecessor project | Python + FreeCAD macro chain that preceded `cfd-electron-app`. Reference only — not built, not imported. See `legacy/README.md`. |

## Build & run the active project

```bash
cd cfd-electron-app
npm install
npm run dev          # launches the Electron + Vite dev environment
npm test             # runs the vitest suite (166/166 across 8 files at V1.35c)
```

## Status

`origin/main` currently sits at V1.35c (commit `a0e841c`). The coverage
thread runs V1.31a → V1.35c; the next unit of work under discussion is
V1.36 — IPC handler-body coverage in `cfd-electron-app/src/main/ipc/index.ts`.

## Contributing

1. Install Node.js (for `cfd-electron-app`) and (optionally) the emscripten
   toolchain (for `vendor/chili3d/` if you need to rebuild the wasm).
2. `cfd-electron-app/` is the only project tracked by the V1.x test cadence
   — keep cross-subproject imports clean. Currently the only edge is the
   prebuilt `chili-wasm.wasm` committed under
   `cfd-electron-app/src/renderer/public/wasm/`; nothing in
   `cfd-electron-app/src/` imports anything from `vendor/` or `legacy/`.
3. FreeCAD + Python is needed only if you're maintaining `legacy/splash-legacy/`
   for archival purposes.

## License

Released under the [MIT License](LICENSE). © 2026 khiwniti.

* `vendor/chili3d/` retains its upstream AGPL-3.0 license (see
  `vendor/chili3d/LICENSE`).
* `legacy/splash-legacy/` retains its upstream MIT license.

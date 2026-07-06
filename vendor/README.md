# `vendor/`

Vendored upstream source code. Subdirectories here provide a source of truth
for binary artifacts that the active project consumes and ships as prebuilt
binaries. **No code in `vendor/` is built, tested, or imported by the active
project**; changes here only matter when the corresponding prebuilt
artifact in `cfd-electron-app/` needs to be regenerated.

* `chili3d/` — upstream source for the wasm CAD engine
  ([github.com/xiangechen/chili3d](https://github.com/xiangechen/chili3d)).
  `cfd-electron-app` consumes a **prebuilt** `chili-wasm.wasm` committed
  under `cfd-electron-app/src/renderer/public/wasm/`. To rebuild from source,
  follow `vendor/chili3d/README.md` (setup the emscripten toolchain, run
  `npm run setup:wasm && npm run build:wasm`), then copy the fresh artifact
  over the committed binary.

> **Note on history.** Files here were relocated from the repo root in
> V1-refactor (a no-content-change move; git rename detection recovered
> 771/771 entries — see commit for the rename summary). Pre-refactor
> authorship is reachable via `git log --follow <file>`.

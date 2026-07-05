# OpenFOAM GUI Monorepo

End-to-end CFD simulation desktop environment built on Electron + React + OpenFOAM.

## Subprojects

* **`cfd-electron-app/`** — Electron + Vite + React + Zod desktop app. Case management UI, IPC bridge, and the OpenFOAM execution pipeline. Currently at V1.7 (persistent solver runtime controls + initial condition controls + per-solver turbulence picker).
* **`chili3d/`** — Standalone 3D viewer and WASM geometry engine. Renders imported geometry and meshes inside the app.
* **`Splash-OpenFOAM/`** — FreeCAD macro module. Authoring geometries, base meshing dictionaries (`blockMeshDict`, `snappyHexMeshDict`, etc.), and sample assets.

## Status

Local development only. See each subproject's `README.md` for build / run instructions.

## Contributing

1. Install Node.js (for `cfd-electron-app` and `chili3d`), CMake (for `chili3d/cpp`), and (optionally) FreeCAD (for `Splash-OpenFOAM`).
2. Each subproject has its own `package.json` and `README.md` with sub-project-specific commands.
3. Keep cross-subproject imports clean — `cfd-electron-app` reaches into `chili3d` strictly via the WASM/`@chili3d/*` packages.

## License

Released under the [MIT License](LICENSE). © 2026 khiwniti.

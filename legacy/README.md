# `legacy/`

Historical predecessor projects. **No code in `legacy/` is built, tested,
imported, or otherwise referenced by the active project.** Kept on disk so
the V1.x migration's design rationale and prior art remain at hand.

* `splash-legacy/` — SplashFOAM, a Python + FreeCAD macro chain that was the
  predecessor to `cfd-electron-app`. Originally published at
  [github.com/mohamedalysayed/Splash-OpenFOAM](https://github.com/mohamedalysayed/Splash-OpenFOAM).
  Useful context: case-setup macro patterns, FreeCAD-based geometry import,
  and the execution-pipeline shape that informed the V1.x case orchestration
  in `cfd-electron-app/src/main/openfoam/`.

> **Note on history.** Files here were relocated from the repo root in
> V1-refactor (the original dir name was `Splash-OpenFOAM`; git rename
> detection recovered 771/771 entries — see commit for the rename summary).
> Pre-refactor authorship is reachable via `git log --follow <file>`,
> including the original cross-reference to `Splash-OpenFOAM/`.

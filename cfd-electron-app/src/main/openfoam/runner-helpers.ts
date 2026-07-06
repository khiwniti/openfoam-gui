/**
 * V1.37a — pure / fs-based helpers extracted from src/main/openfoam/runner.ts.
 *
 * Mirrors the V1.36* IPC-handler-body lift pattern: the runner.ts
 * barrel co-locates impure code (process spawning, active-runs map,
 * stream parsing) with small pure utilities (pipeline construction,
 * path joining, fs mkdir, duration formatting). V1.37a lifts the
 * pure utilities to this dedicated node-only module so they have a
 * single testable surface (vitest exercises the helpers directly
 * without the runner's child-process-spawn / IPC-socket dependencies).
 *
 * IPC contract: every helper here is either pure (no I/O) or
 * fs-based (no process spawning, no network, no electron). The
 * runner.ts re-exports the names so existing callers (the IPC
 * barrel in src/main/ipc/index.ts, the case.ts render path) keep
 * importing from '@main/openfoam/runner' without churn.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A single stage in an OpenFOAM run pipeline. The `name` is the
 *  human-readable label (used by the runner's phase broadcaster
 *  and by the renderer's Run panel timeline); `command` is the argv
 *  to invoke via `bash -lc "<command...>"`; `envOverrides` is
 *  applied to the spawned process's environment on top of the
 *  current `process.env` (rarely used — left in for solver-specific
 *  tweaks like `FOAM_IGNORE_AUTO_ADJUST`). */
export interface RunStage {
  name: 'meshing' | 'snapping' | 'decomposing' | 'solving' | 'reconstructing' | 'converting' | 'cleanup';
  /** e.g. `["blockMesh"]` or `["mpirun", "-np", "4", "simpleFoam", "-parallel"]` */
  command: string[];
  /** If set, merged on top of the current `process.env` for the
   *  spawned child. */
  envOverrides?: Record<string, string>;
}

/**
 * Build the OpenFOAM pipeline appropriate for a case.
 *
 *   • `geometryKind === 'imported'` (snappyHexMeshDict present, patches exported):
 *       `blockMesh` → `snappyHexMesh -overwrite` → [`decomposePar` → `solver -parallel` → `reconstructPar`] → `foamToVTK`
 *
 *   • otherwise (parametric / coord-space domain):
 *       `blockMesh` → [`decomposePar` → `solver -parallel` → `reconstructPar`] → `foamToVTK`
 *
 * `cores > 1` inserts the decompose / mpirun / reconstruct triple;
 * `cores <= 1` runs the solver serially. The trailing `foamToVTK
 * -ascii` stage is always present (the renderer's "Open in
 * Finder" path requires ASCII VTK for the STL/STEP preview chain).
 *
 * Pure transformation — no I/O, no environment reads, no process
 * spawn. The runner.ts call site composes the returned stages
 * with `startRun` for the actual child-process orchestration. */
export function buildRunPipeline(opts: {
  cores: number;
  solver: string;
  geometryKind?: 'parametric' | 'imported';
}): RunStage[] {
  const { cores, solver, geometryKind = 'parametric' } = opts;
  const stages: RunStage[] = [];

  // Background mesh is required in BOTH flows so snappy has hexes to chop into.
  stages.push({ name: 'meshing', command: ['blockMesh'] });

  if (geometryKind === 'imported') {
    // '-overwrite' lets us re-run snappy in place without manual `rm -rf constant/polyMesh`.
    stages.push({ name: 'snapping', command: ['snappyHexMesh', '-overwrite'] });
  }

  if (cores > 1) {
    stages.push({ name: 'decomposing', command: ['decomposePar'] });
    stages.push({ name: 'solving', command: ['mpirun', '-np', String(cores), solver, '-parallel'] });
    stages.push({ name: 'reconstructing', command: ['reconstructPar'] });
  } else {
    stages.push({ name: 'solving', command: [solver] });
  }

  stages.push({ name: 'converting', command: ['foamToVTK', '-ascii'] });
  return stages;
}

/** Default scratchpad location for run artifacts. Joins the user's
 *  home dir with the canonical `CFDStudio/runs` subpath so the
 *  IPC handler's `getRunRoot()` fallback has a stable location
 *  before the user has saved any settings.json.
 *
 *  The `home` parameter is exposed for testability — production
 *  callers omit it and let the default `os.homedir()` win. The
 *  test file passes an explicit `home` so the assertion is
 *  deterministic across local + CI runs (where `os.homedir()`
 *  resolves to different paths). */
export function defaultRunRoot(home: string = os.homedir()): string {
  return path.join(home, 'CFDStudio', 'runs');
}

/** Ensure a directory exists, creating it recursively. The
 *  `recursive: true` flag makes the call idempotent (a no-op if
 *  the directory already exists) so the IPC handler's
 *  `pickCaseDir` chain (which calls `ensureDir` for both the run
 *  root AND the per-case subdir on every Create-Case click) never
 *  has to disambiguate "first save" vs "subsequent save". */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Format a duration in milliseconds as `HH:MM:SS`. The `HH` field
 *  is unbounded (a 100-hour run renders as `100:00:00`, not as a
 *  days-spillover). Sub-second durations round DOWN to `00:00:00`
 *  (the function uses `Math.floor`, never `Math.round`, so a
 *  999ms run is reported as `00:00:00` rather than `00:00:01` —
 *  the "run almost instantly" intuition is preferred over the
 *  "it took 1 second" inaccuracy). The runner's `executeRun`
 *  final-phase `done` event surfaces this string verbatim to
 *  the renderer. */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}

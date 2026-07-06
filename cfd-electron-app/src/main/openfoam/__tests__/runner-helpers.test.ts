/**
 * V1.37a — runner-helpers module coverage (pure / fs-based helpers
 * extracted from src/main/openfoam/runner.ts).
 *
 * The runner.ts barrel co-locates impure code (process spawning,
 * active-runs map, stream parsing) with small pure utilities
 * (pipeline construction, path joining, fs mkdir, duration
 * formatting). V1.37a lifted the utilities to
 * @main/openfoam/runner-helpers; this file pins their contract
 * so a future edit to the pipeline shape, the default scratch
 * path, the recursive-mkdir semantic, or the duration formatter
 * fails loudly in CI rather than producing a confusing "snappy
 * stages missing" / "run root not found" / "run duration NaN"
 * runtime error.
 *
 * Drift-pin targets:
 *   - buildRunPipeline: the 4 core paths (parametric × cores=1,
 *     parametric × cores>1, imported × cores=1, imported ×
 *     cores>1) plus the default-geometryKind fallthrough (no
 *     explicit geometryKind → parametric), the mpirun argv shape
 *     (`['mpirun', '-np', '<n>', solver, '-parallel']`), and the
 *     trailing `foamToVTK -ascii` stage.
 *   - defaultRunRoot: explicit `home` parameter + default
 *     `os.homedir()` fallthrough.
 *   - ensureDir: mkdir-recursive (deep paths) + idempotent
 *     (existing dir doesn't throw).
 *   - formatDuration: 0 → '00:00:00', sub-second floors down
 *     to '00:00:00' (NOT rounded), single-field cases (seconds,
 *     minutes, hours), multi-digit hours.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildRunPipeline,
  defaultRunRoot,
  ensureDir,
  formatDuration,
} from '@main/openfoam/runner-helpers';

describe('buildRunPipeline — pipeline construction', () => {
  it('parametric, cores=1 → [meshing, solving, converting] (serial solver)', () => {
    const stages = buildRunPipeline({ cores: 1, solver: 'icoFoam' });
    expect(stages.map((s) => s.name)).toEqual(['meshing', 'solving', 'converting']);
  });

  it('parametric, cores=4 → [meshing, decomposing, solving, reconstructing, converting]', () => {
    // The 4-stage parallel-solver path: decomposePar + mpirun
    // -parallel + reconstructPar. This is the most common
    // production shape (user typically has cores > 1).
    const stages = buildRunPipeline({ cores: 4, solver: 'pimpleFoam' });
    expect(stages.map((s) => s.name)).toEqual([
      'meshing',
      'decomposing',
      'solving',
      'reconstructing',
      'converting',
    ]);
  });

  it('imported, cores=1 → [meshing, snapping, solving, converting]', () => {
    // Snappy-driven path: blockMesh + snappyHexMesh -overwrite +
    // serial solver. No decomposePar since cores=1.
    const stages = buildRunPipeline({
      cores: 1,
      solver: 'simpleFoam',
      geometryKind: 'imported',
    });
    expect(stages.map((s) => s.name)).toEqual(['meshing', 'snapping', 'solving', 'converting']);
  });

  it('imported, cores=4 → [meshing, snapping, decomposing, solving, reconstructing, converting]', () => {
    // Snappy-driven + parallel: the 6-stage full path. Tests the
    // intersection of both optional additions.
    const stages = buildRunPipeline({
      cores: 4,
      solver: 'simpleFoam',
      geometryKind: 'imported',
    });
    expect(stages.map((s) => s.name)).toEqual([
      'meshing',
      'snapping',
      'decomposing',
      'solving',
      'reconstructing',
      'converting',
    ]);
  });

  it('default geometryKind fallthrough is "parametric" (no snappy stage)', () => {
    // When geometryKind is omitted, the helper should treat it
    // as parametric (no snappyHexMesh stage inserted). The IPC
    // handler call site currently always passes geometryKind
    // explicitly, but the default is part of the helper's API
    // contract and a future renderer-side code path that forgets
    // to pass it should still get the parametric pipeline.
    const stages = buildRunPipeline({ cores: 2, solver: 'icoFoam' });
    expect(stages.map((s) => s.name)).not.toContain('snapping');
    expect(stages.map((s) => s.name)).toContain('decomposing');
  });

  it('parallel-solver argv shape is exactly [mpirun, -np, <n>, solver, -parallel]', () => {
    // Pin the mpirun argv composition: a future refactor that
    // changes the flag order (e.g. -parallel before -np) would
    // silently break every OpenFOAM solver invocation. The
    // solver name + -parallel must sandwich the -np + cores.
    const stages = buildRunPipeline({ cores: 8, solver: 'pimpleFoam' });
    const solving = stages.find((s) => s.name === 'solving');
    expect(solving?.command).toEqual(['mpirun', '-np', '8', 'pimpleFoam', '-parallel']);
  });

  it('trailing foamToVTK stage uses -ascii flag (renderer preview depends on ASCII VTK)', () => {
    // The renderer-side STL/STEP preview chain reads ASCII VTK.
    // A future refactor that drops the -ascii flag would silently
    // break the preview (binary VTK is unreadable by the simple
    // ASCII parser in src/main/three-mesh-bvh-adapter). Pin the
    // explicit -ascii arg.
    const stages = buildRunPipeline({ cores: 1, solver: 'icoFoam' });
    const converting = stages.find((s) => s.name === 'converting');
    expect(converting?.command).toEqual(['foamToVTK', '-ascii']);
  });
});

describe('defaultRunRoot — scratch path construction', () => {
  it('joins explicit home + CFDStudio/runs subpath', () => {
    expect(defaultRunRoot('/home/foo')).toBe(path.join('/home/foo', 'CFDStudio', 'runs'));
  });

  it('falls back to os.homedir() when no home argument supplied', () => {
    // Pin the default fallthrough: the IPC handler's getRunRoot()
    // chains defaultRunRoot() AFTER the settings cache, so the
    // default path is only used on first-call before settings.json
    // exists. A future refactor that changes the subpath
    // (e.g. 'CFD-Studio/runs' with a hyphen) would silently move
    // every fresh-user first-run into a different directory.
    const result = defaultRunRoot();
    expect(result).toMatch(/CFDStudio[\\/]runs$/);
    expect(result.startsWith(path.sep) || /^[A-Z]:/.test(result)).toBe(true);
  });
});

describe('ensureDir — mkdir-recursive + idempotent', () => {
  let tmp: string;
  beforeEach(async () => {
    const { mkdtemp } = await import('node:fs/promises');
    tmp = await mkdtemp(path.join(tmpdir(), 'v137a-ensure-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('creates a deep target path that does not yet exist', async () => {
    // The IPC handler's pickCaseDir chain calls ensureDir for both
    // the run root and the per-case subdir. A fresh user first-
    // save in a deep target path must not ENOENT-fail.
    const deep = path.join(tmp, 'a', 'b', 'c', 'd');
    await ensureDir(deep);
    const stat = await fs.stat(deep);
    expect(stat.isDirectory()).toBe(true);
  });

  it('is idempotent — calling on an existing directory does not throw', async () => {
    // Re-ensureDir'ing the run root on every Create-Case click
    // is intentional (cheap fs.mkdir(recursive:true) no-op), so
    // an existing-dir-must-not-throw semantic is load-bearing.
    const dir = path.join(tmp, 'already-here');
    await fs.mkdir(dir, { recursive: true });
    // Second call must not throw.
    await expect(ensureDir(dir)).resolves.toBeUndefined();
  });
});

describe('formatDuration — duration formatter', () => {
  it('renders 0ms as 00:00:00', () => {
    expect(formatDuration(0)).toBe('00:00:00');
  });

  it('sub-second durations round DOWN to 00:00:00 (Math.floor, not Math.round)', () => {
    // 999ms is "almost a second" but should NOT show as
    // '00:00:01' — the runner uses Math.floor explicitly so the
    // "run almost instantly" intuition beats the "it took 1
    // second" inaccuracy. A future refactor to Math.round would
    // break the test pin.
    expect(formatDuration(999)).toBe('00:00:00');
    expect(formatDuration(1)).toBe('00:00:00');
  });

  it('renders single-second durations with zero-padded HH and MM', () => {
    expect(formatDuration(59_000)).toBe('00:00:59');
  });

  it('rolls over into the minutes field at 60 seconds', () => {
    expect(formatDuration(60_000)).toBe('00:01:00');
  });

  it('renders single-minute durations', () => {
    expect(formatDuration(125_000)).toBe('00:02:05');
  });

  it('rolls over into the hours field at 3600 seconds', () => {
    expect(formatDuration(3_600_000)).toBe('01:00:00');
  });

  it('renders multi-digit hours (no days-spillover, no clamp at 99)', () => {
    // A 100-hour run renders as '100:00:00', not as a days-
    // spillover or a 99-hour clamp. The renderer's Run panel
    // time column has plenty of horizontal space.
    expect(formatDuration(100 * 3_600_000)).toBe('100:00:00');
  });
});

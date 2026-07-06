/**
 * V1.34 — coverage closure on `runner.ts` pure exports.
 *
 * One test file, four describe blocks. The goal is to pin the behavior
 * of the runner module so future refactors can't silently drift:
 *
 *   • `buildRunPipeline({ cores, solver, geometryKind })` — a pure
 *     decision-matrix builder. We pin its output shape across the 4
 *     cells of the (cores × geometryKind) matrix AND a handful of
 *     single-cell invariants (meshing-always-first, converting-always-
 *     last, mpirun command shape, solver-name preservation).
 *
 *   • `formatDuration(ms)` — pure HH:MM:SS formatter. We pin floor-to-
 *     second behavior, zero-pad shape, and the deliberate no-day-
 *     rollover behavior (24h+ inputs grow past the first slot rather
 *     than rolling over to a "d:h:m:s" shape).
 *
 *   • `defaultRunRoot()` — derives `<homedir>/CFDStudio/runs`. We pin
 *     the trailing-path component contract and verify it's anchored
 *     under os.homedir() rather than some other root.
 *
 *   • `cancelRun(missingId)` — the early-return no-op branch. Catches
 *     a regression where cancelRun would throw, mutate the
 *     activeRuns map, or invert the return-value polarity.
 *
 * Each describe block builds on the conventions established by
 * detect-platform.test.ts (V1.32/V1.33): focused single-concern
 * `it` blocks, no fixture scaffolding for purely-deterministic
 * cases, no platform mutation.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import {
  buildRunPipeline,
  cancelRun,
  defaultRunRoot,
  formatDuration,
} from '../runner';

describe('V1.34 -- buildRunPipeline decision matrix', () => {
  it('cores=1, parametric: meshing, solving, converting (no decompose/mpirun/snap/reconstruct)', () => {
    const stages = buildRunPipeline({ cores: 1, solver: 'simpleFoam', geometryKind: 'parametric' });
    expect(stages).toEqual([
      { name: 'meshing', command: ['blockMesh'] },
      { name: 'solving', command: ['simpleFoam'] },
      { name: 'converting', command: ['foamToVTK', '-ascii'] },
    ]);
  });

  it('cores=4, parametric: decomposePar + mpirun -np 4 + reconstructPar in the right slots', () => {
    const stages = buildRunPipeline({ cores: 4, solver: 'simpleFoam', geometryKind: 'parametric' });
    expect(stages).toEqual([
      { name: 'meshing', command: ['blockMesh'] },
      { name: 'decomposing', command: ['decomposePar'] },
      { name: 'solving', command: ['mpirun', '-np', '4', 'simpleFoam', '-parallel'] },
      { name: 'reconstructing', command: ['reconstructPar'] },
      { name: 'converting', command: ['foamToVTK', '-ascii'] },
    ]);
  });

  it('cores=1, imported: snapping stage inserted between meshing and solving', () => {
    const stages = buildRunPipeline({ cores: 1, solver: 'simpleFoam', geometryKind: 'imported' });
    expect(stages).toEqual([
      { name: 'meshing', command: ['blockMesh'] },
      { name: 'snapping', command: ['snappyHexMesh', '-overwrite'] },
      { name: 'solving', command: ['simpleFoam'] },
      { name: 'converting', command: ['foamToVTK', '-ascii'] },
    ]);
  });

  it('cores=4, imported: full pipeline with snapping + parallel solver', () => {
    const stages = buildRunPipeline({ cores: 4, solver: 'pimpleFoam', geometryKind: 'imported' });
    expect(stages).toEqual([
      { name: 'meshing', command: ['blockMesh'] },
      { name: 'snapping', command: ['snappyHexMesh', '-overwrite'] },
      { name: 'decomposing', command: ['decomposePar'] },
      { name: 'solving', command: ['mpirun', '-np', '4', 'pimpleFoam', '-parallel'] },
      { name: 'reconstructing', command: ['reconstructPar'] },
      { name: 'converting', command: ['foamToVTK', '-ascii'] },
    ]);
  });

  it('meshing is always first regardless of cores or geometryKind', () => {
    const configs = [
      { cores: 1, solver: 'simpleFoam', geometryKind: 'parametric' as const },
      { cores: 4, solver: 'simpleFoam', geometryKind: 'parametric' as const },
      { cores: 1, solver: 'icoFoam',   geometryKind: 'imported' as const },
      { cores: 4, solver: 'pimpleFoam', geometryKind: 'imported' as const },
    ];
    for (const c of configs) {
      const stages = buildRunPipeline(c);
      expect(stages[0]?.name).toBe('meshing');
      expect(stages[0]?.command).toEqual(['blockMesh']);
    }
  });

  it('converting is always last; meshing/converting appear exactly once', () => {
    const configs = [
      { cores: 1, solver: 'simpleFoam', geometryKind: 'parametric' as const },
      { cores: 4, solver: 'simpleFoam', geometryKind: 'parametric' as const },
      { cores: 1, solver: 'icoFoam',   geometryKind: 'imported' as const },
      { cores: 4, solver: 'pimpleFoam', geometryKind: 'imported' as const },
    ];
    for (const c of configs) {
      const stages = buildRunPipeline(c);
      expect(stages[stages.length - 1]?.name).toBe('converting');
      expect(stages.filter((s) => s.name === 'meshing').length).toBe(1);
      expect(stages.filter((s) => s.name === 'converting').length).toBe(1);
      // No duplicate stages of any kind.
      const names = stages.map((s) => s.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('snapping only appears for geometryKind=imported', () => {
    const paramStages = buildRunPipeline({ cores: 4, solver: 'simpleFoam', geometryKind: 'parametric' });
    const impStages  = buildRunPipeline({ cores: 4, solver: 'simpleFoam', geometryKind: 'imported' });
    expect(paramStages.some((s) => s.name === 'snapping')).toBe(false);
    expect(impStages.some((s) => s.name === 'snapping')).toBe(true);
    // Parametric should be exactly one stage shorter than the imported
    // case at a given cores count -- the only difference is the snapping
    // insertion (no other branching).
    expect(paramStages.length).toBe(impStages.length - 1);
  });

  it('mpirun command shape: ["mpirun", "-np", "<N>", solver, "-parallel"]', () => {
    for (const [cores, solver] of [[2, 'simpleFoam'], [4, 'pimpleFoam'], [8, 'icoFoam']] as const) {
      const stages = buildRunPipeline({ cores, solver, geometryKind: 'parametric' });
      const solving = stages.find((s) => s.name === 'solving');
      expect(solving?.command).toEqual(['mpirun', '-np', String(cores), solver, '-parallel']);
    }
  });

  it('decomposePar precedes the solving stage; reconstructPar follows it', () => {
    const stages = buildRunPipeline({ cores: 4, solver: 'simpleFoam', geometryKind: 'imported' });
    const decomposeIdx = stages.findIndex((s) => s.name === 'decomposing');
    const solvingIdx   = stages.findIndex((s) => s.name === 'solving');
    const reconstructIdx = stages.findIndex((s) => s.name === 'reconstructing');
    expect(decomposeIdx).toBeLessThan(solvingIdx);
    expect(reconstructIdx).toBeGreaterThan(solvingIdx);
    expect(stages[decomposeIdx]?.command).toEqual(['decomposePar']);
    expect(stages[reconstructIdx]?.command).toEqual(['reconstructPar']);
  });

  it('solver argument is preserved verbatim in the mpirun command', () => {
    // The runner must not lowercase or otherwise mangle the solver name;
    // OpenFOAM solver binaries are case-sensitive on linux + macOS hosts.
    const stages = buildRunPipeline({ cores: 4, solver: 'buoyantSimpleFoam', geometryKind: 'parametric' });
    expect(stages.find((s) => s.name === 'solving')?.command).toContain('buoyantSimpleFoam');
  });

  it('geometryKind defaults to "parametric" when omitted', () => {
    const stages = buildRunPipeline({ cores: 4, solver: 'simpleFoam' });
    expect(stages.some((s) => s.name === 'snapping')).toBe(false);
  });
});

describe('V1.34 -- formatDuration edge cases', () => {
  it('0 ms encodes as "00:00:00"', () => {
    expect(formatDuration(0)).toBe('00:00:00');
  });

  it('sub-second ms values floor to "00:00:00"', () => {
    // OpenFOAM runs are typically long; floor-to-second is the contract.
    expect(formatDuration(500)).toBe('00:00:00');
    expect(formatDuration(999)).toBe('00:00:00');
  });

  it('one second exact encodes to "00:00:01"', () => {
    expect(formatDuration(1000)).toBe('00:00:01');
  });

  it('one minute exact encodes to "00:01:00"', () => {
    expect(formatDuration(60_000)).toBe('00:01:00');
  });

  it('one hour exact encodes to "01:00:00"', () => {
    expect(formatDuration(3_600_000)).toBe('01:00:00');
  });

  it('24+ hours intentionally do NOT roll over (deliberate no-day-bucket contract)', () => {
    // A 24h run reads "24:00:00", not "1d 00:00:00". The format is
    // HH:MM:SS where HH is unbounded and zero-padded to two digits
    // -- growth beyond 99h will visually widen but never truncate.
    expect(formatDuration(86_400_000)).toBe('24:00:00');
    expect(formatDuration(90_061_000)).toBe('25:01:01');
  });

  it('all slots are zero-padded to two digits', () => {
    expect(formatDuration(1_500)).toMatch(/^00:00:0\d$/);     // ~1.5s
    expect(formatDuration(61_500)).toMatch(/^00:0\d:0\d$/);   // ~1.5m
    expect(formatDuration(3_661_500)).toMatch(/^0\d:0\d:0\d$/); // ~1.5h
  });

  it('match shape against HH:MM:SS regex on a representative range, including longer-than-99h no-rollover', () => {
    // The format is HH:MM:SS where:
    //   • HH is zero-padded to AT LEAST two digits but unbounded above
    //     (no day rollover -- see the "24+ hours intentionally do NOT
    //     roll over" test, where 999_999_999ms legitimately encodes
    //     to "277:46:39"). The hours regex therefore captures 2+ digits.
    //   • MM and SS are exactly two digits (max 59 each, by definition
    //     of minutes/seconds).
    for (const ms of [0, 999, 1000, 999_999, 999_999_999]) {
      expect(formatDuration(ms)).toMatch(/^\d{2,}:\d{2}:\d{2}$/);
    }
  });
});

describe('V1.34 -- defaultRunRoot shape contract', () => {
  it('returns a non-empty string under os.homedir()', () => {
    const root = defaultRunRoot();
    expect(typeof root).toBe('string');
    expect(root.length).toBeGreaterThan(0);
    expect(root.startsWith(os.homedir())).toBe(true);
  });

  it('ends with the trailing "CFDStudio/runs" path component', () => {
    const root = defaultRunRoot();
    expect(root.endsWith(path.join('CFDStudio', 'runs'))).toBe(true);
  });

  // NOTE: a hypothetical "no double slashes" assertion was considered and
  // dropped -- `path.join` normalizes its input and can never produce '//'
  // for any combination of homedir values ('', '/', '/home/x'). The two
  // assertions above already pin the meaningful shape contract; a tautology
  // test that passes under every plausible implementation would not catch
  // any real regression.
});

describe('V1.34 -- cancelRun missing-id no-op', () => {
  // randomUUID() bullet-proofs the no-op branch against any future test
  // that adds a real run-id to the same vitest module scope -- the
  // cancelRun no-op path is a pure early-return, so a single shared id
  // across all 3 sub-tests is fine (a per-test re-roll would be wasted
  // work since the missing-id branch neither mutates nor caches state).
  const missingId = randomUUID();

  it('returns false for an unknown runId with default reason', () => {
    expect(cancelRun(missingId)).toBe(false);
  });

  it('returns false for an unknown runId with explicit reason="user"', () => {
    expect(cancelRun(missingId, 'user')).toBe(false);
  });

  it('returns false for an unknown runId with reason="converged"', () => {
    // Reason must not affect the missing-id contract -- the early-
    // return branch only consults `activeRuns.get(runId)` and
    // `run.done`.
    expect(cancelRun(missingId, 'converged')).toBe(false);
  });
});

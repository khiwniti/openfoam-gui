/**
 * V1.38 — vitest suite for the 3 pure string formatters lifted from
 *  src/main/openfoam/case.ts Handlebars helpers into
 *  src/main/openfoam/case-helpers.ts:
 *    * formatSmootherLine — matrix-solver switch returning the
 *      `smoother …;` / `preconditioner …;` line.
 *    * formatBcBlock — per-patch BC type+value formatter returning
 *      the OpenFOAM boundary-condition syntax block.
 *    * formatRefinementBlock — per-patch refinement level formatter
 *      returning the `level (min max);` line.
 *
 *  Mirrors the V1.37a/V1.37c test-file structures: pure-fn tests,
 *  no electron, no fs, no Handlebars. The 3 helpers are fully
 *  `unknown → string` (or `string → string` for smootherLine), so
 *  the suite exercises them with canonical inputs + edge cases +
 *  defensive-type-check regression-pins.
 */
import { describe, it, expect } from 'vitest';
import {
  formatBcBlock,
  formatRefinementBlock,
  formatSmootherLine,
} from '../case-helpers';
import type { BcField, PatchRefinements } from '@shared/types';

describe('formatSmootherLine', () => {
  it("returns the GAMG / GaussSeidel line for solver='GAMG'", () => {
    expect(formatSmootherLine('GAMG')).toBe('smoother        GaussSeidel;');
  });

  it("returns the smoothSolver / symGaussSeidel line for solver='smoothSolver'", () => {
    expect(formatSmootherLine('smoothSolver')).toBe('smoother        symGaussSeidel;');
  });

  it("returns the PCG / DIC preconditioner line for solver='PCG'", () => {
    expect(formatSmootherLine('PCG')).toBe('preconditioner  DIC;');
  });

  it("returns the PBiCG / DILU preconditioner line for solver='PBiCG'", () => {
    expect(formatSmootherLine('PBiCG')).toBe('preconditioner  DILU;');
  });

  it("returns the PBiCGStab / DILU preconditioner line for solver='PBiCGStab'", () => {
    expect(formatSmootherLine('PBiCGStab')).toBe('preconditioner  DILU;');
  });

  it("falls back to the GAMG / GaussSeidel default for unrecognized solvers", () => {
    // Regression-pin: the default branch is the OpenFOAM stock
    //  p-block smoother, which has the widest applicability across
    //  SIMPLE / PISO / PIMPLE. A future "tighten the default" pass
    //  would break this test intentionally.
    expect(formatSmootherLine('')).toBe('smoother        GaussSeidel;');
    expect(formatSmootherLine('unknownSolver')).toBe('smoother        GaussSeidel;');
  });
});

describe('formatBcBlock', () => {
  it("emits `type <kind>;` for non-fixedValue BCs (zeroGradient / noSlip / etc.)", () => {
    const bcMap: Record<string, BcField> = {
      inlet: { type: 'zeroGradient' },
      wall: { type: 'noSlip' },
    };
    expect(formatBcBlock(bcMap, 'inlet')).toBe('type zeroGradient;');
    expect(formatBcBlock(bcMap, 'wall')).toBe('type noSlip;');
  });

  it("emits `type fixedValue;\\n        value uniform <N>;` for a fixedValue scalar", () => {
    const bcMap: Record<string, BcField> = {
      inlet: { type: 'fixedValue', value: 1.5 },
    };
    expect(formatBcBlock(bcMap, 'inlet')).toBe(
      'type fixedValue;\n        value uniform 1.5;',
    );
  });

  it("emits `type fixedValue;\\n        value uniform (x y z);` for a fixedValue 3-vector", () => {
    const bcMap: Record<string, BcField> = {
      inlet: { type: 'fixedValue', value: [1, 0, 0] },
    };
    expect(formatBcBlock(bcMap, 'inlet')).toBe(
      'type fixedValue;\n        value uniform (1 0 0);',
    );
  });

  it("emits `type fixedValue;\\n        value uniform (0 0 0);` for a fixedValue with invalid value", () => {
    // The defensive fall-through catches:
    //   * value: undefined (the type+value formatter skips the
    //     safe.value assignment when bc.value is undefined)
    //   * value: NaN (Number.isFinite rejects NaN in the vector check)
    //   * value: a 2-element array (length !== 3)
    //   * value: a vector with a non-finite entry (Number.isFinite rejects Infinity)
    const bcMap1: Record<string, BcField> = { inlet: { type: 'fixedValue' } };
    expect(formatBcBlock(bcMap1, 'inlet')).toBe(
      'type fixedValue;\n        value uniform (0 0 0);',
    );

    const bcMap2: Record<string, BcField> = { inlet: { type: 'fixedValue', value: Number.NaN } };
    expect(formatBcBlock(bcMap2, 'inlet')).toBe(
      'type fixedValue;\n        value uniform (0 0 0);',
    );

    const bcMap3: Record<string, BcField> = { inlet: { type: 'fixedValue', value: [1, 2] } };
    expect(formatBcBlock(bcMap3, 'inlet')).toBe(
      'type fixedValue;\n        value uniform (0 0 0);',
    );

    const bcMap4: Record<string, BcField> = { inlet: { type: 'fixedValue', value: [1, Number.POSITIVE_INFINITY, 0] } };
    expect(formatBcBlock(bcMap4, 'inlet')).toBe(
      'type fixedValue;\n        value uniform (0 0 0);',
    );
  });

  it("falls back to `type zeroGradient;` for missing bcMap or non-string patchName", () => {
    // Defensive: a renderer that ships a partial bc table (e.g.
    //  a legacy .cfd-app-state.json) gets zeroGradient rather than
    //  throwing — the template still produces valid OpenFOAM.
    expect(formatBcBlock(undefined, 'inlet')).toBe('type zeroGradient;');
    expect(formatBcBlock(null, 'inlet')).toBe('type zeroGradient;');
    expect(formatBcBlock({}, 'inlet')).toBe('type zeroGradient;');
    expect(formatBcBlock({ inlet: { type: 'fixedValue', value: [1, 0, 0] } }, undefined)).toBe(
      'type zeroGradient;',
    );
    expect(formatBcBlock({ inlet: { type: 'fixedValue', value: [1, 0, 0] } }, 42)).toBe(
      'type zeroGradient;',
    );
  });

  it("falls back to `type zeroGradient;` when the patch is not in bcMap", () => {
    const bcMap: Record<string, BcField> = {
      inlet: { type: 'fixedValue', value: [1, 0, 0] },
    };
    expect(formatBcBlock(bcMap, 'outlet')).toBe('type zeroGradient;');
  });
});

describe('formatRefinementBlock', () => {
  it("emits `level (0 0);` for a missing refMap / missing patch entry", () => {
    // Defensive: legacy .cfd-app-state.json files that pre-date V1.4
    //  have no `patchRefinements` key; the template still produces
    //  a valid `level (0 0);` line.
    expect(formatRefinementBlock(undefined, 'wall')).toBe('level (0 0);');
    expect(formatRefinementBlock({}, 'wall')).toBe('level (0 0);');
    expect(formatRefinementBlock({ wall: { min: 2, max: 3 } }, 'inlet')).toBe('level (0 0);');
  });

  it("emits `level (min max);` for a well-formed refinement entry", () => {
    const refMap: PatchRefinements = {
      wall: { min: 2, max: 4 },
    };
    expect(formatRefinementBlock(refMap, 'wall')).toBe('level (2 4);');
  });

  it("clamps values to OpenFOAM's documented 0..7 range", () => {
    // Both the floor (negative / non-finite → 0) and the ceiling
    //  (>7 → 7) are exercised; future "loosen the clamp" passes
    //  break this test intentionally.
    const refMap: PatchRefinements = {
      a: { min: -5, max: 100 },
      b: { min: 0, max: 0 },
      c: { min: 7, max: 7 },
    };
    expect(formatRefinementBlock(refMap, 'a')).toBe('level (0 7);');
    expect(formatRefinementBlock(refMap, 'b')).toBe('level (0 0);');
    expect(formatRefinementBlock(refMap, 'c')).toBe('level (7 7);');
  });

  it("rounds fractional values to the nearest integer", () => {
    const refMap: PatchRefinements = {
      wall: { min: 2.4, max: 5.6 },
    };
    expect(formatRefinementBlock(refMap, 'wall')).toBe('level (2 6);');
  });

  it("snaps `max` up to `min` when `max < min` (OpenFOAM rejects `level (5 3);`)", () => {
    const refMap: PatchRefinements = {
      wall: { min: 5, max: 3 },
    };
    expect(formatRefinementBlock(refMap, 'wall')).toBe('level (5 5);');
  });

  it("ignores non-finite refinement values (NaN / Infinity fall back to 0)", () => {
    const refMap: PatchRefinements = {
      a: { min: Number.NaN, max: Number.NaN },
      b: { min: Number.POSITIVE_INFINITY, max: 3 },
    };
    expect(formatRefinementBlock(refMap, 'a')).toBe('level (0 0);');
    // min is Infinity → Number.isFinite fails → min stays 0; max is 3 → clamped & rounded normally
    expect(formatRefinementBlock(refMap, 'b')).toBe('level (0 3);');
  });

  it("falls back to `level (0 0);` for non-string patchName", () => {
    const refMap: PatchRefinements = { wall: { min: 2, max: 3 } };
    expect(formatRefinementBlock(refMap, undefined)).toBe('level (0 0);');
    expect(formatRefinementBlock(refMap, 42)).toBe('level (0 0);');
  });
});

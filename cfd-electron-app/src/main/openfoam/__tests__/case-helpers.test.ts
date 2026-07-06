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
  buildRenderContext,
  formatBcBlock,
  formatRefinementBlock,
  formatSmootherLine,
  resolveTemplatesRoot,
  shouldEmitAdaptiveTimeStep,
  shouldEmitRelaxationFactors,
} from '../case-helpers';
import type { BcField, Domain, PatchRefinements } from '@shared/types';

/**
 * Build a minimal valid Domain for the V1.38b context-builder
 * tests. Mirrors the OpenFOAM-cavity defaults from the
 * SOLVER_CONTROLS_DEFAULTS map in the renderer's Zustand
 * store; specific tests override individual fields to exercise
 * the per-solver routing of shouldEmitRelaxationFactors +
 * shouldEmitAdaptiveTimeStep and the snappy-driven `origin` /
 * `bbox` branches of buildRenderContext.
 */
function makeTestDomain(overrides: Partial<Domain> = {}): Domain {
  return {
    kind: 'cavity',
    Lx: 1,
    Ly: 1,
    Lz: 1,
    nx: 20,
    ny: 20,
    nz: 20,
    nu: 1e-5,
    rho: 1.2,
    solver: 'icoFoam',
    turbulence: 'laminar',
    endTime: 1,
    deltaT: 0.001,
    writeInterval: 100,
    purgeWrite: 0,
    numerics: {
      enabled: true,
      nNonOrthogonalCorrectors: 0,
      nCorrectors: 2,
      nOuterCorrectors: 1,
      residualControl: 1e-4,
      residualControlByField: {},
    },
    schemes: {
      ddtDefault: 'Euler',
      gradDefault: 'Gauss linear',
      divDefault: 'none',
      laplacianDefault: 'Gauss linear corrected',
      interpolationDefault: 'linear',
      snGradDefault: 'corrected',
      fieldDivs: {},
      fieldLaplacians: {},
      fieldSnGrads: {},
    },
    solverConfigs: {
      p: { solver: 'GAMG', tolerance: 1e-7, relTol: 0.01 },
      U: { solver: 'smoothSolver', tolerance: 1e-7, relTol: 0.1 },
      turbulence: { solver: 'smoothSolver', tolerance: 1e-7, relTol: 0.1 },
    },
    relaxationFactors: { enabled: false, fields: {}, equations: {} },
    adaptiveTimeStep: { enabled: false, maxCo: 1 },
    turbulenceCoefficients: { Cmu: 0.09, C1: 1.44, C2: 1.92, sigmak: 1.0, sigmaEps: 1.3 },
    turbulenceCoefficientsKOmegaSST: {
      alphaK1: 0.85, alphaK2: 1.0, alphaOmega1: 0.5, alphaOmega2: 0.856,
      beta1: 0.075, beta2: 0.0828, betaStar: 0.09, C1: 2.0,
      gamma1: 0.5555555555, gamma2: 0.875, sigmaK: 0.6, sigmaOmega: 0.5,
    },
    turbulenceCoefficientsSpalartAllmaras: {
      sigmaNut: 0.667, kappa: 0.41, Cb1: 0.1355, Cb2: 0.622,
      Cw1: 0.3, Cw2: 0.06, Cw3: 2.0, Cv1: 7.1, Cv2: 5.0,
    },
    turbulenceCoefficientsLES: { Cs: 0.2, Cw: 0.325 },
    turbulenceCoefficientsKEqn: { Ck: 0.094, Ce1: 1.048, Ce2: 1.048 },
    turbulenceCoefficientsCDES: { CDES: 0.65 },
    initialConditions: { velocity: { x: 0, y: 0, z: 0 }, pressure: 0 },
    cores: 1,
    geometryKind: 'parametric',
    patches: [],
    ...overrides,
  };
}

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

describe('shouldEmitRelaxationFactors', () => {
  it("emits the relaxationFactors block unconditionally for SIMPLE-family solvers", () => {
    // simpleFoam, buoyantSimpleFoam, potentialFoam all bypass
    //  the `enabled` flag per V1.18b (V1.11 review-fix): SIMPLE
    //  algorithms need the relaxation factors to converge,
    //  regardless of the user's toggle preference.
    expect(shouldEmitRelaxationFactors(makeTestDomain({ solver: 'simpleFoam' }))).toBe(true);
    expect(shouldEmitRelaxationFactors(makeTestDomain({ solver: 'buoyantSimpleFoam' }))).toBe(true);
    expect(shouldEmitRelaxationFactors(makeTestDomain({ solver: 'potentialFoam' }))).toBe(true);
  });

  it("emits the relaxationFactors block for icoFoam regardless of the enabled flag (V1.18b design)", () => {
    // icoFoam is transient (PISO), and per V1.18b the
    //  `enabled` flag only gates pimpleFoam. icoFoam
    //  unconditionally honors the toggle (V1.11 default = no
    //  block). Pin this so a future "extend the gate to icoFoam"
    //  refactor gets caught.
    expect(shouldEmitRelaxationFactors(makeTestDomain({ solver: 'icoFoam' }))).toBe(false);
  });

  it("emits the relaxationFactors block for pimpleFoam only when `relaxationFactors.enabled === true`", () => {
    // Default relaxationFactors.enabled is false (Zod default),
    //  so a stock pimpleFoam domain emits no block. Flipping
    //  enabled to true via the form changes the emit.
    expect(shouldEmitRelaxationFactors(makeTestDomain({ solver: 'pimpleFoam' }))).toBe(false);
    expect(shouldEmitRelaxationFactors(makeTestDomain({
      solver: 'pimpleFoam',
      relaxationFactors: { enabled: true, fields: {}, equations: {} },
    }))).toBe(true);
  });
});

describe('shouldEmitAdaptiveTimeStep', () => {
  it("never emits `adjustTimeStep yes;` for SIMPLE-family solvers regardless of the enabled flag", () => {
    // SIMPLE is steady-state; OpenFOAM ignores adjustTimeStep on
    //  these solvers. The form displays the toggle but the
    //  emitted controlDict always reads `no` (OpenFOAM stock).
    expect(shouldEmitAdaptiveTimeStep(makeTestDomain({ solver: 'simpleFoam' }))).toBe(false);
    expect(shouldEmitAdaptiveTimeStep(makeTestDomain({ solver: 'buoyantSimpleFoam' }))).toBe(false);
    expect(shouldEmitAdaptiveTimeStep(makeTestDomain({ solver: 'potentialFoam' }))).toBe(false);
    // Even with enabled=true, the SIMPLE gate short-circuits to false.
    expect(shouldEmitAdaptiveTimeStep(makeTestDomain({
      solver: 'simpleFoam',
      adaptiveTimeStep: { enabled: true, maxCo: 0.5 },
    }))).toBe(false);
  });

  it("honors the enabled flag for transient solvers (pimpleFoam + icoFoam)", () => {
    // Default adaptiveTimeStep.enabled is false; a stock
    //  transient domain emits `adjustTimeStep no;`.
    expect(shouldEmitAdaptiveTimeStep(makeTestDomain({ solver: 'pimpleFoam' }))).toBe(false);
    expect(shouldEmitAdaptiveTimeStep(makeTestDomain({ solver: 'icoFoam' }))).toBe(false);
    // Flipping enabled to true changes the emit.
    expect(shouldEmitAdaptiveTimeStep(makeTestDomain({
      solver: 'pimpleFoam',
      adaptiveTimeStep: { enabled: true, maxCo: 0.5 },
    }))).toBe(true);
    expect(shouldEmitAdaptiveTimeStep(makeTestDomain({
      solver: 'icoFoam',
      adaptiveTimeStep: { enabled: true, maxCo: 1 },
    }))).toBe(true);
  });
});

describe('resolveTemplatesRoot', () => {
  it("returns `<cwd>/resources/templates` when nodeEnv === 'development'", () => {
    // In dev (electron-vite), templates live alongside the
    //  project root's `resources/` directory. The exact path
    //  is `path.join(cwd, 'resources', 'templates')`.
    expect(resolveTemplatesRoot({
      nodeEnv: 'development',
      cwd: '/home/user/project',
      resourcesPath: '/should/be/ignored',
    })).toBe('/home/user/project/resources/templates');
  });

  it("returns `<resourcesPath>/templates` in production when resourcesPath is set", () => {
    // electron-vite packages bundle resources under
    //  process.resourcesPath; the templates sit one level
    //  deep at `<resourcesPath>/templates`.
    expect(resolveTemplatesRoot({
      nodeEnv: 'production',
      cwd: '/should/be/ignored',
      resourcesPath: '/app.asar.unpacked',
    })).toBe('/app.asar.unpacked/templates');
  });

  it("falls back to `<cwd>/templates` in production when resourcesPath is undefined", () => {
    // The legacy `process.resourcesPath || process.cwd()`
    //  pattern: if process.resourcesPath is undefined (e.g.,
    //  a misconfigured packaged build or a test env), fall
    //  through to cwd-relative templates.
    expect(resolveTemplatesRoot({
      nodeEnv: 'production',
      cwd: '/home/user/project',
      resourcesPath: undefined,
    })).toBe('/home/user/project/templates');
  });
});

describe('buildRenderContext', () => {
  it("builds a cavity context with the per-template precomputed strings + origin defaults", () => {
    // A stock cavity domain (no origin, no bbox, solver=icoFoam)
    //  gets resolution="20 20 20" (from nx/ny/nz), the
    //  bbox-less locationInMesh fallback at (0.5, 0.5, 0.5)
    //  (from Lx/Ly/Lz / 2), origin/ox/oy/oz all "0", and the
    //  2 emit booleans reflecting icoFoam's transient routing
    //  (relaxationFactors=false, adaptiveTimeStep=false).
    const domain = makeTestDomain({ solver: 'icoFoam' });
    const bc = { velocity: {}, pressure: {} };
    const ctx = buildRenderContext({
      domain,
      bc,
      refinements: {},
      caseLabel: 'cavity-test',
    });
    expect(ctx.resolution).toBe('20 20 20');
    expect(ctx.locationInMesh).toBe('0.5 0.5 0.5');
    expect(ctx.caseLabel).toBe('cavity-test');
    expect(ctx.openfoamVersion).toBe('(detected at run)');
    expect(ctx.patchRefinements).toEqual({});
    expect(ctx.bc).toBe(bc);
    // Domain spread — the template's `{{Lx}}` etc. resolve
    //  directly to the domain field values.
    expect(ctx.Lx).toBe(1);
    expect(ctx.nu).toBe(1e-5);
    expect(ctx.solver).toBe('icoFoam');
    expect(ctx.turbulence).toBe('laminar');
    // Origin defaults to undefined (no origin key on Domain) so
    //  the `ox`/`oy`/`oz` strings read "0" (the ?? 0 fallthrough).
    expect(ctx.origin).toBeUndefined();
    expect(ctx.ox).toBe('0');
    expect(ctx.oy).toBe('0');
    expect(ctx.oz).toBe('0');
    expect(ctx.oxPLx).toBe('1');
    expect(ctx.oyPLy).toBe('1');
    expect(ctx.ozPLz).toBe('1');
    // icoFoam routing — no relaxationFactors block, no
    //  adaptiveTimeStep block (default enabled=false).
    expect(ctx.emitRelaxationFactors).toBe(false);
    expect(ctx.emitAdaptiveTimeStep).toBe(false);
  });

  it("uses bbox centroid for locationInMesh when the domain has a bbox", () => {
    // The snappy-driven (imported) flow uses the bbox centroid
    //  + 1/2 the Lx/Ly/Lz offset as the seed for the
    //  blockMesh. The numbers here are the bbox-center + 0.5
    //  for a 1x1x1 cavity — exact match to the inline
    //  formatLocationInMesh logic.
    const domain = makeTestDomain({
      bbox: {
        min: { x: -0.5, y: -0.5, z: -0.5 },
        max: { x: 0.5, y: 0.5, z: 0.5 },
      },
    });
    const ctx = buildRenderContext({
      domain,
      bc: { velocity: {}, pressure: {} },
      refinements: {},
      caseLabel: 'snappy-test',
    });
    expect(ctx.locationInMesh).toBe('0 0 0');
  });

  it("propagates a custom origin to the 6 origin-coordinate strings", () => {
    // The blockMesh origin (corner offset from the world
    //  origin) is on the domain; the context exposes both
    //  the raw `origin` object (for the template to read
    //  `{{origin.x}}`) and 6 precomputed string forms (ox,
    //  oy, oz, oxPLx, oyPLy, ozPLz) for direct emission in
    //  the .hbs file.
    const domain = makeTestDomain({
      origin: { x: 10, y: 20, z: 30 },
      Lx: 2, Ly: 3, Lz: 4,
    });
    const ctx = buildRenderContext({
      domain,
      bc: { velocity: {}, pressure: {} },
      refinements: {},
      caseLabel: 'offset-test',
    });
    expect(ctx.origin).toEqual({ x: 10, y: 20, z: 30 });
    expect(ctx.ox).toBe('10');
    expect(ctx.oy).toBe('20');
    expect(ctx.oz).toBe('30');
    expect(ctx.oxPLx).toBe('12');
    expect(ctx.oyPLy).toBe('23');
    expect(ctx.ozPLz).toBe('34');
  });

  it("routes pimpleFoam + relaxationFactors.enabled=true to emitRelaxationFactors=true", () => {
    // pimpleFoam gates the relaxationFactors block on the
    //  per-solver toggle. Default false → no emit. Flip to
    //  true → emit. This pins the routing without coupling
    //  the test to the shouldEmitRelaxationFactors helper's
    //  internal logic.
    const ctx = buildRenderContext({
      domain: makeTestDomain({ solver: 'pimpleFoam' }),
      bc: { velocity: {}, pressure: {} },
      refinements: {},
      caseLabel: 'pimple-default',
    });
    expect(ctx.emitRelaxationFactors).toBe(false);

    const ctxEnabled = buildRenderContext({
      domain: makeTestDomain({
        solver: 'pimpleFoam',
        relaxationFactors: { enabled: true, fields: {}, equations: {} },
      }),
      bc: { velocity: {}, pressure: {} },
      refinements: {},
      caseLabel: 'pimple-enabled',
    });
    expect(ctxEnabled.emitRelaxationFactors).toBe(true);
  });

  it("routes icoFoam + adaptiveTimeStep.enabled=true to emitAdaptiveTimeStep=true", () => {
    // icoFoam honors the enabled flag (transient solver).
    //  Default false → no emit. Flip to true → emit.
    const ctx = buildRenderContext({
      domain: makeTestDomain({ solver: 'icoFoam' }),
      bc: { velocity: {}, pressure: {} },
      refinements: {},
      caseLabel: 'ico-default',
    });
    expect(ctx.emitAdaptiveTimeStep).toBe(false);

    const ctxEnabled = buildRenderContext({
      domain: makeTestDomain({
        solver: 'icoFoam',
        adaptiveTimeStep: { enabled: true, maxCo: 0.5 },
      }),
      bc: { velocity: {}, pressure: {} },
      refinements: {},
      caseLabel: 'ico-enabled',
    });
    expect(ctxEnabled.emitAdaptiveTimeStep).toBe(true);
  });
});

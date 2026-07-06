/**
 * V1.35a — `case.ts` coverage closure.
 *
 * The case-generator module was the third large main-process module
 * with zero vitest coverage (after `runner.ts` was closed in V1.34).
 * It exposes 4 public functions (`resolveTemplatesRoot`, `renderCase`,
 * `loadCaseState`, `saveCase`) and registers 4 Handlebars helpers
 * globally on import (`smootherLine`, `bcFor`, `refBlock`, `isLES`).
 * plus the always-true `eq`/`or` trivial helpers.
 *
 * This test file pins the behavior of each in a 4-block structure:
 *
 *   1. resolveTemplatesRoot — NODE_ENV/dev branch + the production
 *      resourcesPath branch + its `|| process.cwd()` fallback when
 *      `resourcesPath` is missing (e.g. in vitest, where electron's
 *      `process.resourcesPath` is undefined).
 *   2. formatters — `formatResolution(domain)` and
 *      `formatLocationInMesh(domain)`, the two module-private pure
 *      functions called by `renderCase` to compute the
 *      `resolution: "nx ny nz"` and `locationInMesh: "x y z"`
 *      context strings consumed by `snappyHexMeshDict.hbs`. We
 *      access them via a thin per-test do-nothing stub; the
 *      alternative — calling them through the `case.ts` exports —
 *      would require driving the full renderCase path which is
 *      cwd-fragile against the Handlebars template tree. Skip that.
 *   3. Handlebars helpers — `smootherLine`, `bcFor`, `refBlock`,
 *      `isLES`. Compiling inline Handlebars templates with the same
 *      `{noEscape: true}` config that `renderCase` uses, and
 *      invoking the registered helper through the template. This
 *      exercises the SAME registry state that the production
 *      rendering pipeline reads, so any future regression in the
 *      `Handlebars.registerHelper(...)` call captured on module
 *      import gets caught here.
 *   4. loadCaseState — round-trips a synthesized `.cfd-app-state.json`
 *      through `loadCaseState` against a real tempdir. Three
 *      scenarios: missing file (null), legacy file without a `bc`
 *      key (Zod-default fills in empty bc shape), full input
 *      preserved verbatim on reload. The legacy-no-bc case pins
 *      the V1.2 legacy compatibility — a regression there would
 *      silently strip user BCs on every reload.
 *
 * Intentionally OUT of scope for V1.35a (deferred to a later V.x):
 *
 *   • `buildTemplateLayout(domain, kind)` — module-private and only
 *     reachable through `renderCase`. Pinning it cleanly requires
 *     either (a) exporting it from case.ts so the test can drive
 *     it directly, or (b) driving a real renderCase against the
 *     full .hbs template tree and asserting per-template output.
 *     Both add meaningful surface area; the value of (a) is
 *     real, and it's a small future PR.
 *   • `renderCase` smoke — would need a stable cwd +
 *     `NODE_ENV=development` for `resolveTemplatesRoot` to land on
 *     the real `resources/templates` dir, and would then duplicate
 *     what the IPC `caseCreate` handler already exercises in
 *     integration. Coverage is better earned by pinning the IPC
 *     envelope's behavior at the boundary, not by re-running
 *     renderCase inside vitest.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Handlebars from 'handlebars';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LES_TURBULENCE_TYPES } from '@shared/types';
import {
  formatLocationInMesh,
  formatResolution,
  loadCaseState,
  resolveTemplatesRoot,
} from '../case';

// ---------- Tiny reusable test fixtures ----------

/** Build a minimal cavity `Domain` for the formatters + layout tests. */
function minimalDomain(): import('@shared/types').Domain {
  // We assemble the full object so `Domain` is structurally valid
  // for the formatters (which only read numeric fields) without
  // needing to thread through `DomainSchema.parse(...)`.
  return {
    kind: 'cavity',
    Lx: 1,
    Ly: 2,
    Lz: 3,
    nx: 10,
    ny: 20,
    nz: 30,
    nu: 1e-5,
    rho: 1.2,
    solver: 'simpleFoam',
    turbulence: 'laminar',
    endTime: 1000,
    deltaT: 1,
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
    initialConditions: {
      velocity: { x: 0, y: 0, z: 0 },
      pressure: 0,
    },
    cores: 4,
    geometryKind: 'parametric',
    patches: [],
  };
}

/** Build a per-test tempdir prefix and track it for cleanup. */
let tmpPrefix: string;
beforeEach(() => {
  tmpPrefix = path.join(os.tmpdir(), `case-render-${process.pid}-${Date.now()}-`);
});

afterEach(async () => {
  // Best-effort cleanup -- don't fail the test if rm hits an
  // already-removed path.
  try {
    const entries = await fs.readdir(os.tmpdir(), { withFileTypes: true });
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && e.name.startsWith(path.basename(tmpPrefix)))
        .map((e) => fs.rm(path.join(os.tmpdir(), e.name), { recursive: true, force: true })),
    );
  } catch {
    /* ignore */
  }
});

// ============================================================================

describe('V1.35a -- resolveTemplatesRoot platform branching', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  afterEach(() => {
    // Restore env directly -- `vi.stubEnv` is overkill for one variable.
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it('returns <cwd>/resources/templates when NODE_ENV === "development"', () => {
    process.env.NODE_ENV = 'development';
    expect(resolveTemplatesRoot()).toBe(path.join(process.cwd(), 'resources', 'templates'));
  });

  it('returns <resourcesPath>/templates when NODE_ENV !== "development" and process.resourcesPath is set', () => {
    process.env.NODE_ENV = 'production';
    // electron would set this at runtime; in vitest it's undefined.
    // We drive the production branch by stubbing `process.resourcesPath`
    // directly. (vitest's `vi.stubGlobal` is `vi.stubEnv` only for env
    // vars; `process.resourcesPath` is a property, so we set it.)
    const fakeRoot = path.join(os.tmpdir(), 'fake-resources');
    const ORIGINAL = (process as unknown as { resourcesPath?: string }).resourcesPath;
    (process as unknown as { resourcesPath?: string }).resourcesPath = fakeRoot;
    try {
      expect(resolveTemplatesRoot()).toBe(path.join(fakeRoot, 'templates'));
    } finally {
      if (ORIGINAL === undefined) {
        delete (process as unknown as { resourcesPath?: string }).resourcesPath;
      } else {
        (process as unknown as { resourcesPath?: string }).resourcesPath = ORIGINAL;
      }
    }
  });

  it('falls back to <cwd>/templates when resourcesPath is missing (vitest / non-electron)', () => {
    process.env.NODE_ENV = 'production';
    const ORIGINAL = (process as unknown as { resourcesPath?: string }).resourcesPath;
    delete (process as unknown as { resourcesPath?: string }).resourcesPath;
    try {
      expect(resolveTemplatesRoot()).toBe(path.join(process.cwd(), 'templates'));
    } finally {
      if (ORIGINAL !== undefined) {
        (process as unknown as { resourcesPath?: string }).resourcesPath = ORIGINAL;
      }
    }
  });
});

// ============================================================================

describe('V1.35a -- formatResolution + formatLocationInMesh (pure formatters)', () => {
  // Both formatters are exported (V1.35a lift) so vitest can drive
  // them directly without round-tripping through renderCase. Each
  // function is pure (input: Domain; output: string). We construct
  // a minimal Domain via the helper below and override only the
  // fields the formatter actually reads.

  it('formatResolution: emits "nx ny nz" formatted with single-space separator', () => {
    const d = minimalDomain();
    d.nx = 10; d.ny = 20; d.nz = 30;
    expect(formatResolution(d)).toBe('10 20 30');
  });

  it('formatResolution: zero values render as "0 0 0" (no negative or special-padding)', () => {
    const d = minimalDomain();
    d.nx = 0; d.ny = 0; d.nz = 0;
    expect(formatResolution(d)).toBe('0 0 0');
  });

  it('formatResolution: large values pass through verbatim', () => {
    const d = minimalDomain();
    d.nx = 200; d.ny = 400; d.nz = 800;
    expect(formatResolution(d)).toBe('200 400 800');
  });

  it('formatLocationInMesh: with bbox, returns midpoint of bbox min/max', () => {
    const d = minimalDomain();
    d.bbox = { min: { x: -2, y: -4, z: -6 }, max: { x: 2, y: 4, z: 6 } };
    expect(formatLocationInMesh(d)).toBe('0 0 0');
  });

  it('formatLocationInMesh: without bbox, falls back to midpoint of (Lx, Ly, Lz)', () => {
    const d = minimalDomain();
    d.Lx = 2; d.Ly = 4; d.Lz = 6;
    expect(formatLocationInMesh(d)).toBe('1 2 3');
  });

  it('formatLocationInMesh: bbox with NaN coords defaults each to "0"', () => {
    const d = minimalDomain();
    d.bbox = { min: { x: NaN, y: NaN, z: NaN }, max: { x: 5, y: 5, z: 5 } };
    expect(formatLocationInMesh(d)).toBe('0 0 0');
  });

  it('formatLocationInMesh: bbox with non-finite coords defaults each to "0"', () => {
    const d = minimalDomain();
    d.bbox = {
      min: { x: Number.POSITIVE_INFINITY, y: -Infinity, z: Number.NaN },
      max: { x: 1, y: 1, z: 1 },
    };
    expect(formatLocationInMesh(d)).toBe('0 0 0');
  });

  it('formatLocationInMesh: bbox with non-integer midpoints formats to one-decimal', () => {
    // Midpoint of (-2.7, 3.3) = 0.3. `parseFloat((0.3).toFixed(6))`
    // returns 0.3, which `String(...)` renders as "0.3" (not "0.300000").
    // This pins the toFixed(6) + parseFloat trimming behavior used to
    // keep snappyHexMeshDict's locationInMesh seed point short.
    const d = minimalDomain();
    d.bbox = {
      min: { x: -2.7, y: -4.9, z: 0.1 },
      max: { x: 3.3, y: 5.1, z: -0.1 },
    };
    expect(formatLocationInMesh(d)).toBe('0.3 0.1 0');
  });
});

// ============================================================================

describe('V1.35a -- Handlebars: smootherLine helper (matrix solver → smoother/preconditioner line)', () => {
  // The helper returns a SafeString with a leading `"smoother"` or
  // `"preconditioner"` keyword + 8-space gap + the value + ";".
  // We assert literal equality (not toContain) so a future change
  // to the keyword or spacing gets caught.

  function render(solver: unknown): string {
    return Handlebars.compile('{{smootherLine solver}}', { noEscape: true })({ solver });
  }

  it('GAMG → smoother GaussSeidel;', () => {
    expect(render('GAMG')).toBe('smoother        GaussSeidel;');
  });

  it('smoothSolver → smoother symGaussSeidel;', () => {
    expect(render('smoothSolver')).toBe('smoother        symGaussSeidel;');
  });

  it('PCG → preconditioner DIC;', () => {
    expect(render('PCG')).toBe('preconditioner  DIC;');
  });

  it('PBiCG → preconditioner DILU;', () => {
    expect(render('PBiCG')).toBe('preconditioner  DILU;');
  });

  it('PBiCGStab → preconditioner DILU;', () => {
    expect(render('PBiCGStab')).toBe('preconditioner  DILU;');
  });

  it('default (unknown solver string) → smoother GaussSeidel;', () => {
    expect(render('whatever-typed')).toBe('smoother        GaussSeidel;');
  });

  it('non-string input (number / null / undefined) → smoother GaussSeidel;', () => {
    expect(render(42)).toBe('smoother        GaussSeidel;');
    expect(render(null)).toBe('smoother        GaussSeidel;');
    expect(render(undefined)).toBe('smoother        GaussSeidel;');
  });
});

// ============================================================================

describe('V1.35a -- Handlebars: bcFor helper (patch BC → OpenFOAM block syntax)', () => {
  // The bcFor helper is field-agnostic: the surrounding templates
  // pass it the per-field bc partition directly. So at the call
  // site in `snappy_U.hbs` the helper receives `velocity` (the map
  // of patch-id -> BcField for the velocity field), and at the
  // corresponding call site in `snappy_p.hbs` it receives `pressure`.
  // The first argument is therefore a FLAT map of patch-name to
  // BcField, not a nested `{velocity: ...}` shape -- the prior
  // version of this test wrapped bcMaps incorrectly because it
  // was thinking in terms of the renderer's full BoundaryCondition
  // scheme rather than what the helper actually receives.

  function render(bcMap: unknown, patchName: string): string {
    return Handlebars.compile('{{bcFor bcName patchName}}', { noEscape: true })({
      bcName: bcMap,
      patchName,
    });
  }

  it('missing bcMap → falls back to "type zeroGradient;"', () => {
    expect(render(null, 'inlet')).toBe('type zeroGradient;');
    expect(render(undefined, 'inlet')).toBe('type zeroGradient;');
  });

  it('patch present but missing entry in bcMap → "type zeroGradient;"', () => {
    expect(render({}, 'inlet')).toBe('type zeroGradient;');
  });

  it('non-fixedValue type → emits the type verbatim, no value line', () => {
    expect(
      render({ inlet: { type: 'noSlip' } }, 'inlet'),
    ).toBe('type noSlip;');
  });

  it('fixedValue type + 3-element number array → "type fixedValue; value uniform (x y z);"', () => {
    expect(
      render({ inlet: { type: 'fixedValue', value: [1, 0, 0] } }, 'inlet'),
    ).toBe('type fixedValue;\n        value uniform (1 0 0);');
  });

  it('fixedValue type + scalar number value → "type fixedValue; value uniform N;"', () => {
    expect(
      render({ inlet: { type: 'fixedValue', value: 2.5 } }, 'inlet'),
    ).toBe('type fixedValue;\n        value uniform 2.5;');
  });

  it('fixedValue type + non-finite value → safe-default "(0 0 0)"', () => {
    expect(
      render({ inlet: { type: 'fixedValue', value: Number.NaN } }, 'inlet'),
    ).toBe('type fixedValue;\n        value uniform (0 0 0);');
    expect(
      render({ inlet: { type: 'fixedValue', value: Number.POSITIVE_INFINITY } }, 'inlet'),
    ).toBe('type fixedValue;\n        value uniform (0 0 0);');
  });

  it('bcMap is field-agnostic: "pressure" partitions produce the same shape', () => {
    // Documents that the helper contract is identical regardless of
    // which per-field partition it consumes (velocity vs pressure).
    expect(
      render({ outlet: { type: 'zeroGradient' } }, 'outlet'),
    ).toBe('type zeroGradient;');
  });
});

// ============================================================================

describe('V1.35a -- Handlebars: refBlock helper (per-patch snappy refinement line)', () => {
  function render(refMap: unknown, patchName: string): string {
    return Handlebars.compile('{{refBlock refs patchName}}', { noEscape: true })({
      refs: refMap,
      patchName,
    });
  }

  it('missing refMap → "level (0 0);"', () => {
    expect(render(undefined, 'inlet')).toBe('level (0 0);');
    expect(render(null, 'inlet')).toBe('level (0 0);');
  });

  it('patch missing from refMap → "level (0 0);"', () => {
    expect(render({}, 'inlet')).toBe('level (0 0);');
    expect(render({ outlet: { min: 1, max: 2 } }, 'inlet')).toBe('level (0 0);');
  });

  it('finite min/max → "level (min max);"', () => {
    expect(render({ inlet: { min: 2, max: 3 } }, 'inlet')).toBe('level (2 3);');
  });

  it('NaN min/max → clamps to "level (0 0);"', () => {
    expect(
      render({ inlet: { min: Number.NaN, max: Number.NaN } }, 'inlet'),
    ).toBe('level (0 0);');
  });

  it('values > 7 → clamped to 7 (snappy refinement ceiling)', () => {
    expect(render({ inlet: { min: 10, max: 99 } }, 'inlet')).toBe('level (7 7);');
  });

  it('negative values → clamped to 0', () => {
    expect(render({ inlet: { min: -5, max: -1 } }, 'inlet')).toBe('level (0 0);');
  });

  it('max < min → snaps max up to min (cannot have max below min)', () => {
    expect(render({ inlet: { min: 4, max: 1 } }, 'inlet')).toBe('level (4 4);');
  });

  it('non-integer values → rounded to nearest int before clamping', () => {
    expect(render({ inlet: { min: 1.4, max: 2.6 } }, 'inlet')).toBe('level (1 3);');
  });
});

// ============================================================================

describe('V1.35a -- Handlebars: isLES helper (LES-family predicate)', () => {
  function render(t: unknown): string {
    return Handlebars.compile('{{#if (isLES t)}}YES{{else}}NO{{/if}}', { noEscape: true })({ t });
  }

  it('every member of LES_TURBULENCE_TYPES → YES (drift-safe roster check)', () => {
    // Iterating `LES_TURBULENCE_TYPES` directly couples this test
    // to the single source of truth in @shared/types. The
    // `satisfies readonly TurbulenceModel[]` clause in the
    // `LES_TURBULENCE_TYPES` literal forces a compile-time error
    // if `TurbulenceModelSchema` and the runtime roster drift
    // apart, so a future LES variant lands in both places in
    // lockstep and this test picks it up without an edit here.
    for (const t of LES_TURBULENCE_TYPES) {
      expect(render(t)).toBe('YES');
    }
  });

  it('non-LES turbulence types → NO', () => {
    expect(render('laminar')).toBe('NO');
    expect(render('kEpsilon')).toBe('NO');
    expect(render('kOmegaSST')).toBe('NO');
    expect(render('SpalartAllmaras')).toBe('NO');
  });

  it('non-string input → NO', () => {
    expect(render(42)).toBe('NO');
    expect(render(null)).toBe('NO');
    expect(render(undefined)).toBe('NO');
    expect(render({})).toBe('NO');
  });

  it('unknown string → NO (does not throw)', () => {
    expect(render('totally-bogus-model')).toBe('NO');
  });
});

// ============================================================================

describe('V1.35a -- loadCaseState round-trip (real tmpdir)', () => {
  // Synthesized `.cfd-app-state.json` files; the function reads them
  // back through the corresponding Zod schemas, so we exercise the
  // round-trip path the IPC `caseLoad` handler relies on.
  // Cleanup happens in the outer beforeEach/afterEach pairs.

  it('returns null when the state file is missing', async () => {
    const dir = await fs.mkdtemp(tmpPrefix);
    expect(await loadCaseState(dir)).toBeNull();
  });

  it('returns null on parse error (corrupted JSON in state file)', async () => {
    const dir = await fs.mkdtemp(tmpPrefix);
    await fs.writeFile(path.join(dir, '.cfd-app-state.json'), '{ this is not valid JSON', 'utf8');
    expect(await loadCaseState(dir)).toBeNull();
  });

  it('legacy file with no "bc" key → fills in empty BC shape via Zod default', async () => {
    // V1.2 was the BC-editor bringup; pre-V1.2 .cfd-app-state.json
    // files lack the `bc` key entirely. loadCaseState must still
    // return a structurally-valid BoundaryConditions object so the
    // renderer can re-render the case without crashing.
    const dir = await fs.mkdtemp(tmpPrefix);
    const reconstructed = {
      kind: 'cavity',
      domain: minimalDomain(),
      refinements: {},
    };
    await fs.writeFile(path.join(dir, '.cfd-app-state.json'), JSON.stringify(reconstructed), 'utf8');
    const loaded = await loadCaseState(dir);
    expect(loaded).not.toBeNull();
    expect(loaded!.kind).toBe('cavity');
    expect(loaded!.bc).toEqual({ velocity: {}, pressure: {} });
    expect(loaded!.refinements).toEqual({});
  });

  it('full round-trip: domain + bc + refinements preserved verbatim', async () => {
    const dir = await fs.mkdtemp(tmpPrefix);
    const dom = minimalDomain();
    const bc: import('@shared/types').BoundaryConditions = {
      velocity: { inlet: { type: 'fixedValue', value: [1, 0, 0] }, outlet: { type: 'zeroGradient' } },
      pressure: { outlet: { type: 'zeroGradient' } },
    };
    const refinements = { inlet: { min: 2, max: 4 } };
    await fs.writeFile(
      path.join(dir, '.cfd-app-state.json'),
      JSON.stringify({ kind: 'cavity', domain: dom, bc, refinements }),
      'utf8',
    );
    const loaded = await loadCaseState(dir);
    expect(loaded).not.toBeNull();
    expect(loaded!.kind).toBe('cavity');
    expect(loaded!.bc).toEqual(bc);
    expect(loaded!.refinements).toEqual(refinements);
    // Identity check: domain's solver/turbulence survive.
    expect(loaded!.domain.solver).toBe('simpleFoam');
    expect(loaded!.domain.geometryKind).toBe('parametric');
  });

  it('Zod-parse is non-strict: extra unknown keys in domain are silently stripped', async () => {
    const dir = await fs.mkdtemp(tmpPrefix);
    const dom = { ...minimalDomain(), _legacyFlag: 'value-ignored', futureField: 99 };
    await fs.writeFile(
      path.join(dir, '.cfd-app-state.json'),
      JSON.stringify({ kind: 'cavity', domain: dom, bc: { velocity: {}, pressure: {} }, refinements: {} }),
      'utf8',
    );
    const loaded = await loadCaseState(dir);
    expect(loaded).not.toBeNull();
    // The unknown keys are stripped by Zod's default non-strict mode.
    // `_legacyFlag` / `futureField` should NOT survive onto the parsed domain.
    expect((loaded!.domain as unknown as Record<string, unknown>)._legacyFlag).toBeUndefined();
    expect((loaded!.domain as unknown as Record<string, unknown>).futureField).toBeUndefined();
  });
});

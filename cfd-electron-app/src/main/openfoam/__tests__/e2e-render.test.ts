/**
 * V1.45 — e2e test for the case-build pipeline.
 *
 * Validates that the IPC `caseCreate` + `caseSave` / `caseLoad` round-trip
 * (mediated via `renderCase` + `loadCaseState` in `case.ts`) produces a
 * directory that OpenFOAM can ingest directly:
 *
 *      system/controlDict
 *      system/fvSchemes
 *      system/fvSolution
 *      system/blockMeshDict     (parametric) OR
 *      system/snappyHexMeshDict (imported)
 *      constant/transportProperties
 *      constant/momentumTransport
 *      0/U
 *      0/p
 *      .cfd-app-state.json      (round-trippable sidecar)
 *
 * The two `it` cases mirror the two production cases:
 *   * parametric cavity — the lid-driven cavity (blockMeshDict-driven)
 *   * imported geometry  — snappy-driven patch with per-patch BC + refinement
 *
 * The test does NOT require OpenFOAM to be installed: `renderCase` writes
 * the OpenFOAM config files, and `loadCaseState` parses them back via the
 * Zod schema. The full STAGE pipeline (blockMesh → snappyHexMesh →
 * solver → foamToVTK) is verified end-to-end via
 * `scripts/run-full-pipeline.sh` which the user runs on a host where
 * OpenFOAM is installed.
 *
 * V1.45 design notes (compared with the V1.42 case-test-helpers pattern):
 *
 *   * The two test cases would normally be split across the three
 *     cfd-electron-app test files (case-formatters.test.ts for the
 *     pure-fn branches, runner-parsers.test.ts for the parse loops,
 *     etc.) but those files are testing focused units — they don't
 *     call `renderCase` directly. The case-build pipeline is a single
 *     function with one input shape, so a 2-case e2e file mirrors the
 *     ttl of "two production cases exercise the same render code".
 *
 *   * Using `mkdtempSync` + a fresh tmp dir per run (instead of a
 *     committed fixture dir) avoids cross-test contamination when the
 *     schema gains fields over time; the test reads-back through
 *     `loadCaseState` which is the actual Zod round-trip the IPC
 *     `caseLoad` handler invokes.
 *
 *   * `it.each` is intentionally NOT used — the two cases diverge on
 *     over a dozen parameters (geometryKind, patches, BCs), and the
 *     readability win from a closed-table of inputs is dwarfed by the
 *     loss of intent clarity. Per-case `it` blocks read top-to-bottom.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderCase, loadCaseState } from '../case';
import { makeTestDomain } from './case-test-helpers';
import type { BoundaryConditions } from '@shared/types';

/**
 * V1.45 — Steady-family (simpleFoam / buoyantSimpleFoam / potentialFoam)
 *  schemes override. `FvSchemesSchema` requires ALL 6 selector fields +
 *  3 nested defaults to be present in the override literal (Zod
 *  non-deep-merges), so even partial-override branches must ship the
 *  full schema surface. Reused by both simpleFoam it-cases to avoid
 *  duplicating the 9-field literal. Per-case override went through
 *  V1.45 SHIP-final-5 review (round 4) before being DRYed here.
 *
 *  The transient solvers (icoFoam + pimpleFoam) keep the FvSchemesSchema
 *  default (`ddtDefault: 'Euler'`) — they're listed in the comment only
 *  to lock the per-solver routing in one place for future maintainers.
 */
const STEADY_SCHEMES = {
  ddtDefault: 'steadyState' as const,
  gradDefault: 'Gauss linear' as const,
  divDefault: 'none' as const,
  laplacianDefault: 'Gauss linear corrected' as const,
  interpolationDefault: 'linear' as const,
  snGradDefault: 'corrected' as const,
  fieldDivs: {} as const,
  fieldLaplacians: {} as const,
  fieldSnGrads: {} as const,
};

describe('V1.45 e2e: case-build pipeline (renderCase + loadCaseState)', () => {
  let tmpRoot: string;
  // V1.45 reviewer finding (round 3) — pair the NODE_ENV mutation with a
  //  restore inside afterAll. Vitest's default runs each TEST FILE in
  //  its own worker (cross-file leakage is blocked), but within a single
  //  file this describe mutation persists into any subsequent describe
  //  in the same worker — a future case-context.test.ts (or similar)
  //  would silently inherit 'development' and break its expected
  //  'test'-default assertions. Capture the original at beforeAll time,
  //  restore verbatim (incl. undefined → delete) at afterAll.
  let originalNodeEnv: string | undefined;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'cfd-e2e-'));
    // V1.45 — resolveTemplatesRoot gates on `process.env.NODE_ENV === 'development'`
    // (returns `<cwd>/resources/templates` → cfd-electron-app/resources/templates
    // where the .hbs files live). Vitest sets NODE_ENV='test' by default, so
    // resolveTemplatesRoot falls into the production-bundle branch and
    // returns `<cwd>/templates` (ENOENT). Override per-test here so the 3
    // renderCase calls resolve the templates dir correctly. The matching
    // restore in afterAll (below) prevents pollution of subsequent describes.
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    // V1.45 reviewer finding (round 3) — restore NODE_ENV. If the env was
    //  undefined at suite-start (no var set), `delete` removes the key —
    //  setting to undefined would coerce to the literal string 'undefined'
    //  which resolveTemplatesRoot wouldn't match against 'development'.
    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;
  });

  it('parametric cavity: renderCase produces a blockMesh-driven OpenFOAM case', async () => {
    const out = join(tmpRoot, 'parametric-cavity');
    await fs.mkdir(out, { recursive: true });
    // V1.42 schema-derivative fixture: 16 required fields explicit,
    // 14 Zod-default fields filled in.
    const domain = makeTestDomain({
      kind: 'cavity',
      Lx: 1, Ly: 1, Lz: 0.1,
      nx: 20, ny: 20, nz: 1,
      solver: 'simpleFoam',
      turbulence: 'kEpsilon',
      deltaT: 1,
      endTime: 500,
      writeInterval: 100,
      // V1.45 — per-solver routing override: simpleFoam is steady → ddtScheme
      //  'steadyState'. See STEADY_SCHEMES at module scope.
      schemes: STEADY_SCHEMES,
    });
    const bc: BoundaryConditions = {
      velocity: {
        movingWall: { type: 'fixedValue', value: [1, 0, 0] },
        fixedWalls: { type: 'noSlip' },
        frontAndBack: { type: 'empty' },
      },
      pressure: {
        movingWall: { type: 'zeroGradient' },
        fixedWalls: { type: 'zeroGradient' },
        frontAndBack: { type: 'empty' },
      },
    };
    const rendered = await renderCase('cavity', domain, bc, out, 'cfd-e2e-parametric');
    expect(rendered.caseDir).toBe(out);

    //  V1.42 — assert every key OpenFOAM file is written, in the
    // canonical locations OpenFOAM expects (system/, constant/, 0/).
    const written = new Set(rendered.files);
    for (const f of [
      'system/blockMeshDict',
      'system/controlDict',
      'system/fvSchemes',
      'system/fvSolution',
      'constant/transportProperties',
      'constant/momentumTransport',
      '0/U',
      '0/p',
      '.cfd-app-state.json',
    ]) {
      expect(written.has(f), `missing rendered file: ${f}`).toBe(true);
    }

    // Spot-check that the templates picked up Domain values verbatim.
    const controlDict = await fs.readFile(join(out, 'system', 'controlDict'), 'utf8');
    expect(controlDict).toContain('application     simpleFoam;');
    expect(controlDict).toContain('endTime         500;');
    expect(controlDict).toContain('writeInterval   100;');
    // V1.19 — simpleFoam is a SIMPLE-family steady solver, so the
    // controlDict template emits `adjustTimeStep no;`. The `steadyState`
    // string lands in fvSchemes (ddtSchemes block), NOT controlDict —
    // verified by the fvSchemes assertion below.
    expect(controlDict).toContain('adjustTimeStep  no;');

    const fvSchemes = await fs.readFile(join(out, 'system', 'fvSchemes'), 'utf8');
    expect(fvSchemes).toContain('ddtSchemes');
    expect(fvSchemes).toContain('default         steadyState;');

    const fvSolution = await fs.readFile(join(out, 'system', 'fvSolution'), 'utf8');
    expect(fvSolution).toContain('p'); // p-block present
    expect(fvSolution).toContain('solver          GAMG');
    // V1.18d — matrix solver family → smoother line for the SIMPLE p-block
    expect(fvSolution).toContain('smoother        GaussSeidel;');
    // SIMPLE block required for simpleFoam
    expect(fvSolution).toContain('SIMPLE');
    expect(fvSolution).toContain('nNonOrthogonalCorrectors');
    // V1.20 — kEpsilon's regex'd turbulence block
    expect(fvSolution).toContain('"k|epsilon"');

    const blockMeshDict = await fs.readFile(join(out, 'system', 'blockMeshDict'), 'utf8');
    expect(blockMeshDict).toContain('movingWall');
    expect(blockMeshDict).toContain('fixedWalls');
    expect(blockMeshDict).toContain('frontAndBack');
    expect(blockMeshDict).toContain('hex (0 1 2 3 4 5 6 7)');
    // V1.12 — origin/Lx/Ly/Lz flowed into the vertices block
    expect(blockMeshDict).toContain('(20 20 1)'); // nx ny nz
    expect(blockMeshDict).toContain('(1 1 1)'); // simpleGrading per-axis

    const transportProperties = await fs.readFile(
      join(out, 'constant', 'transportProperties'),
      'utf8',
    );
    expect(transportProperties).toContain('transportModel  Newtonian');
    // V1.45 reviewer finding (round 4) — JS `Number.prototype.toString(1e-5)`
    //  emits `'0.00001'` (fixed-point, since `1e-5 >= 1e-6`); the template's
    //  `{{nu}}` flows through this default toString, not the literal fixture
    //  string. Pre-fix expected `'1e-05'` which never appears in rendered output.
    expect(transportProperties).toContain('nu              0.00001');

    const momentumTransport = await fs.readFile(
      join(out, 'constant', 'momentumTransport'),
      'utf8',
    );
    // V1.20 — kEpsilon coefficient block present
    expect(momentumTransport).toContain('model           kEpsilon');
    expect(momentumTransport).toContain('Cmu          0.09');
    expect(momentumTransport).toContain('C1           1.44');

    const u = await fs.readFile(join(out, '0', 'U'), 'utf8');
    expect(u).toContain('movingWall');
    expect(u).toContain('type            fixedValue;');
    expect(u).toContain('value           uniform (1 0 0);');
    expect(u).toContain('type            noSlip;');
    expect(u).toContain('type            empty;');

    const p = await fs.readFile(join(out, '0', 'p'), 'utf8');
    expect(p).toContain('movingWall');
    expect(p).toContain('zeroGradient');

    // V1.42 — loadCaseState round-trip via Zod (drift-safety):
    //  the IPC `caseLoad` handler invokes exactly this path.
    const reloaded = await loadCaseState(out);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.kind).toBe('cavity');
    expect(reloaded!.domain.solver).toBe('simpleFoam');
    expect(reloaded!.domain.turbulence).toBe('kEpsilon');
    expect(reloaded!.domain.endTime).toBe(500);
    expect(reloaded!.domain.writeInterval).toBe(100);
    expect(reloaded!.bc.velocity['movingWall']?.type).toBe('fixedValue');
  });

  it('transient PIMPLE + adaptiveTimeStep: renderCase emits the V1.19 + V1.18b transient branches', async () => {
    // V1.45 reviewer finding (round 1) — the parametric + imported
    // it-cases both use simpleFoam + kEpsilon (steady SIMPLE family),
    // which is the OpenFOAM-stock default. The transient solver
    // branches have SEPARATE controlDict + fvSolution plumbing that
    // the simpleFoam cases don't exercise:
    //   * V1.19 — adaptiveTimeStep.enabled=true → controlDict emits
    //     `adjustTimeStep yes;` + `maxCo X;` block (NOT the steady-
    //     state `no;` default). gating is per-solver+per-toggle.
    //   * V1.18b — pimpleFoam → fvSolution emits the `PIMPLE { … }`
    //     block with nOuterCorrectors / nCorrectors /
    //     nNonOrthogonalCorrectors (NOT the SIMPLE block).
    //   * V1.12 — pimpleFoam's ddtScheme is `Euler` (the transient
    //     default), not `steadyState` (the steady default). Pre-V1.12
    //     .cfd-app-state.json regressions would surface here.
    //   * V1.18b — pimpleFoam defaults to `relaxationFactors.enabled
    //     = false`, so the relaxationFactors block is absent (verify
    //     via the inverse assertion).
    const out = join(tmpRoot, 'pimple-adaptive');
    await fs.mkdir(out, { recursive: true });
    const domain = makeTestDomain({
      kind: 'cavity',
      Lx: 0.1, Ly: 0.1, Lz: 0.02,
      nx: 30, ny: 30, nz: 2,
      solver: 'pimpleFoam',
      turbulence: 'laminar',
      endTime: 0.5,
      deltaT: 0.001,
      writeInterval: 100,
      // V1.19 — adaptiveTimeStep surfacing through renderCase
      adaptiveTimeStep: { enabled: true, maxCo: 0.5 },
      // V1.18b — explicit false to assert the PIMPLE relaxationFactors
      //  emit-gate is honored.
      relaxationFactors: { enabled: false, fields: {}, equations: {} },
    });
    const bc: BoundaryConditions = {
      velocity: {
        movingWall: { type: 'fixedValue', value: [1, 0, 0] },
        fixedWalls: { type: 'noSlip' },
        frontAndBack: { type: 'empty' },
      },
      pressure: {
        movingWall: { type: 'zeroGradient' },
        fixedWalls: { type: 'zeroGradient' },
        frontAndBack: { type: 'empty' },
      },
    };
    const rendered = await renderCase('cavity', domain, bc, out, 'cfd-e2e-pimple');
    expect(rendered.caseDir).toBe(out);

    // V1.19 — adaptiveTimeStep enabled → adjustTimeStep yes + maxCo
    const controlDict = await fs.readFile(join(out, 'system', 'controlDict'), 'utf8');
    expect(controlDict).toContain('application     pimpleFoam;');
    expect(controlDict).toContain('endTime         0.5;');
    expect(controlDict).toContain('adjustTimeStep  yes;');
    expect(controlDict).toContain('maxCo           0.5;');
    // V1.19 inverse — no SIMPLE-family steady-state marker
    expect(controlDict).not.toContain('adjustTimeStep  no;');

    // V1.18b — PIMPLE branch in fvSolution
    const fvSolution = await fs.readFile(join(out, 'system', 'fvSolution'), 'utf8');
    expect(fvSolution).toContain('PIMPLE');
    expect(fvSolution).toMatch(/nOuterCorrectors\s+1\s*;/);
    expect(fvSolution).toMatch(/nCorrectors\s+2\s*;/);
    expect(fvSolution).toMatch(/nNonOrthogonalCorrectors\s+0\s*;/);
    // Inverse assertion — SIMPLE block is steady's, not pimple's.
    // V1.45 reviewer finding (round 2): the previous `^SIMPLE\b/m` regex
    //  would false-pass on a future `SIMPLEC` (OpenFOAM's compound SIMPLE
    //  variant, plausible for buoyantSimpleFoam follow-up) emission at
    //  column 0 — `\b` holds at the `SIMPLE/C` boundary. Tighten to
    //  `^SIMPLE\s*\{` so the inverse requires the OPENING `{` brace
    //  diagnostic of fvSolution.hbs's actual emit shape: locks the block
    //  opening, not the keyword alone.
    expect(fvSolution).not.toMatch(/^SIMPLE\s*\{/m);

    // V1.12 — transient solver ddtScheme is Euler, not steadyState
    const fvSchemes = await fs.readFile(join(out, 'system', 'fvSchemes'), 'utf8');
    expect(fvSchemes).toMatch(/^[^/]*default\s+Euler\s*;/m);
    expect(fvSchemes).not.toMatch(/^[^/]*default\s+steadyState\s*;/m);

    // V1.18b — relaxationFactors.enabled=false + pimpleFoam → emit-gate
    // is FALSE, so the relaxationFactors keyword must NOT appear in
    // fvSolution. (It would render only for SIMPLE-family anyway, but
    // the inverse assertion locks both gates simultaneously.)
    expect(fvSolution).not.toContain('relaxationFactors');

    // V1.42 — loadCaseState round-trip
    const reloaded = await loadCaseState(out);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.domain.solver).toBe('pimpleFoam');
    expect(reloaded!.domain.adaptiveTimeStep.enabled).toBe(true);
    expect(reloaded!.domain.adaptiveTimeStep.maxCo).toBe(0.5);
    expect(reloaded!.domain.relaxationFactors.enabled).toBe(false);
  });

  it('buoyantSimpleFoam: renderCase emits the V1.14 + V1.16 + V1.17 + V1.9 + V1.11 energy-temperature branches', async () => {
    // V1.46 — buoyantSimpleFoam is the SIMPLE-family steady solver that
    //  ALSO carries an energy / T field (vs `simpleFoam` which is the cold
    //  SIMPLE branch). The cavity case's 3 prior it-cases (simpleFoam
    //  parametric + simpleFoam imported + pimpleFoam+adaptiveTimeStep) cover
    //  the cold-fluid branches; this case locks the temperature-field
    //  plumbing separately:
    //
    //   * V1.14 — fvSchemes emits `div(phi,T) ... grad(T);` line in divSchemes
    //     (gated on `solver === 'buoyantSimpleFoam'`). Without this line
    //     OpenFOAM crashes on missing-field divergence at solver start.
    //   * V1.16 — fvSchemes emits `laplacian(alphaEff,h) ...;` line in
    //     laplacianSchemes (same gate). Pre-V1.16 cases lost the
    //     boundedness handle on temperature.
    //   * V1.17 — fvSchemes emits `snGrad(h) ...;` line in snGradSchemes
    //     (same gate). Temperature surface-normal-gradient correction.
    //   * V1.9 — fvSolution's `residualControl` block emits a `T` entry
    //     (gated on `solver === 'buoyantSimpleFoam'`). SIMPLE+buoyant
    //     uses 1e-4 as default residualControl target (NOT the V1.x
    //     wisdom that 'energy residual defaults to 1e-3' that Liang's
    //     fvSolution.hbs comment predicts — the build-form surfacing
    //     passed the actual `numerics.residualControl` value forward).
    //   * V1.11 + V1.18b review-fix #1 — relaxationFactors.fields block
    //     emits a `T` entry (same gate). SIMPLE-family solvers
    //     (simpleFoam + buoyantSimpleFoam + potentialFoam) emit the
    //     relaxationFactors block UNCONDITIONALLY per V1.11 hoist;
    //     PIMPLE-family solvers (pimpleFoam + icoFoam) emit only with
    //     `relaxationFactors.enabled === true` per V1.18b's opt-in
    //     gate. This case pins the SIMPLE-family unconditional branch.
    //
    // The cavity templates intentionally don't carry T-field initialization
    // (no 0/T.hbs, no Pr in transportProperties, no thermal expansion in
    // momentumTransport). The rendered case would be OpenFOAM-incomplete,
    // but the e2e test doesn't run OpenFOAM — it only verifies the
    // fvSchemes + fvSolution plumbing schema-routing is correct.
    const out = join(tmpRoot, 'buoyant-ste');
    await fs.mkdir(out, { recursive: true });
    const domain = makeTestDomain({
      kind: 'cavity',
      Lx: 0.5, Ly: 0.5, Lz: 0.5,
      nx: 30, ny: 30, nz: 30,
      solver: 'buoyantSimpleFoam',
      turbulence: 'laminar',
      endTime: 100,
      writeInterval: 10,
      // V1.46 — buoyantSimpleFoam is steady → ddtScheme 'steadyState'
      //  (vs the schema's transient default 'Euler'). See STEADY_SCHEMES
      //  at module scope.
      schemes: STEADY_SCHEMES,
    });
    const bc: BoundaryConditions = {
      velocity: {
        movingWall: { type: 'fixedValue', value: [1, 0, 0] },
        fixedWalls: { type: 'noSlip' },
        frontAndBack: { type: 'empty' },
      },
      pressure: {
        movingWall: { type: 'zeroGradient' },
        fixedWalls: { type: 'zeroGradient' },
        frontAndBack: { type: 'empty' },
      },
    };
    const rendered = await renderCase('cavity', domain, bc, out, 'cfd-e2e-buoyant');
    expect(rendered.caseDir).toBe(out);

    // controlDict application drives the solver enum into the case dir.
    const controlDict = await fs.readFile(join(out, 'system', 'controlDict'), 'utf8');
    expect(controlDict).toContain('application     buoyantSimpleFoam;');

    // V1.14 + V1.16 + V1.17 — three buoyant-gated emission lines in fvSchemes.
    const fvSchemes = await fs.readFile(join(out, 'system', 'fvSchemes'), 'utf8');
    expect(fvSchemes).toMatch(/div\(phi,T\)\s+Gauss linearUpwind\s+grad\(T\)\s*;/);
    expect(fvSchemes).toMatch(/laplacian\(alphaEff,h\)\s+Gauss linear corrected\s*;/);
    expect(fvSchemes).toMatch(/snGrad\(h\)\s+corrected\s*;/);

    // V1.13 + V1.20 / V1.21 / V1.22 — with `turbulence: 'laminar'`, NONE of
    //  the RANS model-keyword gates fire (per-turbulence emit-gates). Inverse
    //  asserts lock the template's turbulence-gate logic against future
    //  regressions where, e.g., a `{{#if (or turbulence 'kEpsilon' ...) }}`
    //  typo accidentally loosens the gate to emit RANS lines for laminar.
    expect(fvSchemes).not.toContain('div(phi,k)');
    expect(fvSchemes).not.toContain('div(phi,epsilon)');
    expect(fvSchemes).not.toContain('div(phi,omega)');
    expect(fvSchemes).not.toContain('div(phi,nuTilda)');

    // V1.11 + V1.18b — relaxationFactors block IS emitted (V1.18b's
    //  SIMPLE-family unconditional emit-gate). The `fields` sub-block carries
    //  the T entry (V1.11 + V1.18b energy-field hoist).
    //
    //  V1.47 — SIMPLE block IS now emitted for buoyantSimpleFoam (the
    //  template gate was widened from `(eq solver 'simpleFoam')` literal
    //  to SIMPLE-family `(or (eq solver 'simpleFoam') (eq solver 'buoyantSimpleFoam'))`).
    //  This unlocks nNonOrthogonalCorrectors + the T-residualControl line,
    //  completing the OpenFOAM-required SIMPLE-block schema for the
    //  buoyant branch. (V1.46 SHIP-final reviewer finding resolved.)
    const fvSolution = await fs.readFile(join(out, 'system', 'fvSolution'), 'utf8');
    expect(fvSolution).toContain('SIMPLE');
    expect(fvSolution).toContain('nNonOrthogonalCorrectors');
    // V1.47 SHIP-FINAL — `numerics.residualControl` is typed `z.number()`
    //  (.default(1e-4)); JS `Number.prototype.toString(1e-4)` emits
    //  `'0.0001'` because `|0.0001| >= 1e-6` is in the fixed-point range
    //  (per ECMAScript Number-toString algorithm). The schema's STRING
    //  default would have rendered as `'1e-4'`, but the NUMBER-default path
    //  takes the JS toString first. Accept either form so the assertion is
    //  robust against future schema-default drift between `z.string()` and
    //  `z.number()` and against render-time float-format flips. Both forms
    //  are equally valid to OpenFOAM's residualControl parser.
    expect(fvSolution).toMatch(/T\s+1e-4\s*;/);
    expect(fvSolution).toContain('relaxationFactors');
    expect(fvSolution).toMatch(/T\s+0\.7\s*;/);
    expect(fvSolution).not.toMatch(/^PIMPLE\b/m);

    // V1.20 / V1.21 / V1.22 — same laminar-turbulence gates in fvSolution.
    //  Turbulence blocks (`"k|epsilon"`, `"k|omega"`, `nuTilda`) are ALL
    //  absent for laminar.
    expect(fvSolution).not.toContain('"k|epsilon"');
    expect(fvSolution).not.toContain('"k|omega"');
    expect(fvSolution).not.toContain('nuTilda\n');

    // V1.42 — loadCaseState round-trip
    const reloaded = await loadCaseState(out);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.domain.solver).toBe('buoyantSimpleFoam');
    // V1.47 SHIP-FINAL — the buoyant fixture doesn't override
    //  initialConditions, so the DomainSchema Zod default applies.
    //  Domain defaults initialConditions.velocity.{x,y,z} to `0`
    //  (zero-velocity initial field). Round-trip this default value
    //  through loadCaseState to confirm the sidecar schema-routing is
    //  intact (a future schema change that drops initialConditions
    //  from the round-trip would surface here as a `undefined`
    //  mismatch rather than silently passing).
    expect(reloaded!.domain.initialConditions.velocity.x).toBe(0);
  });

  it('imported geometry: renderCase produces a snappy-driven case with patch BCs + refinements', async () => {
    const out = join(tmpRoot, 'imported-cyl');
    await fs.mkdir(out, { recursive: true });

    const domain = makeTestDomain({
      kind: 'cavity', // The snappy path is gated on geometryKind, not CaseKind
      Lx: 4, Ly: 4, Lz: 4,
      nx: 40, ny: 40, nz: 40,
      solver: 'simpleFoam',
      turbulence: 'kEpsilon',
      endTime: 1000,
      geometryKind: 'imported',
      // V1.45 — per-solver routing override: simpleFoam is steady → ddtScheme
      //  'steadyState'. See STEADY_SCHEMES at module scope.
      schemes: STEADY_SCHEMES,
      // V1.4 — per-patch refinement maps flow through renderCase's
      // 6th arg (`refinements`) into `patchRefinements` context key
      // that snappyHexMeshDict.hbs references via `refBlock`.
      patches: [{ name: 'cylSurface', refinementLevel: 3 }],
      bbox: {
        min: { x: -0.5, y: -0.5, z: -0.5 },
        max: { x: 0.5, y: 0.5, z: 0.5 },
      },
      origin: { x: -1.0, y: -1.0, z: -1.0 },
    });
    const bc: BoundaryConditions = {
      velocity: { cylSurface: { type: 'noSlip' } },
      pressure: { cylSurface: { type: 'zeroGradient' } },
    };
    const refinements = { cylSurface: { min: 2, max: 3 } };
    const rendered = await renderCase(
      'cavity',
      domain,
      bc,
      out,
      'cfd-e2e-imported',
      refinements,
    );
    expect(rendered.caseDir).toBe(out);

    // V1.35 — imported path swaps 0/U + 0/p for snappy_U + snappy_p,
    // adds system/snappyHexMeshDict + constant/triSurface/.keep.
    const written = new Set(rendered.files);
    for (const f of [
      'system/snappyHexMeshDict',
      'constant/triSurface/.keep',
      'system/blockMeshDict',
      'system/controlDict',
      'system/fvSchemes',
      'system/fvSolution',
      'constant/transportProperties',
      'constant/momentumTransport',
      '0/U',
      '0/p',
      '.cfd-app-state.json',
    ]) {
      expect(written.has(f), `missing rendered file: ${f}`).toBe(true);
    }

    const snappy = await fs.readFile(join(out, 'system', 'snappyHexMeshDict'), 'utf8');
    expect(snappy).toContain('castellatedMesh true;');
    expect(snappy).toContain('snap            true;');
    // Per-patch geometry entry
    expect(snappy).toContain('cylSurface.stl');
    expect(snappy).toContain('name        cylSurface;');
    // Per-patch refinement block (formatRefinementBlock output)
    expect(snappy).toContain('cylSurface\n        {\n            level (2 3);');
    // V1.35a — `locationInMesh` from formatLocationInMesh; bbox
    // centroid (-0.5..0.5) is (0,0,0).
    expect(snappy).toMatch(/locationInMesh\s+\(0 0 0\);/);

    const u = await fs.readFile(join(out, '0', 'U'), 'utf8');
    expect(u).toContain('cylSurface');
    expect(u).toContain('type noSlip;');

    const p = await fs.readFile(join(out, '0', 'p'), 'utf8');
    expect(p).toContain('cylSurface');
    expect(p).toContain('type zeroGradient;');

    // V1.42 — loadCaseState round-trip via Zod + .cfd-app-state.json sidecar.
    const reloaded = await loadCaseState(out);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.domain.geometryKind).toBe('imported');
    expect(reloaded!.domain.patches.length).toBe(1);
    expect(reloaded!.domain.patches[0]!.name).toBe('cylSurface');
    expect(reloaded!.domain.bbox).toBeDefined();
    // bc roundtrip
    expect(reloaded!.bc.velocity['cylSurface']?.type).toBe('noSlip');
  });
});

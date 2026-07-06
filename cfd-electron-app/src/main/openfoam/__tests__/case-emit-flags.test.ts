/**
 * V1.38b — vitest suite for the 2 precomputed per-template emit
 *  booleans lifted from src/main/openfoam/case-helpers.ts (V1.41
 *  re-homed them into @main/openfoam/case-emit-flags):
 *    * shouldEmitRelaxationFactors — V1.18b precomputed boolean
 *      for fvSolution's relaxationFactors block. SIMPLE-family
 *      solvers emit unconditionally; pimpleFoam gates on the
 *      `relaxationFactors.enabled` toggle; icoFoam never emits.
 *    * shouldEmitAdaptiveTimeStep — V1.19 precomputed boolean for
 *      controlDict's `adjustTimeStep yes;` block. SIMPLE-family
 *      solvers never emit (OpenFOAM ignores the field on
 *      steady-state); pimpleFoam + icoFoam honor the toggle.
 *
 *  Mirrors the V1.37a/V1.37c test-file structures: pure-fn tests,
 *  no electron, no fs, no Handlebars. The 2 emit booleans are
 *  fully `Domain → boolean`, so the suite exercises them with
 *  per-solver + per-enabled-flag permutations.
 */
import { describe, it, expect } from 'vitest';
import {
  shouldEmitAdaptiveTimeStep,
  shouldEmitRelaxationFactors,
} from '../case-emit-flags';
// V1.41 — the Domain fixture lives in a shared test helper
//  (case-test-helpers.ts) so the 3 case-ts test files don't
//  triplicate the 50-line `makeTestDomain` body. Tests
//  override individual fields to exercise the per-solver
//  routing of shouldEmitRelaxationFactors +
//  shouldEmitAdaptiveTimeStep.
import { makeTestDomain } from './case-test-helpers';

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

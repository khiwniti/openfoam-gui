/**
 * V1.41 — shared test fixture for the case.ts pure-fn suite.
 *
 * The `makeTestDomain` helper builds a minimal valid Domain
 *  suitable for the case-formatters / case-emit-flags /
 *  case-context unit tests. It was triplicated across the
 *  3 focused test files after V1.41's case-helpers.ts split
 *  (the V1.38 / V1.38b test file was a single-file suite
 *  that didn't need to share its fixture). V1.41 lifts the
 *  helper here so:
 *    * the Domain shape lives in exactly one place (a
 *      future V1.42 adding a new Domain field updates the
 *      fixture in 1 place, not 3);
 *    * the 3 focused test files shrink back to pure test
 *      bodies, with the build-step noise removed;
 *    * the helper is colocated with the case.ts test
 *      directory so the test file → fixture file lookup
 *      stays obvious for future maintainers.
 *
 * Mirrors the OpenFOAM-cavity defaults from the
 *  SOLVER_CONTROLS_DEFAULTS map in the renderer's Zustand
 *  store; specific tests override individual fields to
 *  exercise the per-solver routing of
 *  shouldEmitRelaxationFactors + shouldEmitAdaptiveTimeStep
 *  and the snappy-driven `origin` / `bbox` branches of
 *  buildRenderContext.
 */
import type { Domain } from '@shared/types';

export function makeTestDomain(overrides: Partial<Domain> = {}): Domain {
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

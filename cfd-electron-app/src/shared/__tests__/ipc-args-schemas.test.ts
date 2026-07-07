/**
 * V1.40 — drift-safety-pair tests for the 7 IPC envelope schemas
 *  lifted from src/main/ipc/index.ts's previously-inline
 *  `z.object({...}).parse(args)` calls into named @shared/types
 *  schemas. Mirrors the V1.35c / V1.36c / V1.36f test-file
 *  structure (src/shared/__tests__/):
 *    * src/shared/__tests__/run-payload-schemas.test.ts (V1.31a)
 *    * src/shared/__tests__/verify-bashrc-args.test.ts (V1.36c)
 *    * src/shared/__tests__/run-cancel-args.test.ts (V1.36f)
 *    * src/shared/__tests__/ipc-args-schemas.test.ts (V1.40 -- this file)
 *
 *  The named schemas let vitest exercise the wire-format contract
 *  without pulling in Electron's `ipcMain` (the IPC barrel imports
 *  electron at module-load, which crashes vitest's node env).
 *  Each test pins the happy path + the missing-key + wrong-type
 *  edge cases; the case-flow schemas (CaseCreateArgsSchema +
 *  CaseSaveArgsSchema) additionally pin the extra-key-silently-
 *  strip behavior (non-strict by convention) so a future
 *  `.strict()` migration (intentional or accidental) gets caught
 *  before it ships.
 */
import { describe, it, expect } from 'vitest';
import {
  CaseCreateArgsSchema,
  CaseLoadArgsSchema,
  CaseSaveArgsSchema,
  ResultsListArgsSchema,
  ResultsListFieldsArgsSchema,
  ResultsOpenVTKDirArgsSchema,
  ResultsRevealVTKArgsSchema,
} from '../types';

const CASE_DIR = '/home/user/CFDStudio/runs/cavity__2025-01-01T00-00-00';

const SAMPLE_DOMAIN = {
  kind: 'cavity' as const,
  Lx: 1, Ly: 1, Lz: 1,
  nx: 20, ny: 20, nz: 20,
  nu: 1e-5, rho: 1.2,
  solver: 'icoFoam' as const,
  turbulence: 'laminar' as const,
  endTime: 1, deltaT: 0.001, writeInterval: 100,
  purgeWrite: 0,
  numerics: {
    enabled: true,
    nNonOrthogonalCorrectors: 0,
    nCorrectors: 2,
    nOuterCorrectors: 1,
    residualControl: '1e-4',
    residualControlByField: {},
  },
  schemes: {
    ddtDefault: 'Euler' as const,
    gradDefault: 'Gauss linear' as const,
    divDefault: 'none' as const,
    laplacianDefault: 'Gauss linear corrected' as const,
    interpolationDefault: 'linear' as const,
    snGradDefault: 'corrected' as const,
    fieldDivs: {},
    fieldLaplacians: {},
    fieldSnGrads: {},
  },
  solverConfigs: {
    p: { solver: 'GAMG' as const, tolerance: 1e-7, relTol: 0.01 },
    U: { solver: 'smoothSolver' as const, tolerance: 1e-7, relTol: 0.1 },
    turbulence: { solver: 'smoothSolver' as const, tolerance: 1e-7, relTol: 0.1 },
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
  geometryKind: 'parametric' as const,
  patches: [],
};

const SAMPLE_BC = { velocity: {}, pressure: {} };

describe('CaseCreateArgsSchema', () => {
  it("parses a happy-path payload with all 5 fields populated", () => {
    const parsed = CaseCreateArgsSchema.parse({
      kind: 'cavity',
      domain: SAMPLE_DOMAIN,
      bc: SAMPLE_BC,
      label: 'my-cavity',
      refinements: { wall: { min: 2, max: 4 } },
    });
    expect(parsed.kind).toBe('cavity');
    expect(parsed.label).toBe('my-cavity');
    expect(parsed.refinements).toEqual({ wall: { min: 2, max: 4 } });
  });

  it("parses a minimal payload with optional fields omitted (label + refinements fall through to defaults)", () => {
    const parsed = CaseCreateArgsSchema.parse({
      kind: 'cavity',
      domain: SAMPLE_DOMAIN,
      bc: SAMPLE_BC,
    });
    expect(parsed.label).toBeUndefined();
    expect(parsed.refinements).toBeUndefined();
  });

  it("rejects a missing `kind` field", () => {
    expect(() => CaseCreateArgsSchema.parse({
      domain: SAMPLE_DOMAIN,
      bc: SAMPLE_BC,
    })).toThrow();
  });

  it("rejects a wrong-typed `kind` field (string outside the CaseKindSchema enum)", () => {
    expect(() => CaseCreateArgsSchema.parse({
      kind: 'not-a-case-kind',
      domain: SAMPLE_DOMAIN,
      bc: SAMPLE_BC,
    })).toThrow();
  });

  it("silently strips extra unknown keys (non-strict by convention)", () => {
    // The schema is intentionally non-strict so a future renderer
    //  metadata key (e.g., a `version` field) silently strips
    //  rather than throwing. A future `.strict()` migration
    //  (intentional or accidental) would make this test fail.
    const parsed = CaseCreateArgsSchema.parse({
      kind: 'cavity',
      domain: SAMPLE_DOMAIN,
      bc: SAMPLE_BC,
      futureMetadata: { version: 2 },
    });
    expect((parsed as Record<string, unknown>).futureMetadata).toBeUndefined();
  });
});

describe('CaseSaveArgsSchema', () => {
  it("parses a happy-path payload with all 5 fields populated", () => {
    const parsed = CaseSaveArgsSchema.parse({
      caseDir: CASE_DIR,
      kind: 'cavity',
      domain: SAMPLE_DOMAIN,
      bc: SAMPLE_BC,
      refinements: { wall: { min: 2, max: 4 } },
    });
    expect(parsed.caseDir).toBe(CASE_DIR);
    expect(parsed.kind).toBe('cavity');
    expect(parsed.refinements).toEqual({ wall: { min: 2, max: 4 } });
  });

  it("rejects a missing `caseDir` field (required, no default)", () => {
    expect(() => CaseSaveArgsSchema.parse({
      kind: 'cavity',
      domain: SAMPLE_DOMAIN,
      bc: SAMPLE_BC,
    })).toThrow();
  });

  it("silently strips extra unknown keys (non-strict by convention)", () => {
    const parsed = CaseSaveArgsSchema.parse({
      caseDir: CASE_DIR,
      kind: 'cavity',
      domain: SAMPLE_DOMAIN,
      bc: SAMPLE_BC,
      futureRendererKey: true,
    });
    expect((parsed as Record<string, unknown>).futureRendererKey).toBeUndefined();
  });
});

describe('CaseLoadArgsSchema', () => {
  it("parses a happy-path payload with caseDir", () => {
    expect(CaseLoadArgsSchema.parse({ caseDir: CASE_DIR })).toEqual({ caseDir: CASE_DIR });
  });

  it("rejects a missing `caseDir` field", () => {
    expect(() => CaseLoadArgsSchema.parse({})).toThrow();
  });

  it("rejects a wrong-typed `caseDir` field (number instead of string)", () => {
    expect(() => CaseLoadArgsSchema.parse({ caseDir: 42 })).toThrow();
  });
});

describe('ResultsListArgsSchema', () => {
  it("parses a happy-path payload with caseDir", () => {
    expect(ResultsListArgsSchema.parse({ caseDir: CASE_DIR })).toEqual({ caseDir: CASE_DIR });
  });

  it("rejects a missing `caseDir` field", () => {
    expect(() => ResultsListArgsSchema.parse({})).toThrow();
  });
});

describe('ResultsListFieldsArgsSchema', () => {
  it("parses a happy-path payload with caseDir + numeric time", () => {
    // `time` is a number (not a string) because the renderer
    //  surfaces time directories as a parsed number list via
    //  `parseResultTimes` and the wire sends back the same
    //  numeric value; the `path.join(caseDir, String(time), field)`
    //  in `parseResultFields` does the textual coercion.
    expect(ResultsListFieldsArgsSchema.parse({ caseDir: CASE_DIR, time: 0.5 })).toEqual({
      caseDir: CASE_DIR,
      time: 0.5,
    });
  });

  it("rejects a string-typed `time` field (the schema is strict on number)", () => {
    expect(() => ResultsListFieldsArgsSchema.parse({ caseDir: CASE_DIR, time: '0.5' })).toThrow();
  });

  it("rejects a missing `time` field", () => {
    expect(() => ResultsListFieldsArgsSchema.parse({ caseDir: CASE_DIR })).toThrow();
  });
});

describe('ResultsRevealVTKArgsSchema', () => {
  it("parses a happy-path payload with caseDir", () => {
    expect(ResultsRevealVTKArgsSchema.parse({ caseDir: CASE_DIR })).toEqual({ caseDir: CASE_DIR });
  });

  it("rejects a missing `caseDir` field", () => {
    expect(() => ResultsRevealVTKArgsSchema.parse({})).toThrow();
  });
});

describe('ResultsOpenVTKDirArgsSchema', () => {
  it("parses a happy-path payload with caseDir", () => {
    expect(ResultsOpenVTKDirArgsSchema.parse({ caseDir: CASE_DIR })).toEqual({ caseDir: CASE_DIR });
  });

  it("rejects a missing `caseDir` field", () => {
    expect(() => ResultsOpenVTKDirArgsSchema.parse({})).toThrow();
  });
});

/**
 * V1.27 -- Zod smoke tests for the 6 turbulence-coefficient schemas
 *  added across the V1.20-V1.25 arc, plus the TurbulenceModelSchema
 *  enum and the V1.26 LES_TURBULENCE_TYPES `as const satisfies`
 *  source-of-truth lock.
 *
 *  Why these exist: the schemas are the contract between the renderer's
 *  Build Case form (PatchPanel.tsx coefficient blocks), the Zustand
 *  store (SOLVER_CONTROLS_DEFAULTS seed values), and the
 *  momentumTransport.hbs Handlebars template. Any drift between the
 *  three (e.g. the form sets a coefficient to a value the schema then
 *  rejects at parse time, or the schema drops a field the form still
 *  writes) surfaces as a silent runtime regression. These tests pin
 *  the schema's contract so future V.x changes land with the same
 *  baseline guarantee.
 *
 *  Test coverage matrix per schema:
 *    - `parses empty input → OpenFOAM stock defaults` (Zod default chain
 *      is exercised, catches dropped `.default(...)` clauses).
 *    - `parses full explicit input` (positive path; field shape stays
 *      in sync with `type KEpsilonCoefficients = z.infer<...>` etc.).
 *    - `rejects zero / negative / NaN` (positive-number invariant;
 *      catches accidental flip of `z.number().positive()` to
 *      `z.number()`).
 *    - `rejects above bounds` -- bound-bearing schemas only (KEqn Ck
 *      ≤ 1, KEqn Ce1 / Ce2 ≤ 5, CDES CDES ≤ 5). Catches the
 *      V1.24 / V1.25 review-fix-pass `.max(...)` clauses being
 *      dropped on a future refactor.
 *
 *  Plus V1.23-V1.25 TurbulenceModelSchema (11 enum values, wrong
 *  literal rejected) + V1.26 LES_TURBULENCE_TYPES lock (the
 *  `satisfies` clause compiles to a type assertion; if a future change
 *  drops the const from one side of the lock, TypeScript reports an
 *  error at this test file's import).
 */
import { describe, expect, it } from 'vitest';

import {
  CDESCoefficientSchema,
  KEpsilonCoefficientsSchema,
  KEqnCoefficientsSchema,
  KOmegegaSSTCoefficientsSchema,
  LES_TURBULENCE_TYPES,
  LESCoefficientsSchema,
  SpalartAllmarasCoefficientsSchema,
  TurbulenceModelSchema,
} from './types';

// ---------- KEpsilonCoefficients (V1.20 k-ε) ----------

describe('KEpsilonCoefficientsSchema', () => {
  it('parses empty input → OpenFOAM stock defaults (Cmu 0.09, C1 1.44, C2 1.92, sigmak 1.0, sigmaEps 1.3)', () => {
    const out = KEpsilonCoefficientsSchema.parse({});
    expect(out).toEqual({
      Cmu: 0.09,
      C1: 1.44,
      C2: 1.92,
      sigmak: 1.0,
      sigmaEps: 1.3,
    });
  });

  it('parses full explicit input', () => {
    const out = KEpsilonCoefficientsSchema.parse({
      Cmu: 0.12,
      C1: 1.5,
      C2: 2.0,
      sigmak: 1.1,
      sigmaEps: 1.4,
    });
    expect(out.Cmu).toBe(0.12);
    expect(out.C1).toBe(1.5);
    expect(out.C2).toBe(2.0);
    expect(out.sigmak).toBe(1.1);
    expect(out.sigmaEps).toBe(1.4);
  });

  it('rejects zero', () => {
    expect(() => KEpsilonCoefficientsSchema.parse({ Cmu: 0 })).toThrow();
  });

  it('rejects negative', () => {
    expect(() => KEpsilonCoefficientsSchema.parse({ C1: -1 })).toThrow();
  });

  it('rejects NaN', () => {
    expect(() => KEpsilonCoefficientsSchema.parse({ C2: NaN })).toThrow();
  });

  it('rejects non-numeric input', () => {
    expect(() =>
      KEpsilonCoefficientsSchema.parse({ sigmak: '1.0' as unknown as number }),
    ).toThrow();
  });
});

// ---------- KOmegegaSSTCoefficients (V1.21 k-ω SST) ----------

describe('KOmegegaSSTCoefficientsSchema', () => {
  it('parses empty input → OpenFOAM Menter 2009 stock defaults', () => {
    const out = KOmegegaSSTCoefficientsSchema.parse({});
    expect(out.alphaK1).toBeCloseTo(0.85);
    expect(out.alphaK2).toBeCloseTo(1.0);
    expect(out.alphaOmega1).toBeCloseTo(0.5);
    expect(out.alphaOmega2).toBeCloseTo(0.856);
    expect(out.beta1).toBeCloseTo(0.075);
    expect(out.beta2).toBeCloseTo(0.0828);
    expect(out.betaStar).toBeCloseTo(0.09);
    expect(out.C1).toBeCloseTo(2.0);
    expect(out.gamma1).toBeCloseTo(0.5555555555);
    expect(out.gamma2).toBeCloseTo(0.875);
    expect(out.sigmaK).toBeCloseTo(0.6);
    expect(out.sigmaOmega).toBeCloseTo(0.5);
  });

  it('parses full explicit input', () => {
    const out = KOmegegaSSTCoefficientsSchema.parse({
      alphaK1: 0.9,
      alphaK2: 1.1,
      alphaOmega1: 0.55,
      alphaOmega2: 0.9,
      beta1: 0.08,
      beta2: 0.09,
      betaStar: 0.1,
      C1: 2.1,
      gamma1: 0.6,
      gamma2: 0.9,
      sigmaK: 0.65,
      sigmaOmega: 0.55,
    });
    expect(out.alphaK1).toBeCloseTo(0.9);
    expect(out.sigmaOmega).toBeCloseTo(0.55);
  });

  it('rejects zero', () => {
    expect(() =>
      KOmegegaSSTCoefficientsSchema.parse({ alphaK1: 0 }),
    ).toThrow();
  });

  it('rejects negative', () => {
    expect(() =>
      KOmegegaSSTCoefficientsSchema.parse({ betaStar: -0.01 }),
    ).toThrow();
  });
});

// ---------- SpalartAllmarasCoefficients (V1.22 SA) ----------

describe('SpalartAllmarasCoefficientsSchema', () => {
  it('parses empty input → OpenFOAM 1994 + Pirzadeh 1999 stock defaults', () => {
    const out = SpalartAllmarasCoefficientsSchema.parse({});
    expect(out.sigmaNut).toBeCloseTo(0.667);
    expect(out.kappa).toBeCloseTo(0.41);
    expect(out.Cb1).toBeCloseTo(0.1355);
    expect(out.Cb2).toBeCloseTo(0.622);
    expect(out.Cw1).toBeCloseTo(0.3);
    expect(out.Cw2).toBeCloseTo(0.06);
    expect(out.Cw3).toBeCloseTo(2.0);
    expect(out.Cv1).toBeCloseTo(7.1);
    expect(out.Cv2).toBeCloseTo(5.0);
  });

  it('parses full explicit input', () => {
    const out = SpalartAllmarasCoefficientsSchema.parse({
      sigmaNut: 0.7,
      kappa: 0.42,
      Cb1: 0.14,
      Cb2: 0.7,
      Cw1: 0.4,
      Cw2: 0.07,
      Cw3: 2.1,
      Cv1: 7.5,
      Cv2: 5.5,
    });
    expect(out.Cb1).toBeCloseTo(0.14);
    expect(out.Cw3).toBeCloseTo(2.1);
  });

  it('rejects zero (any field)', () => {
    expect(() =>
      SpalartAllmarasCoefficientsSchema.parse({ Cw1: 0 }),
    ).toThrow();
    expect(() =>
      SpalartAllmarasCoefficientsSchema.parse({ kappa: 0 }),
    ).toThrow();
  });
});

// ---------- LESCoefficients (V1.23 LES — Cs / Cw) ----------

describe('LESCoefficientsSchema', () => {
  it('parses empty input → OpenFOAM Smagorinsky 0.2 + WALE 0.325 defaults', () => {
    const out = LESCoefficientsSchema.parse({});
    expect(out.Cs).toBeCloseTo(0.2);
    expect(out.Cw).toBeCloseTo(0.325);
  });

  it('parses full explicit input', () => {
    const out = LESCoefficientsSchema.parse({ Cs: 0.18, Cw: 0.35 });
    expect(out.Cs).toBeCloseTo(0.18);
    expect(out.Cw).toBeCloseTo(0.35);
  });

  it('rejects zero (Smagorinsky Cs)', () => {
    expect(() => LESCoefficientsSchema.parse({ Cs: 0 })).toThrow();
  });

  it('rejects zero (WALE Cw)', () => {
    expect(() => LESCoefficientsSchema.parse({ Cw: 0 })).toThrow();
  });
});

// ---------- KEqnCoefficients (V1.24 k-equation LES with bounds) ----------

describe('KEqnCoefficientsSchema', () => {
  it('parses empty input → OpenFOAM stock (Ck 0.094, Ce1 1.048, Ce2 1.048)', () => {
    const out = KEqnCoefficientsSchema.parse({});
    expect(out.Ck).toBeCloseTo(0.094);
    expect(out.Ce1).toBeCloseTo(1.048);
    expect(out.Ce2).toBeCloseTo(1.048);
  });

  it('parses well-tested values inside the documented ranges', () => {
    const out = KEqnCoefficientsSchema.parse({ Ck: 0.094, Ce1: 1.048, Ce2: 1.048 });
    expect(out.Ck).toBeCloseTo(0.094);
  });

  it('rejects Ck > 1.0 (V1.24 review-fix `.max(1)` bound)', () => {
    // Ck 1.1 exceeds PatchPanel's `max=1` ceiling (V1.24's gradient-
    // filter coefficient ceiling). Without the `.max(1)` clause the
    // form's <input max="1"> could soft-silently clip a user's value
    // while the schema still accepted it.
    expect(() => KEqnCoefficientsSchema.parse({ Ck: 1.1 })).toThrow();
  });

  it('accepts Ck = 1.0 (boundary)', () => {
    const out = KEqnCoefficientsSchema.parse({ Ck: 1.0 });
    expect(out.Ck).toBe(1.0);
  });

  it('rejects Ce1 > 5 (V1.24 review-fix `.max(5)` bound)', () => {
    expect(() => KEqnCoefficientsSchema.parse({ Ce1: 5.1 })).toThrow();
  });

  it('rejects Ce2 > 5 (V1.24 review-fix `.max(5)` bound)', () => {
    expect(() => KEqnCoefficientsSchema.parse({ Ce2: 5.1 })).toThrow();
  });

  it('accepts Ce1 = 5 (boundary)', () => {
    const out = KEqnCoefficientsSchema.parse({ Ce1: 5 });
    expect(out.Ce1).toBe(5);
  });

  it('rejects zero', () => {
    expect(() => KEqnCoefficientsSchema.parse({ Ck: 0 })).toThrow();
  });
});

// ---------- CDESCoefficient (V1.25 DES shielding) ----------

describe('CDESCoefficientSchema', () => {
  it('parses empty input → OpenFOAM Shur+Spalart+Strelets 2008 stock 0.65', () => {
    const out = CDESCoefficientSchema.parse({});
    expect(out.CDES).toBeCloseTo(0.65);
  });

  it('accepts values inside the well-tested [0.50, 0.85] range', () => {
    const atLow = CDESCoefficientSchema.parse({ CDES: 0.5 });
    const atHigh = CDESCoefficientSchema.parse({ CDES: 0.85 });
    expect(atLow.CDES).toBe(0.5);
    expect(atHigh.CDES).toBe(0.85);
  });

  it('rejects CDES > 5 (V1.25 review-fix `.max(5)` bound)', () => {
    expect(() => CDESCoefficientSchema.parse({ CDES: 5.1 })).toThrow();
  });

  it('rejects CDES = 0 (positive invariant)', () => {
    expect(() => CDESCoefficientSchema.parse({ CDES: 0 })).toThrow();
  });

  it('rejects negative CDES', () => {
    expect(() => CDESCoefficientSchema.parse({ CDES: -0.1 })).toThrow();
  });

  it('rejects NaN', () => {
    expect(() => CDESCoefficientSchema.parse({ CDES: NaN })).toThrow();
  });
});

// ---------- TurbulenceModelSchema (V1.23 / V1.25 enum union) ----------

describe('TurbulenceModelSchema', () => {
  it('parses every legitimate enum value (11 variants)', () => {
    const all = TurbulenceModelSchema.options;
    expect(all).toHaveLength(11);
    for (const v of all) {
      expect(() => TurbulenceModelSchema.parse(v)).not.toThrow();
    }
  });

  it('accepts the canonical 4 ARP/RANS/LES plumbing values', () => {
    expect(TurbulenceModelSchema.parse('laminar')).toBe('laminar');
    expect(TurbulenceModelSchema.parse('kEpsilon')).toBe('kEpsilon');
    expect(TurbulenceModelSchema.parse('kOmegaSST')).toBe('kOmegaSST');
    expect(TurbulenceModelSchema.parse('SpalartAllmaras')).toBe('SpalartAllmaras');
  });

  it('accepts the V1.23 static-LES pair', () => {
    expect(TurbulenceModelSchema.parse('Smagorinsky')).toBe('Smagorinsky');
    expect(TurbulenceModelSchema.parse('WALE')).toBe('WALE');
  });

  it('accepts the V1.24 k-equation LES variant', () => {
    expect(TurbulenceModelSchema.parse('kEqn')).toBe('kEqn');
  });

  it('accepts the V1.25 dyn-LES + DES quartet', () => {
    expect(TurbulenceModelSchema.parse('dynamicSmagorinsky')).toBe(
      'dynamicSmagorinsky',
    );
    expect(TurbulenceModelSchema.parse('dynamicLagrangian')).toBe(
      'dynamicLagrangian',
    );
    expect(TurbulenceModelSchema.parse('SpalartAllmarasDES')).toBe(
      'SpalartAllmarasDES',
    );
    expect(TurbulenceModelSchema.parse('kOmegaSSTDES')).toBe('kOmegaSSTDES');
  });

  it('rejects unknown strings', () => {
    expect(() => TurbulenceModelSchema.parse('LES')).toThrow();
    expect(() => TurbulenceModelSchema.parse('LESv2')).toThrow();
    expect(() => TurbulenceModelSchema.parse('')).toThrow();
  });

  it('rejects non-string input', () => {
    expect(() =>
      TurbulenceModelSchema.parse(42 as unknown as string),
    ).toThrow();
  });
});

// ---------- V1.26 LES_TURBULENCE_TYPES source-of-truth lock ----------

describe('LES_TURBULENCE_TYPES (V1.26 satisfies-clause source-of-truth lock)', () => {
  // V1.27 review-fix — single source-of-truth assertion. The compile-
  //  time `as const satisfies readonly TurbulenceModel[]` on the const
  //  declaration already locks (a) the literal entries are members of
  //  the TurbulenceModel enum and (b) `as const` makes the array
  //  readonly at the type level. So the runtime checks collapse to
  //  one canonical equality assertion (canonical order is the only
  //  remaining free parameter — the compile-time lock would also pass
  //  if someone reordered the entries intentionally, which we want to
  //  catch explicitly).
  it('lists the V1.23 / V1.24 / V1.25 entries in canonical order', () => {
    expect(LES_TURBULENCE_TYPES).toEqual([
      'Smagorinsky',
      'WALE',
      'kEqn',
      'dynamicSmagorinsky',
      'dynamicLagrangian',
      'SpalartAllmarasDES',
      'kOmegaSSTDES',
    ]);
  });
});

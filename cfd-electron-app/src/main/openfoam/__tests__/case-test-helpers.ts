/**
 * V1.42 — schema-derivative test fixture for the case.ts
 *  pure-fn suite.
 *
 * V1.41 extracted the triplicated `makeTestDomain` helper
 *  from the 3 case.ts test files into this shared module.
 *  The V1.41 extraction was a 50-LOC hardcoded object that
 *  duplicated the Domain shape — a schema-snapshot. V1.42
 *  converts it to a schema-derivation: the helper now passes
 *  a minimal required-fields object to `DomainSchema.parse(...)`
 *  and lets the Zod schema's `.default(...)` clauses fill in
 *  the 14 default fields (purgeWrite, numerics, schemes,
 *  solverConfigs, relaxationFactors, adaptiveTimeStep, the
 *  6 turbulenceCoefficients* slots, initialConditions,
 *  patches). The 2 optional fields (bbox, origin) stay
 *  `undefined` unless explicitly provided via `overrides`.
 *
 * Why this matters: with the V1.41 snapshot pattern, a
 *  future DomainSchema change (e.g., V1.43 adding a new
 *  required field) would silently not include the new field
 *  in the fixture, and tests that depend on the new field's
 *  default behavior would fail with a confusing
 *  "field is undefined" error rather than a "fixture is
 *  missing the new field" error. With the V1.42 derivation
 *  pattern, the parse call surfaces the missing-required-field
 *  error at test-suite load time, so the fixture update is
 *  forced before the test suite can run.
 *
 * The 16 required fields (kind, Lx/Ly/Lz, nx/ny/nz, nu/rho,
 *  solver, turbulence, endTime, deltaT, writeInterval, cores,
 *  geometryKind) live in the explicit object below; the 14
 *  default fields are filled in by DomainSchema.parse; the
 *  2 optional fields (bbox, origin) are only present when
 *  a test overrides them.
 */
import { DomainSchema } from '@shared/types';
import type { Domain } from '@shared/types';

export function makeTestDomain(overrides: Partial<Domain> = {}): Domain {
  // V1.42 — minimal required-fields object. The schema fills
  //  in the 14 default fields (purgeWrite=0, numerics={...},
  //  schemes={...}, solverConfigs={...}, relaxationFactors={...},
  //  adaptiveTimeStep={...}, turbulenceCoefficients={...},
  //  turbulenceCoefficientsKOmegaSST={...},
  //  turbulenceCoefficientsSpalartAllmaras={...},
  //  turbulenceCoefficientsLES={...},
  //  turbulenceCoefficientsKEqn={...},
  //  turbulenceCoefficientsCDES={...},
  //  initialConditions={...}, patches=[]); the 2 optional
  //  fields (bbox, origin) stay undefined unless overridden.
  //  Tests override individual fields via the `overrides`
  //  spread to exercise the per-solver routing of
  //  shouldEmitRelaxationFactors + shouldEmitAdaptiveTimeStep
  //  and the snappy-driven `origin` / `bbox` branches of
  //  buildRenderContext + formatLocationInMesh.
  return DomainSchema.parse({
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
    cores: 1,
    geometryKind: 'parametric',
    ...overrides,
  });
}

/**
 * V1.42 — schema-bypass variant of `makeTestDomain` for tests
 *  that intentionally pass invalid values (0, NaN, Infinity)
 *  to exercise defensive code paths in the formatters. The
 *  `DomainSchema.parse(...)` call inside `makeTestDomain`
 *  rejects these values (`z.number().positive()` rejects 0
 *  and NaN), so the 2 defensive tests in case-formatters.test.ts
 *  need a way to build a fixture that passes through the parse
 *  step on a valid base, then has the invalid values applied
 *  AFTER the parse. This helper does exactly that in 1 named
 *  call site so the bypass intent is explicit:
 *
 *    const domain = makeRawTestDomain({ Lx: Infinity, Ly: NaN });
 *
 *  The formatter under test receives the invalid values and
 *  exercises the defensive code path (e.g., formatLocationInMesh
 *  coerces non-finite Lx/Ly/Lz to '0'). The valid base still
 *  runs through DomainSchema.parse, so the V1.42 drift-safety
 *  benefit (new required fields surface as parse errors) is
 *  preserved.
 */
export function makeRawTestDomain(overrides: Partial<Domain> = {}): Domain {
  return { ...makeTestDomain(), ...overrides };
}

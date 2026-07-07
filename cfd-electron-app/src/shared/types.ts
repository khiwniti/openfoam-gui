import { z } from 'zod';

// ---------- Domain schemas ----------

export const SolverSchema = z.enum([
  'icoFoam',
  'simpleFoam',
  'pimpleFoam',
  'potentialFoam',
  'buoyantSimpleFoam',
]);
export type Solver = z.infer<typeof SolverSchema>;

export const TurbulenceModelSchema = z.enum([
  'laminar',
  'kEpsilon',
  'kOmegaSST',
  'SpalartAllmaras',
  // V1.23 — LES replaces the previous `'LES'` placeholder. The dropdown
  //  filter is dropped (V1.23 lifts both Smagorinsky and WALE
  //  into the Build Case form), so a user can pick either concrete
  //  model. Pre-V1.23 cases stored with `turbulence === 'LES'`
  //  would fail Zod parse; no such cases exist because the
  //  pre-V1.23 dropdown filtered LES out. Other LES variants
  //  (kEqn, dynamicSmagorinsky, dynamicLagrangian,
  //  SpalartAllmarasDES) are deferred to a future V.x.
  'Smagorinsky',
  'WALE',
  // V1.24 -- k-equation LES (Germano 1991). Single-coefficient family
  //  (Ck / Ce1 / Ce2) mirrors the V1.20-V1.23 RANS coefficient
  //  ancestors. Other LES variants (dynamicSmagorinsky,
  //  dynamicLagrangian, SpalartAllmarasDES, kOmegaSSTDES) are
  //  deferred to V1.25 / V1.26.
  'kEqn',
  // V1.25 -- dyn-LES + DES variants. dynamicSmagorinsky and
  //  dynamicLagrangian run a test-filter dynamic procedure at
  //  runtime (no user coefficients). SpalartAllmarasDES wraps SA
  //  in the LES frame and re-uses the 9 SA coeffs verbatim.
  //  kOmegaSSTDES wraps k-omega SST in the LES frame, re-uses the
  //  12 SST coeffs verbatim, and ADDS a CDES shielding-function
  //  coefficient (OpenFOAM stock 0.65, Shur+Spalart+Strelets 2008)
  //  via the new V1.25 turbulenceCoefficientsCDES slot.
  'dynamicSmagorinsky',
  'dynamicLagrangian',
  'SpalartAllmarasDES',
  'kOmegaSSTDES',
]);
export type TurbulenceModel = z.infer<typeof TurbulenceModelSchema>;

/**
 * V1.26 -- LES-family lift, reified as a `const` source-of-truth so
 *  case.ts's `isLES` Handlebars helper no longer needs a
 *  hand-maintained 7-string array. The list below mirrors the LES
 *  entries of `TurbulenceModelSchema` (everything except `laminar` +
 *  the 3 pure-RANS variants `kEpsilon` / `kOmegaSST` /
 *  `SpalartAllmaras`). The `satisfies readonly TurbulenceModel[]`
 *  clause compiles to a type assertion: adding a value to either
 *  side without the other triggers a TS error at the lift site, so
 *  V1.27 / V1.28 additions touch both flags in lockstep.
 *
 *  Adding a new LES / hybrid variant:
 *    1. Append the string literal to `TurbulenceModelSchema` (above).
 *    2. Append the same string literal to `LES_TURBULENCE_TYPES`
 *       (below).
 *    3. Wire the template + form + helper-preview + store-seed as
 *       per the routine V1.x pattern (V1.23 / V1.24 / V1.25 are the
 *       closest precedents).
 *
 *  dyLES + DES rosters covered here:
 *    Smagorinsky          -- V1.23 static-LES (Lilly 1966)
 *    WALE                  -- V1.23 static-LES (Nicoud+Ducros 1999)
 *    kEqn                  -- V1.24 static-LES one-equation (Germano 1991)
 *    dynamicSmagorinsky     -- V1.25 dynamic-LES (Germano+Piomelli 1991)
 *    dynamicLagrangian      -- V1.25 dynamic-LES (Meneveau+Lund 1997)
 *    SpalartAllmarasDES     -- V1.25 hybrid RANS/LES (Spalart+Allmaras+Travin 2006)
 *    kOmegaSSTDES           -- V1.25 hybrid RANS/LES (Strelets 2001)
 */
export const LES_TURBULENCE_TYPES = [
  'Smagorinsky',
  'WALE',
  'kEqn',
  'dynamicSmagorinsky',
  'dynamicLagrangian',
  'SpalartAllmarasDES',
  'kOmegaSSTDES',
] as const satisfies readonly TurbulenceModel[];

export const CaseKindSchema = z.enum([
  'cavity',
  'channel',
  'cylinder',
  'airfoil',
]);
export type CaseKind = z.infer<typeof CaseKindSchema>;

export const PhaseSchema = z.enum([
  'idle',
  'preparing',
  'meshing',
  'snapping',
  'decomposing',
  'solving',
  'reconstructing',
  'converting',
  'done',
  // V1.8 — solver converged before endTime. Distinct terminal phase from
  //  'done' so the status pill + log message convey "we stopped early
  //  because residuals flattened" vs. "we ran out of time".
  'converged',
  'error',
  'cancelled',
]);
export type Phase = z.infer<typeof PhaseSchema>;

// ---------- Geometry mode ----------

export const GeometryKindSchema = z.enum(['parametric', 'imported']).default('parametric');
export type GeometryKind = z.infer<typeof GeometryKindSchema>;

/**
 * A patch the renderer exported from a STEP/IGES/STL to `constant/triSurface/<name>.stl`
 * for snappyHexMesh's `geometry` block.
 */
export const GeometryPatchSchema = z.object({
  name: z.string().min(1),
  /** Triangle count for the STL (informational; useful for sorting UI). */
  triangleCount: z.number().int().nonnegative().optional(),
  /** Optional target feature resolution (metres). Mapped to Level (nCells)... cells if absent. */
  refinementLevel: z.number().int().nonnegative().optional(),
});
export type GeometryPatchInput = z.infer<typeof GeometryPatchSchema>;

// V1.9 — per-solver numerical-algorithm tuning. Pre-V1.9 the fvSolution
//  template hard-coded `nNonOrthogonalCorrectors=0`, `nCorrectors=2`,
//  `nOuterCorrectors=1`, and the SIMPLE `residualControl` tolerances
//  (`1e-4` for all fields). Imported snappy geometries rarely have truly
//  orthogonal cells, so the user had to hand-edit fvSolution to dial up
//  the corrector count. V1.9 lifts those values into the renderer's
//  Build Case form so users can tune convergence for their mesh
//  without leaving the app.
//
//  Algorithm-specific keys:
//    nNonOrthogonalCorrectors — applies to SIMPLE/PISO/PIMPLE.
//    nCorrectors              — applies to PISO/PIMPLE (PISO loops
//                               inside one outer step; PIMPLE runs
//                               an outer loop too).
//    nOuterCorrectors         — applies to PIMPLE only (transient).
//    residualControl          — applies to SIMPLE only (steady).
//
//  Per-solver defaults live in SOLVER_CONTROLS_DEFAULTS so flipping
//  the solver dropdown in the UI preserves each algorithm's typical
//  starter values. `enabled=false` hides the corrector knobs from
//  the Build Case form but does NOT revert the underlying values
//  to schema defaults — it's a UI lock, not a reset. Power users
//  who really want pre-V1.9 behavior should manually set the
//  numerics back to the schema defaults.
//
//  Caveat for SIMPLE + buoyancy:
//  The current fvSolution template emits `residualControl` only for
//  p, U, and (when RAS) the turbulence field group. `buoyantSimpleFoam`
//  also carries an energy field T whose residual is not in the
//  residualControl block; T falls back to OpenFOAM's built-in
//  default tolerance (~1e-3) regardless of what the user sets
//  here. Tightening numerics to 1e-5 on a buoyant case still leaves
//  T at 1e-3 by design — addressed in a later V.x if buoyant
//  flows become a first-class use case.
// V1.18d — matrix-solver configuration for fvSolution's `solvers`
//  block. Pre-V1.18d the fvSolution.hbs template hard-coded:
//    p                GAMG/GaussSeidel, tol 1e-7, relTol 0.01
//    pFinal           $p; relTol 0
//    U                smoothSolver/symGaussSeidel, tol 1e-7, relTol 0.1
//    "k|epsilon" / "k|omega" / nuTilda
//                     smoothSolver/symGaussSeidel, tol 1e-7, relTol 0.1
//  Per the V1.18 design thinker-pass, OpenFOAM's matrix-solver pick
//  dictates convergence survival on high-Re distorted meshes (PCG
//  vs. GAMG for p, PBiCGStab vs. smoothSolver for momentum). The
//  `smoother` line stays hard-coded because it's coupled to the
//  solver choice in OpenFOAM (GAMG ↔ GaussSeidel, smoothSolver ↔
//  symGaussSeidel, PBiCGStab ↔ DILU preconditioner) and the user
//  rarely switches it independently. `tolerance` + `relTol` are
//  the two knobs that decide when the field is "solved" for the
//  iteration; lowering tolerance tightens absolute accuracy, lower
//  relTol tightens the relative drop.
//
//  Three UI rows (Pressure, Momentum, Turbulence) — Turbulence
//  applies to all of k / epsilon / omega / nuTilda via the
//  OpenFOAM regex `"k|epsilon"` / `"k|omega"` / `nuTilda` keys.
//  Splitting into 4 separate keys would defeat the regex match,
//  so we keep one shared config and emit the regex-stripped keys
//  from the template via the `turbulenceKey` context helper.
//
//  pFinal is NOT lifted (thinker-pass rationale: users almost
//  universally want exact closure on the final pressure sweep,
//  and the `$p; relTol 0;` form is OpenFOAM's mandated idiom).
export const MatrixSolverValueSchema = z.enum([
  'GAMG',
  'PCG',
  'smoothSolver',
  'PBiCG',
  'PBiCGStab',
]);
export type MatrixSolverValue = z.infer<typeof MatrixSolverValueSchema>;

/**
 * V1.18d — per-field solver block. Solver enum + tolerance +
 *  relTol. The static `smoother` line stays hard-coded in the
 *  template (thinker-pass rationale).
 */
export const FieldSolverSchema = z.object({
  solver: MatrixSolverValueSchema,
  tolerance: z.number().positive(),
  relTol: z.number().min(0),
});
export type FieldSolver = z.infer<typeof FieldSolverSchema>;

/**
 * V1.18d — solver configurations for the three solver-block
 *  groups (Pressure, Momentum, Turbulence). One row of inputs
 *  per group. `p` / `U` / `turbulence` keys map directly to the
 *  Handlebars context keys (`solverConfigs.p.solver` reads as
 *  the pressure-block solver choice). Defaults match the V1.17
 *  hard-coded values verbatim so any pre-V1.18d case parses with
 *  identical output: GAMG + 1e-7 + 0.01 for p (GAMG/0.01 is the
 *  OpenFOAM stock p-block); smoothSolver + 1e-7 + 0.1 for U /
 *  turbulence (smoothSolver/0.1 is stock for non-pressure
 *  equations).
 */
export const SolverConfigsSchema = z.object({
  p: FieldSolverSchema.default({
    solver: 'GAMG',
    tolerance: 1e-7,
    relTol: 0.01,
  }),
  U: FieldSolverSchema.default({
    solver: 'smoothSolver',
    tolerance: 1e-7,
    relTol: 0.1,
  }),
  turbulence: FieldSolverSchema.default({
    solver: 'smoothSolver',
    tolerance: 1e-7,
    relTol: 0.1,
  }),
});
export type SolverConfigs = z.infer<typeof SolverConfigsSchema>;

// V1.49 DRY -- `zCoerceExponentialString` lifts the union-transform
//  pattern (`z.union([z.number(), z.string()]).transform(...)`)
//  into a named constant so the same transform hosts both
//  `numerics.residualControl` and the per-record values in
//  `numerics.residualControlByField`. The transform normalizes
//  numeric inputs to scientific form -- e.g.
//  `(1e-4).toExponential() === '1e-4'`, `(0.0001).toExponential()
//  === '1e-4'` -- and passes through string inputs verbatim.
//  This is the determinism invariant that the V1.47 dual-form
//  regex `T\s+(?:1e-4|0\.0001)\s*;/` was band-aiding for; the
//  V1.49 migration flips it from a regex band-aid to a single
//  canonical emit form. Adding a third (or fourth) residual-style
//  field? Append `zCoerceExponentialString` to its value schema
//  and the normalization lift is automatic. Round-trip safety:
//  `(x).toExponential()` always re-serializes to the same JS number
//  via `Number(...)`, so downstream `String(...)`-coerced writes
//  from the renderer resolve to identical OpenFOAM tokens regardless
//  of whether the input form was `1e-4` (Number), `'1e-4'` (String),
//  or `'0.0001'` (String).
export const zCoerceExponentialString = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === 'string' ? v : v.toExponential()));

export const NumericsSchema = z.object({
  enabled: z.boolean().default(true),
  nNonOrthogonalCorrectors: z.number().int().min(0).default(0),
  nCorrectors: z.number().int().min(1).default(2),
  nOuterCorrectors: z.number().int().min(1).default(1),
  /** SIMPLE residual-control tolerance, applied uniformly to p, U,
   *  and (when non-laminar) k|epsilon|omega|nuTilda. The renderer
   *  lives in single-source-of-truth land: one number drives every
   *  field's tolerance in the rendered fvSolution. Per-field tuning
   *  is out of scope for V1.9 (would earn its own V.x).
   *
   *  V1.10 — `residualControlByField` (below) takes precedence on a
   *  per-field basis; when empty, the fvSolution template falls back
   *  to this single value for every field it emits (p, U, and any
   *  turbulence / energy field the active solver+model implies).
   *  Backwards-compat: pre-V1.10 cases see `{}` here on load, which
   *  causes the template to emit exactly the V1.9 shape verbatim.
   *
   *  V1.49 — schema migrated from `z.number().positive().default(1e-4)`
   *  to `zCoerceExponentialString.default('1e-4')`. Eliminates the
   *  V1.47 dual-form regex band-aid `(?:1e-4|0\.0001)` by normalizing
   *  numeric inputs to scientific form. See the `zCoerceExponentialString`
   *  doc-comment for the round-trip safety argument. */
  residualControl: zCoerceExponentialString.default('1e-4'),/** V1.10 — per-field residual-tolerance override. Empty by
 *  default; when populated, the template renders each listed
 *  field with the override's value instead of the uniform
 *  `numerics.residualControl`. Recognized keys:
 *    `p`   — pressure.
 *    `U`   — velocity.
 *    `k`   — turbulent kinetic kinetic energy (kEpsilon, kOmegaSST).
 *    `epsilon` — turbulent dissipation (kEpsilon only).
 *    `omega` — specific dissipation (kOmegaSST only).
 *    `nuTilda` — modified viscosity (SpalartAllmaras only).
 *    `T`   — energy / temperature (buoyantSimpleFoam only).
 *  The UI only exposes keys relevant to the active solver +
 *  turbulence model pair so the user can't accidentally type
 *  `omega` on a kEpsilon case and have it silently ignored by
 *  the template. */
  residualControlByField: z.record(z.string(), zCoerceExponentialString).default({}),
});

/**
 * V1.11 — SIMPLE relaxation-factor overrides for fvSolution's
 *  `relaxationFactors` block. Pre-V1.11 the fvSolution.hbs
 *  template hard-coded `p 0.3;` for fields and `U 0.7;` plus
 *  `(k|epsilon|omega|nuTilda) 0.7;` (when non-laminar) for
 *  equations, all unconditionally under the SIMPLE block. PIMPLE
 *  / PISO solvers did not emit a relaxationFactors block at all
 *  (they default in OpenFOAM to momentum-only relaxation, which
 *  V1.11 keeps). Viscous high-Re cases often need very lax p
 *  (0.1-0.2) and tighter U (0.7); poorly resolved boundary layers
 *  want different k/epsilon factors than typical kEpsilon. This
 *  schema lifts those values into the Build Case form.
 *
 *  V1.18b — `enabled` opt-in flag for PIMPLE. SIMPLE-family solvers
 *  (simpleFoam, buoyantSimpleFoam, potentialFoam) emit the block
 *  unconditionally (V1.11 behavior). pimpleFoam only emits the
 *  block when `enabled === true` — OpenFOAM PIMPLE under-relaxation
 *  is opt-in (the outer-corrector loop provides the implicit
 *  under-relaxation when nOuterCorrectors > 1, so most users don't
 *  need the explicit relaxationFactors block). Pre-V1.18b cases
 *  load with `enabled: false` via Zod's `.default(...)` chain and
 *  the template's PIMPLE gate reverts to V1.11 behavior (no block).
 *
 *  Per-field key maps:
 *    fields.p    — pressure (SIMPLE).
 *    fields.T    — energy / temperature (buoyantSimpleFoam only).
 *    equations.U — velocity.
 *    equations.k — turbulent kinetic energy (kEpsilon, kOmegaSST).
 *    equations.epsilon — turbulent dissipation (kEpsilon only).
 *    equations.omega — specific dissipation (kOmegaSST only).
 *    equations.nuTilda — modified viscosity (SpalartAllmaras only).
 *
 *  Empty entries fall back to the V1.10-era hard-coded values at
 *  template-render time (`{{or override default}}`), so pre-V1.11
 *  cases load with empty maps and re-render identically.
 */
export const RelaxationFactorsSchema = z.object({
  // V1.18b — see header. Default `false` keeps pre-V1.18b PIMPLE
  //  behavior (no relaxationFactors block in fvSolution).
  enabled: z.boolean().default(false),
  fields: z
    .object({
      p: z.number().positive().optional(),
      T: z.number().positive().optional(),
    })
    .default({}),
  equations: z
    .object({
      U: z.number().positive().optional(),
      k: z.number().positive().optional(),
      epsilon: z.number().positive().optional(),
      omega: z.number().positive().optional(),
      nuTilda: z.number().positive().optional(),
    })
    .default({}),
});
export type RelaxationFactors = z.infer<typeof RelaxationFactorsSchema>;
export type Numerics = z.infer<typeof NumericsSchema>;

/**
 * V1.19 — iterative time-stepping toggle for transient solvers
 *  (pimpleFoam, icoFoam). With `enabled === true` OpenFOAM picks
 *  Δt every step so Co stays ≤ `maxCo`; `maxCo` is the absolute
 *  Courant target (~0.5-1.0 typical for transient viscous flows,
 *  1.0 is OpenFOAM's stock default). `enabled === false` emits
 *  `adjustTimeStep no;` and OpenFOAM uses the user-supplied `Δt`
 *  verbatim.
 *
 *  Why no `maxAlphaCo`: α-Courant is a VoF-specific knob (controls
 *  α-wave propagation in interFoam / compressibleInterFoam / etc.).
 *  The V1.x solver roster (icoFoam, simpleFoam, pimpleFoam,
 *  potentialFoam, buoyantSimpleFoam) does not carry a VoF alpha
 *  field, so emitting `maxAlphaCo` would be a dead no-op for every
 *  user. Deferred to whichever V.x lands a VoF solver; the lift
 *  will ripple through FvSchemes + controlDict + simulation
 *  controls in one batch the way V1.18d did for potentialFoam.
 *
 *  `maxCo` is a positive number; OpenFOAM accepts fractional
 *  values down to ~1e-3 for very stiff problems (very high
 *  viscosity / structured near-wall resolution) but anything
 *  below 0.1 typically makes the time loop iterate thousands of
 *  times to advance trivial physics. 0.5 is a common production
 *  default for transient wind-tunnel / aero work.
 */
export const AdaptiveTimeStepSchema = z.object({
  enabled: z.boolean().default(false),
  maxCo: z.number().positive().default(1),
});
export type AdaptiveTimeStep = z.infer<typeof AdaptiveTimeStepSchema>;

/**
 * V1.20 — standard k-ε turbulence-model coefficients. Pre-V1.20 these
 *  values were OpenFOAM stock (the template emitted `RAS {model
 *  kEpsilon; turbulence on; printCoeffs on;}` with no coefficient sub-
 *  block, so OpenFOAM used the built-in defaults via the model C++
 *  source). V1.20 lifts all 5 model coefficients into the Build Case
 *  form so users can tune k-ε convergence without hand-editing
 *  `constant/momentumTransport`.
 *
 *  Field naming matches OpenFOAM stock verbatim (no rename on emit —
 *  the Handlebars template reads `{{turbulenceCoefficients.Cmu}}`
 *  directly to produce `Cmu  {{turbulenceCoefficients.Cmu}};`). Note
 *  the mixed casing: `Cmu`/`C1`/`C2` follow OpenFOAM's PascalCase-
 *  plus-acronym convention while `sigmak`/`sigmaEps` use lowercase
 *  and camelCase respectively (per OpenFOAM's naming inconsistency
 *  that dates back to the v1.x original implementation).
 *
 *  Defaults mirror OpenFOAM's built-in std-kEpsilon values:
 *    Cmu = 0.09   C1 = 1.44   C2 = 1.92   sigmak = 1.0   sigmaEps = 1.3
 *  These are present in OpenFOAM's `kEpsilon.C` source. Tuning outside
 *  these ranges indents into non-physical territory (the k-ε model
 *  loses its stability guarantee when C2 / C1 ratio departs from its
 *  nominal 1.92 / 1.44 ~1.33), but the schema accepts any positive
 *  reals so users CAN explore if they want to.
 *
 *  Scope: kEpsilon only. kOmegaSST and SpalartAllmaras have different
 *  coefficient families (interior mix of alpha_k1/beta_1/Cb1/Cw1
 *  shapes) and earn their own V1.21 / V1.22 if user demand surfaces.
 *  Until then, switching to kOmegaSST or SpalartAllmaras drops the
 *  Block entirely and OpenFOAM uses the model's built-in defaults —
 *  same pre-V1.20 behavior.
 */
export const LESCoefficientsSchema = z.object({
  Cs: z.number().positive().default(0.2),    // Smagorinsky (sub-grid Prandtl / eddies)
  Cw: z.number().positive().default(0.325),  // WALE (cube-root wall-adaptive constant)
});
export type LESCoefficients = z.infer<typeof LESCoefficientsSchema>;

/**
 * V1.24 -- k-equation LES sub-grid-scale coefficient set. Pre-V1.24 this
 *  branch was absent (V1.23 lifted only Smagorinsky + WALE; kEqn was
 *  mentioned as a deferred variant). V1.24 lifts the 3 OpenFOAM-stock
 *  k-eqn coefficients.
 *
 *  Field list:
 *    Ck     -- gradient-filter coefficient (Germano 1991,
 *               `filter` operator's `del*del` shape). OpenFOAM stock
 *               0.094. Sets how aggressively the resolved scales bleed
 *               energy into the test field; values 0.05-0.12 are the
 *               well-tested range.
 *    Ce1    -- filtered structure-function dissipation rate 1
 *               (Germano Lilly test-filter dynamics). OpenFOAM stock
 *               1.048. 0.85-1.20 is the well-tested range.
 *    Ce2    -- filtered structure-function dissipation rate 2
 *               (companion to Ce1). OpenFOAM stock 1.048. Same
 *               well-tested range as Ce1.
 *
 *  Pre-V1.24 cases load via the Zod default chain (zero behavior delta).
 *  Other LES variants (dynamicSmagorinsky, dynamicLagrangian,
 *  SpalartAllmarasDES, kOmegaSSTDES) are deferred to V1.25 / V1.26 --
 *  dynamic variants don't have user-tunable coefficients (model
 *  derives Cs from the resolved field on the fly), and DES variants
 *  need a different schema slot for the alpha blending coefficient.
 *
 *  Mirrors the V1.20 / V1.21 / V1.22 / V1.23 single-coefficient
 *  per-model schema pattern; one slot per LES family. The form renders
 *  the input row when the user picks `turbulence === 'kEqn'`; the
 *  template emits `modelCoeffs { Ck X; Ce1 Y; Ce2 Z; }` from the model
 *  block.
 */
export const KEqnCoefficientsSchema = z.object({
  // V1.24 review-fix -- schema-level bounds mirror PatchPanel input
  //  limits (`min=0 max=1` for Ck; `min=0 max=5` for Ce1 / Ce2) so
  //  invalid coefficients fail at parse time before reaching the
  //  template, instead of being silently rounded by the <input> floor.
  Ck: z.number().positive().max(1).default(0.094),
  Ce1: z.number().positive().max(5).default(1.048),
  Ce2: z.number().positive().max(5).default(1.048),
});

/**
 * V1.25 -- DES shielding-function coefficient. Used only by the
 * `kOmegaSSTDES` model variant in the LES arc; not used by
 * `SpalartAllmarasDES` (which re-uses SpalartAllmaras's 9
 * coefficients verbatim) and not used by any pure-LES model.
 *
 * OpenFOAM stock `CDES = 0.65` (Shur + Spalart + Strelets 2008 hybrid
 * RANS/LES switch constant). The DES shield ramps the model's
 * destruction term on the LES zone, so the model behaves like
 * RANS in attached regions and like LES in separated regions.
 *
 * Well-documented well-tested range is roughly [0.50, 0.85]:
 *   * < 0.50 produces grey-area "model-stress" artefacts
 *       (resolved structures under-dissipated, log-layer mismatch)
 *   * > 0.85 collapses the DES shield and the model reverts to
 *       pure RANS behaviour on the LES zone
 *
 * The PatchPanel uses a 10% drift gate around the OpenFOAM stock
 * value, which renders stable range [0.585, 0.715]; the wider
 * well-tested range can be explored without amber-warning alarm
 * fatigue.
 */
export const CDESCoefficientSchema = z.object({
  CDES: z.number().positive().max(5).default(0.65),
});
export type CDESCoefficient = z.infer<typeof CDESCoefficientSchema>;
export type KEqnCoefficients = z.infer<typeof KEqnCoefficientsSchema>;

export const KEpsilonCoefficientsSchema = z.object({
  Cmu: z.number().positive().default(0.09),
  C1: z.number().positive().default(1.44),
  C2: z.number().positive().default(1.92),
  sigmak: z.number().positive().default(1.0),
  sigmaEps: z.number().positive().default(1.3),
});
export type KEpsilonCoefficients = z.infer<typeof KEpsilonCoefficientsSchema>;

/**
 * V1.21 — Menter 2009 k-ω SST turbulence-model coefficients. Pre-V1.21
 *  these values were OpenFOAM stock (the template emitted
 *  `RAS {model kOmegaSST; turbulence on; printCoeffs on;}` with no
 *  coefficient sub-block, so OpenFOAM used the built-in defaults via
 *  the model C++ source). V1.21 lifts all 12 OpenFOAM-accepted SST
 *  coefficients into the Build Case form. Coefficient naming follows
 *  OpenFOAM stock verbatim (no rename on emit — the Handlebars
 *  template reads `{{turbulenceCoefficientsKOmegaSST.alphaK1}}`
 *  directly to produce `alphaK1  {{turbulenceCoefficientsKOmegaSST.alphaK1}};`,
 *  matching the mixed-case identifier convention OpenFOAM uses).
 *
 *  Field list (Menter 2009 k-ω SST):
 *    alphaK1     — limiter for k diffusion at low-Re inner region (SST-specific).
 *    alphaK2     — limiter for k diffusion at high-Re outer region.
 *    alphaOmega1 — limiter for ω diffusion at low-Re inner region.
 *    alphaOmega2 — limiter for ω diffusion at high-Re outer region.
 *    beta1       — β for the production term in the k-equation.
 *    beta2       — β for the production term in the ω-equation.
 *    betaStar    — β* in the k destruction term (k destruction vs production balance).
 *    a1          — limiter coefficient that controls how aggressively the
 *                   SST blend function clips k-production in adverse pressure
 *                   gradient regions; lowering a1 reduces SST's tendency to
 *                   over-produce k in separation zones (often the difference
 *                   between a converged run and one that crashes at iteration
 *                   200 with "max iterations exceeded").
 *    C1          — C1 in the F1 blend function / production limiter; reported
 *                   on F1's "production" term, NOT the k-ε C1.
 *    gamma1      — γ₁ in the k-equation diffusion term (k-equation-specific, distinct from k-ε C1).
 *    gamma2      — γ₂ in the ω-equation diffusion term.
 *    sigmaK      — σk for k diffusion (turbulent Prandtl number for k).
 *    sigmaOmega  — σω for ω diffusion (turbulent Prandtl number for ω).
 *
 *  Why the 13th coefficient `a1` is intentionally absent: OpenFOAM's
 *  `a1` knob is gated by the user activating `limitK` via an
 *  `fvOptions` block (a constant/cfd-options hookup that the form
 *  doesn't surface yet). Without that fvOptions entry, OpenFOAM
 *  silently ignores `a1` even if it's listed in `modelCoeffs`. The
 *  authoritative V.x that lands the limitK fvOptions entry will add
 *  `a1` to this schema and the corresponding input row in the Build
 *  Case form. Until then, omitting it matches production behavior.
 *
 *  Defaults mirror OpenFOAM's built-in kOmegaSST values (the Menter
 *  2009 incompressible starting values). Tuning outside these ranges
 *  indents into non-physical territory, but the schema accepts any
 *  positive reals so users CAN explore if they want to.
 *
 *  Scope: kOmegaSST only. SpalartAllmaras coefficients (Cb1/Cb2/Cw1/
 *  Cw2/Cw3/Cv1/Cv2/sigmaNut/sigmaEps/kappa/Csigma) earn their own
 *  V1.22 because SpalartAllmaras' coefficient family is structurally
 *  different (one-equation SA vs two-equation SST) and would distract
 *  from shipping V1.21 cleanly.
 *
 *  V1.21 design choice — parallel slots, not discriminated union. V1.20's
 *  `turbulenceCoefficients` stays the kEpsilon slot; V1.21 ADDS a
 *  sibling `turbulenceCoefficientsKOmegaSST` field on the same Domain
 *  + SolverControls schemas. The form renders one row of inputs
 *  depending on the active turbulence model; the template gates the
 *  kOmegaSST branch on `turbulence === 'kOmegaSST'` and reads from
 *  the matching field. This avoids the discriminated-union complexity
 *  (Zod unions + type narrowing at every emit site) without losing type
 *  safety — both fields are typed end-to-end and the form picks
 *  exactly one to write at a time.
 */
export const KOmegegaSSTCoefficientsSchema = z.object({
  alphaK1: z.number().positive().default(0.85),
  alphaK2: z.number().positive().default(1.0),
  alphaOmega1: z.number().positive().default(0.5),
  alphaOmega2: z.number().positive().default(0.856),
  beta1: z.number().positive().default(0.075),
  beta2: z.number().positive().default(0.0828),
  betaStar: z.number().positive().default(0.09),
  C1: z.number().positive().default(2.0),
  gamma1: z.number().positive().default(0.5555555555), // 5/9 — OpenFOAM stock; OpenFOAM encodes 1/2 * (F1) − gamma1 directly in source
  gamma2: z.number().positive().default(0.875),          // 7/8 — OpenFOAM stock
  sigmaK: z.number().positive().default(0.6),
  sigmaOmega: z.number().positive().default(0.5),
});
export type KOmegegaSSTCoefficients = z.infer<typeof KOmegegaSSTCoefficientsSchema>;

/**
 * V1.23 -- LES sub-grid-scale model coefficient set. Pre-V1.23 these
 *  values were OpenFOAM stock and the LES dropdown option was filtered
 *  out of the Build Case form. V1.23 lifts the two standard LES
 *  sub-grid-scale coefficient blocks into the Build Case form so users
 *  can tune Smagorinsky's Cs and WALE's Cw without hand-editing
 *  `constant/momentumTransport`.
 *
 *  Field list:
 *    Cs   -- Smagorinsky coefficient (OpenFOAM stock 0.2). Sets the
 *            sub-grid-scale eddy viscosity via Cs^2 * delta * |S|
 *            (Smagorinsky 1963 / Lilly 1967). 0.10-0.25 is the well-tested range for
 *            canonical channel / cavity LES; values above ~0.3 over-
 *            damp and values below ~0.10 under-resolve near-wall
 *            energy cascades.
 *    Cw   -- WALE constant (OpenFOAM stock 0.325). Used in WALE's
 *            (C_w * delta / C_k)^3 * S_ij^S_ij formulation (Nicoud
 *            + Ducros 1999). The cubic structure gives WALE auto-
 *            matic zero eddy-viscosity at walls (no wall damping
 *            function needed), making it the recommended default
 *            over Smagorinsky for wall-resolved LES. 0.30-0.35 is
 *            the well-tested range; outsides this, accuracy drops
 *            without resolving the underlying physics.
 *
 *  Why one schema for both LES variants: Smagorinsky and WALE are
 *  the two basic single-coefficient LES models OpenFOAM ships; both
 *  share `turbulenceCoefficientsLES` slot on the Domain + SolverControls
 *  (named-reference symmetry with V1.20's KEpsilonCoefficientsSchema
 *  / V1.21's KOmegegaSSTCoefficientsSchema / V1.22's
 *  SpalartAllmarasCoefficientsSchema). The form picks exactly one
 *  to write at a time (gated by `turbulence === 'Smagorinsky' |
 *  'WALE'`); the template emits `Cs X;` for Smagorinsky and `Cw Y;`
 *  for WALE in the respective if-branches. Parallel-slot design
 *  rather than discriminated-union keeps the per-model gates well-
 *  typed without the union-narrowing boilerplate at every emit site.
 *
 *  Other LES variants deferred to a future V.x:
 *    kEqn              -- carries Ck (~0.094) plus Ce1/Ce2.
 *    dynamicSmagorinsky / dynamicLagrangian -- derived coefficients,
 *                                            no user knobs.
 *    SpalartAllmarasDES / kOmegaSSTDES      -- hybrid RANS/LES, has
 *                                            an alpha (~0.15)
 *                                            blending coefficient
 *                                            plus the underlying
 *                                            RANS coefficients.
 *
 *  Defaults match OpenFOAM built-in Smagorinsky / WALE values verbatim
 *  (Lilly 1966 / Nicoud+Ducros 1999). Tuning outside the documented
 *  ranges rips the model physics and OpenFOAM may converge but the
 *  result won't match DNS.
 *
 *  V1.23 design choice -- parallel slots, not a discriminated
 *  union. The RANS co-slot siblings (V1.20's `turbulenceCoefficients`,
 *  V1.21's `turbulenceCoefficientsKOmegaSST`, V1.22's
 *  `turbulenceCoefficientsSpalartAllmaras`) stay unchanged; V1.23
 *  ADDS a sibling `turbulenceCoefficientsLES` field on the same
 *  Domain + SolverControls schemas. The form renders one row of
 *  inputs depending on the active turbulence model; the template
 *  gates the LES branches on `turbulence === 'Smagorinsky' |
 *  'WALE'` and reads from the matching field. This avoids the
 *  discriminated-union complexity (Zod unions + type narrowing at
 *  every emit site) without losing type safety -- both fields are
 *  typed end-to-end and the form picks exactly one to write at a
 *  time.
 */
/**
 *  no coefficient sub-block, so OpenFOAM used the built-in defaults
 *  via the model C++ source). V1.22 lifts all 9 standard SA
 *  coefficients into the Build Case form.
 *
 *  Field list (Spalart-Allmaras 1994 + Pirzadeh 1999 cubic ramp):
 *    sigmaNut   -- turbulent-quantity coupling coefficient (OpenFOAM
 *                 stock 0.667 = 2/3). Tunes how strongly nuTilda
 *                 transports to nu.
 *    kappa     -- von Karman constant (universal across RANS @ 0.41).
 *                 Shipped in SA's modelCoeffs block because OpenFOAM
 *                 reads it from there even though the value is
 *                 independent of model.
 *    Cb1       -- production coefficient (key sensitivity knob).
 *    Cb2       -- destruction coefficient.
 *    Cw1       -- OpenFOAM accepts C_w1 as user input via
 *                 modelCoeffs.C_w1 (the literature canonical
 *                 override is 0.3, which is the form's stock
 *                 value). Foundation OpenFOAM's
 *                 `SpalartAllmaras.C` lookupOrDefault FALLS
 *                 BACK to the C++ derived formula
 *                 C_b1 / kappa^2 + (1+C_b2) / sigma_nut
 *                 (~3.24 with stock C_b1/C_b2/sigma_nut)
 *                 when the override is absent. Emitting
 *                 `Cw1 0.3;` from the form here deliberately
 *                 overrides that derivation; OpenFOAM does NOT
 *                 silently re-derive. Tuning C_b1 separately
 *                 may require proportional adjustment of C_w1
 *                 for the cubic-ramp near-wall equilibrium.
 *    Cw2       -- secondary wall-damping coefficient
 *                 (OpenFOAM stock 0.06; foundation
 *                 `SpalartAllmaras.C` lookupOrDefault default
 *                 of 0.06 is what pre-V1.22 cases saw because
 *                 the modelCoeffs block was absent; lifting
 *                 C_w2 to the form with the same default
 *                 preserves "zero behavior delta").
 *    Cw3       -- limiter coefficient (2.0 stock, Pirzadeh's cubic
 *                 ramp).
 *    Cv1       -- primary production limiter (7.1 stock).
 *    Cv2       -- secondary production limiter (5.0 stock).
 *
 *  Why the 5 tripped-SAFvOptions coefficients (At, Bt, ct1, ct2, ct3,
 *  ct4) are intentionally absent: tripped-Spalt-Allmaras requires an
 *  `fvOptions` block in `constant/fvOptions` that the form doesn't
 *  surface yet. Including these in the schema without the fvOptions
 *  hookup would be inert inputs. Same pattern as V1.21's `a1` deferral
 *  for `fvOptions::limitK`. The author of the V.x that lifts general
 *  fvOptions support should add these 5 alongside a conditional render
 *  gate.
 *
 *  Defaults mirror OpenFOAM built-in SpalartAllmaras values verbatim
 *  (1994 + Pirzadeh 1999 mixing). Tuning outside these ranges indents
 *  into non-physical territory, but the schema accepts any positive
 *  reals so users CAN explore. Note: kappa is the one SA coefficient
 *  that's actually model-independent (universal von Karman), but
 *  it's correctly listed here because OpenFOAM's SpalartAllmaras.C
 *  source reads it from modelCoeffs.
 *
 *  Scope: SpalartAllmaras only. kEpsilon (V1.20) and kOmegaSST (V1.21)
 *  have parallel fields on the same Domain. The three slots together
 *  (turbulenceCoefficients + turbulenceCoefficientsKOmegaSST +
 *  turbulenceCoefficientsSpalartAllmaras) close the RANS coefficient
 *  arc; a future V.x lifts friction-line / dispersion for advanced
 *  LES models if user demand surfaces.
 */
export const SpalartAllmarasCoefficientsSchema = z.object({
  sigmaNut: z.number().positive().default(0.667),
  kappa: z.number().positive().default(0.41),
  Cb1: z.number().positive().default(0.1355),
  Cb2: z.number().positive().default(0.622),
  Cw1: z.number().positive().default(0.3),
  Cw2: z.number().positive().default(0.06),
  Cw3: z.number().positive().default(2.0),
  Cv1: z.number().positive().default(7.1),
  Cv2: z.number().positive().default(5.0),
});
export type SpalartAllmarasCoefficients = z.infer<typeof SpalartAllmarasCoefficientsSchema>;

// V1.12 — fvSchemes configuration. Pre-V1.12 the template hard-coded
//  six scheme-class defaults per OpenFOAM's stock incompressible
//  template (`default Euler;` / `default Gauss linear;` /
//  `default none;` / `default Gauss linear corrected;` / `default linear;` /
//  `default corrected;`). Steady solvers in particular were wrong-by-
//  construction with default ddt `Euler` — SIMPLE-style algorithms are
//  steady-state by definition, so they should use `steadyState` (no
//  time-stepping). V1.12 lifts the four most impactful scheme-class
//  `default` selectors into the Build Case form.
//
//  Scope: only the `default` lines for ddt / grad / div / laplacian
//  are user-tunable. Per-field `div(phi,U) Gauss linearUpwind grad(U)`
//  entries stay hard-coded in the template because they involve a
//  second interpolated argument (the upwind-gradient field for
//  linearUpwind, often also `grad(T)` for diffusive terms). Per-field
//  divergence overrides earn their own V.x if user demand surfaces.
//
//  `interpolationSchemes` and `snGradSchemes` are intentionally out of
//  scope for V1.12: neither is a frequent stability knob in OpenFOAM
//  practice, and they crowd the UI without paying stability dividends.
//  Both are easy add-ons if a later V.x finds user demand.
export const DdtSchemeValueSchema = z
  .enum(['steadyState', 'Euler', 'CrankNicolson 0.9', 'backward', 'localEuler'])
  .default('Euler');
export const GradSchemeValueSchema = z
  .enum([
    'Gauss linear',
    'Gauss linearUpwind',
    'leastSquares',
    'cellMDLimited Gauss linear 1',
    'faceLimited Gauss linear 1',
  ])
  .default('Gauss linear');
export const DivSchemeValueSchema = z
  .enum([
    'none',
    'Gauss linear',
    'Gauss linearUpwind',
    'Gauss QUICK',
    'Gauss MUSCL',
    'Gauss SFCD',
    'Gauss vanLeer',
  ])
  .default('none');
// V1.30 — export inferred type alongside the schema so the renderer
// (PatchPanel's per-field divergence closures, BcFieldRow typing) can
// narrow callback params to the literal union without re-declaring it.
export type DivSchemeValue = z.infer<typeof DivSchemeValueSchema>;
export const LaplacianSchemeValueSchema = z
  .enum([
    'Gauss linear orthogonal',
    'Gauss linear corrected',
    'Gauss linear limited',
  ])
  .default('Gauss linear corrected');
// V1.16 — per-field laplacian-scheme enum. Mirrors V1.13/V1.14's
//  per-field divergence architecture: the global `laplacianDefault`
//  emits a single line in fvSchemes.hbs, while per-field overrides
//  emit additional lines that override the default for the specific
//  field (laplacian(nuEff,U) …, laplacian(DkEff,k) …, etc.). The
//  qualifier list is the orthogonal/corrected + three `limited
//  <coeff>` variants the user typically reaches for when tuning
//  boundedness on high-skew meshes (0.5 is canonical, 0.7/0.9 are
//  looser bounds). OpenFOAM accepts arbitrary coefficients; we cap
//  at three because the dropdown UI shouldn't multiply dozens of
//  near-identical choices.
export const LaplacianFieldSchemeValueSchema = z
  .enum([
    'Gauss linear orthogonal',
    'Gauss linear corrected',
    'Gauss linear limited 0.5',
    'Gauss linear limited 0.7',
    'Gauss linear limited 0.9',
  ])
  .default('Gauss linear corrected');
export type LaplacianFieldSchemeValue = z.infer<
  typeof LaplacianFieldSchemeValueSchema
>;
// V1.16 — per-field laplacian overrides. Mirrors V1.13's DivFieldOver-
//  ridesSchema shape: a closed-per-field optional map that the tem-
//  plate reads through `{{or schemes.fieldLaplacians.X "Gauss linear
//  corrected"}}` (the fallback matches OpenFOAM's stock `laplacian
//  Default` so pre-V1.16 .cfd-app-state.json files render identically).
//
//  Per-field key map (gated by the active solver + turbulence model so
//  the template only emits lines the active case actually carries):
//   laplacian_nuEff_U          — momentum diffusion (always).
//   laplacian_DkEff_k          — turbulent-diffusion term for k
//                                 (kEpsilon, kOmegaSST).
//   laplacian_DepsilonEff_eps  — turbulent-diffusion term for epsilon
//                                 (kEpsilon only).
//   laplacian_DomegaEff_omega  — turbulent-diffusion term for omega
//                                 (kOmegaSST only).
//   laplacian_DnuTildaEff_nuT  — modified-viscosity diffusion term
//                                 (SpalartAllmaras only).
//   laplacian_alphaEff_h       — enthalpy diffusion term
//                                 (buoyantSimpleFoam only).
export const PerFieldLaplacianOverridesSchema = z.object({
  laplacian_nuEff_U: LaplacianFieldSchemeValueSchema.optional(),
  laplacian_DkEff_k: LaplacianFieldSchemeValueSchema.optional(),
  laplacian_DepsilonEff_epsilon: LaplacianFieldSchemeValueSchema.optional(),
  laplacian_DomegaEff_omega: LaplacianFieldSchemeValueSchema.optional(),
  laplacian_DnuTildaEff_nuTilda: LaplacianFieldSchemeValueSchema.optional(),
  laplacian_alphaEff_h: LaplacianFieldSchemeValueSchema.optional(),
});
export type PerFieldLaplacianOverrides = z.infer<
  typeof PerFieldLaplacianOverridesSchema
>;

// V1.15 — interpolationSchemes and snGradSchemes defaults. Pre-V1.15
//  the fvSchemes.hbs template hard-coded both as OpenFOAM's stock
//  incompressible values (`default linear;` / `default corrected;`).
//  Both blocks are solver-agnostic — interpolationSchemes governs how
//  OpenFOAM picks surface values from cell centers (used by
//  div(phi,X) and laplacian interpolations), and snGradSchemes governs
//  the surface-normal gradient used by the laplacian correction term.
//  V1.15 lifts both `default` lines into the Build Case form so users
//  can switch to `midPointU` / `faceCorrected` on highly-skew meshes,
//  or flip snGrad to `limited 0.5` to bound the non-orthogonal correction
//  term on moderately-skew meshes. The interpolation enum is the closed
//  set of OpenFOAM stock kernels matching the closure tag (no
//  coefficient appended); snGrad also exposes `limited <coeff>` variants
//  because that's the most common customization in practice.
export const InterpolationSchemeValueSchema = z
  .enum(['linear', 'midPoint', 'midPointU', 'faceCorrected'])
  .default('linear');
export const SnGradSchemeValueSchema = z
  .enum([
    'corrected',
    'uncorrected',
    'limited 0.333',
    'limited 0.5',
    'limited 0.7',
  ])
  .default('corrected');
export type InterpolationSchemeValue = z.infer<
  typeof InterpolationSchemeValueSchema
>;
export type SnGradSchemeValue = z.infer<typeof SnGradSchemeValueSchema>;
// V1.17 — per-field snGrad-scheme enum. Mirrors V1.16's
//  `LaplacianFieldSchemeValueSchema` shape but without the
//  `Gauss linear orthogonal` variant (snGrad corrections are not
//  orthogonal-aware in OpenFOAM — the choice is always between
//  `corrected` (non-orthogonal correction applied), `uncorrected`
//  (skipped), and `limited <coeff>` (bounded via min/max limiter).
//  We mirror V1.16's three-coefficient `limited` family (0.5/0.7/0.9)
//  because that's the most common tuning in practice — 0.5 is
//  canonical, 0.7/0.9 are looser bounds.
export const SnGradFieldSchemeValueSchema = z
  .enum([
    'corrected',
    'uncorrected',
    'limited 0.5',
    'limited 0.7',
    'limited 0.9',
  ])
  .default('corrected');
export type SnGradFieldSchemeValue = z.infer<
  typeof SnGradFieldSchemeValueSchema
>;
// V1.17 — per-field snGrad overrides. Mirrors V1.16's
//  `PerFieldLaplacianOverridesSchema` shape: a closed-per-field
//  optional map that the template reads through
//  `{{or schemes.fieldSnGrads.X "corrected"}}` (the fallback matches
//  OpenFOAM's stock `snGradSchemes` default so pre-V1.17
//  .cfd-app-state.json files re-render identically with the OpenFOAM
//  stock `corrected` value).
//
//  Per-field key map (gated by the active solver + turbulence model so
//  the template only emits lines the active case actually carries):
//   snGrad_U             — surface-normal-gradient correction for U (always).
//   snGrad_k             — surface-normal-gradient correction for k
//                          (kEpsilon, kOmegaSST).
//   snGrad_epsilon       — surface-normal-gradient correction for epsilon
//                          (kEpsilon only).
//   snGrad_omega         — surface-normal-gradient correction for omega
//                          (kOmegaSST only).
//   snGrad_nuTilda       — surface-normal-gradient correction for nuTilda
//                          (SpalartAllmaras only).
//   snGrad_h             — surface-normal-gradient correction for h
//                          (buoyantSimpleFoam only).
export const PerFieldSnGradOverridesSchema = z.object({
  snGrad_U: SnGradFieldSchemeValueSchema.optional(),
  snGrad_k: SnGradFieldSchemeValueSchema.optional(),
  snGrad_epsilon: SnGradFieldSchemeValueSchema.optional(),
  snGrad_omega: SnGradFieldSchemeValueSchema.optional(),
  snGrad_nuTilda: SnGradFieldSchemeValueSchema.optional(),
  snGrad_h: SnGradFieldSchemeValueSchema.optional(),
});
export type PerFieldSnGradOverrides = z.infer<
  typeof PerFieldSnGradOverridesSchema
>;

// V1.13 — per-field divergence overrides for fvSchemes's divSchemes
//  block. Pre-V1.13 the fvSchemes.hbs template hard-coded six per-field
//  divergence entries:
//    div(phi,U)      Gauss linearUpwind grad(U);
//    div(phi,k)      Gauss linearUpwind grad(k);
//    div(phi,epsilon) Gauss linearUpwind grad(epsilon);
//    div(phi,omega)  Gauss linearUpwind grad(omega);
//    div(phi,nut)    Gauss linearUpwind grad(nut);
//    div(phi,nuTilda) Gauss linearUpwind grad(nuTilda);
//  V1.13 lifts the discretization-scheme portion of each entry into the
//  Build Case form; the second interpolated argument (`grad(X)`)
//  synthesizes from the field name, so the user only has to pick the
//  prefix (e.g. switching div(phi,U) from `Gauss linearUpwind` to
//  `Gauss QUICK`).
//
//  Per-field key map (gated by the active solver + turbulence model in
//  the UI; template always emits the stock `linearUpwind` when the
//  override is absent):
//    div_phi_U       — velocity. Always present.
//    div_phi_k       — turbulent kinetic energy (kEpsilon, kOmegaSST).
//    div_phi_epsilon — turbulent dissipation (kEpsilon only).
//    div_phi_omega   — specific dissipation (kOmegaSST only).
//    div_phi_nut     — turbulent viscosity (SpalartAllmaras only).
//    div_phi_nuTilda — modified viscosity (SpalartAllmaras only).
//
//  Empty entries fall back to `Gauss linearUpwind grad(X)` at template-
//  render time via the `{{or override default}}` Handlebars helper, so
//  pre-V1.13 .cfd-app-state.json files (which store no fieldDivs key)
//  re-render identically.
export const DivFieldOverridesSchema = z.object({
  div_phi_U: DivSchemeValueSchema.optional(),
  div_phi_k: DivSchemeValueSchema.optional(),
  div_phi_epsilon: DivSchemeValueSchema.optional(),
  div_phi_omega: DivSchemeValueSchema.optional(),
  div_phi_nut: DivSchemeValueSchema.optional(),
  div_phi_nuTilda: DivSchemeValueSchema.optional(),
  // V1.14 — energy-field divergence (buoyantSimpleFoam only). The
  //  template emits `div(phi,T) ... grad(T);` only when
  //  `solver === 'buoyantSimpleFoam'` since T is undefined for the
  //  other solvers (OpenFOAM crashes on missing-field divergence).
  //  Stored alongside the other 6 keys for one-line schema/UI/template
  //  parity; the build form hides the row for non-buoyant solvers.
  div_phi_T: DivSchemeValueSchema.optional(),
});
export type DivFieldOverrides = z.infer<typeof DivFieldOverridesSchema>;

export const FvSchemesSchema = z.object({
  ddtDefault: DdtSchemeValueSchema,
  gradDefault: GradSchemeValueSchema,
  divDefault: DivSchemeValueSchema,
  laplacianDefault: LaplacianSchemeValueSchema,
  // V1.15 — interpolation + surface-normal-gradient defaults.
  //  Solver-agnostic — same OpenFOAM stock values across SIMPLE /
  //  PISO / PIMPLE. The two new fields complete the V1.12 carve-out
  //  list (`interpolationSchemes` / `snGradSchemes` were deferred from
  //  V1.12 to keep that PR scoped to the four most-impactful selectors).
  interpolationDefault: InterpolationSchemeValueSchema,
  snGradDefault: SnGradSchemeValueSchema,
  // V1.13 — per-field divergence overrides. Lives inside FvSchemes
  //  schema so the OpenFOAM-fvSchemes mental model is preserved
  //  (Domain.schemes contains all fvSchemes knobs uniformly).
  fieldDivs: DivFieldOverridesSchema.default({}),
  // V1.16 — per-field laplacian overrides. Same architecture as
  //  V1.13's `fieldDivs`: optional per-field map, gated by solver +
  //  turbulence model in the UI; pre-V1.16 cases parse with `{}` via
  //  Zod's default and the fvSchemes.hbs `{{or override default}}`
  //  helpers fall back to `Gauss linear corrected` at render time.
  //  Caveat: V1.13's per-field divergence lines already existed in
  //  the V1.12-era template (lift was just text-substitution). V1.16's
  //  per-field laplacian lines are NEW — they're emitted as
  //  unconditional + solver/turbulence conditional Handlebars blocks
  //  in fvSchemes.hbs so pre-V1.16 .cfd-app-state.json cases see
  //  additional `laplacian(...) Gauss linear corrected;` lines and
  //  re-render unconditionally with the OpenFOAM stock value (zero
  //  behavior delta because the line matches the laplacianDefault
  //  fallback for those fields).
  fieldLaplacians: PerFieldLaplacianOverridesSchema.default({}),
  // V1.17 — per-field snGrad overrides. Same architecture as V1.16's
  //  `fieldLaplacians`: optional per-field map, gated by solver +
  //  turbulence model in the UI; pre-V1.17 cases parse with `{}` via
  //  Zod's default and the fvSchemes.hbs `{{or override default}}`
  //  helpers fall back to `corrected` at render time.
  //
  //  Architectural note: V1.17 emits NEW per-field snGrad lines (no
  //  V1.16-era template analog). The pre-V1.17 template emitted only
  //  `default {{schemes.snGradDefault}};`. Post-upgrade emits the
  //  per-field lines too, each falling back to `corrected` so any
  //  pre-V1.17 case sees zero behavior delta (OpenFOAM treats
  //  `snGrad(<field>) corrected;` identically to `default corrected;`
  //  when both resolve to the same correction).
  fieldSnGrads: PerFieldSnGradOverridesSchema.default({}),
});
export type FvSchemes = z.infer<typeof FvSchemesSchema>;

// V1.7 — initial-condition segment. Renders `internalField uniform …;` in
// both the parametric-cavity templates (`0/U.hbs`, `0/p.hbs`) and the snappy
// variants (`snappy_U.hbs`, `snappy_p.hbs`). Object form `{x, y, z}` is
// vastly more readable in Handlebars templates than a 3-tuple that would
// need `velocity.[0]` index access. BcField stays tuple-form (`z.array(z.number()).length(3)`)
// because its Handlebars access is mediated by the `bcFor` helper that
// already consumes tuples; mixing the two subsystems is fine.
export const InitialConditionsSchema = z.object({
  velocity: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  pressure: z.number(),
});
export type InitialConditions = z.infer<typeof InitialConditionsSchema>;
export const DomainSchema = z.object({
  kind: CaseKindSchema,
  // Geometry
  Lx: z.number().positive(),
  Ly: z.number().positive(),
  Lz: z.number().positive(),
  // Mesh
  nx: z.number().int().positive(),
  ny: z.number().int().positive(),
  nz: z.number().int().positive(),
  // Physics
  nu: z.number().positive(),         // kinematic viscosity m^2/s
  rho: z.number().positive(),        // density kg/m^3 (only used by some solvers)
  // Simulation controls
  solver: SolverSchema,
  turbulence: TurbulenceModelSchema,
  endTime: z.number().positive(),
  deltaT: z.number().positive(),
  writeInterval: z.number().int().positive(),
  // V1.5 — purgeWrite on the Domain itself so it roundtrips through
  // .cfd-app-state.json. Pre-V1.5 cases see the default 0, matching the
  // previous hard-coded controlDict value (no behavior change for them).
  purgeWrite: z.number().int().min(0).default(0),
  // V1.9 — numerical corrector counts + SIMPLE residual-control
  //  tolerance. Lives on the Domain so the fvSolution.hbs template
  //  can read it directly during render. Defaults match the V1.8-era
  //  hard-coded values (1 non-orth / 2 correctors / 1 outer /
  //  1e-4 residual), so any .cfd-app-state.json written before V1.9
  //  re-renders identically. `buildCaseFromPatches` merges the
  //  active solver's SOLVER_CONTROLS_DEFAULTS.numerics into this
  //  field on Build.
  numerics: NumericsSchema.default({
    enabled: true,
    nNonOrthogonalCorrectors: 0,
    nCorrectors: 2,
    nOuterCorrectors: 1,
    residualControl: '1e-4',
  }),
  // V1.12 — fvSchemes defaults. Lives on the Domain so it roundtrips
  //  through .cfd-app-state.json and reaches the fvSchemes template
  //  unmodified; the per-solver copy in SolverControlsSchema is the UI
  //  source of truth, merged by buildCaseFromPatches. Defaults match the
  //  V1.11-era hard-coded values for `grad` / `div` / `laplacian`, and
  //  OpenFOAM's stock `Euler` for `ddt`. Per-solver seed flips ddt to
  //  `steadyState` for steady solvers (simpleFoam, buoyantSimpleFoam,
  //  potentialFoam) — picking `Euler` there would silently break the
  //  steady-state assumption. Any pre-V1.12 .cfd-app-state.json stores
  //  no `schemes` key, so DomainSchema.parse materializes these defaults
  //  and fvSchemes.hbs renders identically to pre-V1.12 output.
  schemes: FvSchemesSchema.default({
    ddtDefault: 'Euler',
    gradDefault: 'Gauss linear',
    divDefault: 'none',
    laplacianDefault: 'Gauss linear corrected',
    // V1.15 — interpolationSchemes and snGradSchemes `default` lines.
    //  Solver-agnostic (no per-solver diff for these two), and the
    //  Zod enum defaults below match OpenFOAM's stock incompressible
    //  template verbatim. The Schema default lazy-materializes both
    //  keys when domain.schemes is parsed from a pre-V1.15
    //  .cfd-app-state.json (the file has no `schemes` key, so all
    //  six defaults resolve together).
    interpolationDefault: 'linear',
    snGradDefault: 'corrected',
    fieldDivs: {},
    // V1.16 — per-field laplacian overrides. Empty default plus the
    //  template's `{{or override "Gauss linear corrected"}}` fallback
    //  means pre-V1.16 .cfd-app-state.json files round-trip cleanly;
    //  the new template lines emit with OpenFOAM stock values, so
    //  zero behavior delta for any existing case.
    fieldLaplacians: {},
    // V1.17 — per-field snGrad overrides. Empty defaults plus the
    //  template's `{{or override "corrected"}}` fallback yield the
    //  OpenFOAM stock `corrected` value at render time. Zero behavior
    //  delta for any pre-V1.17 case (post-upgrade sees additional
    //  `snGrad(<field>) corrected;` lines that match the global
    //  snGradDefault fallback).    fieldSnGrads: {},
   }),
  // V1.18d — matrix-solver configurations on the Domain mirror.
  //  Defaults match the V1.17 hard-coded template values verbatim
  //  so pre-V1.18d cases parse and re-render identically. Solver-
  //  agnostic defaults; per-solver UI source of truth is
  //  SolverControlsSchema, merged by buildCaseFromPatches.
  solverConfigs: SolverConfigsSchema.default({
    p: { solver: 'GAMG', tolerance: 1e-7, relTol: 0.01 },
    U: { solver: 'smoothSolver', tolerance: 1e-7, relTol: 0.1 },
    turbulence: { solver: 'smoothSolver', tolerance: 1e-7, relTol: 0.1 },
  }),
  // V1.18b — relaxationFactors on the Domain mirror. Needed by
  //  case.ts's `emitRelaxationFactors` boolean when PIMPLE is the
  //  active solver (non-empty enablement flag drives the block).
  //  Defaults match the V1.17 hard-coded `enabled: false` path so
  //  pre-V1.18b .cfd-app-state.json files load with the V1.11
  //  behavior (no PIMPLE block). Per-solver UI source of truth is
  //  SolverControlsSchema, merged by buildCaseFromPatches. Zod
  //  default makes the field non-optional end-to-end, replacing
  //  the optional-chaining read in case.ts.
  relaxationFactors: RelaxationFactorsSchema.default({
    enabled: false,
    fields: {},
    equations: {},
  }),
  // V1.19 — iterative time-stepping on the Domain mirror. Same
  //  pattern as V1.18b's `relaxationFactors` and V1.18d's
  //  `solverConfigs`: lives on both SolverControlsSchema (UI source
  //  of truth, per-solver copy) and DomainSchema (so controlDict.hbs
  //  reads `{{#if emitAdaptiveTimeStep}}…{{/if}}` directly).
  //  Defaults match the V1.18-era hard-coded `adjustTimeStep no;`
  //  path so pre-V1.19 .cfd-app-state.json files parse with
  //  identical output. `case.ts` precomputes an `emitAdaptiveTimeStep`
  //  boolean (true only for pimpleFoam + icoFoam + enabled == true)
  //  and the controlDict template gates the lift on that boolean.
  adaptiveTimeStep: AdaptiveTimeStepSchema.default({
    enabled: false,
    maxCo: 1,
  }),
  // V1.20 — k-ε turbulence-model coefficient block on the Domain
  //  mirror. Same two-sided-on-Domain-and-SolverControls pattern as
  //  V1.18b/V1.18d/V1.19: lives on both schemas (UI source of truth +
  //  template read), named-reference to KEpsilonCoefficientsSchema
  //  for symmetry with V1.18d's `SolverConfigsSchema.default(...)`.
  //  Defaults match OpenFOAM stock (Cmu 0.09, C1 1.44, C2 1.92,
  //  sigmak 1.0, sigmaEps 1.3 — kEpsilon's canonical incompressible
  //  starting values). Pre-V1.20 templates emitted no `modelCoeffs`
  //  block, so OpenFOAM used built-in defaults via the model source;
  //  post-V1.20 always emits the block (the form's UI source of truth
  //  is mirrored to the Domain so legacy `{}` cases parse to the
  //  OpenFOAM stock values via the Zod default chain).
  //
  //  V1.21 — adds a sibling `turbulenceCoefficientsKOmegaSST` field
  //  (parallel-slot design rather than discriminated union — see
  //  KOmegegaSSTCoefficientsSchema comment for rationale). The form
  //  picks exactly one to write at a time (gated by
  //  `formValues.turbulence === "kOmegaSST"`); the template gates the
  //  kOmegaSST `{{#if}}` branch on the same boolean and reads from
  //  the matching field. Defaults match OpenFOAM's Menter 2009 stock
  //  values; pre-V1.21 .cfd-app-state.json files parse with the
  //  OpenFOAM stock defaults via the Zod default chain (zero behavior
  //  delta because the template's kOmegaSST branch only emits the
  //  block when the user picks the model in the form anyway).
  //  SpalartAllmaras coefficients deferred to V1.22.
  turbulenceCoefficients: KEpsilonCoefficientsSchema.default({
    Cmu: 0.09,
    C1: 1.44,
    C2: 1.92,
    sigmak: 1.0,
    sigmaEps: 1.3,
  }),
  turbulenceCoefficientsKOmegaSST: KOmegegaSSTCoefficientsSchema.default({
    alphaK1: 0.85,
    alphaK2: 1.0,
    alphaOmega1: 0.5,
    alphaOmega2: 0.856,
    beta1: 0.075,
    beta2: 0.0828,
    betaStar: 0.09,
    C1: 2.0,
    gamma1: 0.5555555555,
    gamma2: 0.875,
    sigmaK: 0.6,
    sigmaOmega: 0.5,
  }),
  // V1.22 -- Spalart-Allmaras coefficient block on the Domain +
  //  SolverControls mirror. Third sibling to V1.20's kEpsilon and
  //  V1.21's kOmegaSST slots; same two-sided-on-Domain-and-SolverControls
  //  pattern (named-reference to SpalartAllmarasCoefficientsSchema
  //  for symmetry with V1.20/V1.21's named references). Applies to
  //  BOTH schemas below via allowMultiple; the inline comment lives
  //  on the SolverControlsSchema copy below for the per-solver
  //  durability note (the Domain copy just carries the schema
  //  default forward).
  //
  //  Defaults match OpenFOAM stock (1994 + Pirzadeh 1999 cubic ramp).
  //  Pre-V1.22 templates emitted no SpalartAllmaras modelCoeffs block,
  //  so OpenFOAM used built-in defaults via the model source; post-V1.22
  //  always emits the block (defaults via Zod chain). The 5 tripped-
  //  SAFvOptions coefficients (At, Bt, ct1, ct2, ct3, ct4) are deferred
  //  to the V.x that lifts general fvOptions support -- same precedent
  //  as V1.21's `a1` for limitK.
  turbulenceCoefficientsSpalartAllmaras: SpalartAllmarasCoefficientsSchema.default({
    sigmaNut: 0.667,
    kappa: 0.41,
    Cb1: 0.1355,
    Cb2: 0.622,
    Cw1: 0.3,
    Cw2: 0.06,
    Cw3: 2.0,
    Cv1: 7.1,
    Cv2: 5.0,
  }),
  // V1.23 -- LES sub-grid-scale coefficient block. Sibling to V1.20 /
  //  V1.21 / V1.22 RANS slots; same two-sided-on-Domain-and-
  //  SolverControls pattern (named-reference to LESCoefficientsSchema).
  //  Application via allowMultiple=true on the SA-default-block
  //  anchor: this drops the LES seed onto BOTH the DomainSchema and
  //  SolverControlsSchema copies in one edit, mirroring the V1.20 /
  //  V1.21 / V1.22 kEpsilon / kOmegaSST / SpalartAllmaras
  //  symmetry. Defaults are OpenFOAM stock (Lilly 1966 /
  //  Nicoud+Ducros 1999): Cs=0.2 (Smagorinsky) / Cw=0.325 (WALE).
  //  Pre-V1.23 templates emitted no modelCoeffs block on the LES
  //  branch (the LES dropdown was filtered out), so OpenFOAM used
  //  built-in defaults via the model source; post-V1.23 always
  //  emits Cs / Cw as appropriate for the active LES model.
  turbulenceCoefficientsLES: LESCoefficientsSchema.default({
    Cs: 0.2,
    Cw: 0.325,
  }),
  // V1.24 -- k-equation LES coefficient block. 5th sibling to V1.20 /
  //  V1.21 / V1.22 / V1.23 slots; same two-sided-on-Domain-and-
  //  SolverControls pattern (named-reference to KEqnCoefficientsSchema).
  //  Dropdown-light: the form only renders this row when the user
  //  picks kEqn; values stay dormant otherwise. Defaults are OpenFOAM
  //  stock (Germano 1991 / Lilly 1967). Other LES variants
  //  (dynamicSmagorinsky / dynamicLagrangian / SpalartAllmarasDES /
  //  kOmegaSSTDES) are deferred to V1.25 / V1.26 -- dynamic variants
  //  have no user-tunable coefficients and DES needs a separate
  //  alpha-blending slot.
  turbulenceCoefficientsKEqn: KEqnCoefficientsSchema.default({
    Ck: 0.094,
    Ce1: 1.048,
    Ce2: 1.048,
  }),
  // V1.25 -- DES shielding coefficient slot (parallel sibling to
  //  V1.20/V1.21/V1.22/V1.23/V1.24). Used only by `kOmegaSSTDES`;
  //  emits nothing in momentumTransport for any other model. OpenFOAM
  //  stock 0.65 mirrors Shur + Spalart + Strelets 2008. Defaults
  //  carry through DomainSchema + SolverControlsSchema mirrors.
  turbulenceCoefficientsCDES: CDESCoefficientSchema.default({
    CDES: 0.65,
  }),
   // V1.7 — initial-field values rendered as `internalField uniform …;` in
  // 0/U and 0/p. Default is the freestream-rest state zero so any
  // .cfd-app-state.json written before V1.7 parses identically to today's
  // hard-coded `(0 0 0)` / `0`.
  initialConditions: InitialConditionsSchema.default({
    velocity: { x: 0, y: 0, z: 0 },
    pressure: 0,
  }),
  // Solver performance
  cores: z.number().int().min(1).max(64),
  // Snappy / imported geometry (added in V0.6)
  geometryKind: GeometryKindSchema,
  patches: z.array(GeometryPatchSchema).default([]),
  /** Bounding box of the imported solid; required when geometryKind === 'imported' so the
   *  renderer can size the background domain and set snappyHexMesh's `locationInMesh`. */
  bbox: z
    .object({
      min: z.object({ x: z.number(), y: z.number(), z: z.number() }),
      max: z.object({ x: z.number(), y: z.number(), z: z.number() }),
    })
    .optional(),
  /** Background blockMesh origin (corner). Defaults to (0,0,0) so parametric cavity
   *  cases render unchanged. For imported (snappy-driven) cases the renderer sets
   *  this to `bbox.min - padding*span` so the imported geometry is fully contained
   *  in the background mesh, regardless of where the original STEP/IGES is anchored. */
  origin: z
    .object({ x: z.number(), y: z.number(), z: z.number() })
    .optional(),
});
export type Domain = z.infer<typeof DomainSchema>;

export const BcFieldSchema = z.object({
  type: z.enum(['fixedValue', 'zeroGradient', 'noSlip', 'slip', 'cyclic', 'symmetryPlane', 'empty']),
  value: z.union([z.number(), z.array(z.number()).length(3)]).optional(),
});
export type BcField = z.infer<typeof BcFieldSchema>;

export const BoundaryConditionsSchema = z.object({
  // map of patchId -> map of field -> BC
  velocity: z.record(z.string(), BcFieldSchema),
  pressure: z.record(z.string(), BcFieldSchema),
});
export type BoundaryConditions = z.infer<typeof BoundaryConditionsSchema>;


// V1.4 — per-patch snappy surface refinement levels. Min and max cells
// between the surface and the volume grid; both 0..7 in practice (typical
// 0..3). The global `nCellsBetweenLevels` (default 3) is read from
// snappyHexMeshDict; per-patch override is out of scope.
export const PatchRefinementSchema = z.object({
  min: z.number().int().min(0).max(7),
  max: z.number().int().min(0).max(7),
});
export type PatchRefinement = z.infer<typeof PatchRefinementSchema>;
export type PatchRefinements = Record<string, PatchRefinement>;

// ---------- V1.5 — Persistent solver runtime controls ----------

/**
 * Per-solver runtime controls (deltaT, writeInterval, purgeWrite, endTime,
 * cores, nu). Lives in the renderer Zustand store as a per-solver map;
 * `buildCaseFromPatches` merges the active solver's entry into the Domain
 * sent to IPC, so no IPC schema change is needed. Survives page reloads
 * because it's stored on the global slice, NOT local React useState.
 *
 * `deltaT` is conventional 1 for steady solvers (simpleFoam,
 * buoyantSimpleFoam, potentialFoam) and the editor masks the input
 * rather than letting users set it. Transient solvers (icoFoam, pimpleFoam)
 * need a small deltaT to keep the Courant number manageable.
 */
export const SolverControlsSchema = z.object({
  solver: SolverSchema,
  deltaT: z.number().positive(),
  writeInterval: z.number().int().positive(),
  purgeWrite: z.number().int().min(0),
  endTime: z.number().positive(),
  /** V1.6 — turbulence model. Stored per-solver so flipping solver dropdowns
   *  preserves the user's choice. V1.23 lifts `Smagorinsky` and `WALE`
   *  into the Build Case form (replacing the V0.6 `'LES'` placeholder);
   *  `momentumTransport.hbs` reads the matching turbulenceCoefficientsLES
   *  field for `Cs` (Smagorinsky) or `Cw` (WALE). Other LES variants
   *  (kEqn, dynamicSmagorinsky, dynamicLagrangian, SpalartAllmarasDES)
   *  remain deferred to a future V.x. */
  turbulence: TurbulenceModelSchema,
  cores: z.number().int().min(1).max(64),
  nu: z.number().positive(),
  /** V1.7 — initial conditions. Per-solver so flipping the dropdown
   *  preserves the user's freestream choice. `potentialFoam` defaults to
   *  `(1, 0, 0)` since it's a preconditioner that genuinely needs a
   *  freestream; all others default to zero (so the lid-driven cavity
   *  benchmark keeps converging). */
  initialConditions: InitialConditionsSchema,
  /** V1.8 — convergence detector. Fires a phase 'converged' event once
   *  every observed field's initial residual has been below
   *  `maxInitialResidual` for `stableIterations` consecutive timesteps.
   *  If `autoStop` is true the runner terminates the process group
   *  immediately and emits 'converged' as the final phase instead of
   *  'cancelled'. `enabled=false` disables the detector entirely (the
   *  user may want to run open-loop and decide when to stop). Per-
   *  solver defaults — steady solvers tighten the threshold and lengthen
   *  the streak; `potentialFoam` ships `enabled=false` because it
   *  doesn't converge in the steady sense, it just runs out iterations
   *  by design — live in `SOLVER_CONTROLS_DEFAULTS`. */
  converge: z.object({
    enabled: z.boolean().default(true),
    maxInitialResidual: z.number().positive().default(1e-3),
    stableIterations: z.number().int().min(1).default(50),
    autoStop: z.boolean().default(false),
  }),
  /** V1.9 — numerical corrector counts + SIMPLE residual-control
   *  tolerance, per-solver. The same `numerics` shape lives on the
   *  Domain (added above) — this SolverControlsSchema copy is the
   *  source of truth the UI binds to, and `buildCaseFromPatches`
   *  merges the active solver's entry into the Domain on Build. */
  numerics: NumericsSchema.default({
    enabled: true,
    nNonOrthogonalCorrectors: 0,
    nCorrectors: 2,
    nOuterCorrectors: 1,
    residualControl: '1e-4',
  }),
  /** V1.11 — SIMPLE relaxation-factor overrides, per-solver. Same
   *  pattern as V1.9 numerics: lives on SolverControlsSchema as the
   *  UI source of truth, merged into Domain by buildCaseFromPatches.
   *  Defaults match the V1.10-era hard-coded values for SIMPLE
   *  solvers (p=0.3, U=0.7, buoyantFoam also T=0.7); PIMPLE/PISO
   *  solvers keep empty maps so the template emits no
   *  relaxationFactors block, preserving pre-V1.11 behavior. */
  relaxationFactors: RelaxationFactorsSchema.default({
    // V1.18b — `enabled` flag defaults to `false`. SIMPLE-family
    //  solvers ignore this flag (the fvSolution template emits the
    //  block unconditionally for simpleFoam/buoyantSimpleFoam/potentialFoam
    //  per V1.11); only pimpleFoam + enabled==true emits the
    //  relaxationFactors block. Pre-V1.18b cases load with
    //  enabled: false and the fvSolution template reverts to the
    //  V1.11 behavior (no block for PIMPLE).
    enabled: false,
    fields: {},
    equations: {},
  }),
  /** V1.20 — k-ε turbulence coefficient block, per-solver. Same
   *  two-sided-on-Domain-and-SolverControls pattern as V1.18b's
   *  `relaxationFactors` and V1.19's `adaptiveTimeStep`. Solver-
   *  agnostic defaults (the form only renders the row when the
   *  user picks `kEpsilon`; the values carry across turbulence-
   *  model flips even when the user later picks laminar /
   *  kOmegaSST / SpalartAllmaras, since kOmegaSST and SA defaults
   *  are deferred to V1.21/V1.22 and a future user picking back to
   *  kEpsilon would then re-see the kEpsilon coefficients they
   *  tuned before).
   *
   *  V1.19 fix-pass review mirror — named-schema reference for
   *  symmetry with V1.18d/V1.19 (one source of truth).
   */
  turbulenceCoefficients: KEpsilonCoefficientsSchema.default({
    Cmu: 0.09,
    C1: 1.44,
    C2: 1.92,
    sigmak: 1.0,
    sigmaEps: 1.3,
  }),
  /** V1.21 — k-ω SST coefficient block, per-solver. Parallel slot to
   *  V1.20's `turbulenceCoefficients` (kEpsilon). Same two-sided-on-
   *  Domain-and-SolverControls pattern (named-reference to
   *  `KOmegegaSSTCoefficientsSchema.default(...)`); the form
   *  renders one row of inputs depending on the active turbulence
   *  model; the template gates on `turbulence === "kOmegaSST"`,
   *  reads from THIS field. Solver-agnostic defaults (the form
   *  only renders when the user picks kOmegaSST; the values
   *  carry across turbulence-model flips for symmetry with V1.20,
   *  so a future user picking kEpsilon → kOmegaSST would re-see
   *  the SST coefficients they tuned before).
   *
   *  V1.21 deferred (with reasoning in the schema comment):
   *    `a1` — coupled to fvOptions limitK toggle, out of scope for
   *            the coefficient-form lift. Will land alongside the
   *            limitK fvOptions hookup in a future V.x.
   *
   *  SpalartAllmaras coefficients (v1.22): different family
   *  (one-equation SA: Cb1/Cb2/Cw1/Cw2/Cw3/Cv1/Cv2/sigmaNut/
   *  sigmaEps/kappa/Csigma) — parallel-slot model COULD host them
   *  (per the V1.21 design), but the field-naming is sufficiently
   *  divergent that V1.22 merits its own schema + types.ts slot.
   */
  turbulenceCoefficientsKOmegaSST: KOmegegaSSTCoefficientsSchema.default({
    alphaK1: 0.85,
    alphaK2: 1.0,
    alphaOmega1: 0.5,
    alphaOmega2: 0.856,
    beta1: 0.075,
    beta2: 0.0828,
    betaStar: 0.09,
    C1: 2.0,
    gamma1: 0.5555555555,
    gamma2: 0.875,
    sigmaK: 0.6,
    sigmaOmega: 0.5,
  }),
  // V1.22 -- Spalart-Allmaras coefficient block on the Domain +
  //  SolverControls mirror. Third sibling to V1.20's kEpsilon and
  //  V1.21's kOmegaSST slots; same two-sided-on-Domain-and-SolverControls
  //  pattern (named-reference to SpalartAllmarasCoefficientsSchema
  //  for symmetry with V1.20/V1.21's named references). Applies to
  //  BOTH schemas below via allowMultiple; the inline comment lives
  //  on the SolverControlsSchema copy below for the per-solver
  //  durability note (the Domain copy just carries the schema
  //  default forward).
  //
  //  Defaults match OpenFOAM stock (1994 + Pirzadeh 1999 cubic ramp).
  //  Pre-V1.22 templates emitted no SpalartAllmaras modelCoeffs block,
  //  so OpenFOAM used built-in defaults via the model source; post-V1.22
  //  always emits the block (defaults via Zod chain). The 5 tripped-
  //  SAFvOptions coefficients (At, Bt, ct1, ct2, ct3, ct4) are deferred
  //  to the V.x that lifts general fvOptions support -- same precedent
  //  as V1.21's `a1` for limitK.
  turbulenceCoefficientsSpalartAllmaras: SpalartAllmarasCoefficientsSchema.default({
    sigmaNut: 0.667,
    kappa: 0.41,
    Cb1: 0.1355,
    Cb2: 0.622,
    Cw1: 0.3,
    Cw2: 0.06,
    Cw3: 2.0,
    Cv1: 7.1,
    Cv2: 5.0,
  }),
  // V1.23 -- LES sub-grid-scale coefficient block. Sibling to V1.20 /
  //  V1.21 / V1.22 RANS slots; same two-sided-on-Domain-and-
  //  SolverControls pattern (named-reference to LESCoefficientsSchema).
  //  Application via allowMultiple=true on the SA-default-block
  //  anchor: this drops the LES seed onto BOTH the DomainSchema and
  //  SolverControlsSchema copies in one edit, mirroring the V1.20 /
  //  V1.21 / V1.22 kEpsilon / kOmegaSST / SpalartAllmaras
  //  symmetry. Defaults are OpenFOAM stock (Lilly 1966 /
  //  Nicoud+Ducros 1999): Cs=0.2 (Smagorinsky) / Cw=0.325 (WALE).
  //  Pre-V1.23 templates emitted no modelCoeffs block on the LES
  //  branch (the LES dropdown was filtered out), so OpenFOAM used
  //  built-in defaults via the model source; post-V1.23 always
  //  emits Cs / Cw as appropriate for the active LES model.
  turbulenceCoefficientsLES: LESCoefficientsSchema.default({
    Cs: 0.2,
    Cw: 0.325,
  }),
  // V1.24 -- k-equation LES coefficient block. 5th sibling to V1.20 /
  //  V1.21 / V1.22 / V1.23 slots; same two-sided-on-Domain-and-
  //  SolverControls pattern (named-reference to KEqnCoefficientsSchema).
  //  Dropdown-light: the form only renders this row when the user
  //  picks kEqn; values stay dormant otherwise. Defaults are OpenFOAM
  //  stock (Germano 1991 / Lilly 1967). Other LES variants
  //  (dynamicSmagorinsky / dynamicLagrangian / SpalartAllmarasDES /
  //  kOmegaSSTDES) are deferred to V1.25 / V1.26 -- dynamic variants
  //  have no user-tunable coefficients and DES needs a separate
  //  alpha-blending slot.
  turbulenceCoefficientsKEqn: KEqnCoefficientsSchema.default({
    Ck: 0.094,
    Ce1: 1.048,
    Ce2: 1.048,
  }),
  // V1.25 -- DES shielding coefficient slot (parallel sibling to
  //  V1.20/V1.21/V1.22/V1.23/V1.24). Used only by `kOmegaSSTDES`;
  //  emits nothing in momentumTransport for any other model. OpenFOAM
  //  stock 0.65 mirrors Shur + Spalart + Strelets 2008. Defaults
  //  carry through DomainSchema + SolverControlsSchema mirrors.
  turbulenceCoefficientsCDES: CDESCoefficientSchema.default({
    CDES: 0.65,
  }),
  /** V1.19 — iterative time-stepping toggle (transient solvers only).
   *  Pre-V1.19 the controlDict.hbs template hard-coded OpenFOAM stock
   *  behavior (`adjustTimeStep no;`) for every solver, so users wanting
   *  Courant-bounded adaptive Δt had to hand-edit controlDict. With
   *  `enabled === true` OpenFOAM picks `Δt` every step so Co stays
   *  ≤ `maxCo`; `maxCo` is the absolute target (~0.5-1.0 typical for
   *  transient viscous flows). Solver-agnostic defaults across all
   *  five SOLVER_CONTROLS_DEFAULTS entries (`enabled: false`,
   *  `maxCo: 1` mirroring OpenFOAM stock) so flipping solvers
   *  preserves the user's choice; SIMPLE-family solvers carry the
   *  values on the form but `case.ts` short-circuits the template
   *  gate (only pimpleFoam / icoFoam emit the block) so steady
   *  solvers get the OpenFOAM stock `no` regardless of the toggle.
   *
   *  Why no `maxAlphaCo`: α-Courant is a VoF-specific knob
   *  (controls α-wave propagation in interFoam / compressibleInterFoam
   *  / etc.). The V1.x solver roster (icoFoam, simpleFoam, pimpleFoam,
   *  potentialFoam, buoyantSimpleFoam) does not carry a VoF alpha
   *  field, so emitting `maxAlphaCo` is a dead no-op for every current
   *  solver. Deferred to the V.x that lands a VoF solver
   *  (`interFoam` or `compressibleInterFoam`); once a VoF solver is
   *  in the roster, the field will land alongside its
   *  `transportProperties` carve-out and the per-field
   *  `div(phi,alpha)` lift.
   *
   *  V1.19 fix-pass review — reference the named `AdaptiveTimeStepSchema`
   *  directly rather than the inline `z.object({...})` form so the
   *  camelCase symmetry with V1.18d's `SolverConfigsSchema.default(...)`
   *  is preserved (one-source-of-truth for the literal shape).
   */
  adaptiveTimeStep: AdaptiveTimeStepSchema.default({
    enabled: false,
    maxCo: 1,
  }),
  /** V1.12 — fvSchemes `default` selectors, per-solver. Same
   *  DOM/controller split as V1.9 numerics and V1.11 relaxationFactors.
   *  Per-solver seed picks `steadyState` for ddt on steady solvers
   *  (simpleFoam, buoyantSimpleFoam, potentialFoam) — SIMPLE-family
   *  algorithms are steady-state by definition, so emitting `Euler`
   *  would produce a visibly pointless time loop and confuse convergence
   *  detection. Transients (icoFoam, pimpleFoam) get `Euler` to match
   *  OpenFOAM stock. The other five selectors (grad / div /
   *  laplacian / interpolationDefault / snGradDefault) are solver-
   *  agnostic and use OpenFOAM's stock incompressible defaults uniformly.
   *
   *  V1.13 — `fieldDivs` (per-field divergence overrides) lives
   *  inside the same `schemes` object. Empty maps across all
   *  SOLVER_CONTROLS_DEFAULTS entries (no per-field overrides are
   *  stock — OpenFOAM's stock `Gauss linearUpwind grad(X)` lines
   *  are template-rendered via `{{or override default}}`).
   *
   *  V1.15 — `interpolationDefault` and `snGradDefault` join the
   *  `schemes` object. Both default to OpenFOAM stock (`linear` /
   *  `corrected`) and rely on the closed `FvSchemesSchema.default(...)`
   *  for renderer-state seeding across all five
   *  SOLVER_CONTROLS_DEFAULTS entries (no per-solver spec — both are
   *  solver-agnostic).
   *
   *  V1.16 — `fieldLaplacians` joins the `schemes` object alongside
   *  V1.13's `fieldDivs`. Empty default for every entry across all
   *  five SOLVER_CONTROLS_DEFAULTS — no per-field overrides are
   *  stock; the fvSchemes.hbs `{{or override "Gauss linear corrected"}}`
   *  helper handles the fallback to the laplacianDefault value at
   *  render time.
   *
   *  V1.17 — `fieldSnGrads` joins the `schemes` object alongside
   *  V1.16's `fieldLaplacians`. Same empty-default pattern across all
   *  five SOLVER_CONTROLS_DEFAULTS; the fvSchemes.hbs `{{or override
   *  "corrected"}}` helper falls back to the snGradDefault value at
   *  render time. */
  schemes: FvSchemesSchema.default({
    ddtDefault: 'Euler',
    gradDefault: 'Gauss linear',
    divDefault: 'none',
    laplacianDefault: 'Gauss linear corrected',
    interpolationDefault: 'linear',
     snGradDefault: 'corrected',
     fieldDivs: {},
     fieldLaplacians: {},
     fieldSnGrads: {},
   }),
   // V1.18d — per-solver matrix-solver configurations. Solver-
   //  agnostic defaults (solver-agnostic per the V1.18 designer
   //  recommendation); defaults match the V1.17 template's
   //  hard-coded values so pre-V1.18d cases parse identically.
   solverConfigs: SolverConfigsSchema.default({
     p: { solver: 'GAMG', tolerance: 1e-7, relTol: 0.01 },
     U: { solver: 'smoothSolver', tolerance: 1e-7, relTol: 0.1 },
     turbulence: { solver: 'smoothSolver', tolerance: 1e-7, relTol: 0.1 },
   }),
 });
export type SolverControls = z.infer<typeof SolverControlsSchema>;

/**
 * Per-solver map of last-good controls. The user can flip the solver
 * dropdown without losing their tweaks — each solver keeps its own
 * deltaT / writeInterval / purgeWrite / cores / nu.
 * Resolved by `buildCaseFromPatches` from `state.formSolver`.
 */
export type SolverControlsBySolver = Record<Solver, SolverControls>;

// ---------- Residuals & logs ----------

export const ResidualPointSchema = z.object({
  time: z.number(),
  fields: z.record(z.string(), z.number()),
});
export type ResidualPoint = z.infer<typeof ResidualPointSchema>;

/** Wire-format of a residual sample as broadcast from main to renderer.
 *  Carries `runId` so the renderer can drop stale events from a previous run. */
export interface RunResidualEvent extends ResidualPoint {
  runId: string;
}

export const LogChunkSchema = z.object({
  stream: z.enum(['stdout', 'stderr']),
  text: z.string(),
});
export type LogChunk = z.infer<typeof LogChunkSchema>;

/** Wire-format of a log delta as broadcast from main to renderer. */
export interface RunLogEvent extends LogChunk {
  runId: string;
}

/** Wire-format of a phase transition. */
export interface RunPhaseEvent {
  phase: Phase;
  message?: string;
  runId: string;
}

// ---------- IPC request / response envelopes ----------

export const OpenfoamDetectedSchema = z.object({
  found: z.boolean(),
  version: z.string().optional(),
  bashrc: z.string().optional(),
  binPaths: z.array(z.string()).optional(),
  installHints: z.array(z.string()).optional(),
});
export type OpenfoamDetected = z.infer<typeof OpenfoamDetectedSchema>;

export const RunResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  runId: z.string().optional(),
  caseDir: z.string().optional(),
});
export type RunResult = z.infer<typeof RunResultSchema>;

export const CaseSavedSchema = z.object({
  ok: z.boolean(),
  path: z.string().optional(),
  message: z.string().optional(),
});
export type CaseSaved = z.infer<typeof CaseSavedSchema>;

export const AppSettingsSchema = z.object({
  openfoamBashrc: z.string().optional(),
  defaultRunRoot: z.string().optional(),
  maxLogBufferLines: z.number().int().positive().default(2000),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

// ---------- Geometry prep ----------

export const GeometryFormatSchema = z.enum(['STEP', 'STL', 'IGES']);
export type GeometryFormat = z.infer<typeof GeometryFormatSchema>;

/** Bounding box (axis-aligned) of a loaded solid, used for domain sizing. */
export interface BoundingBoxMinMax {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/** One picked face group from the OCCT mesher (a face tessellated to N triangles). */
export interface FaceGroup {
  /** Index of this face in the parent shape. */
  faceIndex: number;
  /** Start (in the index buffer) of this face's triangles. */
  start: number;
  /** Number of triangles for this face. */
  count: number;
  /** Optional: face area in m^2 (computed lazily). null until queried. */
  area: number | null;
}

/** Result of importing + meshing a geometry file in the renderer. */
export const LoadedGeometrySchema = z.object({
  /** Original file path, for round-tripping / error messages. */
  path: z.string(),
  /** Format the file was loaded from. */
  format: GeometryFormatSchema,
  /** Total triangle count across all faces. */
  triangleCount: z.number().int().nonnegative(),
  /** Total face count. */
  faceCount: z.number().int().nonnegative(),
  /** Axis-aligned bounding box of the parent shape. */
  bbox: z.object({
    min: z.object({ x: z.number(), y: z.number(), z: z.number() }),
    max: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  }),
});
export type LoadedGeometry = z.infer<typeof LoadedGeometrySchema>;

/** A user-defined patch (grouping of selected faces), exported as a single STL
 *  for snappyHexMesh's constant/triSurface/<name>.stl entries. */
export interface GeometryPatch {
  id: string;
  name: string;
  faceIndices: number[];
  /** Triangle count across all faces in this patch (filled on creation). */
  triangleCount: number;
  /** STL file path the patch was last exported to, relative to the case dir. */
  lastExportedRelPath: string | null;
}

// ---------- IPC channel names ----------

export const IpcChannels = {
  // main -> renderer (event)
  log: 'cfd:log',
  phase: 'cfd:phase',
  residuals: 'cfd:residuals',
  // renderer -> main (invoke)
  openfoamDetect: 'cfd:openfoamDetect',
  openfoamSettingsSave: 'cfd:openfoamSettingsSave',
  openfoamSettingsLoad: 'cfd:openfoamSettingsLoad',
  openfoamVerifyBashrc: 'cfd:openfoamVerifyBashrc',
  caseCreate: 'cfd:caseCreate',
  caseSave: 'cfd:caseSave',
  caseLoad: 'cfd:caseLoad',
  caseList: 'cfd:caseList',
  runStart: 'cfd:runStart',
  runCancel: 'cfd:runCancel',
  runStatus: 'cfd:runStatus',
  resultsList: 'cfd:resultsList',
  resultsRead: 'cfd:resultsRead',
  // results panel (V1.1) — lazy per-time field listing + OS file-manager actions
  resultsListFields: 'cfd:results:listFields',
  resultsRevealVTK: 'cfd:results:revealVTK',
  resultsOpenVTKDir: 'cfd:results:openVTKDir',
  // geometry prep (added in V0.5)
  geometryFilePickAndRead: 'cfd:geometry:pickAndRead',
  geometryFileWrite: 'cfd:geometry:write',
  geometryCaseList: 'cfd:geometry:caseList',
} as const;
export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

/**
 * V1.31a — wire-format shape for the `runStart` IPC main handler's
 *  optional `convergence:` sub-object. Extracted from the inline
 *  `z.object({...}).optional()` in `src/main/ipc/index.ts`'s runStart
 *  handler so the renderer/main contract is testable without pulling
 *  Electron into the vitest node env (the IPC handler imports
 *  `electron`'s `ipcMain`, which is unavailable in unit-test contexts).
 *
 *  Differences from `SolverControlsSchema.shape.converge` are
 *  deliberate and locked by a shape-parity test (see
 *  `run-payload-schemas.test.ts`):
 *  - **no `.default(...)` calls** — the wire only carries what the
 *    renderer actually sent; missing-key is `undefined`, treated as
 *    "detector disabled" by the runner pre-V1.8.
 *  - **`stableIterations` is `.int().positive()`** — rejects 0 and
 *    negative reals. `SolverControlsSchema.converge` uses
 *    `.int().min(1)`, which has the same rejection set on integers;
 *    slight syntax difference, same semantic. The drift-detector
 *    test parses identical canonical input through both schemes and
 *    asserts `toEqual` so a future divergence (e.g., setting a
 *    different positive bound) fails immediately.
 *  - **strict-mode-by-convention**: this schema doesn't include
 *    `.strict()` because the parent `z.object({...})` in main/ipc/index.ts
 *    isn't strict either — extra unknown keys (e.g., the V1.30
 *    first-pass `converge:` typo) silently strip and `convergence`
 *    resolves to `undefined`. That's the actual V1.30 bug and the
 *    regression-net test pins it: send-with-wrong-key yields
 *    `convergence: undefined`, send-with-right-key yields the parsed
 *    object.
 */
export const RunStartConvergenceSchema = z.object({
  enabled: z.boolean(),
  maxInitialResidual: z.number().positive(),
  stableIterations: z.number().int().positive(),
  autoStop: z.boolean(),
});
export type RunStartConvergence = z.infer<typeof RunStartConvergenceSchema>;

/**
 * V1.31a — full wire-format envelope for the `runStart` IPC handler
 *  in `src/main/ipc/index.ts`. Mirrors the inline parse shape so the
 *  V.0 keystroke + V1.30 first-pass-bug regression test can run
 *  without importing the IPC handler's electron dependency. Behavior
 *  matches `z.object({...}).parse(args)` on the main side verbatim —
 *  the parser is non-strict, so unknown keys (e.g., the V1.30
 *  `converge:` typo) silently strip rather than throw, leaving the
 *  detector config stranded on the wire. The regression test pins
 *  this behavior so a future `.strict()` migration (intentional or
 *  accidental) gets caught before it ships.
 */
export const RunStartEnvelopeSchema = z.object({
  /** Renderer-allocated runId so events from this run can be
   *  filtered deterministically by the renderer regardless of IPC
   *  ordering. */
  runId: z.string().min(1),
  caseDir: z.string(),
  bashrc: z.string(),
  cores: z.number().int().min(1).max(64),
  solver: z.string(),
  /** V1.8 — convergence detector settings. Optional; undefined
   *  disables the detector downstream. */
  convergence: RunStartConvergenceSchema.optional(),
});
export type RunStartEnvelope = z.infer<typeof RunStartEnvelopeSchema>;

/**
 * V1.35c — wire-format shape for the `geometryFilePickAndRead` IPC
 *  handler in `src/main/ipc/index.ts`. Extracted from the previously-
 *  inline `z.object({ format: z.enum([...]) })` shape so vitest can
 *  exercise it without pulling in Electron's `dialog` (the IPC
 *  handler imports `dialog`, which is unavailable in unit-test
 *  contexts -- same blocker V1.31a closed for `RunStartEnvelopeSchema`).
 *
 *  Reuses the existing `GeometryFormatSchema` ('STEP' | 'STL' | 'IGES')
 *  for the format enum rather than re-listing the literals -- a future
 *  format addition (e.g. 'OBJ' if the OCCT-backed mesher grows one)
 *  lands in `GeometryFormatSchema` and this schema inherits it
 *  automatically. The drift-safety test in
 *  `geometry-ipc-schemas.test.ts` pins that pair.
 *
 *  Non-strict by convention (no `.strict()` on the parent object) --
 *  the renderer may pass extra metadata (e.g., a future
 *  `lastPickPath` for "open from previous location" affordance) and
 *  those should silently strip rather than throw. The IPC regression
 *  net in V1.31a established this contract; we mirror it here.
 */
export const GeometryFilePickArgsSchema = z.object({
  format: GeometryFormatSchema,
});
export type GeometryFilePickArgs = z.infer<typeof GeometryFilePickArgsSchema>;

/**
 * V1.35c — wire-format shape for the `geometryFileWrite` IPC handler
 *  in `src/main/ipc/index.ts`. Extracted from the previously-inline
 *  `z.object({ path: ..., bytes: z.instanceof(Uint8Array) })` shape.
 *
 *  The `z.instanceof(Uint8Array)` check is deliberate: the renderer
 *  passes geometry-file bytes through Electron's structured-clone IPC
 *  pipeline, which preserves Buffer-view semantics for typed arrays
 *  but DOES NOT preserve plain number-arrays / ArrayBuffers in the
 *  same way (a plain Array crosses the IPC boundary by JSON-serializing
 *  to number[], losing byte-precision for high-entropy binary content).
 *  `Uint8Array` is the contract; the regression net tests that
 *  Buffer / ArrayBuffer / number-array inputs are rejected at parse
 *  time before reaching `fs.writeFile`.
 *
 *  Path goes through `z.string()` with no `.min(1)` because path
 *  validation (existence / writability) happens at the OS layer --
 *  the schema contract is just "renderer handed us a string we can
 *  pass to `path.dirname()`."
 *
 *  Non-strict by convention (extra keys silently strip) -- mirrors
 *  the RunStartEnvelopeSchema contract.
 */
export const GeometryFileWriteArgsSchema = z.object({
  path: z.string(),
  bytes: z.instanceof(Uint8Array),
});
export type GeometryFileWriteArgs = z.infer<typeof GeometryFileWriteArgsSchema>;

/**
 * V1.36c — wire-format shape for the `openfoamVerifyBashrc` IPC
 *  handler in `src/main/ipc/index.ts`. Extracted from the previously-
 *  inline `z.object({ path: z.string() })` shape so vitest can
 *  exercise it without pulling in Electron's `ipcMain` (same
 *  V1.31a / V1.35c blocker closed for the other IPC envelope
 *  schemas above).
 *
 *  The `path` field is destructured-and-renamed to `bashrcPath` in
 *  the handler (`const { path: bashrcPath } = ...`) because the
 *  local `path.join(...)` call elsewhere in the file would shadow
 *  a `path` property name. The wire-format field stays `path` for
 *  semantic parity with the renderer-side call site (which reads
 *  "the path to verify").
 *
 *  Non-strict by convention (extra keys silently strip) — mirrors
 *  the RunStartEnvelopeSchema / GeometryFilePickArgsSchema contract.
 *  The drift-safety pin in
 *  `src/shared/__tests__/verify-bashrc-args.test.ts` covers the
 *  happy + missing-key + wrong-type cases so a future schema
 *  drift gets caught before it ships.
 */
export const VerifyBashrcArgsSchema = z.object({
  path: z.string(),
});
export type VerifyBashrcArgs = z.infer<typeof VerifyBashrcArgsSchema>;

/**
 * V1.36c — wire-format shape for the `resultsRead` IPC handler in
 *  `src/main/ipc/index.ts`. Extracted from the previously-inline
 *  `z.object({ caseDir, time, field })` shape. The fs read +
 *  try/catch envelope is in `readResultField` (helpers.ts); this
 *  schema only pins the *wire* shape — the renderer must send a
 *  string caseDir, numeric time, string field name.
 *
 *  `time` is `z.number()` (not `z.string()`) because the renderer
 *  surfaces time directories as a parsed number list via
 *  `parseResultTimes` (see helpers.ts). The wire sends back the
 *  same numeric value; `readResultField`'s `path.join(caseDir,
 *  String(time), field)` does the textual coercion downstream.
 *
 *  Non-strict by convention (extra keys silently strip) — mirrors
 *  the rest of the IPC envelope schema contract.
 */
export const ResultReadArgsSchema = z.object({
  caseDir: z.string(),
  time: z.number(),
  field: z.string(),
});
export type ResultReadArgs = z.infer<typeof ResultReadArgsSchema>;

// V1.36f -- IPC envelope schema for the runCancel handler. Pairs the
//  runId string into a typed envelope so the renderer/main wire-format
//  contract is testable without pulling in Electron (same drift-safety
//  rationale as V1.35c's GeometryFilePick/WriteArgsSchema and
//  V1.36c's VerifyBashrc/ResultReadArgsSchema). The runCancel IPC
//  handler uses this named schema instead of the previously-inline
//  `z.object({ runId: z.string() })` parse.
export const RunCancelArgsSchema = z.object({ runId: z.string() });
export type RunCancelArgs = z.infer<typeof RunCancelArgsSchema>;

// V1.40 -- IPC envelope schema for the caseCreate handler. The full
//  payload (kind + domain + bc + optional label + optional per-patch
//  refinements) is the most structurally-complex envelope in the
//  IPC surface; the inline `z.object({...})` parse in the caseCreate
//  handler references 4 sub-schemas (CaseKindSchema, DomainSchema,
//  BoundaryConditionsSchema, PatchRefinementSchema). Lifting to a
//  named schema pairs the V1.36c/V1.36f drift-safety rationale --
//  the wire-format contract is testable without pulling in Electron's
//  `ipcMain` (the IPC handler imports `electron`, which is
//  unavailable in vitest's node env).
//
//  The `label` and `refinements` fields stay optional to match the
//  inline behavior: a renderer payload without a label falls through
//  to the IPC handler's `pickCaseDir(undefined)` which uses the
//  default-fallthrough 'case' label; a payload without refinements
//  parses to `{}` and the case-helpers' `buildRenderContext` reads
//  it as an empty per-patch map (every patch renders as `level
//  (0 0);`). Non-strict by convention (no `.strict()` on the parent
//  object) -- a future renderer metadata key would silently strip
//  rather than throw, matching the V1.36c / V1.36f / RunStartEnvelopeSchema
//  pattern.
export const CaseCreateArgsSchema = z.object({
  kind: CaseKindSchema,
  domain: DomainSchema,
  bc: BoundaryConditionsSchema,
  label: z.string().optional(),
  refinements: z.record(z.string(), PatchRefinementSchema).optional(),
});
export type CaseCreateArgs = z.infer<typeof CaseCreateArgsSchema>;

// V1.40 -- IPC envelope schema for the caseSave handler. Mirrors
//  CaseCreateArgsSchema but takes a `caseDir` (the on-disk directory
//  to overwrite) instead of a `label` (the new directory's
//  human-readable component). caseSave is the in-place mutation
//  path: the renderer hands the IPC the existing caseDir + a fresh
//  domain + bc + refinements, the IPC re-renders into the same
//  directory, and the .cfd-app-state.json sidecar is rewritten.
//  Lifting to a named schema mirrors the caseCreate lift rationale
//  (drift-safety + electron-free testability). The optional
//  `refinements` field matches the caseCreate schema; the caseDir
//  is required (no default -- the renderer's "Save" button
//  always has a target directory).
export const CaseSaveArgsSchema = z.object({
  caseDir: z.string(),
  kind: CaseKindSchema,
  domain: DomainSchema,
  bc: BoundaryConditionsSchema,
  refinements: z.record(z.string(), PatchRefinementSchema).optional(),
});
export type CaseSaveArgs = z.infer<typeof CaseSaveArgsSchema>;

// V1.40 -- IPC envelope schema for the caseLoad handler. Simple
//  1-field envelope (the on-disk case directory to read). Lifting
//  to a named schema is for drift-safety-pair uniformity with the
//  other case-flow envelopes (CaseCreateArgsSchema +
//  CaseSaveArgsSchema) rather than for any complex field-shape
//  reason -- the inline `z.object({ caseDir: z.string() })` is
//  already a 1-liner. Non-strict by convention (no `.strict()`).
export const CaseLoadArgsSchema = z.object({ caseDir: z.string() });
export type CaseLoadArgs = z.infer<typeof CaseLoadArgsSchema>;

// V1.40 -- IPC envelope schema for the resultsList handler. Lists
//  the numeric solver-time directories under a case. The handler
//  delegates the actual fs read to `parseResultTimes(caseDir)` in
//  @main/ipc/helpers -- the envelope is just the caseDir string.
//  Non-strict by convention.
export const ResultsListArgsSchema = z.object({ caseDir: z.string() });
export type ResultsListArgs = z.infer<typeof ResultsListArgsSchema>;

// V1.40 -- IPC envelope schema for the resultsListFields handler.
//  Lists the field-file names under a single
//  `<caseDir>/<time>/` directory. `time` is `z.number()` (not
//  `z.string()`) because the renderer surfaces time directories
//  as a parsed number list via `parseResultTimes` (the IPC's
//  helper) and the wire sends back the same numeric value; the
//  `path.join(caseDir, String(time), field)` in `parseResultFields`
//  does the textual coercion downstream. Non-strict by convention.
export const ResultsListFieldsArgsSchema = z.object({
  caseDir: z.string(),
  time: z.number(),
});
export type ResultsListFieldsArgs = z.infer<typeof ResultsListFieldsArgsSchema>;

// V1.40 -- IPC envelope schema for the resultsRevealVTK handler.
//  Reveals the case's VTK output (or the case dir itself if VTK
//  hasn't been written yet) in the OS file manager via
//  `shell.showItemInFolder`. 1-field envelope; non-strict.
export const ResultsRevealVTKArgsSchema = z.object({ caseDir: z.string() });
export type ResultsRevealVTKArgs = z.infer<typeof ResultsRevealVTKArgsSchema>;

// V1.40 -- IPC envelope schema for the resultsOpenVTKDir handler.
//  Opens the case's VTK output (or the case dir itself if VTK
//  hasn't been written yet) via `shell.openPath`. 1-field envelope;
//  non-strict.
export const ResultsOpenVTKDirArgsSchema = z.object({ caseDir: z.string() });
export type ResultsOpenVTKDirArgs = z.infer<typeof ResultsOpenVTKDirArgsSchema>;

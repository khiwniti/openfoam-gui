/**
 * Right-side panel for patch management.
 *
 * Layout:
 *   • "Selection" section — face index list (capped), quick clear button.
 *   • "Patches" section — list of named patches; each has an export button.
 *   • "New patch" input row at the bottom.
 */
import { useState } from "react";
// V1.21 -- k-omega-SST coefficient preview helper. Extracted to its
//  own module after V1.20's KEpsilonCoefficientsPreview pattern proved
//  brittle to inline-anchor editor flakiness in this file (multiple
//  `str_replace` attempts with unique anchor tails reported "not found
//  in file" despite grep confirming the lines). Co-located in the
//  components/ dir for the same import-style convenience as the V1.20
//  helper that still lives inline next to its closure block.
import { KOmegegaSSTCoefficientsPreview } from "./KOmegegaSSTCoefficientsPreview";
// V1.22 -- Spalart-Allmaras coefficient preview helper. Extracted to its
//  own module after V1.21's KOmegegaSSTCoefficientsPreview precedent
//  proved the same anchor-editor flakiness applies to ANY inline
//  helper-component insertion (Greek-letter close-out text + 80+ LOC
//  of preview JSX). Sibling file in components/ for the same import
//  convention V1.21 uses.
import { SpalartAllmarasCoefficientsPreview } from "./SpalartAllmarasCoefficientsPreview";
// V1.23 -- LES sub-grid-scale coefficient preview helper. Same
//  module-split precedent as V1.21 / V1.22 extracted helpers.
//  Switches display + tolerance gate on the `model` prop because
//  Smagorinsky (Cs) and WALE (Cw) are different physical regimes
//  with different stock values.
import { LESCoefficientsPreview } from "./LESCoefficientsPreview";
// V1.24 — k-equation LES sub-grid-scale coefficient preview helper.
//  Following the V1.21 / V1.22 / V1.23 module-split precedent.
import { KEqnCoefficientsPreview } from "./KEqnCoefficientsPreview";
import { CDESCoefficientsPreview } from "./CDESCoefficientsPreview";
import { useGeometryStore } from "../store";
import type {
  BcField,
  BoundaryConditions,
  PatchRefinement,
  PatchRefinements,
  SolverControls,
} from "@shared/types";
// V1.12 — type aliases for the four unlocked fvSchemes `default`
//  values. Grid rows accept only the enum literals (no free-form
//  strings) — a `<select>` with the matching options makes drift
//  impossible because Zod defaults won't pre-fill anything else.
// V1.15 — `InterpolationSchemeValue` / `SnGradSchemeValue` deliberately
//  not imported here. The V1.12 fix-pass closure (`<K extends keyof
//  SolverControls["schemes"]>`) narrows call sites automatically when
//  new keys are added to FvSchemesSchema, so the new enums flow through
//  inference rather than direct annotation. Pulling the type names in
//  would just be documentary — and documentary-only imports tend to
//  rot when the schema evolves, so we keep the import surface minimal.
import type {
  AdaptiveTimeStep,
  DivFieldOverrides,
  DivSchemeValue,
  KEpsilonCoefficients,
  KEqnCoefficients, CDESCoefficient,
  KOmegegaSSTCoefficients,
  LESCoefficients,
  LaplacianFieldSchemeValue,
  MatrixSolverValue,
  PerFieldLaplacianOverrides,
  PerFieldSnGradOverrides,
  SnGradFieldSchemeValue,
  SpalartAllmarasCoefficients,
} from "@shared/types";

// V1.30 — alias ResidualOverrideInput JSX tag to the canonical
// ResidualOverrideRow helper so the 8 `<ResidualOverrideInput ...>`
// occurrences at L991-L1050 don't trip TS2552. Same component, two
// names; preserving them avoids renaming the call sites. Function
// declarations are hoisted, so the alias compiles despite the
// original definition living further down the file.
const ResidualOverrideInput: typeof ResidualOverrideRow = ResidualOverrideRow;

export function PatchPanel() {
  const prep = useGeometryStore((s) => s.prep);
  const selectedFaceIds = useGeometryStore((s) => s.selectedFaceIds);
  const patches = useGeometryStore((s) => s.patches);
  const clearSelection = useGeometryStore((s) => s.clearSelection);
  const createPatch = useGeometryStore((s) => s.createPatch);
  const assignSelectionToPatch = useGeometryStore((s) => s.assignSelectionToPatch);
  const deletePatch = useGeometryStore((s) => s.deletePatch);
  const exportPatch = useGeometryStore((s) => s.exportPatch);
  const activeCaseDir = useGeometryStore((s) => s.activeCaseDir);
  // V1.2 — boundary conditions slice.
  const boundaryConditions = useGeometryStore((s) => s.boundaryConditions);
  const setPatchBc = useGeometryStore((s) => s.setPatchBc);
  // V1.4 — per-patch snappy refinement levels.
  const patchRefinements = useGeometryStore((s) => s.patchRefinements);
  const setPatchRefinement = useGeometryStore((s) => s.setPatchRefinement);
  const refreshCases = useGeometryStore((s) => s.refreshCases);
  const buildCaseFromPatches = useGeometryStore((s) => s.buildCaseFromPatches);

  // V1.1 — results panel
  const resultsAvailableTimes = useGeometryStore((s) => s.resultsAvailableTimes);
  const resultsFieldsByTime = useGeometryStore((s) => s.resultsFieldsByTime);
  const resultsSelectedTime = useGeometryStore((s) => s.resultsSelectedTime);
  const resultsSelectedField = useGeometryStore((s) => s.resultsSelectedField);
  const resultsIsLoading = useGeometryStore((s) => s.resultsIsLoading);
  const selectResultsTime = useGeometryStore((s) => s.selectResultsTime);
  const selectResultsField = useGeometryStore((s) => s.selectResultsField);
  const revealResultsInFileManager = useGeometryStore((s) => s.revealResultsInFileManager);
  const openResultsDir = useGeometryStore((s) => s.openResultsDir);

  const [newName, setNewName] = useState<string>("inlet");

  // Form state for the "Build Case" panel. V1.5: solver / endTime / cores /
  // nu are now in the global slice (`solverControlsBySolver`) so they
  // survive page reloads, and new deltaT / writeInterval / purgeWrite join
  // them. Build Case-specific knobs (paddingPercent, label) stay local —
  // they're case-internal rather than user-preference.
  const [paddingPercent, setPaddingPercent] = useState<number>(25);
  const [label, setLabel] = useState<string>("snappy-case");
  // V1.5 — solver runtime controls persisted across page reloads.
  const solverControlsBySolver = useGeometryStore((s) => s.solverControlsBySolver);
  const formSolver = useGeometryStore((s) => s.formSolver);
  const setFormSolver = useGeometryStore((s) => s.setFormSolver);
  const setSolverControl = useGeometryStore((s) => s.setSolverControl);
  const formValues = solverControlsBySolver[formSolver];
  // Steady solvers treat t as iteration count — Δt is fixed at 1 and the
  // input is masked so users can't enter nonsense.
  const isSteady = formSolver === "simpleFoam" || formSolver === "buoyantSimpleFoam" || formSolver === "potentialFoam";
  // V1.7 — local aliases for initialConditions so the JSX stays readable.
  //  `setSolverControl(formSolver, "initialConditions", {...})` does a
  //  shallow merge at the call site (we pass the full new object each
  //  time, since the inner x/y/z are typed numbers).
  const icVel = formValues.initialConditions.velocity;
  const icP = formValues.initialConditions.pressure;
  const setIcVel = (axis: "x" | "y" | "z", raw: string) => {
    const n = Number(raw);
    // NaN guard: cleared inputs (`""`) coerce to 0 (finite), bad input
    // (`"abc"`) coerces to NaN and we keep the old axis value so the field
    // doesn't accumulate `NaN`. Spread + index keeps it one branch instead
    // of a per-axis ternary.
    setSolverControl(formSolver, "initialConditions", {
      velocity: { ...icVel, [axis]: Number.isFinite(n) ? n : icVel[axis] },
      pressure: icP,
    });
  };
  const setIcP = (raw: string) => {
    const n = Number(raw);
    setSolverControl(formSolver, "initialConditions", {
      velocity: { x: icVel.x, y: icVel.y, z: icVel.z },
      pressure: Number.isFinite(n) ? n : 0,
    });
  };
  // V1.10 — set or clear a single per-field residual-tolerance
  //  override. Empty input => drop the key (so the template falls
  //  back to the global `residualControl`); non-empty + finite
  //  positive => set the override. The closure references
  //  `formValues.numerics.residualControlByField` directly so each
  //  edit overwrites only the targeted field without disturbing
  //  sibling overrides.
  //
  //  V1.10 review-fix #3 — empty-input is the only signal to drop a
  //  key, so a deliberate clear and an accidental backspace are
  //  indistinguishable today. There's no toast or undo affordance;
  //  a future V.x with per-case Zustand undo (or a "last cleared"
  //  inline banner) would close this. For now the user just has
  //  to retype the value.
  const updateFieldOverride = (field: string, raw: string) => {
    const cur = formValues.numerics.residualControlByField;
    if (raw === "") {
      if (!(field in cur)) return;
      const next = { ...cur };
      delete next[field];
      setSolverControl(formSolver, "numerics", {
        ...formValues.numerics,
        residualControlByField: next,
      });
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    setSolverControl(formSolver, "numerics", {
      ...formValues.numerics,
      residualControlByField: { ...cur, [field]: String(n) },
    });
  };
  // V1.11 — set or clear a single SIMPLE relaxation-factor
  //  override. Mirrors `updateFieldOverride` above: empty input
  //  drops the key (template falls back to the V1.10-era
  //  hard-coded value of 0.3 / 0.7); non-empty + finite + positive
  //  writes the override. `group` discriminates between `fields`
  //  (p, T) and `equations` (U, k, epsilon, omega, nuTilda);
  //  spreading the destination map keeps sibling overrides intact.
  const updateRelaxationFactor = (
    group: "fields" | "equations",
    key: string,
    raw: string,
  ) => {
    const curGroup = formValues.relaxationFactors[group];
    if (raw === "") {
      if (!(key in curGroup)) return;
      const nextGroup = { ...curGroup };
      // V1.30 — Reflect.deleteProperty silences TS7053 (string-key into the
      //  `{p?,T?} | {U?,k?,epsilon?,omega?,nuTilda?}` discriminated union)
      //  without forcing a redundant cast at the call site. Runtime behavior
      //  is identical to `delete nextGroup[key]`.
      Reflect.deleteProperty(nextGroup, key);
      setSolverControl(formSolver, "relaxationFactors", {
        ...formValues.relaxationFactors,
        [group]: nextGroup,
      });
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    setSolverControl(formSolver, "relaxationFactors", {
      ...formValues.relaxationFactors,
      [group]: { ...curGroup, [key]: n },
    });
  };
  // V1.12 — set a single fvSchemes `default` value. Unlike
  //  `updateFieldOverride` / `updateRelaxationFactor` (which drop
  //  empty inputs to a "fall back" sentinel), the schemes dropdown
  //  never sends an emptystring — `<select>` always emits one of
  //  the enum literals. So the closure just spreads the current
  //  schemes object and overwrites the targeted key. The ddt
  //  selector is gated in the JSX (locked to `steadyState` for
  //  steady solvers) so non-viable values can't reach this
  //  closure on steady solvers.
  //
  //  V1.12 review-fix — typed against `keyof SolverControls["schemes"]`
  //  so callers get per-key narrowing for free (no `as DdtSchemeValue`
  //  casts at the four call sites, no `as SolverControls["schemes"]`
  //  cast inside the closure). Equivalent at runtime, clearer at the
  //  call site.
  const updateScheme = <K extends keyof SolverControls["schemes"]>(
    key: K,
    value: SolverControls["schemes"][K],
  ) => {
    setSolverControl(formSolver, "schemes", {
      ...formValues.schemes,
      [key]: value,
    });
  };
  // V1.13 — set or clear a single per-field divergence override.
  //  Mirrors the V1.10 / V1.11 "empty-input drops the key" pattern:
  //  the Build Case form's per-field divergence dropdowns include
  //  a "(stock — Gauss linearUpwind)" placeholder option with value
  //  `""`; selecting it removes the override from `fieldDivs` so the
  //  template `{{or schemes.fieldDivs.div_phi_X "Gauss linearUpwind"}}`
  //  fallback re-engages at render time. Non-empty selection sets the
  //  override entry. Spreading `fieldDivs` keeps sibling overrides
  //  intact when editing one field.
  const updateFieldDiv = (key: keyof DivFieldOverrides, value: DivSchemeValue | "") => {
    if (value === "") {
      if (!(key in formValues.schemes.fieldDivs)) return;
      const next = { ...formValues.schemes.fieldDivs };
      delete next[key];
      setSolverControl(formSolver, "schemes", {
        ...formValues.schemes,
        fieldDivs: next,
      });
      return;
    }
    setSolverControl(formSolver, "schemes", {
      ...formValues.schemes,
      fieldDivs: {
        ...formValues.schemes.fieldDivs,
        [key]: value,
      },
    });
  };
  // V1.16 — set or clear a single per-field laplacian override. Mirrors
  //  `updateFieldDiv` (V1.13) byte-for-byte, swapping DivFieldOverrides
  //  for PerFieldLaplacianOverrides and DivSchemeValue for
  //  LaplacianFieldSchemeValue. Empty-string sentinel drops the override
  //  so the fvSchemes.hbs `{{or schemes.fieldLaplacians.X "Gauss linear
  //  corrected"}}` fallback re-engages at render time, exactly mirroring
  //  the per-field divergence flow.
  const updateFieldLaplacian = (
    key: keyof PerFieldLaplacianOverrides,
    value: LaplacianFieldSchemeValue | "",
  ) => {
    if (value === "") {
      if (!(key in formValues.schemes.fieldLaplacians)) return;
      const next = { ...formValues.schemes.fieldLaplacians };
      delete next[key];
      setSolverControl(formSolver, "schemes", {
        ...formValues.schemes,
        fieldLaplacians: next,
      });
      return;
    }
    setSolverControl(formSolver, "schemes", {
      ...formValues.schemes,
      fieldLaplacians: {
        ...formValues.schemes.fieldLaplacians,
        [key]: value,
      },
    });
  };
  // V1.17 — set or clear a single per-field snGrad override. Mirrors
  //  `updateFieldLaplacian` (V1.16) byte-for-byte, swapping
  //  PerFieldLaplacianOverrides for PerFieldSnGradOverrides and
  //  LaplacianFieldSchemeValue for SnGradFieldSchemeValue. Empty-string
  //  sentinel drops the override so the fvSchemes.hbs
  //  `{{or schemes.fieldSnGrads.X "corrected"}}` fallback re-engages at
  //  render time.
  const updateFieldSnGrad = (
    key: keyof PerFieldSnGradOverrides,
    value: SnGradFieldSchemeValue | "",
  ) => {
    if (value === "") {
      if (!(key in formValues.schemes.fieldSnGrads)) return;
      const next = { ...formValues.schemes.fieldSnGrads };
      delete next[key];
      setSolverControl(formSolver, "schemes", {
        ...formValues.schemes,
        fieldSnGrads: next,
      });
      return;
    }
    setSolverControl(formSolver, "schemes", {
      ...formValues.schemes,
      fieldSnGrads: {
        ...formValues.schemes.fieldSnGrads,
        [key]: value,
      },
    });
  };
  // V1.19 — set the adaptiveTimeStep toggle (boolean) and the maxCo
  //  Courant target. Two closures (rather than one parametric) because
  //  the checkbox setter and the number setter share no kwarg shape,
  //  and the V1.18b pattern (separate `updateRelaxationFactor`) is the
  //  closest analog. `maxCo` is positive-only and clamped to a
  //  OpenFOAM-meaningful upper bound (~10.0; values above 5 typically
  //  lose transient accuracy). The `enabled` flag is solver-gated
  //  in the template by `case.ts`'s `emitAdaptiveTimeStep` boolean,
  //  so the form persists the user's choice across solver flips but
  //  only pimpleFoam / icoFoam actually write the `adjustTimeStep
  //  yes;` line into controlDict.
  const toggleAdaptiveTimeStep = (enabled: boolean) => {
    setSolverControl(formSolver, "adaptiveTimeStep", {
      ...formValues.adaptiveTimeStep,
      enabled,
    });
  };
  const setMaxCo = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n > 10) return;
    setSolverControl(formSolver, "adaptiveTimeStep", {
      ...formValues.adaptiveTimeStep,
      maxCo: n,
    });
  };
  // V1.20 — write a single coefficient value to the per-solver
  //  turbulenceCoefficients mirror. Mirrors the V1.13/V1.16/V1.17
  //  per-field override closure shape (no "drop the key" path
  //  because every coefficient field is required by the schema
  //  — defaults always materialize via Zod so there's no
  //  undefined slot to clear). `key` is narrowed to keyof
  //  KEpsilonCoefficients so callers get per-key type safety for
  //  free (the call sites pass `(v) => updateCoeff("Cmu", v)`
  //  etc. without `as` casts).
  const updateCoefficient = (
    key: keyof KEpsilonCoefficients,
    raw: string,
  ) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    setSolverControl(formSolver, "turbulenceCoefficients", {
      ...formValues.turbulenceCoefficients,
      [key]: n,
    });
  };
  // V1.21 — write a single k-ω SST coefficient value to the
  //  per-solver `turbulenceCoefficientsKOmegaSST` mirror. Mirror of
  //  V1.20's `updateCoefficient` closure but typed against
  //  `keyof KOmegegaSSTCoefficients` (12 fields: alphaK1, alphaK2,
  //  alphaOmega1, alphaOmega2, beta1, beta2, betaStar, C1, gamma1,
  //  gamma2, sigmaK, sigmaOmega). Parallel-slot design with V1.20's
  //  kEpsilon closure — at most one of the two closures writes per
  //  render because the form gates each model's details block on
  //  `formValues.turbulence === "kEpsilon" | "kOmegaSST"`.
  const updateKOmegaSSTCoefficient = (
    key: keyof KOmegegaSSTCoefficients,
    raw: string,
  ) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    setSolverControl(formSolver, "turbulenceCoefficientsKOmegaSST", {
      ...formValues.turbulenceCoefficientsKOmegaSST,
      [key]: n,
    });
  };
  // V1.22 — write a single Spalart-Allmaras coefficient value to the
  //  per-solver `turbulenceCoefficientsSpalartAllmaras` mirror. Mirror of
  //  V1.20's `updateCoefficient` (kEpsilon) and V1.21's
  //  `updateKOmegaSSTCoefficient` closures; typed against `keyof
  //  SpalartAllmarasCoefficients` (9 fields: sigmaNut, kappa, Cb1, Cb2,
  //  Cw1, Cw2, Cw3, Cv1, Cv2). Parallel-slot design with V1.20/V1.21
  //  closures — at most one of the three closures writes per render
  //  because the form gates each model's details block on the active
  //  `formValues.turbulence`.
  const updateSpalartAllmarasCoefficient = (
    key: keyof SpalartAllmarasCoefficients,
    raw: string,
  ) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    setSolverControl(formSolver, "turbulenceCoefficientsSpalartAllmaras", {
      ...formValues.turbulenceCoefficientsSpalartAllmaras,
      [key]: n,
    });
  };
  // V1.23 — write a single LES sub-grid-scale coefficient value
  //  (Cs for Smagorinsky, Cw for WALE) to the per-solver
  //  `turbulenceCoefficientsLES` mirror. Mirror of V1.20's
  //  `updateCoefficient`, V1.21's `updateKOmegaSSTCoefficient`, and
  //  V1.22's `updateSpalartAllmarasCoefficient` closures; typed
  //  against `keyof LESCoefficients` (2 fields: Cs, Cw). The form
  //  only renders the matching input row for the active LES model
  //  (gated on `formValues.turbulence === 'Smagorinsky' | 'WALE'`),
  //  so at most one of the two coefficient fields writes per render.
  //  Cross-model guards built into the closure are not strictly
  //  necessary because the form's per-model gating ensures only the
  //  active model's input reaches the closure; future V.x unlocks
  //  that add additional LES variants with more coefficients (kEqn,
  //  dynamicSmagorinsky, SpalartAllmarasDES) will route through the
  //  same `turbulenceCoefficientsLES` slot but with discriminator-
  //  aware input rows.
  const updateLESCoefficient = (
    key: keyof LESCoefficients,
    raw: string,
  ) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    setSolverControl(formSolver, "turbulenceCoefficientsLES", {
      ...formValues.turbulenceCoefficientsLES,
      [key]: n,
    });
  };
  // V1.24 — write a single k-equation LES coefficient value
  //  (Ck / Ce1 / Ce2) to the per-solver `turbulenceCoefficientsKEqn`
  //  mirror. Mirror of V1.20's `updateCoefficient`, V1.21's
  //  `updateKOmegaSSTCoefficient`, V1.22's
  //  `updateSpalartAllmarasCoefficient`, and V1.23's
  //  `updateLESCoefficient` closures; typed against `keyof
  //  KEqnCoefficients` (3 fields: Ck, Ce1, Ce2). The form only
  //  renders the matching input row when the user picks kEqn
  //  (gated on `formValues.turbulence === 'kEqn'`), so at most
  //  one of the three coefficient fields writes per render.
  //  Cross-model guards built into the closure are not strictly
  //  necessary because the form's per-model gating ensures only
  //  the active model's input reaches the closure; future V.x
  //  unlocks that add additional LES variants will route through
  //  their own dedicated `turbulenceCoefficients<X>` slot.
  const updateKEqnCoefficient = (
    key: keyof KEqnCoefficients,
    raw: string,
  ) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    setSolverControl(formSolver, "turbulenceCoefficientsKEqn", {
      ...formValues.turbulenceCoefficientsKEqn,
      [key]: n,
    });
  };
  // V1.25 -- closure for the DES shielding-function CDES
  //  coefficient (OpenFOAM stock 0.65, Shur+Spalart+Strelets 2008).
  //  Mirrors the V1.22 updateSpalartAllmarasCoefficient / V1.24
  //  updateKEqnCoefficient pattern in shape and parse step:
  //  Number(raw) -> guard -> setSolverControl with the
  //  spread+override on the active solver. The form only renders
  //  the CDES row when turbulence === 'kOmegaSSTDES' (gated in the
  //  CDES details block below). Used only by the kOmegaSSTDES
  //  model variant.
  const updateCDESCoefficient = (
    key: keyof CDESCoefficient,
    raw: string,
  ) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    setSolverControl(formSolver, "turbulenceCoefficientsCDES", {
      ...formValues.turbulenceCoefficientsCDES,
      [key]: n,
    });
  };

  const selArr = Array.from(selectedFaceIds).sort((a, b) => a - b);
  const selCap = selArr.slice(0, 50);
  const selOverflow = selArr.length - selCap.length;

  return (
    <aside className="h-full min-h-0 flex flex-col gap-0 bg-bg-950">
      <Section title="Selection" right={
        selectedFaceIds.size > 0 ? (
          <button onClick={clearSelection} className="text-xs px-2 py-1 rounded text-bg-300 hover:text-bg-100 hover:bg-bg-800">
            Clear ({selectedFaceIds.size})
          </button>
        ) : null
      }>
        {!prep ? (
          <Empty>Load a file to start picking faces.</Empty>
        ) : selectedFaceIds.size === 0 ? (
          <Empty>Click faces in the viewer to select them.</Empty>
        ) : (
          <>
            <div className="text-xs text-bg-300 mb-2">
              <span className="font-mono text-bg-100">{selectedFaceIds.size}</span> faces selected
            </div>
            <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto pr-1">
              {selCap.map((fi) => (
                <span
                  key={fi}
                  className="inline-flex items-center justify-center min-w-[2.25rem] px-2 py-1 rounded bg-accent-500/15 text-accent-400 text-[11px] font-mono border border-accent-500/25"
                  title={`Face index ${fi}`}
                >
                  {fi}
                </span>
              ))}
              {selOverflow > 0 && (
                <span className="text-[11px] text-bg-300 px-1">+{selOverflow} more</span>
              )}
            </div>
          </>
        )}
      </Section>

      <Section title="Patches">
        {!prep ? (
          <Empty>Available after geometry is loaded.</Empty>
        ) : patches.length === 0 ? (
          <Empty>Create a patch below and assign faces to it.</Empty>
        ) : (
          <ul className="space-y-2">
            {patches.map((p) => (
              <li key={p.id} className="bg-bg-900 border border-bg-800 rounded p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-bg-100 text-sm" title={p.id}>{p.name}</span>
                  <button
                    onClick={() => deletePatch(p.id)}
                    className="text-[11px] text-bg-300 hover:text-red-400"
                    title="Delete patch"
                  >
                    ✕
                  </button>
                </div>
                <div className="text-[11px] text-bg-300 space-y-0.5">
                  <div><span className="font-mono">{p.faceIndices.length}</span> faces · <span className="font-mono">{p.triangleCount}</span> triangles</div>
                  {p.lastExportedRelPath ? (
                    <div className="text-accent-400 truncate" title={p.lastExportedRelPath}>↳ {p.lastExportedRelPath}</div>
                  ) : (
                    <div className="text-amber-400/80" title="STL not yet written for this patch">☼ STL pending</div>
                  )}
                </div>
                <div className="flex gap-1.5 mt-2">
                  <button
                    onClick={() => assignSelectionToPatch(p.id)}
                    disabled={selectedFaceIds.size === 0}
                    className="flex-1 px-2 py-1 text-[11px] font-semibold rounded bg-bg-800 hover:bg-bg-700 disabled:opacity-40 disabled:cursor-not-allowed text-bg-100"
                  >
                    Add selection
                  </button>
                  <button
                    onClick={() => exportPatch(p.id)}
                    disabled={!activeCaseDir || p.faceIndices.length === 0}
                    className="flex-1 px-2 py-1 text-[11px] font-semibold rounded bg-brand-500 hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed text-white"
                  >
                    Export STL
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <BoundaryConditionsSection
        prep={prep}
        patches={patches}
        boundaryConditions={boundaryConditions}
        onSetPatchBc={setPatchBc}
        patchRefinements={patchRefinements}
        onSetPatchRefinement={setPatchRefinement}
      />

      <Section title="Build Case">
        {!prep ? (
          <Empty>Load a geometry file to build a case from.</Empty>
        ) : patches.length === 0 ? (
          <Empty>Add at least one patch first.</Empty>
        ) : patches.some((p) => p.lastExportedRelPath == null) ? (
          <Empty>Export all patch STLs before building.</Empty>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1.5">
              <Field label="Solver">
                <select value={formSolver} onChange={(e) => setFormSolver(e.target.value as typeof formSolver)}
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100">
                  <option value="simpleFoam">simpleFoam</option>
                  <option value="pimpleFoam">pimpleFoam</option>
                  <option value="icoFoam">icoFoam</option>
                  <option value="potentialFoam">potentialFoam</option>
                  <option value="buoyantSimpleFoam">buoyantSimpleFoam</option>
                </select>
              </Field>
              <Field label="End time">
                <input type="number" min={1} value={formValues.endTime}
                  onChange={(e) => setSolverControl(formSolver, "endTime", Math.max(1, Number(e.target.value) || 1))}
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono" />
              </Field>
              <Field label={`Δt (s)${isSteady ? " · steady" : ""}`}>
                <input
                  type="number"
                  min={isSteady ? undefined : 1e-9}
                  step={isSteady ? undefined : "any"}
                  value={isSteady ? 1 : formValues.deltaT}
                  disabled={isSteady}
                  onChange={(e) => setSolverControl(formSolver, "deltaT", Number(e.target.value) || 1e-9)}
                  title={isSteady
                    ? "Δt is fixed at 1 for steady solvers — time is iteration count, not physics time."
                    : "Per-solver-step duration (seconds). Keep ≤ mesh-cell-size · Co-limit / |U|."}
                  className={
                    "w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono " +
                    (isSteady ? "opacity-50 cursor-not-allowed" : "")
                  }
                />
              </Field>
              <Field label="Write every">
                <input type="number" min={1} value={formValues.writeInterval}
                  onChange={(e) => setSolverControl(formSolver, "writeInterval", Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono" />
              </Field>
              <Field label="purgeWrite">
                <input type="number" min={0} value={formValues.purgeWrite}
                  onChange={(e) => setSolverControl(formSolver, "purgeWrite", Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  title="Keep only the latest N time dirs on disk (0 = keep all)"
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono" />
              </Field>
              <Field label="Cores">
                <input type="number" min={1} max={64} value={formValues.cores}
                  onChange={(e) => setSolverControl(formSolver, "cores", Math.max(1, Math.min(64, Math.floor(Number(e.target.value) || 1))))}
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono" />
              </Field>
              <Field label="ν  (m²/s)">
                <input type="number" step="1e-6" min={0} value={formValues.nu}
                  onChange={(e) => setSolverControl(formSolver, "nu", Number(e.target.value) || 0)}
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono" />
              </Field>
            </div>
            {/* V1.6 — turbulence model picker. Full-width row right below the
                 Solver / End-time grid so the RAS choice is visually paired with
                 the solver. `LES` is schema-allowed but the templates only emit
                 if/else branches for laminar/kEpsilon/kOmegaSST/SpalartAllmaras,
                 so the dropdown filters it out until V1.x adds an LES branch. */}
            <Field label="Turbulence model">
              <select
                value={formValues.turbulence}
                onChange={(e) => setSolverControl(formSolver, "turbulence", e.target.value as typeof formValues.turbulence)}
                className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100"
                title="RANS turbulence closure. Drives constant/momentumTransport and the fvSchemes/fvSolution solver entries."
              >
                <option value="laminar">laminar</option>
                <option value="kEpsilon">kEpsilon</option>
                <option value="kOmegaSST">kOmegaSST</option>
                <option value="SpalartAllmaras">SpalartAllmaras</option>
                {/* V1.23 -- LES sub-grid-scale model options. Replaces the
                     V0.6 'LES' placeholder that the form filtered out;
                     Smagorinsky and WALE are the two basic single-coefficient
                     LES models OpenFOAM ships with sensible stock defaults
                     (Cs 0.2 / Cw 0.325). Other LES variants (kEqn,
                     dynamicSmagorinsky, dynamicLagrangian,
                     SpalartAllmarasDES) are deferred to a future V.x unlock. */}
                <option value="Smagorinsky">Smagorinsky (LES)</option>
                <option value="WALE">WALE (LES)</option>
                {/* V1.24 — k-equation LES with Germano-style gradient filter
                     (Ck / Ce1 / Ce2). Single-coefficient family mirrors
                     V1.20-V1.23 RANS / LES pattern. Other LES variants
                     (dynamicSmagorinsky / dynamicLagrangian /
                     SpalartAllmarasDES / kOmegaSSTDES) deferred to
                     V1.25 / V1.26. */}                  <option value="kEqn">k-equation (LES)</option>
                  {/* V1.25 -- Dynamic LES (Germano test-filter / Meneveau Lagrangian) pairs
                       that derive their coefficient locally at runtime (no user
                       coefficients). Listed alongside the static LES family for
                       dropdown discoverability; the dropdown filter is dropped for
                       all 4 V1.25 variants */}
                  <option value="dynamicSmagorinsky">dynamic Smagorinsky (LES)</option>
                  <option value="dynamicLagrangian">dynamic Lagrangian (LES)</option>
                  {/* V1.25 -- DES variants grouped: kOmegaSSTDES listed
                       first since it inherits the k-ω SST 12-coeff details
                       block (gate widened) and adds a CDES shielding
                       coefficient row; SpalartAllmarasDES reuses the
                       SpalartAllmaras 9-coeff slot verbatim (gate
                       widened) with no extra coefficient. */}
                  <option value="kOmegaSSTDES">k-omega SST DES (hybrid RANS/LES)</option>
                  <option value="SpalartAllmarasDES">Spalart-Allmaras DES (hybrid RANS/LES)</option>
              </select>
            </Field>
            {/* V1.7 — initial-condition controls. Render `internalField uniform …;`
                 in 0/U and 0/p (and snappy variants) on Build. Object form
                 ({x,y,z}) so the Handlebars templates read `velocity.x` instead of
                 indexed access. Defaults are per-solver (see SOLVER_CONTROLS_DEFAULTS):
                 `potentialFoam` ships with a (1,0,0) freestream, all others zero
                 — keeps the lid-driven-cavity benchmark stable. Plain `Ux`/`Uy`/`Uz`
                 labels match BcFieldRow's existing style below (no Unicode-subscript
                 codepoints so we don't risk muddling the z glyph). */}
            <div className="grid grid-cols-3 gap-1.5">
              <Field label="Initial Ux (m/s)">
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={icVel.x}
                  onChange={(e) => setIcVel("x", e.target.value)}
                  title="Initial U component along X. Drives 0/U internalField."
                  aria-label="Initial U x"
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                />
              </Field>
              <Field label="Initial Uy (m/s)">
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={icVel.y}
                  onChange={(e) => setIcVel("y", e.target.value)}
                  title="Initial U component along Y."
                  aria-label="Initial U y"
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                />
              </Field>
              <Field label="Initial Uz (m/s)">
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={icVel.z}
                  onChange={(e) => setIcVel("z", e.target.value)}
                  title="Initial U component along Z."
                  aria-label="Initial U z"
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                />
              </Field>
            </div>
            <Field label="Initial p">
              <input
                type="number"
                step="any"
                inputMode="decimal"
                value={icP}
                onChange={(e) => setIcP(e.target.value)}
                title="Initial pressure (Pa or m²/s² for kinematic pressure). Incompressible solvers compute the level via BCs, so this is mostly first-step smoothing."
                aria-label="Initial pressure"
                className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
              />
            </Field>
            <Field label="Background padding (%) each side">
              <input type="number" min={0} max={200} value={paddingPercent}
                onChange={(e) => setPaddingPercent(Math.max(0, Math.min(200, Number(e.target.value) || 0)))}
                className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono" />
            </Field>
            <Field label="Case label">
              <input type="text" value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="snappy-case"
                className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 placeholder:text-bg-300" />
            </Field>
            <button
              onClick={() => buildCaseFromPatches({ paddingPercent, label: label.trim() || undefined }).then(() => refreshCases())}
              className="w-full px-3 py-2 mt-1 text-xs font-bold rounded bg-accent-500 hover:bg-accent-600 text-bg-950 transition-colors"
            >
              Build snappy case
            </button>
            <RunTimePreview values={formValues} isSteady={isSteady} />
            {/* V1.8 — Convergence detector controls, folded into a <details>
                 to avoid bloating the top-level PatchPanel sections. The
                 4 inputs read/write the per-solver `converge` slice in
                 `SOLVER_CONTROLS_DEFAULTS`. The preview line summarizes
                 the detector's settings in plain English so users can
                 spot a too-loose threshold or a too-short streak before
                 clicking Build. */}
            <details className="text-[11px] mt-1">
              <summary className="cursor-pointer text-bg-300 hover:text-bg-100 select-none py-1">
                + Convergence
              </summary>
              <div className="space-y-2 mt-2 pl-2 border-l border-bg-800">
                <Field label="Detector enabled">
                  <label className="flex items-center gap-2 text-xs text-bg-300">
                    <input
                      type="checkbox"
                      checked={formValues.converge.enabled}
                      onChange={(e) =>
                        setSolverControl(formSolver, "converge", {
                          ...formValues.converge,
                          enabled: e.target.checked,
                        })
                      }
                      className="accent-accent-500"
                    />
                    <span>Fire a 'converged' phase when every observed field\u2019s initial residual stays below the threshold for the streak length.</span>
                  </label>
                </Field>
                <div className="grid grid-cols-2 gap-1.5">
                  <Field label="maxInitialResidual">
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      min={0}
                      value={formValues.converge.maxInitialResidual}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n) || n <= 0) return;
                        setSolverControl(formSolver, "converge", {
                          ...formValues.converge,
                          maxInitialResidual: n,
                        });
                      }}
                      title="Per-field initial-residual threshold. Resets on any rise above it."
                      className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                    />
                  </Field>
                  {/* V1.8.1 — Fold the long post-V1.8 tooltip (which
                       browsers truncated at ~80 chars and left the caveat
                       unreadable) into an inline amber warning so the
                       false-steady-state caveat is fully readable whenever
                       the convergence <details> is open. */}
                  <p className="text-[10px] text-amber-400/80 pl-1 leading-snug">
                    Heads up: cheap-mesh residuals can plateau around this threshold without
                    actually settling &mdash; leave <span className="font-mono text-amber-400">auto-stop</span>{" "}
                    OFF until you've validated convergence yourself, or runs may end
                    prematurely on a false-steady state.
                  </p>
                  <Field label="stableIterations">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={formValues.converge.stableIterations}
                      onChange={(e) =>
                        setSolverControl(formSolver, "converge", {
                          ...formValues.converge,
                          stableIterations: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                        })
                      }
                      title="Consecutive timesteps every observed field must stay below the threshold before 'converged' fires."
                      className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                    />
                  </Field>
                </div>
                <Field label="autoStop">
                  <label className="flex items-center gap-2 text-xs text-bg-300">
                    <input
                      type="checkbox"
                      checked={formValues.converge.autoStop}
                      disabled={!formValues.converge.enabled}
                      onChange={(e) =>
                        setSolverControl(formSolver, "converge", {
                          ...formValues.converge,
                          autoStop: e.target.checked,
                        })
                      }
                      className="accent-accent-500 disabled:opacity-40"
                    />
                    <span>On convergence, terminate the solver with phase 'converged' (instead of letting it run to endTime).</span>
                  </label>
                </Field>
                <ConvergencePreview values={formValues.converge} isSteady={isSteady} />
              </div>
            </details>
            <details className="text-[11px] mt-1">
              <summary className="cursor-pointer text-bg-300 hover:text-bg-100 select-none py-1">
                + Numerics
              </summary>
              <div className="space-y-2 mt-2 pl-2 border-l border-bg-800">
                <Field label="Corrector knobs enabled">
                  <label className="flex items-center gap-2 text-xs text-bg-300">
                    <input
                      type="checkbox"
                      checked={formValues.numerics.enabled}
                      onChange={(e) =>
                        setSolverControl(formSolver, "numerics", {
                          ...formValues.numerics,
                          enabled: e.target.checked,
                        })
                      }
                      className="accent-accent-500"
                    />
                    <span>
                      Lock the corrector knobs (no longer editable).
                      Custom values are preserved as-is; set them back
                      to the schema defaults manually if you want
                      pre-V1.9 behavior.
                    </span>
                  </label>
                </Field>
                <Field label="nNonOrthogonalCorrectors">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={formValues.numerics.nNonOrthogonalCorrectors}
                    onChange={(e) => {
                      const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                      setSolverControl(formSolver, "numerics", {
                        ...formValues.numerics,
                        nNonOrthogonalCorrectors: n,
                      });
                    }}
                    title="Extra non-orthogonal corrector sweeps. 0 is fine for structured meshes; raise to 1-2 for high-skew snappy geometry."
                    className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                  />
                </Field>
                {formSolver === "pimpleFoam" && (
                  <>
                    <Field label="nOuterCorrectors (PIMPLE only)">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={formValues.numerics.nOuterCorrectors}
                        onChange={(e) => {
                          const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
                          setSolverControl(formSolver, "numerics", {
                            ...formValues.numerics,
                            nOuterCorrectors: n,
                          });
                        }}
                        title="Outer PIMPLE loop count. 2-3 helps convergence on transient viscous cases."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="nCorrectors (PIMPLE+PISO)">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={formValues.numerics.nCorrectors}
                        onChange={(e) => {
                          const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
                          setSolverControl(formSolver, "numerics", {
                            ...formValues.numerics,
                            nCorrectors: n,
                          });
                        }}
                        title="Inner corrector passes per outer step (PIMPLE) or per timestep (PISO). 2 is canonical for the cavity benchmark."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                  </>
                )}
                {(formSolver === "icoFoam" || formSolver === "potentialFoam") && (
                  <Field label="nCorrectors (PIMPLE+PISO)">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={formValues.numerics.nCorrectors}
                      onChange={(e) => {
                        const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
                        setSolverControl(formSolver, "numerics", {
                          ...formValues.numerics,
                          nCorrectors: n,
                        });
                      }}
                      title="Per-timestep PISO correctors. Raise to 3-4 when the mesh has non-orthogonal cells."
                      className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                    />
                  </Field>
                )}
                {(formSolver === "simpleFoam" || formSolver === "buoyantSimpleFoam") && (
                  <Field label="residualControl (SIMPLE only)">
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      min={0}
                      value={formValues.numerics.residualControl}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n) || n <= 0) return;
                        setSolverControl(formSolver, "numerics", {
                          ...formValues.numerics,
                          residualControl: String(n),
                        });
                      }}
                      title="Per-field residual tolerance applied to p, U, and (when RAS) k|epsilon|omega|nuTilda. Lower = stricter convergence."
                      className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                    />
                  </Field>
                )}
                {/* V1.10 — per-field residual-tolerance override.
                     Empty inputs fall back to the `residualControl`
                     above, so the user can fill 0..N fields without
                     breaking the others. The UI only renders fields
                     relevant to the active solver + turbulence model
                     so they can't accidentally type `omega` on a
                     kEpsilon case and have it silently ignored by
                     the template. `R` chip below the grid shows how
                     many fields currently have a non-default
                     override, giving the user a quick sanity check
                     that the override is taking effect. */}
                {(formSolver === "simpleFoam" || formSolver === "buoyantSimpleFoam") && (
                  <Field label="Per-field overrides (SIMPLE)">
                    <div className="grid grid-cols-2 gap-1.5">
                      <ResidualOverrideInput
                        field="p"
                        value={formValues.numerics.residualControlByField["p"]}
                        onChange={(raw) => updateFieldOverride("p", raw)}
                        placeholder="use residualControl"
                      />
                      <ResidualOverrideInput
                        field="U"
                        value={formValues.numerics.residualControlByField["U"]}
                        onChange={(raw) => updateFieldOverride("U", raw)}
                        placeholder="use residualControl"
                      />
                      {formSolver === "buoyantSimpleFoam" && (
                        <ResidualOverrideInput
                          field="T"
                          value={formValues.numerics.residualControlByField["T"]}
                          onChange={(raw) => updateFieldOverride("T", raw)}
                          placeholder="use residualControl"
                        />
                      )}
                      {formValues.turbulence === "kEpsilon" && (
                        <>
                          <ResidualOverrideInput
                            field="k"
                            value={formValues.numerics.residualControlByField["k"]}
                            onChange={(raw) => updateFieldOverride("k", raw)}
                            placeholder="use residualControl"
                          />
                          <ResidualOverrideInput
                            field="epsilon"
                            value={formValues.numerics.residualControlByField["epsilon"]}
                            onChange={(raw) => updateFieldOverride("epsilon", raw)}
                            placeholder="use residualControl"
                          />
                        </>
                      )}
                      {(formValues.turbulence === "kOmegaSST" || formValues.turbulence === "kOmegaSSTDES") && (
                        <>
                          <ResidualOverrideInput
                            field="k"
                            value={formValues.numerics.residualControlByField["k"]}
                            onChange={(raw) => updateFieldOverride("k", raw)}
                            placeholder="use residualControl"
                          />
                          <ResidualOverrideInput
                            field="omega"
                            value={formValues.numerics.residualControlByField["omega"]}
                            onChange={(raw) => updateFieldOverride("omega", raw)}
                            placeholder="use residualControl"
                          />
                        </>
                      )}
                      {(formValues.turbulence === "SpalartAllmaras" || formValues.turbulence === "SpalartAllmarasDES") && (
                        <ResidualOverrideInput
                          field="nuTilda"
                          value={formValues.numerics.residualControlByField["nuTilda"]}
                          onChange={(raw) => updateFieldOverride("nuTilda", raw)}
                          placeholder="use residualControl"
                        />
                      )}
                    </div>
                    <PerFieldOverrideSummary
                      values={formValues.numerics}
                      solver={formSolver}
                      turbulence={formValues.turbulence}
                    />
                  </Field>
                )}
                <NumericsPreview
                  values={formValues.numerics}
                  algorithm={numericsAlgorithm(formSolver)}
                />
              </div>
            </details>
            {/* V1.11 — SIMPLE relaxationFactor overrides. Folded
                 into a separate <details> below Numerics so the
                 per-solver numerics section above doesn't bloat.
                 Empty inputs revert to the V1.10-era hard-coded
                 values (0.3 / 0.7) at template-render time (the
                 placeholder props make the defaults visible in the
                 UI). PIMPLE/PISO solvers get a stub paragraph
                 rather than input rows because OpenFOAM's built-in
                 behavior does not emit a relaxationFactors block
                 for those algorithms. */}
            <details className="text-[11px] mt-1">
              <summary className="cursor-pointer text-bg-300 hover:text-bg-100 select-none py-1">
                + Relaxation factors
              </summary>
              <div className="space-y-2 mt-2 pl-2 border-l border-bg-800">
                {(formSolver === "simpleFoam" || formSolver === "buoyantSimpleFoam" || formSolver === "potentialFoam") ? (
                  <>
                    <RelaxationFactorRow
                      group="fields"
                      key="p"
                      value={formValues.relaxationFactors.fields.p}
                      onChange={(raw) => updateRelaxationFactor("fields", "p", raw)}
                      placeholder="0.3"
                      title="Under-relaxation for pressure (0..1). <=0.3 typical; lower (0.1-0.2) for high-Re viscous, higher (0.5-0.7) for fast convergence on coarse meshes."
                    />
                    {formSolver === "buoyantSimpleFoam" && (
                      <RelaxationFactorRow
                        group="fields"
                        key="T"
                        value={formValues.relaxationFactors.fields.T}
                        onChange={(raw) => updateRelaxationFactor("fields", "T", raw)}
                        placeholder="0.7"
                        title="Under-relaxation for the energy field. 0.7 is the OpenFOAM built-in default; lower to 0.3-0.5 if the T-equation oscillates."
                      />
                    )}
                    <RelaxationFactorRow
                      group="equations"
                      key="U"
                      value={formValues.relaxationFactors.equations.U}
                      onChange={(raw) => updateRelaxationFactor("equations", "U", raw)}
                      placeholder="0.7"
                      title="Under-relaxation for velocity. 0.7 is the OpenFOAM built-in default; lower to 0.5 for high-Re external flow with strong recirculation."
                    />
                    {formValues.turbulence === "kEpsilon" && (
                      <>
                        <RelaxationFactorRow
                          group="equations"
                          key="k"
                          value={formValues.relaxationFactors.equations.k}
                          onChange={(raw) => updateRelaxationFactor("equations", "k", raw)}
                          placeholder="0.7"
                          title="Under-relaxation for turbulent kinetic energy (k)."
                        />
                        <RelaxationFactorRow
                          group="equations"
                          key="epsilon"
                          value={formValues.relaxationFactors.equations.epsilon}
                          onChange={(raw) => updateRelaxationFactor("equations", "epsilon", raw)}
                          placeholder="0.7"
                          title="Under-relaxation for turbulent dissipation (epsilon)."
                        />
                      </>
                    )}
                    {(formValues.turbulence === "kOmegaSST" || formValues.turbulence === "kOmegaSSTDES") && (
                      <>
                        <RelaxationFactorRow
                          group="equations"
                          key="k"
                          value={formValues.relaxationFactors.equations.k}
                          onChange={(raw) => updateRelaxationFactor("equations", "k", raw)}
                          placeholder="0.7"
                          title="Under-relaxation for turbulent kinetic energy (k)."
                        />
                        <RelaxationFactorRow
                          group="equations"
                          key="omega"
                          value={formValues.relaxationFactors.equations.omega}
                          onChange={(raw) => updateRelaxationFactor("equations", "omega", raw)}
                          placeholder="0.7"
                          title="Under-relaxation for specific dissipation (omega)."
                        />
                      </>
                    )}
                    {(formValues.turbulence === "SpalartAllmaras" || formValues.turbulence === "SpalartAllmarasDES") && (
                      <RelaxationFactorRow
                        group="equations"
                        key="nuTilda"
                        value={formValues.relaxationFactors.equations.nuTilda}
                        onChange={(raw) => updateRelaxationFactor("equations", "nuTilda", raw)}
                        placeholder="0.7"
                        title="Under-relaxation for modified viscosity (nuTilda)."
                      />
                    )}
                  </>
                ) : formSolver === "pimpleFoam" ? (
                  // V1.18b — PIMPLE under-relaxation is opt-in. Default
                  //  `enabled=false` keeps pre-V1.18b behavior (no
                  //  block in fvSolution). When enabled, the standard
                  //  SIMPLE family of relaxation-factor rows renders
                  //  below the checkbox, sharing the same React closure
                  //  (`updateRelaxationFactor`).
                  <>
                    <Field label="PIMPLE under-relaxation">
                      <label className="flex items-center gap-2 text-xs text-bg-300">
                        <input
                          type="checkbox"
                          checked={formValues.relaxationFactors.enabled}
                          onChange={(e) =>
                            setSolverControl(formSolver, "relaxationFactors", {
                              ...formValues.relaxationFactors,
                              enabled: e.target.checked,
                            })
                          }
                          className="accent-accent-500"
                        />
                        <span>
                          Emit a relaxationFactors block in fvSolution. By default
                          OpenFOAM PIMPLE relies on the outer-corrector loop for
                          implicit under-relaxation; turn this on to declare explicit
                          per-iteration factors when <span className="font-mono text-bg-100">nOuterCorrectors &gt; 1</span>.
                        </span>
                      </label>
                    </Field>
                    {formValues.relaxationFactors.enabled && (
                      <>
                        <RelaxationFactorRow
                          group="fields"
                          key="p"
                          value={formValues.relaxationFactors.fields.p}
                          onChange={(raw) => updateRelaxationFactor("fields", "p", raw)}
                          placeholder="0.3"
                          title="Under-relaxation for pressure (0..1). <=0.3 typical for PIMPLE; lower (0.1-0.2) helps divergence on momentum-tight cases."
                        />
                        <RelaxationFactorRow
                          group="equations"
                          key="U"
                          value={formValues.relaxationFactors.equations.U}
                          onChange={(raw) => updateRelaxationFactor("equations", "U", raw)}
                          placeholder="0.7"
                          title="Under-relaxation for velocity. 0.7 is the OpenFOAM built-in default; lower to 0.5 for high-Re external flow."
                        />
                        {formValues.turbulence === "kEpsilon" && (
                          <>
                            <RelaxationFactorRow
                              group="equations"
                              key="k"
                              value={formValues.relaxationFactors.equations.k}
                              onChange={(raw) => updateRelaxationFactor("equations", "k", raw)}
                              placeholder="0.7"
                              title="Under-relaxation for turbulent kinetic energy (k)."
                            />
                            <RelaxationFactorRow
                              group="equations"
                              key="epsilon"
                              value={formValues.relaxationFactors.equations.epsilon}
                              onChange={(raw) => updateRelaxationFactor("equations", "epsilon", raw)}
                              placeholder="0.7"
                              title="Under-relaxation for turbulent dissipation (epsilon)."
                            />
                          </>
                        )}
                        {(formValues.turbulence === "kOmegaSST" || formValues.turbulence === "kOmegaSSTDES") && (
                          <>
                            <RelaxationFactorRow
                              group="equations"
                              key="k"
                              value={formValues.relaxationFactors.equations.k}
                              onChange={(raw) => updateRelaxationFactor("equations", "k", raw)}
                              placeholder="0.7"
                              title="Under-relaxation for turbulent kinetic energy (k)."
                            />
                            <RelaxationFactorRow
                              group="equations"
                              key="omega"
                              value={formValues.relaxationFactors.equations.omega}
                              onChange={(raw) => updateRelaxationFactor("equations", "omega", raw)}
                              placeholder="0.7"
                              title="Under-relaxation for specific dissipation (omega)."
                            />
                          </>
                        )}
                        {(formValues.turbulence === "SpalartAllmaras" || formValues.turbulence === "SpalartAllmarasDES") && (
                          <RelaxationFactorRow
                            group="equations"
                            key="nuTilda"
                            value={formValues.relaxationFactors.equations.nuTilda}
                            onChange={(raw) => updateRelaxationFactor("equations", "nuTilda", raw)}
                            placeholder="0.7"
                            title="Under-relaxation for modified viscosity (nuTilda)."
                          />
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <p className="text-[11px] text-bg-300 italic pl-1">
                    PISO does not emit a relaxationFactors block by default; correction
                    is handled by the PISO inner corrector sweeps.
                  </p>
                )}
              </div>
            </details>
            {/* V1.18d — matrix-solver configurations for fvSolution's
                `solvers` block. Three rows (Pressure / Momentum /
                Turbulence) lifted from the V1.17 hard-coded template
                values. Each row carries a solver-kind dropdown,
                absolute tolerance, and the relative tolerance. The
                coupled smoother/preconditioner line is emitted via
                the `smootherLine` Handlebars helper in case.ts — the
                user picks a matrix solver and OpenFOAM gets the right
                `smoother`/`preconditioner` keyword + name combo. Solver
                enum mirrors MatrixSolverValueSchema verbatim (GAMG,
                PCG, smoothSolver, PBiCG, PBiCGStab). pFinal stays
                hard-coded (`$p; relTol 0;`) per the V1.18 designer —
                users almost universally want exact closure on the
                final pressure sweep. */}
            <details className="text-[11px] mt-1">
              <summary className="cursor-pointer text-bg-300 hover:text-bg-100 select-none py-1">
                + Matrix solvers
              </summary>
              <div className="space-y-2 mt-2 pl-2 border-l border-bg-800">
                <MatrixSolverRow
                  group="p"
                  label="Pressure (p)"
                  value={formValues.solverConfigs.p}
                  onChange={(next) =>
                    setSolverControl(formSolver, "solverConfigs", {
                      ...formValues.solverConfigs,
                      p: next,
                    })
                  }
                  title="Pressure matrix solver. GAMG (default) is the multi-grid accelerated solver; PCG is a preconditioned conjugate-gradient fallback when GAMG fails on highly non-orthogonal cells. tolerance = absolute target; relTol = relative-to-previous-iteration target (whichever is hit first ends the solve)."
                />
                <MatrixSolverRow
                  group="U"
                  label="Momentum (U)"
                  value={formValues.solverConfigs.U}
                  onChange={(next) =>
                    setSolverControl(formSolver, "solverConfigs", {
                      ...formValues.solverConfigs,
                      U: next,
                    })
                  }
                  title="Velocity matrix solver. smoothSolver (default) uses GaussSeidel smoothing and is the OpenFOAM stock choice; PBiCGStab is bi-conjugate gradient stabilized with DILU preconditioning — faster convergence on stiff problems."
                />
                {(formValues.turbulence === "kEpsilon" ||
                  formValues.turbulence === "kOmegaSST" ||
                  formValues.turbulence === "kOmegaSSTDES" ||
                  formValues.turbulence === "SpalartAllmaras" ||
                  formValues.turbulence === "SpalartAllmarasDES") && (
                  <MatrixSolverRow
                    group="turbulence"
                    label={`Turbulence (${formValues.turbulence})`}
                    value={formValues.solverConfigs.turbulence}
                    onChange={(next) =>
                      setSolverControl(formSolver, "solverConfigs", {
                        ...formValues.solverConfigs,
                        turbulence: next,
                      })
                    }
                    title="Turbulence-field matrix solver. The same `{solver, tolerance, relTol}` triple is shared by k/epsilon/omega/nuTilda via the OpenFOAM regex group key (k|epsilon, k|omega, nuTilda). LES carries no solver block (V1.6 leaves LES out of scope)."
                  />
                )}
                <p className="text-[10px] text-bg-300 leading-snug italic pl-1">
                  <span className="font-mono text-bg-100">pFinal</span>, the closed-pressure
                  final sweep, stays hard-coded to{" "}
                  <span className="font-mono text-bg-100">$p; relTol 0;</span> — exact closure
                  is near-universal.
                </p>
              </div>
            </details>
            {/* V1.12 — discretization scheme `default` selectors.
                All four rows are visible regardless of solver; only
                the ddtDefault row is gated (locked to `steadyState`
                when isSteady, since SIMPLE-family algorithms are
                steady-state by definition). The other three
                selectors (grad / div / laplacian) are solver-
                agnostic: OpenFOAM's stock choices are stable across
                SIMPLE / PISO / PIMPLE, and only divergence schemes
                commonly need a per-case override (e.g. viscous
                high-Re cases wanting less upwinding). */}
            <details className="text-[11px] mt-1">
              <summary className="cursor-pointer text-bg-300 hover:text-bg-100 select-none py-1">
                + Discretization schemes
              </summary>
              <div className="space-y-2 mt-2 pl-2 border-l border-bg-800">
                <SchemeSelectRow
                  label="ddtSchemes default"
                  value={formValues.schemes.ddtDefault}
                  options={
                    isSteady
                      ? ["steadyState"]
                      : ["Euler", "CrankNicolson 0.9", "backward", "localEuler"]
                  }
                  onChange={(v) => updateScheme("ddtDefault", v as SolverControls["schemes"]["ddtDefault"])}
                  disabled={isSteady}
                  disabledReason={
                    isSteady
                      ? "SIMPLE-family solvers are steady-state by definition — ddt must be `steadyState`."
                      : undefined
                  }
                  title="Time-discretization scheme. steadyState for SIMPLE solvers (simpleFoam, buoyantSimpleFoam, potentialFoam); Euler / CrankNicolson / backward for transient solvers (icoFoam, pimpleFoam)."
                />
                {/* V1.12 review-fix #2 — CrankNicolson 0.9 caveats.
                    Picking `CrankNicolson` series requires
                    `runTimeModifiable true` in controlDict — OpenFOAM
                    crashes on the second iteration otherwise because
                    it can't re-read the ddt coefficient. We surface
                    this only when the user is on a transient solver
                    (the ddt row is locked for steady solvers so the
                    warning would be noise there). Amber pattern
                    mirrors V1.8.1's convergence-detector caveat. */}
                {!isSteady && (
                  <p className="text-[10px] text-amber-400/80 pl-1 leading-snug">
                    <span className="font-mono text-amber-400">CrankNicolson 0.9</span>{" "}
                    requires{" "}
                    <span className="font-mono text-amber-400">runTimeModifiable true</span>{" "}
                    in <span className="font-mono text-amber-400">controlDict</span>;
                    without it OpenFOAM crashes on the second iteration.{" "}
                    <span className="font-mono text-amber-400">Euler</span> and{" "}
                    <span className="font-mono text-amber-400">backward</span> don't
                    read a coefficient at runtime and are safe regardless.
                  </p>
                )}
                <SchemeSelectRow
                  label="gradSchemes default"
                  value={formValues.schemes.gradDefault}
                  options={[
                    "Gauss linear",
                    "Gauss linearUpwind",
                    "leastSquares",
                    "cellMDLimited Gauss linear 1",
                    "faceLimited Gauss linear 1",
                  ]}
                  onChange={(v) => updateScheme("gradDefault", v as SolverControls["schemes"]["gradDefault"])}
                  title="Gradient scheme. OpenFOAM stock `Gauss linear`; `leastSquares` is more accurate on non-orthogonal meshes at higher compute cost; `cellMDLimited Gauss linear 1` bounds the gradient coefficient."
                />
                <SchemeSelectRow
                  label="divSchemes default"
                  value={formValues.schemes.divDefault}
                  options={[
                    "none",
                    "Gauss linear",
                    "Gauss linearUpwind",
                    "Gauss QUICK",
                    "Gauss MUSCL",
                    "Gauss SFCD",
                    "Gauss vanLeer",
                  ]}
                  onChange={(v) => updateScheme("divDefault", v as SolverControls["schemes"]["divDefault"])}
                  title="Default divergence scheme. `none` is OpenFOAM stock (rely on per-field entries below for stability); `Gauss linear` is more accurate but less stable than linearUpwind on stretched meshes."
                />
                <SchemeSelectRow
                  label="laplacianSchemes default"
                  value={formValues.schemes.laplacianDefault}
                  options={[
                    "Gauss linear orthogonal",
                    "Gauss linear corrected",
                    "Gauss linear limited",
                  ]}
                  onChange={(v) => updateScheme("laplacianDefault", v as SolverControls["schemes"]["laplacianDefault"])}
                  title="Default laplacian (diffusion) scheme. `Gauss linear corrected` is OpenFOAM stock; `Gauss linear orthogonal` is cheaper on perfectly orthogonal meshes; `Gauss linear limited` bounds the correction term for stability."
                />
                <SchemeSelectRow
                  label="interpolationSchemes default"
                  value={formValues.schemes.interpolationDefault}
                  options={["linear", "midPoint", "midPointU", "faceCorrected"]}
                  onChange={(v) => updateScheme("interpolationDefault", v as SolverControls["schemes"]["interpolationDefault"])}
                  title="Surface interpolation scheme. `linear` (OpenFOAM stock) is symmetric and 2nd-order accurate; `midPointU` improves skewness handling on stretched meshes (face-area-weighted midpoint); `faceCorrected` blends across face diagonals for low-quality cells."
                />
                <SchemeSelectRow
                  label="snGradSchemes default"
                  value={formValues.schemes.snGradDefault}
                  options={[
                    "corrected",
                    "uncorrected",
                    "limited 0.333",
                    "limited 0.5",
                    "limited 0.7",
                  ]}
                  onChange={(v) => updateScheme("snGradDefault", v as SolverControls["schemes"]["snGradDefault"])}
                  title="Surface-normal gradient correction. `corrected` is OpenFOAM stock (applies the non-orthogonal correction); `uncorrected` skips it on orthogonal meshes (cheaper); `limited <coeff>` bounds the correction for moderately-skew meshes (0.5 is canonical)."
                />
                <p className="text-[10px] text-bg-300 leading-snug italic pl-1">
                  Per-field <span className="font-mono text-bg-100">div(phi,U)</span> /{" "}
                  <span className="font-mono text-bg-100">div(phi,k)</span> entries
                  remain hard-coded to <span className="font-mono text-bg-100">Gauss linearUpwind grad(X)</span>{" "}
                  &mdash; per-field overrides earn their own V.x.
                </p>
              </div>
            </details>
            {/* V1.13 — per-field divergence overrides. Folded into a
                separate <details> (rather than crowding V1.12's
                "+ Discretization schemes") because the surface is
                6 dropdown rows gated by turbulence model rather
                than 4 solver-agnostic selectors. Each row carries
                a "(stock — Gauss linearUpwind)" placeholder option
                so the user can revert to OpenFOAM's default in one
                click. Fields are gated to the active turbulence
                model: k/epsilon only on kEpsilon; k/omega only on
                kOmegaSST; nut/nuTilda only on SpalartAllmaras;
                div(phi,U) on every solver. PIMPLE / PISO / laminar
                solvers get only div(phi,U). */}
            {/* V1.13 review-fix — the per-field divergence rows are now
                rendered by filtering FIELD_DIV_ROWS against the active
                turbulence model (so adding a row for V1.13.1's
                `div(phi,T)` buoyant entry is a one-line schema+array
                edit). The cast cleanup is encapsulated in the
                `<FieldDivSelectRow>` wrapper so call sites pass
                `(v) => updateFieldDiv(r.key, v)` with typed narrowing. */}
            <details className="text-[11px] mt-1">
              <summary className="cursor-pointer text-bg-300 hover:text-bg-100 select-none py-1">
                + Per-field divergence
              </summary>
              <div className="space-y-2 mt-2 pl-2 border-l border-bg-800">
                {FIELD_DIV_ROWS.filter(
                  (r) =>
                    r.always ||
                    (r.solvers?.includes(formSolver) ?? false) ||
                    (r.turbulences?.includes(formValues.turbulence) ?? false),
                ).map((r) => (
                  <FieldDivSelectRow
                    key={r.rowKey}
                    rowKey={r.rowKey}
                    label={r.label}
                    title={r.title}
                    value={formValues.schemes.fieldDivs[r.rowKey]}
                    onChange={(v) => updateFieldDiv(r.rowKey, v)}
                  />
                ))}
                <p className="text-[10px] text-bg-300 leading-snug italic pl-1">
                  Selecting{" "}
                  <span className="font-mono text-bg-100">(stock — Gauss linearUpwind)</span>{" "}
                  drops the override so the template re-emits OpenFOAM's default at render time.
                </p>
              </div>
            </details>
            {/* V1.16 — per-field laplacian overrides. Mirrors V1.13's
                "+ Per-field divergence" detail block byte-for-byte,
                swapping DivFieldOverrides for PerFieldLaplacianOverrides,
                Gaussian linearUpwind for Gauss linear corrected, etc. Six
                rows gated by turbulence model + solver (laplacian(nuEff,U)
                on every solver; laplacian(DkEff,k) on kEpsilon|kOmegaSST;
                laplacian(DepsilonEff,epsilon) v. laplacian(DomegaEff,omega)
                on kEpsilon v. kOmegaSST; laplacian(DnuTildaEff,nuTilda) on
                SpalartAllmaras; laplacian(alphaEff,h) on buoyantSimpleFoam).
                PIMPLE / PISO / laminar solvers see only the always-on
                laplacian(nuEff,U) row. */}
            <details className="text-[11px] mt-1">
              <summary className="cursor-pointer text-bg-300 hover:text-bg-100 select-none py-1">
                + Per-field laplacian
              </summary>
              <div className="space-y-2 mt-2 pl-2 border-l border-bg-800">
                {FIELD_LAPLACIAN_ROWS.filter(
                  (r) =>
                    r.always ||
                    (r.solvers?.includes(formSolver) ?? false) ||
                    (r.turbulences?.includes(formValues.turbulence) ?? false),
                ).map((r) => (
                  <FieldLaplacianSelectRow
                    key={r.rowKey}
                    rowKey={r.rowKey}
                    label={r.label}
                    title={r.title}
                    value={formValues.schemes.fieldLaplacians[r.rowKey]}
                    onChange={(v) => updateFieldLaplacian(r.rowKey, v)}
                  />
                ))}
                <p className="text-[10px] text-bg-300 leading-snug italic pl-1">
                  Selecting{" "}
                  <span className="font-mono text-bg-100">(stock — Gauss linear corrected)</span>{" "}
                  drops the override so the per-field line collapses to OpenFOAM's stock behavior at render time.
                </p>
              </div>
            </details>
            {/* V1.17 — per-field snGrad overrides. Mirrors V1.16's
                "+ Per-field laplacian" detail block byte-for-byte,
                swapping PerFieldLaplacianOverrides for
                PerFieldSnGradOverrides, laplacian(nuEff,U) for snGrad(U),
                etc. Six rows gated by turbulence model + solver (snGrad(U)
                on every solver; snGrad(k) on kEpsilon|kOmegaSST;
                snGrad(epsilon) v. snGrad(omega) on kEpsilon v. kOmegaSST;
                snGrad(nuTilda) on SpalartAllmaras; snGrad(h) on
                buoyantSimpleFoam). PIMPLE / PISO / laminar solvers see
                only the always-on snGrad(U) row. */}
            <details className="text-[11px] mt-1">
              <summary className="cursor-pointer text-bg-300 hover:text-bg-100 select-none py-1">
                + Per-field snGrad
              </summary>
              <div className="space-y-2 mt-2 pl-2 border-l border-bg-800">
                {FIELD_SNGRAD_ROWS.filter(
                  (r) =>
                    r.always ||
                    (r.solvers?.includes(formSolver) ?? false) ||
                    (r.turbulences?.includes(formValues.turbulence) ?? false),
                ).map((r) => (
                  <FieldSnGradSelectRow
                    key={r.rowKey}
                    rowKey={r.rowKey}
                    label={r.label}
                    title={r.title}
                    value={formValues.schemes.fieldSnGrads[r.rowKey]}
                    onChange={(v) => updateFieldSnGrad(r.rowKey, v)}
                  />
                ))}
                <p className="text-[10px] text-bg-300 leading-snug italic pl-1">
                  Selecting{" "}
                  <span className="font-mono text-bg-100">(stock — corrected)</span>{" "}
                  drops the override so the per-field line collapses to OpenFOAM's stock behavior at render time.
                </p>
              </div>
            </details>
            {/* V1.19 — adaptive time-stepping toggle (transient solvers
                only). The whole `<details>` block is gated to
                pimpleFoam + icoFoam; SIMPLE-family solvers hide the
                block because OpenFOAM ignores the field entirely (the
                `case.ts` `emitAdaptiveTimeStep` boolean short-circuits
                the controlDict template to `adjustTimeStep no;`
                regardless). The toggle is always visible for the
                transient solvers because pimpleFoam users want to
                opt in to Courant-bounded Δt without rebuilding the
                case — the form persists the toggle across solver
                flips so flipping to simpleFoam -> back to pimpleFoam
                preserves the choice. `maxCo` is a positive number
                (typically 0.5-1.0; values above ~5 typically lose
                transient accuracy). The AdaptiveTimeStepPreview line
                below summarizes the active state in plain English so
                users can spot a too-loose / too-tight target without
                opening controlDict. */}
            {(formSolver === "pimpleFoam" || formSolver === "icoFoam") && (
              <details className="text-[11px] mt-1">
                <summary className="cursor-pointer text-bg-300 hover:text-bg-100 select-none py-1">
                  + Time-step adaptation
                </summary>
                <div className="space-y-2 mt-2 pl-2 border-l border-bg-800">
                  <Field label="Adjust Δt per iteration">
                    <label className="flex items-center gap-2 text-xs text-bg-300">
                      <input
                        type="checkbox"
                        checked={formValues.adaptiveTimeStep.enabled}
                        onChange={(e) => toggleAdaptiveTimeStep(e.target.checked)}
                        className="accent-accent-500"
                      />
                      <span>
                        With{" "}
                        <span className="font-mono text-bg-100">adjustTimeStep yes</span>
                        , OpenFOAM re-picks Δt every iteration so the Courant number
                        stays ≤ <span className="font-mono text-bg-100">maxCo</span>.
                        SIMPLE-family solvers ignore this knob; the toggle has effect
                        only on transient solvers. Off by default — set after
                        validating Co curves on coarse meshes.
                      </span>
                    </label>
                  </Field>
                  <Field label="maxCo (Courant target)">
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      min={0}
                      max={10}
                      value={formValues.adaptiveTimeStep.maxCo}
                      onChange={(e) => setMaxCo(e.target.value)}
                      title="Absolute Courant target. OpenFOAM adjusts Δt so Co stays ≤ this number. 0.5 is a common production default; 1.0 is OpenFOAM's stock; values above ~5 typically lose transient accuracy for viscous / multiphase flows."
                      className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                    />
                  </Field>
                  <AdaptiveTimeStepPreview values={formValues.adaptiveTimeStep} solver={formSolver} />
                </div>
              </details>
            )}
            {/* V1.20 — k-ε turbulence coefficients (gated to the
                kEpsilon turbulence model). The whole `<details>`
                block is hidden when the active model isn't kEpsilon
                since OpenFOAM only consumes Cmu/C1/C2/sigmak/sigmaEps
                inside the RAS `{model kEpsilon; ...}` block. Other
                RANS models (kOmegaSST, SpalartAllmaras) would need
                different coefficient families and earn their own V.x;
                mirroring how fieldDivs (V1.13) and fieldLaplacians
                (V1.16) were scoped per-model-first then extended.
                The 5 inputs default to OpenFOAM stock (Cmu 0.09, C1
                1.44, C2 1.92, sigmak 1.0, sigmaEps 1.3) so the form
                pre-populates exactly what OpenFOAM would have used
                anyway (this is the "zero behavior delta" baseline).
                The KEpsilonCoefficientsPreview line below flags
                significant C2/C1 ratio departures from the nominal
                1.33 — the well-tested k-ε stability ratio — so users
                don't drift into non-physical territory without
                noticing. */}
            {formValues.turbulence === "kEpsilon" && (
              <details className="text-[11px] mt-1">
                <summary className="cursor-pointer text-bg-300 hover:text-bg-100 select-none py-1">
                  + Turbulence coefficients (k-ε)
                </summary>
                <div className="space-y-2 mt-2 pl-2 border-l border-bg-800">
                  <div className="grid grid-cols-2 gap-1.5">
                    <Field label="Cμ (viscosity-factor)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={1}
                        value={formValues.turbulenceCoefficients.Cmu}
                        onChange={(e) => updateCoefficient("Cmu", e.target.value)}
                        title="Viscosity-factor Cμ in the k-ε closure. OpenFOAM stock 0.09; raising increases turbulent viscosity (faster mixing), lowering reduces near-wall dissipation (useful in confined-flow cases)."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="C1 (ε production, k)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={5}
                        value={formValues.turbulenceCoefficients.C1}
                        onChange={(e) => updateCoefficient("C1", e.target.value)}
                        title="Coefficient C1 multiplying the k-production term in the ε-equation. OpenFOAM stock 1.44; high-Re external flows occasionally want C1 ≈ 1.6 for stronger ε production."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="C2 (ε destruction)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={5}
                        value={formValues.turbulenceCoefficients.C2}
                        onChange={(e) => updateCoefficient("C2", e.target.value)}
                        title="Coefficient C2 multiplying the ε-destruction term. OpenFOAM stock 1.92; lowering C2 retains turbulent kinetic energy (slower dissipation), useful for separated flows where the k-ε model under-predicts ε."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="σk (k diffusion Pr)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={5}
                        value={formValues.turbulenceCoefficients.sigmak}
                        onChange={(e) => updateCoefficient("sigmak", e.target.value)}
                        title="Turbulent Prandtl number for k (analogous to molecular Pr for diffusive transport). OpenFOAM stock 1.0; lowering to ~0.7 strengthens k diffusion."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="σε (ε diffusion Pr)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={5}
                        value={formValues.turbulenceCoefficients.sigmaEps}
                        onChange={(e) => updateCoefficient("sigmaEps", e.target.value)}
                        title="Turbulent Prandtl number for ε. OpenFOAM stock 1.3; the asymmetry (σk=1.0 vs σε=1.3) is what makes the standard k-ε model numerically stable."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                  </div>
                  <KEpsilonCoefficientsPreview values={formValues.turbulenceCoefficients} />
                  <p className="text-[10px] text-bg-300 leading-snug italic pl-1">
                    Defaults match OpenFOAM stock (the standard k-ε
                    closure). Tuning outside well-tested ranges (e.g. C2
                    / C1 ≠ 1.33, σk ≠ 1.0, σε ≠ 1.3) indents into
                    non-physical territory; OpenFOAM may converge to a
                    steady state but the result will not match DNS.
                  </p>
                </div>
              </details>
            )}
            {/* V1.21 — k-ω SST turbulence coefficients (gated to the
                kOmegaSST turbulence model). Mirrors V1.20's
                kEpsilon details block exactly: 12 number inputs in a
                2-col grid + the KOmegegaSSTCoefficientsPreview line
                + the well-tested-range caveat. Parallel to V1.20's
                kEpsilon slot rather than a discriminated union (the
                template gates on `turbulence === 'kOmegaSST'` and
                reads from this sibling field directly). The 12
                inputs default to OpenFOAM stock Menter 2009 values
                (alphaK1 0.85, alphaK2 1.0, alphaOmega1 0.5,
                alphaOmega2 0.856, beta1 0.075, beta2 0.0828,
                betaStar 0.09, C1 2.0, gamma1 5/9, gamma2 7/8,
                sigmaK 0.6, sigmaOmega 0.5) so a fresh Build of a
                kOmegaSST case renders Cmu-equivalent stock behavior
                ("zero behavior delta" baseline). The optional `a1`
                limiter is intentionally absent — it requires an
                fvOptions::limitK entry that the form doesn't surface
                yet; the future V.x that lands that toggle should
                add `a1` here with its own gate. Clustered grouping:
                the 3 alpha limits (alphaK1/alphaK2/alphaOmega1/
                alphaOmega2) sit at the top so the user reads
                "diffusion limiters" first, the 3 betas (beta1,
                beta2, betaStar) next as "production / destruction
                balance", and the 4 + 2 (gamma1/gamma2 +
                sigmaK/sigmaOmega) close the form as "transport
                coefficients". The preview line flags significant
                betaStar departures from its stock value
                (the well-tested k-ω SST β* balance that keeps k
                bounded in adverse pressure gradients). */}
            {(formValues.turbulence === "kOmegaSST" || formValues.turbulence === "kOmegaSSTDES") && (
              <details className="text-[11px] mt-1">
                <summary className="cursor-pointer text-bg-300 hover:text-bg-100 select-none py-1">
                  + Turbulence coefficients (k-ω SST)
                </summary>
                <div className="space-y-2 mt-2 pl-2 border-l border-bg-800">
                  <p className="text-[10px] text-bg-300 leading-snug italic pl-1">
                    Diffusion limiters — α controls the cross-diffusion mix in SST's
                    F1 blend function. Stock (α_k1 0.85, α_k2 1.0, α_ω1 0.5, α_ω2 0.856) — raise
                    α_k1 to dampen k production in adverse pressure gradients; lower α_ω1 to
                    strengthen ω diffusion in the near-wall region.
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Field label="α_k1 (k-diff inner)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={5}
                        value={formValues.turbulenceCoefficientsKOmegaSST.alphaK1}
                        onChange={(e) => updateKOmegaSSTCoefficient("alphaK1", e.target.value)}
                        title="Diffusion-mix coefficient for k at the SST inner (low-Re k-ω) region. OpenFOAM stock α_k1 = 0.85 — raise to strengthen k dissipation (helpful when k blows up on separated flow)."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="α_k2 (k-diff outer)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={5}
                        value={formValues.turbulenceCoefficientsKOmegaSST.alphaK2}
                        onChange={(e) => updateKOmegaSSTCoefficient("alphaK2", e.target.value)}
                        title="Diffusion-mix coefficient for k at the SST outer (high-Re k-ε) region. OpenFOAM stock α_k2 = 1.0."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="α_ω1 (ω-diff inner)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={5}
                        value={formValues.turbulenceCoefficientsKOmegaSST.alphaOmega1}
                        onChange={(e) => updateKOmegaSSTCoefficient("alphaOmega1", e.target.value)}
                        title="Diffusion-mix coefficient for ω at the SST inner (low-Re k-ω) region. OpenFOAM stock α_ω1 = 0.5 — lower to strengthen ω diffusion in near-wall regions."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="α_ω2 (ω-diff outer)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={5}
                        value={formValues.turbulenceCoefficientsKOmegaSST.alphaOmega2}
                        onChange={(e) => updateKOmegaSSTCoefficient("alphaOmega2", e.target.value)}
                        title="Diffusion-mix coefficient for ω at the SST outer (high-Re k-ε) region. OpenFOAM stock α_ω2 = 0.856."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                  </div>
                  <p className="text-[10px] text-bg-300 leading-snug italic pl-1">
                    Production / destruction balance — β weights production, β* controls destruction.
                    Stock (β_1 0.075, β_2 0.0828, β* 0.09) — β* is the most sensitive coefficient in
                    k-ω SST; increasing it accelerates k dissipation (helpful when residuals
                    plateau on separated flows), decreasing it retains k longer (useful for
                    unsteady wake regions).
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Field label="β_1 (k prod coef)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={1}
                        value={formValues.turbulenceCoefficientsKOmegaSST.beta1}
                        onChange={(e) => updateKOmegaSSTCoefficient("beta1", e.target.value)}
                        title="Production-term coefficient in the k-equation. OpenFOAM stock β_1 = 0.075."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="β_2 (ω prod coef)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={1}
                        value={formValues.turbulenceCoefficientsKOmegaSST.beta2}
                        onChange={(e) => updateKOmegaSSTCoefficient("beta2", e.target.value)}
                        title="Production-term coefficient in the ω-equation. OpenFOAM stock β_2 = 0.0828."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="β* (k destruction)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={1}
                        value={formValues.turbulenceCoefficientsKOmegaSST.betaStar}
                        onChange={(e) => updateKOmegaSSTCoefficient("betaStar", e.target.value)}
                        title="Destruction-term coefficient in the k-equation (β*). OpenFOAM stock β* = 0.09. Increasing it strengthens k damping — typically the single most influential coefficient on adverse-pressure-gradient cases. Decreasing it retains k for wake / separated region studies."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="C1 (F1 limiter coef)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={5}
                        value={formValues.turbulenceCoefficientsKOmegaSST.C1}
                        onChange={(e) => updateKOmegaSSTCoefficient("C1", e.target.value)}
                        title="C1 in the F1 blend function / production limiter. OpenFOAM stock C1 = 2.0. This C1 is NOT the k-ε C1 (which is ~1.44) — they govern different terms."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                  </div>
                  <p className="text-[10px] text-bg-300 leading-snug italic pl-1">
                    Transport coefficients — γ controls cross-diffusion, σ the turbulent Pr.
                    Stock (γ_1 5/9 = 0.5556, γ_2 7/8 = 0.875, σ_k 0.6, σ_ω 0.5) — γ_1 and γ_2 stay
                    fixed at their OpenFOAM-encoded fractions for SST's stability guarantee.
                    σ_k ≠ σ_ω is what makes the SST model blend robust.
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Field label="γ_1 (k diffusion)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={1}
                        value={formValues.turbulenceCoefficientsKOmegaSST.gamma1}
                        onChange={(e) => updateKOmegaSSTCoefficient("gamma1", e.target.value)}
                        title="Cross-diffusion coefficient in the k-equation. OpenFOAM stock γ_1 = 5/9 ≈ 0.5556."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="γ_2 (ω diffusion)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={1}
                        value={formValues.turbulenceCoefficientsKOmegaSST.gamma2}
                        onChange={(e) => updateKOmegaSSTCoefficient("gamma2", e.target.value)}
                        title="Cross-diffusion coefficient in the ω-equation. OpenFOAM stock γ_2 = 7/8 = 0.875."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="σ_k (k Pr)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={5}
                        value={formValues.turbulenceCoefficientsKOmegaSST.sigmaK}
                        onChange={(e) => updateKOmegaSSTCoefficient("sigmaK", e.target.value)}
                        title="Turbulent Prandtl number for k (analogous to molecular Pr for diffusive transport). OpenFOAM stock σ_k = 0.6."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="σ_ω (ω Pr)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={5}
                        value={formValues.turbulenceCoefficientsKOmegaSST.sigmaOmega}
                        onChange={(e) => updateKOmegaSSTCoefficient("sigmaOmega", e.target.value)}
                        title="Turbulent Prandtl number for ω. OpenFOAM stock σ_ω = 0.5. The asymmetry (σ_k=0.6 v. σ_ω=0.5) is what makes the SST blend robust for adverse-pressure-gradient external flows."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                  </div>
                  <KOmegegaSSTCoefficientsPreview values={formValues.turbulenceCoefficientsKOmegaSST} />
                  <p className="text-[10px] text-bg-300 leading-snug italic pl-1">
                    Defaults match Menter's 2009 SST specification (the OpenFOAM stock k-ω SST
                    closure). Tuning outside well-tested ranges — particularly β* ≠ 0.09 or
                    γ_2 ≠ 7/8 — indents into non-physical territory; OpenFOAM may converge to a
                    steady state but residuals on separated-flow cases will not match DNS.
                    The optional `a1` limiter is intentionally absent here (it requires an
                    fvOptions::limitK entry; lands with that V.x, not V1.21).
                  </p>
                </div>
              </details>
            )}
            {/* V1.22 — Spalart-Allmaras turbulence coefficients (gated to
                the SpalartAllmaras turbulence model). Mirrors V1.20's
                kEpsilon and V1.21's kOmegaSST details block layout
                exactly: 9 number inputs in a 2-col grid (3+3+3
                clustered: production/destruction at the top, near-wall
                cubic ramp limiter + Cw1 user-input secondary limiter
                next, production-limit knobs at the bottom) +
                the SpalartAllmarasCoefficientsPreview line +
                the well-tested-range caveat. Parallel-slot design to
                V1.20's kEpsilon slot and V1.21's kOmegaSST slot
                rather than a discriminated union (the template gates
                on `turbulence === 'SpalartAllmaras'` and reads from
                this sibling field directly). The 9 inputs default to
                OpenFOAM stock (1994 + Pirzadeh 1999 cubic-ramp values:
                sigmaNut 0.667 = 2/3, kappa 0.41, Cb1 0.1355, Cb2 0.622,
                Cw1 0.3 user-input [NOT derived], Cw2 0.3 wall-damp
                secondary, Cw3 2.0 [cubic ramp], Cv1 7.1, Cv2 5.0) so a
                fresh Build of an SA case renders stock behavior ("zero
                behavior delta" baseline). The optional tripped-SAFvOptions
                coefficients (At, Bt, ct1, ct2, ct3, ct4) are
                intentionally absent — they require an
                fvOptions::trippedSA entry that the form doesn't surface
                yet; the future V.x that lands that toggle should add
                all 5 here with their own gate. NOTE on the labels:
                `σ_nut` / `C_b1` / etc. use the mixed-case Greek-suffix
                short forms (mirroring V1.21's `α_k1` style) so the
                OpenFOAM-stock identifier names are visually recognizable
                in the form labels; the underlying IDs in the
                Zod schema are pure ASCII (`sigmaNut`, `Cb1`) for
                Handlebars-parse simplicity. */}
            {formValues.turbulence === "SpalartAllmaras" && (
              <details className="text-[11px] mt-1">
                <summary className="cursor-pointer text-bg-300 hover:text-bg-100 select-none py-1">
                  + Turbulence coefficients (Spalart-Allmaras)
                </summary>
                <div className="space-y-2 mt-2 pl-2 border-l border-bg-800">
                  <p className="text-[10px] text-bg-300 leading-snug italic pl-1">
                    Production / destruction coefficients — C_b1 / C_b2 / C_w3 drive the
                    active SA dynamics (the three most-sensitive knobs on adverse-pressure-gradient
                    external flows). Stock (C_b1 0.1355, C_b2 0.622, C_w3 2.0 [Pirzadeh 1999 cubic
                    ramp]) — lowering C_b1 dampens production in high-attachment regions, raising
                    C_b2 retains turbulent kinetic energy for separated-wake studies, raising
                    C_w3 extends the cubic-ramp's near-wall curvature. Tuning outside well-tested
                    ranges indents into non-physical territory; OpenFOAM may converge to a steady
                    state but residuals on separation cases will not match DNS.
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Field label="σ_nut (turb Pr)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={5}
                        value={formValues.turbulenceCoefficientsSpalartAllmaras.sigmaNut}
                        onChange={(e) => updateSpalartAllmarasCoefficient("sigmaNut", e.target.value)}
                        title="Turbulent-quantity coupling σ_nut. OpenFOAM stock 0.667 (= 2/3). Tunes how strongly nuTilda transports to nu."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="κ (von Kármán)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={1}
                        value={formValues.turbulenceCoefficientsSpalartAllmaras.kappa}
                        onChange={(e) => updateSpalartAllmarasCoefficient("kappa", e.target.value)}
                        title="von Kármán constant. OpenFOAM stock 0.41 (RANS-universal). Listed here because OpenFOAM's SpalartAllmaras.C reads it from modelCoeffs even though the value is model-independent."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="C_b1 (production)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={1}
                        value={formValues.turbulenceCoefficientsSpalartAllmaras.Cb1}
                        onChange={(e) => updateSpalartAllmarasCoefficient("Cb1", e.target.value)}
                        title="Production coefficient — the most influential SA knob on adverse-pressure-gradient cases. OpenFOAM stock C_b1 = 0.1355. Tightening drops production (low-attachment regime); raising over-predicts separation."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="C_b2 (destruction)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={2}
                        value={formValues.turbulenceCoefficientsSpalartAllmaras.Cb2}
                        onChange={(e) => updateSpalartAllmarasCoefficient("Cb2", e.target.value)}
                        title="Destruction coefficient. OpenFOAM stock C_b2 = 0.622. Lowering retains turbulent kinetic energy for separated-wake regions."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="C_w1 (cubic input)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={1}
                        value={formValues.turbulenceCoefficientsSpalartAllmaras.Cw1}
                        onChange={(e) => updateSpalartAllmarasCoefficient("Cw1", e.target.value)}
                        title="Cubic-ramp near-wall coefficient. OpenFOAM accepts C_w1 as user input via modelCoeffs.C_w1 (literature canonical 0.3, which is the form’s stock value). Foundation OpenFOAM’s SpalartAllmaras.C lookupOrDefault FALLS BACK to the derived C_b1 / κ² + (1+C_b2) / σ_nut (~3.24) when the override is absent — emitting C_w1 0.3 here deliberately overrides that derivation. Pairing significant C_b1 changes with proportional C_w1 tuning is sometimes required for cubic-ramp near-wall equilibrium."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="C_w2 (wall damp sec.)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={1}
                        value={formValues.turbulenceCoefficientsSpalartAllmaras.Cw2}
                        onChange={(e) => updateSpalartAllmarasCoefficient("Cw2", e.target.value)}
                        title="Secondary wall-damping coefficient. OpenFOAM stock 0.06 (foundation SpalartAllmaras.C lookupOrDefault fallback)."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="C_w3 (cubic limiter)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={5}
                        value={formValues.turbulenceCoefficientsSpalartAllmaras.Cw3}
                        onChange={(e) => updateSpalartAllmarasCoefficient("Cw3", e.target.value)}
                        title="Cubic-ramp limiter coefficient (Pirzadeh 1999). OpenFOAM stock C_w3 = 2.0. Lowering truncates the cubic near-wall ramp earlier; raising extends it."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="C_v1 (prod. lim 1)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={20}
                        value={formValues.turbulenceCoefficientsSpalartAllmaras.Cv1}
                        onChange={(e) => updateSpalartAllmarasCoefficient("Cv1", e.target.value)}
                        title="Primary production limiter. OpenFOAM stock C_v1 = 7.1."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="C_v2 (prod. lim 2)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={20}
                        value={formValues.turbulenceCoefficientsSpalartAllmaras.Cv2}
                        onChange={(e) => updateSpalartAllmarasCoefficient("Cv2", e.target.value)}
                        title="Secondary production limiter. OpenFOAM stock C_v2 = 5.0."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                  </div>
                  <SpalartAllmarasCoefficientsPreview values={formValues.turbulenceCoefficientsSpalartAllmaras} />
                  <p className="text-[10px] text-bg-300 leading-snug italic pl-1">
                    Defaults match Spalart-Allmaras 1994 + Pirzadeh 1999 cubic ramp (the
                    OpenFOAM stock SA closure). Tuning outside well-tested ranges —
                    particularly C_b1 ≠ 0.1355 (production) or C_w3 ≠ 2.0 (cubic-ramp
                    limiter) — indents into non-physical territory; OpenFOAM may
                    converge to a steady state but residuals on separated-flow cases
                    will not match DNS. The 5 tripped-SAFvOptions coefficients
                    (At, Bt, ct1, ct2, ct3, ct4) are intentionally absent here, as they
                    require an fvOptions::trippedSA entry that the form doesn't yet
                    surface; the future V.x that lands general fvOptions support
                    should add all 5 alongside a conditional render gate.
                  </p>
                </div>
              </details>
            )}
            <p className="text-[10px] text-bg-300 leading-snug">
              Generates <span className="font-mono text-bg-100">blockMeshDict</span>, <span className="font-mono text-bg-100">snappyHexMeshDict</span>,
              patch-aware <span className="font-mono text-bg-100">0/U</span> &amp; <span className="font-mono text-bg-100">0/p</span>,
              and writes the on-disk state to <span className="font-mono text-bg-100">.cfd-app-state.json</span>.
{/* V1.23 -- LES sub-grid-scale turbulence coefficients. Gated
                to the LES models (Smagorinsky | WALE) so RANS models
                (laminar / kEpsilon / kOmegaSST / SpalartAllmaras) don't
                see the LES sub-block. Mirrors V1.20 / V1.21 / V1.22
                RANS details block layout: input row(s) gated to the
                active LES model + the LESCoefficientsPreview line + the
                well-tested-range caveat. Each LES model has a SINGLE
                input (Smagorinsky's Cs or WALE's Cw); parallel design
                keeps the form's row count minimal. The
                LESCoefficientsPreview helper receives the active
                turbulence model as a prop so it can switch display +
                tolerance gate internally for Cs (Smagorinsky, 25% drift
                gate) vs Cw (WALE, 15% drift gate). Other LES variants
                (kEqn, dynamicSmagorinsky, dynamicLagrangian,
                SpalartAllmarasDES) are deferred to a future V.x unlock;
                V1.23 closes the basic single-coefficient LES coverage
                of the Build Case form. */}
            {(formValues.turbulence === "Smagorinsky" || formValues.turbulence === "WALE") && (
              <details className="text-[11px] mt-1">
                <summary className="cursor-pointer text-bg-300 hover:text-bg-100 select-none py-1">
                  + Turbulence coefficients (LES)
                </summary>
                <div className="space-y-2 mt-2 pl-2 border-l border-bg-800">
                  <p className="text-[10px] text-bg-300 leading-snug italic pl-1">
                    Sub-grid-scale (SGS) coefficient -- single OpenFOAM-stock per LES model.
                    <span className="font-mono text-bg-100">Smagorinsky</span>{" "}
                    carries C_s (sub-grid eddy-viscosity via C_s² · δ · |S|, Smagorinsky 1963 / Lilly 1967);
                    <span className="font-mono text-bg-100"> WALE</span>{" "}
                    carries C_w (cubic-structure SGS, Nicoud + Ducros 1999, with
                    automatic near-wall zero-eddy-viscosity). Tuning outside the
                    documented well-tested ranges breaks the model physics --
                    OpenFOAM may converge but the result won't match DNS.
                  </p>
                  {formValues.turbulence === "Smagorinsky" && (
                    <Field label="C_s (Smagorinsky)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={1}
                        value={formValues.turbulenceCoefficientsLES.Cs}
                        onChange={(e) => updateLESCoefficient("Cs", e.target.value)}
                        title="Smagorinsky sub-grid coefficient C_s (Smagorinsky 1963 / Lilly 1967). OpenFOAM stock 0.2. Lilly's well-tested range is 0.10-0.25; values above ~0.3 over-damp the resolved scales and values below ~0.10 under-resolve near-wall energy cascades."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                  )}
                  {formValues.turbulence === "WALE" && (
                    <Field label="C_w (WALE)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={1}
                        value={formValues.turbulenceCoefficientsLES.Cw}
                        onChange={(e) => updateLESCoefficient("Cw", e.target.value)}
                        title="WALE constant C_w (Nicoud + Ducros 1999). OpenFOAM stock 0.325. Well-tested range is 0.30-0.35; the cubic structure gives WALE automatic near-wall zero-eddy-viscosity, so tuning the coefficient away from the calibrated value breaks the wall adaption quickly."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                  )}
                  <LESCoefficientsPreview
                    model={formValues.turbulence}
                    values={formValues.turbulenceCoefficientsLES}
                  />
                  <p className="text-[10px] text-bg-300 leading-snug italic pl-1">
                    Defaults match OpenFOAM stock (C_s 0.2 [Smagorinsky 1963 / Lilly 1967] for Smagorinsky;
                    C_w 0.325 [Nicoud + Ducros 1999] for WALE). The simulationType
                    line in constant/momentumTransport always reads{" "}
                    <span className="font-mono text-bg-100">simulationType  LES;</span>
                    {" "}when either LES model is active (via the
                    <span className="font-mono text-bg-100">{"{{#if (or (eq turbulence 'Smagorinsky') (eq turbulence 'WALE'))}}"}</span>
                    {" "}Handlebars gate registered in case.ts). Other LES variants
                    (kEqn, dynamicSmagorinsky, dynamicLagrangian, SpalartAllmarasDES)
                    are deferred to a future V.x unlock.
                  </p>
                </div>
              </details>
            )}
            {/* V1.24 -- k-equation LES sub-grid-scale coefficient block.
                Gated to `turbulence === 'kEqn'` so the Smagorinsky /
                WALE block and 4 RANS model blocks stay separate.
                Mirrors V1.22 SA / V1.23 LES layout: input grid + the
                KEqnCoefficientsPreview line + the well-tested-range
                caveat. 3 input rows for Ck / Ce1 / Ce2; the closure
                updateKEqnCoefficient gates to `turbulence === 'kEqn'`.
                The isLES Handlebars helper (registered in case.ts)
                drives the simulationType LES branch in
                constant/momentumTransport. Other LES variants
                (dynamicSmagorinsky / dynamicLagrangian /
                SpalartAllmarasDES / kOmegaSSTDES) are deferred to
                V1.25 / V1.26. */}
            {formValues.turbulence === "kEqn" && (
              <details className="text-[11px] mt-1">
                <summary className="cursor-pointer text-bg-300 hover:text-bg-100 select-none py-1">
                  + Turbulence coefficients (k-equation)
                </summary>
                <div className="space-y-2 mt-2 pl-2 border-l border-bg-800">
                  <p className="text-[10px] text-bg-300 leading-snug italic pl-1">
                    Sub-grid-scale (SGS) coefficients for the k-equation model -- three coupled
                    OpenFOAM-stock values. <span className="font-mono text-bg-100">Ck</span>{" "}
                    is the gradient-filter coefficient (Germano 1991) calibrating how
                    aggressively the resolved scales bleed energy into the test field;
                    <span className="font-mono text-bg-100">Ce1</span>{" "}
                    and <span className="font-mono text-bg-100">Ce2</span>{" "}
                    form the filtered structure-function dissipation-rate pair. Tuning
                    outside the documented well-tested ranges (Ck in [0.07, 0.12],
                    Ce1 & Ce2 in [0.85, 1.20]) indents into non-physical territory;
                    OpenFOAM may converge but the result won't match DNS.
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Field label="C_k (filter coef)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={1}
                        value={formValues.turbulenceCoefficientsKEqn.Ck}
                        onChange={(e) => updateKEqnCoefficient("Ck", e.target.value)}
                        title="OpenFOAM gradient-filter coefficient Ck (Germano 1991). OpenFOAM stock 0.094. Sets how aggressively the resolved scales bleed energy into the test field; well-tested range is 0.05-0.12."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="C_e1 (diss 1)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={5}
                        value={formValues.turbulenceCoefficientsKEqn.Ce1}
                        onChange={(e) => updateKEqnCoefficient("Ce1", e.target.value)}
                        title="OpenFOAM k-eqn filtered structure-function dissipation rate 1 (Ce1). OpenFOAM stock 1.048. Well-tested range is 0.85-1.20."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                    <Field label="C_e2 (diss 2)">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        min={0}
                        max={5}
                        value={formValues.turbulenceCoefficientsKEqn.Ce2}
                        onChange={(e) => updateKEqnCoefficient("Ce2", e.target.value)}
                        title="OpenFOAM k-eqn filtered structure-function dissipation rate 2 (Ce2). OpenFOAM stock 1.048. Companion to Ce1, same well-tested range."
                        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                      />
                    </Field>
                  </div>
                  <KEqnCoefficientsPreview values={formValues.turbulenceCoefficientsKEqn} />
                  <p className="text-[10px] text-bg-300 leading-snug italic pl-1">
                    Defaults match OpenFOAM stock (Ck 0.094, Ce1 1.048, Ce2 1.048). The
                    simulationType line in constant/momentumTransport reads{" "}
                    <span className="font-mono text-bg-100">simulationType  LES;</span>{" "}
                    for kEqn (matching Smagorinsky / WALE / future LES variants) via the
                    Handlebars<span className="font-mono text-bg-100"> (isLES turbulence)</span>{" "}
                    helper registered in case.ts. Other LES variants (dynamicSmagorinsky,
                    dynamicLagrangian, SpalartAllmarasDES, kOmegaSSTDES) are deferred to V1.25 / V1.26.
                  </p>
                </div>
              </details>
            )}
            {/* V1.25 -- DES shielding-function coefficient block. Gated to turbulence === 'kOmegaSSTDES' so the SpalartAllmarasDES / dyn-Smagorinsky / dyn-Lagrangian blocks stay separate. Single input row + CDESCoefficientsPreview line + well-tested-range caveat. The 25% drift gate in the preview matches the form's [0.50, 0.85] well-tested range claim. */}
{formValues.turbulence === "kOmegaSSTDES" && (
  <details className="text-[11px] mt-1">
    <summary className="cursor-pointer text-bg-300 hover:text-bg-100 select-none py-1">
      + DES shielding coefficient (C_DES)
    </summary>
    <div className="space-y-2 mt-2 pl-2 border-l border-bg-800">
      <Field label="C_DES (DES shield)">
        <input
          type="number"
          step="any"
          inputMode="decimal"
          min={0}
          max={5}
          value={formValues.turbulenceCoefficientsCDES.CDES}
          onChange={(e) => updateCDESCoefficient("CDES", e.target.value)}
          title="Hybrid RANS/LES shielding-function coefficient (CDES). OpenFOAM stock 0.65 (Shur + Spalart + Strelets 2008). Sets how aggressively the model switches from RANS to LES on separated regions; well-tested range is 0.50-0.85."
          className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
        />
      </Field>
      <CDESCoefficientsPreview values={formValues.turbulenceCoefficientsCDES} />
    </div>
  </details>
)}
                          Edit <span className="font-mono text-bg-100">0/U</span> afterward for inlet / outlet BCs.
            </p>
          </div>
        )}
      </Section>

      <ResultsSection
        activeCaseDir={activeCaseDir}
        resultsAvailableTimes={resultsAvailableTimes}
        resultsFieldsByTime={resultsFieldsByTime}
        resultsSelectedTime={resultsSelectedTime}
        resultsSelectedField={resultsSelectedField}
        resultsIsLoading={resultsIsLoading}
        onSelectTime={selectResultsTime}
        onSelectField={selectResultsField}
        onReveal={revealResultsInFileManager}
        onOpenDir={openResultsDir}
      />

      <div className="mt-auto border-t border-bg-800 p-3 bg-bg-900">
        <div className="text-xs font-semibold text-bg-300 mb-1.5">Create patch</div>
        <div className="flex gap-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="patch name (e.g. inlet)"
            className="flex-1 px-2 py-1.5 text-sm bg-bg-800 border border-bg-800 rounded text-bg-100 placeholder:text-bg-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <button
            onClick={() => {
              const p = createPatch(newName || `patch-${patches.length + 1}`);
              if (selectedFaceIds.size > 0) assignSelectionToPatch(p.id);
            }}
            disabled={!prep}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-accent-500 hover:bg-accent-600 disabled:opacity-40 disabled:cursor-not-allowed text-bg-950"
          >
            Create
          </button>
        </div>
        <p className="text-[10px] text-bg-300 mt-2 leading-snug">
          Patches export to <span className="font-mono text-bg-100">constant/triSurface/&lt;name&gt;.stl</span> ready for <span className="font-mono text-bg-100">snappyHexMeshDict.geometry</span>.
        </p>
      </div>
    </aside>
  );
}

function Section(props: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-bg-800 p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] uppercase tracking-wide font-semibold text-bg-300">{props.title}</h3>
        {props.right}
      </div>
      {props.children}
    </section>
  );
}

function Empty({ children, className, placeholder: _placeholder }: { children: React.ReactNode; className?: string; placeholder?: string }) {
  return <div className={"text-xs text-bg-300 italic" + (className ? " " + className : "")}>{children}</div>;
}

/**
 * V1.1 — post-run results browser. Mounts inside PatchPanel below the Build
 * Case section. Reads from the results slice; on first render with an active
 * case it lazily lists time dirs and (on time-select) field names.
 */
function ResultsSection(props: {
  activeCaseDir: string | null;
  resultsAvailableTimes: number[];
  resultsFieldsByTime: Record<number, string[]>;
  resultsSelectedTime: number | null;
  resultsSelectedField: string | null;
  resultsIsLoading: boolean;
  onSelectTime: (t: number) => void;
  onSelectField: (f: string) => void;
  onReveal: () => void;
  onOpenDir: () => void;
}) {
  const {
    activeCaseDir,
    resultsAvailableTimes,
    resultsFieldsByTime,
    resultsSelectedTime,
    resultsSelectedField,
    resultsIsLoading,
    onSelectTime,
    onSelectField,
    onReveal,
    onOpenDir,
  } = props;
  const hasResults = resultsAvailableTimes.length > 0 || resultsIsLoading;
  return (
    <Section title="Results" right={
      hasResults ? (
        <div className="flex gap-1">
          <button
            onClick={onReveal}
            disabled={!activeCaseDir}
            title="Reveal the case's VTK output in the OS file manager"
            className="text-[11px] px-2 py-1 rounded text-bg-300 hover:text-bg-100 hover:bg-bg-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Reveal
          </button>
          <button
            onClick={onOpenDir}
            disabled={!activeCaseDir}
            title="Open the case's VTK output dir in the OS file manager"
            className="text-[11px] px-2 py-1 rounded text-bg-300 hover:text-bg-100 hover:bg-bg-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Open dir
          </button>
        </div>
      ) : null
    }>
      {!activeCaseDir ? (
        <Empty>No case active. Build or pick a case first.</Empty>
      ) : resultsIsLoading && resultsAvailableTimes.length === 0 ? (
        <Empty>Loading…</Empty>
      ) : resultsAvailableTimes.length === 0 ? (
        <Empty>No results yet — run a case to populate the &lt;time&gt; dirs.</Empty>
      ) : (
        <>
          <Field label="Time">
            <select
              value={resultsSelectedTime != null ? String(resultsSelectedTime) : ""}
              onChange={(e) => onSelectTime(Number(e.target.value))}
              className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
            >
              {resultsAvailableTimes.map((t) => (
                <option key={t} value={t}>{t.toFixed(2)}</option>
              ))}
            </select>
          </Field>
          {(() => {
            const t = resultsSelectedTime;
            if (t == null) return null;
            const all = resultsFieldsByTime[t] ?? [];
            if (all.length === 0) return <Empty className="mt-2">No fields at this time.</Empty>;
            const whitelist = /^(U|p|T|k|epsilon|omega|nuTilda|nut|mut|alphat|alpha\..*)$/;
            const phys = all.filter((f) => whitelist.test(f));
            const other = all.filter((f) => !whitelist.test(f));
            const chip = (f: string) => (
              <button
                key={f}
                onClick={() => onSelectField(f)}
                className={
                  "px-2 py-1 rounded text-[11px] font-mono border " +
                  (resultsSelectedField === f
                    ? "bg-accent-500/20 text-accent-300 border-accent-500/40"
                    : "bg-bg-800 text-bg-300 border-bg-800 hover:bg-bg-700")
                }
              >
                {f}
              </button>
            );
            return (
              <>
                {phys.length > 0 && (
                  <Field label="Physical fields">
                    <div className="flex flex-wrap gap-1">{phys.map(chip)}</div>
                  </Field>
                )}
                {other.length > 0 && (
                  <Field label="Other">
                    <div className="flex flex-wrap gap-1">{other.map(chip)}</div>
                  </Field>
                )}
                {resultsSelectedField && (
                  <div className="mt-2 text-[11px] text-bg-300">
                    <span>Selected: </span>
                    <span className="font-mono text-bg-100">{resultsSelectedField}</span>
                    <span> @ t=</span>
                    <span className="font-mono text-bg-100">{t.toFixed(2)}</span>
                    <p className="mt-1 italic text-bg-300/70">
                      Raw OpenFOAM field dumps are large; use Reveal/Open to inspect in the OS file manager.
                    </p>
                  </div>
                )}
              </>
            );
          })()}
        </>
      )}
    </Section>
  );
}

// ---------- V1.4 — Refinement level row ----------

/** Coerce arbitrary input to an integer in the 0..7 snappy range. */
function clampRefinementLevel(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(7, Math.round(raw)));
}

function RefinementRow(props: {
  patchId: string;
  refinement: PatchRefinement;
  onChange: (patchId: string, refinement: PatchRefinement) => void;
}) {
  const { patchId, refinement, onChange } = props;
  const onMinChange = (raw: string) => {
    const n = clampRefinementLevel(Number(raw));
    onChange(patchId, { min: n, max: Math.max(n, refinement.max) });
  };
  const onMaxChange = (raw: string) => {
    const n = clampRefinementLevel(Number(raw));
    onChange(patchId, { min: Math.min(n, refinement.min), max: n });
  };
  return (
    <div className="grid grid-cols-[2rem_1fr_1fr] items-center gap-1.5 mt-1.5">
      <span className="text-[10px] uppercase tracking-wider text-bg-300 font-mono">
        Lvl
      </span>
      <input
        type="number"
        min={0}
        max={7}
        step={1}
        value={refinement.min}
        onChange={(e) => onMinChange(e.target.value)}
        title="Min snappy refinement level (0..7)"
        aria-label="Min refinement level"
        className="w-full px-1.5 py-0.5 text-[11px] bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
      />
      <input
        type="number"
        min={0}
        max={7}
        step={1}
        value={refinement.max}
        onChange={(e) => onMaxChange(e.target.value)}
        title="Max snappy refinement level (0..7)"
        aria-label="Max refinement level"
        className="w-full px-1.5 py-0.5 text-[11px] bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-bg-300 mb-0.5">{label}</span>
      {children}
    </label>
  );
}

/**
 * V1.5 — quick-look text below the Build Case button that turns the user's
 * numeric knobs into plain English: "1.0s physics · ~1000 dumps · keep 10".
 * Helps users spot the obvious foot-guns (writeInterval=1 → 1000 dumps;
 * purgeWrite=0 → fills disk on a long run) without opening controlDict.
 */
function RunTimePreview({ values, isSteady }: { values: SolverControls; isSteady: boolean }) {
  // Guard against divide-by-zero when the user just typed a bad value.
  const safeInterval = Math.max(1, values.writeInterval);
  const safeDeltaT = Math.max(1e-9, values.deltaT);
  const dumps = isSteady
    ? Math.max(1, Math.ceil(values.endTime / safeInterval))
    : Math.max(1, Math.ceil(values.endTime / (safeDeltaT * safeInterval)));
  return (
    <p className="text-[10px] text-bg-300 leading-snug italic">
      {isSteady ? (
        <>
          <span className="text-bg-100 font-mono not-italic">{values.endTime}</span>{" "}
          iterations · ≈<span className="text-bg-100 font-mono not-italic">{dumps}</span>{" "}
          dumps · keep latest{" "}
          <span className="text-bg-100 font-mono not-italic">{values.purgeWrite}</span>
        </>
      ) : (
        <>
          <span className="text-bg-100 font-mono not-italic">{values.endTime}</span>s{" "}
          physics · ≈<span className="text-bg-100 font-mono not-italic">{dumps}</span>{" "}
          dumps · keep latest{" "}
          <span className="text-bg-100 font-mono not-italic">{values.purgeWrite}</span>
        </>
      )}
    </p>
  );
}

// V1.8 — detector preview line. Mirrors the V1.5 RunTimePreview style:
// "Stable for N iterates · threshold 1.0e-3 · auto-stop OFF · detector
// ACTIVE". Color-codes ON/ACTIVE blocks in emerald to make it easy to
// spot an enabled-but-misconfigured detector at a glance.
function ConvergencePreview({
  values,
  isSteady,
}: {
  values: {
    enabled: boolean;
    maxInitialResidual: number;
    stableIterations: number;
    autoStop: boolean;
  };
  isSteady: boolean;
}) {
  const n = values.stableIterations;
  return (
    <p className="text-[10px] text-bg-300 leading-snug italic">
      Stable for{" "}
      <span className="text-bg-100 font-mono not-italic">{n}</span>{" "}
      {n === 1 ? "iterate" : "iterates"} · threshold{" "}
      <span className="text-bg-100 font-mono not-italic">
        {values.maxInitialResidual.toExponential(1)}
      </span>{" "}
      · auto-stop{" "}
      <span
        className={
          values.autoStop
            ? "text-emerald-300 not-italic font-mono"
            : "text-bg-300 not-italic font-mono"
        }
      >
        {values.autoStop ? "ON" : "OFF"}
      </span>{" "}
      · detector{" "}
      <span
        className={
          values.enabled
            ? "text-emerald-300 not-italic font-mono"
            : "text-bg-300 not-italic font-mono"
        }
      >
        {values.enabled ? "ACTIVE" : "DISABLED"}
      </span>
      {" "}· {isSteady ? "steady" : "transient"} detector profile
    </p>
  );
}

// ---------- V1.10 — Per-field residual override ----------

/**
 * V1.10 — single-field input for the per-field residual-tolerance
 * override. Bundles the `Field` label wrap + the `<input>` element
 * that all six-or-so overrides share, so the PatchPanel JSX stays
 * scannable when we add a 7th override (say h, when LES comes back
 * in a later V.x). Empty input = use the global `residualControl`
 * (the `{{or override default}}` Handlebars helper picks this up at
 * template-render time).
 */
function ResidualOverrideRow(props: {
  field: string;
  value: string | undefined;
  onChange: (raw: string) => void;
  title?: string;
  // V1.30 -- accept the form outer-scope placeholder ("use residualControl")
  //  shown in the per-field override input. The internal <input> below
  //  already reads `props.placeholder` so this is strictly a typed-surface
  //  widening -- no renderable behavior changes.
  placeholder?: string;
}) {
  return (
    <Field label={props.field}>
      <input
        type="number"
        step="any"
        inputMode="decimal"
        value={props.value ?? ""}
        onChange={(e) => props.onChange(e.target.value)}
        title={
          props.title ?? `Per-field override for ${props.field}. Empty = use the global residualControl.`
        }
        placeholder="use residualControl"
        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
      />
    </Field>
  );
}

/**
 * V1.18d — matrix-solver configuration row. Three inputs per row
 *  (solver dropdown + tolerance number + relTol number). Mirrors
 *  V1.11's `RelaxationFactorRow` shape but for the fvSolution
 *  `solvers` block. The `<select>` for the solver kind carries the
 *  closed `MatrixSolverValue` enum literals (GAMG, PCG,
 *  smoothSolver, PBiCG, PBiCGStab); the coupled smoother/
 *  preconditioner line is emitted via the `smootherLine` Handlebars
 *  helper in case.ts so OpenFOAM gets the right keyword + name per
 *  solver family.
 */
function MatrixSolverRow(props: {
  group: "p" | "U" | "turbulence";
  label: string;
  value: { solver: MatrixSolverValue; tolerance: number; relTol: number };
  onChange: (next: { solver: MatrixSolverValue; tolerance: number; relTol: number }) => void;
  title: string;
}) {
  const { group, label, value, onChange, title } = props;
  const onSolverChange = (s: string) => onChange({ ...value, solver: s as MatrixSolverValue });
  const onToleranceChange = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    onChange({ ...value, tolerance: n });
  };
  const onRelTolChange = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    onChange({ ...value, relTol: n });
  };
  return (
    <Field label={label}>
      <div className="space-y-1">
        <select
          value={value.solver}
          onChange={(e) => onSolverChange(e.target.value)}
          title={title + " (solver kind)"}
          aria-label={`${group} matrix solver`}
          className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
        >
          {MATRIX_SOLVER_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-1">
          <input
            type="number"
            step="any"
            inputMode="decimal"
            min={0}
            value={value.tolerance}
            onChange={(e) => onToleranceChange(e.target.value)}
            title={title + " (absolute tolerance)"}
            aria-label={`${group} tolerance`}
            placeholder="1e-7"
            className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
          />
          <input
            type="number"
            step="any"
            inputMode="decimal"
            min={0}
            value={value.relTol}
            onChange={(e) => onRelTolChange(e.target.value)}
            title={title + " (relative tolerance)"}
            aria-label={`${group} relTol`}
            placeholder={group === "p" ? "0.01" : "0.1"}
            className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
          />
        </div>
      </div>
    </Field>
  );
}

/**
 * V1.18d — closed enum of OpenFOAM matrix solver kinds surfaced in
 *  the Build Case form's "Matrix solvers" details. Mirrors
 *  MatrixSolverValueSchema verbatim. Kept as a module-level constant
 *  so the dropdown doesn't reallocate the array on every render.
 */
const MATRIX_SOLVER_OPTIONS: ReadonlyArray<MatrixSolverValue> = [
  "GAMG",
  "PCG",
  "smoothSolver",
  "PBiCG",
  "PBiCGStab",
];

/**
 * V1.11 — single-field input for the SIMPLE relaxation-factor
 *  overrides. Mirrors V1.10's `ResidualOverrideRow` shape but
 *  for the fvSolution `relaxationFactors` block. Empty input
 *  causes the template `{{or override default}}` fallback at
 *  render time (the placeholder prop surfaces the default in
 *  the UI so the user knows what's coming when the field is
 *  empty). `min=0 max=1` clamps because OpenFOAM only accepts
 *  relaxation factors in (0,1].
 */
function RelaxationFactorRow(props: {
  group: "fields" | "equations";
  key: string;
  value: number | undefined;
  onChange: (raw: string) => void;
  title: string;
  placeholder: string;
}) {
  return (
    <Field label={props.key}>
      <input
        type="number"
        step="any"
        inputMode="decimal"
        min={0}
        max={1}
        value={props.value ?? ""}
        onChange={(e) => props.onChange(e.target.value)}
        title={props.title}
        placeholder={props.placeholder}
        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
      />
    </Field>
  );
}

/**
 * V1.10 fix-pass polish — extracted from the inline IIFE that was
 * sitting in the `Per-field overrides (SIMPLE)` Field body so the
 * PatchPanel file keeps its named-helper-component rhythm
 * (numericsAlgorithm, NumericsPreview, ResidualOverrideRow, this).
 * Renders the "N of M fields overridden · empty inputs fall back
 * · X stale" summary line and the underlying count/derivation.
 * Future edits (e.g., making the stale badge click-to-clear, or
 * escalating the color when stale > 2) become a single-component
 * edit instead of nested-arrow-function surgery.
 */
/**
 * V1.19 — adaptive-time-stepping preview line. Mirrors V1.8's
 *  `ConvergencePreview` style: emerald-conditional badge for the
 *  `enabled` state so the user can spot an enabled-but-misconfigured
 *  toggle at a glance. Renders inline below the `maxCo` input so
 *  the user sees the resolved state without opening controlDict.
 *  `solver` is forwarded for the "(transient guard)" appendage so the
 *  summary makes it obvious when the toggle is dormant (steady
 *  solver, will not reach controlDict even when enabled).
 */
function AdaptiveTimeStepPreview({
  values,
  solver,
}: {
  values: AdaptiveTimeStep;
  solver: 'icoFoam' | 'simpleFoam' | 'pimpleFoam' | 'potentialFoam' | 'buoyantSimpleFoam';
}) {
  const isTransient = solver === 'pimpleFoam' || solver === 'icoFoam';
  return (
    <p className="text-[10px] text-bg-300 leading-snug italic">
      Co ≤{" "}
      <span className="text-bg-100 font-mono not-italic">{values.maxCo}</span>{" "}
      · adaptive{" "}
      <span
        className={
          values.enabled
            ? "text-emerald-300 not-italic font-mono"
            : "text-bg-300 not-italic font-mono"
        }
      >
        {values.enabled ? "ON" : "OFF"}
      </span>
      {!isTransient && values.enabled && (
        <span
          className="text-amber-400/80 ml-1"
          title="SIMPLE-family solvers ignore the adaptiveTimeStep field entirely in OpenFOAM; case.ts short-circuits the controlDict template to `adjustTimeStep no;` regardless of this toggle."
        >
          (dormant — steady solver)
        </span>
      )}
    </p>
  );
}

/**
 * V1.20 — k-ε coefficient preview line. Mirrors V1.8's
 *  `ConvergencePreview` style: emerald-conditional badge for any
 *  parameter that's "trivially stock" (matches OpenFOAM defaults
 *  to ~0.01 precision), amber flag for the C2/C1 ratio when it
 *  departs significantly from the nominal 1.33 (the well-tested
 *  stability zone). Catches the common foot-gun of dialing C2
 *  high without realizing it short-circuits the model's energy
 *  drain and produces non-physical mixing.
 */
function KEpsilonCoefficientsPreview({
  values,
}: {
  values: KEpsilonCoefficients;
}) {
  const stock = Math.abs(values.Cmu - 0.09) < 1e-3 &&
    Math.abs(values.C1 - 1.44) < 1e-3 &&
    Math.abs(values.C2 - 1.92) < 1e-3 &&
    Math.abs(values.sigmak - 1.0) < 1e-3 &&
    Math.abs(values.sigmaEps - 1.3) < 1e-3;
  const cRatio = values.C2 / values.C1;
  const cRatioStable = Math.abs(cRatio - 1.333) < 0.1;
  return (
    <p className="text-[10px] text-bg-300 leading-snug italic">
      C2/C1 ={" "}
      <span className="text-bg-100 font-mono not-italic">{cRatio.toFixed(3)}</span>
      {" · "}
      <span
        className={
          stock
            ? "text-emerald-300 not-italic font-mono"
            : "text-bg-300 not-italic font-mono"
        }
      >
        {stock ? "OPENFOAM STOCK" : "tuned"}
      </span>
      {!cRatioStable && (
        <span
          className="text-amber-400/80 ml-1"
          title="C2/C1 ≈ 1.33 is the well-tested k-ε stability zone; OpenFOAM stock is exactly 1.92/1.44 ≈ 1.333. Departures > 0.1 can break the model's energy balance and produce non-physical mixing."
        >
          (C2/C1 outside 1.23-1.43 stability zone)
        </span>
      )}
    </p>
  );
}

function PerFieldOverrideSummary(props: {
  values: {
    enabled: boolean;
    nNonOrthogonalCorrectors: number;
    nCorrectors: number;
    nOuterCorrectors: number;
    residualControl: string;
    residualControlByField: Record<string, string>;
  };
  solver: SolverControls["solver"];
  turbulence: SolverControls["turbulence"];
}) {
  // V1.10 review-fix #1 + #2 — derive the displayed-fields list
  //  here, count only overrides on DISPLAYED fields, and join the
  //  list with commas (so `k, omega` reads as two fields rather
  //  than one plural-noun `k+omega`).
  const displayed = [
    "p",
    "U",
    ...(props.solver === "buoyantSimpleFoam" ? ["T"] : []),
    ...(props.turbulence === "kEpsilon" ? ["k", "epsilon"] : []),
    ...(props.turbulence === "kOmegaSST" ? ["k", "omega"] : []),
    ...(props.turbulence === "SpalartAllmaras" ? ["nuTilda"] : []),
  ];
  const overrideMap = props.values.residualControlByField;
  const overriddenCount = displayed.filter((k) => overrideMap[k] !== undefined).length;
  const staleCount = Object.keys(overrideMap).filter((k) => !displayed.includes(k)).length;
  return (
    <p className="text-[10px] text-bg-300 leading-snug mt-1 pl-1">
      <span className="font-mono text-bg-100">{overriddenCount}</span>{" "}
      of{" "}
      <span className="font-mono text-bg-100">{displayed.length}</span>{" "}
      fields overridden · empty inputs fall back to the global{" "}
      <span className="font-mono text-bg-100">residualControl</span>
      {staleCount > 0 && (
        <>
          {" · "}
          <span
            className="text-amber-400/80 font-mono"
            title="Overridden keys for fields the active solver/turbulence combo doesn't currently render. They still apply at template-render time if a future solver brings the field back into scope."
          >
            {staleCount} stale
          </span>{" "}
          from prior builds
        </>
      )}
    </p>
  );
}

/**
 * V1.13 — per-field divergence row descriptor. Each entry declares
 *  the schema key, the dropdown label, the active turbulence-model
 *  gate (omit `turbulences` + set `always: true` for solver-agnostic
 *  rows), and the row's title-tooltip. The Build Case form's "+ Per-
 *  field divergence" section filters by these gates and renders the
 *  surviving rows via `<FieldDivSelectRow>`. Adding a 7th row for
 *  V1.13.1 (e.g. `div(phi,T)` for buoyantSimpleFoam) is now a
 *  one-line schema + one-line array edit, instead of duplicating the
 *  gated JSX ladder that this used to have inline.
 */
const FIELD_DIV_ROWS: ReadonlyArray<{
  rowKey: keyof DivFieldOverrides;
  label: string;
  title: string;
  always?: boolean;
  /** V1.14 — per-row solver gate. If non-empty, the row renders when
   *  `formSolver` is in the list. Default (omitted) means no solver
   *  constraint. When a row sets BOTH `solvers?` and `turbulences?`,
   *  EITHER gate match renders the row (OR semantics — matches the
   *  filter expression `r.always || r.solvers || r.turbulences`
   *  below). No current row uses both gates; if a future V.x needs
   *  row-level AND-of-gates (render only when both solver AND
   *  turbulence match), factor a tighter filter expression and
   *  extend the per-row type accordingly. */
  solvers?: ReadonlyArray<SolverControls["solver"]>;
  turbulences?: ReadonlyArray<SolverControls["turbulence"]>;
}> = [
  {
    rowKey: "div_phi_U",
    label: "div(phi,U)",
    title:
      "Discretization for the velocity-divergence term. OpenFOAM stock is `Gauss linearUpwind grad(U)` for boundedness; switch to `Gauss QUICK` / `MUSCL` for high-Re accuracy on smooth meshes (no sharp gradients).",
    always: true,
  },
  {
    rowKey: "div_phi_k",
    label: "div(phi,k)",
    title:
      "Discretization for turbulent kinetic energy divergence. Same pattern as div(phi,U); linearUpwind is the OpenFOAM default for k.",
    turbulences: ["kEpsilon", "kOmegaSST"],
  },
  {
    rowKey: "div_phi_epsilon",
    label: "div(phi,epsilon)",
    title: "Discretization for epsilon (kEpsilon only).",
    turbulences: ["kEpsilon"],
  },
  {
    rowKey: "div_phi_omega",
    label: "div(phi,omega)",
    title: "Discretization for omega (kOmegaSST only).",
    turbulences: ["kOmegaSST"],
  },
  {
    rowKey: "div_phi_nut",
    label: "div(phi,nut)",
    title: "Discretization for the solved turbulent viscosity (SpalartAllmaras only).",
    turbulences: ["SpalartAllmaras"],
  },
  {
    rowKey: "div_phi_nuTilda",
    label: "div(phi,nuTilda)",
    title: "Discretization for the modified viscosity nuTilda (SpalartAllmaras only).",
    turbulences: ["SpalartAllmaras"],
  },
  {
    // V1.14 — energy-field divergence (buoyantSimpleFoam only). T
    //  is undefined for the other 4 solvers, so the row hides when
    //  formSolver !== 'buoyantSimpleFoam'. Mirrors the template's
    //  `{{#if (eq solver 'buoyantSimpleFoam')}}` guard on the
    //  div(phi,T) line.
    rowKey: "div_phi_T",
    label: "div(phi,T)",
    title:
      "Discretization for the energy-field divergence (buoyantSimpleFoam only). Same `Gauss linearUpwind grad(T)` pattern as the velocity divergence; switch to `linear` for less diffusive behavior on coarse meshes.",
    solvers: ["buoyantSimpleFoam"],
  },
];

/**
 * V1.13 — option list for the per-field divergence dropdowns. The
 *  leading empty-string entry renders as "(stock — Gauss linearUpwind)"
 *  in the UI; selecting it drops the override and the template's
 *  `{{or schemes.fieldDivs.div_phi_X "Gauss linearUpwind"}}` helper
 *  falls back to OpenFOAM's stock linearUpwind-prefixed line at render
 *  time. Kept as a module-level constant so the per-field closure
 *  doesn't reallocate the array on every render.
 */
const DIV_FIELD_OPTIONS: ReadonlyArray<string> = [
  "",
  "Gauss linear",
  "Gauss linearUpwind",
  "Gauss QUICK",
  "Gauss MUSCL",
  "Gauss SFCD",
  "Gauss vanLeer",
];

/**
 * V1.13 — sentinel-display label for the leading empty-string option
 *  in `DIV_FIELD_OPTIONS`. Rendered as a placeholder-style option tag;
 *  we use a regular `<option>` rather than a placeholder because
 *  React + browsers handle <option value=""> robustly. Extract the
 *  label here for clarity at the JSX site.
 */
const DIV_FIELD_STOCK_LABEL = "— stock (Gauss linearUpwind) —";

/**
 * V1.16 — per-field laplacian row descriptor. Mirrors `<FIELD_DIV_ROWS>`
 *  shape exactly: array of `{ rowKey, label, title, always?, solvers?,
 *  turbulences? }` filtered at render time by the active solver +
 *  turbulence model. The Build Case form's "+ Per-field laplacian"
 *  section filters these against the same gate predicate and renders
 *  the surviving rows via `<FieldLaplacianSelectRow>`. Adding a 7th
 *  row for a future V.x (e.g. `laplacian(kappaEff,T)` for a thermal
 *  transport model) becomes a one-line schema-add + one-line array-
 *  entry edit instead of duplicating the gated JSX ladder.
 */
const FIELD_LAPLACIAN_ROWS: ReadonlyArray<{
  rowKey: keyof PerFieldLaplacianOverrides;
  label: string;
  title: string;
  always?: boolean;
  solvers?: ReadonlyArray<SolverControls["solver"]>;
  turbulences?: ReadonlyArray<SolverControls["turbulence"]>;
}> = [
  {
    rowKey: "laplacian_nuEff_U",
    label: "laplacian(nuEff,U)",
    title:
      "Discretization for the velocity-diffusion term. OpenFOAM stock is `Gauss linear corrected` (matches the laplacianDefault); switch to `Gauss linear limited 0.5` for boundedness on highly-skew meshes (typical snappy geometry near concave features).",
    always: true,
  },
  {
    rowKey: "laplacian_DkEff_k",
    label: "laplacian(DkEff,k)",
    title:
      "Discretization for the turbulent-kinetic-energy diffusion term (kEpsilon + kOmegaSST). Same pattern as laplacian(nuEff,U); `Gauss linear limited 0.7` is often enough for typical 3-5M-cell meshes.",
    turbulences: ["kEpsilon", "kOmegaSST"],
  },
  {
    rowKey: "laplacian_DepsilonEff_epsilon",
    label: "laplacian(DepsilonEff,epsilon)",
    title: "Discretization for epsilon diffusion (kEpsilon only).",
    turbulences: ["kEpsilon"],
  },
  {
    rowKey: "laplacian_DomegaEff_omega",
    label: "laplacian(DomegaEff,omega)",
    title: "Discretization for omega diffusion (kOmegaSST only).",
    turbulences: ["kOmegaSST"],
  },
  {
    rowKey: "laplacian_DnuTildaEff_nuTilda",
    label: "laplacian(DnuTildaEff,nuTilda)",
    title:
      "Discretization for the modified-viscosity diffusion term (SpalartAllmaras only).",
    turbulences: ["SpalartAllmaras"],
  },
  {
    rowKey: "laplacian_alphaEff_h",
    label: "laplacian(alphaEff,h)",
    title:
      "Discretization for the enthalpy diffusion term (buoyantSimpleFoam only). Same boundedness trade-off as laplacian(nuEff,U); on hot regions adjacent to cold walls, `Gauss linear limited 0.5` reduces spurious diffusion of the thermal boundary layer.",
    solvers: ["buoyantSimpleFoam"],
  },
];

/**
 * V1.16 — option list for the per-field laplacian dropdowns. Mirrors
 *  V1.13's `DIV_FIELD_OPTIONS` exactly: leading empty-string sentinel
 *  renders as `LAPLACIAN_FIELD_STOCK_LABEL`, selecting it drops the
 *  override and the template `{{or schemes.fieldLaplacians.X "Gauss
 *  linear corrected"}}` falls back to OpenFOAM's stock value at
 *  render time.
 */
const LAPLACIAN_FIELD_OPTIONS: ReadonlyArray<string> = [
  "",
  "Gauss linear orthogonal",
  "Gauss linear corrected",
  "Gauss linear limited 0.5",
  "Gauss linear limited 0.7",
  "Gauss linear limited 0.9",
];

/**
 * V1.16 — sentinel-display label for the leading empty-string option
 *  in `LAPLACIAN_FIELD_OPTIONS`. Mirrors V1.13's `DIV_FIELD_STOCK_LABEL`
 *  verbatim (just for a different OpenFOAM fallback value). The label
 *  is consumed by `<FieldLaplacianSelectRow>` via the new `stockLabel`
 *  prop on `<SchemeSelectRow>` so each per-field wrapper family can
 *  display its own "(stock — OpenFOAM default)" text.
 */
const LAPLACIAN_FIELD_STOCK_LABEL = "— stock (Gauss linear corrected) —";

/**
 * V1.17 — per-field snGrad row descriptor. Mirrors `<FIELD_LAPLACIAN_ROWS>`
 *  shape exactly: array of `{ rowKey, label, title, always?, solvers?,
 *  turbulences? }` filtered at render time by the active solver +
 *  turbulence model. The Build Case form's "+ Per-field snGrad" section
 *  filters these against the same gate predicate and renders the
 *  surviving rows via `<FieldSnGradSelectRow>`. Adding a 7th row for a
 *  future V.x (e.g. `snGrad(alpha)` for an LES-specific scalar field)
 *  becomes a one-line schema-add + one-line array-entry edit instead of
 *  duplicating the gated JSX ladder.
 */
const FIELD_SNGRAD_ROWS: ReadonlyArray<{
  rowKey: keyof PerFieldSnGradOverrides;
  label: string;
  title: string;
  always?: boolean;
  solvers?: ReadonlyArray<SolverControls["solver"]>;
  turbulences?: ReadonlyArray<SolverControls["turbulence"]>;
}> = [
  {
    rowKey: "snGrad_U",
    label: "snGrad(U)",
    title:
      "Surface-normal-gradient correction for the velocity field. OpenFOAM stock is `corrected` (non-orthogonal correction applied); switch to `uncorrected` on perfectly orthogonal meshes (saves the inner-product work); `limited 0.5` bounds the correction for moderately-skew meshes where the correction term can dominate.",
    always: true,
  },
  {
    rowKey: "snGrad_k",
    label: "snGrad(k)",
    title:
      "Surface-normal-gradient correction for turbulent kinetic energy (kEpsilon + kOmegaSST). Same pattern as snGrad(U); `corrected` is stock and widely adequate.",
    turbulences: ["kEpsilon", "kOmegaSST"],
  },
  {
    rowKey: "snGrad_epsilon",
    label: "snGrad(epsilon)",
    title: "Surface-normal-gradient correction for epsilon (kEpsilon only).",
    turbulences: ["kEpsilon"],
  },
  {
    rowKey: "snGrad_omega",
    label: "snGrad(omega)",
    title: "Surface-normal-gradient correction for omega (kOmegaSST only).",
    turbulences: ["kOmegaSST"],
  },
  {
    rowKey: "snGrad_nuTilda",
    label: "snGrad(nuTilda)",
    title:
      "Surface-normal-gradient correction for the modified viscosity (SpalartAllmaras only).",
    turbulences: ["SpalartAllmaras"],
  },
  {
    rowKey: "snGrad_h",
    label: "snGrad(h)",
    title:
      "Surface-normal-gradient correction for the enthalpy field (buoyantSimpleFoam only). OpenFOAM's buoyantSimpleFoam solves an energy equation on enthalpy h; the snGrad correction here is the surface-normal-gradient term OpenFOAM uses when interpolating h-to-face for diffusion. `limited 0.5` bounds the correction on moderately-skew meshes.",
    solvers: ["buoyantSimpleFoam"],
  },
];

/**
 * V1.17 — option list for the per-field snGrad dropdowns. Mirrors V1.16's
 *  `LAPLACIAN_FIELD_OPTIONS` shape: leading empty-string sentinel renders
 *  as `SNGRAD_FIELD_STOCK_LABEL`; selecting it drops the override and
 *  the template `{{or schemes.fieldSnGrads.X "corrected"}}` falls back
 *  to OpenFOAM's stock `corrected` value at render time. The snGrad
 *  correction has no `orthogonal` variant (unlike laplacian), so the
 *  enum is shorter than LaplacianFieldSchemeValueSchema.
 */
const SNGRAD_FIELD_OPTIONS: ReadonlyArray<string> = [
  "",
  "corrected",
  "uncorrected",
  "limited 0.5",
  "limited 0.7",
  "limited 0.9",
];

/**
 * V1.17 — sentinel-display label for the leading empty-string option
 *  in `SNGRAD_FIELD_OPTIONS`. Mirrors V1.16's `LAPLACIAN_FIELD_STOCK_LABEL`
 *  and V1.13's `DIV_FIELD_STOCK_LABEL` for the OpenFOAM `corrected`
 *  fallback. Consumed by `<FieldSnGradSelectRow>` via the `stockLabel`
 *  prop on `<SchemeSelectRow>`. All three stock-label constants follow
 *  the same convention: each per-field wrapper family passes its own
 *  label so users see a per-family "(stock — OpenFOAM default)" hint.
 */
const SNGRAD_FIELD_STOCK_LABEL = "— stock (corrected) —";

/**
 * V1.13 review-fix — typed wrapper around `<SchemeSelectRow>` for the
 *  per-field divergence overrides. Encapsulates the per-call cast
 *  (`v as DivSchemeValue | ""`) so callers don't have to repeat it at
 *  every row of the `<FIELD_DIV_ROWS>` map. Also handles the
 *  `value ?? ""` mapping (the underlying `formValues.schemes.fieldDivs`
 *  entries are `DivSchemeValue | undefined`, but `<select>.value` is
 *  always a string).
 */
function FieldDivSelectRow(props: {
  rowKey: keyof DivFieldOverrides;
  label: string;
  title: string;
  value: DivSchemeValue | undefined;
  onChange: (value: DivSchemeValue | "") => void;
}) {
  // V1.13 fix-pass nit — explicit inner cast documents the trust
  // boundary: `<SchemeSelectRow>.onChange` is typed `(value: string) =>
  // void`, but we KNOW it can only emit `""` or one of the closed
  // `DIV_FIELD_OPTIONS` literals (`Gauss linear` / `linearUpwind` /
  // `QUICK` / `MUSCL` / `SFCD` / `vanLeer`). Without the explicit cast
  // this works under React's bivariant callback-parameter convention
  // but silently widens the type at the wrapper's inner edge — readers
  // of the wrapper body can't see the trust claim. The single cast
  // here makes the contract self-documenting: "we accept any string
  // from `<select>`, but we trust it to be in the closed enum, so we
  // re-narrow it here before delegating to the parent's typed
  // callback." Costs nothing at runtime.
  //
  // V1.16 review-pass — the temporary `stockLabel={DIV_FIELD_STOCK_LABEL}`
  //  pass-through was redundant (matches the default in
  //  `<SchemeSelectRow>`) and got dropped for cleanliness; the
  //  wrapper relies on the default fallback now.
  return (
    <SchemeSelectRow
      label={props.label}
      value={props.value ?? ""}
      options={DIV_FIELD_OPTIONS}
      onChange={(v) => props.onChange(v as DivSchemeValue | "")}
      title={props.title}
    />
  );
}

/**
 * V1.16 — typed wrapper around `<SchemeSelectRow>` for the per-field
 *  laplacian overrides. Mirrors `<FieldDivSelectRow>` (V1.13) byte-
 *  for-byte, swapping DivFieldOverrides → PerFieldLaplacianOverrides,
 *  DivSchemeValue → LaplacianFieldSchemeValue, and the divergent
 *  sentinel + option list. The inner cast documents the trust claim
 *  that `<SchemeSelectRow>.onChange` only emits `""` or one of the
 *  closed `LAPLACIAN_FIELD_OPTIONS` literals (orthogonal / corrected
 *  / limited 0.5/0.7/0.9), so we re-narrow before delegating to the
 *  parent's typed callback.
 */
function FieldLaplacianSelectRow(props: {
  rowKey: keyof PerFieldLaplacianOverrides;
  label: string;
  title: string;
  value: LaplacianFieldSchemeValue | undefined;
  onChange: (value: LaplacianFieldSchemeValue | "") => void;
}) {
  return (
    <SchemeSelectRow
      label={props.label}
      value={props.value ?? ""}
      options={LAPLACIAN_FIELD_OPTIONS}
      onChange={(v) => props.onChange(v as LaplacianFieldSchemeValue | "")}
      title={props.title}
      stockLabel={LAPLACIAN_FIELD_STOCK_LABEL}
    />
  );
}

/**
 * V1.17 — typed wrapper around `<SchemeSelectRow>` for the per-field
 *  snGrad overrides. Mirrors `<FieldLaplacianSelectRow>` (V1.16)
 *  byte-for-byte, swapping PerFieldLaplacianOverrides →
 *  PerFieldSnGradOverrides and LaplacianFieldSchemeValue →
 *  SnGradFieldSchemeValue. The inner cast documents the trust claim
 *  that `<SchemeSelectRow>.onChange` only emits `""` or one of the
 *  closed `SNGRAD_FIELD_OPTIONS` literals (corrected / uncorrected /
 *  limited 0.5/0.7/0.9), so we re-narrow before delegating to the
 *  parent's typed callback. Each per-field wrapper family passes its
 *  own `stockLabel` (V1.16 fix-pass convention) so the dropdown shows
 *  a per-family "(stock — OpenFOAM default)" hint instead of leaking
 *  the laplacian fallback's text into snGrad rows.
 */
function FieldSnGradSelectRow(props: {
  rowKey: keyof PerFieldSnGradOverrides;
  label: string;
  title: string;
  value: SnGradFieldSchemeValue | undefined;
  onChange: (value: SnGradFieldSchemeValue | "") => void;
}) {
  return (
    <SchemeSelectRow
      label={props.label}
      value={props.value ?? ""}
      options={SNGRAD_FIELD_OPTIONS}
      onChange={(v) => props.onChange(v as SnGradFieldSchemeValue | "")}
      title={props.title}
      stockLabel={SNGRAD_FIELD_STOCK_LABEL}
    />
  );
}

/**
 * V1.12 — single dropdown row for one fvSchemes `default` selector.
 * `options` is a closed enum literal array (typed loosely so the
 * grid can use the discriminated `as DdtSchemeValue` cast at the
 * call site); the disabled props lock the row when the active
 * solver imposes a single valid choice (e.g. ddtDefault for
 * steady solvers).
 *
 * V1.16 — added opt-in `stockLabel` prop so per-field wrappers
 * (FieldDivSelectRow, FieldLaplacianSelectRow) can render their own
 * "(stock — OpenFOAM default)" sentinel rather than hardcoded
 * `DIV_FIELD_STOCK_LABEL`. Falls back to `DIV_FIELD_STOCK_LABEL`
 * for backward compat with the four V1.12 `default`-selector rows
 * that don't carry a sentinel.
 */
function SchemeSelectRow(props: {
  label: string;
  value: string;
  options: ReadonlyArray<string>;
  onChange: (value: string) => void;
  disabled?: boolean;
  disabledReason?: string;
  title?: string;
  stockLabel?: string;
}) {
  const stockLabel = props.stockLabel ?? DIV_FIELD_STOCK_LABEL;
  return (
    <Field label={props.label}>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled ?? false}
        title={
          props.disabled
            ? props.disabledReason ?? props.title ?? ""
            : props.title ?? ""
        }
        className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {props.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt === "" ? stockLabel : opt}
          </option>
        ))}
      </select>
    </Field>
  );
}

// ---------- V1.9 — Numerics helpers ----------

/**
 * Pick the OpenFOAM algorithm family that drives this solver so the
 * preview line + per-solver conditional rendering + template block
 * all branch on a single source of truth. PIMPLE has outer+corr+non-
 * orth, PISO has corr+non-orth, SIMPLE has non-orth + residual
 * tolerance. `potentialFoam` runs the PISO loop internally even
 * though its name suggests "potential" — the algorithm tag is what
 * matters for the template, not the solver's brand name.
 */
function numericsAlgorithm(solver: SolverControls["solver"]): "PIMPLE" | "PISO" | "SIMPLE" {
  if (solver === "pimpleFoam") return "PIMPLE";
  if (solver === "icoFoam" || solver === "potentialFoam") return "PISO";
  return "SIMPLE";
}

/**
 * Mirror of `RunTimePreview` / `ConvergencePreview`. Renders the
 * active numerics shape in plain English so users can spot a
 * misconfigured corrector before clicking Build. The algorithm chip
 * is colored emerald when corrector knobs are `enabled`, matching
 * ConvergencePreview's ACTIVE/DISABLED pattern.
 */
function NumericsPreview({
  values,
  algorithm,
}: {
  values: {
    enabled: boolean;
    nNonOrthogonalCorrectors: number;
    nCorrectors: number;
    nOuterCorrectors: number;
    residualControl: string;
  };
  algorithm: "PIMPLE" | "PISO" | "SIMPLE";
}) {
  const knobs = [
    `non-orth ${values.nNonOrthogonalCorrectors}`,
    algorithm !== "SIMPLE" ? `correctors ${values.nCorrectors}` : null,
    algorithm === "PIMPLE" ? `outer ${values.nOuterCorrectors}` : null,
    // V1.49b -- residualControl is now a string after the V1.49 schema migration.
    //  Render directly so the chip matches the canonical emit form ('1e-4')
    //  instead of the previous Number().toExponential(1) wrapper which produced
    //  '1.0e-4' (extra zero, cosmetic drift from data). maxInitialResidual
    //  (line 2661) still uses toExponential(1) because it remains a Number.
    algorithm === "SIMPLE" ? `residual ${values.residualControl}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <p className="text-[10px] text-bg-300 leading-snug italic">
      <span
        className={
          values.enabled
            ? "text-emerald-300 not-italic font-mono"
            : "text-bg-300 not-italic font-mono"
        }
      >
        {algorithm}
      </span>{" "}
      algorithm · {knobs}{" "}
      · knobs{" "}
      <span
        className={
          values.enabled
            ? "text-emerald-300 not-italic font-mono"
            : "text-bg-300 not-italic font-mono"
        }
      >
        {values.enabled ? "ACTIVE" : "DISABLED"}
      </span>
    </p>
  );
}

// ---------- V1.2 — Boundary conditions editor ----------

/** The six BC kinds the editor exposes. `cyclic` is omitted on purpose —
 *  OpenFOAM's cyclic requires a paired `neighbourPatch` clause which the
 *  editor can't meaningfully maintain; users who need it can post-edit 0/U
 *  by hand. */
const BC_KINDS: ReadonlyArray<BcField["type"]> = [
  "fixedValue",
  "zeroGradient",
  "noSlip",
  "slip",
  "symmetryPlane",
  "empty",
];

const BC_KIND_LABEL: Record<BcField["type"], string> = {
  fixedValue: "fixedValue",
  zeroGradient: "zeroGradient",
  noSlip: "noSlip",
  slip: "slip",
  cyclic: "cyclic",
  symmetryPlane: "symmetryPlane",
  empty: "empty",
};

/** True for BC kinds that take a value field in OpenFOAM. */
function bcNeedsValue(t: BcField["type"]): boolean {
  return t === "fixedValue";
}

/** Coerce a possibly-undefined value to a safe default for the given field. */
function defaultValueFor(field: "velocity" | "pressure"): BcField["value"] {
  return field === "velocity" ? [0, 0, 0] : 0;
}

/** Coerce a value to a 3-tuple of finite numbers (for velocity fixedValue). */
function asVec(v: BcField["value"] | undefined): [number, number, number] {
  if (Array.isArray(v) && v.length === 3) {
    return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
  }
  return [0, 0, 0];
}

/** Coerce a value to a finite number (for pressure fixedValue). */
function asScalar(v: BcField["value"] | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Read the BC for a (patch, field) pair, falling back to a sensible default
 *  if the slice has no entry yet (shouldn't happen for created patches, but
 *  legacy .cfd-app-state.json files may not have seeded entries). */
function readBc(
  bcs: BoundaryConditions,
  patchName: string,
  field: "velocity" | "pressure",
): BcField {
  const entry = bcs[field][patchName];
  if (entry) return entry;
  return field === "velocity"
    ? { type: "noSlip" }
    : { type: "zeroGradient" };
}

function BoundaryConditionsSection(props: {
  prep: ReturnType<typeof useGeometryStore.getState>["prep"];
  patches: ReturnType<typeof useGeometryStore.getState>["patches"];
  boundaryConditions: BoundaryConditions;
  onSetPatchBc: (
    patchId: string,
    field: "velocity" | "pressure",
    bc: BcField,
  ) => void;
  // V1.4 — per-patch refinement slice and setter.
  patchRefinements: PatchRefinements;
  onSetPatchRefinement: (patchId: string, refinement: PatchRefinement) => void;
}) {
  const {
    prep,
    patches,
    boundaryConditions: bcs,
    onSetPatchBc,
    patchRefinements: refs,
    onSetPatchRefinement,
  } = props;
  return (
    <Section title="Boundary conditions">
      {!prep ? (
        <Empty>Load a geometry file to set per-patch BCs.</Empty>
      ) : patches.length === 0 ? (
        <Empty>Create a patch below to assign BCs to it.</Empty>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] text-bg-300 leading-snug">
            Each row controls the <span className="font-mono text-bg-100">0/U</span> and
            <span className="font-mono text-bg-100"> 0/p</span> BCs plus the snappy
            refinement level for one patch when the case is built. Defaults:
            <span className="font-mono text-bg-100"> noSlip</span> for U,
            <span className="font-mono text-bg-100"> zeroGradient</span> for p, and
            <span className="font-mono text-bg-100"> (0 2)</span> for refinement.
          </p>
          <ul className="space-y-1.5">
            {patches.map((p) => {
              const u = readBc(bcs, p.name, "velocity");
              const pB = readBc(bcs, p.name, "pressure");
              return (
                <li
                  key={p.id}
                  className="bg-bg-900 border border-bg-800 rounded p-2"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className="font-semibold text-bg-100 text-xs truncate"
                      title={p.name}
                    >
                      {p.name}
                    </span>
                    <span className="text-[10px] text-bg-300 font-mono">
                      {p.faceIndices.length} faces
                    </span>
                  </div>
                  <BcFieldRow
                    label="U"
                    field="velocity"
                    patchId={p.id}
                    bc={u}
                    onChange={onSetPatchBc}
                  />
                  <BcFieldRow
                    label="p"
                    field="pressure"
                    patchId={p.id}
                    bc={pB}
                    onChange={onSetPatchBc}
                  />
                  <RefinementRow
                    patchId={p.id}
                    refinement={refs[p.name] ?? { min: 0, max: 0 }}
                    onChange={onSetPatchRefinement}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Section>
  );
}

function BcFieldRow(props: {
  label: string;
  field: "velocity" | "pressure";
  patchId: string;
  bc: BcField;
  onChange: (
    patchId: string,
    field: "velocity" | "pressure",
    bc: BcField,
  ) => void;
}) {
  const { label, field, patchId, bc, onChange } = props;
  const onTypeChange = (newType: BcField["type"]) => {
    if (newType === "fixedValue") {
      onChange(patchId, field, {
        type: newType,
        value: defaultValueFor(field),
      });
    } else {
      // Drop the value when switching to a non-value BC.
      onChange(patchId, field, { type: newType });
    }
  };
  const onVecChange = (axis: 0 | 1 | 2, raw: string) => {
    const n = Number(raw);
    const v = asVec(bc.value);
    v[axis] = Number.isFinite(n) ? n : 0;
    onChange(patchId, field, { type: "fixedValue", value: v });
  };
  const onScalarChange = (raw: string) => {
    const n = Number(raw);
    onChange(patchId, field, {
      type: "fixedValue",
      value: Number.isFinite(n) ? n : 0,
    });
  };
  const needsVal = bcNeedsValue(bc.type);
  return (
    <div className="grid grid-cols-[2rem_1fr] items-center gap-1.5 mt-1.5">
      <span className="text-[10px] uppercase tracking-wider text-bg-300 font-mono">
        {label}
      </span>
      <div className="space-y-1">
        <select
          value={bc.type}
          onChange={(e) => onTypeChange(e.target.value as BcField["type"])}
          className="w-full px-1.5 py-0.5 text-[11px] bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
        >
          {BC_KINDS.map((k) => (
            <option key={k} value={k}>
              {BC_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        {needsVal && field === "velocity" && (
          <div className="grid grid-cols-3 gap-1">
            {(["Ux", "Uy", "Uz"] as const).map((axis, i) => (
              <input
                key={axis}
                type="number"
                step="any"
                value={asVec(bc.value)[i]}
                onChange={(e) => onVecChange(i as 0 | 1 | 2, e.target.value)}
                title={`${axis} (m/s)`}
                aria-label={`${axis} (m/s)`}
                className="w-full px-1.5 py-0.5 text-[11px] bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
              />
            ))}
          </div>
        )}
        {needsVal && field === "pressure" && (
          <input
            type="number"
            step="any"
            value={asScalar(bc.value)}
            onChange={(e) => onScalarChange(e.target.value)}
            title="p (Pa or m^2/s^2 for kinematic pressure)"
            aria-label="Pressure value"
            className="w-full px-1.5 py-0.5 text-[11px] bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
          />
        )}
      </div>
    </div>
  );
}

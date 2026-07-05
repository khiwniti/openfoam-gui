import type { LESCoefficients, TurbulenceModel } from "@shared/types";

/**
 * V1.23 -- LES sub-grid-scale coefficient preview line. Mirrors V1.20's
 * KEpsilonCoefficientsPreview / V1.21's KOmegegaSSTCoefficientsPreview /
 * V1.22's SpalartAllmarasCoefficientsPreview styles; switches the
 * displayed coefficient + tolerance gate on the `model` prop because
 * Smagorinsky and WALE each have a single OpenFOAM-stock coefficient
 * (Cs vs Cw) with different physical ranges.
 *
 *   Smagorinsky -- Cs ~ 0.2 stock (Smagorinsky 1963 / Lilly 1967).
 *                  Amber gate at > 25% drift from stock (Cs in [0.15, 0.25]
 *                  reads stable; below 0.10 under-resolves near-wall
 *                  cascades; above 0.30 over-damps the resolved scales).
 *
 *   WALE        -- Cw ~ 0.325 stock (Nicoud + Ducros 1999). Amber gate
 *                  at > 12.3% drift from stock (Cw in [0.285, 0.365]
 *                  reads stable; the cubic structure gives WALE automatic
 *                  near-wall zero-eddy-viscosity, so tuning the
 *                  coefficient breaks the wall adaption quickly).
 *
 * Extracted to its own file so the parent PatchPanel doesn't grow by
 * another ~40 LOC of inline helper-component code -- mirroring V1.21's
 * and V1.22's module-split precedent (the per-RANS / per-LES preview
 * file pattern).
 *
 * Function-component identifiers throughout are the ASCII-only OpenFOAM
 * stock forms (`Cs` / `Cw`) so React's JSX namespace stays ASCII-clean.
 *
 * The `model` prop is typed as the full `TurbulenceModel` union (rather
 * than the narrower `'Smagorinsky' | 'WALE'`) so callers don't need an
 * `as` cast to bridge the broader domain enum down to the LES-only
 * discriminator. The form's surrounding `<details>` block gates
 * rendering on `turbulence in {Smagorinsky, WALE}`, so the WALE/Smalart
 * branches here are the production paths; the fallback neutral
 * indicator below is a defensive safety net that should never fire
 * in normal use.
 */
export function LESCoefficientsPreview({
  model,
  values,
}: {
  model: TurbulenceModel;
  values: LESCoefficients;
}) {
  // V1.23 -- Smagorinsky branch. Cs OpenFOAM stock is 0.2; gate at 25%
  //  drift symmetric around stock (so Cs in [0.15, 0.25] reads
  //  stable, outside reads amber). Inclusive `<=` to match the
  //  V1.21 final-fix convention for the closed-interval notation in
  //  the doc-block.
  if (model === "Smagorinsky") {
    const csStable = Math.abs(values.Cs - 0.2) <= 0.05;
    return (
      <p className="text-[10px] text-bg-300 leading-snug italic">
        Cs{" "}
        <span
          className={
            csStable
              ? "text-bg-100 font-mono not-italic"
              : "text-amber-400 font-mono not-italic"
          }
        >
          {values.Cs.toFixed(3)}
        </span>
        {" · "}
        <span className="text-bg-300 not-italic italic">
          ({csStable ? "stable" : "non-standard"} Smagorinsky profile)
        </span>
      </p>
    );
  }
  // V1.23 -- WALE branch. Cw OpenFOAM stock is 0.325; gate is tightened
  //  (Math 0.04 / 0.325 = 12.3% drift) calibrated to the documented
  //  Nicoud + Ducros 1999 0.30-0.35 well-tested range -- values at
  //  the edges of 0.30 / 0.35 still read STABLE; values at 0.36+ or
  //  0.285- read amber. The cubic structure relies on Cw calibration,
  //  so a looser gate (e.g. ±0.05) would mask out-of-calibration
  //  values silently. Tightening here matches the documented range
  //  vs. the loose ±0.05 which would say 0.275 is stable.
  if (model === "WALE") {
    const cwStable = Math.abs(values.Cw - 0.325) <= 0.04;
    return (
      <p className="text-[10px] text-bg-300 leading-snug italic">
        Cw{" "}
        <span
          className={
            cwStable
              ? "text-bg-100 font-mono not-italic"
              : "text-amber-400 font-mono not-italic"
          }
        >
          {values.Cw.toFixed(4)}
        </span>
        {" · "}
        <span className="text-bg-300 not-italic italic">
          ({cwStable ? "stable" : "non-standard"} WALE profile)
        </span>
      </p>
    );
  }
  // V1.23 -- Defensive fallback. The form's surrounding <details> block
  //  gates on `turbulence in {Smagorinsky, WALE}`, so this preview only
  //  renders if the user has actively picked one of the two LES models.
  //  Falling through here means a future maintainer loosened that gate;
  //  return a neutral indicator so the preview line doesn't disappear
  //  from the form.
  return (
    <p className="text-[10px] text-bg-300 leading-snug italic">
      LES coefficient preview (no active sub-grid-scale model)
    </p>
  );
}

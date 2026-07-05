import type { KEqnCoefficients } from "@shared/types";

/**
 * V1.24 -- k-equation LES sub-grid-scale coefficient preview line.
 * Mirrors V1.20's KEpsilonCoefficientsPreview / V1.21's
 * KOmegegaSSTCoefficientsPreview / V1.22's SpalartAllmarasCoefficientsPreview
 * / V1.23's LESCoefficientsPreview styles; renders the 3 OpenFOAM-stock
 * k-eqn coefficients (Ck / Ce1 / Ce2) and flags significant drift from
 * stock.
 *
 *   Ck     -- gradient-filter coefficient (Germano 1991). OpenFOAM
 *               stock 0.094. Amber gate at > ~16% drift from stock
 *               (Ck in [0.079, 0.109] reads stable). Sets how
 *               aggressively the resolved scales bleed energy into
 *               the test field. Wider 16% tolerance because kEqn's
 *               Ck is calibrated for resolved-scale energy transfer
 *               rates which are tune-sensitive to mesh Reynolds
 *               number -- the user may legitimately want ~0.07 in
 *               a low-Re LES run.
 *   Ce1    -- filtered structure-function dissipation rate 1
 *               (Germano + Lilly test-filter dynamics). OpenFOAM stock
 *               1.048. Tighter 10% drift gate (Ce1 in [0.946, 1.150]
 *               reads stable). Sets the rate of sub-grid energy
 *               dissipation in the high-pass filter.
 *   Ce2    -- filtered structure-function dissipation rate 2
 *               (companion to Ce1). OpenFOAM stock 1.048. Same 10%
 *               drift gate as Ce1. Helps stabilize the Gendolfo
 *               decomposition across finely-resolved near-wall
 *               regions.
 *
 * Extracted to its own file so the parent PatchPanel doesn't grow
 * by another ~50 LOC of inline helper-component code -- mirroring the
 * V1.21 / V1.22 / V1.23 module-split precedent.
 *
 * Function-component identifiers throughout are the ASCII-only
 * OpenFOAM stock forms (`Ck` / `Ce1` / `Ce2`) so React's JSX namespace
 * stays ASCII-clean.
 */
export function KEqnCoefficientsPreview({
  values,
}: {
  values: KEqnCoefficients;
}) {
  // V1.24 -- Ck gate: 16% drift symmetric around stock 0.094
  //  (inclusive `<=` matches V1.21 final-fix convention for
  //  closed-interval notation; Math.abs gives non-negative finite).
  const ckStable = Math.abs(values.Ck - 0.094) <= 0.015;
  // V1.24 -- Ce1 / Ce2 gates: 10% drift symmetric around stock 1.048
  //  (tighter than Ck because the dissipation-coefficient pair is
  //  a calibrated stability guarantee in OpenFOAM's kEqn.C source).
  const ce1Stable = Math.abs(values.Ce1 - 1.048) <= 0.10;
  const ce2Stable = Math.abs(values.Ce2 - 1.048) <= 0.10;
  const stable = ckStable && ce1Stable && ce2Stable;
  return (
    <p className="text-[10px] text-bg-300 leading-snug italic">
      Ck{" "}
      <span
        className={
          ckStable
            ? "text-bg-100 font-mono not-italic"
            : "text-amber-400 font-mono not-italic"
        }
      >
        {values.Ck.toFixed(4)}
      </span>
      {" · "}Ce1{" "}
      <span
        className={
          ce1Stable
            ? "text-bg-100 font-mono not-italic"
            : "text-amber-400 font-mono not-italic"
        }
      >
        {values.Ce1.toFixed(4)}
      </span>
      {" · "}Ce2{" "}
      <span
        className={
          ce2Stable
            ? "text-bg-100 font-mono not-italic"
            : "text-amber-400 font-mono not-italic"
        }
      >
        {values.Ce2.toFixed(4)}
      </span>
      {" · "}
      <span className="text-bg-300 not-italic italic">
        ({stable ? "stable" : "non-standard"} k-equation profile)
      </span>
    </p>
  );
}

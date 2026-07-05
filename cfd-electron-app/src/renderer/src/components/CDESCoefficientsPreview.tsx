import type { CDESCoefficient } from "@shared/types";

/**
 * V1.25 -- DES shielding-function coefficient preview line.
 * Mirrors V1.20's KEpsilonCoefficientsPreview / V1.21's
 * KOmegegaSSTCoefficientsPreview / V1.22's SpalartAllmarasCoefficientsPreview
 * / V1.23's LESCoefficientsPreview / V1.24's KEqnCoefficientsPreview
 * styles; renders the single OpenFOAM-stock CDES value and flags
 * drift from stock.
 *
 *   CDES  -- hybrid RANS/LES shielding-function switch coefficient
 *             (Shur + Spalart + Strelets 2008). OpenFOAM stock 0.65.
 *             Amber gate at > 25% drift from stock (CDES in
 *             [0.4875, 0.8125] reads stable). Larger CDES weakens
 *             LES resolution in separated regions; smaller CDES
 *             delays the RANS -> LES transition and under-resolves
 *             the wake. Used only by the kOmegaSSTDES variant.
 *
 * Extracted to its own file so the parent PatchPanel doesn't grow
 * by another ~40 LOC of inline helper-component code -- mirroring
 * the V1.21 / V1.22 / V1.23 / V1.24 module-split precedent.
 *
 * Function-component identifiers throughout are the ASCII-only
 * OpenFOAM stock forms (`CDES`) so React's JSX namespace stays
 * ASCII-clean.
 */
export function CDESCoefficientsPreview({
  values,
}: {
  values: CDESCoefficient;
}) {
  // V1.25 review-fix-pass -- CDES gate widened from 10% to 25%
  //  drift symmetric around stock 0.65 (was 0.065, now 0.1625,
  //  stable range [0.4875, 0.8125]). The 10% drift gate produced
  //  false amber markers for legitimate values in the documented
  //  well-tested range (e.g. 0.55 was marked non-standard despite
  //  the form's own details block documenting [0.50, 0.85] as the
  //  canonical window). Inclusive `<=` matches V1.21 final-fix
  //  convention for closed-interval notation; Math.abs gives
  //  non-negative finite.
  const cdesStable = Math.abs(values.CDES - 0.65) <= 0.1625;
  return (
    <p className="text-[10px] text-bg-300 leading-snug italic">
      C_DES{" "}
      <span
        className={
          cdesStable
            ? "text-bg-100 font-mono not-italic"
            : "text-amber-400 font-mono not-italic"
        }
      >
        {values.CDES.toFixed(4)}
      </span>
      {" · "}
      <span className="text-bg-300 not-italic italic">
        ({cdesStable ? "stable" : "non-standard"} DES shield)
      </span>
    </p>
  );
}

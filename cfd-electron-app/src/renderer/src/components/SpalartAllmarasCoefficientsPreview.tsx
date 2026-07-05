import type { SpalartAllmarasCoefficients } from "@shared/types";

/**
 * V1.22 -- Spalart-Allmaras coefficient preview line. Mirrors V1.20's
 * KEpsilonCoefficientsPreview / V1.21's KOmegegaSSTCoefficientsPreview
 * styles; renders the 9 Spalart-Allmaras (1994 + Pirzadeh 1999 cubic-ramp)
 * coefficients and flags significant Cb1 / Cb2 / Cw3 / Cw1 departures from
 * their stock values.
 *
 * The active model dynamics live in three coefficients:
 *   Cb1 -- production coefficient (most influential; sensitivity roughly
 *          20% deviation breaks SA's production-vs-destruction balance).
 *   Cb2 -- destruction coefficient (symmetric 20% break).
 *   Cw3 -- Pirzadeh's cubic-ramp near-wall limiter (20% deviation breaks
 *          the near-wall ramp).
 *
 * Cw1 is a USER INPUT in OpenFOAM's SpalartAllmaras.C source (canonical
 * 0.3; some literature cites a "derived" form Cb1/kappa^2 + (1+Cb2)/sigmaNut
 * ~ 0.281 but OpenFOAM reads from modelCoeffs.Cw1 verbatim). OpenFOAM is
 * more forgiving of large Cw1 swings than large Cb1/Cb2/Cw3 swings, so the
 * gate threshold is intentionally LOOSER (50% drift threshold) — but we
 * still flag so users don't accidentally type 1.5 and crash the cubic ramp.
 *
 * sigmaNut / kappa / Cv1 / Cv2 are NOT flagged -- sigmaNut and kappa are
 * near-universal constants (2/3 and 0.41 respectively) with established
 * physical meaning; Cv1 / Cv2 are production limiters OpenFOAM rarely
 * flags in error (the active dynamics live in Cb1/Cb2/Cw1/Cw3).
 *
 * Stable profile = Cb1 within 20% of 0.1355 AND Cb2 within 20% of 0.622
 *   AND Cw3 within 20% of 2.0 AND Cw1 within 50% of 0.3.
 *
 * Extracted to its own file so the parent PatchPanel doesn't grow by
 * another ~80 LOC of inline helper-component code -- mirroring V1.21's
 * extraction precedent (which avoided anchor-editor flakiness on
 * inline close-out text containing Greek-letter arg lists).
 *
 * Function-component identifiers are the ASCII-only OpenFOAM stock
 * forms (`Cb1` / `sigmaNut` / etc.) so React's JSX namespace stays
 * ASCII-clean. The user-facing labels on the `<details>` block in
 * PatchPanel use the mixed-case short forms (`C_b1` / `sigma_nut`)
 * to mirror OpenFOAM's stock identifier convention in the UI.
 */
export function SpalartAllmarasCoefficientsPreview({
  values,
}: {
  values: SpalartAllmarasCoefficients;
}) {
  // V1.22 -- Cb1 is the production coefficient in the SA closure and is
  //  the most influential knob on adverse-pressure-gradient cases.
  //  Tightening by more than 20% (~0.108) drops production into the
  //  "low-turbulence-attachment" regime, raising by more than 20%
  //  (~0.163) over-predicts separation. Amber gate symmetric around
  //  stock.
  const cb1Stable = Math.abs(values.Cb1 - 0.1355) <= 0.0271;
  // V1.22 -- Cb2 is the destruction coefficient. Symmetric gate to Cb1
  //  for the same stability rationale: 20% drift either side of 0.622
  //  destabilizes SA production/destruction balance.
  const cb2Stable = Math.abs(values.Cb2 - 0.622) <= 0.1244;
  // V1.22 -- Cw3 is the cubic-ramp wall-damping coefficient added in
  //  Pirzadeh 1999 (OpenFOAM stock 2.0). 20% drift either side of 2.0
  //  (i.e. < 1.6 or > 2.4) destabilizes near-wall ramp behavior.
  const cw3Stable = Math.abs(values.Cw3 - 2.0) <= 0.4;
  // V1.22 -- Cw1 gate is intentionally LOOSER than Cb1/Cb2/Cw3
  //  (50% drift threshold instead of 20%) because Cw1 is explicitly
  //  user-tunable in OpenFOAM. 50% of 0.3 is 0.15 -- still a wide
  //  CB around the canonical user-input value.
  const cw1Stable = Math.abs(values.Cw1 - 0.3) <= 0.15;
  const stable = cb1Stable && cb2Stable && cw3Stable && cw1Stable;
  return (
    <p className="text-[10px] text-bg-300 leading-snug italic">
      sigmaNut{" "}
      <span className="text-bg-100 font-mono not-italic">
        {values.sigmaNut.toFixed(3)}
      </span>
      {" · "}kappa{" "}
      <span className="text-bg-100 font-mono not-italic">
        {values.kappa.toFixed(2)}
      </span>
      {" · "}Cb1{" "}
      <span
        className={
          cb1Stable
            ? "text-bg-100 font-mono not-italic"
            : "text-amber-400 font-mono not-italic"
        }
      >
        {values.Cb1.toFixed(4)}
      </span>
      {" · "}Cb2{" "}
      <span
        className={
          cb2Stable
            ? "text-bg-100 font-mono not-italic"
            : "text-amber-400 font-mono not-italic"
        }
      >
        {values.Cb2.toFixed(3)}
      </span>
      {" · "}Cw1{" "}
      <span
        className={
          cw1Stable
            ? "text-bg-100 font-mono not-italic"
            : "text-amber-400 font-mono not-italic"
        }
      >
        {values.Cw1.toFixed(3)}
      </span>
      {" · "}Cw2{" "}
      <span className="text-bg-100 font-mono not-italic">
        {values.Cw2.toFixed(3)}
      </span>
      {" · "}Cw3{" "}
      <span
        className={
          cw3Stable
            ? "text-bg-100 font-mono not-italic"
            : "text-amber-400 font-mono not-italic"
        }
      >
        {values.Cw3.toFixed(3)}
      </span>
      {" · "}Cv1{" "}
      <span className="text-bg-100 font-mono not-italic">
        {values.Cv1.toFixed(2)}
      </span>
      {" · "}Cv2{" "}
      <span className="text-bg-100 font-mono not-italic">
        {values.Cv2.toFixed(2)}
      </span>
      {" · "}
      <span className="text-bg-300 not-italic italic">
        ({stable ? "stable" : "non-standard"} Spalart-Allmaras profile)
      </span>
    </p>
  );
}

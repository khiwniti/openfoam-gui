import type { KOmegegaSSTCoefficients } from "@shared/types";

/**
 * V1.21 -- k-omega-SST coefficient preview line. Mirrors V1.20's
 * KEpsilonCoefficientsPreview style but for the Menter 2009 SST closure.
 * Renders the 12 coefficients and flags significant betaStar departures
 * from its 0.09 stock value (the most-sensitive k-omega-SST coefficient
 * for adverse pressure gradients). gamma2 is OpenFOAM-encoded as
 * 7/8 and is part of SST's stability guarantee, so we surface gamma2
 * in amber if the user changes it. Stable profile = betaStar within
 * 0.02 of 0.09 (Menter's well-tested interval [0.07, 0.11]) AND gamma2
 * within 0.02 of 0.875 (enforces the OpenFOAM-stock 7/8 fraction
 * tightly).
 *
 * Extracted to its own file so the parent PatchPanel doesn't grow by
 * another ~80 LOC of inline helper-component code (V1.20's
 * KEpsilonCoefficientsPreview still lives inline next to the closure
 * block because it predates the V1.x module-splitting idioms and any
 * retroactive move would cost more LOC churn than it saves).
 *
 * Function-component identifiers throughout are the ASCII-only OpenFOAM
 * stock forms (`alphaK1` / `alphaK2` / etc.) so React's JSX namespace
 * stays ASCII-clean. The user-facing labels on the `<details>` block in
 * PatchPanel use the Greek-short forms (`alpha_k1` / `alpha_omega2` /
 * etc.) to mirror OpenFOAM's stock identifier convention in the UI.
 */
export function KOmegegaSSTCoefficientsPreview({
  values,
}: {
  values: KOmegegaSSTCoefficients;
}) {
  // V1.21 fix-pass — tightened from 0.20 to 0.02 (inclusive). Menter's
  //  2009 paper warns that betaStar departures from 0.09 by more than
  //  ~0.02 already destabilize k-omega SST convergence — the
  //  production-vs-destruction balance shifts non-trivially. The
  //  pre-fix 0.20 tolerance was so loose that betaStar=0.25 would
  //  still read as "stable" while the user is well into the
  //  crash territory for adverse-pressure-gradient cases.
  //  The `<= 0.02` (inclusive) operator matches the doc-block
  //  header's mathematical bracket notation `[0.07, 0.11]`.
  //  Inconsistent operator semantics with V1.20's KEpsilonCoefficientsPreview
  //  was the bug this fix-pass addresses.
  const betaStarStable = Math.abs(values.betaStar - 0.09) <= 0.02;
  // V1.21 final-fix: tightened to <= 0.02 inclusive (symmetric with
  //  betaStar; same Menter well-tested interval). V1.22 cleanup
  //  removed a duplicate `< 0.05` declaration that snuck in.
  const gamma2Stable = Math.abs(values.gamma2 - 0.875) <= 0.02;
  const stable = betaStarStable && gamma2Stable;
  return (
    <p className="text-[10px] text-bg-300 leading-snug italic">
      alphaK1 <span className="text-bg-100 font-mono not-italic">{values.alphaK1.toFixed(3)}</span>
      {" · "}alphaK2 <span className="text-bg-100 font-mono not-italic">{values.alphaK2.toFixed(3)}</span>
      {" · "}alphaOmega1 <span className="text-bg-100 font-mono not-italic">{values.alphaOmega1.toFixed(3)}</span>
      {" · "}alphaOmega2 <span className="text-bg-100 font-mono not-italic">{values.alphaOmega2.toFixed(3)}</span>
      {" · "}beta1 <span className="text-bg-100 font-mono not-italic">{values.beta1.toFixed(4)}</span>
      {" · "}beta2 <span className="text-bg-100 font-mono not-italic">{values.beta2.toFixed(4)}</span>
      {" · "}betaStar{" "}
      <span
        className={
          betaStarStable
            ? "text-bg-100 font-mono not-italic"
            : "text-amber-400 font-mono not-italic"
        }
      >
        {values.betaStar.toFixed(3)}
      </span>
      {" · "}C1 <span className="text-bg-100 font-mono not-italic">{values.C1.toFixed(3)}</span>
      {" · "}gamma1 <span className="text-bg-100 font-mono not-italic">{values.gamma1.toFixed(4)}</span>
      {" · "}gamma2{" "}
      <span
        className={
          gamma2Stable
            ? "text-bg-100 font-mono not-italic"
            : "text-amber-400 font-mono not-italic"
        }
      >
        {values.gamma2.toFixed(4)}
      </span>
      {" · "}sigmaK <span className="text-bg-100 font-mono not-italic">{values.sigmaK.toFixed(3)}</span>
      {" · "}sigmaOmega <span className="text-bg-100 font-mono not-italic">{values.sigmaOmega.toFixed(3)}</span>
      {" · "}
      <span className="text-bg-300 not-italic italic">
        ({stable ? "stable" : "non-standard"} k-omega SST profile)
      </span>
    </p>
  );
}

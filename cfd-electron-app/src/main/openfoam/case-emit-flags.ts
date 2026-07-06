/**
 * V1.41 — per-template emit booleans extracted from
 *  src/main/openfoam/case-helpers.ts (V1.38b lift).
 *
 * The case-helpers.ts module grew to ~330 LOC with 9 exports
 *  spanning 3 distinct concerns: Handlebars-context string
 *  formatters (case-formatters.ts), per-template emit
 *  booleans (this file), and the full Handlebars context
 *  object construction + templates directory resolver
 *  (case-context.ts). V1.41 splits the module into 3 focused
 *  files organized by concern so each module has a single
 *  testable surface. case-helpers.ts becomes a thin
 *  re-export barrel for backward compat with the V1.35a +
 *  V1.38 + V1.38b public API.
 *
 * This file owns the 2 per-template emit booleans that gate
 *  the relaxationFactors + adjustTimeStep blocks in the
 *  fvSolution + controlDict templates. Every helper is a
 *  pure `Domain → boolean` transformation: no I/O, no
 *  process spawning, no electron.
 */
import type { Domain } from '@shared/types';

/**
 * V1.18b — precomputed `emitRelaxationFactors` boolean for
 *  fvSolution. SIMPLE-family solvers (simpleFoam,
 *  buoyantSimpleFoam, potentialFoam) emit the block
 *  unconditionally per V1.11 review-fix; pimpleFoam emits only
 *  when `relaxationFactors.enabled === true` (off by default for
 *  PIMPLE per the V1.18b designer recommendation). Lifted from
 *  the inline `emitRelaxationFactors:` key in `renderCase`'s
 *  Handlebars context object construction.
 *
 *  The boolean is computed at render time (not stored on the
 *  Domain) because it's a *derivation* from the solver + the
 *  per-solver relaxationFactors toggle — keeping it as a
 *  function lets the fvSolution.hbs template gate the block on
 *  the latest configuration without round-tripping through
 *  `.cfd-app-state.json` parse.
 */
export function shouldEmitRelaxationFactors(domain: Domain): boolean {
  return (
    domain.solver === 'simpleFoam' ||
    domain.solver === 'buoyantSimpleFoam' ||
    domain.solver === 'potentialFoam' ||
    (domain.solver === 'pimpleFoam' && domain.relaxationFactors.enabled)
  );
}

/**
 * V1.19 — precomputed boolean used by controlDict.hbs to gate
 *  the `adjustTimeStep yes;` block. SIMPLE-family solvers
 *  (simpleFoam, buoyantSimpleFoam, potentialFoam) ignore the
 *  field entirely in OpenFOAM, so we hard-route them to `no`
 *  regardless of the form's displayed toggle (the values
 *  still roundtrip through .cfd-app-state.json for renderer
 *  state consistency, but the emitted controlDict is always
 *  OpenFOAM stock). pimpleFoam + icoFoam honor the toggle
 *  directly: emitting `yes; maxCo X;` when enabled, `no;`
 *  otherwise. Lifted from the inline `emitAdaptiveTimeStep:`
 *  key in `renderCase`'s Handlebars context object
 *  construction.
 */
export function shouldEmitAdaptiveTimeStep(domain: Domain): boolean {
  return (
    (domain.solver === 'pimpleFoam' || domain.solver === 'icoFoam') &&
    domain.adaptiveTimeStep.enabled
  );
}

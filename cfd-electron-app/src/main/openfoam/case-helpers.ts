/**
 * V1.41 — re-export barrel for the 3 case.ts pure-fn modules
 *  split out of the original V1.38 / V1.38b case-helpers.ts.
 *
 * The case-helpers.ts module grew to ~330 LOC with 9 exports
 *  spanning 3 distinct concerns:
 *    * Handlebars-context string formatters →
 *      @main/openfoam/case-formatters
 *    * per-template emit booleans →
 *      @main/openfoam/case-emit-flags
 *    * Handlebars context object construction + templates
 *      directory resolver → @main/openfoam/case-context
 *
 * V1.41 splits the module into 3 focused files organized by
 *  concern so each module has a single testable surface, then
 *  keeps this barrel around for backward compat. Any caller
 *  that did `import { formatResolution } from './case-helpers'`
 *  (or `... from '@main/openfoam/case-helpers'` from the
 *  preload) keeps working — the named export resolves through
 *  the re-export chain below.
 *
 * case.ts itself imports from the 3 focused modules directly
 *  (skipping the barrel round-trip), so this file is a pure
 *  re-export surface — the V1.35a + V1.38 + V1.38b contract
 *  is preserved without duplicating the implementation.
 */
export {
  formatBcBlock,
  formatLocationInMesh,
  formatRefinementBlock,
  formatResolution,
  formatSmootherLine,
} from './case-formatters';
export {
  shouldEmitAdaptiveTimeStep,
  shouldEmitRelaxationFactors,
} from './case-emit-flags';
export {
  buildRenderContext,
  resolveTemplatesRoot,
  type TemplatesRootEnv,
} from './case-context';

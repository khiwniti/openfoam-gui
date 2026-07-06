/**
 * V1.38 — pure string formatters extracted from
 *  src/main/openfoam/case.ts.
 *
 * Mirrors the V1.37* runner.ts lift pattern: the case.ts barrel
 * co-locates the Handlebars `registerHelper` callbacks (which carry
 * non-trivial string-construction logic + defensive type checks
 * for the unknown-typed Handlebars context values) with the case
 * rendering pipeline. The three helpers — smootherLine, bcFor, and
 * refBlock — have a pure string-construction core that can be
 * exercised directly by vitest once lifted from the Handlebars
 * wrapper.
 *
 * IPC contract: every helper here is a pure `unknown → string`
 * transformation. They tolerate missing / wrong-typed input paths
 * the same way the inline Handlebars callbacks did (returning a
 * safe default rather than throwing), so a renderer that ships a
 * partial `.cfd-app-state.json` still produces a valid OpenFOAM
 * case. The Handlebars wrappers in case.ts become thin
 * type-coercion + SafeString-wrap shells that delegate to these
 * pure cores.
 *
 * Diff-safe: the lifted functions preserve the inline behavior
 * byte-for-byte (same switch statement, same defensive checks,
 * same SafeString-style output). The Handlebars wrappers preserve
 * the public `registerHelper` surface (handlebars templates
 * `{{smootherLine solver}}`, `{{bcFor bcMap patchName}}`,
 * `{{refBlock refMap patchName}}` resolve identically).
 */
import type { BcField, PatchRefinements } from '@shared/types';

/**
 * V1.18d — matrix solver → smoother/preconditioner line. OpenFOAM
 *  expects different keywords depending on the solver family:
 *  smoother-line used for GAMG + smoothSolver (GaussSeidel /
 *  symGaussSeidel); preconditioner-line used for PCG, PBiCG,
 *  PBiCGStab (DIC / DILU). The helper returns the full line
 *  including the leading whitespace so the template stays
 *  read-clean.
 *
 *  Lifted from the `smootherLine` Handlebars helper in
 *  src/main/openfoam/case.ts. The Handlebars wrapper coerces the
 *  `unknown` context value to `string` (defaulting to `''`) and
 *  wraps the result in `Handlebars.SafeString`; this pure core
 *  accepts a `string` directly. Unknown / unrecognized solver
 *  values fall through to the GAMG / GaussSeidel default — the
 *  OpenFOAM stock p-block smoother that has the widest
 *  applicability across SIMPLE / PISO / PIMPLE.
 */
export function formatSmootherLine(solver: string): string {
  switch (solver) {
    case 'GAMG':
      return 'smoother        GaussSeidel;';
    case 'smoothSolver':
      return 'smoother        symGaussSeidel;';
    case 'PCG':
      return 'preconditioner  DIC;';
    case 'PBiCG':
      return 'preconditioner  DILU;';
    case 'PBiCGStab':
      return 'preconditioner  DILU;';
    default:
      return 'smoother        GaussSeidel;';
  }
}

/**
 * V1.2 — render a per-patch BcField as OpenFOAM boundary-condition
 *  syntax. Used by snappy_U.hbs and snappy_p.hbs to emit
 *
 *      type <kind>;
 *      value uniform <...>;   (only for fixedValue)
 *
 *  inside each patch's { … } block. Falls back to zeroGradient
 *  if the BC object is missing — keeps the templates safe even
 *  when the renderer ships a partial bc table (e.g. a legacy
 *  .cfd-app-state.json).
 *
 *  Lifted from the `bcFor` Handlebars helper in
 *  src/main/openfoam/case.ts. The Handlebars wrapper preserves
 *  the `unknown, unknown` context-value signature (Handlebars
 *  context values are statically typed as `unknown`); this pure
 *  core accepts the same `unknown, unknown` shape. The defensive
 *  type checks (typeof === 'object' for bcMap, typeof ===
 *  'string' for patchName) are preserved verbatim.
 *
 *  Output formats:
 *    * non-fixedValue BC:     `type <kind>;`
 *    * fixedValue scalar:     `type fixedValue;\n        value uniform <N>;`
 *    * fixedValue 3-vector:   `type fixedValue;\n        value uniform (x y z);`
 *    * fixedValue invalid:    `type fixedValue;\n        value uniform (0 0 0);` (fallback)
 */
export function formatBcBlock(bcMap: unknown, patchName: unknown): string {
  const safe: BcField = { type: 'zeroGradient' };
  if (bcMap && typeof bcMap === 'object' && typeof patchName === 'string') {
    const bc = (bcMap as Record<string, BcField | undefined>)[patchName];
    if (bc && typeof bc === 'object' && typeof bc.type === 'string') safe.type = bc.type;
    if (bc && bc.value !== undefined) safe.value = bc.value;
  }
  if (safe.type !== 'fixedValue') {
    return `type ${safe.type};`;
  }
  const v = safe.value;
  if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return `type fixedValue;\n        value uniform (${v[0]} ${v[1]} ${v[2]});`;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return `type fixedValue;\n        value uniform ${v};`;
  }
  return `type fixedValue;\n        value uniform (0 0 0);`;
}

/**
 * V1.4 — render a per-patch snappy refinement level line. Emits a
 *  single `level (min max);` line that goes inside a
 *  refinementSurfaces entry. Falls back to (0 0) if the
 *  refinements map is missing or the patch has no entry (legacy
 *  .cfd-app-state.json safety).
 *
 *  Lifted from the `refBlock` Handlebars helper in
 *  src/main/openfoam/case.ts. Defensive checks preserved verbatim:
 *  `Number.isFinite` for the value, `Math.max(0, Math.min(7, …))`
 *  clamp to OpenFOAM's documented 0..7 range, `Math.round` for
 *  fractional inputs, and the `max < min` invariant that snaps
 *  `max` up to `min` to prevent the template from emitting
 *  `level (5 3);` (which OpenFOAM rejects).
 *
 *  SafeString-wrapped in the Handlebars wrapper so Handlebars
 *  doesn't HTML-escape the parens.
 */
export function formatRefinementBlock(refMap: unknown, patchName: unknown): string {
  let min = 0;
  let max = 0;
  if (refMap && typeof refMap === 'object' && typeof patchName === 'string') {
    const r = (refMap as PatchRefinements)[patchName];
    if (r && typeof r === 'object') {
      if (Number.isFinite(r.min)) min = Math.max(0, Math.min(7, Math.round(r.min)));
      if (Number.isFinite(r.max)) max = Math.max(0, Math.min(7, Math.round(r.max)));
      if (max < min) max = min;
    }
  }
  return `level (${min} ${max});`;
}

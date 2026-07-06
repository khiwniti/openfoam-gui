/**
 * V1.41 — pure string formatters extracted from
 *  src/main/openfoam/case-helpers.ts (V1.38 / V1.38b lift).
 *
 * The case-helpers.ts module grew to ~330 LOC with 9 exports
 *  spanning 3 distinct concerns: Handlebars-context string
 *  formatters (this file), per-template emit booleans
 *  (case-emit-flags.ts), and the full Handlebars context
 *  object construction + templates directory resolver
 *  (case-context.ts). V1.41 splits the module into 3 focused
 *  files organized by concern so each module has a single
 *  testable surface. case-helpers.ts becomes a thin
 *  re-export barrel for backward compat with the V1.35a +
 *  V1.38 + V1.38b public API.
 *
 * This file owns the 5 string-in/string-out formatters that
 *  the case.ts Handlebars callbacks + the fvSolution /
 *  controlDict / blockMeshDict / snappyHexMeshDict templates
 *  consume. Every helper is a pure transformation: no I/O,
 *  no process spawning, no electron.
 */
import type { BcField, Domain, PatchRefinements } from '@shared/types';

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

/**
 * V1.35a — background-domain resolution string for
 *  snappyHexMeshDict (e.g. `30 20 20`). Originally lifted
 *  from the inline `formatResolution` function in
 *  src/main/openfoam/case.ts via V1.35a's
 *  `export function formatResolution(domain: Domain): string`
 *  visibility flag (the function body was unchanged). V1.38b
 *  re-homed the implementation into @main/openfoam/case-helpers
 *  so `buildRenderContext` (which lives in the same module) can
 *  call it directly without a circular case.ts ↔
 *  case-helpers.ts import. case.ts keeps a re-export of the
 *  function for backward compat with the public API.
 */
export function formatResolution(domain: Domain): string {
  return `${domain.nx} ${domain.ny} ${domain.nz}`;
}

/**
 * V1.35a — a point guaranteed to live inside the background
 *  blockMesh, used by snappy as the seed point for casting the
 *  surface. Falls back to the parametric domain center if the
 *  imported bbox is missing. Originally lifted from the
 *  inline `formatLocationInMesh` function in
 *  src/main/openfoam/case.ts via V1.35a's `export function`
 *  visibility flag. V1.38b re-homed the implementation into
 *  @main/openfoam/case-helpers for the same circular-import
 *  reason as `formatResolution` above. case.ts keeps a
 *  re-export of the function for backward compat with the
 *  public API.
 */
export function formatLocationInMesh(domain: Domain): string {
  const fmtNum = (n: number) => {
    if (!Number.isFinite(n)) return '0';
    // Keep it short — snappy will accept decimals, this is just a seed.
    return Number.parseFloat(n.toFixed(6)).toString();
  };
  if (domain.bbox) {
    // Slightly offset from the bbox corner toward the centroid — guaranteed to be inside
    // a background mesh whose Lx/Ly/Lz were sized to fully contain it.
    return `${fmtNum((domain.bbox.min.x + domain.bbox.max.x) / 2)} ${fmtNum((domain.bbox.min.y + domain.bbox.max.y) / 2)} ${fmtNum((domain.bbox.min.z + domain.bbox.max.z) / 2)}`;
  }
  return `${fmtNum(domain.Lx / 2)} ${fmtNum(domain.Ly / 2)} ${fmtNum(domain.Lz / 2)}`;
}

/**
 * V1.38 / V1.38b — pure formatters extracted from
 *  src/main/openfoam/case.ts.
 *
 * Mirrors the V1.37* runner.ts lift pattern: the case.ts barrel
 * co-locates the Handlebars `registerHelper` callbacks + the
 * precomputed Handlebars context object + the templates
 * directory resolver with the case rendering pipeline. The pure
 * cores that don't need fs / Handlebars / process spawning can
 * be exercised directly by vitest once lifted out of the barrel.
 *
 * V1.38 lifted the 3 Handlebars helper cores
 *  (smootherLine / bcFor / refBlock). V1.38b added 6 more
 *  exports: 2 precomputed emit booleans for the fvSolution +
 *  controlDict templates (shouldEmitRelaxationFactors /
 *  shouldEmitAdaptiveTimeStep), a parameterized templates
 *  directory resolver (resolveTemplatesRoot), the full
 *  Handlebars context object construction (buildRenderContext),
 *  and the re-homed V1.35a formatResolution +
 *  formatLocationInMesh (moved from case.ts so buildRenderContext
 *  can call them locally without a circular import).
 *
 * IPC contract: every helper here is a pure transformation
 *  (no I/O, no process spawning, no electron). Some tolerate
 *  missing / wrong-typed input paths the way the inline
 *  Handlebars callbacks did (returning a safe default rather
 *  than throwing) so a renderer that ships a partial
 *  .cfd-app-state.json still produces a valid OpenFOAM case.
 *  The Handlebars wrappers in case.ts become thin
 *  type-coercion + SafeString-wrap shells that delegate to the
 *  formatSmootherLine / formatBcBlock / formatRefinementBlock
 *  cores; the other 6 exports are consumed directly by
 *  renderCase (and re-exported from case.ts for backward
 *  compat with the V1.35a public API).
 *
 * Diff-safe: the lifted functions preserve the inline behavior
 * byte-for-byte. The Handlebars wrappers preserve the public
 * `registerHelper` surface — handlebars templates
 * `{{smootherLine solver}}`, `{{bcFor bcMap patchName}}`,
 * `{{refBlock refMap patchName}}` resolve identically.
 */
import path from 'node:path';
import type {
  BcField,
  BoundaryConditions,
  Domain,
  PatchRefinements,
} from '@shared/types';

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
 *  re-homes the implementation into @main/openfoam/case-helpers
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
 *  visibility flag. V1.38b re-homes the implementation into
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

/**
 * V1.18a — resolve the templates directory. In dev
 *  (electron-vite), resources live at
 *  /<project>/resources. In production, they're bundled
 *  under process.resourcesPath/templates.
 *
 *  Lifted from the inline `resolveTemplatesRoot` function in
 *  src/main/openfoam/case.ts. The `env` parameter is exposed
 *  for testability — production callers omit it and let the
 *  default `process.env` / `process.cwd()` /
 *  `process.resourcesPath` fallthroughs win. Tests pass an
 *  explicit `env` so the assertion is deterministic across
 *  local + CI runs (where `process.cwd()` and
 *  `process.resourcesPath` resolve to different paths).
 *
 *  The default-fallthrough parameter pattern mirrors V1.37a's
 *  `defaultRunRoot(home?)` — same shape, same
 *  "production-callers-omit / tests-pass-explicit" contract.
 */
export interface TemplatesRootEnv {
  nodeEnv: string | undefined;
  cwd: string;
  resourcesPath: string | undefined;
}

export function resolveTemplatesRoot(env?: TemplatesRootEnv): string {
  const e: TemplatesRootEnv = env ?? {
    nodeEnv: process.env.NODE_ENV,
    cwd: process.cwd(),
    resourcesPath: process.resourcesPath,
  };
  if (e.nodeEnv === 'development') {
    return path.join(e.cwd, 'resources', 'templates');
  }
  return path.join(e.resourcesPath || e.cwd, 'templates');
}

/**
 * V1.38b — build the Handlebars context object that
 *  `renderCase` passes to every `.hbs` template's
 *  `Handlebars.compile(...)(context)` invocation. The
 *  construction is a pure `({ domain, bc, refinements,
 *  caseLabel }) → Record<string, unknown>` transformation: the
 *  domain is spread (so every `{{Lx}}`, `{{nu}}`, `{{solver}}`,
 *  etc. resolves directly), `bc` + `patchRefinements` are
 *  surfaced as separate top-level keys, the per-template
 *  `resolution` + `locationInMesh` strings are precomputed,
 *  the 6 origin-coordinate strings are derived from
 *  `domain.origin ?? (0,0,0)`, and the 2 per-template emit
 *  booleans (`emitRelaxationFactors`, `emitAdaptiveTimeStep`)
 *  delegate to the lifted `shouldEmitRelaxationFactors` +
 *  `shouldEmitAdaptiveTimeStep` helpers.
 *
 *  Lifting the whole object construction lets vitest verify
 *  the context shape for a given `(domain, bc, refinements,
 *  caseLabel)` tuple — a future refactor that accidentally
 *  drops a key (e.g., a careless `...domain,` removal that
 *  lost `patches`) would break the test rather than
 *  silently producing a template that hits `{{Lx}}` with
 *  `undefined`.
 */
export function buildRenderContext(args: {
  domain: Domain;
  bc: BoundaryConditions;
  refinements: PatchRefinements;
  caseLabel: string;
}): Record<string, unknown> {
  const { domain, bc, refinements, caseLabel } = args;
  return {
    ...domain,
    bc,
    // V1.4 — per-patch snappy refinement levels, consumed by the
    //  refinementSurfaces block in snappyHexMeshDict.hbs. Kept as a separate
    //  top-level key (instead of being merged into domain.patches) so the
    //  Domain schema stays unchanged.
    patchRefinements: refinements,
    caseLabel,
    openfoamVersion: '(detected at run)',
    resolution: formatResolution(domain),
    locationInMesh: formatLocationInMesh(domain),
    // Origin strings so blockMeshDict.hbs can place vertices at (origin.x, origin.y, origin.z)
    // instead of hard-coded (0,0,0). Keeps parametric cavity flows unchanged (origin === 0).
    origin: domain.origin,
    ox: String(domain.origin?.x ?? 0),
    oy: String(domain.origin?.y ?? 0),
    oz: String(domain.origin?.z ?? 0),
    oxPLx: String((domain.origin?.x ?? 0) + domain.Lx),
    oyPLy: String((domain.origin?.y ?? 0) + domain.Ly),
    ozPLz: String((domain.origin?.z ?? 0) + domain.Lz),
    // V1.18b + V1.19 — precomputed booleans used by the fvSolution +
    //  controlDict templates to gate the relaxationFactors +
    //  adjustTimeStep blocks. See the JSDoc on
    //  shouldEmitRelaxationFactors / shouldEmitAdaptiveTimeStep
    //  for the per-solver routing rationale.
    emitRelaxationFactors: shouldEmitRelaxationFactors(domain),
    emitAdaptiveTimeStep: shouldEmitAdaptiveTimeStep(domain),
  };
}

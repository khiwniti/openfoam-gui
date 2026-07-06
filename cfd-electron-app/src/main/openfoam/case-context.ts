/**
 * V1.41 — Handlebars context object construction + templates
 *  directory resolver extracted from
 *  src/main/openfoam/case-helpers.ts (V1.38b lift).
 *
 * The case-helpers.ts module grew to ~330 LOC with 9 exports
 *  spanning 3 distinct concerns: Handlebars-context string
 *  formatters (case-formatters.ts), per-template emit
 *  booleans (case-emit-flags.ts), and the full Handlebars
 *  context object construction + templates directory resolver
 *  (this file). V1.41 splits the module into 3 focused files
 *  organized by concern so each module has a single testable
 *  surface. case-helpers.ts becomes a thin re-export barrel
 *  for backward compat with the V1.35a + V1.38 + V1.38b public
 *  API.
 *
 * This file owns the 2 functions that bridge the case.ts
 *  barrel to the Handlebars template rendering pipeline:
 *  resolveTemplatesRoot (the templates directory resolver,
 *  parameterized on env for testability) and buildRenderContext
 *  (the full Handlebars context object construction that
 *  renderCase passes to every `.hbs` template's
 *  `Handlebars.compile(...)(context)` invocation).
 *
 *  The pure cores delegate to case-formatters.ts (for
 *  formatResolution + formatLocationInMesh) and
 *  case-emit-flags.ts (for the 2 emit booleans) so the
 *  context-construction logic has a single import surface
 *  and no circular dependency.
 */
import path from 'node:path';
import type { BoundaryConditions, Domain, PatchRefinements } from '@shared/types';
import { formatLocationInMesh, formatResolution } from './case-formatters';
import { shouldEmitAdaptiveTimeStep, shouldEmitRelaxationFactors } from './case-emit-flags';

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
 *  `resolution` + `locationInMesh` strings are precomputed
 *  (via case-formatters), the 6 origin-coordinate strings are
 *  derived from `domain.origin ?? (0,0,0)`, and the 2
 *  per-template emit booleans (`emitRelaxationFactors`,
 *  `emitAdaptiveTimeStep`) delegate to the lifted
 *  shouldEmitRelaxationFactors + shouldEmitAdaptiveTimeStep
 *  helpers in case-emit-flags.
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

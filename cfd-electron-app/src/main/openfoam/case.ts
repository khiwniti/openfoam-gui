/**
 * OpenFOAM case file generator — renders Handlebars templates into a directory structure.
 * Templates live in resources/templates/<caseKind>/*.hbs and reference the variables in Domain.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import Handlebars from 'handlebars';
import { z } from 'zod';
import {
  BoundaryConditionsSchema,
  DomainSchema,
  LES_TURBULENCE_TYPES,
  PatchRefinementSchema,
  type Domain,
  type BoundaryConditions,
  type CaseKind,
  type PatchRefinements,
} from '@shared/types';
// V1.38 — pure string formatters extracted from the inline
//  Handlebars.registerHelper callbacks below into
//  @main/openfoam/case-helpers. The wrappers preserved here are
//  thin type-coercion + SafeString-wrap shells that delegate to
//  the pure cores; vitest exercises the cores directly. The
//  lift preserves the public Handlebars surface
//  ({{smootherLine solver}}, {{bcFor bcMap patchName}},
//  {{refBlock refMap patchName}}) byte-for-byte.
import {
  formatBcBlock,
  formatRefinementBlock,
  formatSmootherLine,
} from './case-helpers';

Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
Handlebars.registerHelper('or', (a: unknown, b: unknown) => a || b);

/**
 * V1.24 -- LES-roster predicate. Returns true when the active
 *  turbulence model is any LES variant. Reads through the
 *  `LES_TURBULENCE_TYPES as const` lift from `@shared/types`
 *  (V1.26) -- the case.ts body is now a one-line source-of-truth
 *  consumer; adding a new LES variant updates `TurbulenceModelSchema`
 *  + `LES_TURBULENCE_TYPES` in lockstep (the latter has a
 *  `satisfies readonly TurbulenceModel[]` clause that TS-checks both
 *  flags stay in sync at compile time). Pre-V1.26 the helper held a
 *  hand-maintained 7-string array that drifted in lockstep with the
 *  enum on every V1.23 / V1.24 / V1.25 / V1.x LES-add round; V1.26
 *  closes that drift.
 */
// V1.26 -- isLES helper routes through LES_TURBULENCE_TYPES as
//  const. The runtime cost is identical (constant-folded .includes),
//  while the source-of-truth contract is enforced at compile time.
Handlebars.registerHelper('isLES', (t: unknown) => {
  if (typeof t !== 'string') return false;
  return (LES_TURBULENCE_TYPES as readonly string[]).includes(t);
});

/**
 * V1.18d — matrix solver → smoother/preconditioner line. OpenFOAM
 *  expects different keywords depending on the solver family:
 *  smoother-line used for GAMG + smoothSolver (GaussSeidel /
 *  symGaussSeidel); preconditioner-line used for PCG, PBiCG,
 *  PBiCGStab (DIC / DILU). The helper returns the full line
 *  including the leading whitespace so the template stays
 *  read-clean.
 *
 *  V1.38 — pure string-construction core lifted to
 *  @main/openfoam/case-helpers.formatSmootherLine. The Handlebars
 *  wrapper is now a 1-line type-coerce + SafeString-wrap shell.
 */
Handlebars.registerHelper('smootherLine', function (solver: unknown) {
  const s = typeof solver === 'string' ? solver : '';
  return new Handlebars.SafeString(formatSmootherLine(s));
});

/**
 * V1.2 — render a per-patch BcField as OpenFOAM boundary-condition syntax.
 * Used by snappy_U.hbs and snappy_p.hbs to emit
 *     type <kind>;
 *     value uniform <...>;   (only for fixedValue)
 * inside each patch's { … } block. Falls back to zeroGradient if the BC
 * object is missing — keeps the templates safe even when the renderer ships
 * a partial bc table (e.g. a legacy .cfd-app-state.json).
 *
 *   {{#each patches}}
 *       {{name}}
 *       {
 *           {{bcFor ../bc.velocity name}}
 *       }
 *   {{/each}}
 *
 *  V1.38 — pure string-construction core lifted to
 *  @main/openfoam/case-helpers.formatBcBlock. The Handlebars
 *  wrapper is now a 1-line SafeString-wrap shell that delegates
 *  to the pure core (which preserves all the defensive type
 *  checks: typeof === 'object' for bcMap, typeof === 'string'
 *  for patchName, Number.isFinite for the fixedValue vector
 *  entries, etc.).
 */
Handlebars.registerHelper('bcFor', function (bcMap: unknown, patchName: unknown) {
  return new Handlebars.SafeString(formatBcBlock(bcMap, patchName));
});

/**
 * V1.4 — render a per-patch snappy refinement level line. Emits a single
 * `level (min max);` line that goes inside a refinementSurfaces entry. Falls
 * back to (0 0) if the refinements map is missing or the patch has no entry
 * (legacy .cfd-app-state.json safety). SafeString-wrapped so Handlebars
 * doesn't HTML-escape the parens.
 *
 *   {{#each patches}}
 *       {{name}}
 *       {
 *           {{refBlock ../patchRefinements name}}
 *       }
 *   {{/each}}
 *
 *  V1.38 — pure string-construction core lifted to
 *  @main/openfoam/case-helpers.formatRefinementBlock. The
 *  Handlebars wrapper is now a 1-line SafeString-wrap shell that
 *  delegates to the pure core (which preserves all the defensive
 *  checks: Number.isFinite for the value, Math.max/min clamp to
 *  OpenFOAM's 0..7 range, Math.round for fractional inputs, and
 *  the `max < min` invariant snap).
 */
Handlebars.registerHelper('refBlock', function (refMap: unknown, patchName: unknown) {
  return new Handlebars.SafeString(formatRefinementBlock(refMap, patchName));
});

/**
 * Resolve the templates directory. In dev (electron-vite), resources live at
 * /<project>/resources. In production, they're bundled under process.resourcesPath/templates.
 */
export function resolveTemplatesRoot(): string {
  // electron-vite serves files relative to process.cwd() in dev
  // and to process.resourcesPath in packaged builds.
  if (process.env.NODE_ENV === 'development') {
    return path.join(process.cwd(), 'resources', 'templates');
  }
  return path.join(process.resourcesPath || process.cwd(), 'templates');
}

interface TemplateEntry {
  out: string; // relative output path within caseDir
  src: string; // relative path to template under templatesRoot/<kind>/
}

const CAVITY_TEMPLATES: TemplateEntry[] = [
  { out: 'system/blockMeshDict', src: 'blockMeshDict.hbs' },
  { out: 'system/controlDict', src: 'controlDict.hbs' },
  { out: 'system/fvSchemes', src: 'fvSchemes.hbs' },
  { out: 'system/fvSolution', src: 'fvSolution.hbs' },
  { out: 'constant/transportProperties', src: 'transportProperties.hbs' },
  { out: 'constant/momentumTransport', src: 'momentumTransport.hbs' },
  { out: '0/U', src: '0/U.hbs' },
  { out: '0/p', src: '0/p.hbs' },
];

const TEMPLATE_LAYOUT: Record<CaseKind, TemplateEntry[]> = {
  cavity: CAVITY_TEMPLATES,
  // Channel/cylinder/airfoil templates will be added below as separate files.
  // For now, they fall back to the cavity layout — replace those files when ready.
  channel: CAVITY_TEMPLATES,
  cylinder: CAVITY_TEMPLATES,
  airfoil: CAVITY_TEMPLATES,
};

/**
 * Switch the template layout for imported (snappy-driven) cases:
 *   - replace 0/U and 0/p with patch-aware variants
 *   - add system/snappyHexMeshDict
 *
 * Detection: domain.geometryKind === 'imported' OR domain.patches non-empty.
 *
 * V1.35b — exported for unit testing. Returns the ordered list of
 *  templates that `renderCase` will compile + write. The function is
 *  pure (input: Domain + CaseKind; output: TemplateEntry[]) and
 *  testable without round-tripping through the full renderCase
 *  pipeline. Each TemplateEntry has an `out` (path within caseDir)
 *  and a `src` (relative path to .hbs file under templates/<kind>/).
 */
export function buildTemplateLayout(domain: Domain, kind: CaseKind): TemplateEntry[] {
  const isImported = domain.geometryKind === 'imported' || (domain.patches?.length ?? 0) > 0;
  const base = TEMPLATE_LAYOUT[kind];
  if (!isImported) return base;

  const filtered = base.filter((t) => t.out !== '0/U' && t.out !== '0/p');
  return [
    ...filtered,
    { out: '0/U', src: 'snappy_U.hbs' },
    { out: '0/p', src: 'snappy_p.hbs' },
    { out: 'system/snappyHexMeshDict', src: 'snappyHexMeshDict.hbs' },
    // Make sure the STL directory exists with a placeholder so OpenFOAM's
    // surface checks don't complain before snappy reads them.
    { out: 'constant/triSurface/.keep', src: 'triSurfaceKeep.hbs' },
  ];
}

/** Background-domain resolution string for snappyHexMeshDict (e.g. "30 20 20").
 *  V1.35a — exported as a named symbol so vitest can drive it
 *  directly without round-tripping through the full renderCase
 *  pipeline (which would need fs + cwd + NODE_ENV setup). The
 *  function itself is unchanged — only the visibility flag. */
export function formatResolution(domain: Domain): string {
  return `${domain.nx} ${domain.ny} ${domain.nz}`;
}

/** A point guaranteed to live inside the background blockMesh, used by
 *  snappy as the seed point for casting the surface. Falls back to the
 *  parametric domain center if the imported bbox is missing.
 *  V1.35a — exported for unit testing (see `formatResolution` above
 *  for the testability rationale). */
export function formatLocationInMesh(domain: Domain): string {
  const fmtNum = (n: number) => {
    if (!Number.isFinite(n)) return "0";
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

export interface RenderedCase {
  caseDir: string;
  files: string[];
}

export async function renderCase(
  kind: CaseKind,
  domain: Domain,
  bc: BoundaryConditions,
  outDir: string,
  caseLabel?: string,
  refinements?: PatchRefinements,
): Promise<RenderedCase> {
  const tplRoot = resolveTemplatesRoot();
  const kindTplDir = path.join(tplRoot, kind);
  const entries = buildTemplateLayout(domain, kind);

  // Build directory scaffold: 0/, constant/, constant/triSurface, system/, polyMesh/
  await Promise.all(
    ['0', 'constant', 'constant/triSurface', 'system', 'polyMesh'].map((d) =>
      fs.mkdir(path.join(outDir, d), { recursive: true }),
    ),
  );

  const context = {
    ...domain,
    bc,
    // V1.4 — per-patch snappy refinement levels, consumed by the
    // refinementSurfaces block in snappyHexMeshDict.hbs. Kept as a separate
    // top-level key (instead of being merged into domain.patches) so the
    // Domain schema stays unchanged.
    patchRefinements: refinements ?? {},
    caseLabel: caseLabel ?? kind,
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
    // V1.18b — precomputed `emitRelaxationFactors` boolean for fvSolution.
    //  SIMPLE-family solvers (simpleFoam, buoyantSimpleFoam, potentialFoam)
    //  emit the block unconditionally per V1.11 review-fix; pimpleFoam
    //  emits only when `relaxationFactors.enabled === true` (off by default
    //  for PIMPLE per the V1.18b designer recommendation). Pre-computing
    //  here avoids needing a Handlebars `and` helper in the template.
    //
    //  V1.18b review-fix — `domain.relaxationFactors` is now part of
    //  DomainSchema (added alongside V1.18d's `solverConfigs`) so the
    //  optional-chaining read drops to a direct property access. Pre-
    //  V1.18b cases parse with `enabled: false` via Zod defaults and the
    //  boolean resolves to V1.11 behavior (PIMPLE never emits).
    emitRelaxationFactors:
      domain.solver === "simpleFoam" ||
      domain.solver === "buoyantSimpleFoam" ||
      domain.solver === "potentialFoam" ||
      (domain.solver === "pimpleFoam" && domain.relaxationFactors.enabled),
    // V1.19 — precomputed boolean used by controlDict.hbs to gate
    //  the `adjustTimeStep yes;` block. SIMPLE-family solvers
    //  (simpleFoam, buoyantSimpleFoam, potentialFoam) ignore the
    //  field entirely in OpenFOAM, so we hard-route them to `no`
    //  regardless of the form's displayed toggle (the values
    //  still roundtrip through .cfd-app-state.json for renderer
    //  state consistency, but the emitted controlDict is always
    //  OpenFOAM stock). pimpleFoam + icoFoam honor the toggle
    //  directly: emitting `yes; maxCo X;` when enabled, `no;`
    //  otherwise.
    emitAdaptiveTimeStep:
      ((domain.solver === "pimpleFoam" || domain.solver === "icoFoam") &&
        domain.adaptiveTimeStep.enabled),
  };

  const written: string[] = [];
  for (const tpl of entries) {
    const srcPath = path.join(kindTplDir, tpl.src);
    const dstPath = path.join(outDir, tpl.out);
    // Some "templates" exist only to bootstrap an empty directory (e.g. constant/triSurface/.keep/
    // needs a keep file so the empty directory is committed in packaged builds).
    if (srcPath.endsWith('.keep') || tpl.src === 'triSurfaceKeep.hbs') {
      await fs.writeFile(dstPath, '', 'utf8');
      written.push(tpl.out);
      continue;
    }
    let rendered: string;
    try {
      rendered = await renderFile(srcPath, context);
    } catch (err) {
      throw new Error(`Failed to render ${tpl.src} → ${tpl.out}: ${String(err)}`);
    }
    await fs.writeFile(dstPath, rendered, 'utf8');
    written.push(tpl.out);
  }

  // Write a sidecar app-state file with the full domain + bc + refinements
  // for roundtripping.
  const statePath = path.join(outDir, '.cfd-app-state.json');
  await fs.writeFile(
    statePath,
    JSON.stringify({ kind, domain, bc, refinements: refinements ?? {} }, null, 2),
    'utf8',
  );
  written.push('.cfd-app-state.json');

  return { caseDir: outDir, files: written };
}

async function renderFile(srcPath: string, context: Record<string, unknown>): Promise<string> {
  // Allow specialization by reading a file-specific override first (e.g. fall back to cavity).
  let source: string;
  try {
    source = await fs.readFile(srcPath, 'utf8');
  } catch (err) {
    throw new Error(`Template not found: ${srcPath} (${String(err)})`);
  }
  const compiled = Handlebars.compile(source, { noEscape: true });
  return compiled(context);
}

/** Load a previously-saved app state. Each field is funneled through the
 *  corresponding Zod schema so legacy `.cfd-app-state.json` files (e.g. one
 *  written before V1.5 added `purgeWrite` or V1.7 added `initialConditions`)
 *  read back with the schema's `.default(...)` filling in missing fields,
 *  rather than leaking a Domain object that's missing keys the rest of the
 *  rendering pipeline expects. */
export async function loadCaseState(caseDir: string): Promise<{
  kind: CaseKind;
  domain: Domain;
  bc: BoundaryConditions;
  refinements: PatchRefinements;
} | null> {
  const statePath = path.join(caseDir, '.cfd-app-state.json');
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const obj = JSON.parse(raw);
    return {
      kind: obj.kind as CaseKind,
      // Zod-parse to materialize `.default(...)` values for fields added
      //  after the file was written (purgeWrite in V1.5, initialConditions
      //  in V1.7, future fields TBD). Without this, a legacy file's
      //  `loaded.domain` is missing the new keys and downstream code that
      //  assumes them (e.g. cache `builtDomain` in startSimulation) gets
      //  `undefined`.
      domain: DomainSchema.parse(obj.domain),
      // Legacy files written before V1.2 lacked a `bc` key entirely (the BC
      //  editor was added in V1.2). Fall back to empty BCs so those cases
      //  still load; the user can hand-edit if zero defaults look wrong.
      bc: BoundaryConditionsSchema.parse(obj.bc ?? { velocity: {}, pressure: {} }),
      refinements: z.record(z.string(), PatchRefinementSchema).parse(obj.refinements ?? {}),
    };
  } catch {
    // Swallow parse / IO errors and return null. The IPC `caseLoad` handler
    //  surfaces `{ok:false, message:'No .cfd-app-state.json'}` to the renderer
    //  for the user-visible "load this case" path; bulk callers (`caseList`,
    //  `runStart`) already filter null results. Avoid `console.warn` here
    //  because every corrupted case in the runs directory would log on every
    //  case-list scan, drowning the main-process stdout in benign noise.
    return null;
  }
}

/** Convenience: save a case as-is (copy template render to a target dir). */
export async function saveCase(
  kind: CaseKind,
  domain: Domain,
  bc: BoundaryConditions,
  targetDir: string,
  caseLabel?: string,
  refinements?: PatchRefinements,
) {
  return renderCase(kind, domain, bc, targetDir, caseLabel, refinements);
}

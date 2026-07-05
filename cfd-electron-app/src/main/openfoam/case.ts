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
  PatchRefinementSchema,
  type Domain,
  type BoundaryConditions,
  type BcField,
  type CaseKind,
  type PatchRefinement,
  type PatchRefinements,
} from '@shared/types';

Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
Handlebars.registerHelper('or', (a: unknown, b: unknown) => a || b);

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
 */
Handlebars.registerHelper('bcFor', function (bcMap: unknown, patchName: unknown) {
  const safe: BcField = { type: 'zeroGradient' };
  if (bcMap && typeof bcMap === 'object' && typeof patchName === 'string') {
    const bc = (bcMap as Record<string, BcField | undefined>)[patchName];
    if (bc && typeof bc === 'object' && typeof bc.type === 'string') safe.type = bc.type;
    if (bc && bc.value !== undefined) safe.value = bc.value;
  }
  if (safe.type !== 'fixedValue') {
    return new Handlebars.SafeString(`type ${safe.type};`);
  }
  const v = safe.value;
  if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return new Handlebars.SafeString(
      `type fixedValue;\n        value uniform (${v[0]} ${v[1]} ${v[2]});`,
    );
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return new Handlebars.SafeString(`type fixedValue;\n        value uniform ${v};`);
  }
  return new Handlebars.SafeString(`type fixedValue;\n        value uniform (0 0 0);`);
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
 */
Handlebars.registerHelper('refBlock', function (refMap: unknown, patchName: unknown) {
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
  return new Handlebars.SafeString(`level (${min} ${max});`);
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
 */
function buildTemplateLayout(domain: Domain, kind: CaseKind): TemplateEntry[] {
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

/** Background-domain resolution string for snappyHexMeshDict (e.g. "30 20 20"). */
function formatResolution(domain: Domain): string {
  return `${domain.nx} ${domain.ny} ${domain.nz}`;
}

/** A point guaranteed to live inside the background blockMesh, used by
 *  snappy as the seed point for casting the surface. Falls back to the
 *  parametric domain center if the imported bbox is missing. */
function formatLocationInMesh(domain: Domain): string {
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

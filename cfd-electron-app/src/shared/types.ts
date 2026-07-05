import { z } from 'zod';

// ---------- Domain schemas ----------

export const SolverSchema = z.enum([
  'icoFoam',
  'simpleFoam',
  'pimpleFoam',
  'potentialFoam',
  'buoyantSimpleFoam',
]);
export type Solver = z.infer<typeof SolverSchema>;

export const TurbulenceModelSchema = z.enum([
  'laminar',
  'kEpsilon',
  'kOmegaSST',
  'SpalartAllmaras',
  'LES',
]);
export type TurbulenceModel = z.infer<typeof TurbulenceModelSchema>;

export const CaseKindSchema = z.enum([
  'cavity',
  'channel',
  'cylinder',
  'airfoil',
]);
export type CaseKind = z.infer<typeof CaseKindSchema>;

export const PhaseSchema = z.enum([
  'idle',
  'preparing',
  'meshing',
  'snapping',
  'decomposing',
  'solving',
  'reconstructing',
  'converting',
  'done',
  'error',
  'cancelled',
]);
export type Phase = z.infer<typeof PhaseSchema>;

// ---------- Geometry mode ----------

export const GeometryKindSchema = z.enum(['parametric', 'imported']).default('parametric');
export type GeometryKind = z.infer<typeof GeometryKindSchema>;

/**
 * A patch the renderer exported from a STEP/IGES/STL to `constant/triSurface/<name>.stl`
 * for snappyHexMesh's `geometry` block.
 */
export const GeometryPatchSchema = z.object({
  name: z.string().min(1),
  /** Triangle count for the STL (informational; useful for sorting UI). */
  triangleCount: z.number().int().nonnegative().optional(),
  /** Optional target feature resolution (metres). Mapped to Level (nCells)... cells if absent. */
  refinementLevel: z.number().int().nonnegative().optional(),
});
export type GeometryPatchInput = z.infer<typeof GeometryPatchSchema>;

export const DomainSchema = z.object({
  kind: CaseKindSchema,
  // Geometry
  Lx: z.number().positive(),
  Ly: z.number().positive(),
  Lz: z.number().positive(),
  // Mesh
  nx: z.number().int().positive(),
  ny: z.number().int().positive(),
  nz: z.number().int().positive(),
  // Physics
  nu: z.number().positive(),         // kinematic viscosity m^2/s
  rho: z.number().positive(),        // density kg/m^3 (only used by some solvers)
  // Simulation controls
  solver: SolverSchema,
  turbulence: TurbulenceModelSchema,
  endTime: z.number().positive(),
  deltaT: z.number().positive(),
  writeInterval: z.number().int().positive(),
  // V1.5 — purgeWrite on the Domain itself so it roundtrips through
  // .cfd-app-state.json. Pre-V1.5 cases see the default 0, matching the
  // previous hard-coded controlDict value (no behavior change for them).
  purgeWrite: z.number().int().min(0).default(0),
  // V1.7 — initial-field values rendered as `internalField uniform …;` in
  // 0/U and 0/p. Default is the freestream-rest state zero so any
  // .cfd-app-state.json written before V1.7 parses identically to today's
  // hard-coded `(0 0 0)` / `0`.
  initialConditions: InitialConditionsSchema.default({
    velocity: { x: 0, y: 0, z: 0 },
    pressure: 0,
  }),
  // Solver performance
  cores: z.number().int().min(1).max(64),
  // Snappy / imported geometry (added in V0.6)
  geometryKind: GeometryKindSchema,
  patches: z.array(GeometryPatchSchema).default([]),
  /** Bounding box of the imported solid; required when geometryKind === 'imported' so the
   *  renderer can size the background domain and set snappyHexMesh's `locationInMesh`. */
  bbox: z
    .object({
      min: z.object({ x: z.number(), y: z.number(), z: z.number() }),
      max: z.object({ x: z.number(), y: z.number(), z: z.number() }),
    })
    .optional(),
  /** Background blockMesh origin (corner). Defaults to (0,0,0) so parametric cavity
   *  cases render unchanged. For imported (snappy-driven) cases the renderer sets
   *  this to `bbox.min - padding*span` so the imported geometry is fully contained
   *  in the background mesh, regardless of where the original STEP/IGES is anchored. */
  origin: z
    .object({ x: z.number(), y: z.number(), z: z.number() })
    .optional(),
});
export type Domain = z.infer<typeof DomainSchema>;

export const BcFieldSchema = z.object({
  type: z.enum(['fixedValue', 'zeroGradient', 'noSlip', 'slip', 'cyclic', 'symmetryPlane', 'empty']),
  value: z.union([z.number(), z.array(z.number()).length(3)]).optional(),
});
export type BcField = z.infer<typeof BcFieldSchema>;

export const BoundaryConditionsSchema = z.object({
  // map of patchId -> map of field -> BC
  velocity: z.record(z.string(), BcFieldSchema),
  pressure: z.record(z.string(), BcFieldSchema),
});
export type BoundaryConditions = z.infer<typeof BoundaryConditionsSchema>;

// V1.7 — initial-condition segment. Renders `internalField uniform …;` in
// both the parametric-cavity templates (`0/U.hbs`, `0/p.hbs`) and the snappy
// variants (`snappy_U.hbs`, `snappy_p.hbs`). Object form `{x, y, z}` is
// vastly more readable in Handlebars templates than a 3-tuple that would
// need `velocity.[0]` index access. BcField stays tuple-form (`z.array(z.number()).length(3)`)
// because its Handlebars access is mediated by the `bcFor` helper that
// already consumes tuples; mixing the two subsystems is fine.
export const InitialConditionsSchema = z.object({
  velocity: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  pressure: z.number(),
});
export type InitialConditions = z.infer<typeof InitialConditionsSchema>;

// V1.4 — per-patch snappy surface refinement levels. Min and max cells
// between the surface and the volume grid; both 0..7 in practice (typical
// 0..3). The global `nCellsBetweenLevels` (default 3) is read from
// snappyHexMeshDict; per-patch override is out of scope.
export const PatchRefinementSchema = z.object({
  min: z.number().int().min(0).max(7),
  max: z.number().int().min(0).max(7),
});
export type PatchRefinement = z.infer<typeof PatchRefinementSchema>;
export type PatchRefinements = Record<string, PatchRefinement>;

// ---------- V1.5 — Persistent solver runtime controls ----------

/**
 * Per-solver runtime controls (deltaT, writeInterval, purgeWrite, endTime,
 * cores, nu). Lives in the renderer Zustand store as a per-solver map;
 * `buildCaseFromPatches` merges the active solver's entry into the Domain
 * sent to IPC, so no IPC schema change is needed. Survives page reloads
 * because it's stored on the global slice, NOT local React useState.
 *
 * `deltaT` is conventional 1 for steady solvers (simpleFoam,
 * buoyantSimpleFoam, potentialFoam) and the editor masks the input
 * rather than letting users set it. Transient solvers (icoFoam, pimpleFoam)
 * need a small deltaT to keep the Courant number manageable.
 */
export const SolverControlsSchema = z.object({
  solver: SolverSchema,
  deltaT: z.number().positive(),
  writeInterval: z.number().int().positive(),
  purgeWrite: z.number().int().min(0),
  endTime: z.number().positive(),
  /** V1.6 — turbulence model. Stored per-solver so flipping solver dropdowns
   *  preserves the user's RAS choice. `LES` is schema-allowed but not yet
   *  rendered by `momentumTransport.hbs`; the renderer dropdown filters it
   *  out until V1.x adds an LES branch. */
  turbulence: TurbulenceModelSchema,
  cores: z.number().int().min(1).max(64),
  nu: z.number().positive(),
  /** V1.7 — initial conditions. Per-solver so flipping the dropdown
   *  preserves the user's freestream choice. `potentialFoam` defaults to
   *  `(1, 0, 0)` since it's a preconditioner that genuinely needs a
   *  freestream; all others default to zero (so the lid-driven cavity
   *  benchmark keeps converging). */
  initialConditions: InitialConditionsSchema,
});
export type SolverControls = z.infer<typeof SolverControlsSchema>;

/**
 * Per-solver map of last-good controls. The user can flip the solver
 * dropdown without losing their tweaks — each solver keeps its own
 * deltaT / writeInterval / purgeWrite / cores / nu.
 * Resolved by `buildCaseFromPatches` from `state.formSolver`.
 */
export type SolverControlsBySolver = Record<Solver, SolverControls>;

// ---------- Residuals & logs ----------

export const ResidualPointSchema = z.object({
  time: z.number(),
  fields: z.record(z.string(), z.number()),
});
export type ResidualPoint = z.infer<typeof ResidualPointSchema>;

/** Wire-format of a residual sample as broadcast from main to renderer.
 *  Carries `runId` so the renderer can drop stale events from a previous run. */
export interface RunResidualEvent extends ResidualPoint {
  runId: string;
}

export const LogChunkSchema = z.object({
  stream: z.enum(['stdout', 'stderr']),
  text: z.string(),
});
export type LogChunk = z.infer<typeof LogChunkSchema>;

/** Wire-format of a log delta as broadcast from main to renderer. */
export interface RunLogEvent extends LogChunk {
  runId: string;
}

/** Wire-format of a phase transition. */
export interface RunPhaseEvent {
  phase: Phase;
  message?: string;
  runId: string;
}

// ---------- IPC request / response envelopes ----------

export const OpenfoamDetectedSchema = z.object({
  found: z.boolean(),
  version: z.string().optional(),
  bashrc: z.string().optional(),
  binPaths: z.array(z.string()).optional(),
  installHints: z.array(z.string()).optional(),
});
export type OpenfoamDetected = z.infer<typeof OpenfoamDetectedSchema>;

export const RunResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  runId: z.string().optional(),
  caseDir: z.string().optional(),
});
export type RunResult = z.infer<typeof RunResultSchema>;

export const CaseSavedSchema = z.object({
  ok: z.boolean(),
  path: z.string().optional(),
  message: z.string().optional(),
});
export type CaseSaved = z.infer<typeof CaseSavedSchema>;

export const AppSettingsSchema = z.object({
  openfoamBashrc: z.string().optional(),
  defaultRunRoot: z.string().optional(),
  maxLogBufferLines: z.number().int().positive().default(2000),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

// ---------- Geometry prep ----------

export const GeometryFormatSchema = z.enum(['STEP', 'STL', 'IGES']);
export type GeometryFormat = z.infer<typeof GeometryFormatSchema>;

/** Bounding box (axis-aligned) of a loaded solid, used for domain sizing. */
export interface BoundingBoxMinMax {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/** One picked face group from the OCCT mesher (a face tessellated to N triangles). */
export interface FaceGroup {
  /** Index of this face in the parent shape. */
  faceIndex: number;
  /** Start (in the index buffer) of this face's triangles. */
  start: number;
  /** Number of triangles for this face. */
  count: number;
  /** Optional: face area in m^2 (computed lazily). null until queried. */
  area: number | null;
}

/** Result of importing + meshing a geometry file in the renderer. */
export const LoadedGeometrySchema = z.object({
  /** Original file path, for round-tripping / error messages. */
  path: z.string(),
  /** Format the file was loaded from. */
  format: GeometryFormatSchema,
  /** Total triangle count across all faces. */
  triangleCount: z.number().int().nonnegative(),
  /** Total face count. */
  faceCount: z.number().int().nonnegative(),
  /** Axis-aligned bounding box of the parent shape. */
  bbox: z.object({
    min: z.object({ x: z.number(), y: z.number(), z: z.number() }),
    max: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  }),
});
export type LoadedGeometry = z.infer<typeof LoadedGeometrySchema>;

/** A user-defined patch (grouping of selected faces), exported as a single STL
 *  for snappyHexMesh's constant/triSurface/<name>.stl entries. */
export interface GeometryPatch {
  id: string;
  name: string;
  faceIndices: number[];
  /** Triangle count across all faces in this patch (filled on creation). */
  triangleCount: number;
  /** STL file path the patch was last exported to, relative to the case dir. */
  lastExportedRelPath: string | null;
}

// ---------- IPC channel names ----------

export const IpcChannels = {
  // main -> renderer (event)
  log: 'cfd:log',
  phase: 'cfd:phase',
  residuals: 'cfd:residuals',
  // renderer -> main (invoke)
  openfoamDetect: 'cfd:openfoamDetect',
  openfoamSettingsSave: 'cfd:openfoamSettingsSave',
  openfoamSettingsLoad: 'cfd:openfoamSettingsLoad',
  openfoamVerifyBashrc: 'cfd:openfoamVerifyBashrc',
  caseCreate: 'cfd:caseCreate',
  caseSave: 'cfd:caseSave',
  caseLoad: 'cfd:caseLoad',
  caseList: 'cfd:caseList',
  runStart: 'cfd:runStart',
  runCancel: 'cfd:runCancel',
  runStatus: 'cfd:runStatus',
  resultsList: 'cfd:resultsList',
  resultsRead: 'cfd:resultsRead',
  // results panel (V1.1) — lazy per-time field listing + OS file-manager actions
  resultsListFields: 'cfd:results:listFields',
  resultsRevealVTK: 'cfd:results:revealVTK',
  resultsOpenVTKDir: 'cfd:results:openVTKDir',
  // geometry prep (added in V0.5)
  geometryFilePickAndRead: 'cfd:geometry:pickAndRead',
  geometryFileWrite: 'cfd:geometry:write',
  geometryCaseList: 'cfd:geometry:caseList',
} as const;
export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

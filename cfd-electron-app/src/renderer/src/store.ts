/**
 * Zustand store for the geometry-prep view.
 *
 * Holds:
 *   - the current `PreparedGeometry` (single shape loaded at a time in V0.5)
 *   - the active selection (per-face highlight)
 *   - a list of named patches (subset of face indices → STL export target)
 *   - the active case directory (where STLs are written for snappyHexMesh)
 *   - the V0.8 run slice (OpenFOAM detect, run phase, logs, residuals)
 *
 * Actions perform the WASM / DOM I/O work; everything else stays pure.
 */
import { create } from "zustand";
import type {
  AppSettings,
  BcField,
  BoundaryConditions,
  Domain,
  GeometryPatch as GeometryPatchWire,
  InitialConditions,
  OpenfoamDetected,
  PatchRefinement,
  PatchRefinements,
  Phase,
  ResidualPoint,
  RunLogEvent,
  RunPhaseEvent,
  RunResidualEvent,
  Solver,
  SolverControls,
  SolverControlsBySolver,
} from "@shared/types";
import {
  loadStepGeometry,
  loadIgesGeometry,
  loadStlGeometry,
  toLoadedGeometry,
  type PreparedGeometry,
} from "./lib/geometry";
import { exportFacesAsStl, countTriangles } from "./lib/stlWriter";

export type GeometryFormat = "STEP" | "STL" | "IGES";

/** A user-defined patch (grouping of selected faces). */
export interface GeometryPatch {
  id: string;
  name: string;
  faceIndices: number[];
  triangleCount: number;
  /** Path the patch was last exported to (case-relative, e.g. constant/triSurface/inlet.stl). */
  lastExportedRelPath: string | null;
}

export type Status =
  | { kind: "idle"; message?: string }
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string }
  | { kind: "ready"; message: string };

const MAX_LOG_LINES = 200;
const MAX_RESIDUAL_POINTS = 240;

/** Tail of the most recent LogChunk stream — flattened to (stream,text) pairs. */
export interface LogLine {
  stream: "stdout" | "stderr";
  text: string;
}

interface State {
  // Geometry prep (existing)
  status: Status;
  prep: PreparedGeometry | null;
  /** Face indices the user has selected via clicking the viewer. */
  selectedFaceIds: Set<number>;
  /** Named patches. */
  patches: GeometryPatch[];
  /** V1.2 — per-patch boundary conditions, keyed by patch name. The
   *  renderer's BC editor mutates this slice, and buildCaseFromPatches passes
   *  it straight through to renderCase so the generated 0/U and 0/p files
   *  have correct inlet / outlet / wall BCs out of the box (no hand-edit
   *  required). Defaults are seeded on createPatch and cleaned up on
   *  deletePatch. */
  boundaryConditions: BoundaryConditions;
  /** V1.4 — per-patch snappy surface refinement levels (min, max). Mirrors
   *  the V1.2 BC slice pattern: seeded with sensible defaults on
   *  createPatch, cleaned up on deletePatch, mutated via setPatchRefinement,
   *  and passed straight through buildCaseFromPatches → renderCase so the
   *  generated snappyHexMeshDict has a populated `refinementSurfaces` block. */
  patchRefinements: PatchRefinements;
  /** V1.5 — solver-keyed runtime controls (deltaT, writeInterval, purgeWrite,
   *  endTime, cores, nu). Last-good values per solver, so flipping the
   *  dropdown preserves tweaks. Lives in the renderer store (NOT React
   *  useState) so changes survive page reloads. Resolved by
   *  `buildCaseFromPatches` from `state.formSolver` and merged into the
   *  Domain sent to IPC. */
  solverControlsBySolver: SolverControlsBySolver;
  /** V1.5 — currently-active solver in the Build Case form. The user may
   *  flip between solvers to compare defaults, so this is decoupled from
   *  the solver field of any individual `SolverControls` entry. */
  formSolver: Solver;
  /** Active case directory the user picked for export (full path on disk). */
  activeCaseDir: string | null;
  /** Available cases from the IPC caseList call (cached for the picker UI). */
  caseOptions: Array<{ dir: string; name: string; kind: string; mtime: number }>;
  /** Last-built Domain + the case dir it was rendered to. Stamped so re-picks to a
   *  different case don't accidentally run with the wrong solver. */
  builtDomain: Domain | null;
  builtDomainCaseDir: string | null;

  // Run slice (V0.8)
  /** Result of the most recent OpenFOAM detection attempt. null until first Detect. */
  openfoamDetected: OpenfoamDetected | null;
  isDetecting: boolean;
  /** Path to the bashrc the renderer will source when launching a run. Either the
   *  detected default, or a user-supplied override via the TopBar. */
  bashrc: string | null;
  /** Job sizing knob for the next run start. */
  cores: number;
  /** True while a run is in flight (between startSimulation and a final phase). */
  isRunning: boolean;
  isStopping: boolean;
  runId: string | null;
  runPhase: Phase;
  /** Tail of the most recent log stream, capped at MAX_LOG_LINES. */
  recentLogs: LogLine[];
  /** Latest residual sample for the current run. Fields are solver-specific
   *  (Ux, Uy, Uz, p, k, epsilon, ...). */
  lastResidual: ResidualPoint | null;
  /** History of residual samples for the current/last run, capped at
   *  MAX_RESIDUAL_POINTS for the live sparkline. Cleared at run start
   *  and on reset. */
  residualHistory: ResidualPoint[];
  /** V1.8 — informational: when (if ever) the convergence detector fired
   *  during the current/last run. Stays visible in StatusBar even after
   *  the solver phase pill moves on (reconstructing / converting) so the
   *  user can tell that the residuals did flatten. Cleared at run start
   *  and on `clearRunState`. */
  lastConvergence: { atTime: number; atMs: number } | null;

  // Settings slice (V0.9)
  /** Last-known settings as persisted in ~/.config/cfd-studio/settings.json.
   *  Loaded on mount; merged into context for the Settings modal form. */
  settings: AppSettings;
  /** Whether the Settings modal is currently open. */
  isSettingsOpen: boolean;
  /** True while the modal is verifying a user-supplied bashrc path. */
  isVerifyingBashrc: boolean;

  // Results slice (V1.1) — read back post-run output from <caseDir>/<time>/.
  resultsAvailableTimes: number[];
  resultsFieldsByTime: Record<number, string[]>;
  resultsSelectedTime: number | null;
  resultsSelectedField: string | null;
  resultsFieldData: string | null;
  resultsIsLoading: boolean;
}

interface Actions {
  /** Browser open dialog → load file via the bridge → mesh → populate store. */
  pickAndLoad: (format: GeometryFormat) => Promise<void>;
  /** Toggle a face in the active selection. */
  toggleFace: (faceIndex: number) => void;
  /** Add a face to selection if missing (used by lasso / range picker). */
  selectFace: (faceIndex: number) => void;
  /** Remove a face from selection. */
  deselectFace: (faceIndex: number) => void;
  clearSelection: () => void;
  /** Create a new (empty) patch; the caller then assigns faces. */
  createPatch: (name: string) => GeometryPatch;
  /** Add currently-selected faces to a patch; does NOT clear selection. */
  assignSelectionToPatch: (patchId: string) => void;
  /** Replace a patch's faces list. */
  setPatchFaces: (patchId: string, faceIndices: number[]) => void;
  /** Remove a patch. Also cleans up any BC entries keyed by the patch's name. */
  deletePatch: (patchId: string) => void;
  /** V1.2 — set a single field BC for a patch. field is "velocity" (vector)
   *  or "pressure" (scalar); value is only required for fixedValue. Cleared
   *  entries default to the per-patch fallback. */
  setPatchBc: (
    patchId: string,
    field: "velocity" | "pressure",
    bc: BcField,
  ) => void;
  /** V1.4 — set the snappy surface refinement levels for a patch. Auto-clamps
   *  min/max to the 0..7 range and enforces min ≤ max. */
  setPatchRefinement: (patchId: string, refinement: PatchRefinement) => void;
  /** V1.5 — set one runtime control (deltaT | writeInterval | purgeWrite |
   *  endTime | cores | nu) for a specific solver. Switching the Build Case
   *  solver dropdown calls `setFormSolver`; setting individual inputs calls
   *  this. Together they drive `buildCaseFromPatches`. */
  setSolverControl: <K extends keyof SolverControls>(
    solver: Solver,
    key: K,
    value: SolverControls[K],
  ) => void;
  /** V1.5 — switch the Build Case solver dropdown. Doesn't touch any other
   *  solver's saved values; the user can flip and flip back. */
  setFormSolver: (solver: Solver) => void;
  /** Export a patch to constant/triSurface/<name>.stl in the case dir. */
  exportPatch: (patchId: string) => Promise<void>;
  /** Refresh available cases from the bridge. */
  refreshCases: () => Promise<void>;
  setActiveCase: (dir: string | null) => void;
  /** Build a snappyHexMesh-driven case from current patches + geometry. */
  buildCaseFromPatches: (opts?: {
    label?: string;
    solver?: 'icoFoam' | 'simpleFoam' | 'pimpleFoam' | 'potentialFoam' | 'buoyantSimpleFoam';
    endTime?: number;
    cores?: number;
    nu?: number;
    /** % background domain padding around the geometry bbox (default 25). */
    paddingPercent?: number;
  }) => Promise<void>;
  /** Forget everything. */
  reset: () => void;

  // Run-slice actions (V0.8)
  /** Probe the host system for an installed OpenFOAM distribution via the IPC bridge. */
  detectOpenfoam: () => Promise<void>;
  setBashrc: (path: string | null) => void;
  setCores: (n: number) => void;
  /** Launch an OpenFOAM run against the active case. Returns false if preconditions
   *  (case dir selected, bashrc known, no run in flight) are not met. */
  startSimulation: () => Promise<boolean>;
  /** Send a graceful stop to the main process; mpirun tree is SIGKILL'd after 1.5s. */
  cancelSimulation: () => Promise<void>;
  /** Drop everything run-related (after the user finishes inspecting a run, or wants
   *  to clear the log tail for a fresh attempt). Does NOT touch the active case dir. */
  clearRunState: () => void;

  // Subscriber used by App.tsx to wire IPC events into the store.
  appendLogChunk: (chunk: { stream: "stdout" | "stderr"; text: string; runId?: string }) => void;
  setRunPhase: (phase: Phase, message: string | undefined, runId?: string) => void;
  pushResidual: (point: { time: number; fields: Record<string, number>; runId?: string }) => void;
  /** V1.8 — stamp the moment the convergence detector fired. Called from
   *  setRunPhase when the incoming phase is 'converged'. Survives the
   *  pill moving past 'converged' so the user can see the t= snapshot
   *  even after moving to a later stage. */
  setLastConvergence: (atTime: number) => void;

  // Settings slice actions (V0.9)
  /** Load persisted settings from ~/.config/cfd-studio/settings.json. Called on mount. */
  loadSettings: () => Promise<void>;
  /** Save settings to disk via IPC. The main process invalidates its in-memory
   *  cache so the next case-list / run-root lookup picks up the new value. */
  saveSettings: (next: Partial<AppSettings>) => Promise<void>;
  /** Open the Settings modal. */
  openSettings: () => void;
  /** Close the Settings modal. */
  closeSettings: () => void;
  /** Verify a user-supplied bashrc path; writes the result back to settings
   *  if it's good, otherwise surfaces install hints to the modal. */
  verifyBashrc: (bashrcPath: string) => Promise<void>;

  // Results slice actions (V1.1)
  /** Enumerate the time directories under the active case dir. */
  loadResults: (caseDir: string) => Promise<void>;
  /** List the field files in a single time directory (lazy, per-select). */
  selectResultsTime: (time: number) => Promise<void>;
  /** Read a single field file's contents into `resultsFieldData`. */
  selectResultsField: (field: string) => Promise<void>;
  /** Drop everything results-related (called on run start / case change). */
  clearResults: () => void;
  /** Reveal the case's VTK output dir (or case dir fallback) in OS file manager. */
  revealResultsInFileManager: () => Promise<void>;
  /** Open the case's VTK output dir (or case dir fallback) in OS file manager. */
  openResultsDir: () => Promise<void>;
}

const initial: State = {
  status: { kind: "idle" },
  prep: null,
  selectedFaceIds: new Set<number>(),
  patches: [],
  // V1.2 — empty BC table; createPatch seeds per-name entries on demand.
  boundaryConditions: { velocity: {}, pressure: {} },
  // V1.4 — empty refinement table; createPatch seeds with {min:0, max:2}.
  patchRefinements: {},
  // V1.5 — solver-keyed runtime controls seeded with per-solver defaults.
  // The Build Case form reads from `solverControlsBySolver[formSolver]`
  // and `buildCaseFromPatches` merges the active solver's entry into the
  // Domain sent to IPC.
  solverControlsBySolver: makeSolverControlsDefaults(),
  // V1.5 — the Build Case form's currently-active solver. Defaults to
  // simpleFoam, matching the implicit default every V1.0..V1.4 build used.
  formSolver: "simpleFoam" as Solver,
  activeCaseDir: null,
  caseOptions: [],
  builtDomain: null,
  builtDomainCaseDir: null,
  // Run slice — defaults below. `openfoamDetected`, `bashrc`, and `cores` live
  // here too so the reducer is exhaustive, but `reset()` explicitly preserves
  // them across a "Clear geometry" so the user does NOT have to re-detect OpenFOAM.
  openfoamDetected: null,
  isDetecting: false,
  bashrc: null,
  cores: 4,
  isRunning: false,
  isStopping: false,
  runId: null,
  runPhase: "idle",
  recentLogs: [],
  lastResidual: null,
  residualHistory: [],
  // V1.8 — null until the convergence detector fires for the current/last run.
  lastConvergence: null,
  // Settings slice (V0.9) — `settings` defaults match the Zod schema defaults.
  settings: { maxLogBufferLines: 2000 },
  isSettingsOpen: false,
  isVerifyingBashrc: false,
  // Results slice (V1.1)
  resultsAvailableTimes: [],
  resultsFieldsByTime: {},
  resultsSelectedTime: null,
  resultsSelectedField: null,
  resultsFieldData: null,
  resultsIsLoading: false,
};

function triangleCountForFaces(prep: PreparedGeometry, faces: ReadonlySet<number>): number {
  // The faces of interest are already filtered — sum the [start,count] pair counts directly.
  // (We intentionally do NOT call countTriangles here because countTriangles indexes
  // 0..group.length/2 and expects the set to hold those 0-based indices.)
  let total = 0;
  for (let fi = 0; fi < prep.faceGroups.length; fi++) {
    if (!faces.has(fi)) continue;
    total += prep.faceGroups[fi]!.count;
  }
  return total;
}

let patchCounter = 0;
function newPatchId(): string {
  patchCounter = (patchCounter + 1) % 1_000_000;
  return `patch-${Date.now().toString(36)}-${patchCounter}`;
}

/**
 * V1.5 — per-solver starter values for the Build Case form. The renderer
 * seeds these on first load and `buildCaseFromPatches` reads from the
 * active solver's entry as the fallback when no explicit override is
 * passed. Transient solvers (icoFoam, pimpleFoam) need a small deltaT for
 * Courant stability; steady solvers (simpleFoam, buoyantSimpleFoam,
 * potentialFoam) treat t as iteration count and store deltaT fixed at 1.
 *
 * V1.7 — every solver carries `initialConditions`. Defaults:
 *   • potentialFoam → (1, 0, 0). It's a preconditioner for steady-state
 *     incompressible flow, so a non-zero freestream is what it's FOR.
 *   • all others → (0, 0, 0). Lid-driven cavity is the canonical test;
 *     a global (1, 0, 0) freestream would conflict with the noSlip walls
 *     and bounce the residuals on iterate #1.
 */
function makeSolverControlsDefaults(): SolverControlsBySolver {
  return {
  icoFoam: {
    solver: "icoFoam",
    turbulence: "laminar",
    deltaT: 0.001,
    writeInterval: 20,
    purgeWrite: 10,
    endTime: 1,
    cores: 4,
    nu: 1e-5,
    initialConditions: { velocity: { x: 0, y: 0, z: 0 }, pressure: 0 },
    // V1.8 — transient solver: looser threshold, shorter streak.
    converge: { enabled: true, maxInitialResidual: 1e-3, stableIterations: 50, autoStop: false },
    // V1.9 — PISO uses nCorrectors (no outer loop). 2 correctors is the
    // canonical OpenFOAM lid-driven-cavity starter; raising to 3-4
    // helps when the mesh has non-orthogonal cells.
    numerics: { enabled: true, nNonOrthogonalCorrectors: 0, nCorrectors: 2, nOuterCorrectors: 1, residualControl: '1e-4', residualControlByField: {} },
    // V1.11 — PISO solver; OpenFOAM doesn't emit a relaxationFactors
    //  block for PISO by default (momentum_predictor is on, but no
    //  under-relaxation). Empty maps let the template fall through to
    //  "no relaxationFactors block", preserving the V1.10 behavior.
    relaxationFactors: { enabled: false, fields: {}, equations: {} },
    // V1.19 — adaptiveTimeStep mirror of OpenFOAM stock (transient
    //  solvers, toggle off by default; `maxCo: 1` mirrors OpenFOAM
    //  built-in). icoFoam + pimpleFoam use the same shape since
    //  both are transient; the form row only renders for them so
    //  the value is dormant for the other 3 solvers (case.ts
    //  precomputes `emitAdaptiveTimeStep` to short-circuit the
    //  controlDict template for steady solvers).
    adaptiveTimeStep: { enabled: false, maxCo: 1 },
    // V1.12 — fvSchemes `default` selectors. icoFoam is transient so
    //  ddtDefault must be `Euler` (steadyState would silently break
    //  the time integration). Spatial schemes (grad / div / laplacian)
    //  use OpenFOAM stock incompressible defaults.
    // V1.15 — also seeds `interpolationDefault: 'linear'` and
    //  `snGradDefault: 'corrected'` (Solver-agnostic OpenFOAM stock
    //  values, mirrored across all five SOLVER_CONTROLS_DEFAULTS
    //  entries so the renderer's pre-parse in-memory state matches
    //  what FvSchemesSchema.default() materializes on parse).
    // V1.16 — also seeds `fieldLaplacians: {}` so per-field
    //  laplacian overrides (V1.16's 6-row UI flow) are reachable
    //  from the renderer's pre-parse in-memory state. Zod fills the
    //  same `{}` on parse for pre-V1.16 cases.
    // V1.17 — also seeds `fieldSnGrads: {}` so per-field snGrad
    //  overrides (V1.17's 6-row UI flow) are reachable from the
    //  renderer's pre-parse in-memory state. Solver-agnostic OpenFOAM
    //  stock values; the fvSchemes.hbs `{{or override "corrected"}}`
    //  helpers fall back to the snGradDefault value at render time.
    schemes: { ddtDefault: 'Euler', gradDefault: 'Gauss linear', divDefault: 'none', laplacianDefault: 'Gauss linear corrected', interpolationDefault: 'linear', snGradDefault: 'corrected', fieldDivs: {}, fieldLaplacians: {}, fieldSnGrads: {} },
    solverConfigs: { p: { solver: 'GAMG', tolerance: 1e-7, relTol: 0.01 }, U: { solver: 'smoothSolver', tolerance: 1e-7, relTol: 0.1 }, turbulence: { solver: 'smoothSolver', tolerance: 1e-7, relTol: 0.1 } },
    // V1.20 — k-ε turbulence-coefficient seed (OpenFOAM stock
    //  Cmu 0.09, C1 1.44, C2 1.92, sigmak 1.0, sigmaEps 1.3). Same
    //  default across all 5 SOLVER_CONTROLS_DEFAULTS entries
    //  because (a) the seed is solver-agnostic — flipping
    //  solver/turbulence just keeps the values dormant until the
    //  user picks kEpsilon — and (b) keeping matching seeds across
    //  5 entries means flipping back to a previous solver restores
    //  any kEpsilon-tuning the user did before.
    turbulenceCoefficients: { Cmu: 0.09, C1: 1.44, C2: 1.92, sigmak: 1.0, sigmaEps: 1.3 },
    // V1.21 — k-ω SST coefficient seed (OpenFOAM stock Menter 2009
    //  values: alphaK1 0.85, alphaK2 1.0, alphaOmega1 0.5,
    //  alphaOmega2 0.856, beta1 0.075, beta2 0.0828, betaStar 0.09,
    //  C1 2.0, gamma1 5/9, gamma2 7/8, sigmaK 0.6, sigmaOmega 0.5).
    //  Parallel slot to V1.20's `turbulenceCoefficients` (kEpsilon);
    //  the form only renders this row when the user picks kOmegaSST,
    //  so the values stay dormant otherwise. Defaults match all 5
    //  SOLVER_CONTROLS_DEFAULTS entries for the same symmetry reason
    //  as V1.20's kEpsilon slot. a1 (the Menter limiter) is
    //  intentionally absent — see KOmegegaSSTCoefficientsSchema
    //  comment; SpalartAllmaras coefficients are V1.22.
    turbulenceCoefficientsKOmegaSST: { alphaK1: 0.85, alphaK2: 1.0, alphaOmega1: 0.5, alphaOmega2: 0.856, beta1: 0.075, beta2: 0.0828, betaStar: 0.09, C1: 2.0, gamma1: 0.5555555555, gamma2: 0.875, sigmaK: 0.6, sigmaOmega: 0.5 },
    // V1.22 — Spalart-Allmaras coefficient seed. OpenFOAM stock
    //  (1994 + Pirzadeh 1999 cubic ramp: sigmaNut 0.667 = 2/3,
    //  kappa 0.41 [von Kármán, RANS-universal but OpenFOAM's
    //  SpalartAllmaras.C reads it from modelCoeffs], Cb1 0.1355,
    //  Cb2 0.622, Cw1 0.3 [canonical USER INPUT — NOT derived
    //  from Cb1 / kappa^2 + (1+Cb2) / sigmaNut ≈ 0.281 per
    //  OpenFOAM's SpalartAllmaras.C source, which explicitly
    //  reads from modelCoeffs.Cw1], Cw2 0.3 [SA-wall-damping
    //  secondary coefficient — V1.22 shares this value with the
    //  OpenFOAM 2.4.x independent re-tuning], Cw3 2.0 [Pirzadeh
    //  cubic-ramp limiter], Cv1 7.1, Cv2 5.0). Parallel slot to
    //  V1.20's `turbulenceCoefficients` (kEpsilon) and V1.21's
    //  `turbulenceCoefficientsKOmegaSST`. The form only renders
    //  this row when the user picks SpalartAllmaras; values stay
    //  dormant otherwise. Defaults match all 5 SOLVER_CONTROLS_DEFAULTS
    //  entries for the same symmetry reason as V1.20/V1.21. The 5
    //  tripped-SAFvOptions coefficients (At, Bt, ct1, ct2, ct3,
    //  ct4) are intentionally absent — they require an
    //  fvOptions::trippedSA entry that the form doesn't surface
    //  yet (same precedent as V1.21's `a1` deferral for limitK).
    turbulenceCoefficientsSpalartAllmaras: { sigmaNut: 0.667, kappa: 0.41, Cb1: 0.1355, Cb2: 0.622, Cw1: 0.3, Cw2: 0.06, Cw3: 2.0, Cv1: 7.1, Cv2: 5.0 },
    // V1.23 — LES sub-grid-scale coefficient seed (OpenFOAM stock
    //  Smagorinsky 1963 / Lilly 1967 / Nicoud+Ducros 1999 stems:
    //  C_s 0.2, C_w 0.325).
    //  Fourth sibling to V1.20's `turbulenceCoefficients` (kEpsilon),
    //  V1.21's `turbulenceCoefficientsKOmegaSST` (kOmegaSST), and
    //  V1.22's `turbulenceCoefficientsSpalartAllmaras`. The form
    //  only renders this row when the user picks Smagorinsky or WALE;
    //  values stay dormant otherwise. Single-schema design (one
    //  LESCoefficientsSchema holding both C_s and C_w) keeps the
    //  parallel slot count to one entry per turbulence-model family,
    //  mirroring the V1.20-V1.22 kEpsilon / kOmegaSST / SA siblings'
    //  per-model schema pattern. Defaults match all 5
    //  SOLVER_CONTROLS_DEFAULTS entries for the same symmetry reason
    //  as V1.20/V1.21/V1.22. Other LES variants (kEqn,
    //  dynamicSmagorinsky, dynamicLagrangian, SpalartAllmarasDES)
    //  are deferred to a future V.x.
    turbulenceCoefficientsLES: { Cs: 0.2, Cw: 0.325 },
    // V1.24 — k-equation LES coefficient seed (OpenFOAM stock
    //  Germano 1991 / Lilly 1967: C_k 0.094, C_e1 1.048, C_e2 1.048).
    //  5th sibling to V1.20–V1.23 RANS / LES slots; one slot per
    //  LES family. The form only renders this row when the user
    //  picks kEqn; values stay dormant otherwise. Same default
    //  across all 5 SOLVER_CONTROLS_DEFAULTS entries for the
    //  symmetry reason as V1.20/V1.21/V1.22/V1.23. Other LES
    //  variants (dynamicSmagorinsky / dynamicLagrangian /
    //  SpalartAllmarasDES / kOmegaSSTDES) deferred to V1.25 /
    //  V1.26 — dynamic variants have no user-tunable coefficients
    //  (model derives Cs dynamically from the resolved field),
    //  and DES variants need a separate alpha-blending slot.
    turbulenceCoefficientsKEqn: { Ck: 0.094, Ce1: 1.048, Ce2: 1.048 },
    // V1.25 -- DES shielding coefficient seed (OpenFOAM stock 0.65
    //  per Shur + Spalart + Strelets 2008). Used by the
    //  kOmegaSSTDES variant only (SpalartAllmarasDES re-uses SA's
    //  9-coefficient slot verbatim; the dynamic-Smagorinsky /
    //  dynamic-Lagrangian pair runs a runtime test-filter
    //  dynamic procedure with no user coefficients). 5th
    //  parallel-slot sibling to V1.20's turbulenceCoefficients
    //  (kEpsilon), V1.21's turbulenceCoefficientsKOmegaSST, V1.22's
    //  turbulenceCoefficientsSpalartAllmaras, V1.23's
    //  turbulenceCoefficientsLES, and V1.24's
    //  turbulenceCoefficientsKEqn.
    turbulenceCoefficientsCDES: { CDES: 0.65 },
  },
  simpleFoam: {
    solver: "simpleFoam",
    turbulence: "laminar",
    deltaT: 1,
    writeInterval: 50,
    purgeWrite: 5,
    endTime: 500,
    cores: 4,
    nu: 1e-5,
    initialConditions: { velocity: { x: 0, y: 0, z: 0 }, pressure: 0 },
    // V1.8 — steady solver: tighter threshold (1e-4) and longer streak (200).
    converge: { enabled: true, maxInitialResidual: 1e-4, stableIterations: 200, autoStop: false },
    // V1.9 — SIMPLE has no outer/corrector loop, just nNonOrth + residual
    //  tolerance. residualControl drives the per-field target values in
    //  fvSolution's residualControl block (1e-4 is the OpenFOAM built-in
    //  default and matches the V1.8-era hard-coded template).
    numerics: { enabled: true, nNonOrthogonalCorrectors: 0, nCorrectors: 2, nOuterCorrectors: 1, residualControl: '1e-4', residualControlByField: {} },
    // V1.11 — SIMPLE solver. OpenFOAM built-in defaults (p=0.3, U=0.7)
    //  are baked into the template fallback so empty overrides render
    //  identically; the user can dial p tighter or relaxer via the
    //  Build Case form's "Relaxation factors" details.
    relaxationFactors: { enabled: false, fields: { p: 0.3 }, equations: { U: 0.7 } },
    // V1.19 — adaptiveTimeStep mirror of OpenFOAM stock for SIMPLE-family
    //  solvers (simpleFoam/buoyantSimpleFoam/potentialFoam). Toggle off
    //  by default; OpenFOAM ignores the field entirely for steady
    //  algorithms so the value is dormant (case.ts precomputes
    //  `emitAdaptiveTimeStep` to short-circuit the controlDict template).
    adaptiveTimeStep: { enabled: false, maxCo: 1 },
    // V1.12 — SIMPLE-family steady solver. ddtDefault MUST be
    //  `steadyState` — SIMPLE algorithms are steady-state by
    //  definition, so emitting `Euler` would produce a pointless time
    //  loop. Spatial schemes retain OpenFOAM stock choices.
    // V1.15 — `interpolationDefault: 'linear'` and `snGradDefault:
    //  'corrected'` are solver-agnostic, so they ride on the same
    //  OpenFOAM stock values as the V1.12 spatial selectors.
    // V1.16 — `fieldLaplacians: {}` seeds the per-field laplacian
    //  override map (all five SOLVER_CONTROLS_DEFAULTS entries use
    //  the same empty starting state; the fvSchemes.hbs `{{or override
    //  "Gauss linear corrected"}}` helpers fall back to the
    //  laplacianDefault value at render time).
    // V1.17 — `fieldSnGrads: {}` seeds the per-field snGrad override
    //  map (all five SOLVER_CONTROLS_DEFAULTS entries use the same
    //  empty starting state; fvSchemes.hbs `{{or override "corrected"}}`
    //  helper falls back to the snGradDefault value at render time).
    schemes: { ddtDefault: 'steadyState', gradDefault: 'Gauss linear', divDefault: 'none', laplacianDefault: 'Gauss linear corrected', interpolationDefault: 'linear', snGradDefault: 'corrected', fieldDivs: {}, fieldLaplacians: {}, fieldSnGrads: {} },
    solverConfigs: { p: { solver: 'GAMG', tolerance: 1e-7, relTol: 0.01 }, U: { solver: 'smoothSolver', tolerance: 1e-7, relTol: 0.1 }, turbulence: { solver: 'smoothSolver', tolerance: 1e-7, relTol: 0.1 } },
    // V1.20 — k-ε turbulence-coefficient seed (OpenFOAM stock
    //  Cmu 0.09, C1 1.44, C2 1.92, sigmak 1.0, sigmaEps 1.3). Same
    //  default across all 5 SOLVER_CONTROLS_DEFAULTS entries
    //  because (a) the seed is solver-agnostic — flipping
    //  solver/turbulence just keeps the values dormant until the
    //  user picks kEpsilon — and (b) keeping matching seeds across
    //  5 entries means flipping back to a previous solver restores
    //  any kEpsilon-tuning the user did before.
    turbulenceCoefficients: { Cmu: 0.09, C1: 1.44, C2: 1.92, sigmak: 1.0, sigmaEps: 1.3 },
    // V1.21 — k-ω SST coefficient seed (OpenFOAM stock Menter 2009
    //  values: alphaK1 0.85, alphaK2 1.0, alphaOmega1 0.5,
    //  alphaOmega2 0.856, beta1 0.075, beta2 0.0828, betaStar 0.09,
    //  C1 2.0, gamma1 5/9, gamma2 7/8, sigmaK 0.6, sigmaOmega 0.5).
    //  Parallel slot to V1.20's `turbulenceCoefficients` (kEpsilon);
    //  the form only renders this row when the user picks kOmegaSST,
    //  so the values stay dormant otherwise. Defaults match all 5
    //  SOLVER_CONTROLS_DEFAULTS entries for the same symmetry reason
    //  as V1.20's kEpsilon slot. a1 (the Menter limiter) is
    //  intentionally absent — see KOmegegaSSTCoefficientsSchema
    //  comment; SpalartAllmaras coefficients are V1.22.
    turbulenceCoefficientsKOmegaSST: { alphaK1: 0.85, alphaK2: 1.0, alphaOmega1: 0.5, alphaOmega2: 0.856, beta1: 0.075, beta2: 0.0828, betaStar: 0.09, C1: 2.0, gamma1: 0.5555555555, gamma2: 0.875, sigmaK: 0.6, sigmaOmega: 0.5 },
    // V1.22 — Spalart-Allmaras coefficient seed. OpenFOAM stock
    //  (1994 + Pirzadeh 1999 cubic ramp: sigmaNut 0.667 = 2/3,
    //  kappa 0.41 [von Kármán, RANS-universal but OpenFOAM's
    //  SpalartAllmaras.C reads it from modelCoeffs], Cb1 0.1355,
    //  Cb2 0.622, Cw1 0.3 [canonical USER INPUT — NOT derived
    //  from Cb1 / kappa^2 + (1+Cb2) / sigmaNut ≈ 0.281 per
    //  OpenFOAM's SpalartAllmaras.C source, which explicitly
    //  reads from modelCoeffs.Cw1], Cw2 0.3 [SA-wall-damping
    //  secondary coefficient — V1.22 shares this value with the
    //  OpenFOAM 2.4.x independent re-tuning], Cw3 2.0 [Pirzadeh
    //  cubic-ramp limiter], Cv1 7.1, Cv2 5.0). Parallel slot to
    //  V1.20's `turbulenceCoefficients` (kEpsilon) and V1.21's
    //  `turbulenceCoefficientsKOmegaSST`. The form only renders
    //  this row when the user picks SpalartAllmaras; values stay
    //  dormant otherwise. Defaults match all 5 SOLVER_CONTROLS_DEFAULTS
    //  entries for the same symmetry reason as V1.20/V1.21. The 5
    //  tripped-SAFvOptions coefficients (At, Bt, ct1, ct2, ct3,
    //  ct4) are intentionally absent — they require an
    //  fvOptions::trippedSA entry that the form doesn't surface
    //  yet (same precedent as V1.21's `a1` deferral for limitK).
    turbulenceCoefficientsSpalartAllmaras: { sigmaNut: 0.667, kappa: 0.41, Cb1: 0.1355, Cb2: 0.622, Cw1: 0.3, Cw2: 0.06, Cw3: 2.0, Cv1: 7.1, Cv2: 5.0 },
    // V1.23 — LES sub-grid-scale coefficient seed (OpenFOAM stock
    //  Smagorinsky 1963 / Lilly 1967 / Nicoud+Ducros 1999 stems:
    //  C_s 0.2, C_w 0.325).
    //  Fourth sibling to V1.20's `turbulenceCoefficients` (kEpsilon),
    //  V1.21's `turbulenceCoefficientsKOmegaSST` (kOmegaSST), and
    //  V1.22's `turbulenceCoefficientsSpalartAllmaras`. The form
    //  only renders this row when the user picks Smagorinsky or WALE;
    //  values stay dormant otherwise. Single-schema design (one
    //  LESCoefficientsSchema holding both C_s and C_w) keeps the
    //  parallel slot count to one entry per turbulence-model family,
    //  mirroring the V1.20-V1.22 kEpsilon / kOmegaSST / SA siblings'
    //  per-model schema pattern. Defaults match all 5
    //  SOLVER_CONTROLS_DEFAULTS entries for the same symmetry reason
    //  as V1.20/V1.21/V1.22. Other LES variants (kEqn,
    //  dynamicSmagorinsky, dynamicLagrangian, SpalartAllmarasDES)
    //  are deferred to a future V.x.
    turbulenceCoefficientsLES: { Cs: 0.2, Cw: 0.325 },
    // V1.24 — k-equation LES coefficient seed (OpenFOAM stock
    //  Germano 1991 / Lilly 1967: C_k 0.094, C_e1 1.048, C_e2 1.048).
    //  5th sibling to V1.20–V1.23 RANS / LES slots; one slot per
    //  LES family. The form only renders this row when the user
    //  picks kEqn; values stay dormant otherwise. Same default
    //  across all 5 SOLVER_CONTROLS_DEFAULTS entries for the
    //  symmetry reason as V1.20/V1.21/V1.22/V1.23. Other LES
    //  variants (dynamicSmagorinsky / dynamicLagrangian /
    //  SpalartAllmarasDES / kOmegaSSTDES) deferred to V1.25 /
    //  V1.26 — dynamic variants have no user-tunable coefficients
    //  (model derives Cs dynamically from the resolved field),
    //  and DES variants need a separate alpha-blending slot.
    turbulenceCoefficientsKEqn: { Ck: 0.094, Ce1: 1.048, Ce2: 1.048 },
    // V1.25 -- DES shielding coefficient seed (OpenFOAM stock 0.65
    //  per Shur + Spalart + Strelets 2008). Used by the
    //  kOmegaSSTDES variant only (SpalartAllmarasDES re-uses SA's
    //  9-coefficient slot verbatim; the dynamic-Smagorinsky /
    //  dynamic-Lagrangian pair runs a runtime test-filter
    //  dynamic procedure with no user coefficients). 5th
    //  parallel-slot sibling to V1.20's turbulenceCoefficients
    //  (kEpsilon), V1.21's turbulenceCoefficientsKOmegaSST, V1.22's
    //  turbulenceCoefficientsSpalartAllmaras, V1.23's
    //  turbulenceCoefficientsLES, and V1.24's
    //  turbulenceCoefficientsKEqn.
    turbulenceCoefficientsCDES: { CDES: 0.65 },
  },
  pimpleFoam: {
    // V1.9 — pimpleFoam is the only transient solver in the set, and
    //  viscous high-skew meshes converge faster with a couple of outer
    //  sweeps. We bump `nOuterCorrectors` from the schema default (1)
    //  to 2 here so a fresh build of a pimpleFoam case doesn't have
    //  to remember to dial it up. The user can still override per-
    //  solver via the Build Case form.
    numerics: { enabled: true, nNonOrthogonalCorrectors: 0, nCorrectors: 2, nOuterCorrectors: 2, residualControl: '1e-4', residualControlByField: {} },
    // V1.11 — PIMPLE solver. OpenFOAM PIMPLE can opt into
    //  relaxationFactors (typically when nOuterCorrectors>1), but the
    //  V1.10-era template didn't emit a block. Empty here preserves
    //  the no-block path; future V.x can flip a per-solver "enable"
    //  toggle to expose the PIMPLE inner under-relaxation knobs.
    relaxationFactors: { enabled: false, fields: {}, equations: {} },
    // V1.19 — adaptiveTimeStep mirror of OpenFOAM stock (transient
    //  solvers, toggle off by default). Same shape as icoFoam's
    //  seed above (PIMPLE is transient so the Boolean is observable
    //  on the form rather than dormant).
    adaptiveTimeStep: { enabled: false, maxCo: 1 },
    // V1.12 — PIMPLE is transient (the only transient solver in the
    //  set besides icoFoam), so ddtDefault stays `Euler`. Spatial
    //  schemes keep OpenFOAM stock defaults.
    // V1.15 — interpolation/snGrad stock values, solver-agnostic.
    // V1.16 — fieldLaplacians stock values (V1.16's per-field
    //  laplacian override UI is solver-agnostic; one empty seed works
    //  for all five SOLVER_CONTROLS_DEFAULTS entries).
    // V1.17 — fieldSnGrads stock values, solver-agnostic.
    schemes: { ddtDefault: 'Euler', gradDefault: 'Gauss linear', divDefault: 'none', laplacianDefault: 'Gauss linear corrected', interpolationDefault: 'linear', snGradDefault: 'corrected', fieldDivs: {}, fieldLaplacians: {}, fieldSnGrads: {} },
    solverConfigs: { p: { solver: 'GAMG', tolerance: 1e-7, relTol: 0.01 }, U: { solver: 'smoothSolver', tolerance: 1e-7, relTol: 0.1 }, turbulence: { solver: 'smoothSolver', tolerance: 1e-7, relTol: 0.1 } },
    // V1.20 — k-ε turbulence-coefficient seed (OpenFOAM stock
    //  Cmu 0.09, C1 1.44, C2 1.92, sigmak 1.0, sigmaEps 1.3). Same
    //  default across all 5 SOLVER_CONTROLS_DEFAULTS entries
    //  because (a) the seed is solver-agnostic — flipping
    //  solver/turbulence just keeps the values dormant until the
    //  user picks kEpsilon — and (b) keeping matching seeds across
    //  5 entries means flipping back to a previous solver restores
    //  any kEpsilon-tuning the user did before.
    turbulenceCoefficients: { Cmu: 0.09, C1: 1.44, C2: 1.92, sigmak: 1.0, sigmaEps: 1.3 },
    // V1.21 — k-ω SST coefficient seed (OpenFOAM stock Menter 2009
    //  values: alphaK1 0.85, alphaK2 1.0, alphaOmega1 0.5,
    //  alphaOmega2 0.856, beta1 0.075, beta2 0.0828, betaStar 0.09,
    //  C1 2.0, gamma1 5/9, gamma2 7/8, sigmaK 0.6, sigmaOmega 0.5).
    //  Parallel slot to V1.20's `turbulenceCoefficients` (kEpsilon);
    //  the form only renders this row when the user picks kOmegaSST,
    //  so the values stay dormant otherwise. Defaults match all 5
    //  SOLVER_CONTROLS_DEFAULTS entries for the same symmetry reason
    //  as V1.20's kEpsilon slot. a1 (the Menter limiter) is
    //  intentionally absent — see KOmegegaSSTCoefficientsSchema
    //  comment; SpalartAllmaras coefficients are V1.22.
    turbulenceCoefficientsKOmegaSST: { alphaK1: 0.85, alphaK2: 1.0, alphaOmega1: 0.5, alphaOmega2: 0.856, beta1: 0.075, beta2: 0.0828, betaStar: 0.09, C1: 2.0, gamma1: 0.5555555555, gamma2: 0.875, sigmaK: 0.6, sigmaOmega: 0.5 },
    turbulenceCoefficientsSpalartAllmaras: { sigmaNut: 0.667, kappa: 0.41, Cb1: 0.1355, Cb2: 0.622, Cw1: 0.3, Cw2: 0.06, Cw3: 2.0, Cv1: 7.1, Cv2: 5.0 },
    turbulenceCoefficientsLES: { Cs: 0.2, Cw: 0.325 },
    turbulenceCoefficientsKEqn: { Ck: 0.094, Ce1: 1.048, Ce2: 1.048 },
    turbulenceCoefficientsCDES: { CDES: 0.65 },
    solver: "pimpleFoam",
    turbulence: "laminar",
    deltaT: 1e-4,
    writeInterval: 10,
    purgeWrite: 5,
    endTime: 1,
    cores: 4,
    nu: 1e-5,
    initialConditions: { velocity: { x: 0, y: 0, z: 0 }, pressure: 0 },
    // V1.8 — transient solver: same threshold/streak as icoFoam.
    converge: { enabled: true, maxInitialResidual: 1e-3, stableIterations: 50, autoStop: false },
  },
  potentialFoam: {
    solver: "potentialFoam",
    turbulence: "laminar",
    deltaT: 1,
    writeInterval: 5,
    purgeWrite: 0,
    endTime: 10,
    cores: 4,
    nu: 1e-5,
    // V1.7 — potentialFoam IS a preconditioner; default to a freestream so
    //  users get a useful starting field for typical external-flow cases
    //  without having to overwrite the field in the UI.
    initialConditions: { velocity: { x: 1, y: 0, z: 0 }, pressure: 0 },
    // V1.8 — potentialFoam runs a fixed end-time to converge the pressure
    //  field; it doesn't converge "in the steady sense". Detector disabled
    //  by default — users who really want it can opt in via PatchPanel.
    converge: { enabled: false, maxInitialResidual: 1e-3, stableIterations: 50, autoStop: false },
    // V1.9 — potentialFoam uses PISO-style corrector counts; the
    //  residualControl tolerance is irrelevant (the algorithm doesn't
    //  emit a SIMPLE-style residualControl block) so the value is just
    //  carried verbatim for symmetry with the other solvers' shape.
    numerics: { enabled: true, nNonOrthogonalCorrectors: 0, nCorrectors: 2, nOuterCorrectors: 1, residualControl: '1e-4', residualControlByField: {} },
    // V1.11 — potentialFoam runs PISO-style correctors on a SIMPLE-like
    //  outer sweep; OpenFOAM's built-in defaults for the SIMPLE shape
    //  apply here (p=0.3, U=0.7). Empty overrides render identically.
    relaxationFactors: { enabled: false, fields: { p: 0.3 }, equations: { U: 0.7 } },
    // V1.19 — adaptiveTimeStep mirror of OpenFOAM stock for SIMPLE-family
    //  solvers (simpleFoam/buoyantSimpleFoam/potentialFoam). Toggle off
    //  by default; OpenFOAM ignores the field entirely for steady
    //  algorithms so the value is dormant (case.ts precomputes
    //  `emitAdaptiveTimeStep` to short-circuit the controlDict template).
    adaptiveTimeStep: { enabled: false, maxCo: 1 },
    // V1.12 — potentialFoam is a steady-state preconditioner
    //  (potential flow), so ddtDefault stays `steadyState`.
    // V1.15 — interpolation/snGrad stock values, solver-agnostic.
    // V1.16 — fieldLaplacians stock values, solver-agnostic.
    // V1.17 — fieldSnGrads stock values, solver-agnostic.
    schemes: { ddtDefault: 'steadyState', gradDefault: 'Gauss linear', divDefault: 'none', laplacianDefault: 'Gauss linear corrected', interpolationDefault: 'linear', snGradDefault: 'corrected', fieldDivs: {}, fieldLaplacians: {}, fieldSnGrads: {} },
    solverConfigs: { p: { solver: 'GAMG', tolerance: 1e-7, relTol: 0.01 }, U: { solver: 'smoothSolver', tolerance: 1e-7, relTol: 0.1 }, turbulence: { solver: 'smoothSolver', tolerance: 1e-7, relTol: 0.1 } },
    // V1.20 — k-ε turbulence-coefficient seed (OpenFOAM stock
    //  Cmu 0.09, C1 1.44, C2 1.92, sigmak 1.0, sigmaEps 1.3). Same
    //  default across all 5 SOLVER_CONTROLS_DEFAULTS entries
    //  because (a) the seed is solver-agnostic — flipping
    //  solver/turbulence just keeps the values dormant until the
    //  user picks kEpsilon — and (b) keeping matching seeds across
    //  5 entries means flipping back to a previous solver restores
    //  any kEpsilon-tuning the user did before.
    turbulenceCoefficients: { Cmu: 0.09, C1: 1.44, C2: 1.92, sigmak: 1.0, sigmaEps: 1.3 },
    // V1.21 — k-ω SST coefficient seed (OpenFOAM stock Menter 2009
    //  values: alphaK1 0.85, alphaK2 1.0, alphaOmega1 0.5,
    //  alphaOmega2 0.856, beta1 0.075, beta2 0.0828, betaStar 0.09,
    //  C1 2.0, gamma1 5/9, gamma2 7/8, sigmaK 0.6, sigmaOmega 0.5).
    //  Parallel slot to V1.20's `turbulenceCoefficients` (kEpsilon);
    //  the form only renders this row when the user picks kOmegaSST,
    //  so the values stay dormant otherwise. Defaults match all 5
    //  SOLVER_CONTROLS_DEFAULTS entries for the same symmetry reason
    //  as V1.20's kEpsilon slot. a1 (the Menter limiter) is
    //  intentionally absent — see KOmegegaSSTCoefficientsSchema
    //  comment; SpalartAllmaras coefficients are V1.22.
    turbulenceCoefficientsKOmegaSST: { alphaK1: 0.85, alphaK2: 1.0, alphaOmega1: 0.5, alphaOmega2: 0.856, beta1: 0.075, beta2: 0.0828, betaStar: 0.09, C1: 2.0, gamma1: 0.5555555555, gamma2: 0.875, sigmaK: 0.6, sigmaOmega: 0.5 },
    // V1.22 — Spalart-Allmaras coefficient seed. OpenFOAM stock
    //  (1994 + Pirzadeh 1999 cubic ramp: sigmaNut 0.667 = 2/3,
    //  kappa 0.41 [von Kármán, RANS-universal but OpenFOAM's
    //  SpalartAllmaras.C reads it from modelCoeffs], Cb1 0.1355,
    //  Cb2 0.622, Cw1 0.3 [canonical USER INPUT — NOT derived
    //  from Cb1 / kappa^2 + (1+Cb2) / sigmaNut ≈ 0.281 per
    //  OpenFOAM's SpalartAllmaras.C source, which explicitly
    //  reads from modelCoeffs.Cw1], Cw2 0.3 [SA-wall-damping
    //  secondary coefficient — V1.22 shares this value with the
    //  OpenFOAM 2.4.x independent re-tuning], Cw3 2.0 [Pirzadeh
    //  cubic-ramp limiter], Cv1 7.1, Cv2 5.0). Parallel slot to
    //  V1.20's `turbulenceCoefficients` (kEpsilon) and V1.21's
    //  `turbulenceCoefficientsKOmegaSST`. The form only renders
    //  this row when the user picks SpalartAllmaras; values stay
    //  dormant otherwise. Defaults match all 5 SOLVER_CONTROLS_DEFAULTS
    //  entries for the same symmetry reason as V1.20/V1.21. The 5
    //  tripped-SAFvOptions coefficients (At, Bt, ct1, ct2, ct3,
    //  ct4) are intentionally absent — they require an
    //  fvOptions::trippedSA entry that the form doesn't surface
    //  yet (same precedent as V1.21's `a1` deferral for limitK).
    turbulenceCoefficientsSpalartAllmaras: { sigmaNut: 0.667, kappa: 0.41, Cb1: 0.1355, Cb2: 0.622, Cw1: 0.3, Cw2: 0.06, Cw3: 2.0, Cv1: 7.1, Cv2: 5.0 },
    // V1.23 — LES sub-grid-scale coefficient seed (OpenFOAM stock
    //  Smagorinsky 1963 / Lilly 1967 / Nicoud+Ducros 1999 stems:
    //  C_s 0.2, C_w 0.325).
    //  Fourth sibling to V1.20's `turbulenceCoefficients` (kEpsilon),
    //  V1.21's `turbulenceCoefficientsKOmegaSST` (kOmegaSST), and
    //  V1.22's `turbulenceCoefficientsSpalartAllmaras`. The form
    //  only renders this row when the user picks Smagorinsky or WALE;
    //  values stay dormant otherwise. Single-schema design (one
    //  LESCoefficientsSchema holding both C_s and C_w) keeps the
    //  parallel slot count to one entry per turbulence-model family,
    //  mirroring the V1.20-V1.22 kEpsilon / kOmegaSST / SA siblings'
    //  per-model schema pattern. Defaults match all 5
    //  SOLVER_CONTROLS_DEFAULTS entries for the same symmetry reason
    //  as V1.20/V1.21/V1.22. Other LES variants (kEqn,
    //  dynamicSmagorinsky, dynamicLagrangian, SpalartAllmarasDES)
    //  are deferred to a future V.x.
    turbulenceCoefficientsLES: { Cs: 0.2, Cw: 0.325 },
    // V1.24 — k-equation LES coefficient seed (OpenFOAM stock
    //  Germano 1991 / Lilly 1967: C_k 0.094, C_e1 1.048, C_e2 1.048).
    //  5th sibling to V1.20–V1.23 RANS / LES slots; one slot per
    //  LES family. The form only renders this row when the user
    //  picks kEqn; values stay dormant otherwise. Same default
    //  across all 5 SOLVER_CONTROLS_DEFAULTS entries for the
    //  symmetry reason as V1.20/V1.21/V1.22/V1.23. Other LES
    //  variants (dynamicSmagorinsky / dynamicLagrangian /
    //  SpalartAllmarasDES / kOmegaSSTDES) deferred to V1.25 /
    //  V1.26 — dynamic variants have no user-tunable coefficients
    //  (model derives Cs dynamically from the resolved field),
    //  and DES variants need a separate alpha-blending slot.
    turbulenceCoefficientsKEqn: { Ck: 0.094, Ce1: 1.048, Ce2: 1.048 },
    // V1.25 -- DES shielding coefficient seed (OpenFOAM stock 0.65
    //  per Shur + Spalart + Strelets 2008). Used by the
    //  kOmegaSSTDES variant only (SpalartAllmarasDES re-uses SA's
    //  9-coefficient slot verbatim; the dynamic-Smagorinsky /
    //  dynamic-Lagrangian pair runs a runtime test-filter
    //  dynamic procedure with no user coefficients). 5th
    //  parallel-slot sibling to V1.20's turbulenceCoefficients
    //  (kEpsilon), V1.21's turbulenceCoefficientsKOmegaSST, V1.22's
    //  turbulenceCoefficientsSpalartAllmaras, V1.23's
    //  turbulenceCoefficientsLES, and V1.24's
    //  turbulenceCoefficientsKEqn.
    turbulenceCoefficientsCDES: { CDES: 0.65 },
  },
  buoyantSimpleFoam: {
    solver: "buoyantSimpleFoam",
    turbulence: "laminar",
    deltaT: 1,
    writeInterval: 50,
    purgeWrite: 5,
    endTime: 200,
    cores: 4,
    nu: 1e-5,
    initialConditions: { velocity: { x: 0, y: 0, z: 0 }, pressure: 0 },
    // V1.8 — steady solver: tighter threshold (1e-4), longer streak (200).
    converge: { enabled: true, maxInitialResidual: 1e-4, stableIterations: 200, autoStop: false },
    // V1.9 — SIMPLE-style (no outer/corrector loop). residualControl=1e-4
    //  matches simpleFoam; the same tolerance applies to the energy
    //  field (T) implied by buoyantSimpleFoam, even though the user's
    //  template only emits p/U/(k|epsilon|omega|nuTilda) keys today.
    numerics: { enabled: true, nNonOrthogonalCorrectors: 0, nCorrectors: 2, nOuterCorrectors: 1, residualControl: '1e-4', residualControlByField: {} },
    relaxationFactors: { enabled: false, fields: { p: 0.3, T: 0.7 }, equations: { U: 0.7 } },
    adaptiveTimeStep: { enabled: false, maxCo: 1 },
    // V1.12 — buoyantSimpleFoam is steady + carries an energy field T.
    //  ddtDefault MUST be `steadyState`. Spatial schemes stock.
    // V1.15 — interpolation/snGrad stock values, solver-agnostic.
    // V1.16 — fieldLaplacians stock values, solver-agnostic.
    // V1.17 — fieldSnGrads stock values, solver-agnostic.
    schemes: { ddtDefault: 'steadyState', gradDefault: 'Gauss linear', divDefault: 'none', laplacianDefault: 'Gauss linear corrected', interpolationDefault: 'linear', snGradDefault: 'corrected', fieldDivs: {}, fieldLaplacians: {}, fieldSnGrads: {} },
    solverConfigs: { p: { solver: 'GAMG', tolerance: 1e-7, relTol: 0.01 }, U: { solver: 'smoothSolver', tolerance: 1e-7, relTol: 0.1 }, turbulence: { solver: 'smoothSolver', tolerance: 1e-7, relTol: 0.1 } },
    // V1.20 — k-ε turbulence-coefficient seed (OpenFOAM stock
    //  Cmu 0.09, C1 1.44, C2 1.92, sigmak 1.0, sigmaEps 1.3). Same
    //  default across all 5 SOLVER_CONTROLS_DEFAULTS entries
    //  because (a) the seed is solver-agnostic — flipping
    //  solver/turbulence just keeps the values dormant until the
    //  user picks kEpsilon — and (b) keeping matching seeds across
    //  5 entries means flipping back to a previous solver restores
    //  any kEpsilon-tuning the user did before.
    turbulenceCoefficients: { Cmu: 0.09, C1: 1.44, C2: 1.92, sigmak: 1.0, sigmaEps: 1.3 },
    // V1.21 — k-ω SST coefficient seed (OpenFOAM stock Menter 2009
    //  values: alphaK1 0.85, alphaK2 1.0, alphaOmega1 0.5,
    //  alphaOmega2 0.856, beta1 0.075, beta2 0.0828, betaStar 0.09,
    //  C1 2.0, gamma1 5/9, gamma2 7/8, sigmaK 0.6, sigmaOmega 0.5).
    //  Parallel slot to V1.20's `turbulenceCoefficients` (kEpsilon);
    //  the form only renders this row when the user picks kOmegaSST,
    //  so the values stay dormant otherwise. Defaults match all 5
    //  SOLVER_CONTROLS_DEFAULTS entries for the same symmetry reason
    //  as V1.20's kEpsilon slot. a1 (the Menter limiter) is
    //  intentionally absent — see KOmegegaSSTCoefficientsSchema
    //  comment; SpalartAllmaras coefficients are V1.22.
    turbulenceCoefficientsKOmegaSST: { alphaK1: 0.85, alphaK2: 1.0, alphaOmega1: 0.5, alphaOmega2: 0.856, beta1: 0.075, beta2: 0.0828, betaStar: 0.09, C1: 2.0, gamma1: 0.5555555555, gamma2: 0.875, sigmaK: 0.6, sigmaOmega: 0.5 },
    // V1.22 — Spalart-Allmaras coefficient seed. OpenFOAM stock
    //  (1994 + Pirzadeh 1999 cubic ramp: sigmaNut 0.667 = 2/3,
    //  kappa 0.41 [von Kármán, RANS-universal but OpenFOAM's
    //  SpalartAllmaras.C reads it from modelCoeffs], Cb1 0.1355,
    //  Cb2 0.622, Cw1 0.3 [canonical USER INPUT — NOT derived
    //  from Cb1 / kappa^2 + (1+Cb2) / sigmaNut ≈ 0.281 per
    //  OpenFOAM's SpalartAllmaras.C source, which explicitly
    //  reads from modelCoeffs.Cw1], Cw2 0.3 [SA-wall-damping
    //  secondary coefficient — V1.22 shares this value with the
    //  OpenFOAM 2.4.x independent re-tuning], Cw3 2.0 [Pirzadeh
    //  cubic-ramp limiter], Cv1 7.1, Cv2 5.0). Parallel slot to
    //  V1.20's `turbulenceCoefficients` (kEpsilon) and V1.21's
    //  `turbulenceCoefficientsKOmegaSST`. The form only renders
    //  this row when the user picks SpalartAllmaras; values stay
    //  dormant otherwise. Defaults match all 5 SOLVER_CONTROLS_DEFAULTS
    //  entries for the same symmetry reason as V1.20/V1.21. The 5
    //  tripped-SAFvOptions coefficients (At, Bt, ct1, ct2, ct3,
    //  ct4) are intentionally absent — they require an
    //  fvOptions::trippedSA entry that the form doesn't surface
    //  yet (same precedent as V1.21's `a1` deferral for limitK).
    turbulenceCoefficientsSpalartAllmaras: { sigmaNut: 0.667, kappa: 0.41, Cb1: 0.1355, Cb2: 0.622, Cw1: 0.3, Cw2: 0.06, Cw3: 2.0, Cv1: 7.1, Cv2: 5.0 },
    // V1.23 — LES sub-grid-scale coefficient seed (OpenFOAM stock
    //  Smagorinsky 1963 / Lilly 1967 / Nicoud+Ducros 1999 stems:
    //  C_s 0.2, C_w 0.325).
    //  Fourth sibling to V1.20's `turbulenceCoefficients` (kEpsilon),
    //  V1.21's `turbulenceCoefficientsKOmegaSST` (kOmegaSST), and
    //  V1.22's `turbulenceCoefficientsSpalartAllmaras`. The form
    //  only renders this row when the user picks Smagorinsky or WALE;
    //  values stay dormant otherwise. Single-schema design (one
    //  LESCoefficientsSchema holding both C_s and C_w) keeps the
    //  parallel slot count to one entry per turbulence-model family,
    //  mirroring the V1.20-V1.22 kEpsilon / kOmegaSST / SA siblings'
    //  per-model schema pattern. Defaults match all 5
    //  SOLVER_CONTROLS_DEFAULTS entries for the same symmetry reason
    //  as V1.20/V1.21/V1.22. Other LES variants (kEqn,
    //  dynamicSmagorinsky, dynamicLagrangian, SpalartAllmarasDES)
    //  are deferred to a future V.x.
    turbulenceCoefficientsLES: { Cs: 0.2, Cw: 0.325 },
    // V1.24 — k-equation LES coefficient seed (OpenFOAM stock
    //  Germano 1991 / Lilly 1967: C_k 0.094, C_e1 1.048, C_e2 1.048).
    //  5th sibling to V1.20–V1.23 RANS / LES slots; one slot per
    //  LES family. The form only renders this row when the user
    //  picks kEqn; values stay dormant otherwise. Same default
    //  across all 5 SOLVER_CONTROLS_DEFAULTS entries for the
    //  symmetry reason as V1.20/V1.21/V1.22/V1.23. Other LES
    //  variants (dynamicSmagorinsky / dynamicLagrangian /
    //  SpalartAllmarasDES / kOmegaSSTDES) deferred to V1.25 /
    //  V1.26 — dynamic variants have no user-tunable coefficients
    //  (model derives Cs dynamically from the resolved field),
    //  and DES variants need a separate alpha-blending slot.
    turbulenceCoefficientsKEqn: { Ck: 0.094, Ce1: 1.048, Ce2: 1.048 },
    // V1.25 -- DES shielding coefficient seed (OpenFOAM stock 0.65
    //  per Shur + Spalart + Strelets 2008). Used by the
    //  kOmegaSSTDES variant only (SpalartAllmarasDES re-uses SA's
    //  9-coefficient slot verbatim; the dynamic-Smagorinsky /
    //  dynamic-Lagrangian pair runs a runtime test-filter
    //  dynamic procedure with no user coefficients). 5th
    //  parallel-slot sibling to V1.20's turbulenceCoefficients
    //  (kEpsilon), V1.21's turbulenceCoefficientsKOmegaSST, V1.22's
    //  turbulenceCoefficientsSpalartAllmaras, V1.23's
    //  turbulenceCoefficientsLES, and V1.24's
    //  turbulenceCoefficientsKEqn.
    turbulenceCoefficientsCDES: { CDES: 0.65 },
  },
};
}

export const useGeometryStore = create<State & Actions>((set, get) => ({
  ...initial,

  async pickAndLoad(format) {
    set({ status: { kind: "loading", message: `Picking ${format} file…` } });
    let picked: { path: string; bytes: Uint8Array } | null = null;
    try {
      picked = await window.cfd.geometry.pickAndRead(format);
    } catch (err) {
      set({ status: { kind: "error", message: `File picker failed: ${String(err)}` } });
      return;
    }
    if (!picked) {
      set({ status: { kind: "idle" } });
      return;
    }

    set({ status: { kind: "loading", message: `Loading ${picked.path}…` } });
    try {
      const prep =
        format === "STEP"
          ? await loadStepGeometry(picked.bytes, picked.path)
          : format === "IGES"
          ? await loadIgesGeometry(picked.bytes, picked.path)
          : await loadStlGeometry(picked.bytes, picked.path);
      const meta = toLoadedGeometry(prep);
      set({
        prep,
        selectedFaceIds: new Set<number>(),
        patches: [],
        status: {
          kind: "ready",
          message:
            `Loaded ${meta.format} · ${meta.faceCount} faces · ${meta.triangleCount} triangles ` +
            `· bbox ${meta.bbox.min.x.toFixed(3)},${meta.bbox.min.y.toFixed(3)},${meta.bbox.min.z.toFixed(3)}` +
            ` → ${meta.bbox.max.x.toFixed(3)},${meta.bbox.max.y.toFixed(3)},${meta.bbox.max.z.toFixed(3)}`,
        },
      });
    } catch (err) {
      set({ status: { kind: "error", message: `Failed to load geometry: ${String(err)}` } });
    }
  },

  toggleFace(faceIndex) {
    const next = new Set(get().selectedFaceIds);
    if (next.has(faceIndex)) next.delete(faceIndex);
    else next.add(faceIndex);
    set({ selectedFaceIds: next });
  },

  selectFace(faceIndex) {
    if (get().selectedFaceIds.has(faceIndex)) return;
    const next = new Set(get().selectedFaceIds);
    next.add(faceIndex);
    set({ selectedFaceIds: next });
  },

  deselectFace(faceIndex) {
    if (!get().selectedFaceIds.has(faceIndex)) return;
    const next = new Set(get().selectedFaceIds);
    next.delete(faceIndex);
    set({ selectedFaceIds: next });
  },

  clearSelection() {
    set({ selectedFaceIds: new Set<number>() });
  },

  createPatch(name) {
    const patch: GeometryPatch = {
      id: newPatchId(),
      name: name.trim() || `patch-${get().patches.length + 1}`,
      faceIndices: [],
      triangleCount: 0,
      lastExportedRelPath: null,
    };
    // V1.2 — seed BC defaults so a freshly-created patch already has a valid
    // entry in the BC table (noSlip wall for U, zeroGradient for p). The
    // user can override either from the BC editor before building the case.
    //
    // V1.4 — also seed a default refinement (0..2) so a freshly-created
    // patch has SOMETHING in the snappy refinementSurfaces block; this
    // matches the V1.4 default the thinker recommended.
    const cur = get();
    set({
      patches: [...cur.patches, patch],
      boundaryConditions: {
        velocity: { ...cur.boundaryConditions.velocity, [patch.name]: { type: "noSlip" } },
        pressure: { ...cur.boundaryConditions.pressure, [patch.name]: { type: "zeroGradient" } },
      },
      patchRefinements: {
        ...cur.patchRefinements,
        [patch.name]: { min: 0, max: 2 },
      },
    });
    return patch;
  },

  assignSelectionToPatch(patchId) {
    const sel = get().selectedFaceIds;
    if (sel.size === 0) return;
    const patches = get().patches.map((p) => {
      if (p.id !== patchId) return p;
      const merged = new Set<number>(p.faceIndices);
      for (const f of sel) merged.add(f);
      const arr = Array.from(merged).sort((a, b) => a - b);
      const prep = get().prep;
      const tc = prep ? triangleCountForFaces(prep, merged) : 0;
      return { ...p, faceIndices: arr, triangleCount: tc };
    });
    set({ patches });
  },

  setPatchFaces(patchId, faceIndices) {
    const sorted = Array.from(new Set(faceIndices)).sort((a, b) => a - b);
    const prep = get().prep;
    const tc = prep ? triangleCountForFaces(prep, new Set(sorted)) : 0;
    set({
      patches: get().patches.map((p) => (p.id === patchId ? { ...p, faceIndices: sorted, triangleCount: tc } : p)),
    });
  },

  deletePatch(patchId) {
    const cur = get();
    const target = cur.patches.find((p) => p.id === patchId);
    if (!target) return;
    // V1.2 — clean up BC entries keyed by the removed patch's name so the
    // BC table doesn't grow stale. If the user re-creates a patch with the
    // same name, createPatch will re-seed a fresh entry.
    // V1.4 — also clean the refinement table.
    const nextVel = { ...cur.boundaryConditions.velocity };
    const nextP = { ...cur.boundaryConditions.pressure };
    const nextRefs = { ...cur.patchRefinements };
    delete nextVel[target.name];
    delete nextP[target.name];
    delete nextRefs[target.name];
    set({
      patches: cur.patches.filter((p) => p.id !== patchId),
      boundaryConditions: { velocity: nextVel, pressure: nextP },
      patchRefinements: nextRefs,
    });
  },

  setPatchRefinement(patchId, refinement) {
    const cur = get();
    const patch = cur.patches.find((p) => p.id === patchId);
    if (!patch) return;
    // Clamp to 0..7, integer, and enforce min ≤ max.
    const min = Math.max(0, Math.min(7, Math.round(refinement.min)));
    let max = Math.max(0, Math.min(7, Math.round(refinement.max)));
    if (max < min) max = min;
    set({
      patchRefinements: {
        ...cur.patchRefinements,
        [patch.name]: { min, max },
      },
    });
  },

  // V1.5 — set one runtime control for a specific solver. Each solver
  // keeps its own deltaT / writeInterval / purgeWrite / endTime / cores /
  // nu, so flipping the dropdown preserves tweaks across solver changes.
  setSolverControl(solver, key, value) {
    const cur = get();
    const prev = cur.solverControlsBySolver[solver];
    set({
      solverControlsBySolver: {
        ...cur.solverControlsBySolver,
        [solver]: { ...prev, [key]: value },
      },
    });
  },

  // V1.5 — switch the Build Case form's active solver. Reads incoming
  // solverControlsBySolver[solver] immediately (so the form rebinds to
  // the new solver's saved values), but doesn't touch any other entry.
  setFormSolver(solver) {
    set({ formSolver: solver });
  },

  setPatchBc(patchId, field, bc) {
    const cur = get();
    const patch = cur.patches.find((p) => p.id === patchId);
    if (!patch) return;
    const next = { ...cur.boundaryConditions };
    if (field === "velocity") {
      next.velocity = { ...next.velocity, [patch.name]: bc };
    } else {
      next.pressure = { ...next.pressure, [patch.name]: bc };
    }
    set({ boundaryConditions: next });
  },

  async exportPatch(patchId) {
    const state = get();
    const prep = state.prep;
    const patch = state.patches.find((p) => p.id === patchId);
    if (!prep || !patch) {
      set({ status: { kind: "error", message: "Nothing to export (no geometry or patch)." } });
      return;
    }
    if (!state.activeCaseDir) {
      set({ status: { kind: "error", message: "Pick a target case directory first." } });
      return;
    }
    if (patch.faceIndices.length === 0) {
      set({ status: { kind: "error", message: `Patch "${patch.name}" has no faces.` } });
      return;
    }

    try {
      // Translate from face-index to the [start,count] pairs the geometry keeps.
      const groupForPatch: number[] = [];
      for (const fi of patch.faceIndices) {
        const g = prep.faceGroups[fi];
        if (!g) continue;
        groupForPatch.push(g.start, g.count);
      }
      const bytes = exportFacesAsStl({
        positions: prep.positions,
        normals: prep.normals,
        indices: prep.indices,
        group: groupForPatch,
        selectedFaces: new Set(patch.faceIndices),
        format: "binary",
        stlName: patch.name,
      });

      const targetRel = `constant/triSurface/${sanitizeFilename(patch.name)}.stl`;
      const targetAbs = `${state.activeCaseDir}/${targetRel}`;
      await window.cfd.geometry.write(targetAbs, bytes);
      // Update patch with new export path.
      set({
        patches: get().patches.map((p) =>
          p.id === patchId ? { ...p, lastExportedRelPath: targetRel } : p,
        ),
        status: {
          kind: "ready",
          message: `Exported ${patch.name} → ${targetRel} (${bytes.length} bytes)`,
        },
      });
    } catch (err) {
      set({ status: { kind: "error", message: `Export failed: ${String(err)}` } });
    }
  },

  async refreshCases() {
    try {
      const res = await window.cfd.geometry.caseList();
      const opts = res.ok ? res.runs : [];
      set({ caseOptions: opts });
    } catch {
      set({ caseOptions: [] });
    }
  },

  setActiveCase(dir) {
    set({ activeCaseDir: dir });
  },

  async buildCaseFromPatches(opts) {
    const state = get();
    const prep = state.prep;
    if (!prep) {
      set({ status: { kind: "error", message: "Load a geometry file before building a case." } });
      return;
    }
    if (state.patches.length === 0) {
      set({ status: { kind: "error", message: "Add at least one patch (with at least one face) before building a case." } });
      return;
    }
    const unexported = state.patches.filter((p) => p.lastExportedRelPath == null);
    if (unexported.length > 0) {
      set({
        status: {
          kind: "error",
          message: `Export ${unexported.length === 1 ? "patch \"" + unexported[0]!.name + "\"" : "all patches"} to STL first.`,
        },
      });
      return;
    }

    const paddingPct = opts?.paddingPercent ?? 25;
    const padding = paddingPct / 100;
    const bbox = prep.bbox;
    const span = {
      x: bbox.max.x - bbox.min.x,
      y: bbox.max.y - bbox.min.y,
      z: bbox.max.z - bbox.min.z,
    };
    // Background domain = bbox grown by `padding*span` per side, AND translated so its
    // origin sits `padding*span` away from bbox.min. The renderer uses
    //   Lx = span + 2*padding*span
    //   origin = bbox.min - padding*span
    // so [origin, origin+(Lx,Ly,Lz)] fully contains [bbox.min, bbox.max].
    const Lx = span.x * (1 + 2 * padding);
    const Ly = span.y * (1 + 2 * padding);
    const Lz = span.z * (1 + 2 * padding);
    const origin = {
      x: bbox.min.x - padding * span.x,
      y: bbox.min.y - padding * span.y,
      z: bbox.min.z - padding * span.z,
    };
    const longest = Math.max(Lx, Ly, Lz, 1e-9);
    // Aim for ~40 cells along the longest dimension \u2014 leaves the snappy user free to refine in the dict.
    const TARGET_CELLS = 40;
    const nx = Math.max(8, Math.round((Lx / longest) * TARGET_CELLS));
    const ny = Math.max(8, Math.round((Ly / longest) * TARGET_CELLS));
    const nz = Math.max(8, Math.round((Lz / longest) * TARGET_CELLS));

    // V0.6 user-editable knobs with sensible defaults. V1.5 — read from
    // solverControlsBySolver[formSolver] as the default when opts don't
    // override. Per-solver defaults already include the right deltaT for
    // transient vs steady solvers, so the renderer no longer needs to pass
    // them explicitly. `purgeWrite` rides on DomainSchema (added in V1.5)
    // so it roundtrips through .cfd-app-state.json without an IPC bump.
    const controls = state.solverControlsBySolver[state.formSolver];
    const domain = {
      kind: "cavity" as const,
      geometryKind: "imported" as const,
      Lx, Ly, Lz, nx, ny, nz,
      nu: opts?.nu ?? controls.nu,
      rho: 1.225,
      solver: opts?.solver ?? controls.solver,
      // V1.6 — turbulence model flows through `solverControlsBySolver[formSolver]`
      // (laminar default; user can opt into kEpsilon / kOmegaSST / SpalartAllmaras
      // from the dropdown). V1.23 lifts Smagorinsky + WALE into the dropdown
      // (replacing the V0.6 'LES' placeholder); `momentumTransport.hbs` has
      // matching if-branches that read `turbulenceCoefficientsLES.Cs` (Smagorinsky)
      // or `turbulenceCoefficientsLES.Cw` (WALE). `fvSolution.hbs` already
      // has if/else branches that read this field, so the picker is the only
      // missing piece — no template changes required beyond V1.23's LES branch
      // additions.
      turbulence: controls.turbulence,
      endTime: opts?.endTime ?? controls.endTime,
      deltaT: controls.deltaT,
      writeInterval: controls.writeInterval,
      purgeWrite: controls.purgeWrite,
      // V1.7 — initial U/pressure for the rendered 0/U and 0/p internalField
      //  lines. Per-solver default is `(0,0,0) / 0` for steady/transient
      //  solvers; `potentialFoam` flips to a freestream `(1,0,0)` so the
      //  preconditioner starts from a useful guess. User can override either
      //  per-solver in the Build Case form.
      initialConditions: controls.initialConditions,
      // V1.9 — numerical corrector counts + SIMPLE residual tolerance.
      //  Sourced from the active solver's `controls.numerics`. Lives
      //  on the Domain (so it roundtrips through .cfd-app-state.json
      //  and reaches the fvSolution template unmodified); the per-
      //  solver copy is the UI source of truth.
      numerics: controls.numerics,
      // V1.11 — SIMPLE relaxation-factor overrides. Same merge
      //  pattern as `numerics` above; lives on the Domain so the
      //  fvSolution template reads `{{or relaxationFactors.X
      //  default}}` directly. Empty maps for PIMPLE/PISO solvers
      //  cause the template to skip emitting the relaxationFactors
      //  block entirely, preserving pre-V1.11 behavior.
      relaxationFactors: controls.relaxationFactors,
      // V1.18d — matrix-solver configurations. Same merge pattern
      //  as `relaxationFactors` above; lives on the Domain so the
      //  fvSolution.hbs template reads `{{solverConfigs.p.solver}}`
      //  directly. Solver-agnostic defaults (no per-solver diff per
      //  the V1.18 designer recommendation); seed values match the
      //  V1.17 hard-coded template verbatim so pre-V1.18d cases
      //  re-render identically.
      solverConfigs: controls.solverConfigs,
      // V1.19 — adaptive time-step toggle. Same merge pattern as
      //  V1.18d's `solverConfigs`: lives on both SolverControlsSchema
      //  (per-solver, UI source of truth) and DomainSchema (so
      //  controlDict.hbs can read `{{#if emitAdaptiveTimeStep}}…{{/if}}`
      //  directly). `case.ts` precomputes the `emitAdaptiveTimeStep`
      //  boolean (true only for pimpleFoam + icoFoam + `enabled`),
      //  short-circuiting SIMPLE-family solvers so the controlDict
      //  always emits OpenFOAM stock `adjustTimeStep no;` for steady
      //  algorithms regardless of the form's displayed toggle.
      adaptiveTimeStep: controls.adaptiveTimeStep,
      // V1.20 — k-ε turbulence-coefficient block. Same two-sided
      //  mirror as `solverConfigs` above: seeded per-solver in
      //  SOLVER_CONTROLS_DEFAULTS via the same shape, then merged
      //  into the Domain for momentumTransport.hbs to read
      //  `{{turbulenceCoefficients.Cmu}}` etc. The momentumTransport
      //  template gates on `turbulence === 'kEpsilon'` so non-RANS
      //  schemes never see the render of the coefficient sub-block
      //  in the file. Defaults are OpenFOAM stock so legacy .cfd-
      //  app-state.json files parse identically via Zod defaults.
      turbulenceCoefficients: controls.turbulenceCoefficients,
      // V1.21 — k-ω SST coefficient block. Parallel slot to V1.20's
      //  `turbulenceCoefficients` (kEpsilon). Same two-sided-on-
      //  Domain-and-SolverControls pattern, named-reference to
      //  KOmegegaSSTCoefficientsSchema. The momentumTransport
      //  template gates on `turbulence === 'kOmegaSST'` and reads
      //  `{{turbulenceCoefficientsKOmegaSST.alphaK1}}` etc. Defaults
      //  are OpenFOAM Menter 2009 stock; legacy .cfd-app-state.json
      //  files parse with the stock defaults via the Zod default chain.
      turbulenceCoefficientsKOmegaSST: controls.turbulenceCoefficientsKOmegaSST,
      // V1.22 — Spalart-Allmaras coefficient block. Parallel slot to
      //  V1.20's `turbulenceCoefficients` (kEpsilon) and V1.21's
      //  `turbulenceCoefficientsKOmegaSST` (kOmegaSST). Same two-
      //  sided-on-Domain-and-SolverControls pattern, named-reference
      //  to SpalartAllmarasCoefficientsSchema. The momentumTransport
      //  template gates on `turbulence === 'SpalartAllmaras'` and
      //  reads `{{turbulenceCoefficientsSpalartAllmaras.Cb1}}` etc.
      //  Defaults are OpenFOAM stock (1994 + Pirzadeh 1999 cubic
      //  ramp); legacy .cfd-app-state.json files parse with the stock
      //  defaults via the Zod default chain. The 5 tripped-SAFvOptions
      //  coefficients (At, Bt, ct1, ct2, ct3, ct4) are deferred to
      //  the V.x that lifts general fvOptions support — same caveat
      //  as V1.21's `a1` for limitK.
      turbulenceCoefficientsSpalartAllmaras: controls.turbulenceCoefficientsSpalartAllmaras,
      // V1.23 — LES sub-grid-scale coefficient block. Fourth sibling to
      //  V1.20 / V1.21 / V1.22's RANS slots; one parallel slot
      //  (`turbulenceCoefficientsLES`) carrying both `Cs` (Smagorinsky)
      //  and `Cw` (WALE) on the same slot — the form's active sub-block
      //  (gated by `formValues.turbulence === 'Smagorinsky' | 'WALE'`)
      //  determines which coefficient is written. The
      //  momentumTransport template emits `Cs X;` for Smagorinsky and
      //  `Cw Y;` for WALE in the respective `{{#if}}` branches. The
      //  simulationType line also branches (RAS for RANS models,
      //  LES for Smagorinsky / WALE / kEqn) — the `isLES` Handlebars
      //  helper registered in case.ts handles the conditional
      //  (single source of truth for the LES roster; add new LES
      //  variants to the array there). Defaults are OpenFOAM stock
      //  (Smagorinsky 1963 / Lilly 1967 / Nicoud+Ducros 1999 stems);
      //  legacy .cfd-app-state.json files parse with the stock
      //  defaults via the Zod default chain.
      turbulenceCoefficientsLES: controls.turbulenceCoefficientsLES,
      // V1.24 — k-equation LES coefficient block. 5th sibling to
      //  V1.20–V1.23 slots; separate parallel slot
      //  (`turbulenceCoefficientsKEqn`) because the kEqn coefficient
      //  family (Ck / Ce1 / Ce2) is structurally distinct from
      //  Smagorinsky / WALE's single-coefficient pattern. The form
      //  only renders this row when the user picks kEqn; values
      //  stay dormant otherwise. The momentumTransport template
      //  emits `modelCoeffs { Ck X; Ce1 Y; Ce2 Z; }` from the model
      //  block. Other LES variants (dynamicSmagorinsky /
      //  dynamicLagrangian / SpalartAllmarasDES / kOmegaSSTDES)
      //  deferred to V1.25 / V1.26.
      turbulenceCoefficientsKEqn: controls.turbulenceCoefficientsKEqn,
      turbulenceCoefficientsCDES: controls.turbulenceCoefficientsCDES,
      // V1.12 — fvSchemes `default` selectors. Same merge pattern
      //  as `numerics` / `relaxationFactors` above; lives on the
      //  Domain so the fvSchemes.hbs template reads `{{schemes.X}}`
      //  directly. Per-solver seed flips ddtDefault to `steadyState`
      //  for steady solvers (simpleFoam / buoyantSimpleFoam /
      //  potentialFoam) via SOLVER_CONTROLS_DEFAULTS, so a builder
      //  selecting any of those solvers here will write the
      //  correct steady-state ddt line.
      schemes: controls.schemes,
      cores: opts?.cores ?? controls.cores,
      patches: state.patches.map((p) => ({ name: p.name, triangleCount: p.triangleCount })),
      bbox,
      origin,
    };

    // V1.2 — the renderer's BC editor drives the bc table; pass it through.
    // buildTemplateLayout switches to snappy_U.hbs / snappy_p.hbs for imported
    // cases, and those templates read the bc.velocity / bc.pressure maps.
    const bc = state.boundaryConditions;
    // V1.4 — per-patch snappy refinement levels; the snappyHexMeshDict
    // template reads this via the `refBlock` Handlebars helper.
    const refinements = state.patchRefinements;

    set({ status: { kind: "loading", message: "Building snappy-driven case\u2026" } });
    try {
      const result = await window.cfd.case.create("cavity", domain, bc, opts?.label, refinements);
      if (!result.ok || !result.caseDir) {
        set({ status: { kind: "error", message: result.message ?? "Case create returned no path." } });
        return;
      }
      set({
        activeCaseDir: result.caseDir,
        builtDomain: domain,
        builtDomainCaseDir: result.caseDir,
        status: {
          kind: "ready",
          message: `Built ${state.patches.length}-patch snappy case \u2192 ${result.caseDir}`,
        },
      });
      await get().refreshCases();
    } catch (err) {
      set({ status: { kind: "error", message: `Build failed: ${String(err)}` } });
    }
  },

  reset() {
    // Spread all defaults, but PRESERVE openfoamDetected / bashrc / cores (the
    // user shouldn't have to re-Detect OpenFOAM just because they cleared the
    // geometry state), and PRESERVE caseOptions so the case dropdown stays
    // populated after Clear.
    const s = get();
    set({
      ...initial,
      selectedFaceIds: new Set<number>(),
      caseOptions: s.caseOptions,
      openfoamDetected: s.openfoamDetected,
      bashrc: s.bashrc,
      cores: s.cores,
    });
  },  // ---------------- Run slice (V0.8) ----------------

  async detectOpenfoam() {
    if (get().isDetecting) return;
    set({ isDetecting: true });
    try {
      const result = await window.cfd.openfoam.detect();
      set({
        openfoamDetected: result,
        // Seed bashrc default if the user hasn't overridden it yet.
        bashrc: get().bashrc ?? (result.found ? result.bashrc ?? null : null),
        status: {
          kind: result.found ? "ready" : "error",
          message: result.found
            ? `OpenFOAM detected: ${result.version ?? "unknown version"}${result.bashrc ? " (" + result.bashrc + ")" : ""}`
            : result.installHints?.join(" \u2022 ") ?? "OpenFOAM not detected",
        },
      });
    } catch (err) {
      set({
        openfoamDetected: {
          found: false,
          installHints: [`Detection failed: ${String(err)}`],
        },
        status: { kind: "error", message: `Detection failed: ${String(err)}` },
      });
    } finally {
      set({ isDetecting: false });
    }
  },

  setBashrc(p) {
    set({ bashrc: p && p.length > 0 ? p : null });
  },

  setCores(n) {
    const clamped = Math.max(1, Math.min(64, Math.floor(n) || 1));
    set({ cores: clamped });
  },

  async startSimulation() {
    const state = get();
    if (state.isRunning) return false;
    if (!state.activeCaseDir) {
      set({ status: { kind: "error", message: "No active case directory. Build or pick a case first." } });
      return false;
    }
    if (!state.bashrc) {
      set({ status: { kind: "error", message: "OpenFOAM bashrc not set \u2014 click Detect first." } });
      return false;
    }

    // Find the right Domain to source solver/cores from. Prefer the one we built
    // just for this case dir; otherwise fall back to a fresh caseLoad. If neither
    // works, we can't safely start a run.
    let domain: Domain | null = state.builtDomain;
    if (!domain || state.builtDomainCaseDir !== state.activeCaseDir) {
      try {
        const loaded = await window.cfd.case.load(state.activeCaseDir);
        if (loaded.ok) {
          domain = loaded.domain;
          // Cache it so subsequent Run clicks don't re-fetch.
          set({ builtDomain: domain, builtDomainCaseDir: state.activeCaseDir });
        }
      } catch {
        domain = null;
      }
    }
    if (!domain) {
      set({ status: { kind: "error", message: "Couldn't read case domain \u2014 rebuild the case, then Run." } });
      return false;
    }

    // Renderer-allocated runId: lets every event broadcast from main (including
    // the very first synchronously-emitted phase event) carry the same id that
    // is now in our store. setRunPhase / appendLogChunk / pushResidual drop any
    // event whose runId != state.runId, defeating the old "throttled stale
    // event from a previous run kills the fresh one" race.
    const runId = newRunId();
    set({
      isRunning: true,
      isStopping: false,
      runPhase: "preparing",
      runId,
      recentLogs: [],
      lastResidual: null,
      residualHistory: [],
      // V1.8 — clear any stale convergence badge from a previous run.
      lastConvergence: null,
      // V1.1: clear any stale results from a previous run on the same case so
      // the panel doesn't keep showing numbers from a prior solve.
      resultsAvailableTimes: [],
      resultsFieldsByTime: {},
      resultsSelectedTime: null,
      resultsSelectedField: null,
      resultsFieldData: null,
      resultsIsLoading: false,
      status: { kind: "loading", message: `Starting ${domain.solver} on ${state.cores} core(s)\u2026` },
    });

    try {
      const result = await window.cfd.run.start({
        runId,
        caseDir: state.activeCaseDir,
        bashrc: state.bashrc,
        cores: state.cores,
        solver: domain.solver,
        // V1.8 review-fix #1 — forward the convergence detector config
        //  (sourced from `state.solverControlsBySolver[formSolver].converge`)
        //  so the runner's makeConvergenceChecker receives the
        //  threshold / streak / autoStop and can fire 'converged'
        //  accordingly. Without this line the IPC schema validates
        //  but the detector sees `undefined` and runs disabled —
        //  V1.8 effectively dead in production.
        //
        //  V1.30 — payload key is `convergence:` (NOT `converge:`) to
        //  match the Zod-parsed key in `src/main/ipc/index.ts`'s
        //  `runStart` handler. Rendering-side aliasing doesn't
        //  survive Zod's `z.object({...}).parse(args)` because Zod
        //  silently strips unknown keys, so the V1.30 first-pass
        //  rename missed the IPC schema. The renderer-side
        //  `state.solverControlsBySolver[solver].converge` (the
        //  SolverControlsSchema key) is unchanged.
        convergence: state.solverControlsBySolver[state.formSolver].converge,
      });
      if (!result.ok) {
        set({
          isRunning: false,
          runPhase: "error",
          status: { kind: "error", message: result.message ?? "Run failed to start." },
        });
        return false;
      }
      set({
        status: {
          kind: "loading",
          message: `Run ${result.runId?.slice(0, 8) ?? runId.slice(0, 8)} launched \u2014 streaming\u2026`,
        },
      });
      return true;
    } catch (err) {
      set({
        isRunning: false,
        runPhase: "error",
        status: { kind: "error", message: `Run start failed: ${String(err)}` },
      });
      return false;
    }
  },

  async cancelSimulation() {
    const state = get();
    if (!state.isRunning || !state.runId) return;
    set({ isStopping: true, status: { kind: "loading", message: "Cancelling run\u2026" } });
    try {
      await window.cfd.run.cancel(state.runId);
    } catch (err) {
      // Don't fail UI on cancel errors; the main process will eventually emit the
      // final 'cancelled' phase and we'll reset state there.
      console.warn("cancel failed", err);
    }
  },

  clearRunState() {
    set({
      isRunning: false,
      isStopping: false,
      runId: null,
      runPhase: "idle",
      recentLogs: [],
      lastResidual: null,
      residualHistory: [],
      // V1.8 — clear the convergence badge when the user dismisses the
      //  run strip (otherwise it would persist until the next run start).
      lastConvergence: null,
    });
  },

  // ---- IPC event sinks (called by App.tsx subscriptions) ----

  appendLogChunk(chunk) {
    // Drop stale events from any run whose runId we don't currently care about
    // (a previous run that ended, or an event arriving AFTER reset() cleared
    // state.runId back to null).
    const cur = get();
    if (chunk.runId && cur.runId !== chunk.runId) return;
    const lines = chunk.text.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length === 0) return;
    const merged = cur.recentLogs.concat(lines.map((t) => ({ stream: chunk.stream, text: t })));
    const trimmed =
      merged.length > MAX_LOG_LINES + 50 ? merged.slice(merged.length - MAX_LOG_LINES) : merged;
    set({ recentLogs: trimmed });
  },

  setRunPhase(phase, message, runId) {
    const cur = get();
    if (runId && cur.runId !== runId) return;
    const isFinal = phase === "done" || phase === "converged" || phase === "error" || phase === "cancelled";
    // Status policy:
    //   • error    \u2014 always override with red so the failure is loud.
    //   • mid-run  \u2014 keep status in `loading` but reflect the current phase so
    //                the left strip stays in sync with the run pill.
    //   • done / cancelled \u2014 only override if the user is currently waiting on
    //                the run-strip loading message; otherwise leave their last
    //                useful geometry message ("Exported inlet.stl", …) intact.
    let nextStatus = cur.status;
    if (phase === "error") {
      nextStatus = { kind: "error", message: message ?? phaseMessage(phase) };
    } else if (!isFinal) {
      nextStatus = { kind: "loading", message: `Run phase: ${phase}${message ? ` \u2014 ${message}` : ""}` };
    } else if (cur.status.kind === "loading") {
      nextStatus = { kind: "ready", message: message ?? phaseMessage(phase) };
    }
    // V1.8 — stamp the convergence timestamp whenever the detector
    //  fires, so StatusBar / PatchPanel can render a "Converged at t=X"
    //  badge that survives the phase pill moving past 'converged' to a
    //  later stage (reconstructing / converting). We snapshot from
    //  `lastResidual.time` (most recent residual the broadcaster pushed).
    const nextLastConvergence =
      phase === "converged"
        ? { atTime: cur.lastResidual?.time ?? 0, atMs: Date.now() }
        : cur.lastConvergence;
    set({
      runPhase: phase,
      status: nextStatus,
      isRunning: !isFinal,
      isStopping: false,
      lastConvergence: nextLastConvergence,
    });
    // V1.1 (extended in V1.8): when a run lands cleanly on 'done' or
    //  'converged', auto-load the results panel for the active case. We
    //  deliberately skip 'error' (solver likely bailed before writing
    //  valid <time>/ dirs) and 'cancelled'.
    if ((phase === "done" || phase === "converged") && cur.activeCaseDir) {
      void get().loadResults(cur.activeCaseDir);
    }
  },

  pushResidual(point) {
    const cur = get();
    if (point.runId && cur.runId !== point.runId) return;
    const sample: ResidualPoint = { time: point.time, fields: point.fields };
    // Append + cap. We always allocate a fresh array (Zustand + React identity)
    // and trim off the oldest sample when over-budget.
    const atCap = cur.residualHistory.length >= MAX_RESIDUAL_POINTS;
    const next = atCap
      ? [...cur.residualHistory.slice(-(MAX_RESIDUAL_POINTS - 1)), sample]
      : [...cur.residualHistory, sample];
    set({ lastResidual: sample, residualHistory: next });
  },

  // V1.8 — informational stamp. Called from setRunPhase when the
  //  incoming phase is 'converged'. Idempotent: re-setting just
  //  refreshes `atMs` to the new Date.now() (so the badge updates
  //  if the detector were to fire twice in one run — extremely rare).
  setLastConvergence(atTime: number) {
    set({ lastConvergence: { atTime, atMs: Date.now() } });
  },

  // ---------------- Settings slice (V0.9) ----------------

  async loadSettings() {
    try {
      const s = await window.cfd.openfoam.loadSettings();
      set({
        settings: s,
        // If the user had a previously persisted bashrc path but no detection
        // result yet, surface it to the run slice so Run is enabled immediately.
        bashrc: get().bashrc ?? s.openfoamBashrc ?? null,
      });
    } catch (err) {
      set({ status: { kind: "error", message: `Couldn't load settings: ${String(err)}` } });
    }
  },

  async saveSettings(next) {
    const cur = get().settings;
    const merged: AppSettings = {
      maxLogBufferLines: next.maxLogBufferLines ?? cur.maxLogBufferLines,
      openfoamBashrc: next.openfoamBashrc !== undefined ? next.openfoamBashrc : cur.openfoamBashrc,
      defaultRunRoot: next.defaultRunRoot !== undefined ? next.defaultRunRoot : cur.defaultRunRoot,
    };
    // Optimistically apply locally so the UI doesn't wait for disk I/O. We
    // snapshot the previous settings so we can ROLL BACK on IPC failure \u2014
    // otherwise the user sees their "Save" succeed briefly, then on next app
    // restart disk wins and the change silently disappears.
    const prevSettings = cur;
    const prevBashrc = get().bashrc;
    set({ settings: merged, bashrc: merged.openfoamBashrc ?? prevBashrc });
    try {
      await window.cfd.openfoam.saveSettings(merged);
      set({ status: { kind: "ready", message: "Settings saved." } });
      // New defaultRunRoot means we'd ideally re-scan; refresh so the case
      // picker reflects newly-discoverable cases.
      await get().refreshCases();
    } catch (err) {
      set({
        settings: prevSettings,
        bashrc: prevBashrc,
        status: { kind: "error", message: `Save failed (rolled back): ${String(err)}` },
      });
    }
  },

  openSettings() {
    set({ isSettingsOpen: true });
  },

  closeSettings() {
    set({ isSettingsOpen: false, isVerifyingBashrc: false });
  },

  async verifyBashrc(bashrcPath) {
    set({ isVerifyingBashrc: true });
    try {
      const result = await window.cfd.openfoam.verifyBashrc(bashrcPath);
      if (result.found) {
        // Persist immediately so a subsequent Settings close doesn't lose it,
        // and refresh detection-derived UI elements.
        await get().saveSettings({ openfoamBashrc: bashrcPath });
        set({
          openfoamDetected: result,
          bashrc: bashrcPath,
          status: {
            kind: "ready",
            message: `Verified: OpenFOAM ${result.version ?? "unknown"} at ${bashrcPath}`,
          },
        });
      } else {
        set({
          status: {
            kind: "error",
            message: `Bashrc did not source OpenFOAM: ${result.installHints?.join(" \u2022 ") ?? "unknown reason"}`,
          },
        });
      }
    } catch (err) {
      set({ status: { kind: "error", message: `Verify failed: ${String(err)}` } });
    } finally {
      set({ isVerifyingBashrc: false });
    }
  },

  // ---------------- Results slice (V1.1) ----------------

  async loadResults(caseDir: string) {
    set({ resultsIsLoading: true });
    try {
      const res = await window.cfd.results.list(caseDir);
      if (!res.ok) {
        set({ resultsAvailableTimes: [], resultsIsLoading: false });
        return;
      }
      const times = res.times;
      set({
        resultsAvailableTimes: times,
        resultsFieldsByTime: {},
        resultsIsLoading: false,
      });
      // Auto-select the latest time step if there is one (most informative).
      if (times.length > 0) {
        await get().selectResultsTime(times[times.length - 1]!);
      } else {
        set({ resultsSelectedTime: null, resultsSelectedField: null, resultsFieldData: null });
      }
    } catch (err) {
      set({ resultsIsLoading: false, status: { kind: "error", message: `Results load failed: ${String(err)}` } });
    }
  },

  async selectResultsTime(time: number) {
    const state = get();
    if (!state.activeCaseDir) return;
    // If we already cached the field list for this time, just switch selection.
    if (state.resultsFieldsByTime[time]) {
      set({
        resultsSelectedTime: time,
        resultsSelectedField: null,
        resultsFieldData: null,
      });
      return;
    }
    set({
      resultsSelectedTime: time,
      resultsSelectedField: null,
      resultsFieldData: null,
      resultsIsLoading: true,
    });
    try {
      const res = await window.cfd.results.listFields(state.activeCaseDir, time);
      const files = res.ok ? res.files : [];
      set({
        resultsFieldsByTime: { ...state.resultsFieldsByTime, [time]: files },
        resultsIsLoading: false,
      });
    } catch (err) {
      set({
        resultsIsLoading: false,
        status: { kind: "error", message: `Field list failed: ${String(err)}` },
      });
    }
  },

  async selectResultsField(field: string) {
    const state = get();
    if (!state.activeCaseDir || state.resultsSelectedTime == null) return;
    set({ resultsSelectedField: field, resultsFieldData: "(loading…)" });
    try {
      const res = await window.cfd.results.read(
        state.activeCaseDir,
        state.resultsSelectedTime,
        field,
      );
      set({
        resultsFieldData: res.ok ? res.text ?? "" : `(error: ${res.message ?? "unknown"})`,
      });
    } catch (err) {
      set({ resultsFieldData: `(read failed: ${String(err)})` });
    }
  },

  clearResults() {
    set({
      resultsAvailableTimes: [],
      resultsFieldsByTime: {},
      resultsSelectedTime: null,
      resultsSelectedField: null,
      resultsFieldData: null,
      resultsIsLoading: false,
    });
  },

  async revealResultsInFileManager() {
    const caseDir = get().activeCaseDir;
    if (!caseDir) return;
    try {
      const res = await window.cfd.results.revealVTK(caseDir);
      set({ status: { kind: "ready", message: `Revealed ${res.revealed} in file manager.` } });
    } catch (err) {
      set({ status: { kind: "error", message: `Reveal failed: ${String(err)}` } });
    }
  },

  async openResultsDir() {
    const caseDir = get().activeCaseDir;
    if (!caseDir) return;
    try {
      const res = await window.cfd.results.openVTKDir(caseDir);
      if (res.ok) {
        set({ status: { kind: "ready", message: `Opened ${res.opened} in file manager.` } });
      } else {
        set({ status: { kind: "error", message: `Open failed: ${res.error ?? "unknown"}` } });
      }
    } catch (err) {
      set({ status: { kind: "error", message: `Open failed: ${String(err)}` } });
    }
  },
}));

function newRunId(): string {
  // crypto.randomUUID() is available in the renderer (Electron >= 15, Chromium-based).
  if (typeof crypto !== "undefined" && typeof (crypto as Crypto).randomUUID === "function") {
    return (crypto as Crypto).randomUUID();
  }
  // Deterministic fallback if running in a stripped-down environment.
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function phaseMessage(phase: Phase): string {
  switch (phase) {
    case "done": return "Run finished successfully.";
    case "error": return "Run ended with errors \u2014 see log.";
    case "cancelled": return "Run was cancelled.";
    default: return `Run phase: ${phase}`;
  }
}

/** Sanitize patch name for filesystem use (slashes, etc. removed). */
function sanitizeFilename(s: string): string {
  return s.trim().replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 64) || "patch";
}

/**
 * Convenience type for callers that want to import wire types from the
 * shared schema without re-declaring them.
 */
export type { GeometryPatchWire };

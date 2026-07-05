/**
 * Render-side mirror of the API exposed by src/preload/index.ts.
 * Kept hand-synced with the preload bridge.
 */
import type {
  Domain,
  BoundaryConditions,
  AppSettings,
  CaseKind,
  OpenfoamDetected,
  PatchRefinements,
  RunLogEvent,
  RunPhaseEvent,
  RunResidualEvent,
  SolverControls,
} from "@shared/types";

export type GeometryFormat = "STEP" | "STL" | "IGES";

export interface CfdApi {
  openfoam: {
    detect: () => Promise<OpenfoamDetected>;
    verifyBashrc: (path: string) => Promise<OpenfoamDetected>;
    saveSettings: (settings: AppSettings) => Promise<{ ok: boolean; path: string }>;
    loadSettings: () => Promise<AppSettings>;
  };
  case: {
    create: (
      kind: CaseKind,
      domain: Domain,
      bc: BoundaryConditions,
      label?: string,
      // V1.4 — optional per-patch refinement map.
      refinements?: PatchRefinements,
    ) => Promise<{ ok: boolean; message: string; runId?: string; caseDir?: string }>;
    save: (
      caseDir: string,
      kind: CaseKind,
      domain: Domain,
      bc: BoundaryConditions,
      refinements?: PatchRefinements,
    ) => Promise<{ ok: boolean; path: string }>;
    load: (
      caseDir: string,
    ) => Promise<
      | { ok: true; caseDir: string; kind: CaseKind; domain: Domain; bc: BoundaryConditions }
      | { ok: false; message: string }
    >;
    list: () => Promise<{ ok: boolean; runs: Array<{ dir: string; name: string; kind: string; mtime: number }> }>;
  };
  run: {
    start: (
      params: {
        runId: string;
        caseDir: string;
        bashrc: string;
        cores: number;
        solver: string;
        // V1.30 — forward the convergence detector config (sourced from
        //  `state.solverControlsBySolver[formSolver].converge`). Key name
        //  matches the Zod schema's `convergence:` in
        //  `src/main/ipc/index.ts`'s `runStart` handler. Optional so
        //  pre-V1.8 renderer payloads (or a future user opting out of
        //  detection at the case-build level) send logically; downstream
        //  runner treats `undefined` as "detector disabled".
        //
        //  V1.30 review-fix #2 — type-as `SolverControls["converge"]`
        //  so the CfdApi surface tracks the SolverControlsSchema.
        //  Single-source-of-truth: any future field added to
        //  SolverControlsSchema.converge flows in here automatically
        //  rather than silently breaking the IPC envelope.
        convergence?: SolverControls["converge"];
      },
    ) => Promise<{ ok: boolean; message: string; runId?: string; caseDir?: string }>;
    cancel: (runId: string) => Promise<{ ok: boolean; runId: string }>;
    status: () => Promise<{ active: Array<{ id: string; caseDir: string; cancelled: boolean; done: boolean; startTime: number }> }>;
    onLog: (cb: (payload: RunLogEvent) => void) => () => void;
    onPhase: (cb: (payload: RunPhaseEvent) => void) => () => void;
    onResidual: (cb: (payload: RunResidualEvent) => void) => () => void;
  };
  results: {
    list: (caseDir: string) => Promise<{ ok: boolean; times: number[] }>;
    listFields: (caseDir: string, time: number) => Promise<{ ok: boolean; files: string[] }>;
    read: (caseDir: string, time: number, field: string) => Promise<{ ok: boolean; text?: string; message?: string }>;
    revealVTK: (caseDir: string) => Promise<{ ok: boolean; revealed: string }>;
    openVTKDir: (caseDir: string) => Promise<{ ok: boolean; opened: string; error?: string }>;
  };
  geometry: {
    pickAndRead: (format: GeometryFormat) => Promise<{ path: string; bytes: Uint8Array } | null>;
    write: (path: string, bytes: Uint8Array) => Promise<void>;
    caseList: () => Promise<{ ok: boolean; runs: Array<{ dir: string; name: string; kind: string; mtime: number }> }>;
  };
}

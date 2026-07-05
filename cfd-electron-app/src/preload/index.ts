/**
 * Preload bridge — exposes a typed, narrow API to the renderer process.
 * Renderer can only invoke what's declared here; everything else stays in main.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '@shared/types';
import type {
  AppSettings,
  BoundaryConditions,
  CaseKind,
  Domain,
  OpenfoamDetected,
  PatchRefinements,
  RunLogEvent,
  RunPhaseEvent,
  RunResidualEvent,
} from '@shared/types';

type Listener<T> = (payload: T) => void;

function onChannel<T>(channel: string, listener: Listener<T>) {
  const wrapped = (_evt: unknown, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const api = {
  openfoam: {
    detect: (): Promise<OpenfoamDetected> => ipcRenderer.invoke(IpcChannels.openfoamDetect),
    verifyBashrc: (path: string): Promise<OpenfoamDetected> =>
      ipcRenderer.invoke(IpcChannels.openfoamVerifyBashrc, { path }),
    saveSettings: (settings: AppSettings) => ipcRenderer.invoke(IpcChannels.openfoamSettingsSave, settings),
    loadSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IpcChannels.openfoamSettingsLoad),
  },
  case: {
    create: (
      kind: CaseKind,
      domain: Domain,
      bc: BoundaryConditions,
      label?: string,
      // V1.4 — optional per-patch refinement map.
      refinements?: PatchRefinements,
    ) => ipcRenderer.invoke(IpcChannels.caseCreate, { kind, domain, bc, label, refinements }),
    save: (
      caseDir: string,
      kind: CaseKind,
      domain: Domain,
      bc: BoundaryConditions,
      refinements?: PatchRefinements,
    ) => ipcRenderer.invoke(IpcChannels.caseSave, { caseDir, kind, domain, bc, refinements }),
    load: (
      caseDir: string,
    ): Promise<
      | { ok: true; caseDir: string; kind: CaseKind; domain: Domain; bc: BoundaryConditions }
      | { ok: false; message: string }
    > => ipcRenderer.invoke(IpcChannels.caseLoad, { caseDir }),
    list: () => ipcRenderer.invoke(IpcChannels.caseList),
  },
  run: {
    start: (params: { runId: string; caseDir: string; bashrc: string; cores: number; solver: string }) =>
      ipcRenderer.invoke(IpcChannels.runStart, params),
    cancel: (runId: string) => ipcRenderer.invoke(IpcChannels.runCancel, { runId }),
    status: () => ipcRenderer.invoke(IpcChannels.runStatus),
    onLog: (cb: Listener<RunLogEvent>) => onChannel(IpcChannels.log, cb),
    onPhase: (cb: Listener<RunPhaseEvent>) => onChannel(IpcChannels.phase, cb),
    onResidual: (cb: Listener<RunResidualEvent>) => onChannel(IpcChannels.residuals, cb),
  },
  results: {
    list: (caseDir: string) => ipcRenderer.invoke(IpcChannels.resultsList, { caseDir }),
    listFields: (caseDir: string, time: number) =>
      ipcRenderer.invoke(IpcChannels.resultsListFields, { caseDir, time }),
    read: (caseDir: string, time: number, field: string) =>
      ipcRenderer.invoke(IpcChannels.resultsRead, { caseDir, time, field }),
    revealVTK: (caseDir: string) => ipcRenderer.invoke(IpcChannels.resultsRevealVTK, { caseDir }),
    openVTKDir: (caseDir: string) => ipcRenderer.invoke(IpcChannels.resultsOpenVTKDir, { caseDir }),
  },
  geometry: {
    /**
     * Open a native file dialog filtered to the requested CAD format, read the
     * chosen file as bytes, and return both the path and the bytes. Returns
     * null if the user canceled the dialog.
     */
    pickAndRead: (format: 'STEP' | 'STL' | 'IGES'): Promise<{ path: string; bytes: Uint8Array } | null> =>
      ipcRenderer.invoke(IpcChannels.geometryFilePickAndRead, { format }),
    /** Write a binary payload to disk (used for exporting patch STLs). */
    write: (path: string, bytes: Uint8Array): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.geometryFileWrite, { path, bytes }),
    /** List existing CFD cases that the user can export patches into. */
    caseList: (): Promise<{ ok: boolean; runs: Array<{ dir: string; name: string; kind: string; mtime: number }> }> =>
      ipcRenderer.invoke(IpcChannels.geometryCaseList),
  },
};

contextBridge.exposeInMainWorld('cfd', api);

// TypeScript declaration for renderer
export type CfdApi = typeof api;

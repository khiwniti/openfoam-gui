/**
 * IPC handler registration — single entry point for all renderer-facing APIs.
 * Uses Zod to validate inputs against the shared schemas defined in src/shared/types.ts.
 */
import { ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { defaultRunRoot, ensureDir, cancelRun, listActiveRuns, startRun, buildRunPipeline } from '@main/openfoam/runner';
import { detectOpenfoam, verifyBashrc } from '@main/openfoam/detect';
import { renderCase, loadCaseState, saveCase } from '@main/openfoam/case';
import { IpcChannels } from '@shared/types';
import { dialog, shell } from 'electron';
import {
  AppSettingsSchema,
  BoundaryConditionsSchema,
  CaseKindSchema,
  DomainSchema,
  Domain,
  GeometryFilePickArgsSchema,
  GeometryFileWriteArgsSchema,
  PatchRefinementSchema,
  RunResultSchema,
  // V1.31a — extracted from the previously-inline IPC envelope so
  //  tests can import + parse the schema directly without pulling in
  //  electron (used only by the IPC handler). See docstring on
  //  RunStartConvergenceSchema in @shared/types for the design
  //  rationale (wire-format differs from
  //  SolverControlsSchema.shape.converge in `.default()` and
  //  `.int().positive()` vs `.int().min(1)`).
  RunStartEnvelopeSchema,
  type OpenfoamDetected,
  type RunLogEvent,
  type RunPhaseEvent,
  type RunResidualEvent,
  RunResult,
} from '@shared/types';

// Shared throttled emitter pattern — reused for log/residual streams.
class Broadcaster<T> {
  private latest: T | null = null;
  private timer: NodeJS.Timeout | null = null;
  constructor(private channel: string, private throttle = 50) {}
  push(payload: T) {
    this.latest = payload;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      if (this.latest !== null) {
        const win = requireMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send(this.channel, this.latest);
      }
      this.timer = null;
    }, this.throttle);
  }
}

// We import lazily below to avoid circular deps; this stub is replaced at init.
let getMainWindow: () => Electron.BrowserWindow | null = () => null;
function requireMainWindow() { return getMainWindow(); }

const logBroadcaster = new Broadcaster<RunLogEvent>(IpcChannels.log, 100);
const phaseBroadcaster = new Broadcaster<RunPhaseEvent>(IpcChannels.phase, 50);
const residualsBroadcaster = new Broadcaster<RunResidualEvent>(IpcChannels.residuals, 200);

export function registerIpc(mainWindowGetter: () => Electron.BrowserWindow | null) {
  getMainWindow = mainWindowGetter;

  ipcMain.handle(IpcChannels.openfoamDetect, async (): Promise<OpenfoamDetected> => {
    return detectOpenfoam();
  });

  ipcMain.handle(
    IpcChannels.openfoamVerifyBashrc,
    async (_evt, args: unknown): Promise<OpenfoamDetected> => {
      const { path: bashrcPath } = z.object({ path: z.string() }).parse(args);
      return verifyBashrc(bashrcPath);
    },
  );

  ipcMain.handle(
    IpcChannels.openfoamSettingsSave,
    async (_evt, args: unknown) => {
      const parsed = AppSettingsSchema.parse(args);
      const cfgPath = settingsPath();
      await fs.writeFile(cfgPath, JSON.stringify(parsed, null, 2), 'utf8');
      // Invalidate the in-process cache so the next getRunRoot() / settings read
      // picks up the freshly-saved values (otherwise the renderer could Save,
      // then immediately refresh cases and they'd land in the OLD root).
      cachedSettings = null;
      return { ok: true, path: cfgPath };
    },
  );

  ipcMain.handle(IpcChannels.openfoamSettingsLoad, async () => {
    try {
      const raw = await fs.readFile(settingsPath(), 'utf8');
      return AppSettingsSchema.parse(JSON.parse(raw));
    } catch {
      return AppSettingsSchema.parse({});
    }
  });

  ipcMain.handle(
    IpcChannels.caseCreate,
    async (_evt, args: unknown): Promise<RunResult> => {
      const input = z
        .object({
          kind: CaseKindSchema,
          domain: DomainSchema,
          bc: BoundaryConditionsSchema,
          label: z.string().optional(),
          // V1.4 — optional per-patch refinement map. Defaults to {} if
          // omitted, so legacy renderer payloads (or a cleared editor) emit
          // `(0 0)` for every patch.
          refinements: z.record(z.string(), PatchRefinementSchema).optional(),
        })
        .parse(args);
      const dir = await pickCaseDir(input.label);
      await ensureDir(dir);
      const rendered = await saveCase(
        input.kind,
        input.domain,
        input.bc,
        dir,
        input.label,
        input.refinements,
      );
      return RunResultSchema.parse({ ok: true, message: 'case created', caseDir: rendered.caseDir });
    },
  );

  ipcMain.handle(
    IpcChannels.caseSave,
    async (_evt, args: unknown) => {
      const input = z
        .object({
          caseDir: z.string(),
          kind: CaseKindSchema,
          domain: DomainSchema,
          bc: BoundaryConditionsSchema,
          refinements: z.record(z.string(), PatchRefinementSchema).optional(),
        })
        .parse(args);
      const rendered = await saveCase(
        input.kind,
        input.domain,
        input.bc,
        input.caseDir,
        undefined,
        input.refinements,
      );
      return { ok: true, path: rendered.caseDir };
    },
  );

  ipcMain.handle(
    IpcChannels.caseLoad,
    async (_evt, args: unknown) => {
      const input = z.object({ caseDir: z.string() }).parse(args);
      const state = await loadCaseState(input.caseDir);
      if (!state) return { ok: false, message: 'No .cfd-app-state.json' };
      // Surface the Domain explicitly so the renderer can keep using it (snappy
      // solver/cores fall back to this when no recent Build Case is in memory).
      return { ok: true, ...state, caseDir: input.caseDir, domain: state.domain };
    },
  );

  ipcMain.handle(IpcChannels.caseList, async () => {
    const root = await getRunRoot();
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      const dirs = await Promise.all(
        entries
          .filter((e) => e.isDirectory())
          .map(async (e) => {
            const full = path.join(root, e.name);
            const state = await loadCaseState(full).catch(() => null);
            const mtime = (await fs.stat(full)).mtimeMs;
            return state ? { dir: full, name: e.name, kind: state.kind, mtime } : null;
          }),
      );
      return { ok: true, runs: dirs.filter(Boolean).sort((a, b) => (b!.mtime - a!.mtime)) };
    } catch {
      return { ok: true, runs: [] };
    }
  });

  ipcMain.handle(
    IpcChannels.runStart,
    async (_evt, args: unknown) => {
      // V1.31a — wire-format envelope extracted to @shared/types as
      //  RunStartEnvelopeSchema for unit-testability (vitest node env
      //  can't import electron). Behavior is identical to the
      //  previously-inline schema: non-strict `.object()`, so
      //  unknown keys (e.g., the V1.30 first-pass `converge:` bug)
      //  silently strip and `convergence` comes back undefined. The
      //  regression-net test in
      //  src/shared/__tests__/run-payload-schemas.test.ts pins both
      //  sides of that bug-at-parse-time vs bug-at-runtime semantics.
      const input = RunStartEnvelopeSchema.parse(args);
      // Probe the on-disk state file to learn whether this is a snappy (imported)
      // case or a parametric one, so we can route the pipeline correctly.
      const state = await loadCaseState(input.caseDir).catch(() => null);
      const stages = buildRunPipeline({
        cores: input.cores,
        solver: input.solver,
        geometryKind: state?.domain.geometryKind ?? 'parametric',
      });
      const id = await startRun(
        {
          bashrc: input.bashrc,
          caseDir: input.caseDir,
          stages,
          onLog: (c) => logBroadcaster.push(c),
          onPhase: (p, m) => phaseBroadcaster.push({ phase: p, message: m, runId: input.runId }),
          onResidual: (r) => residualsBroadcaster.push(r),
          // V1.8 — forward the detector config so the runner's stage
          //  loop builds + wires the convergence monitor on each
          //  spawned child. Strict-shape (Zod-validated upstream);
          //  undefined is OK and disables the detector.
          convergence: input.convergence,
        },
        input.runId,
      );
      return RunResultSchema.parse({ ok: true, message: 'run started', runId: id, caseDir: input.caseDir });
    },
  );

  ipcMain.handle(IpcChannels.runCancel, async (_evt, args: unknown) => {
    const { runId } = z.object({ runId: z.string() }).parse(args);
    return { ok: cancelRun(runId), runId };
  });

  ipcMain.handle(IpcChannels.runStatus, async () => ({ active: listActiveRuns() }));

  ipcMain.handle(
    IpcChannels.resultsList,
    async (_evt, args: unknown) => {
      const { caseDir } = z.object({ caseDir: z.string() }).parse(args);
      try {
        const entries = await fs.readdir(caseDir, { withFileTypes: true });
        const times = entries
          .filter((e) => e.isDirectory() && /^[-0-9.]+$/.test(e.name))
          .map((e) => parseFloat(e.name))
          .sort((a, b) => a - b);
        return { ok: true, times };
      } catch {
        return { ok: true, times: [] };
      }
    },
  );

  // V1.1 — list field file names inside a single <caseDir>/<time>/ directory.
  // We list lazily (per time-select) so a 500-time transient case doesn't
  // block the renderer on a single bulk IPC.
  ipcMain.handle(
    IpcChannels.resultsListFields,
    async (_evt, args: unknown) => {
      const { caseDir, time } = z
        .object({ caseDir: z.string(), time: z.number() })
        .parse(args);
      try {
        const dir = path.join(caseDir, String(time));
        const entries = await fs.readdir(dir, { withFileTypes: true });
        // Field files are flat files at the top of the time dir; skip
        // sub-dirs and dotfiles.
        const files = entries
          .filter((e) => e.isFile() && !e.name.startsWith("."))
          .map((e) => e.name)
          .sort();
        return { ok: true, files };
      } catch {
        return { ok: true, files: [] };
      }
    },
  );

  // V1.1 — reveal the case's VTK output in the OS file manager. Falls back to
  // the case dir itself if VTK hasn't been written yet (e.g. solver error
  // before foamToVTK ran). Returns the path actually revealed so the UI can
  // surface it as a status message.
  ipcMain.handle(
    IpcChannels.resultsRevealVTK,
    async (_evt, args: unknown) => {
      const { caseDir } = z.object({ caseDir: z.string() }).parse(args);
      const vtkDir = path.join(caseDir, "VTK");
      let target = caseDir;
      try {
        const stat = await fs.stat(vtkDir);
        if (stat.isDirectory()) target = vtkDir;
      } catch {
        /* VTK doesn't exist yet; fall back to case dir */
      }
      shell.showItemInFolder(target);
      return { ok: true, revealed: target };
    },
  );

  ipcMain.handle(
    IpcChannels.resultsOpenVTKDir,
    async (_evt, args: unknown) => {
      const { caseDir } = z.object({ caseDir: z.string() }).parse(args);
      const vtkDir = path.join(caseDir, "VTK");
      let target = caseDir;
      try {
        const stat = await fs.stat(vtkDir);
        if (stat.isDirectory()) target = vtkDir;
      } catch {
        /* fall back to case dir */
      }
      // openPath returns '' on success, or an error string. We swallow the
      // error string into the IPC reply so the renderer can show it.
      const result = await shell.openPath(target);
      return { ok: result.length === 0, opened: target, error: result || undefined };
    },
  );

  ipcMain.handle(
    IpcChannels.resultsRead,
    async (_evt, args: unknown) => {
      const { caseDir, time, field } = z
        .object({ caseDir: z.string(), time: z.number(), field: z.string() })
        .parse(args);
      // Minimal: read <caseDir>/<time>/<field> as text for VTK parsing in renderer.
      const p = path.join(caseDir, String(time), field);
      try {
        const text = await fs.readFile(p, 'utf8');
        return { ok: true, text };
      } catch (err) {
        return { ok: false, message: String(err) };
      }
    },
  );

  // -------------- Geometry preparation (added in V0.5) --------------

  ipcMain.handle(
    IpcChannels.geometryFilePickAndRead,
    async (_evt, args: unknown) => {
      // V1.35c -- parse via the named GeometryFilePickArgsSchema
      //  from @shared/types instead of the previously-inline
      //  `z.object({ format: enum })` shape. Vitest drift-tests the
      //  named schema without needing electron's `dialog` import.
      const { format } = GeometryFilePickArgsSchema.parse(args);
      const ext = format === 'STEP' ? 'stp' : format === 'IGES' ? 'igs' : 'stl';
      const result = await dialog.showOpenDialog({
        title: `Import ${format} geometry`,
        properties: ['openFile'],
        filters: [
          { name: `${format} (${format === 'STEP' ? 'STEP' : format})`, extensions: [ext, ext.toLowerCase()] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const filePath = result.filePaths[0]!;
      const buf = await fs.readFile(filePath);
      // Return Uint8Array view (structured-cloneable across IPC).
      return { path: filePath, bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
    },
  );

  ipcMain.handle(
    IpcChannels.geometryFileWrite,
    async (_evt, args: unknown) => {
      // V1.35c -- parse via the named GeometryFileWriteArgsSchema.
      //  Same lift rationale as geometryFilePickAndRead above.
      const { path: target, bytes } = GeometryFileWriteArgsSchema.parse(args);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(bytes));
    },
  );

  // Reuse the same scan-as-case logic but expose for the geometry panel.
  ipcMain.handle(IpcChannels.geometryCaseList, async () => {
    const root = await getRunRoot();
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      const dirs = await Promise.all(
        entries
          .filter((e) => e.isDirectory())
          .map(async (e) => {
            const full = path.join(root, e.name);
            const state = await loadCaseState(full).catch(() => null);
            const mtime = (await fs.stat(full)).mtimeMs;
            return state ? { dir: full, name: e.name, kind: state.kind, mtime } : null;
          }),
      );
      return { ok: true, runs: dirs.filter(Boolean).sort((a, b) => (b!.mtime - a!.mtime)) };
    } catch {
      return { ok: true, runs: [] };
    }
  });
}

// buildRunPipeline lives in @main/openfoam/runner now (V0.6). It accepts an object
// { cores, solver, geometryKind } and conditionally inserts a 'snapping' stage
// for imported / snappy-driven cases.

let cachedSettings: z.infer<typeof AppSettingsSchema> | null = null;
async function getRunRoot(): Promise<string> {
  if (!cachedSettings) {
    try {
      const raw = await fs.readFile(settingsPath(), 'utf8');
      cachedSettings = AppSettingsSchema.parse(JSON.parse(raw));
    } catch {
      cachedSettings = AppSettingsSchema.parse({});
    }
  }
  return cachedSettings.defaultRunRoot || defaultRunRoot();
}

function settingsPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.config', 'cfd-studio', 'settings.json');
}

async function pickCaseDir(label?: string): Promise<string> {
  const root = await getRunRoot();
  await ensureDir(root);
  const safe = (label || 'case').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(root, `${safe}__${stamp}`);
}

export type { RunResult };

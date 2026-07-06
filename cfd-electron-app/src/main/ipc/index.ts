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
// V1.36a — import helpers into local scope (not just via re-export).
// `export { ... } from '@main/ipc/helpers'` would expose the names to
//  importers of the barrel, but NOT bind them into this file's module
//  scope — a subtler TS rule than V1.34-V1.35c helpers lifted from
//  case.ts/runner.ts (those files used the helpers *inside* their own
//  scope, so an indirect re-export was sufficient). The IPC handler
//  closures here MUST reference `listCasesAt`, `parseResultTimes`, etc.
//  directly, so we need a real local `import` paired with a plain
//  `export { ... }` at the bottom to maintain the production-callable
//  surface via `@main/ipc`.
import {
  resolveResultTarget,
  parseResultTimes,
  parseResultFields,
  listCasesAt,
  formatOpenPathReply,
  readSettingsFromDisk,
  writeSettingsToDisk,
  // V1.36c — paired with the resultsRead handler shrink below; vitest
  //  imports this directly from @main/ipc/helpers to skip the
  //  barrel's electron import chain.
  readResultField,
  // V1.36d — case-flow IPC handler-body lift. See the JSDoc blocks in
  //  helpers.ts for the design rationale (separate the pure
  //  sanitize+stamp+reply-shape logic from the impure
  //  getRunRoot/ensureDir side-effects + saveCase composition).
  pickCaseDirName,
  formatCaseSaveReply,
  formatCaseCreateReply,
  formatCaseLoadReply,
  // V1.36e — geometry file pair handler-body lift (format→ext
  //  lookup, Buffer→Uint8Array view shaping, mkdir-recursive +
  //  writeFile composition). Same lift rationale as V1.36a/d: the
  //  electron-coupled `dialog.showOpenDialog` call stays inline,
  //  the pure config bits move to helpers.
  pickFormatExtension,
  formatGeometryReadReply,
  writeGeometryFile,
  formatRunCancelReply,
  // V1.36g — final run-lifecycle reply shaper pair (runStart +
  //  runStatus). runStatus is generic on the active-run element
  //  type so helpers.ts stays runner-free.
  formatRunStartReply,
  formatRunStatusReply,
} from '@main/ipc/helpers';
import { IpcChannels } from '@shared/types';
import { dialog, shell } from 'electron';
import {
  AppSettingsSchema,
  BoundaryConditionsSchema,
  CaseKindSchema,
  DomainSchema,
  Domain,
  type CaseKind,
  GeometryFilePickArgsSchema,
  GeometryFileWriteArgsSchema,
  // V1.36c — IPC envelope schemas lifted out of the previously-inline
  //  `z.object({...})` parses in openfoamVerifyBashrc + resultsRead so
  //  the renderer/main wire-format contract is testable without
  //  pulling in Electron (same blocker V1.35c closed for the two
  //  geometry envelope schemas above). The drift-safety pin for
  //  VerifyBashrcArgsSchema lives in
  //  src/shared/__tests__/verify-bashrc-args.test.ts.
  VerifyBashrcArgsSchema,
  ResultReadArgsSchema,
  RunCancelArgsSchema,
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
      // V1.36c — parse via the named VerifyBashrcArgsSchema from
      //  @shared/types instead of the previously-inline
      //  `z.object({ path: z.string() })` shape. Vitest drift-tests
      //  the named schema without needing electron's `ipcMain`
      //  import (same lift rationale as V1.35c's
      //  GeometryFilePickArgsSchema / GeometryFileWriteArgsSchema).
      const { path: bashrcPath } = VerifyBashrcArgsSchema.parse(args);
      return verifyBashrc(bashrcPath);
    },
  );

  ipcMain.handle(
    IpcChannels.openfoamSettingsSave,
    async (_evt, args: unknown) => {
      const parsed = AppSettingsSchema.parse(args);
      const cfgPath = await writeSettingsToDisk(settingsPath(), parsed);
      // Invalidate the in-process cache so the next getRunRoot() / settings read
      // picks up the freshly-saved values (otherwise the renderer could Save,
      // then immediately refresh cases and they'd land in the OLD root).
      cachedSettings = null;
      return { ok: true, path: cfgPath };
    },
  );

  ipcMain.handle(IpcChannels.openfoamSettingsLoad, async () => {
    return readSettingsFromDisk(settingsPath());
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
      // V1.36d — pure reply-shape lifted to helpers.formatCaseCreateReply;
      //  RunResultSchema.parse then enforces the wire-format contract
      //  without re-inlining the literal here. Handler shrinks by 1
      //  literal but the bigger win is that the `message: 'case created'`
      //  user-facing copy is now testable + searchable from one place.
      return RunResultSchema.parse(formatCaseCreateReply(rendered.caseDir));
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
      // V1.36d — reply shape lifted to helpers.formatCaseSaveReply;
      //  pairs structurally with the caseCreate reply above but the
      //  path field differs (the renderer treats caseSave as a
      //  in-place mutation — the `path` key signals "saved to" not
      //  "created at").
      return formatCaseSaveReply(rendered);
    },
  );

  ipcMain.handle(
    IpcChannels.caseLoad,
    async (_evt, args: unknown) => {
      const input = z.object({ caseDir: z.string() }).parse(args);
      const state = await loadCaseState(input.caseDir);
      // V1.36d — discriminator (null → ok:false, present → ok:true w/
      //  spread + domain-resurface) lifted to helpers.formatCaseLoadReply.
      //  The IPC handler now only owns the parse + loadCaseState call;
      //  the reply shape + the comment-intended domain-resurface logic
      //  lives in a testable helper.
      return formatCaseLoadReply(state, input.caseDir);
    },
  );

  ipcMain.handle(IpcChannels.caseList, async () => {
    const root = await getRunRoot();
    return { ok: true, runs: await listCasesAt(root) };
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
      // V1.36g — reply literal lifted to helpers.formatRunStartReply;
      //  RunResultSchema.parse then enforces the wire-format contract
      //  without re-inlining the literal here.
      return RunResultSchema.parse(formatRunStartReply({ runId: id, caseDir: input.caseDir }));
    },
  );

  ipcMain.handle(IpcChannels.runCancel, async (_evt, args: unknown) => {
    // V1.36f — parse via the named RunCancelArgsSchema from
    //  @shared/types (was previously inline `z.object({ runId:
    //  z.string() })`); reply shape delegated to
    //  helpers.formatRunCancelReply. Handler shrinks to 2 lines
    //  of orchestration: parse, cancelRun, reply.
    const { runId } = RunCancelArgsSchema.parse(args);
    return formatRunCancelReply(cancelRun(runId), runId);
  });

  // V1.36g — reply shaper lifted to helpers.formatRunStatusReply
  //  (generic on the active-run element type so helpers.ts stays
  //  runner-free; TS infers T from listActiveRuns() at the call site).
  ipcMain.handle(IpcChannels.runStatus, async () => formatRunStatusReply(listActiveRuns()));

  ipcMain.handle(
    IpcChannels.resultsList,
    async (_evt, args: unknown) => {
      const { caseDir } = z.object({ caseDir: z.string() }).parse(args);
      return { ok: true, times: await parseResultTimes(caseDir) };
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
      return { ok: true, files: await parseResultFields(caseDir, time) };
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
      const target = await resolveResultTarget(caseDir);
      shell.showItemInFolder(target);
      return { ok: true, revealed: target };
    },
  );

  ipcMain.handle(
    IpcChannels.resultsOpenVTKDir,
    async (_evt, args: unknown) => {
      const { caseDir } = z.object({ caseDir: z.string() }).parse(args);
      const target = await resolveResultTarget(caseDir);
      // openPath returns '' on success, or an error string. We swallow the
      // error string into the IPC reply so the renderer can show it.
      const errorString = await shell.openPath(target);
      return formatOpenPathReply(target, errorString);
    },
  );

  ipcMain.handle(
    IpcChannels.resultsRead,
    async (_evt, args: unknown) => {
      // V1.36c — parse via the named ResultReadArgsSchema from
      //  @shared/types; delegate the fs read + try/catch envelope to
      //  the readResultField helper in @main/ipc/helpers (electron-
      //  free module; vitest exercises it directly). Handler shrinks
      //  from 12 lines to 3.
      const { caseDir, time, field } = ResultReadArgsSchema.parse(args);
      return readResultField(caseDir, time, field);
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
      // V1.36e -- extension picker lifted to helpers.pickFormatExtension.
      //  The dialog.showOpenDialog call stays inline (electron-coupled)
      //  but the format→ext mapping has a single testable surface.
      const ext = pickFormatExtension(format);
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
      // V1.36e -- Uint8Array view construction lifted to
      //  helpers.formatGeometryReadReply (preserves the original
      //  zero-copy view shape; renderer side receives a structured-
      //  cloneable Uint8Array over the same ArrayBuffer).
      return formatGeometryReadReply(buf, filePath);
    },
  );

  ipcMain.handle(
    IpcChannels.geometryFileWrite,
    async (_evt, args: unknown) => {
      // V1.35c -- parse via the named GeometryFileWriteArgsSchema.
      //  Same lift rationale as geometryFilePickAndRead above.
      const { path: target, bytes } = GeometryFileWriteArgsSchema.parse(args);
      // V1.36e -- mkdir-recursive parent + writeFile composition
      //  lifted to helpers.writeGeometryFile. Handler shrinks from
      //  2 fs calls to 1 delegation.
      await writeGeometryFile(target, bytes);
    },
  );

  // Reuse the same scan-as-case logic but expose for the geometry panel.
  ipcMain.handle(IpcChannels.geometryCaseList, async () => {
    const root = await getRunRoot();
    return { ok: true, runs: await listCasesAt(root) };
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
  // V1.36d — pure filename assembly (sanitize + ISO stamp + join)
  //  delegated to helpers.pickCaseDirName. The impure prelude
  //  (getRunRoot needs the settings cache + ensureDir writes to disk)
  //  stays in the barrel.
  return pickCaseDirName(root, label);
}

// ---------------- V1.36a: pure-fn handlers, re-exported ----------------
//
// The IPC handler closures above used to inline-mount fs + dirent logic
// repeated across 6 handlers (caseList, geometryCaseList, resultsList,
// resultsListFields, resultsRevealVTK, resultsOpenVTKDir). V1.36a lifted
// each block of inline logic into a named helper living in
// @main/ipc/helpers (electron-free module — the barrel here imports
// electron at module-load, which crashes vitest's node env). Production
// callers can keep importing from '@main/ipc' via this re-export.

export {
  resolveResultTarget,
  parseResultTimes,
  parseResultFields,
  listCasesAt,
  formatOpenPathReply,
  readSettingsFromDisk,
  writeSettingsToDisk,
  readResultField,
  // V1.36d — case-flow pure helpers lifted from the caseCreate /
  //  caseSave / caseLoad / pickCaseDir IPC handler bodies.
  pickCaseDirName,
  formatCaseSaveReply,
  formatCaseCreateReply,
  formatCaseLoadReply,
  // V1.36e — geometry file pair pure / fs-based helpers lifted
  //  from the geometryFilePickAndRead + geometryFileWrite IPC
  //  handler bodies. See JSDoc in helpers.ts for the design
  //  rationale (separate the pure format→ext + Buffer→Uint8Array
  //  bits from the electron-coupled dialog.showOpenDialog call).
  pickFormatExtension,
  formatGeometryReadReply,
  writeGeometryFile,
  formatRunCancelReply,
  // V1.36g — final run-lifecycle reply shaper pair (runStart +
  //  runStatus). Closes the V1.36* IPC handler-body coverage
  //  chain: the only remaining un-lifted handler is openfoamDetect
  //  (1-line pass-through, no lift value).
  formatRunStartReply,
  formatRunStatusReply,
};

export type { RunResult };

/**
 * V1.36a — pure-function helpers extracted from src/main/ipc/index.ts.
 *
 * The IPC handler barrel imports `electron`'s `ipcMain`, `dialog`, and `shell`
 * at module-load time; those imports fail under vitest's node env (no electron
 * runtime). To keep the helpers testable WITHOUT mocking electron, they're
 * held here in this dedicated electron-free module. The barrel
 * (`src/main/ipc/index.ts`) re-exports them so production callers can still
 * import through `@main/ipc`.
 *
 * IPC contract: every helper tolerates a missing / wrong-typed input path
 * and returns its documented fallback rather than throwing — this matches
 * the inline `try/catch` behavior of the IPC handlers they replace, so the
 * renderer never sees an IPC-level rejection when fs says ENOENT.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadCaseState } from '@main/openfoam/case';
import { AppSettingsSchema, type CaseKind, type AppSettings } from '@shared/types';

export type CaseListing = { dir: string; name: string; kind: CaseKind; mtime: number };
export type OpenPathReply = { ok: boolean; opened: string; error?: string };

/** Resolve the on-disk directory that should be revealed/opened for a case's
 *  post-processing outputs. Prefers `<caseDir>/VTK` when present and a
 *  directory; falls back to `<caseDir>` itself when the case hasn't reached
 *  the foamToVTK step yet (e.g. solver error before VTK was written). */
export async function resolveResultTarget(caseDir: string): Promise<string> {
  const vtkDir = path.join(caseDir, 'VTK');
  try {
    const stat = await fs.stat(vtkDir);
    if (stat.isDirectory()) return vtkDir;
  } catch {
    /* VTK doesn't exist yet; fall back to case dir */
  }
  return caseDir;
}

/** Numeric solver time directories under a case, sorted ascending.
 *  Filters on the OpenFOAM time-name regex `/^[-0-9.]+$/` (sign + digits +
 *  dots only — no letters, no exponents, no scientific-notation). Missing
 *  or unreadable caseDir → empty array (IPC contract: never throw).
 *
 *  Note on the leading-minus in the regex: it is a defensive branch, not
 *  a current OpenFOAM emit case (PIMPLE/icoFoam transient times are all
 *  >= 0). It is preserved so a future solver that may emit negative
 *  iterative time markers does not silently fail the filter. A drift-pin
 *  test in result-cases-handlers.test.ts#parseResultTimes asserts that
 *  `'-0.5'` directories pass the filter — do not simplify the regex to
 *  `/^[0-9.]+$/` without revisiting that test. */
export async function parseResultTimes(caseDir: string): Promise<number[]> {
  try {
    const entries = await fs.readdir(caseDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && /^[-0-9.]+$/.test(e.name))
      .map((e) => parseFloat(e.name))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** Field-file names flat at the top of one time directory. Skips dotfiles
 *  and any sub-directories (those are aggregate/series subtrees, not VTK
 *  fields). Missing/unreadable dir → empty array (IPC contract). */
export async function parseResultFields(caseDir: string, time: number): Promise<string[]> {
  try {
    const dir = path.join(caseDir, String(time));
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Discriminator for `shell.openPath`'s return: empty string on success,
 *  any non-empty string is the error message. The IPC reply shape
 *  `{ ok, opened, error? }` is consumed by the renderer's "Open in Finder"
 *  button + status messages. */
export function formatOpenPathReply(target: string, errorString: string): OpenPathReply {
  return { ok: errorString.length === 0, opened: target, error: errorString || undefined };
}

/** Listing persistent case sub-directories under a single root. Reads the
 *  `.cfd-app-state.json` for each sub-dir via `loadCaseState` and surfaces
 *  only the ones with valid state. Missing/unreadable root → empty array.
 *  Used by both `caseList` (Run panel) and `geometryCaseList` (Geometry
 *  panel) IPC handlers; parameterized on root so each can pass its own
 *  `getRunRoot()` without coupling. */
export async function listCasesAt(root: string): Promise<CaseListing[]> {
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
    return dirs.filter((d): d is CaseListing => d !== null);
  } catch {
    return [];
  }
}

/** Read + parse the persisted settings JSON at `settingsPath`. Returns the
 *  parsed `AppSettings` on success. On any failure (missing file,
 *  malformed JSON, Zod-invalid schema, fs error) returns the SAME
 *  `AppSettingsSchema.parse({})` shape — i.e., a fresh empty Settings
 *  object — matching the inline `catch` block in the openfoamSettingsLoad
 *  IPC handler whose purpose is "first call returns a sensible default".
 *
 *  Pure transformation: parameterized on `settingsPath` so vitest can drive
 *  a real tmpdir without touching `process.env.HOME`.
 *
 *  Note: the IPC handler also maintains a module-level `cachedSettings`
 *  memo to avoid re-reading on every IPC call. That cache stays in the
 *  barrel; this helper is the deterministic pure read-side of the
 *  operation. The handler composes helper + cache. */
export async function readSettingsFromDisk(settingsPath: string): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    return AppSettingsSchema.parse(JSON.parse(raw));
  } catch {
    return AppSettingsSchema.parse({});
  }
}

/** Write the supplied `AppSettings` as pretty-printed JSON (2-space
 *  indent) at `settingsPath`. Creates the parent directory tree if
 *  missing (mirrors the `mkdir -p` semantics an electron app expects
 *  on first save in a fresh home). No throw on permission/parent issues:
 *  any error propagates to the caller (the IPC handler wraps in
 *  `{ ok: false, error }` if a future V.x wants a softer contract).
 *
 *  Returns the resolved `settingsPath` so callers logging "saved to X"
 *  don't need to recompute. */
export async function writeSettingsToDisk(
  settingsPath: string,
  settings: AppSettings,
): Promise<string> {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  return settingsPath;
}

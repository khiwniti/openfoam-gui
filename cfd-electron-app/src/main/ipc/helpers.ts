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
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { loadCaseState } from '@main/openfoam/case';
import { AppSettingsSchema, type CaseKind, type AppSettings, type GeometryFormat } from '@shared/types';

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

/** Read a single field file from a transient OpenFOAM case at
 *  `<caseDir>/<time>/<field>`. Mirrors the inline body of the original
 *  resultsRead IPC handler — returns `{ ok: true, text }` on success
 *  or `{ ok: false, message }` on any read failure (ENOENT, EISDIR,
 *  EACCES, etc.).
 *
 *  IPC contract: never throw. The renderer surfaces the message string
 *  verbatim as an error toast; the producer-side curve in case.ts /
 *  VTK writer is the upstream consumer that hands the text to the
 *  Three.js VTK parser.
 *
 *  Note on `String(err)`: the inline handler used `String(err)` which
 *  coerces non-Error throws to a sensible string `"5"` or `"null"` etc.
 *  We preserve that exact coercion so the renderer sees the same
 *  message shape it has always seen.
 *
 *  The `time` parameter is joined as `String(time)` to match the
 *  OpenFOAM `<caseDir>/<time>/<field>` directory layout where `time`
 *  is the user-facing time string (e.g., "0.5", "1", "0.0001"). */
export async function readResultField(
  caseDir: string,
  time: number,
  field: string,
): Promise<ResultReadReply> {
  const p = path.join(caseDir, String(time), field);
  try {
    const text = await fs.readFile(p, 'utf8');
    return { ok: true, text };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/** Reply shape for `readResultField`. Discriminated union on `ok` so
 *  the renderer side (and the test pin below) can branch on success
 *  vs error without re-reading a string field name. */
export type ResultReadReply =
  | { ok: true; text: string }
  | { ok: false; message: string };

// -------------------- V1.36d: case-flow handler payloads --------------------
//
// The case-flow IPC handlers (caseCreate, caseSave, caseLoad) + the local
// `pickCaseDir()` helper all share two small pure utilities: (1) build a
// safe-filename + timestamped case directory name under a given root,
// and (2) wrap render-side / state-side result objects in the
// `{ ok: true, ... } | { ok: false, message }` shape the renderer expects.
// V1.36d lifts them so the case handlers shrink to thin shells and the
// sanitization + stamping rules have a single testable surface (instead
// of being buried inside the IPC barrel where they can't be exercised
// without an electron runtime).

/** Pure: replace every non-`[a-zA-Z0-9_-]` char in `label` with `_` and
 *  slice to 60 chars. Defaults to the literal `'case'` when `label` is
 *  undefined / empty so the directory name always has at least one
 *  human-readable component before the timestamp. Mirrors the inline
 *  `(label || 'case').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)` from
 *  the original `pickCaseDir`. Exposed privately (not re-exported) so
 *  callers use `pickCaseDirName` directly and don't go around it. */
function sanitizeCaseLabel(label: string | undefined): string {
  return (label || 'case').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
}

/** Pure: turn a Date into a filesystem-safe timestamp suffix for a case
 *  directory name. OpenFOAM time-names are numeric only; our case-names
 *  use an ISO-8601 slice with `:` and `.` replaced so the path is
 *  portable across platforms that reject those characters in filenames.
 *  Shape: `YYYY-MM-DDTHH-MM-SS` (the leading `T` is preserved so the
 *  operator can visually separate the date + time parts at-a-glance).
 *  Exposed privately; use `pickCaseDirName` which calls this with
 *  `new Date()` by default but accepts a `now: Date` override for
 *  deterministic test pinning. */
function formatCaseDirTimestamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** Build the full on-disk directory name for a new case under `root`.
 *  Pure transformation: `root + sanitize(label) + '__' + isoStamp`. No
 *  `mkdir`, no env reads, no settings cache touch. The IPC handler
 *  composes this with `getRunRoot()` + `ensureDir()` to produce a
 *  real directory; both side-effects stay in the barrel.
 *
 *  Accepts an optional `now: Date` so deterministic tests can pin the
 *  timestamp via `vi.setSystemTime(...)` (vitest fakes `Date.now()` /
 *  `new Date()` globally). Production callers omit it. */
export function pickCaseDirName(
  root: string,
  label?: string,
  now: Date = new Date(),
): string {
  const safe = sanitizeCaseLabel(label);
  const stamp = formatCaseDirTimestamp(now);
  return path.join(root, `${safe}__${stamp}`);
}

/** Reply the caseSave IPC handler sends to the renderer. Wraps the
 *  out-param caseDir in the IPC-level `{ ok, path }` envelope so the
 *  renderer can branch on success without re-validating. */
export type CaseSaveReply = { ok: true; path: string };

export function formatCaseSaveReply(rendered: { caseDir: string }): CaseSaveReply {
  return { ok: true, path: rendered.caseDir };
}

/** Reply the caseCreate IPC handler sends to the renderer (not yet
 *  passed through RunResultSchema.parse — see the call site for the
 *  schema parse that follows). The `message` is the user-facing toast
 *  copy; the `caseDir` is what the renderer immediately re-issues
 *  caseLoad / runStart against. */
export type CaseCreateReply = { ok: true; message: string; caseDir: string };

export function formatCaseCreateReply(caseDir: string): CaseCreateReply {
  return { ok: true, message: 'case created', caseDir };
}

/** Reply the caseLoad IPC handler sends to the renderer. Discriminated
 *  on `ok`:
 *    - `false` — no sidecar state file at `caseDir`; renderer shows the
 *      empty-state message verbatim.
 *    - `true` — spreads every field the persisted state had (kind,
 *      domain, bc, …) plus `caseDir`. The `domain` field is included
 *      transitively via the spread (S has a `domain` key per the
 *      constraint) — the inline handler's "Surface the Domain
 *      explicitly so the renderer can keep using it" snappy-fallback
 *      intent is preserved because the spread carries it through.
 *
 *  V1.36d round-2 reviewer-fix: the helper is generic on `S extends
 *  { domain: unknown }` so (a) TS statically rejects call sites that
 *  pass a state shape without a `domain` key (the inline handler
 *  always relies on `state.domain`), (b) the inferred return type
 *  preserves every spread-field type AND the `domain` field's
 *  precise type via `S['domain']` rather than collapsing to
 *  `unknown`, and (c) the `as Record<string, unknown>` cast from
 *  round 1 is gone — the generic constraint encodes the runtime
 *  contract that the cast was working around.
 *  Callers can let TS infer `S` from the loadCaseState return type
 *  or pin it explicitly (`formatCaseLoadReply<PersistedCaseState>(...)`). */
export type CaseLoadReply<S extends { domain: unknown }> =
  | { ok: false; message: string }
  | ({ ok: true; caseDir: string } & S);

export function formatCaseLoadReply<S extends { domain: unknown }>(
  state: S | null,
  caseDir: string,
): CaseLoadReply<S> {
  if (!state) return { ok: false, message: 'No .cfd-app-state.json' };
  return { ok: true, ...state, caseDir };
}

// -------------------- V1.36e: geometry file pair payloads --------------------
//
// The geometryFilePickAndRead + geometryFileWrite IPC handlers share
// three small pure / fs-based utilities: (1) a format→file-extension
// lookup used to populate the OS file-picker filters, (2) a buffer
// →Uint8Array-view shaping for the IPC structured-clone envelope, and
// (3) the mkdir-recursive + writeFile pair that the write handler
// repeated inline. V1.36e lifts them so the two geometry handlers
// shrink to thin shells and each utility has a single testable
// surface (the `dialog.showOpenDialog` call stays inline because
// it's electron-coupled; the dialog-config *builder* is small enough
// to leave inline too).

/** Pure: map a `GeometryFormat` enum member to the corresponding
 *  CAD/CFD file extension. Used by the geometryFilePickAndRead
 *  handler to populate the OS file-picker's `filters` list. Mirrors
 *  the inline `format === 'STEP' ? 'stp' : format === 'IGES' ? 'igs'
 *  : 'stl'` ternary from the original handler. `STL` is the
 *  default-fallthrough (any future format addition that isn't STEP or
 *  IGES will land here, preserving the original "STL is everything
 *  else" semantics). */
export function pickFormatExtension(format: GeometryFormat): 'stp' | 'igs' | 'stl' {
  if (format === 'STEP') return 'stp';
  if (format === 'IGES') return 'igs';
  return 'stl';
}

/** Reply the geometryFilePickAndRead IPC handler sends to the renderer.
 *  Shape: `{ path, bytes }` where `bytes` is a `Uint8Array` view
 *  over the on-disk file's underlying `ArrayBuffer` (zero-copy;
 *  structured-cloneable across Electron's IPC channel — `Buffer`
 *  itself is NOT cloneable, the view is what survives the bridge).
 *  Mirrors the inline `new Uint8Array(buf.buffer, buf.byteOffset,
 *  buf.byteLength)` from the original handler. */
export type GeometryReadReply = { path: string; bytes: Uint8Array };

export function formatGeometryReadReply(buf: Buffer, filePath: string): GeometryReadReply {
  return { path: filePath, bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
}

/** Write the supplied `Uint8Array` bytes to `target` after creating
 *  the parent directory tree if missing (mkdir-recursive, matches the
 *  `mkdir -p` semantics a fresh-user-first-save scenario requires).
 *  Mirrors the inline `fs.mkdir(path.dirname(target), { recursive:
 *  true }) + fs.writeFile(target, Buffer.from(bytes))` pair from the
 *  geometryFileWrite IPC handler. Errors propagate to the caller
 *  (the IPC handler currently lets Electron translate them to a
 *  generic rejection; a future V.x may want a softer envelope
 *  analogous to readSettingsFromDisk's no-throw contract). */
export async function writeGeometryFile(target: string, bytes: Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, Buffer.from(bytes));
}

// -------------------- V1.36f: run-cancel reply shaper --------------------
//
// The runCancel IPC handler's inline body returned a small
// `{ ok: cancelRun(runId), runId }` literal. V1.36f lifts the
// envelope-shape assembly to a named helper so the `ok: true|false`
// contract has a single testable surface and the IPC handler shrinks
// to a thin parse + cancelRun + delegation shell. The envelope
// schema (RunCancelArgsSchema) lives in @shared/types per the
// V1.35c/V1.36c drift-safety-pair pattern; the reply shaper lives
// here because it's electron-free and benefits from direct vitest
// coverage without mocking the IPC handler's call site.

/** Reply the runCancel IPC handler sends to the renderer. The `ok`
 *  field is the boolean return of `cancelRun(runId)` from
 *  @main/openfoam/runner — true if a live run was found + cancelled,
 *  false if no such runId was active. The `runId` is echoed back
 *  verbatim so the renderer can correlate the reply with the
 *  in-flight cancel click (the IPC is fire-and-forget from the
 *  renderer's perspective; the echo is the only way the renderer
 *  can know which run was affected). */
export type RunCancelReply = { ok: boolean; runId: string };

export function formatRunCancelReply(canceled: boolean, runId: string): RunCancelReply {
  return { ok: canceled, runId };
}

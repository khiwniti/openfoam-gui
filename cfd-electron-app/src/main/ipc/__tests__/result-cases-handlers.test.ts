/**
 * V1.36a — coverage closure for the 5 IPC helpers lifted from
 *  src/main/ipc/index.ts (resolveResultTarget, parseResultTimes,
 *  parseResultFields, listCasesAt, formatOpenPathReply).
 *
 * The helpers are pure fs + dirent logic that used to be inlined into
 * the IPC handler closures; the IPC handler bodies are now thin shells
 * that delegate here. Each describe block stresses one helper's
 *  IPC contract: missing inputs must return their documented fallback
 *  (empty array / parent path / ok=true) rather than throwing.
 *
 * Test pattern: every test gets a fresh mkdtempSync'd tmp; afterEach
 *  cleans up. No electron mocking needed — these helpers touch only the
 *  node:fs + node:os APIs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  resolveResultTarget,
  parseResultTimes,
  parseResultFields,
  listCasesAt,
  formatOpenPathReply,
} from '@main/ipc/helpers';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'v136a-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Build a `.cfd-app-state.json` matching the runtime contract — kinds are
 *  real CaseKind enum members from `@shared/types`. Used by `listCasesAt`
 *  tests; intentionally tiny (just `{ kind }`) since `loadCaseState` will
 *  treat it as best-effort metadata. */
function writeCaseState(caseDir: string, kind: 'cavity' | 'channel' | 'cylinder' | 'airfoil' = 'cavity') {
  writeFileSync(path.join(caseDir, '.cfd-app-state.json'), JSON.stringify({ kind }), 'utf8');
}

// V1.36a — vitest-mock loadCaseState to bypass case.ts's
//  DomainSchema.parse() strict-Zod gate. The runtime loadCaseState
//  validates the on-disk state file against the full saved-state
//  schema (which requires `domain`, `version`, etc.); tests below
//  only write a minimal `{ kind }` because the listCasesAt code
//  only reads `state.kind`. Without this mock the runtime guard
//  rejects the tiny test fixtures and listCasesAt returns `[]`
//  for valid-stated sub-dirs. The mock is a faithful read-side-only
//  pairing of what loadCaseState does *for listCasesAt's purposes*:
//  parse the JSON, hand back the fields the test cares about. We
//  deliberately DON'T round-trip DomainSchema here — that's exactly
//  what we want to skip.
vi.mock('@main/openfoam/case', async () => {
  const fs = await import('node:fs/promises');
  const _path = await import('node:path');
  return {
    loadCaseState: async (caseDir: string) => {
      try {
        const raw = await fs.readFile(_path.join(caseDir, '.cfd-app-state.json'), 'utf8');
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
  };
});

// ---------------- resolveResultTarget (4) ----------------

describe('resolveResultTarget', () => {
  it('returns <caseDir>/VTK when VTK exists and is a directory', async () => {
    const caseDir = path.join(tmp, 'case');
    mkdirSync(path.join(caseDir, 'VTK'), { recursive: true });
    expect(await resolveResultTarget(caseDir)).toBe(path.join(caseDir, 'VTK'));
  });

  it('falls back to <caseDir> when VTK does not exist (case has not run VTK conversion yet)', async () => {
    const caseDir = path.join(tmp, 'case');
    mkdirSync(caseDir, { recursive: true });
    expect(await resolveResultTarget(caseDir)).toBe(caseDir);
  });

  it('falls back to <caseDir> when VTK exists but is a file (defensive — solver error, wrong artifact)', async () => {
    const caseDir = path.join(tmp, 'case');
    mkdirSync(caseDir, { recursive: true });
    writeFileSync(path.join(caseDir, 'VTK'), 'a misplaced file');
    expect(await resolveResultTarget(caseDir)).toBe(caseDir);
  });

  it('gracefully handles missing caseDir — returns the missing path it was given (IPC contract: no throw)', async () => {
    const missing = path.join(tmp, 'case-that-never-existed');
    expect(await resolveResultTarget(missing)).toBe(missing);
  });
});

// ---------------- parseResultTimes (6) ----------------

describe('parseResultTimes', () => {
  it('returns [] for a fresh empty caseDir', async () => {
    const caseDir = path.join(tmp, 'empty-case');
    mkdirSync(caseDir, { recursive: true });
    expect(await parseResultTimes(caseDir)).toEqual([]);
  });

  it('parses pure numeric time directories and sorts ascending in the IPC reply', async () => {
    const caseDir = path.join(tmp, 'case');
    // Insert out-of-order on disk to confirm the sort comes from the helper,
    // not from filesystem ordering.
    mkdirSync(path.join(caseDir, '1'), { recursive: true });
    mkdirSync(path.join(caseDir, '0.5'), { recursive: true });
    mkdirSync(path.join(caseDir, '0'), { recursive: true });
    expect(await parseResultTimes(caseDir)).toEqual([0, 0.5, 1]);
  });

  it('skips sidecar directories (constant, processor*, postProcessing, system)', async () => {
    const caseDir = path.join(tmp, 'case');
    for (const sub of ['0', 'constant', 'processor0', 'processor3', 'postProcessing', 'system']) {
      mkdirSync(path.join(caseDir, sub), { recursive: true });
    }
    expect(await parseResultTimes(caseDir)).toEqual([0]);
  });

  it('pins the sidecar-filter intent: only numeric time dirs surface, the leading-minus is defensive (see helpers.ts note), and scientific-notation + punctuation-broken names are excluded', async () => {
    const caseDir = path.join(tmp, 'case');
    for (const sub of [
      '0',          // numeric — surface
      '0.5',        // numeric — surface
      '1',          // numeric — surface
      'postProcessing',  // non-numeric letters — filter
      'constant',        // non-numeric letters — filter
      'processor0',      // non-numeric letters — filter
      'processor3',      // non-numeric letters — filter
      'system',          // non-numeric letters — filter
      'log',             // short word — filter (also would fail parseFloat)
      '1.5e-3',          // scientific notation — filter (regex excludes 'e')
      '0.5;',            // punctuation after digit — filter
    ]) {
      mkdirSync(path.join(caseDir, sub), { recursive: true });
    }
    expect(await parseResultTimes(caseDir)).toEqual([0, 0.5, 1]);
  });

  it('returns [] for missing caseDir (IPC contract: never throw)', async () => {
    const missing = path.join(tmp, 'never-existed');
    expect(await parseResultTimes(missing)).toEqual([]);
  });

  it('returns [] when caseDir points at a regular file (no error)', async () => {
    const file = path.join(tmp, 'not-a-dir.txt');
    writeFileSync(file, 'x');
    expect(await parseResultTimes(file)).toEqual([]);
  });
});

// ---------------- parseResultFields (6) ----------------

describe('parseResultFields', () => {
  it('lists the field files flat at the top of a time dir, alphabetically sorted', async () => {
    const caseDir = path.join(tmp, 'case');
    const timeDir = path.join(caseDir, '0.5');
    mkdirSync(timeDir, { recursive: true });
    // Insert out-of-order to confirm sort comes from the helper.
    writeFileSync(path.join(timeDir, 'U'), 'x');
    writeFileSync(path.join(timeDir, 'p'), 'x');
    writeFileSync(path.join(timeDir, 'T'), 'x');
    expect(await parseResultFields(caseDir, 0.5)).toEqual(['T', 'U', 'p']);
  });

  it('skips dotfiles (macOS .DS_Store, Linux config, hidden)', async () => {
    const caseDir = path.join(tmp, 'case');
    const timeDir = path.join(caseDir, '0');
    mkdirSync(timeDir, { recursive: true });
    writeFileSync(path.join(timeDir, 'U'), 'x');
    writeFileSync(path.join(timeDir, '.DS_Store'), 'macos-noisy');
    writeFileSync(path.join(timeDir, '.foo'), 'noise');
    expect(await parseResultFields(caseDir, 0)).toEqual(['U']);
  });

  it('skips sub-directories (aggregates are series, not field files)', async () => {
    const caseDir = path.join(tmp, 'case');
    const timeDir = path.join(caseDir, '0');
    mkdirSync(timeDir, { recursive: true });
    mkdirSync(path.join(timeDir, 'aggregates'), { recursive: true });
    mkdirSync(path.join(timeDir, 'uniform'), { recursive: true });
    writeFileSync(path.join(timeDir, 'U'), 'x');
    expect(await parseResultFields(caseDir, 0)).toEqual(['U']);
  });

  it('returns [] for a missing time dir (IPC contract: never throw)', async () => {
    const missing = path.join(tmp, 'no-case');
    expect(await parseResultFields(missing, 0)).toEqual([]);
  });

  it('returns [] for an empty time dir (no fields written yet)', async () => {
    const caseDir = path.join(tmp, 'case');
    mkdirSync(path.join(caseDir, '0'), { recursive: true });
    expect(await parseResultFields(caseDir, 0)).toEqual([]);
  });

  it('round-trips a non-integer time argument (handler casts `time` to `String(time)` — pin the path)', async () => {
    const caseDir = path.join(tmp, 'case');
    mkdirSync(path.join(caseDir, '0.0001'), { recursive: true });
    writeFileSync(path.join(caseDir, '0.0001', 'U'), 'x');
    expect(await parseResultFields(caseDir, 0.0001)).toEqual(['U']);
  });
});

// ---------------- listCasesAt (5) ----------------

describe('listCasesAt', () => {
  it('returns [] for an empty root', async () => {
    expect(await listCasesAt(tmp)).toEqual([]);
  });

  it('returns the valid-stated sub-dirs sorted by mtime descending; excludes stale sub-dirs without state files', async () => {
    const root = tmp;
    const a = path.join(root, 'a'); mkdirSync(a);
    const b = path.join(root, 'b'); mkdirSync(b);
    const c = path.join(root, 'c-no-state'); mkdirSync(c);
    writeCaseState(a, 'cavity');
    writeCaseState(b, 'channel');
    // a is newer than b → a comes first
    utimesSync(a, new Date(2025, 0, 2), new Date(2025, 0, 2));
    utimesSync(b, new Date(2025, 0, 1), new Date(2025, 0, 1));
    const cases = await listCasesAt(root);
    // Strict field-by-field assertion acting as a regression-pin for the
    // typed-predicate narrowing: if a future maintainer reverts to
    // `filter(Boolean) as Array<...>` and the cast silently slips a null in,
    // these assertions fail loudly at runtime (the `?.` previously masked
    // it). mtime is asserted via the same statSync helper to make the
    // round-trip deterministic.
    expect(cases).toEqual([
      { dir: a, name: 'a', kind: 'cavity', mtime: statSync(a).mtimeMs },
      { dir: b, name: 'b', kind: 'channel', mtime: statSync(b).mtimeMs },
    ]);
  });

  it('excludes sub-dirs whose .cfd-app-state.json is malformed JSON', async () => {
    const root = tmp;
    mkdirSync(path.join(root, 'a-broken'));
    writeFileSync(path.join(root, 'a-broken', '.cfd-app-state.json'), '{ not json');
    expect(await listCasesAt(root)).toEqual([]);
  });

  it('returns [] for missing root (IPC contract: never throw)', async () => {
    const missing = path.join(tmp, 'never-existed');
    expect(await listCasesAt(missing)).toEqual([]);
  });

  it('returns [] when root points at a regular file (no error)', async () => {
    const file = path.join(tmp, 'not-a-dir.txt');
    writeFileSync(file, 'x');
    expect(await listCasesAt(file)).toEqual([]);
  });
});

// ---------------- formatOpenPathReply (4) ----------------

describe('formatOpenPathReply', () => {
  it('returns { ok: true, opened, error: undefined } when errorString is the empty literal', () => {
    expect(formatOpenPathReply('/foo/bar', '')).toEqual({
      ok: true,
      opened: '/foo/bar',
      error: undefined,
    });
  });

  it('returns { ok: false, opened, error } when errorString is non-empty', () => {
    expect(formatOpenPathReply('/foo/bar', 'no handler')).toEqual({
      ok: false,
      opened: '/foo/bar',
      error: 'no handler',
    });
  });

  it('pin: ok=false invariantly whenever errorString is non-empty (4-sample sweep)', () => {
    for (const err of ['a', 'x'.repeat(80), 'path/not/found', 'ENOENT: no such file']) {
      const reply = formatOpenPathReply('/p', err);
      expect(reply.ok).toBe(false);
      expect(reply.error).toBe(err);
    }
  });

  it('pin: whitespace-only errorString is treated as non-empty (no Falsy coercion)', () => {
    // shell.openPath only returns literal '' on success; whitespace pads are
    // error text. Confirm `formatOpenPathReply` does not strip them.
    const reply = formatOpenPathReply('/p', '   ');
    expect(reply.ok).toBe(false);
    expect(reply.error).toBe('   ');
    // And the inverse: literal empty is the only ok=true shape.
    expect(formatOpenPathReply('/p', '').ok).toBe(true);
  });
});

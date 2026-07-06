/**
 * V1.36c — vitest coverage for `readResultField`, the helper lifted out of
 * the previously-inline `resultsRead` IPC handler body. The helper lives
 * in `@main/ipc/helpers` so the tests can import it directly without
 * pulling in Electron (the barrel at `@main/ipc` imports `electron`'s
 * `ipcMain`, which is unavailable in vitest's node env — same blocker
 * V1.35c closed for the geometry envelope schemas).
 *
 * Coverage scope (~6 it-blocks):
 *   - happy path: a real text file under `<tmpdir>/<time>/<field>` round-trips
 *   - missing field file: ENOENT → `ok: false`, message non-empty
 *   - missing caseDir: deeper-than-real-path → `ok: false`, message non-empty
 *   - String(0) coercion pin: time=0 joins as '0' (not '0.0')
 *   - String(0.5) coercion pin: fractional time joins as '0.5' (not '0' or '0.50000')
 *   - directory-at-field-path: ENOENT masquerading as EISDIR → `ok: false`
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile, mkdir, stat } from 'node:fs/promises';
import { readResultField } from '@main/ipc/helpers';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'v136c-rf-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('readResultField — happy path', () => {
  it('reads an existing text field file with verbatim content', async () => {
    // VTK legacy ASCII cell-data header + one data line. Trivial content;
    //  what we pin is that the bytes survive the utf-8 round-trip.
    const text = '# vtk DataFile Version 3.0\ntest data\n';
    const caseDir = workDir;
    await mkdir(path.join(caseDir, '0.5'), { recursive: true });
    await writeFile(path.join(caseDir, '0.5', 'U'), text, 'utf8');

    const result = await readResultField(caseDir, 0.5, 'U');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe(text);
    }
  });
});

describe('readResultField — error paths', () => {
  it('returns ok:false with a non-empty message when the field file is missing', async () => {
    // Directory exists, time dir exists, but the field file does not.
    const caseDir = workDir;
    await mkdir(path.join(caseDir, '0'), { recursive: true });
    // No writeFile for the field.

    const result = await readResultField(caseDir, 0, 'p');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
      // ENOENT is the canonical error string here; pin its presence
      //  rather than the full message so a Node version bump that
      //  shifts the wording doesn't false-positive.
      expect(result.message).toMatch(/ENOENT|no such file/i);
    }
  });

  it('returns ok:false when the parent case directory is missing', async () => {
    // caseDir path itself doesn't exist; fs.readFile should fail and the
    //  helper should swallow + surface the error rather than throw.
    const missing = path.join(workDir, 'does-not-exist');

    const result = await readResultField(missing, 0, 'U');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('returns ok:false when the field path is actually a directory', async () => {
    // A user's VTK output may carry a `0/U` *directory* (aggregate U
    //  series) alongside the typical `0/U` file. fs.readFile on a dir
    //  should fail with EISDIR and the helper should surface ok:false
    //  (mirrors the IPC contract: renderer surfaces the message as a
    //  toast, never an IPC-level rejection).
    const caseDir = workDir;
    await mkdir(path.join(caseDir, '0', 'U'), { recursive: true });

    const result = await readResultField(caseDir, 0, 'U');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
      expect(result.message).toMatch(/EISDIR|is a directory/i);
    }
  });
});

describe('readResultField — String(time) coercion pin', () => {
  // The helper joins `path.join(caseDir, String(time), field)`. These pin
  // the textual coercion so a future refactor to e.g. `.toFixed(6)` doesn't
  // silently shift OpenFOAM's `<caseDir>/0/<field>` directory layout.

  it('joins time=0 as the literal "0"', async () => {
    // Probe: write a sentinel file at the expected `$caseDir/0/p` path,
    //  expect the helper to resolve exactly that path (not $caseDir/0.0/p
    //  nor $caseDir/p).
    const caseDir = workDir;
    await mkdir(path.join(caseDir, '0'), { recursive: true });
    await writeFile(path.join(caseDir, '0', 'p'), 'ZERO\n', 'utf8');

    const result = await readResultField(caseDir, 0, 'p');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('ZERO\n');
    }
  });

  it('joins time=0.5 as the literal "0.5" (no zero-padding)', async () => {
    const caseDir = workDir;
    await mkdir(path.join(caseDir, '0.5'), { recursive: true });
    await writeFile(path.join(caseDir, '0.5', 'U'), 'HALF\n', 'utf8');

    const result = await readResultField(caseDir, 0.5, 'U');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('HALF\n');
    }
  });

  it('does not silently create the file when the directory is missing', async () => {
    // ENOENT case from the parent-missing test above; here we additionally
    //  check the filesystem isn't mutated by the failed read (the helper
    //  must not create intermediate dirs the way writeSettingsToDisk does).
    const caseDir = path.join(workDir, 'phantom');

    await readResultField(caseDir, 0.5, 'U');
    // Read should have failed silently; the phantom dir must NOT exist.
    await expect(stat(caseDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

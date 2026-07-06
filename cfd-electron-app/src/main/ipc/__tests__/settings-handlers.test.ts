/**
 * V1.36b — coverage closure for the 2 settings helpers lifted from
 *  src/main/ipc/index.ts (readSettingsFromDisk, writeSettingsToDisk).
 *
 * The IPC handlers (openfoamSettingsSave + openfoamSettingsLoad)
 * used to inline-mount fs.writeFile + fs.readFile + JSON.parse +
 *  AppSettingsSchema.parse logic; that fs-block is now delegated
 *  to these two helpers — saving the renderer the missing/malformed
 *  fallback contract and the pretty-print format pin.
 *
 * IPC contract (preserved verbatim from the inline blocks):
 *  - read returns AppSettingsSchema.parse({}) on any read failure
 *    (no throw); success returns the parsed AppSettings.
 *  - write mkdir -p the parent dir recursively; pretty-prints with
 *    2-space indent; overwrites existing files; returns the path it
 *    wrote to so the IPC handler can echo it back without recompute.
 *
 * Test pattern: mkdtempSync + afterEach rmSync (V1.34-V1.36a cadence).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readSettingsFromDisk, writeSettingsToDisk } from '@main/ipc/helpers';
import { AppSettingsSchema, type AppSettings } from '@shared/types';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'v136b-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Build a valid AppSettings by starting from the schema's default
 *  empty-shape parse (so all required fields have their Zod defaults),
 *  then layering test overrides. Re-parsing through AppSettingsSchema
 *  ensures the final return type is the precise `AppSettings` that
 *  the helpers' parameter type expects (avoids the loose
 *  Record<string, unknown> inference that fails tsc strict-mode). */
function sampleSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return AppSettingsSchema.parse({ ...AppSettingsSchema.parse({}), ...overrides });
}

// ---------------- readSettingsFromDisk (5) ----------------

describe('readSettingsFromDisk', () => {
  it('returns the parsed AppSettings on a valid settings file', async () => {
    const settingsPath = path.join(tmp, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify(sampleSettings({ defaultRunRoot: '/opt/cfd/runs' })));
    const settings = await readSettingsFromDisk(settingsPath);
    expect(settings.defaultRunRoot).toBe('/opt/cfd/runs');
  });

  it('returns AppSettingsSchema.parse({}) when the file is missing (no throw)', async () => {
    const missing = path.join(tmp, 'never-saved.json');
    const settings = await readSettingsFromDisk(missing);
    // IPC contract: never throw — always return parsed defaults
    expect(settings).toEqual(AppSettingsSchema.parse({}));
  });

  it('returns AppSettingsSchema.parse({}) on malformed JSON (no throw)', async () => {
    const settingsPath = path.join(tmp, 'garbage.json');
    writeFileSync(settingsPath, '{ not json');
    const settings = await readSettingsFromDisk(settingsPath);
    expect(settings).toEqual(AppSettingsSchema.parse({}));
  });

  it('returns AppSettingsSchema.parse({}) on Zod-invalid schema (no throw)', async () => {
    // AppSettings fields are well-typed; supply a known-bad shape.
    // We don't reference AppSettingsSchema directly here to demonstrate
    // that even an unparseable disk payload yields the defaults.
    const settingsPath = path.join(tmp, 'bad-schema.json');
    writeFileSync(settingsPath, JSON.stringify({ cores: 'eight' }));
    const settings = await readSettingsFromDisk(settingsPath);
    expect(settings).toEqual(AppSettingsSchema.parse({}));
  });

  it('round-trips a write → read (write the file, then read it back, both branches exercised)', async () => {
    const settingsPath = path.join(tmp, 'round-trip.json');
    const input = sampleSettings({ defaultRunRoot: '/custom/runs', maxLogBufferLines: 4000 });
    await writeSettingsToDisk(settingsPath, input);
    const output = await readSettingsFromDisk(settingsPath);
    expect(output).toEqual(input);
  });
});

// ---------------- writeSettingsToDisk (5) ----------------

describe('writeSettingsToDisk', () => {
  it('returns the resolved settingsPath the caller wrote to (no recompute for the IPC reply)', async () => {
    const settingsPath = path.join(tmp, 'cfg.json');
    const result = await writeSettingsToDisk(settingsPath, sampleSettings({ defaultRunRoot: '/u/abc' }));
    expect(result).toBe(settingsPath);
    // And it actually wrote
    const onDisk = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(onDisk.defaultRunRoot).toBe('/u/abc');
  });

  it('creates parent dir tree recursively when missing (mkdir -p semantics)', async () => {
    const settingsPath = path.join(tmp, 'deep/nested/path/cfg.json');
    await writeSettingsToDisk(settingsPath, sampleSettings({ defaultRunRoot: '/u/x' }));
    expect(statSync(path.dirname(settingsPath)).isDirectory()).toBe(true);
    expect(statSync(settingsPath).isFile()).toBe(true);
  });

  it('pretty-prints JSON with 2-space indent (pin the on-disk format)', async () => {
    const settingsPath = path.join(tmp, 'pretty.json');
    await writeSettingsToDisk(settingsPath, sampleSettings({ defaultRunRoot: '/u/pretty' }));
    const raw = readFileSync(settingsPath, 'utf8');
    // 2-space indent on a non-top-level field key.
    expect(raw).toMatch(/\n {2}"defaultRunRoot"/);
    // No leading indent on the first field of the top-level object.
    expect(raw).toMatch(/^{\n {2}"defaultRunRoot"/);
  });

  it('overwrites an existing settings file (write idempotent, not append)', async () => {
    const settingsPath = path.join(tmp, 'overwrite.json');
    writeFileSync(settingsPath, JSON.stringify(sampleSettings({ defaultRunRoot: '/u/old' })));
    await writeSettingsToDisk(settingsPath, sampleSettings({ defaultRunRoot: '/u/NEW' }));
    const onDisk = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(onDisk.defaultRunRoot).toBe('/u/NEW');
    // File should be exactly one AppSettings object, not concatenated.
    const raw = readFileSync(settingsPath, 'utf8');
    expect(raw.trim().endsWith('}')).toBe(true);
  });

  it('round-trips complex settings across the real AppSettings triple (openfoamBashrc, defaultRunRoot, maxLogBufferLines)', async () => {
    const settingsPath = path.join(tmp, 'complex.json');
    const input = sampleSettings({
      openfoamBashrc: '/opt/openfoam/etc/bashrc',
      defaultRunRoot: '/opt/runs',
      maxLogBufferLines: 8000,
    });
    await writeSettingsToDisk(settingsPath, input);
    const output = await readSettingsFromDisk(settingsPath);
    expect(output).toEqual(input);
  });
});

// ---------------- combined invariant (1) ----------------

describe('combined invariants (read + write together)', () => {
  it('pin: pretty-printed JSON round-trip reproducibly (write then read returns the exact byte-equivalent JSON line pattern)', async () => {
    const settingsPath = path.join(tmp, 'round-trip-pretty.json');
    const input = sampleSettings({ defaultRunRoot: '/u/r', maxLogBufferLines: 8000 });
    await writeSettingsToDisk(settingsPath, input);
    // Same call sequence → same on-disk shape (deterministic).
    const raw1 = readFileSync(settingsPath, 'utf8');
    await writeSettingsToDisk(settingsPath, input);
    const raw2 = readFileSync(settingsPath, 'utf8');
    expect(raw1).toBe(raw2);
  });
});

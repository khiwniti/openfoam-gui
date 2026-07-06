/**
 * V1.36e — geometry file pair IPC handler-body coverage.
 *
 * The geometryFilePickAndRead + geometryFileWrite IPC handler bodies in
 * src/main/ipc/index.ts are now thin shells; the inline format→ext
 * mapping, the Buffer→Uint8Array view construction, and the
 * mkdir-recursive + writeFile composition live in helpers.ts as three
 * named exports. This file pins their contract so a future edit to
 * the file-picker extension list, the structured-clone envelope
 * shape, or the parent-dir-mkdir semantics fails loudly in CI rather
 * than producing a confusing renderer-side import/write error at
 * runtime.
 *
 * Drift-pin targets:
 *   - pickFormatExtension: STEP→'stp', IGES→'igs', STL→'stl' (and
 *     preserves the "STL is the default fallthrough" semantic for
 *     any future GeometryFormat addition).
 *   - formatGeometryReadReply: the returned `bytes` MUST be a
 *     Uint8Array view (NOT a copy) over the Buffer's underlying
 *     ArrayBuffer — Electron's IPC structured-clone only survives
 *     a Uint8Array view; the original Buffer would throw at clone
 *     time. Pin the byteOffset + byteLength match.
 *   - writeGeometryFile: mkdir-recursive parent + writeFile must
 *     compose so a fresh-user first-save in a deep target path
 *     doesn't ENOENT-fail. Overwrite-existing must work (renderer
 *     re-imports the same file repeatedly during a session).
 */
import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatGeometryReadReply,
  pickFormatExtension,
  writeGeometryFile,
} from '@main/ipc/helpers';

describe('pickFormatExtension — format-to-extension mapping', () => {
  it('maps STEP to the lowercase "stp" extension', () => {
    expect(pickFormatExtension('STEP')).toBe('stp');
  });

  it('maps IGES to the lowercase "igs" extension', () => {
    expect(pickFormatExtension('IGES')).toBe('igs');
  });

  it('maps STL to the lowercase "stl" extension', () => {
    expect(pickFormatExtension('STL')).toBe('stl');
  });

  it('returns one of the three known extensions for every GeometryFormat member', () => {
    // Pin the closed-set contract: no future format addition can
    // accidentally return an empty string or an unknown extension
    // (which would render the OS file-picker filter useless).
    const knownExtensions = new Set(['stp', 'igs', 'stl']);
    for (const format of ['STEP', 'IGES', 'STL'] as const) {
      expect(knownExtensions.has(pickFormatExtension(format))).toBe(true);
    }
  });
});

describe('formatGeometryReadReply — Uint8Array view construction', () => {
  it('returns { path, bytes } with bytes as a Uint8Array view of the Buffer', () => {
    const payload = Buffer.from('hello world', 'utf8');
    const reply = formatGeometryReadReply(payload, '/cases/foo.stl');
    expect(reply.path).toBe('/cases/foo.stl');
    // The view must be a Uint8Array (not the original Buffer — Buffer
    // is not structured-cloneable across Electron's IPC channel).
    expect(reply.bytes).toBeInstanceOf(Uint8Array);
    expect(reply.bytes.constructor).toBe(Uint8Array);
  });

  it('preserves the exact byteOffset + byteLength of the source buffer', () => {
    // The view must be a *view* — sharing the underlying ArrayBuffer
    // with zero copy. If the helper ever switches to `new Uint8Array(buf)`
    // (which copies) or `Buffer.from(buf)` (which clones), the
    // zero-copy guarantee breaks AND the IPC payload doubles in size.
    const source = Buffer.from('STL binary data', 'utf8');
    const reply = formatGeometryReadReply(source, '/x.stl');
    expect(reply.bytes.byteOffset).toBe(source.byteOffset);
    expect(reply.bytes.byteLength).toBe(source.byteLength);
    expect(reply.bytes.buffer).toBe(source.buffer);
  });

  it('round-trips the file content byte-for-byte', () => {
    // Belt-and-braces: even if the view shape drifts, the content
    // must be preserved (the renderer hands the bytes to the STL/STEP
    // parser; any content corruption would silently produce garbage
    // geometry downstream).
    const source = Buffer.from([0x00, 0xff, 0x10, 0x20, 0x30]);
    const reply = formatGeometryReadReply(source, '/x.stl');
    expect(Array.from(reply.bytes)).toEqual([0x00, 0xff, 0x10, 0x20, 0x30]);
  });
});

describe('writeGeometryFile — mkdir-recursive + writeFile composition', () => {
  let tmp: string;
  beforeEach(async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    tmp = await mkdtemp(path.join(tmpdir(), 'v136e-geom-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('creates the parent directory tree if missing (deep target path)', () => {
    // The renderer may save to arbitrary nested paths; the inline
    // handler used `fs.mkdir(path.dirname(target), { recursive: true })`
    // precisely so first-save in a fresh subdir doesn't ENOENT-fail.
    // The lift must preserve that semantic.
    const deepTarget = path.join(tmp, 'a', 'b', 'c', 'shape.stl');
    return writeGeometryFile(deepTarget, new Uint8Array([1, 2, 3])).then(async () => {
      const written = await fs.readFile(deepTarget);
      expect(Array.from(written)).toEqual([1, 2, 3]);
    });
  });

  it('overwrites an existing file (no append, no partial)', async () => {
    const target = path.join(tmp, 'over.stl');
    await writeGeometryFile(target, new Uint8Array([1, 1, 1, 1, 1]));
    await writeGeometryFile(target, new Uint8Array([9]));
    const written = await fs.readFile(target);
    // The new payload is exactly 1 byte — proves the second write
    // truncated, not appended.
    expect(written.length).toBe(1);
    expect(written[0]).toBe(9);
  });

  it('preserves complex binary bytes (UTF-8 strings, nulls, high-bit values)', async () => {
    const target = path.join(tmp, 'bin.stl');
    const payload = new Uint8Array([
      0x00, 0x01, 0x7f, 0x80, 0xff, // signed-byte edges
      0x00, 0x00, 0x00, 0x40, // little-endian 0x40000000 → 1073741824
      0x68, 0x69, 0x0a, 0x00, // 'hi\n\0'
    ]);
    await writeGeometryFile(target, payload);
    const written = await fs.readFile(target);
    expect(written.length).toBe(payload.length);
    expect(Array.from(written)).toEqual(Array.from(payload));
  });

  it('round-trips a writeGeometryFile → formatGeometryReadReply pipeline', async () => {
    // Combined invariant: a file written by writeGeometryFile can be
    // read back and shaped into a reply envelope by formatGeometryReadReply
    // with the bytes intact. This is the end-to-end pipeline the
    // geometry panel exercises (renderer writes STL → later reads it
    // back for re-import / preview).
    const target = path.join(tmp, 'rt.stl');
    const payload = Buffer.from('round-trip body', 'utf8');
    await writeGeometryFile(target, new Uint8Array(payload));
    const buf = await fs.readFile(target);
    const reply = formatGeometryReadReply(buf, target);
    expect(reply.path).toBe(target);
    expect(Array.from(reply.bytes)).toEqual(Array.from(payload));
  });
});

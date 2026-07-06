/**
 * V1.35c — wire-format-schemas coverage for the two geometry IPC handlers.
 *
 * The two V1.35c-extracted schemas were previously inline in
 * `src/main/ipc/index.ts`:
 *
 *   • `geometryFilePickAndRead` previously inlined
 *       `z.object({ format: z.enum(['STEP', 'STL', 'IGES']) })`.
 *   • `geometryFileWrite` previously inlined
 *       `z.object({ path: z.string(), bytes: z.instanceof(Uint8Array) })`.
 *
 * Both forces the IPC handler module to import `electron` (for
 * `dialog.showOpenDialog`), which is unavailable in vitest's node
 * environment. The named-schema lift to `@shared/types` matches the
 * V1.31a `RunStartEnvelopeSchema` pattern: vitest now exercises the
 * wire format directly, electron-free.
 *
 * This file covers:
 *   • Format enum accepts all 3 valid values + rejects invalid ones,
 *     including non-string types and missing key.
 *   • `bytes instanceof Uint8Array` is the precise type contract —
 *     plain `Array` / numeric / `ArrayBuffer` are rejected; `Buffer`
 *     (a Uint8Array subclass) is accepted so node-side fs writes from
 *     a Buffer don't get bounced at parse time.
 *   • `path` has no `.min(1)` — empty-string is valid because the
 *     schema's contract is "string we can pass to path.dirname()",
 *     not "valid filesystem path."
 *   • Non-strict mode pins the V1.31a contract: extra unknown keys
 *     silently strip rather than throw, so a future V.x can add
 *     renderer-side metadata (`lastPickPath`, `codec`) without
 *     breaking the IPC wire.
 *   • Drift guard: `GeometryFilePickArgsSchema.shape.format.options`
 *     stays in lockstep with `GeometryFormatSchema.options`, so a
 *     future V.x that adds ('OBJ', ...) to the enum lands in
 *     exactly one place.
 *
 * Total: 14 assertions across 2 describe blocks.
 */
import { describe, it, expect } from 'vitest';

import {
  GeometryFilePickArgsSchema,
  GeometryFileWriteArgsSchema,
  GeometryFormatSchema,
} from '../types';

// ============================================================================

describe('V1.35c -- GeometryFilePickArgsSchema (pick-and-read wire format)', () => {
  it('accepts every valid GeometryFormatSchema enum value (STEP / STL / IGES)', () => {
    // Drive the for-of off `GeometryFormatSchema.options` directly so this
    // test file has exactly one source of truth for the format roster
    // -- the named enum in @shared/types. Adding a new format (e.g. 'OBJ'
    // for an OCCT-backed mesh importer V.x) lands in `GeometryFormatSchema`
    // and this loop exercises it without an edit here, paired with the
    // drift-guard assertion below.
    for (const format of GeometryFormatSchema.options) {
      const parsed = GeometryFilePickArgsSchema.parse({ format });
      expect(parsed.format).toBe(format);
    }
  });

  it('format drift guard: enum stays in lockstep with GeometryFormatSchema', () => {
    // Pins the contract that GeometryFilePickArgsSchema's format slot is
    // backed by the named GeometryFormatSchema — not a parallel hand-
    // typed literal list. Add a new format to GeometryFormatSchema and
    // this test catches a divergence if anyone re-lists the literals.
    expect(GeometryFilePickArgsSchema.shape.format.options).toEqual(
      GeometryFormatSchema.options,
    );
  });

  it('rejects an unknown format string (e.g. "OBJ") with Zod error', () => {
    expect(() => GeometryFilePickArgsSchema.parse({ format: 'OBJ' })).toThrow();
  });

  it('rejects a missing format key (Zod required)', () => {
    expect(() => GeometryFilePickArgsSchema.parse({})).toThrow();
  });

  it('rejects a non-string format (number / null / boolean)', () => {
    expect(() => GeometryFilePickArgsSchema.parse({ format: 42 })).toThrow();
    expect(() => GeometryFilePickArgsSchema.parse({ format: null })).toThrow();
    expect(() => GeometryFilePickArgsSchema.parse({ format: true })).toThrow();
  });

  it('non-strict: extra unknown keys silently strip (V1.31a contract pin)', () => {
    const parsed = GeometryFilePickArgsSchema.parse({
      format: 'STEP',
      // Hypothetical future renderer metadata the IPC handler should ignore.
      lastPickFolder: '/tmp/cfd/whatever',
    });
    expect(parsed.format).toBe('STEP');
    expect(
      (parsed as unknown as Record<string, unknown>).lastPickFolder,
    ).toBeUndefined();
  });
});

// ============================================================================

describe('V1.35c -- GeometryFileWriteArgsSchema (write-bytes wire format)', () => {
  function validBytes(): Uint8Array {
    // Tiny typed array — proves the contract accepts real Uint8Array values.
    return new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  }

  it('accepts valid { path: string, bytes: Uint8Array }', () => {
    const result = GeometryFileWriteArgsSchema.parse({
      path: '/tmp/cfd/triSurface/body.stl',
      bytes: validBytes(),
    });
    expect(result.path).toBe('/tmp/cfd/triSurface/body.stl');
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.bytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('empty path is valid (path schema contract is "string for dirname", not "valid FS path")', () => {
    // Documenting that the schema does NOT enforce a non-empty path —
    // the OS rejects `''` at fs.writeFile time, but schema-level
    // empty-string acceptance is intentional so renderer-rendered
    // empty-string defaults (e.g., from a cleared form input) don't
    // fail Zod parse up-front.
    const result = GeometryFileWriteArgsSchema.parse({
      path: '',
      bytes: validBytes(),
    });
    expect(result.path).toBe('');
  });

  it('rejects missing path (Zod required)', () => {
    expect(() => GeometryFileWriteArgsSchema.parse({ bytes: validBytes() })).toThrow();
  });

  it('rejects non-string path (number / null / boolean)', () => {
    expect(() =>
      GeometryFileWriteArgsSchema.parse({ path: 42, bytes: validBytes() }),
    ).toThrow();
    expect(() =>
      GeometryFileWriteArgsSchema.parse({ path: null, bytes: validBytes() }),
    ).toThrow();
    expect(() =>
      GeometryFileWriteArgsSchema.parse({ path: true, bytes: validBytes() }),
    ).toThrow();
  });

  it('rejects missing bytes (Zod required)', () => {
    expect(() => GeometryFileWriteArgsSchema.parse({ path: '/tmp/foo.stl' })).toThrow();
  });

  it('bytes instanceof Uint8Array is precise: rejects Array / ArrayBuffer / number; accepts Buffer (Uint8Array subclass)', () => {
    // Plain Array. The IPC structured-clone preserves typed arrays
    // but would JSON-serialize a plain number[] through the IPC if the
    // renderer typed it that way, losing byte precision for high-
    // entropy binary content. The schema must reject that collision.
    expect(() =>
      GeometryFileWriteArgsSchema.parse({ path: '/tmp/foo', bytes: [1, 2, 3] }),
    ).toThrow();
    // ArrayBuffer (no view) is also not a Uint8Array instance.
    expect(() =>
      GeometryFileWriteArgsSchema.parse({ path: '/tmp/foo', bytes: new ArrayBuffer(8) }),
    ).toThrow();
    // Primitive number — sanity check that the guard isn't a typeof gate
    // (it must be instanceof, since Uint8Arrays are `typeof === 'object'`).
    expect(() =>
      GeometryFileWriteArgsSchema.parse({ path: '/tmp/foo', bytes: 42 }),
    ).toThrow();
    // Buffer IS a Uint8Array subclass in node (Buffer extends Uint8Array),
    // so it should be accepted — this verifies instanceof follows the
    // prototype chain, not just exact-class identity. The IPC handler
    // doesn't currently pass a Buffer, but a future V.x that does (e.g.
    // for pickier streaming writes) would otherwise get bounced.
    expect(() =>
      GeometryFileWriteArgsSchema.parse({ path: '/tmp/foo', bytes: Buffer.from([1, 2, 3]) }),
    ).not.toThrow();
  });

  it('non-strict: extra unknown keys silently strip (V1.31a contract pin)', () => {
    const parsed = GeometryFileWriteArgsSchema.parse({
      path: '/tmp/foo.stl',
      bytes: validBytes(),
      // Future renderer metadata the IPC handler should ignore.
      codec: 'stl-binary',
    });
    expect(parsed.path).toBe('/tmp/foo.stl');
    expect((parsed as unknown as Record<string, unknown>).codec).toBeUndefined();
  });
});

/**
 * V1.36f — RunCancelArgsSchema drift-safety pin.
 *
 * The runCancel IPC handler now parses its renderer payload via the
 * named `RunCancelArgsSchema` from @shared/types (was previously
 * inline `z.object({ runId: z.string() }).parse(args)` inside the
 * handler). The schema is a wire-format contract between the
 * renderer (which builds `{ runId }` objects) and the main process
 * (which parses them); this file pins that contract so a future edit
 * to either side fails loudly in CI rather than producing a
 * confusing "Cancel" button that silently no-ops.
 *
 * Drift-pin targets (mirrors verify-bashrc-args.test.ts from V1.36c):
 *   - Happy round-trip: `{ runId: 'x' }` parses successfully.
 *   - Missing-key rejection: omitting `runId` throws ZodError with
 *     path = ['runId'].
 *   - Wrong-type rejection: `runId` as a number throws.
 *   - Extra-key tolerance (non-strict .object()): unknown keys
 *     silently strip — matches the V1.30-era wire-format lenience
 *     intentionally preserved across all IPC envelope schemas.
 *   - Empty-string tolerance: `runId: ''` is a valid (if degenerate)
 *     input — the IPC handler will then call `cancelRun('')` which
 *     returns false. The schema's job is to accept the wire format,
 *     not to validate the runId semantically.
 */
import { describe, expect, it } from 'vitest';
import { RunCancelArgsSchema } from '@shared/types';

describe('RunCancelArgsSchema — wire-format drift-safety pin', () => {
  it('round-trips a valid { runId } envelope', () => {
    const parsed = RunCancelArgsSchema.parse({ runId: 'run-abc' });
    expect(parsed).toEqual({ runId: 'run-abc' });
  });

  it('rejects a payload with no runId key (path-pin: ["runId"])', () => {
    // Pin the exact ZodError path: a future refactor that relaxes the
    // schema (e.g. makes runId optional) would change the path to
    // 'undefined' or similar — the pin catches that drift.
    expect(() => RunCancelArgsSchema.parse({})).toThrow();
    try {
      RunCancelArgsSchema.parse({});
      throw new Error('expected ZodError but none thrown');
    } catch (err) {
      // The error message includes the field path. We don't pin the
      // exact error string (Zod versions drift it), only that the
      // field name appears in the message.
      expect(String(err)).toMatch(/runId/);
    }
  });

  it('rejects a payload with a non-string runId (number)', () => {
    expect(() => RunCancelArgsSchema.parse({ runId: 123 })).toThrow();
  });

  it('tolerates extra unknown keys (non-strict .object())', () => {
    // The IPC envelope schema is intentionally non-strict (matches
    // the V1.30-era wire-format lenience). A renderer that adds a
    // future field (e.g. `force: boolean`) will not break the main
    // process's parse — the extra key silently strips.
    const parsed = RunCancelArgsSchema.parse({ runId: 'run-x', extra: 'noise' });
    expect(parsed).toEqual({ runId: 'run-x' });
  });

  it('accepts an empty-string runId (schema-level tolerance, semantic check stays in cancelRun)', () => {
    // The schema is a wire-format gate, not a semantic validator.
    // An empty-string runId parses successfully here; the IPC
    // handler will then call `cancelRun('')` which returns false
    // (no run with that id). The schema's job is to accept the wire
    // format; the cancelRun runner function enforces the semantic
    // invariant.
    const parsed = RunCancelArgsSchema.parse({ runId: '' });
    expect(parsed).toEqual({ runId: '' });
  });
});

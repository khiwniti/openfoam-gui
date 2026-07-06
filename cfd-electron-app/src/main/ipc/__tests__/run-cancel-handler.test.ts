/**
 * V1.36f — runCancel IPC handler-body coverage (pure helper surface).
 *
 * The runCancel IPC handler in src/main/ipc/index.ts is now a thin
 * shell — the inline `z.object({ runId: z.string() })` parse was
 * lifted to the named RunCancelArgsSchema in @shared/types (drift-
 * safety pair in src/shared/__tests__/run-cancel-args.test.ts) and
 * the inline `{ ok: cancelRun(runId), runId }` reply literal was
 * lifted to the formatRunCancelReply helper here. This file pins the
 * helper's contract so a future edit to the run-cancel IPC envelope
 * (e.g. adding a `force: boolean` flag, or echoing back a cancellation
 * reason) fails loudly in CI rather than producing a confusing
 * renderer-side "Cancel" button that silently no-ops.
 *
 * Drift-pin targets:
 *   - `ok` field is exactly the boolean `canceled` argument, with
 *     no transformation (renderer keys its disabled-button state off
 *     this exact field).
 *   - `runId` is echoed back verbatim (the renderer correlates the
 *     reply with the in-flight cancel click via this echo).
 *   - No extra keys are added (renderer destructures `{ ok, runId }`
 *     and ignores everything else; an extra key would just be
 *     wasted IPC bandwidth).
 *   - End-to-end: a real RunCancelArgsSchema.parse + formatRunCancelReply
 *     pipeline composes the same way the IPC handler does.
 */
import { describe, expect, it } from 'vitest';
import { RunCancelArgsSchema } from '@shared/types';
import { formatRunCancelReply } from '@main/ipc/helpers';

describe('formatRunCancelReply — reply envelope', () => {
  it('returns { ok: true, runId } when a live run was cancelled', () => {
    // The runCancel IPC contract: ok=true means "we found + killed a
    // live run with this runId". ok=false means "no such runId was
    // active" (either already-completed or never-existed). The
    // renderer disables the Cancel button on ok=true; on ok=false it
    // shows a "run already finished" toast.
    expect(formatRunCancelReply(true, 'run-123')).toEqual({ ok: true, runId: 'run-123' });
  });

  it('returns { ok: false, runId } when no live run matched the runId', () => {
    expect(formatRunCancelReply(false, 'run-456')).toEqual({ ok: false, runId: 'run-456' });
  });

  it('echoes the runId verbatim — no transformation, no truncation', () => {
    // Pin the echo-behavior: the renderer correlates the reply with
    // the in-flight cancel click via the runId echo. Any trimming /
    // case-folding / prefixing would silently break that correlation.
    const exoticIds = [
      'simple',
      'with-dashes-and_underscores',
      'CamelCase123',
      'UPPER-CASE',
      'a', // single char edge
      'a'.repeat(256), // long-string edge
    ];
    for (const id of exoticIds) {
      expect(formatRunCancelReply(true, id).runId).toBe(id);
      expect(formatRunCancelReply(false, id).runId).toBe(id);
    }
  });

  it('produces no extra keys — only { ok, runId } are present', () => {
    // Renderer destructures `{ ok, runId }` and ignores everything
    // else; an extra key would just be wasted IPC bandwidth. Pin the
    // exact key set so a future "helpful" addition (e.g. a `cancelledAt`
    // timestamp) is caught at review time.
    const reply = formatRunCancelReply(true, 'run-x');
    expect(Object.keys(reply).sort()).toEqual(['ok', 'runId']);
  });
});

describe('formatRunCancelReply + RunCancelArgsSchema — end-to-end pipeline', () => {
  it('parses a wire-format envelope then produces the matching reply', () => {
    // Belt-and-braces: compose the same parse + delegate flow the
    // runCancel IPC handler does. If RunCancelArgsSchema adds a
    // required field (e.g. `force: boolean`) without a default, this
    // test catches it at the helper-pipeline level too.
    const args = RunCancelArgsSchema.parse({ runId: 'run-abc' });
    const reply = formatRunCancelReply(/* canceled = */ true, args.runId);
    expect(reply).toEqual({ ok: true, runId: 'run-abc' });
  });

  it('forwards the parsed runId to the reply (no shadow, no copy)', () => {
    // The destructured `args.runId` MUST be the same string the
    // reply echoes — no string transformation between the schema
    // parse and the reply shaper. A copy-on-parse (e.g. via a
    // .transform()) would silently break the echo contract.
    const wirePayload = { runId: 'edge-case-id-with-unicode-\u00e9-\u00fc-\u00f1' };
    const args = RunCancelArgsSchema.parse(wirePayload);
    const reply = formatRunCancelReply(false, args.runId);
    expect(reply.runId).toBe(wirePayload.runId);
  });

  it('preserves the ok=false (no-live-run) path through the full pipeline', () => {
    // The most common production path: user clicks Cancel AFTER the
    // run has already finished (race with solver completion). The
    // cancelRun() returns false, the reply must surface that exact
    // boolean to the renderer for the "already finished" toast.
    const args = RunCancelArgsSchema.parse({ runId: 'completed-run' });
    const reply = formatRunCancelReply(/* canceled = */ false, args.runId);
    expect(reply).toEqual({ ok: false, runId: 'completed-run' });
  });
});

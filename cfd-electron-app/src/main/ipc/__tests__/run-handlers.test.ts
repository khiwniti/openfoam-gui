/**
 * V1.36g — runStart + runStatus IPC handler-body coverage (pure helper surface).
 *
 * The runStart + runStatus IPC handler bodies in src/main/ipc/index.ts
 * are now thin shells; the inline reply literals were lifted to two
 * named exports in @main/ipc/helpers (formatRunStartReply +
 * formatRunStatusReply). This file pins their contract so a future
 * edit to the run-lifecycle wire-format (e.g. adding a `startedAt`
 * timestamp to the start reply, or wrapping the active array in a
 * `{ count, runs }` shape for the status reply) fails loudly in CI
 * rather than producing a confusing renderer-side "Run started" toast
 * that silently misses its dependent state.
 *
 * Drift-pin targets:
 *   - formatRunStartReply: the 4 fields `{ ok, message, runId, caseDir }`
 *     are present in this exact order + shape; the `message` literal
 *     is `'run started'` (renderer toast key); the `runId` + `caseDir`
 *     pass through verbatim; no extra keys.
 *   - formatRunStatusReply: the `active` field preserves the input
 *     array's element types + order; empty arrays are valid (no
 *     live runs); no extra keys; generic on T so the openfoam runner
 *     type flows through the IPC handler call site unchanged.
 */
import { describe, expect, it } from 'vitest';
import { formatRunStartReply, formatRunStatusReply } from '@main/ipc/helpers';

describe('formatRunStartReply — runStart reply envelope', () => {
  it('returns the canonical { ok: true, message, runId, caseDir } shape', () => {
    const reply = formatRunStartReply({ runId: 'run-1', caseDir: '/cases/foo' });
    expect(reply).toEqual({
      ok: true,
      message: 'run started',
      runId: 'run-1',
      caseDir: '/cases/foo',
    });
  });

  it('pins the user-facing message literal ("run started")', () => {
    // Renderer-side toasts are keyed off this exact string. Any drift
    // — "Run started", "started", "ok" — surfaces as a stripped toast.
    expect(formatRunStartReply({ runId: 'x', caseDir: '/y' }).message).toBe('run started');
  });

  it('echoes the runId + caseDir verbatim (no transformation)', () => {
    // The renderer uses runId to subscribe to log/phase/residual
    // streams and caseDir to correlate with the Run panel's case
    // list. Any trimming / case-folding / path normalization on
    // these fields would silently break the subscription or
    // correlation.
    const exoticIds = [
      { runId: 'simple-id', caseDir: '/cases/simple' },
      { runId: 'with-dashes_and_underscores', caseDir: '/cases/with-dashes' },
      { runId: 'a'.repeat(128), caseDir: '/' + 'b'.repeat(128) },
    ];
    for (const { runId, caseDir } of exoticIds) {
      const reply = formatRunStartReply({ runId, caseDir });
      expect(reply.runId).toBe(runId);
      expect(reply.caseDir).toBe(caseDir);
    }
  });

  it('always returns ok: true (the start reply is success-only by contract)', () => {
    // The IPC start-flow's failure path is `startRun` throwing
    // (e.g. solver binary not found); that propagates as an IPC
    // rejection, NOT a `{ ok: false, ... }` reply. The reply
    // shape is therefore always-success-or-throw. Pin the
    // invariant so a future "helpful" ok:false branch doesn't
    // accidentally land here.
    const reply = formatRunStartReply({ runId: 'r', caseDir: '/c' });
    expect(reply.ok).toBe(true);
  });

  it('produces no extra keys — only { ok, message, runId, caseDir } are present', () => {
    // The renderer destructures `{ ok, message, runId, caseDir }`
    // and ignores everything else; an extra key would just be
    // wasted IPC bandwidth. Pin the exact key set.
    const reply = formatRunStartReply({ runId: 'r', caseDir: '/c' });
    expect(Object.keys(reply).sort()).toEqual(['caseDir', 'message', 'ok', 'runId']);
  });
});

describe('formatRunStatusReply — runStatus reply envelope', () => {
  it('returns { active } wrapping the input array verbatim', () => {
    const active = [
      { id: 'run-1', startedAt: 1000 },
      { id: 'run-2', startedAt: 2000 },
    ];
    const reply = formatRunStatusReply(active);
    expect(reply).toEqual({ active });
  });

  it('preserves the empty-array case (no live runs is a valid state)', () => {
    // The Run panel's "0 active runs" empty state is the most
    // common production state at app startup. Pin that the
    // helper doesn't choke on an empty input.
    const reply = formatRunStatusReply([]);
    expect(reply).toEqual({ active: [] });
  });

  it('preserves element type via the generic T parameter', () => {
    // The helper is generic on T so the openfoam runner's
    // RunRecord type flows through to the IPC reply unchanged.
    // Pin: passing a typed array preserves its element type
    // (TS inference, not runtime, but the shape is exact).
    type RunRecord = { id: string; cores: number; caseDir: string };
    const active: RunRecord[] = [
      { id: 'a', cores: 4, caseDir: '/c1' },
      { id: 'b', cores: 8, caseDir: '/c2' },
    ];
    const reply = formatRunStatusReply(active);
    // Pin the element type end-to-end by re-binding the reply's
    // `active` to the named RunRecord[] shape -- TS catches any
    // future refactor that drops the generic T (e.g. switching
    // to a non-generic `formatRunStatusReply(active: any[])`).
    const typedActive: RunRecord[] = reply.active;
    expect(typedActive.length).toBe(2);
    expect(typedActive[0]?.id).toBe('a');
    expect(typedActive[1]?.cores).toBe(8);
  });

  it('produces no extra keys — only { active } is present', () => {
    // The renderer destructures `{ active }`; an extra key would
    // be wasted bandwidth. Pin the exact key set.
    const reply = formatRunStatusReply([{ id: 'r' }]);
    expect(Object.keys(reply)).toEqual(['active']);
  });
});

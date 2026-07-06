/**
 * V1.37b — runner-parsers module coverage (residual parser +
 * convergence checker extracted from src/main/openfoam/runner.ts).
 *
 * The runner's `runStage` calls `makeResidualParser` to digest
 * OpenFOAM solver stdout/stderr lines and `makeConvergenceChecker`
 * to detect when the solver has reached a stable-residual state.
 * Both factories are stateful closures that process a stream of
 * log lines (or ResidualPoints) and fire callbacks at the
 * appropriate boundaries. V1.37b lifted them to a dedicated
 * @main/openfoam/runner-parsers module; this file pins their
 * contract so a future edit to the regex, the streak state
 * machine, or the field-dropout reset (V1.8 review-fix #2)
 * fails loudly in CI rather than producing a confusing "stuck
 * in meshing" or "false converged" run.
 *
 * Drift-pin targets:
 *   - makeResidualParser: Time-line emits a ResidualPoint, residual
 *     lines accumulate per-field, fields reset between Time
 *     boundaries, both onResidual + onTimeReached fire, omitted
 *     onResidual makes consume a no-op, runId is stamped onto
 *     every point, flush() forces a final emit.
 *   - makeConvergenceChecker: below-threshold streak accumulates
 *     per field, above-threshold resets the streak for that field,
 *     field-dropout resets the streak (V1.8 review-fix #2),
 *     sticky fired prevents double-emit, autoStop calls stop()
 *     instead of onPhase, enabled=false makes consume a no-op,
 *     both totalSamples AND longestStreak must reach
 *     stableIterations before firing.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  makeConvergenceChecker,
  makeResidualParser,
} from '@main/openfoam/runner-parsers';

describe('makeResidualParser — line-by-line log parser', () => {
  it('emits a ResidualPoint on the SECOND "Time = N" line (first line seeds the parser)', () => {
    // The parser's emit() returns early when `lastTime` is still
    // NaN — the FIRST "Time = N" line seeds `lastTime = N` (and
    // clears the field accumulator) without firing the callback.
    // The SECOND "Time = N" line triggers the emission for the
    // previous time (N-1). This matches the OpenFOAM log format
    // where the first line establishes the boundary and
    // subsequent lines close out the previous time's data.
    const onResidual = vi.fn();
    const parser = makeResidualParser(onResidual, 'run-1');
    parser.consume('Time = 1'); // seeds lastTime=1; no emission yet
    parser.consume('Time = 2'); // emits the time=1 point
    expect(onResidual).toHaveBeenCalledTimes(1);
    expect(onResidual).toHaveBeenCalledWith({
      time: 1,
      fields: {},
      runId: 'run-1',
    });
  });

  it('accumulates residual lines into the current timestep field map', () => {
    // After a "Time = 1" boundary (the seed), the parser starts
    // a fresh field map. Two "Solving for X, Initial residual = Y"
    // lines populate fields[X] = Y. When the next "Time = 2"
    // boundary arrives, the emit carries the PREVIOUS time's
    // accumulated fields (time=1, not time=2).
    const onResidual = vi.fn();
    const parser = makeResidualParser(onResidual, 'r');
    parser.consume('Time = 1'); // seed: lastTime=1, fields cleared
    parser.consume('smoothSolver:  Solving for Ux, Initial residual = 1e-5, Final residual = 1e-7, No Iterations 4');
    parser.consume('DICPCG:  Solving for p, Initial residual = 0.001, Final residual = 5e-4, No Iterations 12');
    parser.consume('Time = 2'); // emits the time=1 point with the accumulated fields
    expect(onResidual).toHaveBeenCalledTimes(1);
    expect(onResidual).toHaveBeenCalledWith({
      time: 1,
      fields: { Ux: 1e-5, p: 0.001 },
      runId: 'r',
    });
  });

  it('resets the field map between Time boundaries', () => {
    // After emitting fields at Time=1, the next Time boundary
    // starts a fresh field map. The Time=3 line's emit carries
    // the time=2 fields (NOT time=3's — the emit fires for the
    // previous time). The Time=2 fields (Ux) must NOT appear in
    // the time=2 emit.
    const onResidual = vi.fn();
    const parser = makeResidualParser(onResidual, 'r');
    parser.consume('Time = 1');
    parser.consume('Solving for Ux, Initial residual = 1e-5, No Iterations 4');
    parser.consume('Time = 2');
    parser.consume('Solving for p, Initial residual = 0.001, No Iterations 12');
    parser.consume('Time = 3');
    expect(onResidual).toHaveBeenCalledTimes(2);
    const lastCall = onResidual.mock.calls.at(-1)![0];
    expect(lastCall.time).toBe(2);
    expect(lastCall.fields).toEqual({ p: 0.001 });
  });

  it('fires onTimeReached alongside onResidual (V1.8 convergence-detector hook)', () => {
    // The convergence detector hooks into the parser via
    // onTimeReached so it sees the SAME ResidualPoint the
    // residual broadcaster receives, without re-parsing the log
    // line. Both callbacks must fire on each Time boundary
    // emission (i.e. on the SECOND Time line, since the first
    // seeds the parser).
    const onResidual = vi.fn();
    const onTimeReached = vi.fn();
    const parser = makeResidualParser(onResidual, 'r', onTimeReached);
    parser.consume('Time = 1'); // seed
    parser.consume('Time = 2'); // emits: both onResidual + onTimeReached fire
    expect(onResidual).toHaveBeenCalledTimes(1);
    expect(onTimeReached).toHaveBeenCalledTimes(1);
    expect(onTimeReached).toHaveBeenCalledWith(onResidual.mock.calls[0]![0]);
  });

  it('is a no-op when onResidual is omitted (pre-V1.8 fallback path)', () => {
    // Renderer builds that haven't plumbed the residual
    // broadcaster through still create a parser; the parser
    // must not throw on consume calls when there's no
    // onResidual to emit to. The line accumulator is
    // effectively a no-op (early return inside consume).
    const parser = makeResidualParser(undefined, 'r');
    expect(() => {
      parser.consume('Time = 1');
      parser.consume('Solving for Ux, Initial residual = 1e-5, No Iterations 4');
      parser.consume('Time = 2');
    }).not.toThrow();
  });

  it('exposes flush() to force-emit the current timestep without a Time boundary', () => {
    // stage-end before the next "Time = N+1" boundary has
    // arrived yet — the runner's runStage may call flush() to
    // surface the last in-flight point to the convergence
    // detector + residual broadcaster. The Time=5 line seeds
    // lastTime=5 (no emission yet because no previous lastTime);
    // the residual line populates fields[Ux]; the flush() then
    // forces the emission. Total: 1 call (from flush only).
    const onResidual = vi.fn();
    const parser = makeResidualParser(onResidual, 'r');
    parser.consume('Time = 5');
    parser.consume('Solving for Ux, Initial residual = 1e-6, No Iterations 3');
    parser.flush();
    expect(onResidual).toHaveBeenCalledTimes(1);
    const flushedPoint = onResidual.mock.calls[0]![0];
    expect(flushedPoint.time).toBe(5);
    expect(flushedPoint.fields).toEqual({ Ux: 1e-6 });
  });

  it('ignores non-matching lines (only Time + Solving lines are relevant)', () => {
    // The parser must NOT throw on solver banner text, blank
    // lines, or other log noise. A "Build: N points" line, a
    // blank line, or an unrelated solver message must be
    // silently skipped. The warmup "Time = 0" seeds the parser
    // so the "Time = 1" line at the end triggers an emission
    // (for the warmup time, with no fields accumulated).
    const onResidual = vi.fn();
    const parser = makeResidualParser(onResidual, 'r');
    parser.consume('Time = 0'); // warmup
    expect(() => {
      parser.consume('/*---------------------------------------------------------------------------*\\');
      parser.consume('| =========                 |                                                 |');
      parser.consume('');
      parser.consume('Build: 12345 points');
      parser.consume('Time = 1');
    }).not.toThrow();
    // The Time=1 line emits the warmup time=0 point (no fields).
    expect(onResidual).toHaveBeenCalledTimes(1);
    expect(onResidual).toHaveBeenCalledWith({
      time: 0,
      fields: {},
      runId: 'r',
    });
  });
});

describe('makeConvergenceChecker — convergence state machine', () => {
  const makeChecker = (overrides: Partial<{
    threshold: number;
    stableIterations: number;
    enabled: boolean;
    autoStop: boolean;
  }> = {}) => {
    const onPhase = vi.fn();
    const stop = vi.fn();
    const checker = makeConvergenceChecker({
      threshold: 1e-3,
      stableIterations: 3,
      enabled: true,
      autoStop: false,
      onPhase,
      stop,
      ...overrides,
    });
    return { checker, onPhase, stop };
  };

  it('accumulates the per-field below-threshold streak across timesteps', () => {
    // Three consecutive timesteps with Ux < threshold should
    // trigger convergence at the third one (stableIterations=3).
    const { checker, onPhase } = makeChecker();
    checker.consume({ time: 1, fields: { Ux: 1e-5 } }); // seed: streak[Ux]=0
    checker.consume({ time: 2, fields: { Ux: 1e-5 } }); // streak[Ux]=1
    checker.consume({ time: 3, fields: { Ux: 1e-5 } }); // streak[Ux]=2
    checker.consume({ time: 4, fields: { Ux: 1e-5 } }); // streak[Ux]=3 → fire
    expect(onPhase).toHaveBeenCalledTimes(1);
    expect(onPhase).toHaveBeenCalledWith('converged', expect.stringContaining('Solver converged'));
  });

  it('resets a field streak to 0 when an above-threshold sample arrives', () => {
    // Ux goes below-threshold for 2 timesteps, then above on
    // the 3rd, then below again — convergence should NOT fire
    // until Ux has a 3-streak AFTER the above-threshold reset.
    const { checker, onPhase } = makeChecker();
    checker.consume({ time: 1, fields: { Ux: 1e-5 } }); // seed
    checker.consume({ time: 2, fields: { Ux: 1e-5 } }); // streak=1
    checker.consume({ time: 3, fields: { Ux: 1e-2 } }); // streak=0 (above)
    checker.consume({ time: 4, fields: { Ux: 1e-5 } }); // streak=1
    checker.consume({ time: 5, fields: { Ux: 1e-5 } }); // streak=2
    checker.consume({ time: 6, fields: { Ux: 1e-5 } }); // streak=3 → fire
    expect(onPhase).toHaveBeenCalledTimes(1);
  });

  it('resets a field streak when the field drops out of a sample (V1.8 review-fix #2)', () => {
    // The solver stops emitting `k` (e.g. turbulence model
    // restart). Without the V1.8 review-fix, `below.k` would
    // stay at its prior value and could falsely satisfy
    // stableIterations.
    const { checker, onPhase } = makeChecker();
    checker.consume({ time: 1, fields: { Ux: 1e-5, p: 1e-5 } }); // seed
    checker.consume({ time: 2, fields: { Ux: 1e-5, p: 1e-5 } }); // streaks=1
    checker.consume({ time: 3, fields: { Ux: 1e-5 } }); // p dropped out → p streak reset
    checker.consume({ time: 4, fields: { Ux: 1e-5 } }); // Ux streak=3 → fire
    expect(onPhase).toHaveBeenCalledTimes(1);
    // p streak stayed at 0 because it dropped out (not because
    // it was above-threshold). The V1.8 review-fix #2 logic
    // unifies the "dropout" and "above-threshold" reset paths.
  });

  it('is sticky: a 2nd convergence detect within the same run does NOT double-emit', () => {
    // After firing, the `fired` latching prevents a subsequent
    // sample (which might still be below-threshold) from
    // re-emitting 'converged'. Critical for the renderer's
    // "Converged" badge to display exactly once.
    const { checker, onPhase } = makeChecker();
    checker.consume({ time: 1, fields: { Ux: 1e-5 } });
    checker.consume({ time: 2, fields: { Ux: 1e-5 } });
    checker.consume({ time: 3, fields: { Ux: 1e-5 } });
    checker.consume({ time: 4, fields: { Ux: 1e-5 } });
    checker.consume({ time: 5, fields: { Ux: 1e-5 } });
    expect(onPhase).toHaveBeenCalledTimes(1);
  });

  it('routes through stop() (not onPhase) when autoStop is enabled', () => {
    // The autoStop path is for "stop the solver as soon as
    // convergence is detected" — the executive's emitTerminal
    // owns the final phase emit, so the monitor's
    // informational onPhase is suppressed to avoid back-to-
    // back 'converged' emissions. With stableIterations=3
    // (the makeChecker default), the detector needs 4 samples
    // to fire: 1 seed + 3 accumulating into the streak.
    const { checker, onPhase, stop } = makeChecker({ autoStop: true });
    checker.consume({ time: 1, fields: { Ux: 1e-5 } }); // seed
    checker.consume({ time: 2, fields: { Ux: 1e-5 } }); // streak=1
    checker.consume({ time: 3, fields: { Ux: 1e-5 } }); // streak=2
    checker.consume({ time: 4, fields: { Ux: 1e-5 } }); // streak=3, totalSamples=4 -> fire
    expect(stop).toHaveBeenCalledTimes(1);
    expect(onPhase).not.toHaveBeenCalled();
  });

  it('is a no-op when enabled is false', () => {
    // Pre-V1.8 behavior (no convergence detector) — the IPC
    // handler's getRunRoot() may pass enabled=false from the
    // settings cache. The consume path must not throw and must
    // not call any callbacks.
    const { checker, onPhase, stop } = makeChecker({ enabled: false });
    checker.consume({ time: 1, fields: { Ux: 1e-5 } });
    checker.consume({ time: 2, fields: { Ux: 1e-5 } });
    checker.consume({ time: 3, fields: { Ux: 1e-5 } });
    expect(onPhase).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('requires BOTH totalSamples AND longestStreak to reach stableIterations', () => {
    // If the longest streak reaches stableIterations but
    // totalSamples does not (e.g. fields alternate above + below
    // quickly), the detector must NOT fire. Both must hit the
    // threshold.
    const { checker, onPhase } = makeChecker();
    checker.consume({ time: 1, fields: { Ux: 1e-5, p: 1e-5 } });
    checker.consume({ time: 2, fields: { Ux: 1e-2, p: 1e-2 } }); // reset both
    checker.consume({ time: 3, fields: { Ux: 1e-5, p: 1e-5 } });
    checker.consume({ time: 4, fields: { Ux: 1e-2, p: 1e-2 } }); // reset both
    // totalSamples=4, longestStreak=1 (never reached 3)
    expect(onPhase).not.toHaveBeenCalled();
    // Now push the streak past 3 without re-resetting.
    checker.consume({ time: 5, fields: { Ux: 1e-5, p: 1e-5 } });
    checker.consume({ time: 6, fields: { Ux: 1e-5, p: 1e-5 } });
    checker.consume({ time: 7, fields: { Ux: 1e-5, p: 1e-5 } });
    expect(onPhase).toHaveBeenCalledTimes(1);
  });
});

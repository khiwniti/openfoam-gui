/**
 * V1.37b — residual parser + convergence checker extracted from
 * src/main/openfoam/runner.ts.
 *
 * Continues the V1.37* lift pattern (V1.37a extracted the pure
 * pipeline utilities to runner-helpers). This batch extracts the
 * two factory-closure parsers that the runner's `runStage` uses
 * to digest OpenFOAM solver stdout/stderr lines:
 *   • makeResidualParser — regex-matches the `Time = N` boundary
 *     lines + the `Solving for X, Initial residual = Y` residual
 *     lines, accumulates per-field residual values per timestep,
 *     and fires `onResidual` + `onTimeReached` callbacks on each
 *     Time boundary with a `ResidualPoint` carrying all the
 *     fields observed for that timestep.
 *   • makeConvergenceChecker — consumes the `ResidualPoint`s that
 *     the residual parser emits (via its `onTimeReached` hook),
 *     tracks per-field "below-threshold" streaks across timesteps,
 *     and fires `onPhase('converged')` (or `stop()` for autoStop)
 *     when the longest streak reaches `stableIterations` AND
 *     we've seen at least that many distinct timesteps.
 *
 * Both factories return stateful closure objects whose `consume`
 * method is the only public surface; tests exercise them by
 * feeding a sequence of lines (or ResidualPoints) and asserting
 * which callbacks fired with which arguments.
 *
 * IPC contract: the parsers here are pure-relative-to-their-callbacks
 * — they don't touch the filesystem, don't spawn processes, don't
 * read environment variables, and don't depend on the activeRuns
 * map. The runner.ts call site composes them with cancelRun +
 * process-kill. Vitest exercises them directly without any
 * electron / process-spawn dependencies.
 */
import type { Phase, ResidualPoint } from '@shared/types';

// ----- Residual parser -----
// OpenFOAM logs lines like:
//   Time = 1
//   smoothSolver:  Solving for Ux, Initial residual = 1e-5, Final residual = 1e-7, No Iterations 4
//   DICPCG:  Solving for p, Initial residual = 0.001, Final residual = 5e-4, No Iterations 12
/**
 * Create a stateful residual-line parser.
 *
 * Each call to `consume(line)` is fed the raw stdout/stderr line.
 * On a `Time = N` line, the parser emits the accumulated fields-
 * at-time-N via `onResidual` + `onTimeReached` (both fire with the
 * same ResidualPoint — onTimeReached exists so the convergence
 * checker can hook into the parser's flow without re-parsing the
 * log line itself), then resets the field accumulator and starts
 * accumulating fields for time N+1.
 *
 * On a `Solving for X, Initial residual = Y` line, the parser
 * stores `Y` in the `fields[X]` slot of the current timestep.
 *
 * If `onResidual` is omitted, `consume` is a no-op (the parser is
 * effectively disabled) — this is the pre-V1.8 fallback path for
 * renderer builds that haven't plumbed the residual broadcaster
 * through.
 *
 * Returns `{ consume, flush }`. `flush()` is exposed so a caller
 * can force-emit the current timestep's residual point (e.g. at
 * stage-end before the child process closes), even if no further
 * `Time = N+1` boundary has arrived yet.
 */
export function makeResidualParser(
  onResidual?: (point: ResidualPoint & { runId: string }) => void,
  runId: string = 'unknown',
  /** V1.8 — fired once per "Time = N" line, with the same
   *  ResidualPoint the residual broadcaster receives. Lets the
   *  convergence detector hook in without re-parsing the log line
   *  itself; both `onResidual` and `onTimeReached` fire on each
   *  Time boundary. */
  onTimeReached?: (point: ResidualPoint & { runId: string }) => void,
) {
  let lastTime = NaN;
  const fieldsAtTime: Record<string, number> = {};
  const timeRe = /^\s*Time\s*=\s*([0-9.eE+-]+)/;
  const residualRe = /Solving for ([A-Za-z0-9_]+),.*Initial residual\s*=\s*([0-9.eE+-]+)/;

  function emit() {
    if (Number.isNaN(lastTime)) return;
    const point: ResidualPoint & { runId: string } = {
      time: lastTime,
      fields: { ...fieldsAtTime },
      runId,
    };
    if (onResidual) onResidual(point);
    if (onTimeReached) onTimeReached(point);
  }

  function consume(line: string) {
    if (!onResidual) return;
    const tm = timeRe.exec(line);
    if (tm) {
      emit();
      lastTime = parseFloat(tm[1]);
      for (const k of Object.keys(fieldsAtTime)) delete fieldsAtTime[k];
      return;
    }
    const rm = residualRe.exec(line);
    if (rm) {
      const f = rm[1];
      const v = parseFloat(rm[2]);
      if (Number.isFinite(v)) fieldsAtTime[f] = v;
    }
  }
  return { consume, flush: emit };
}

// V1.8 — Convergence auto-detection.
//
// OpenFOAM emits lines like:
//   Time = 1
//   smoothSolver:  Solving for Ux, Initial residual = 1e-5, ...
//   DICPCG:        Solving for p,  Initial residual = 0.001, ...
// The residual parser already buffers fields per Time line and emits
// one ResidualPoint on each Time boundary; makeConvergenceChecker
// hooks `consume(point)` into that flow via `onTimeReached`.
//
// Criterion (per V1.8 thinker verdict #3 + #5):
//   • Watch the longest-running per-field "below-threshold streak"
//     across all observed fields.
//   • Fire onConverge once the streak reaches `stableIterations`
//     AND we've seen at least that many distinct timesteps (avoids
//     a single quiet step satisfying the criterion trivially).
//   • Auto-stop is opt-in via `autoStop`, and routes through
//     `cancelRun(run.id, "converged")` so `executeRun` emits
//     'converged' as the terminal phase instead of 'cancelled'.
//   • Detector is sticky: `fired` is latched on first hit so a 2nd
//     detect within the same run doesn't double-emit 'converged'.
/**
 * Create a stateful convergence checker. Each call to `consume(point)`
 * ingests a ResidualPoint from the residual parser's `onTimeReached`
 * hook and updates the per-field below-threshold streak map. When
 * the longest streak reaches `stableIterations` AND `totalSamples`
 * has reached the same count, the checker fires exactly once: either
 * `opts.onPhase('converged', ...)` (informational) or `opts.stop()`
 * (for the `autoStop` path, which routes through `cancelRun` to
 * emit `'converged'` as the terminal phase from `executeRun`).
 *
 * Once fired, the checker is sticky (the `fired` flag is latched)
 * so a subsequent sample in the same run cannot double-emit
 * 'converged'. The V1.8 review-fix #2 field-dropout reset (any
 * field previously observed but absent from the current sample
 * resets its streak to 0) is what makes this safe across solver
 * restarts that drop fields from their output.
 */
export function makeConvergenceChecker(opts: {
  threshold: number;
  stableIterations: number;
  enabled: boolean;
  autoStop: boolean;
  onPhase: (phase: Phase, message: string | undefined) => void;
  /** Cancels the active run with reason='converged', so the
   *  executive loop terminates with the right phase. */
  stop: () => void;
}) {
  let totalSamples = 0;
  let fired = false;
  let lastTime = NaN;
  const below: Record<string, number> = {};
  /**
   * V1.8 review-fix #2 — fields seen in any prior sample. Any field
   * in `seenFields` that is ABSENT from the current sample is treated
   * as "unknown" and has its streak reset to 0; otherwise a field
   * that the solver stopped emitting (e.g. a turbulence model
   * restart, a phase where the field is irrelevant, or a solver
   * that doesn't report the field for a transient iteration) would
   * keep its prior streak value and could falsely satisfy
   * `stableIterations`.
   */
  const seenFields = new Set<string>();
  return {
    consume(point: ResidualPoint) {
      if (fired || !opts.enabled) return;
      lastTime = point.time;
      if (totalSamples === 0) {
        // First sample: seed the field-counter map at 0 (intentional;
        // cannot trigger from a single quiet step). Track every
        // field so future samples can detect their absence.
        totalSamples = 1;
        for (const k of Object.keys(point.fields)) {
          below[k] = 0;
          seenFields.add(k);
        }
        return;
      }
      const presentKeys = Object.keys(point.fields);
      const presentSet = new Set(presentKeys);
      // Update streaks for every present field; brand-new fields
      // default to 0 so they need a below-threshold observation to
      // start counting.
      for (const k of presentKeys) {
        seenFields.add(k);
        const v = point.fields[k];
        if (Number.isFinite(v) && v < opts.threshold) {
          below[k] = (below[k] ?? 0) + 1;
        } else {
          below[k] = 0;
        }
      }
      // V1.8 review-fix #2 — reset streaks for any field we've
      //  previously observed but that DROPPED OUT of this sample.
      // Without this, a solver that stops emitting `k` for a while
      // would leave `below.k` stuck at its prior value and could
      // falsely satisfy `stableIterations` once the streak count
      // landed on the right number.
      for (const k of seenFields) {
        if (!presentSet.has(k)) below[k] = 0;
      }
      totalSamples += 1;
      let longestStreak = 0;
      for (const s of Object.values(below)) {
        if (s > longestStreak) longestStreak = s;
      }
      if (
        totalSamples >= opts.stableIterations &&
        longestStreak >= opts.stableIterations
      ) {
        fired = true;
        if (opts.autoStop) {
          // V1.8 review-fix #3 — when auto-stopping, the executive
          //  `emitTerminal` in executeRun owns the final phase emit
          //  (it carries "during $stage" context). The monitor's
          //  informational `onPhase` is suppressed here to avoid
          //  back-to-back `'converged'` emissions that the IPC
          //  phase broadcaster throttle coalesces but that show as
          //  two emit calls in process logs / debug traces.
          opts.stop();
        } else {
          opts.onPhase(
            "converged",
            `Solver converged at t=${lastTime.toFixed(2)}`,
          );
        }
      }
    },
  };
}

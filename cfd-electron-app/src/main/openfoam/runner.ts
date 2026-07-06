/**
 * OpenFOAM subprocess runner.
 * - Spawns bash with the OpenFOAM bashrc sourced
 * - Streams stdout/stderr via throttled callbacks (no back-pressure flooding)
 * - Supports multi-stage pipelines (decompose -> solve -> reconstruct)
 * - Supports cancellation that kills the entire process group
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import type { Phase, LogChunk, ResidualPoint } from '@shared/types';
// V1.37a — pure / fs-based helpers extracted from this file into
//  @main/openfoam/runner-helpers (mirrors the V1.36* IPC-handler-
//  body lift pattern). The names are imported into local scope so
//  the rest of this file can call them directly, and re-exported at
//  the bottom for backward compat with the IPC barrel +
//  src/main/openfoam/case.ts.
import {
  buildRunPipeline,
  defaultRunRoot,
  ensureDir,
  formatDuration,
  type RunStage,
} from './runner-helpers';

export interface RunOptions {
  bashrc: string;
  caseDir: string;
  /** Stage pipeline: array of command specs executed in order. */
  stages: RunStage[];
  /**
   * Phase transitions carry the runId so the renderer can drop events that
   * belong to a previous run (esp. when a new run starts before the last
   * throttled phase event from the prior run has drained through IPC).
   */
  onPhase: (phase: Phase, message: string | undefined, runId: string) => void;
  /** Log deltas carry the runId for the same drop-stale-events reason. */
  onLog: (chunk: LogChunk & { runId: string }) => void;
  onResidual?: (point: ResidualPoint & { runId: string }) => void;
  /** V1.8 — convergence auto-detection config. Optional; if absent the
   *  detector is disabled (behaves like the pre-V1.8 runner). The renderer
   *  plumbs this through `ipcMain.handle(runStart) → startRun` from
   *  `state.solverControlsBySolver[formSolver].converge`. */
  convergence?: {
    enabled: boolean;
    /** Initial-residual threshold per field; below this counts as "good"
     *  for the streak counter. */
    maxInitialResidual: number;
    /** Consecutive timesteps any observed field must stay below the
     *  threshold before onPhase('converged') fires. */
    stableIterations: number;
    /** When true, immediately stop the solver on convergence via
     *  `cancelRun(run.id, "converged")` so `executeRun` emits
     *  'converged' rather than 'cancelled' as the terminal phase. */
    autoStop: boolean;
  };
}


// V1.37a — buildRunPipeline was lifted to @main/openfoam/runner-helpers.
//  See the import at the top + the re-export at the bottom of this
//  file. The implementation + JSDoc live in the new module.

interface ActiveRun {
  id: string;
  caseDir: string;
  proc: ChildProcess | null;
  cancelled: boolean;
  /** V1.8 — distinguishes a user-initiated cancel from a convergence-
   *  triggered auto-stop, so `executeRun` can emit 'cancelled' vs
   *  'converged' as the terminal phase. Defaults to 'user'; the
   *  `makeConvergenceChecker` flip-flop sets it to 'converged' before
   *  killing the process group, so the executive loop below sees the
   *  right reason when the child closes. */
  cancelledReason: "user" | "converged";
  done: boolean;
  startTime: number;
}

const activeRuns = new Map<string, ActiveRun>();
const LOG_FLUSH_INTERVAL_MS = 100;

/**
 * V1.29 -- LogBuffer's internal chunk + push + emit types widened
 *  from `LogChunk` to `LogChunk & { runId: string }`. Pre-V1.29 the
 *  callers stamped `runId: run.id` on the push-side (the buffered
 *  LogChunk going into the store), but the constructor's `emit` was
 *  typed `(chunk: LogChunk) => void`. Two surface issues from this:
 *    1. TS2353 at the push call sites (line 247 / 251 / 256):
 *       `runId does not exist in type 'LogChunk'`. The literal
 *       `{ stream, text, runId }` is structurally valid but the
 *       LogBuffer's push signature rejected it.
 *    2. Latent logic bug surfaced once the TS errors were exposed:
 *       the emit typed as `LogChunk` meant `opts.onLog(c)` (which
 *       expects `LogChunk & { runId }`) was being called with a
 *       runId-stripped chunk. The renderer would still receive
 *       events (with runId added by an outer broadcast path), but
 *       the LogBuffer surface contract was lying about what was
 *       in-flight. Widening to `LogChunk & { runId: string }` at
 *       every stage locks the contract end-to-end.
 */
export type LogEntry = LogChunk & { runId: string };
class LogBuffer {
  private chunks: LogEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  constructor(private emit: (chunk: LogEntry) => void) {}
  push(chunk: LogEntry) {
    this.chunks.push(chunk);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), LOG_FLUSH_INTERVAL_MS);
    }
  }
  flush() {
    if (this.chunks.length === 0) {
      this.timer = null;
      return;
    }
    // Coalesce into one message per stream. V1.29 widens the local
    //  accumulator from `LogChunk[]` to `LogEntry[]` so the
    //  downstream `this.emit(c)` call (also widened to expect
    //  `LogEntry`) sees a fully runId-stamped entry end-to-end.
    //  Pre-V1.29 the emit-side was lying about its LogChunk
    //  signature while callers stamped runId — the broadcast
    //  path masked it but the LogBuffer surface contract was
    //  inconsistent.
    const out: LogEntry[] = [];
    for (const c of this.chunks) {
      const last = out[out.length - 1];
      if (last && last.stream === c.stream) last.text += c.text;
      else out.push({ ...c });
    }
    for (const c of out) this.emit(c);
    this.chunks = [];
    this.timer = null;
  }
  end() {
    if (this.timer) clearTimeout(this.timer);
    this.flush();
  }
}

export async function startRun(
  opts: RunOptions,
  /** Pre-allocated so IPC closures can stamp `runId` onto every emitted event
   *  (including the FIRST one, which executeRun emits synchronously inside the
   *  call site). If omitted we generate one here. */
  providedRunId?: string,
): Promise<string> {
  const runId = providedRunId ?? randomUUID();
  const run: ActiveRun = {
    id: runId,
    caseDir: opts.caseDir,
    proc: null,
    cancelled: false,
    cancelledReason: "user",
    done: false,
    startTime: Date.now(),
  };
  activeRuns.set(runId, run);

  // Kick off background — caller awaits via events.
  void executeRun(run, opts).catch((err) => {
    opts.onLog({ stream: 'stderr', text: `\n[runner-error] ${String(err)}\n`, runId: run.id });
    opts.onPhase('error', String(err), run.id);
    run.done = true;
  });

  return runId;
}

async function executeRun(run: ActiveRun, opts: RunOptions) {
  const emitPhase = (phase: Phase, message?: string) => opts.onPhase(phase, message, run.id);
  /** V1.8 — emit the right terminal phase depending on how the run
   *  ended. 'converged' fires instead of 'cancelled' when the
   *  convergence detector auto-stopped the solver. `contextLabel`
   *  is appended as a "during <stage>" qualifier where useful,
   *  e.g. `during meshing`. */
  function emitTerminal(contextLabel: string) {
    const whereSuffix = contextLabel ? ` ${contextLabel}` : "";
    if (run.cancelledReason === "converged") {
      emitPhase("converged", `Solver converged — auto-stopped${whereSuffix} before endTime`);
    } else {
      emitPhase("cancelled", `Run was cancelled${whereSuffix}`);
    }
  }
  for (const stage of opts.stages) {
    if (run.cancelled) {
      emitTerminal("");
      return;
    }
    emitPhase(phaseForStage(stage.name), `Starting ${stage.name}: ${stage.command.join(' ')}`);
    const ok = await runStage(run, stage, opts);
    if (!ok) {
      if (run.cancelled) emitTerminal(`during ${stage.name}`);
      else emitPhase('error', `${stage.name} failed`);
      return;
    }
  }
  emitPhase('done', `Run ${run.id} completed in ${formatDuration(Date.now() - run.startTime)}`);
  run.done = true;
}

function phaseForStage(name: RunStage['name']): Phase {
  return name as Phase;
}

async function runStage(run: ActiveRun, stage: RunStage, opts: RunOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // Important: OpenFOAM solvers are bash scripts; always invoke via bash with sourced env.
    const bashCmd = `source "${opts.bashrc}" >/dev/null 2>&1 && cd "${opts.caseDir}" && ${stage.command.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`;

    const child = spawn('bash', ['-lc', bashCmd], {
      cwd: opts.caseDir,
      env: { ...process.env, ...stage.envOverrides, FOAM_RUN: '1' },
      // detached gives us our own process group; kill with -pid kills tree.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as ChildProcess;
    run.proc = child;

    const logger = new LogBuffer((c) => opts.onLog(c));
    // V1.8 — convergence monitor. Hooks into the residual parser via
    //  onTimeReached so it sees the SAME ResidualPoint the broadcaster
    //  does. `stop` routes through cancelRun with reason='converged'
    //  so the executive loop emits the correct terminal phase.
    const convergence = makeConvergenceChecker({
      threshold: opts.convergence?.maxInitialResidual ?? 1e-3,
      stableIterations: opts.convergence?.stableIterations ?? 50,
      enabled: opts.convergence?.enabled ?? false,
      autoStop: opts.convergence?.autoStop ?? false,
      onPhase: (phase, message) => opts.onPhase(phase, message, run.id),
      stop: () => cancelRun(run.id, "converged"),
    });
    const parser = makeResidualParser(opts.onResidual, run.id, (point) => {
      convergence.consume(point);
    });

    const stdout = readline.createInterface({ input: child.stdout! });
    const stderr = readline.createInterface({ input: child.stderr! });

    stdout.on('line', (line) => {
      logger.push({ stream: 'stdout', text: line + '\n', runId: run.id });
      parser.consume(stdoutLikeLine(stage.name, line));
    });
    stderr.on('line', (line) => {
      logger.push({ stream: 'stderr', text: line + '\n', runId: run.id });
      parser.consume(stdoutLikeLine(stage.name, line));
    });

    child.on('error', (err) => {
      logger.push({ stream: 'stderr', text: `\n[spawn-error] ${err.message}\n`, runId: run.id });
      logger.end();
      resolve(false);
    });

    child.on('close', (code, signal) => {
      logger.end();
      run.proc = null;
      if (run.cancelled) {
        resolve(false);
        return;
      }
      if (code === 0) resolve(true);
      else {
        opts.onLog({ stream: 'stderr', text: `[exit] code=${code} signal=${signal}\n`, runId: run.id });
        resolve(false);
      }
    });
  });
}

function stdoutLikeLine(stage: RunStage['name'], line: string): string {
  // attach stage name as subtle marker for parser
  return line;
}

/** V1.8 — `reason` distinguishes user-initiated aborts from
 *  convergence-triggered auto-stops. The executive `executeRun` loop
 *  reads `run.cancelledReason` to decide whether to emit 'cancelled'
 *  vs 'converged' as the terminal phase. Default is 'user' to keep
 *  existing callers (e.g. the Stop button in the renderer's
 *  `cancelSimulation` IPC handler) untouched. The convergence
 *  monitor passes 'converged' so the terminal phase reads
 *  "Solver converged — auto-stopped before endTime". */
export function cancelRun(runId: string, reason: "user" | "converged" = "user"): boolean {
  const run = activeRuns.get(runId);
  if (!run || run.done) return false;
  run.cancelled = true;
  run.cancelledReason = reason;
  if (run.proc && run.proc.pid) {
    try {
      // Negative pid -> kill entire process group (mpirun tree etc.)
      process.kill(-run.proc.pid, 'SIGTERM');
      // give it a moment, then SIGKILL
      setTimeout(() => {
        if (run.proc && run.proc.pid) {
          try { process.kill(-run.proc.pid, 'SIGKILL'); } catch { /* may already be gone */ }
        }
      }, 1500);
    } catch (err) {
      // fallback to single-process kill
      try { run.proc.kill('SIGTERM'); } catch { /* noop */ }
    }
  }
  return true;
}

export function listActiveRuns() {
  return Array.from(activeRuns.values()).map((r) => ({
    id: r.id,
    caseDir: r.caseDir,
    cancelled: r.cancelled,
    done: r.done,
    startTime: r.startTime,
  }));
}

// ----- Residual parser -----
// OpenFOAM logs lines like:
//   Time = 1
//   smoothSolver:  Solving for Ux, Initial residual = 1e-5, Final residual = 1e-7, No Iterations 4
//   DICPCG:  Solving for p, Initial residual = 0.001, Final residual = 5e-4, No Iterations 12
function makeResidualParser(
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
function makeConvergenceChecker(opts: {
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

// V1.37a — formatDuration / ensureDir / defaultRunRoot were lifted
//  to @main/openfoam/runner-helpers. See the import at the top +
//  the re-export at the bottom of this file. The implementations +
//  JSDocs live in the new module.

// V1.37a — re-export the lifted helpers + the RunStage type from
//  @main/openfoam/runner-helpers for backward compat. The IPC
//  barrel in src/main/ipc/index.ts and the case.ts render path
//  keep importing these names from '@main/openfoam/runner'
//  without churn.
export {
  buildRunPipeline,
  defaultRunRoot,
  ensureDir,
  formatDuration,
  type RunStage,
} from './runner-helpers';

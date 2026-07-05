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
}

export interface RunStage {
  name: 'meshing' | 'snapping' | 'decomposing' | 'solving' | 'reconstructing' | 'converting' | 'cleanup';
  /** e.g. ["blockMesh"] or ["mpirun","-np","4","simpleFoam","-parallel"] */
  command: string[];
  /** If true, append "-parallel" to simpleFoam etc. */
  envOverrides?: Record<string, string>;
}

/**
 * Build the OpenFOAM pipeline appropriate for a case.
 *
 *   • geometryKind === 'imported' (snappyHexMeshDict present, patches exported):
 *       blockMesh → snappyHexMesh -overwrite → [decomposePar → solver -parallel → reconstructPar] → foamToVTK
 *
 *   • otherwise (parametric / coord-space domain):
 *       blockMesh → [decomposePar → solver -parallel → reconstructPar] → foamToVTK
 *
 * `cores` controls whether `decomposePar` and `mpirun` are used.
 */
export function buildRunPipeline(opts: {
  cores: number;
  solver: string;
  geometryKind?: 'parametric' | 'imported';
}): RunStage[] {
  const { cores, solver, geometryKind = 'parametric' } = opts;
  const stages: RunStage[] = [];

  // Background mesh is required in BOTH flows so snappy has hexes to chop into.
  stages.push({ name: 'meshing', command: ['blockMesh'] });

  if (geometryKind === 'imported') {
    // '-overwrite' lets us re-run snappy in place without manual `rm -rf constant/polyMesh`.
    stages.push({ name: 'snapping', command: ['snappyHexMesh', '-overwrite'] });
  }

  if (cores > 1) {
    stages.push({ name: 'decomposing', command: ['decomposePar'] });
    stages.push({ name: 'solving', command: ['mpirun', '-np', String(cores), solver, '-parallel'] });
    stages.push({ name: 'reconstructing', command: ['reconstructPar'] });
  } else {
    stages.push({ name: 'solving', command: [solver] });
  }

  stages.push({ name: 'converting', command: ['foamToVTK', '-ascii'] });
  return stages;
}

interface ActiveRun {
  id: string;
  caseDir: string;
  proc: ChildProcess | null;
  cancelled: boolean;
  done: boolean;
  startTime: number;
}

const activeRuns = new Map<string, ActiveRun>();
const LOG_FLUSH_INTERVAL_MS = 100;

class LogBuffer {
  private chunks: LogChunk[] = [];
  private timer: NodeJS.Timeout | null = null;
  constructor(private emit: (chunk: LogChunk) => void) {}
  push(chunk: LogChunk) {
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
    // Coalesce into one message per stream
    const out: LogChunk[] = [];
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
  for (const stage of opts.stages) {
    if (run.cancelled) {
      emitPhase('cancelled', 'Run was cancelled');
      return;
    }
    emitPhase(phaseForStage(stage.name), `Starting ${stage.name}: ${stage.command.join(' ')}`);
    const ok = await runStage(run, stage, opts);
    if (!ok) {
      if (run.cancelled) emitPhase('cancelled', `Cancelled during ${stage.name}`);
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
    const parser = makeResidualParser(opts.onResidual, run.id);

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

export function cancelRun(runId: string): boolean {
  const run = activeRuns.get(runId);
  if (!run || run.done) return false;
  run.cancelled = true;
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
) {
  let lastTime = NaN;
  const fieldsAtTime: Record<string, number> = {};
  const timeRe = /^\s*Time\s*=\s*([0-9.eE+-]+)/;
  const residualRe = /Solving for ([A-Za-z0-9_]+),.*Initial residual\s*=\s*([0-9.eE+-]+)/;

  function emit() {
    if (!onResidual) return;
    if (Number.isNaN(lastTime)) return;
    onResidual({ time: lastTime, fields: { ...fieldsAtTime }, runId });
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

// ----- Utility -----
function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}

export { formatDuration };

/** Ensure a directory exists, creating it recursively. */
export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

/** Default scratchpad location for run artifacts. */
export function defaultRunRoot(): string {
  return path.join(os.homedir(), 'CFDStudio', 'runs');
}

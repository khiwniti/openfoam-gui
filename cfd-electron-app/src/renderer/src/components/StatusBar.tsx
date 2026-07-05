/**
 * Status strip directly under the TopBar.
 *
 * Two zones:
 *   \u2022 Geometry (left) \u2014 the V0.5 geometry message + tone.
 *   \u2022 Run (right)     \u2014 phase pill, last stdout line(s), live residual
 *                          sparkline (V1.0) + small `t=N` readout.
 */
import { useGeometryStore } from "../store";
import { ResidualSparkline } from "./ResidualSparkline";

const tones: Record<string, string> = {
  idle: "text-bg-300 bg-bg-900",
  loading: "text-brand-100 bg-brand-700",
  error: "text-red-100 bg-red-700",
  ready: "text-emerald-100 bg-emerald-700",
};

const phaseTone: Record<string, string> = {
  idle: "bg-bg-800 text-bg-300",
  preparing: "bg-bg-800 text-bg-100",
  meshing: "bg-amber-700/30 text-amber-100",
  snapping: "bg-amber-700/30 text-amber-100",
  decomposing: "bg-amber-700/30 text-amber-100",
  solving: "bg-emerald-700/30 text-emerald-100",
  reconstructing: "bg-amber-700/30 text-amber-100",
  converting: "bg-amber-700/30 text-amber-100",
  done: "bg-emerald-700 text-emerald-100",
  error: "bg-red-700 text-red-100",
  cancelled: "bg-bg-700 text-bg-100",
};

export function StatusBar() {
  const status = useGeometryStore((s) => s.status);
  const recentLogs = useGeometryStore((s) => s.recentLogs);
  const runPhase = useGeometryStore((s) => s.runPhase);
  const isRunning = useGeometryStore((s) => s.isRunning);
  const lastResidual = useGeometryStore((s) => s.lastResidual);

  const tone = tones[status.kind] ?? tones.idle!;
  const phaseClass = phaseTone[runPhase] ?? phaseTone.idle!;

  // Show the last 2 stdout lines (or 1 if it's the only content) in the tail.
  const tailStdout = recentLogs.filter((l) => l.stream === "stdout").slice(-2);
  const lastStderr = recentLogs.filter((l) => l.stream === "stderr").slice(-1)[0];
  const hasAnyLog = recentLogs.length > 0;

  return (
    <div className="flex items-stretch border-b border-bg-800">
      {/* Geometry zone (existing) */}
      <div
        className={`flex-1 min-w-0 px-3 py-1.5 text-xs font-medium ${tone} truncate`}
        title={status.message ?? status.kind}
      >
        <span className="opacity-70 uppercase tracking-widest mr-2">{status.kind}</span>
        <span className="font-mono">{status.message ?? "(nothing happening)"}</span>
      </div>

      {/* Run zone (V0.8 + V1.0) */}
      <div className="flex items-stretch min-w-0 max-w-[60%] border-l border-bg-800 bg-bg-900">
        <div
          className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider flex items-center ${phaseClass}`}
          title={isRunning ? "OpenFOAM run in flight" : "Idle"}
        >
          {isRunning ? (
            <span className="inline-block w-2 h-2 rounded-full bg-current animate-pulse mr-1.5" aria-hidden />
          ) : null}
          {runPhase}
        </div>

        <div
          className="flex-1 min-w-0 px-3 py-1.5 text-[11px] font-mono text-bg-300 truncate"
          title={
            lastStderr ? `stderr\u00b7${lastStderr.text}` : tailStdout.map((l) => l.text).join("\n") || ""
          }
        >
          {!hasAnyLog ? (
            <span className="italic text-bg-300/70">run output will appear here</span>
          ) : (
            <div className="flex flex-col gap-0.5 leading-tight">
              {lastStderr && <div className="text-red-300/90 truncate">! {lastStderr.text}</div>}
              {tailStdout.map((l, i) => (
                <div key={`${l.text}-${i}`} className="truncate text-bg-300">
                  {l.text}
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono text-bg-300 whitespace-nowrap"
          title={
            lastResidual
              ? `t=${lastResidual.time.toFixed(2)} \u00b7 ${Object.keys(lastResidual.fields).length} fields`
              : ""
          }
        >
          <ResidualSparkline />
          {lastResidual ? (
            <span>
              <span className="text-bg-300/70">t=</span>
              <span className="text-bg-100">{lastResidual.time.toFixed(2)}</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

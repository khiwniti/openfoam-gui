/**
 * Top toolbar — geometry-prep + run controls (V0.8).
 *
 * Left half: open CAD files, pick target case.
 * Center:    OpenFOAM detect indicator + bashrc override + cores.
 * Right:     Run / Stop buttons, with a gear icon that opens the Settings modal.
 */
import { useState } from "react";
import { useGeometryStore } from "../store";

export function TopBar() {
  const pickAndLoad = useGeometryStore((s) => s.pickAndLoad);
  const reset = useGeometryStore((s) => s.reset);
  const caseOptions = useGeometryStore((s) => s.caseOptions);
  const activeCaseDir = useGeometryStore((s) => s.activeCaseDir);
  const setActiveCase = useGeometryStore((s) => s.setActiveCase);
  const refreshCases = useGeometryStore((s) => s.refreshCases);

  // OpenFOAM run slice
  const openfoamDetected = useGeometryStore((s) => s.openfoamDetected);
  const isDetecting = useGeometryStore((s) => s.isDetecting);
  const bashrc = useGeometryStore((s) => s.bashrc);
  const setBashrc = useGeometryStore((s) => s.setBashrc);
  const cores = useGeometryStore((s) => s.cores);
  const setCores = useGeometryStore((s) => s.setCores);
  const isRunning = useGeometryStore((s) => s.isRunning);
  const runPhase = useGeometryStore((s) => s.runPhase);
  const runId = useGeometryStore((s) => s.runId);
  const detectOpenfoam = useGeometryStore((s) => s.detectOpenfoam);
  const startSimulation = useGeometryStore((s) => s.startSimulation);
  const cancelSimulation = useGeometryStore((s) => s.cancelSimulation);
  const openSettings = useGeometryStore((s) => s.openSettings);

  const [editingBashrc, setEditingBashrc] = useState(false);

  // Run is launchable only when we have a case dir, a sourced bashrc, and we're
  // not already mid-run.
  const runnable = !!activeCaseDir && !!bashrc && !isRunning;
  const stoppable = isRunning;

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-bg-900 border-b border-bg-800">
      <div className="flex items-center gap-2 mr-2">
        <span className="text-brand-500 font-bold tracking-tight text-lg">CFD</span>
        <span className="text-bg-100 font-semibold">Studio</span>
        <span className="ml-2 px-1.5 py-0.5 bg-brand-500/15 text-brand-400 text-[10px] rounded font-mono">GEOMETRY</span>
      </div>

      <div className="flex items-center gap-1">
        <ToolButton onClick={() => pickAndLoad("STEP")}>Open STEP</ToolButton>
        <ToolButton onClick={() => pickAndLoad("IGES")}>Open IGES</ToolButton>
        <ToolButton onClick={() => pickAndLoad("STL")}>Open STL</ToolButton>
      </div>

      <div className="flex items-center gap-2 ml-3">
        <span className="text-xs text-bg-300">Case:</span>
        <select
          className="bg-bg-800 border border-bg-800 text-bg-100 text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
          value={activeCaseDir ?? ""}
          onChange={(e) => setActiveCase(e.target.value || null)}
          onFocus={() => refreshCases()}
        >
          <option value="">— select case —</option>
          {caseOptions.map((c) => (
            <option key={c.dir} value={c.dir}>
              {c.name} ({c.kind})
            </option>
          ))}
        </select>
      </div>

      {/* OpenFOAM detection + bashrc + cores (V0.8) */}
      <div className="flex items-center gap-2 ml-3 pl-3 border-l border-bg-800">
        <button
          onClick={() => detectOpenfoam()}
          disabled={isDetecting}
          title={
            openfoamDetected?.found
              ? `OpenFOAM ${openfoamDetected.version ?? ""} \u2014 click to re-detect`
              : openfoamDetected
              ? "Click to retry detection"
              : "Detect an installed OpenFOAM distribution"
          }
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded bg-bg-800 hover:bg-bg-700 disabled:opacity-60 text-bg-100 transition-colors"
        >
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              isDetecting
                ? "bg-amber-400 animate-pulse"
                : openfoamDetected?.found
                ? "bg-emerald-400"
                : openfoamDetected
                ? "bg-red-400"
                : "bg-bg-300"
            }`}
            aria-hidden
          />
          {isDetecting ? "Detecting\u2026" : "Detect OpenFOAM"}
        </button>
        {openfoamDetected?.found && (
          <span className="text-[11px] font-mono text-emerald-300" title={openfoamDetected.bashrc ?? ""}>
            v{openfoamDetected.version ?? "?"}
          </span>
        )}

        {/* Bashrc input \u2014 click to edit, only when there IS something to source (or after detection). */}
        {openfoamDetected ? (
          editingBashrc ? (
            <input
              autoFocus
              defaultValue={bashrc ?? ""}
              placeholder="/path/to/etc/bashrc"
              onBlur={(e) => {
                // Guard against accidental blank-on-blur wiping the detected bashrc
                // (which would lock Run behind another Detect). Only commit when
                // the user actually entered a non-empty path; otherwise preserve.
                const trimmed = e.target.value.trim();
                setBashrc(trimmed.length > 0 ? trimmed : bashrc);
                setEditingBashrc(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditingBashrc(false);
              }}
              className="w-72 px-2 py-1 text-[11px] font-mono bg-bg-800 border border-bg-800 rounded text-bg-100 placeholder:text-bg-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          ) : (
            <button
              onClick={() => setEditingBashrc(true)}
              title="Click to override bashrc path"
              className="text-[11px] font-mono text-bg-300 hover:text-bg-100 max-w-[18rem] truncate"
            >
              {bashrc || "\u2014 set bashrc \u2014"}
            </button>
          )
        ) : null}

        <label className="flex items-center gap-1.5 text-xs text-bg-300" title="MPI processes for mpirun">
          <span>Cores</span>
          <input
            type="number"
            min={1}
            max={64}
            value={cores}
            onChange={(e) => setCores(Number(e.target.value))}
            disabled={isRunning}
            className="w-14 px-1.5 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
          />
        </label>
      </div>

      {/* Run / Stop (right aligned) */}
      <div className="ml-auto flex items-center gap-2">
        {!stoppable ? (
          <button
            onClick={() => startSimulation()}
            disabled={!runnable}
            title={
              !activeCaseDir
                ? "Pick a target case first"
                : !bashrc
                ? "Detect OpenFOAM first"
                : runPhase === "done" || runPhase === "error" || runPhase === "cancelled"
                ? "Re-run this case"
                : "Run OpenFOAM pipeline"
            }
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 disabled:bg-bg-800 disabled:text-bg-300 text-white transition-colors"
          >
            <span aria-hidden>\u25B6</span>
            Run
            {runId ? <span className="font-mono opacity-70 text-[10px]">#{runId.slice(0, 6)}</span> : null}
          </button>
        ) : (
          <button
            onClick={() => cancelSimulation()}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded bg-red-500 hover:bg-red-600 active:bg-red-700 text-white transition-colors"
          >
            <span aria-hidden>\u25A0</span>
            Stop
          </button>
        )}
        <ToolButton onClick={reset} disabled={isRunning} className="bg-bg-800 hover:bg-bg-700">
          Clear
        </ToolButton>
        <button
          onClick={() => openSettings()}
          title="Open Settings (bashrc, run root, log buffer)"
          aria-label="Open Settings"
          className="px-2.5 py-1.5 text-sm rounded text-bg-300 hover:text-bg-100 hover:bg-bg-800"
        >
          {/* gear glyph */}
          <span aria-hidden>{'\u2699\uFE0F'}</span>
        </button>
      </div>
    </div>
  );
}

function ToolButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode },
) {
  const { className = "", children, ...rest } = props;
  return (
    <button
      {...rest}
      className={`px-3 py-1.5 text-xs font-semibold rounded bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white transition-colors disabled:bg-bg-800 disabled:text-bg-300 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}

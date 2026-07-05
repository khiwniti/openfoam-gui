/**
 * App root layout for the geometry prep view.
 *
 * Wireframe:
 *   ┌──────────────── TopBar ─────────────────┐
 *   │ Status strip (geometry + run)            │
 *   ├────────────────────┬──────────────────────┤
 *   │                    │                       │
 *   │ Viewer (R3F)       │ PatchPanel / Faces    │
 *   │                    │                       │
 *   └────────────────────┴──────────────────────┘
 *
 * V0.8 also wires the long-lived IPC subscriptions for run logs / phase /
 * residuals. They live here so subscribers are mounted exactly once per app.
 */
import { useEffect } from "react";
import { useGeometryStore } from "./store";
import { TopBar } from "./components/TopBar";
import { StatusBar } from "./components/StatusBar";
import { Viewer } from "./components/Viewer";
import { PatchPanel } from "./components/PatchPanel";
import { SettingsModal } from "./components/SettingsModal";

export default function App() {
  const refreshCases = useGeometryStore((s) => s.refreshCases);
  const reset = useGeometryStore((s) => s.reset);
  const appendLogChunk = useGeometryStore((s) => s.appendLogChunk);
  const setRunPhase = useGeometryStore((s) => s.setRunPhase);
  const pushResidual = useGeometryStore((s) => s.pushResidual);
  const loadSettings = useGeometryStore((s) => s.loadSettings);

  useEffect(() => {
    refreshCases();
  }, [refreshCases]);

  // V0.9: pull persisted preferences (bashrc, default run root, log buffer cap)
  // from main on mount so subsequent runs don't require a manual Detect click.
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Wire the run-stream subscriptions once for the lifetime of the app. The IPC
  // bridges from preload return unsubscribe functions directly. We intentionally
  // do not couple them to component state — these streams must survive patch
  // edits / case changes without dropping line history.
  useEffect(() => {
    const offLog = window.cfd.run.onLog((chunk) => appendLogChunk(chunk));
    const offPhase = window.cfd.run.onPhase((evt) => setRunPhase(evt.phase, evt.message));
    const offResid = window.cfd.run.onResidual((r) => pushResidual(r));
    return () => {
      offLog?.();
      offPhase?.();
      offResid?.();
    };
  }, [appendLogChunk, setRunPhase, pushResidual]);

  // Wipe stale state on remount (defensive — keeps one-shape-at-a-time promise).
  useEffect(() => () => { reset(); }, [reset]);

  return (
    <div className="h-screen w-screen flex flex-col bg-bg-950 text-bg-100 overflow-hidden">
      <TopBar />
      <StatusBar />
      <div className="flex-1 grid grid-cols-[1fr_360px] min-h-0">
        <div className="relative bg-bg-900 border-r border-bg-800 min-w-0 min-h-0">
          <Viewer />
        </div>
        <PatchPanel />
      </div>
      <SettingsModal />
    </div>
  );
}

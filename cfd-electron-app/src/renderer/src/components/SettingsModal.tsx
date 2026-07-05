/**
 * Settings modal (V0.9). First modal in the renderer \u2014 sets the precedent for a
 * shadow/backdrop + centered card layout using the existing dark-theme tokens.
 *
 * Fields:
 *   \u2022 OpenFOAM bashrc path          (text + Verify button \u2014 reuses detect.ts's verifyBashrc)
 *   \u2022 Default run root directory    (text; where newly-created case dirs land)
 *   \u2022 Max log buffer lines          (number; flips the in-memory recentLogs cap)
 *
 * All fields bind to store.settings and go through `saveSettings` (which also
 * refreshes the case list and surfaces the new bashrc to the run slice).
 */
import { useEffect, useRef, useState } from "react";
import { useGeometryStore } from "../store";

export function SettingsModal() {
  const isOpen = useGeometryStore((s) => s.isSettingsOpen);
  const settings = useGeometryStore((s) => s.settings);
  const closeSettings = useGeometryStore((s) => s.closeSettings);
  const saveSettings = useGeometryStore((s) => s.saveSettings);
  const verifyBashrc = useGeometryStore((s) => s.verifyBashrc);
  const isVerifying = useGeometryStore((s) => s.isVerifyingBashrc);

  // Local form state seeded from the persisted settings ONLY on the open
  // transition (false\u2192true). We deliberately don't bind inputs to settings
  // directly so an invalid intermediate value (e.g. empty bashrc mid-edit)
  // doesn't blow away the stored value before Save \u2014 AND so a settings change
  // triggered by another flow (verifyBashrc auto-saves success, etc.) does NOT
  // wipe the user's in-progress edits while the modal is already open.
  const [bashrc, setBashrcLocal] = useState(settings.openfoamBashrc ?? "");
  const [runRoot, setRunRootLocal] = useState(settings.defaultRunRoot ?? "");
  const [maxLines, setMaxLinesLocal] = useState(String(settings.maxLogBufferLines ?? 2000));
  const wasOpen = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      // Open transition \u2014 fresh seed from the latest settings snapshot.
      setBashrcLocal(settings.openfoamBashrc ?? "");
      setRunRootLocal(settings.defaultRunRoot ?? "");
      setMaxLinesLocal(String(settings.maxLogBufferLines ?? 2000));
    }
    wasOpen.current = isOpen;
  }, [isOpen, settings]);

  // Esc closes the modal.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, closeSettings]);

  if (!isOpen) return null;

  const onSave = () => {
    const parsedLines = Math.max(50, Math.min(20_000, Math.floor(Number(maxLines) || 2000)));
    void saveSettings({
      openfoamBashrc: bashrc.trim() || undefined,
      defaultRunRoot: runRoot.trim() || undefined,
      maxLogBufferLines: parsedLines,
    });
    closeSettings();
  };

  const onVerifyBashrc = () => {
    const p = bashrc.trim();
    if (!p) return;
    void verifyBashrc(p);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      onClick={(e) => {
        // Backdrop click closes; inner-clicks don't bubble.
        if (e.target === e.currentTarget) closeSettings();
      }}
    >
      <div className="absolute inset-0 bg-bg-950/80 backdrop-blur-sm" aria-hidden />
      <div className="relative w-full max-w-2xl bg-bg-900 border border-bg-800 rounded-lg shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-bg-800">
          <h2 id="settings-modal-title" className="text-sm font-semibold text-bg-100">
            Settings
          </h2>
          <button
            onClick={closeSettings}
            className="text-bg-300 hover:text-bg-100 text-xs px-2 py-1 rounded"
            aria-label="Close settings"
          >
            \u2715
          </button>
        </div>

        <div className="p-5 space-y-5">
          <Field
            label="OpenFOAM bashrc"
            help="Path to the OpenFOAM environment bashrc (e.g. /opt/openfoam/etc/bashrc). Verify checks it can be sourced and reports the WM_PROJECT_VERSION."
          >
            <div className="flex gap-2">
              <input
                type="text"
                value={bashrc}
                onChange={(e) => setBashrcLocal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onVerifyBashrc();
                }}
                placeholder="/opt/openfoam/etc/bashrc"
                className="flex-1 px-3 py-2 text-xs font-mono bg-bg-800 border border-bg-800 rounded text-bg-100 placeholder:text-bg-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                onClick={onVerifyBashrc}
                disabled={isVerifying || bashrc.trim().length === 0}
                className="px-3 py-2 text-xs font-semibold rounded bg-bg-800 hover:bg-bg-700 disabled:opacity-50 disabled:cursor-not-allowed text-bg-100"
              >
                {isVerifying ? "Verifying\u2026" : "Verify"}
              </button>
            </div>
          </Field>

          <Field
            label="Default run root"
            help="Directory under which new case folders are created. Leave empty to use the default ($HOME/CFDStudio/runs)."
          >
            <input
              type="text"
              value={runRoot}
              onChange={(e) => setRunRootLocal(e.target.value)}
              placeholder="$HOME/CFDStudio/runs"
              className="w-full px-3 py-2 text-xs font-mono bg-bg-800 border border-bg-800 rounded text-bg-100 placeholder:text-bg-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>

          <Field
            label="Max log buffer lines"
            help="How many of the most recent stdout/stderr lines to keep in the StatusBar run strip and clearRunState target."
          >
            <input
              type="number"
              min={50}
              max={20_000}
              step={50}
              value={maxLines}
              onChange={(e) => setMaxLinesLocal(e.target.value)}
              className="w-32 px-3 py-2 text-xs font-mono bg-bg-800 border border-bg-800 rounded text-bg-100 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-bg-800 bg-bg-950">
          <button
            onClick={closeSettings}
            className="px-4 py-2 text-xs font-semibold rounded text-bg-300 hover:text-bg-100 hover:bg-bg-800"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            className="px-4 py-2 text-xs font-bold rounded bg-emerald-500 hover:bg-emerald-600 text-white"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider font-semibold text-bg-300 mb-1">
        {label}
      </span>
      {children}
      <span className="block text-[10px] text-bg-300 mt-1.5 leading-snug">{help}</span>
    </label>
  );
}

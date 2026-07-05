/**
 * Right-side panel for patch management.
 *
 * Layout:
 *   • "Selection" section — face index list (capped), quick clear button.
 *   • "Patches" section — list of named patches; each has an export button.
 *   • "New patch" input row at the bottom.
 */
import { useState } from "react";
import { useGeometryStore } from "../store";
import type {
  BcField,
  BoundaryConditions,
  PatchRefinement,
  PatchRefinements,
  SolverControls,
} from "@shared/types";

export function PatchPanel() {
  const prep = useGeometryStore((s) => s.prep);
  const selectedFaceIds = useGeometryStore((s) => s.selectedFaceIds);
  const patches = useGeometryStore((s) => s.patches);
  const clearSelection = useGeometryStore((s) => s.clearSelection);
  const createPatch = useGeometryStore((s) => s.createPatch);
  const assignSelectionToPatch = useGeometryStore((s) => s.assignSelectionToPatch);
  const deletePatch = useGeometryStore((s) => s.deletePatch);
  const exportPatch = useGeometryStore((s) => s.exportPatch);
  const activeCaseDir = useGeometryStore((s) => s.activeCaseDir);
  // V1.2 — boundary conditions slice.
  const boundaryConditions = useGeometryStore((s) => s.boundaryConditions);
  const setPatchBc = useGeometryStore((s) => s.setPatchBc);
  // V1.4 — per-patch snappy refinement levels.
  const patchRefinements = useGeometryStore((s) => s.patchRefinements);
  const setPatchRefinement = useGeometryStore((s) => s.setPatchRefinement);
  const refreshCases = useGeometryStore((s) => s.refreshCases);
  const buildCaseFromPatches = useGeometryStore((s) => s.buildCaseFromPatches);

  // V1.1 — results panel
  const resultsAvailableTimes = useGeometryStore((s) => s.resultsAvailableTimes);
  const resultsFieldsByTime = useGeometryStore((s) => s.resultsFieldsByTime);
  const resultsSelectedTime = useGeometryStore((s) => s.resultsSelectedTime);
  const resultsSelectedField = useGeometryStore((s) => s.resultsSelectedField);
  const resultsIsLoading = useGeometryStore((s) => s.resultsIsLoading);
  const selectResultsTime = useGeometryStore((s) => s.selectResultsTime);
  const selectResultsField = useGeometryStore((s) => s.selectResultsField);
  const revealResultsInFileManager = useGeometryStore((s) => s.revealResultsInFileManager);
  const openResultsDir = useGeometryStore((s) => s.openResultsDir);

  const [newName, setNewName] = useState<string>("inlet");

  // Form state for the "Build Case" panel. V1.5: solver / endTime / cores /
  // nu are now in the global slice (`solverControlsBySolver`) so they
  // survive page reloads, and new deltaT / writeInterval / purgeWrite join
  // them. Build Case-specific knobs (paddingPercent, label) stay local —
  // they're case-internal rather than user-preference.
  const [paddingPercent, setPaddingPercent] = useState<number>(25);
  const [label, setLabel] = useState<string>("snappy-case");
  // V1.5 — solver runtime controls persisted across page reloads.
  const solverControlsBySolver = useGeometryStore((s) => s.solverControlsBySolver);
  const formSolver = useGeometryStore((s) => s.formSolver);
  const setFormSolver = useGeometryStore((s) => s.setFormSolver);
  const setSolverControl = useGeometryStore((s) => s.setSolverControl);
  const formValues = solverControlsBySolver[formSolver];
  // Steady solvers treat t as iteration count — Δt is fixed at 1 and the
  // input is masked so users can't enter nonsense.
  const isSteady = formSolver === "simpleFoam" || formSolver === "buoyantSimpleFoam" || formSolver === "potentialFoam";
  // V1.7 — local aliases for initialConditions so the JSX stays readable.
  //  `setSolverControl(formSolver, "initialConditions", {...})` does a
  //  shallow merge at the call site (we pass the full new object each
  //  time, since the inner x/y/z are typed numbers).
  const icVel = formValues.initialConditions.velocity;
  const icP = formValues.initialConditions.pressure;
  const setIcVel = (axis: "x" | "y" | "z", raw: string) => {
    const n = Number(raw);
    // NaN guard: cleared inputs (`""`) coerce to 0 (finite), bad input
    // (`"abc"`) coerces to NaN and we keep the old axis value so the field
    // doesn't accumulate `NaN`. Spread + index keeps it one branch instead
    // of a per-axis ternary.
    setSolverControl(formSolver, "initialConditions", {
      velocity: { ...icVel, [axis]: Number.isFinite(n) ? n : icVel[axis] },
      pressure: icP,
    });
  };
  const setIcP = (raw: string) => {
    const n = Number(raw);
    setSolverControl(formSolver, "initialConditions", {
      velocity: { x: icVel.x, y: icVel.y, z: icVel.z },
      pressure: Number.isFinite(n) ? n : 0,
    });
  };

  const selArr = Array.from(selectedFaceIds).sort((a, b) => a - b);
  const selCap = selArr.slice(0, 50);
  const selOverflow = selArr.length - selCap.length;

  return (
    <aside className="h-full min-h-0 flex flex-col gap-0 bg-bg-950">
      <Section title="Selection" right={
        selectedFaceIds.size > 0 ? (
          <button onClick={clearSelection} className="text-xs px-2 py-1 rounded text-bg-300 hover:text-bg-100 hover:bg-bg-800">
            Clear ({selectedFaceIds.size})
          </button>
        ) : null
      }>
        {!prep ? (
          <Empty>Load a file to start picking faces.</Empty>
        ) : selectedFaceIds.size === 0 ? (
          <Empty>Click faces in the viewer to select them.</Empty>
        ) : (
          <>
            <div className="text-xs text-bg-300 mb-2">
              <span className="font-mono text-bg-100">{selectedFaceIds.size}</span> faces selected
            </div>
            <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto pr-1">
              {selCap.map((fi) => (
                <span
                  key={fi}
                  className="inline-flex items-center justify-center min-w-[2.25rem] px-2 py-1 rounded bg-accent-500/15 text-accent-400 text-[11px] font-mono border border-accent-500/25"
                  title={`Face index ${fi}`}
                >
                  {fi}
                </span>
              ))}
              {selOverflow > 0 && (
                <span className="text-[11px] text-bg-300 px-1">+{selOverflow} more</span>
              )}
            </div>
          </>
        )}
      </Section>

      <Section title="Patches">
        {!prep ? (
          <Empty>Available after geometry is loaded.</Empty>
        ) : patches.length === 0 ? (
          <Empty>Create a patch below and assign faces to it.</Empty>
        ) : (
          <ul className="space-y-2">
            {patches.map((p) => (
              <li key={p.id} className="bg-bg-900 border border-bg-800 rounded p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-bg-100 text-sm" title={p.id}>{p.name}</span>
                  <button
                    onClick={() => deletePatch(p.id)}
                    className="text-[11px] text-bg-300 hover:text-red-400"
                    title="Delete patch"
                  >
                    ✕
                  </button>
                </div>
                <div className="text-[11px] text-bg-300 space-y-0.5">
                  <div><span className="font-mono">{p.faceIndices.length}</span> faces · <span className="font-mono">{p.triangleCount}</span> triangles</div>
                  {p.lastExportedRelPath ? (
                    <div className="text-accent-400 truncate" title={p.lastExportedRelPath}>↳ {p.lastExportedRelPath}</div>
                  ) : (
                    <div className="text-amber-400/80" title="STL not yet written for this patch">☼ STL pending</div>
                  )}
                </div>
                <div className="flex gap-1.5 mt-2">
                  <button
                    onClick={() => assignSelectionToPatch(p.id)}
                    disabled={selectedFaceIds.size === 0}
                    className="flex-1 px-2 py-1 text-[11px] font-semibold rounded bg-bg-800 hover:bg-bg-700 disabled:opacity-40 disabled:cursor-not-allowed text-bg-100"
                  >
                    Add selection
                  </button>
                  <button
                    onClick={() => exportPatch(p.id)}
                    disabled={!activeCaseDir || p.faceIndices.length === 0}
                    className="flex-1 px-2 py-1 text-[11px] font-semibold rounded bg-brand-500 hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed text-white"
                  >
                    Export STL
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <BoundaryConditionsSection
        prep={prep}
        patches={patches}
        boundaryConditions={boundaryConditions}
        onSetPatchBc={setPatchBc}
        patchRefinements={patchRefinements}
        onSetPatchRefinement={setPatchRefinement}
      />

      <Section title="Build Case">
        {!prep ? (
          <Empty>Load a geometry file to build a case from.</Empty>
        ) : patches.length === 0 ? (
          <Empty>Add at least one patch first.</Empty>
        ) : patches.some((p) => p.lastExportedRelPath == null) ? (
          <Empty>Export all patch STLs before building.</Empty>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1.5">
              <Field label="Solver">
                <select value={formSolver} onChange={(e) => setFormSolver(e.target.value as typeof formSolver)}
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100">
                  <option value="simpleFoam">simpleFoam</option>
                  <option value="pimpleFoam">pimpleFoam</option>
                  <option value="icoFoam">icoFoam</option>
                  <option value="potentialFoam">potentialFoam</option>
                  <option value="buoyantSimpleFoam">buoyantSimpleFoam</option>
                </select>
              </Field>
              <Field label="End time">
                <input type="number" min={1} value={formValues.endTime}
                  onChange={(e) => setSolverControl(formSolver, "endTime", Math.max(1, Number(e.target.value) || 1))}
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono" />
              </Field>
              <Field label={`Δt (s)${isSteady ? " · steady" : ""}`}>
                <input
                  type="number"
                  min={isSteady ? undefined : 1e-9}
                  step={isSteady ? undefined : "any"}
                  value={isSteady ? 1 : formValues.deltaT}
                  disabled={isSteady}
                  onChange={(e) => setSolverControl(formSolver, "deltaT", Number(e.target.value) || 1e-9)}
                  title={isSteady
                    ? "Δt is fixed at 1 for steady solvers — time is iteration count, not physics time."
                    : "Per-solver-step duration (seconds). Keep ≤ mesh-cell-size · Co-limit / |U|."}
                  className={
                    "w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono " +
                    (isSteady ? "opacity-50 cursor-not-allowed" : "")
                  }
                />
              </Field>
              <Field label="Write every">
                <input type="number" min={1} value={formValues.writeInterval}
                  onChange={(e) => setSolverControl(formSolver, "writeInterval", Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono" />
              </Field>
              <Field label="purgeWrite">
                <input type="number" min={0} value={formValues.purgeWrite}
                  onChange={(e) => setSolverControl(formSolver, "purgeWrite", Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  title="Keep only the latest N time dirs on disk (0 = keep all)"
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono" />
              </Field>
              <Field label="Cores">
                <input type="number" min={1} max={64} value={formValues.cores}
                  onChange={(e) => setSolverControl(formSolver, "cores", Math.max(1, Math.min(64, Math.floor(Number(e.target.value) || 1))))}
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono" />
              </Field>
              <Field label="ν  (m²/s)">
                <input type="number" step="1e-6" min={0} value={formValues.nu}
                  onChange={(e) => setSolverControl(formSolver, "nu", Number(e.target.value) || 0)}
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono" />
              </Field>
            </div>
            {/* V1.6 — turbulence model picker. Full-width row right below the
                 Solver / End-time grid so the RAS choice is visually paired with
                 the solver. `LES` is schema-allowed but the templates only emit
                 if/else branches for laminar/kEpsilon/kOmegaSST/SpalartAllmaras,
                 so the dropdown filters it out until V1.x adds an LES branch. */}
            <Field label="Turbulence model">
              <select
                value={formValues.turbulence}
                onChange={(e) => setSolverControl(formSolver, "turbulence", e.target.value as typeof formValues.turbulence)}
                className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100"
                title="RANS turbulence closure. Drives constant/momentumTransport and the fvSchemes/fvSolution solver entries."
              >
                <option value="laminar">laminar</option>
                <option value="kEpsilon">kEpsilon</option>
                <option value="kOmegaSST">kOmegaSST</option>
                <option value="SpalartAllmaras">SpalartAllmaras</option>
              </select>
            </Field>
            {/* V1.7 — initial-condition controls. Render `internalField uniform …;`
                 in 0/U and 0/p (and snappy variants) on Build. Object form
                 ({x,y,z}) so the Handlebars templates read `velocity.x` instead of
                 indexed access. Defaults are per-solver (see SOLVER_CONTROLS_DEFAULTS):
                 `potentialFoam` ships with a (1,0,0) freestream, all others zero
                 — keeps the lid-driven-cavity benchmark stable. Plain `Ux`/`Uy`/`Uz`
                 labels match BcFieldRow's existing style below (no Unicode-subscript
                 codepoints so we don't risk muddling the z glyph). */}
            <div className="grid grid-cols-3 gap-1.5">
              <Field label="Initial Ux (m/s)">
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={icVel.x}
                  onChange={(e) => setIcVel("x", e.target.value)}
                  title="Initial U component along X. Drives 0/U internalField."
                  aria-label="Initial U x"
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                />
              </Field>
              <Field label="Initial Uy (m/s)">
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={icVel.y}
                  onChange={(e) => setIcVel("y", e.target.value)}
                  title="Initial U component along Y."
                  aria-label="Initial U y"
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                />
              </Field>
              <Field label="Initial Uz (m/s)">
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={icVel.z}
                  onChange={(e) => setIcVel("z", e.target.value)}
                  title="Initial U component along Z."
                  aria-label="Initial U z"
                  className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
                />
              </Field>
            </div>
            <Field label="Initial p">
              <input
                type="number"
                step="any"
                inputMode="decimal"
                value={icP}
                onChange={(e) => setIcP(e.target.value)}
                title="Initial pressure (Pa or m²/s² for kinematic pressure). Incompressible solvers compute the level via BCs, so this is mostly first-step smoothing."
                aria-label="Initial pressure"
                className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
              />
            </Field>
            <Field label="Background padding (%) each side">
              <input type="number" min={0} max={200} value={paddingPercent}
                onChange={(e) => setPaddingPercent(Math.max(0, Math.min(200, Number(e.target.value) || 0)))}
                className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono" />
            </Field>
            <Field label="Case label">
              <input type="text" value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="snappy-case"
                className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 placeholder:text-bg-300" />
            </Field>
            <button
              onClick={() => buildCaseFromPatches({ paddingPercent, label: label.trim() || undefined }).then(() => refreshCases())}
              className="w-full px-3 py-2 mt-1 text-xs font-bold rounded bg-accent-500 hover:bg-accent-600 text-bg-950 transition-colors"
            >
              Build snappy case
            </button>
            <RunTimePreview values={formValues} isSteady={isSteady} />
            <p className="text-[10px] text-bg-300 leading-snug">
              Generates <span className="font-mono text-bg-100">blockMeshDict</span>, <span className="font-mono text-bg-100">snappyHexMeshDict</span>,
              patch-aware <span className="font-mono text-bg-100">0/U</span> &amp; <span className="font-mono text-bg-100">0/p</span>,
              and writes the on-disk state to <span className="font-mono text-bg-100">.cfd-app-state.json</span>.
              Edit <span className="font-mono text-bg-100">0/U</span> afterward for inlet / outlet BCs.
            </p>
          </div>
        )}
      </Section>

      <ResultsSection
        activeCaseDir={activeCaseDir}
        resultsAvailableTimes={resultsAvailableTimes}
        resultsFieldsByTime={resultsFieldsByTime}
        resultsSelectedTime={resultsSelectedTime}
        resultsSelectedField={resultsSelectedField}
        resultsIsLoading={resultsIsLoading}
        onSelectTime={selectResultsTime}
        onSelectField={selectResultsField}
        onReveal={revealResultsInFileManager}
        onOpenDir={openResultsDir}
      />

      <div className="mt-auto border-t border-bg-800 p-3 bg-bg-900">
        <div className="text-xs font-semibold text-bg-300 mb-1.5">Create patch</div>
        <div className="flex gap-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="patch name (e.g. inlet)"
            className="flex-1 px-2 py-1.5 text-sm bg-bg-800 border border-bg-800 rounded text-bg-100 placeholder:text-bg-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <button
            onClick={() => {
              const p = createPatch(newName || `patch-${patches.length + 1}`);
              if (selectedFaceIds.size > 0) assignSelectionToPatch(p.id);
            }}
            disabled={!prep}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-accent-500 hover:bg-accent-600 disabled:opacity-40 disabled:cursor-not-allowed text-bg-950"
          >
            Create
          </button>
        </div>
        <p className="text-[10px] text-bg-300 mt-2 leading-snug">
          Patches export to <span className="font-mono text-bg-100">constant/triSurface/&lt;name&gt;.stl</span> ready for <span className="font-mono text-bg-100">snappyHexMeshDict.geometry</span>.
        </p>
      </div>
    </aside>
  );
}

function Section(props: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-bg-800 p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] uppercase tracking-wide font-semibold text-bg-300">{props.title}</h3>
        {props.right}
      </div>
      {props.children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-bg-300 italic">{children}</div>;
}

/**
 * V1.1 — post-run results browser. Mounts inside PatchPanel below the Build
 * Case section. Reads from the results slice; on first render with an active
 * case it lazily lists time dirs and (on time-select) field names.
 */
function ResultsSection(props: {
  activeCaseDir: string | null;
  resultsAvailableTimes: number[];
  resultsFieldsByTime: Record<number, string[]>;
  resultsSelectedTime: number | null;
  resultsSelectedField: string | null;
  resultsIsLoading: boolean;
  onSelectTime: (t: number) => void;
  onSelectField: (f: string) => void;
  onReveal: () => void;
  onOpenDir: () => void;
}) {
  const {
    activeCaseDir,
    resultsAvailableTimes,
    resultsFieldsByTime,
    resultsSelectedTime,
    resultsSelectedField,
    resultsIsLoading,
    onSelectTime,
    onSelectField,
    onReveal,
    onOpenDir,
  } = props;
  const hasResults = resultsAvailableTimes.length > 0 || resultsIsLoading;
  return (
    <Section title="Results" right={
      hasResults ? (
        <div className="flex gap-1">
          <button
            onClick={onReveal}
            disabled={!activeCaseDir}
            title="Reveal the case's VTK output in the OS file manager"
            className="text-[11px] px-2 py-1 rounded text-bg-300 hover:text-bg-100 hover:bg-bg-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Reveal
          </button>
          <button
            onClick={onOpenDir}
            disabled={!activeCaseDir}
            title="Open the case's VTK output dir in the OS file manager"
            className="text-[11px] px-2 py-1 rounded text-bg-300 hover:text-bg-100 hover:bg-bg-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Open dir
          </button>
        </div>
      ) : null
    }>
      {!activeCaseDir ? (
        <Empty>No case active. Build or pick a case first.</Empty>
      ) : resultsIsLoading && resultsAvailableTimes.length === 0 ? (
        <Empty>Loading…</Empty>
      ) : resultsAvailableTimes.length === 0 ? (
        <Empty>No results yet — run a case to populate the &lt;time&gt; dirs.</Empty>
      ) : (
        <>
          <Field label="Time">
            <select
              value={resultsSelectedTime != null ? String(resultsSelectedTime) : ""}
              onChange={(e) => onSelectTime(Number(e.target.value))}
              className="w-full px-2 py-1 text-xs bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
            >
              {resultsAvailableTimes.map((t) => (
                <option key={t} value={t}>{t.toFixed(2)}</option>
              ))}
            </select>
          </Field>
          {(() => {
            const t = resultsSelectedTime;
            if (t == null) return null;
            const all = resultsFieldsByTime[t] ?? [];
            if (all.length === 0) return <Empty className="mt-2">No fields at this time.</Empty>;
            const whitelist = /^(U|p|T|k|epsilon|omega|nuTilda|nut|mut|alphat|alpha\..*)$/;
            const phys = all.filter((f) => whitelist.test(f));
            const other = all.filter((f) => !whitelist.test(f));
            const chip = (f: string) => (
              <button
                key={f}
                onClick={() => onSelectField(f)}
                className={
                  "px-2 py-1 rounded text-[11px] font-mono border " +
                  (resultsSelectedField === f
                    ? "bg-accent-500/20 text-accent-300 border-accent-500/40"
                    : "bg-bg-800 text-bg-300 border-bg-800 hover:bg-bg-700")
                }
              >
                {f}
              </button>
            );
            return (
              <>
                {phys.length > 0 && (
                  <Field label="Physical fields">
                    <div className="flex flex-wrap gap-1">{phys.map(chip)}</div>
                  </Field>
                )}
                {other.length > 0 && (
                  <Field label="Other">
                    <div className="flex flex-wrap gap-1">{other.map(chip)}</div>
                  </Field>
                )}
                {resultsSelectedField && (
                  <div className="mt-2 text-[11px] text-bg-300">
                    <span>Selected: </span>
                    <span className="font-mono text-bg-100">{resultsSelectedField}</span>
                    <span> @ t=</span>
                    <span className="font-mono text-bg-100">{t.toFixed(2)}</span>
                    <p className="mt-1 italic text-bg-300/70">
                      Raw OpenFOAM field dumps are large; use Reveal/Open to inspect in the OS file manager.
                    </p>
                  </div>
                )}
              </>
            );
          })()}
        </>
      )}
    </Section>
  );
}

// ---------- V1.4 — Refinement level row ----------

/** Coerce arbitrary input to an integer in the 0..7 snappy range. */
function clampRefinementLevel(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(7, Math.round(raw)));
}

function RefinementRow(props: {
  patchId: string;
  refinement: PatchRefinement;
  onChange: (patchId: string, refinement: PatchRefinement) => void;
}) {
  const { patchId, refinement, onChange } = props;
  const onMinChange = (raw: string) => {
    const n = clampRefinementLevel(Number(raw));
    onChange(patchId, { min: n, max: Math.max(n, refinement.max) });
  };
  const onMaxChange = (raw: string) => {
    const n = clampRefinementLevel(Number(raw));
    onChange(patchId, { min: Math.min(n, refinement.min), max: n });
  };
  return (
    <div className="grid grid-cols-[2rem_1fr_1fr] items-center gap-1.5 mt-1.5">
      <span className="text-[10px] uppercase tracking-wider text-bg-300 font-mono">
        Lvl
      </span>
      <input
        type="number"
        min={0}
        max={7}
        step={1}
        value={refinement.min}
        onChange={(e) => onMinChange(e.target.value)}
        title="Min snappy refinement level (0..7)"
        aria-label="Min refinement level"
        className="w-full px-1.5 py-0.5 text-[11px] bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
      />
      <input
        type="number"
        min={0}
        max={7}
        step={1}
        value={refinement.max}
        onChange={(e) => onMaxChange(e.target.value)}
        title="Max snappy refinement level (0..7)"
        aria-label="Max refinement level"
        className="w-full px-1.5 py-0.5 text-[11px] bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-bg-300 mb-0.5">{label}</span>
      {children}
    </label>
  );
}

/**
 * V1.5 — quick-look text below the Build Case button that turns the user's
 * numeric knobs into plain English: "1.0s physics · ~1000 dumps · keep 10".
 * Helps users spot the obvious foot-guns (writeInterval=1 → 1000 dumps;
 * purgeWrite=0 → fills disk on a long run) without opening controlDict.
 */
function RunTimePreview({ values, isSteady }: { values: SolverControls; isSteady: boolean }) {
  // Guard against divide-by-zero when the user just typed a bad value.
  const safeInterval = Math.max(1, values.writeInterval);
  const safeDeltaT = Math.max(1e-9, values.deltaT);
  const dumps = isSteady
    ? Math.max(1, Math.ceil(values.endTime / safeInterval))
    : Math.max(1, Math.ceil(values.endTime / (safeDeltaT * safeInterval)));
  return (
    <p className="text-[10px] text-bg-300 leading-snug italic">
      {isSteady ? (
        <>
          <span className="text-bg-100 font-mono not-italic">{values.endTime}</span>{" "}
          iterations · ≈<span className="text-bg-100 font-mono not-italic">{dumps}</span>{" "}
          dumps · keep latest{" "}
          <span className="text-bg-100 font-mono not-italic">{values.purgeWrite}</span>
        </>
      ) : (
        <>
          <span className="text-bg-100 font-mono not-italic">{values.endTime}</span>s{" "}
          physics · ≈<span className="text-bg-100 font-mono not-italic">{dumps}</span>{" "}
          dumps · keep latest{" "}
          <span className="text-bg-100 font-mono not-italic">{values.purgeWrite}</span>
        </>
      )}
    </p>
  );
}

// ---------- V1.2 — Boundary conditions editor ----------

/** The six BC kinds the editor exposes. `cyclic` is omitted on purpose —
 *  OpenFOAM's cyclic requires a paired `neighbourPatch` clause which the
 *  editor can't meaningfully maintain; users who need it can post-edit 0/U
 *  by hand. */
const BC_KINDS: ReadonlyArray<BcField["type"]> = [
  "fixedValue",
  "zeroGradient",
  "noSlip",
  "slip",
  "symmetryPlane",
  "empty",
];

const BC_KIND_LABEL: Record<BcField["type"], string> = {
  fixedValue: "fixedValue",
  zeroGradient: "zeroGradient",
  noSlip: "noSlip",
  slip: "slip",
  symmetryPlane: "symmetryPlane",
  empty: "empty",
};

/** True for BC kinds that take a value field in OpenFOAM. */
function bcNeedsValue(t: BcField["type"]): boolean {
  return t === "fixedValue";
}

/** Coerce a possibly-undefined value to a safe default for the given field. */
function defaultValueFor(field: "velocity" | "pressure"): BcField["value"] {
  return field === "velocity" ? [0, 0, 0] : 0;
}

/** Coerce a value to a 3-tuple of finite numbers (for velocity fixedValue). */
function asVec(v: BcField["value"] | undefined): [number, number, number] {
  if (Array.isArray(v) && v.length === 3) {
    return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
  }
  return [0, 0, 0];
}

/** Coerce a value to a finite number (for pressure fixedValue). */
function asScalar(v: BcField["value"] | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Read the BC for a (patch, field) pair, falling back to a sensible default
 *  if the slice has no entry yet (shouldn't happen for created patches, but
 *  legacy .cfd-app-state.json files may not have seeded entries). */
function readBc(
  bcs: BoundaryConditions,
  patchName: string,
  field: "velocity" | "pressure",
): BcField {
  const entry = bcs[field][patchName];
  if (entry) return entry;
  return field === "velocity"
    ? { type: "noSlip" }
    : { type: "zeroGradient" };
}

function BoundaryConditionsSection(props: {
  prep: ReturnType<typeof useGeometryStore.getState>["prep"];
  patches: ReturnType<typeof useGeometryStore.getState>["patches"];
  boundaryConditions: BoundaryConditions;
  onSetPatchBc: (
    patchId: string,
    field: "velocity" | "pressure",
    bc: BcField,
  ) => void;
  // V1.4 — per-patch refinement slice and setter.
  patchRefinements: PatchRefinements;
  onSetPatchRefinement: (patchId: string, refinement: PatchRefinement) => void;
}) {
  const {
    prep,
    patches,
    boundaryConditions: bcs,
    onSetPatchBc,
    patchRefinements: refs,
    onSetPatchRefinement,
  } = props;
  return (
    <Section title="Boundary conditions">
      {!prep ? (
        <Empty>Load a geometry file to set per-patch BCs.</Empty>
      ) : patches.length === 0 ? (
        <Empty>Create a patch below to assign BCs to it.</Empty>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] text-bg-300 leading-snug">
            Each row controls the <span className="font-mono text-bg-100">0/U</span> and
            <span className="font-mono text-bg-100"> 0/p</span> BCs plus the snappy
            refinement level for one patch when the case is built. Defaults:
            <span className="font-mono text-bg-100"> noSlip</span> for U,
            <span className="font-mono text-bg-100"> zeroGradient</span> for p, and
            <span className="font-mono text-bg-100"> (0 2)</span> for refinement.
          </p>
          <ul className="space-y-1.5">
            {patches.map((p) => {
              const u = readBc(bcs, p.name, "velocity");
              const pB = readBc(bcs, p.name, "pressure");
              return (
                <li
                  key={p.id}
                  className="bg-bg-900 border border-bg-800 rounded p-2"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className="font-semibold text-bg-100 text-xs truncate"
                      title={p.name}
                    >
                      {p.name}
                    </span>
                    <span className="text-[10px] text-bg-300 font-mono">
                      {p.faceIndices.length} faces
                    </span>
                  </div>
                  <BcFieldRow
                    label="U"
                    field="velocity"
                    patchId={p.id}
                    bc={u}
                    onChange={onSetPatchBc}
                  />
                  <BcFieldRow
                    label="p"
                    field="pressure"
                    patchId={p.id}
                    bc={pB}
                    onChange={onSetPatchBc}
                  />
                  <RefinementRow
                    patchId={p.id}
                    refinement={refs[p.name] ?? { min: 0, max: 0 }}
                    onChange={onSetPatchRefinement}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Section>
  );
}

function BcFieldRow(props: {
  label: string;
  field: "velocity" | "pressure";
  patchId: string;
  bc: BcField;
  onChange: (
    patchId: string,
    field: "velocity" | "pressure",
    bc: BcField,
  ) => void;
}) {
  const { label, field, patchId, bc, onChange } = props;
  const onTypeChange = (newType: BcField["type"]) => {
    if (newType === "fixedValue") {
      onChange(patchId, field, {
        type: newType,
        value: defaultValueFor(field),
      });
    } else {
      // Drop the value when switching to a non-value BC.
      onChange(patchId, field, { type: newType });
    }
  };
  const onVecChange = (axis: 0 | 1 | 2, raw: string) => {
    const n = Number(raw);
    const v = asVec(bc.value);
    v[axis] = Number.isFinite(n) ? n : 0;
    onChange(patchId, field, { type: "fixedValue", value: v });
  };
  const onScalarChange = (raw: string) => {
    const n = Number(raw);
    onChange(patchId, field, {
      type: "fixedValue",
      value: Number.isFinite(n) ? n : 0,
    });
  };
  const needsVal = bcNeedsValue(bc.type);
  return (
    <div className="grid grid-cols-[2rem_1fr] items-center gap-1.5 mt-1.5">
      <span className="text-[10px] uppercase tracking-wider text-bg-300 font-mono">
        {label}
      </span>
      <div className="space-y-1">
        <select
          value={bc.type}
          onChange={(e) => onTypeChange(e.target.value as BcField["type"])}
          className="w-full px-1.5 py-0.5 text-[11px] bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
        >
          {BC_KINDS.map((k) => (
            <option key={k} value={k}>
              {BC_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        {needsVal && field === "velocity" && (
          <div className="grid grid-cols-3 gap-1">
            {(["Ux", "Uy", "Uz"] as const).map((axis, i) => (
              <input
                key={axis}
                type="number"
                step="any"
                value={asVec(bc.value)[i]}
                onChange={(e) => onVecChange(i as 0 | 1 | 2, e.target.value)}
                title={`${axis} (m/s)`}
                aria-label={`${axis} (m/s)`}
                className="w-full px-1.5 py-0.5 text-[11px] bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
              />
            ))}
          </div>
        )}
        {needsVal && field === "pressure" && (
          <input
            type="number"
            step="any"
            value={asScalar(bc.value)}
            onChange={(e) => onScalarChange(e.target.value)}
            title="p (Pa or m^2/s^2 for kinematic pressure)"
            aria-label="Pressure value"
            className="w-full px-1.5 py-0.5 text-[11px] bg-bg-800 border border-bg-800 rounded text-bg-100 font-mono"
          />
        )}
      </div>
    </div>
  );
}

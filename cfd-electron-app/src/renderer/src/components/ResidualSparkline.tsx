/**
 * V1.3 — Live residual sparkline, now N-field aware.
 *
 * Renders a tiny SVG of the most-recent solver residuals on a log10-scaled
 * Y axis. Any field the solver emits (Ux, Uy, Uz, p, k, epsilon, omega, nut,
 * mut, alphat, …) is auto-discovered from the residual history and shown as
 * a toggle-able polyline.
 *
 * Design cribbed from V1.0 + V1.3 thinker-with-files-gemini passes:
 *   • Dynamic field discovery — fields are extracted from the most recent
 *     ResidualPoint in the history, so a turbulent simpleFoam run shows
 *     {Ux, Uy, Uz, p, k, epsilon} without code changes.
 *   • Log10 Y with a 1e-8 floor (residuals span 1e-7 .. 1e+1 within a run).
 *   • Per-field auto-fit — each line uses the [min, max] of ITS OWN current
 *     data so the worst point sits near the top without lines collapsing.
 *   • Color palette — well-known OpenFOAM fields get fixed hex codes; new /
 *     unknown fields get a deterministic color from a fallback pool by
 *     alphabetical index, so the same field always gets the same color.
 *   • Toggle chips — a row of small color-dot + 2-3 char name buttons above
 *     the SVG; the user's selection persists in localStorage and is
 *     re-applied across runs.
 *   • `vector-effect="non-scaling-stroke"` so 1.5px stays crisp at any width.
 *   • Suppressed entirely during pre-solver phases (residual history is
 *     meaningless before `solving`).
 */
import { useEffect, useMemo, useState } from "react";
import { useGeometryStore } from "../store";
import type { Phase, ResidualPoint } from "@shared/types";

const FLOOR = 1e-8;
const SVG_VIEW_W = 100;
const SVG_VIEW_H = 24;
/** Hide the chart during phases that don't yet have meaningful residuals. */
const HIDE_DURING: ReadonlySet<Phase> = new Set<Phase>([
  "idle",
  "preparing",
  "meshing",
  "snapping",
  "decomposing",
]);

/** localStorage key for the user's enabled-field selection. */
const LS_KEY = "cfd-studio.enabledResidualFields";

/**
 * Canonical color for well-known OpenFOAM residual fields. Colorblind-safe
 * (Okabe-Ito palette for the physics fields; sky/cyan/orange for the velocity
 * components). Unknown fields fall through to FALLBACK_COLORS.
 */
const KNOWN_FIELD_COLORS: Record<string, string> = {
  Ux: "#56b4e9", // sky blue
  Uy: "#009e73", // bluish green
  Uz: "#f0e442", // yellow
  U: "#56b4e9", // alias for Ux when solver collapses components
  p: "#e69f00", // orange
  k: "#cc79a7", // reddish purple
  epsilon: "#d55e00", // vermillion
  omega: "#0072b2", // blue
  nut: "#999999", // gray
  mut: "#a6761d", // brown
  alphat: "#1b9e77", // teal
  nuTilda: "#999999",
};
/** Fallback pool for fields not in KNOWN_FIELD_COLORS. Assigned in
 *  alphabetical order so the same field always gets the same color. */
const FALLBACK_COLORS: readonly string[] = [
  "#fb7185", // rose-400
  "#a78bfa", // violet-400
  "#34d399", // emerald-400
  "#fbbf24", // amber-400
  "#60a5fa", // blue-400
  "#f472b6", // pink-400
  "#22d3ee", // cyan-400
  "#facc15", // yellow-400
];

/** Fields we treat as "always on" until the user explicitly disables them. */
const DEFAULT_ON: ReadonlySet<string> = new Set(["Ux", "p"]);

/* -------------------------------------------------------------------------- */

export function ResidualSparkline() {
  const history = useGeometryStore((s) => s.residualHistory);
  const phase = useGeometryStore((s) => s.runPhase);

  // All field names observed in the history (in order of first appearance).
  const observed = useMemo(() => discoverFields(history), [history]);

  // Enabled-fields state, persisted to localStorage.
  const [enabled, setEnabled] = useState<Set<string>>(() => loadEnabled());
  // Persist on change.
  useEffect(() => {
    persistEnabled(enabled);
  }, [enabled]);

  // New fields appear in `observed` as the run progresses. If they're in
  // DEFAULT_ON, ensure they're enabled; if the user has previously persisted
  // their choice via localStorage, that's already in `enabled`; otherwise
  // leave them off and let the user opt in via the chips.
  useEffect(() => {
    if (observed.length === 0) return;
    setEnabled((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const f of observed) {
        if (!prev.has(f) && DEFAULT_ON.has(f)) {
          next.add(f);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [observed]);

  // Suppress entirely during pre-solver phases.
  if (HIDE_DURING.has(phase)) return null;

  if (history.length < 2) {
    return (
      <span className="italic text-bg-300/70 text-[11px] font-mono whitespace-nowrap">
        no residuals yet
      </span>
    );
  }

  const visible = observed.filter((f) => enabled.has(f));

  return (
    <div className="flex flex-col gap-0.5" aria-label="Live residual sparkline">
      <ChipRow
        fields={observed}
        enabled={enabled}
        onToggle={(f) => {
          setEnabled((prev) => {
            const next = new Set(prev);
            if (next.has(f)) next.delete(f);
            else next.add(f);
            return next;
          });
        }}
      />
      {visible.length === 0 ? (
        <div
          className="w-40 h-6 flex items-center justify-center text-[10px] italic text-bg-300/60 font-mono"
          aria-hidden
        >
          no fields selected
        </div>
      ) : (
        <Chart points={history} fields={visible} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ChipRow(props: {
  fields: string[];
  enabled: Set<string>;
  onToggle: (f: string) => void;
}) {
  const { fields, enabled, onToggle } = props;
  // Cap chips to keep the row from overflowing the 160px-wide container.
  const MAX_CHIPS = 6;
  const head = fields.slice(0, MAX_CHIPS);
  const overflow = fields.length - head.length;
  return (
    <div className="flex items-center gap-1 h-3.5 overflow-hidden">
      {head.map((f) => {
        const isOn = enabled.has(f);
        const color = colorFor(f);
        return (
          <button
            key={f}
            type="button"
            onClick={() => onToggle(f)}
            title={isOn ? `Hide ${f}` : `Show ${f}`}
            aria-pressed={isOn}
            className={
              "inline-flex items-center gap-1 px-1 rounded text-[10px] font-mono leading-none " +
              (isOn
                ? "text-bg-100 bg-bg-800"
                : "text-bg-300/60 bg-transparent hover:bg-bg-800/60 hover:text-bg-100")
            }
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: color, opacity: isOn ? 1 : 0.4 }}
              aria-hidden
            />
            {f}
          </button>
        );
      })}
      {overflow > 0 && (
        <span
          className="text-[10px] text-bg-300/70 font-mono"
          title={`${overflow} more field(s) not yet toggled`}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

function Chart({ points, fields }: { points: ResidualPoint[]; fields: string[] }) {
  const series = useMemo(() => buildSeries(points, fields), [points, fields]);
  return (
    <svg
      viewBox={`0 0 ${SVG_VIEW_W} ${SVG_VIEW_H}`}
      preserveAspectRatio="none"
      className="w-40 h-6"
      role="img"
      aria-label={`Live residual sparkline (${fields.join(", ")})`}
    >
      <line
        x1="0"
        y1={SVG_VIEW_H - 1}
        x2={SVG_VIEW_W}
        y2={SVG_VIEW_H - 1}
        stroke="currentColor"
        strokeOpacity={0.15}
      />
      {series.map(({ field, path }) => (
        <polyline
          key={field}
          points={path}
          fill="none"
          stroke={colorFor(field)}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */

function buildSeries(
  points: ResidualPoint[],
  fields: string[],
): Array<{ field: string; path: string }> {
  const n = points.length;
  if (n < 2 || fields.length === 0) return [];
  const xs = (i: number) => (i / (n - 1)) * SVG_VIEW_W;

  // First pass: collect clamped log10 magnitudes per visible field.
  const logs: Record<string, number[]> = {};
  for (const f of fields) logs[f] = [];
  for (const r of points) {
    for (const f of fields) {
      const raw = r.fields[f];
      const v =
        typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : FLOOR;
      logs[f].push(Math.log10(Math.max(FLOOR, v)));
    }
  }
  // Second pass: per-field auto-fit + path emit.
  const out: Array<{ field: string; path: string }> = [];
  for (const f of fields) {
    const arr = logs[f];
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of arr) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < 1e-9) continue;
    const ys = (v: number) => SVG_VIEW_H - 1 - ((v - lo) / (hi - lo)) * (SVG_VIEW_H - 2);
    let path = "";
    for (let i = 0; i < n; i++) {
      path += `${xs(i).toFixed(2)},${ys(arr[i]!).toFixed(2)} `;
    }
    out.push({ field: f, path: path.trim() });
  }
  return out;
}

function discoverFields(history: ResidualPoint[]): string[] {
  if (history.length === 0) return [];
  // Walk the most recent sample backwards — fields are usually fully populated
  // by mid-run, so a tail scan is robust against mid-run field addition.
  const seen: string[] = [];
  const set = new Set<string>();
  for (let i = history.length - 1; i >= 0; i--) {
    for (const k of Object.keys(history[i]!.fields)) {
      if (!set.has(k)) {
        set.add(k);
        seen.push(k);
      }
    }
  }
  // Sort by canonical order (Ux < Uy < Uz < p < k < epsilon < omega < …)
  // so the chip row is stable run-to-run. Unknown fields land alphabetically
  // after all known ones.
  return seen.sort(compareField);
}

const FIELD_ORDER: Record<string, number> = {
  Ux: 0,
  Uy: 1,
  Uz: 2,
  U: 0,
  p: 10,
  k: 20,
  epsilon: 21,
  omega: 22,
  nuTilda: 23,
  nut: 30,
  mut: 31,
  alphat: 40,
};
function compareField(a: string, b: string): number {
  const oa = FIELD_ORDER[a];
  const ob = FIELD_ORDER[b];
  if (oa !== undefined && ob !== undefined) return oa - ob;
  if (oa !== undefined) return -1;
  if (ob !== undefined) return 1;
  return a.localeCompare(b);
}

/** Canonical hex for a field. Known fields are looked up directly; unknown
 *  fields get a deterministic color from the fallback pool. */
function colorFor(field: string): string {
  const known = KNOWN_FIELD_COLORS[field];
  if (known) return known;
  // Hash the field name to a stable index in FALLBACK_COLORS.
  let h = 0;
  for (let i = 0; i < field.length; i++) {
    h = (h * 31 + field.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % FALLBACK_COLORS.length;
  return FALLBACK_COLORS[idx]!;
}

/* -------------------------------------------------------------------------- */

function loadEnabled(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Set(DEFAULT_ON);
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
      return new Set(parsed as string[]);
    }
  } catch {
    // localStorage may be unavailable in some sandboxed contexts.
  }
  return new Set(DEFAULT_ON);
}

function persistEnabled(set: Set<string>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // Swallow — non-essential persistence.
  }
}

/**
 * 3D viewer (react-three-fiber) for a PreparedGeometry.
 *
 * Renders ONE colored BufferGeometry: vertex colors are recomputed on every
 * selection change so selected face triangles become orange and the rest
 * stay neutral. Picking works because each triangle owns 3 vertices (no
 * shared vertex index), so per-triangle colors are unambiguous.
 *
 * - Picking on click → `toggleFace(faceIdx)` via the triangle→face table.
 * - Picking on hover (shift) → subtle highlight via a separate overlay
 *   Pre-allocated Float32Array — avoids per-frame allocations.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from "@react-three/drei";
import * as THREE from "three";
import { useGeometryStore } from "../store";

const NEUTRAL: [number, number, number] = [0.72, 0.76, 0.82];     // base gray
const SELECTED: [number, number, number] = [0.95, 0.55, 0.20];      // warm orange
const HOVERED: [number, number, number] = [0.30, 0.65, 0.95];       // cool blue

export function Viewer() {
  const prep = useGeometryStore((s) => s.prep);
  const selectedFaceIds = useGeometryStore((s) => s.selectedFaceIds);
  const toggleFace = useGeometryStore((s) => s.toggleFace);

  const [hoverFace, setHoverFace] = useState<number | null>(null);

  // Build BufferGeometry once per prepared geometry; colors are kept
  // separately so we don't re-allocate the heavy position/normal/index each
  // time the selection changes.
  const { geometry, colorArray, triCount, faceCount } = useMemo(() => {
    if (!prep) return { geometry: null as THREE.BufferGeometry | null, colorArray: new Float32Array(), triCount: 0, faceCount: 0 };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(prep.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(prep.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(prep.indices, 1));
    // Initial vertex colors = NEUTRAL; selection updates via the same buffer.
    const colors = new Float32Array(prep.positions.length).fill(0);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = NEUTRAL[0]; colors[i + 1] = NEUTRAL[1]; colors[i + 2] = NEUTRAL[2];
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return {
      geometry: geo,
      colorArray: colors,
      triCount: Math.floor(prep.indices.length / 3),
      faceCount: prep.faceGroups.length,
    };
  }, [prep]);

  // Update vertex colors whenever the selection (or hover) changes.
  useEffect(() => {
    if (!prep || !geometry) return;
    for (let t = 0; t < triCount; t++) {
      const fi = prep.triangleToFace[t]!;
      let c: readonly [number, number, number] = NEUTRAL;
      if (selectedFaceIds.has(fi)) c = SELECTED;
      else if (hoverFace === fi) c = HOVERED;
      const v0 = t * 3;
      colorArray[v0 * 3    ] = c[0];
      colorArray[v0 * 3 + 1] = c[1];
      colorArray[v0 * 3 + 2] = c[2];
      colorArray[(v0 + 1) * 3    ] = c[0];
      colorArray[(v0 + 1) * 3 + 1] = c[1];
      colorArray[(v0 + 1) * 3 + 2] = c[2];
      colorArray[(v0 + 2) * 3    ] = c[0];
      colorArray[(v0 + 2) * 3 + 1] = c[1];
      colorArray[(v0 + 2) * 3 + 2] = c[2];
    }
    (geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }, [selectedFaceIds, hoverFace, triCount, prep, colorArray, geometry]);

  // Cleanly dispose BufferGeometry when picker swaps out the geometry.
  useEffect(() => () => { geometry?.dispose(); }, [geometry]);

  if (!prep) return <EmptyState />;

  // Place the camera so the entire bounding box fits, with a slight offset.
  const bbox = prep.bbox;
  const cx = (bbox.min.x + bbox.max.x) / 2;
  const cy = (bbox.min.y + bbox.max.y) / 2;
  const cz = (bbox.min.z + bbox.max.z) / 2;
  const radius = Math.max(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y, bbox.max.z - bbox.min.z);
  const camPos: [number, number, number] = [cx + radius * 1.4, cy + radius * 1.0, cz + radius * 1.6];

  // Picking handler — e.faceIndex is triangle index because our geometry is non-indexed (each triangle owns 3 verts).
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!prep) return;
    e.stopPropagation();
    if (e.faceIndex == null) return;
    const fi = prep.triangleToFace[e.faceIndex];
    if (fi == null) return;
    if (e.shiftKey) toggleFace(fi);
    else if (e.altKey) {
      // Range pick: contiguous band on the same face — useful for selecting one face's triangles.
      // (No-op here, kept as a future enhancement.)
    } else {
      toggleFace(fi);
    }
  };

  return (
    <Canvas
      shadows
      camera={{ position: camPos, fov: 38, near: 0.001, far: radius * 20 }}
      dpr={[1, 2]}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={["#0a0c0f"]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[radius * 2, radius * 2, radius * 2]} intensity={0.9} castShadow />
      <directionalLight position={[-radius * 2, radius * 2, -radius * 2]} intensity={0.3} />

      {geometry && (
        <mesh
          geometry={geometry}
          onClick={handleClick}
          onPointerMove={(e) => {
            if (!prep || e.faceIndex == null) return;
            const fi = prep.triangleToFace[e.faceIndex];
            setHoverFace(fi ?? null);
            document.body.style.cursor = fi != null ? "pointer" : "default";
          }}
          onPointerOut={() => setHoverFace(null)}
        >
          <meshStandardMaterial
            vertexColors
            metalness={0.15}
            roughness={0.55}
            flatShading={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      <Grid
        position={[0, bbox.min.y - 0.001, 0]}
        args={[radius * 4, radius * 4]}
        cellSize={radius / 20}
        cellThickness={0.5}
        sectionSize={radius / 4}
        sectionThickness={1}
        sectionColor="#3aa7ff"
        cellColor="#3d4658"
        fadeDistance={radius * 6}
        fadeStrength={1}
        followCamera={false}
        infiniteGrid
      />
      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        target={[cx, cy, cz]}
        makeDefault
      />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={["#ef4444", "#22c55e", "#3aa7ff"]} labelColor="#0f1115" />
      </GizmoHelper>
    </Canvas>
  );
}

function EmptyState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
      <svg viewBox="0 0 24 24" className="w-16 h-16 text-bg-300 mb-4 opacity-60" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 7l9-4 9 4-9 4-9-4z" />
        <path d="M3 7v10l9 4 9-4V7" />
        <path d="M12 11v10" />
      </svg>
      <h2 className="text-xl font-semibold text-bg-100">No geometry loaded</h2>
      <p className="text-sm text-bg-300 mt-2 max-w-md text-center">
        Open a STEP, IGES, or STL file from the toolbar to begin preparing it for OpenFOAM.
      </p>
      <p className="text-xs text-bg-300 mt-4 opacity-75">
        Click faces in the viewer to select them, then group into named patches for snappyHexMesh.
      </p>
    </div>
  );
}

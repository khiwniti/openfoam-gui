/**
 * Geometry preparation layer.
 *
 * Wraps a few `wasm.*` calls into ergonomic functions for the rest of the
 * renderer. Holds NO reference to React or zustand — pure data in/out.
 *
 * Important lifetime note: shapes returned by `convertFromStep` etc. live in
 * the WASM heap. Always pass them to subsequent `wasm.*` calls before going
 * idle; if we ever want to free them we'd add a `disposeShape()` here against
 * `wasm.Shape.clean(shape)` plus `TopoDS_Shape.delete()`. (Not needed yet —
 * V0.5 keeps one shape loaded at a time.)
 */
import { initWasm, type MainModule } from "./wasm-bridge";
import type { BoundingBoxMinMax, FaceGroup, LoadedGeometry } from "@shared/types";

export interface PreparedGeometry {
  /** Original file path. */
  path: string;
  /** Format label that produced this. */
  format: "STEP" | "STL" | "IGES";
  /** OCCT TopoDS_Shape handle (pointers stay valid while m is in scope). */
  shape: unknown;
  /** OCCT Face handles in face-index order. */
  faces: Array<unknown>;
  /** Per-face metadata derived from the mesher's group buffer. */
  faceGroups: FaceGroup[];
  /** Flat XYZ positions for the entire surface mesh (Float32Array). */
  positions: Float32Array;
  /** Flat XYZ normals (Float32Array). */
  normals: Float32Array;
  /** Flat UVs (Float32Array), often unused for shaded viewer. */
  uvs: Float32Array;
  /** Triangle indices (Uint32Array). Group N owns triangles
   *  [group[2*N] .. group[2*N] + group[2*N+1]). */
  indices: Uint32Array;
  /** Triangle-index → face-index map (length = triangleCount). */
  triangleToFace: Uint32Array;
  /** Axis-aligned bounding box (parent shape). */
  bbox: BoundingBoxMinMax;
}

function getTopoShape(node: { shape: unknown } | undefined): unknown {
  if (!node) throw new Error("OCCT returned no shape (file may be unsupported or malformed).");
  if (!node.shape) throw new Error("OCCT shape node has no `shape` handle.");
  return node.shape;
}

/** TopoDS_Face handle from the parent shape (by face-index). */
export function getFaceHandle(prep: PreparedGeometry, faceIndex: number): unknown {
  const f = prep.faces[faceIndex];
  if (!f) throw new Error(`Face index ${faceIndex} out of range (faceCount=${prep.faces.length})`);
  return f;
}

/**
 * Load a STEP file into OCCT and tessellate it for the viewer.
 * Caller is responsible for disposing of the previous shape if any.
 */
export async function loadStepGeometry(bytes: Uint8Array, path: string): Promise<PreparedGeometry> {
  return loadFormat(bytes, path, "STEP");
}

export async function loadIgesGeometry(bytes: Uint8Array, path: string): Promise<PreparedGeometry> {
  return loadFormat(bytes, path, "IGES");
}

export async function loadStlGeometry(bytes: Uint8Array, path: string): Promise<PreparedGeometry> {
  return loadFormat(bytes, path, "STL");
}

async function loadFormat(bytes: Uint8Array, path: string, format: "STEP" | "STL" | "IGES"): Promise<PreparedGeometry> {
  const m: MainModule = await initWasm();
  const node =
    format === "STEP"
      ? m.Converter.convertFromStep(bytes)
      : format === "IGES"
      ? m.Converter.convertFromIges(bytes)
      : m.Converter.convertFromStl(bytes);
  const shape = getTopoShape(node);
  return meshShape(m, shape, { path, format });
}

/**
 * Tessellate a shape that is already in the WASM heap. Public for future
 * boolean / transform operations where we want to re-mesh a derived shape
 * without going through the file I/O path.
 */
export function meshShape(m: MainModule, shape: unknown, meta: { path: string; format: PreparedGeometry["format"] }): PreparedGeometry {
  const faces = m.Shape.findSubShapes(shape, m.TopAbs_ShapeEnum.TopAbs_FACE.value) as Array<unknown>;
  const bbox = m.Shape.boundingBox(shape, /*useMesh*/ true);
  const mesher = new m.Mesher(shape, /*lineDeflection*/ 0.005, /*useBoxRatio*/ true);
  const meshData = mesher.mesh();
  mesher.delete();

  const faceMesh = meshData.faceMeshData;
  const positions = new Float32Array(faceMesh.position);
  const normals = new Float32Array(faceMesh.normal);
  const uvs = new Float32Array(faceMesh.uv);
  const indices = new Uint32Array(faceMesh.index);
  const group = faceMesh.group; // [start0, count0, start1, count1, ...]

  // Build triangle → face table for picking.
  const triCount = Math.floor(indices.length / 3);
  const triangleToFace = new Uint32Array(triCount);
  const faceGroups: FaceGroup[] = [];
  for (let f = 0; f < group.length / 2; f++) {
    const start = group[f * 2] | 0;
    const count = group[f * 2 + 1] | 0;
    faceGroups.push({ faceIndex: f, start, count, area: null });
    for (let t = start; t < start + count; t++) triangleToFace[t] = f;
  }

  return {
    path: meta.path,
    format: meta.format,
    shape,
    faces,
    faceGroups,
    positions,
    normals,
    uvs,
    indices,
    triangleToFace,
    bbox: {
      min: { x: bbox.min.x, y: bbox.min.y, z: bbox.min.z },
      max: { x: bbox.max.x, y: bbox.max.y, z: bbox.max.z },
    },
  };
}

/** Concise metadata for the status bar / panel. Computed from the prepared data already in memory. */
export function toLoadedGeometry(prep: PreparedGeometry): LoadedGeometry {
  return {
    path: prep.path,
    format: prep.format,
    triangleCount: Math.floor(prep.indices.length / 3),
    faceCount: prep.faces.length,
    bbox: prep.bbox,
  };
}

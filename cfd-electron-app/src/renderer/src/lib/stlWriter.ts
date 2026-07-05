/**
 * STL writer for a subset of triangles of a PreparedGeometry.
 *
 * Pure data, headless, unit-testable: takes a PreparedGeometry plus a chosen
 * set of face indices and emits either binary or ASCII STL bytes. No
 * three.js or WASM dependence, no DOM.
 *
 * Format reference:
 *   - Binary: 80-byte header, uint32 little-endian triangle count, then
 *     50 bytes per triangle (12 floats normal+vertex+vertex+vertex + uint16 attr).
 *   - ASCII: standard "solid name / facet normal / outer loop / vertex / endloop / endfacet / endsolid".
 */

export interface StlExportOptions {
  binary?: boolean;
  name?: string;
}

/**
 * Iterate the indices of the triangles (in the index buffer) that belong to
 * the selected faces. Each yielded value is the index-buffer position of the
 * triangle's first vertex (i.e. `triangleStart / 3 === triangleIndex`).
 */
function* triangleIndicesForFaces(
  group: ReadonlyArray<number>,
  selectedFaces: ReadonlySet<number>,
): Generator<number> {
  for (let fi = 0; fi < group.length / 2; fi++) {
    if (!selectedFaces.has(fi)) continue;
    const start = group[fi * 2] | 0;
    const count = group[fi * 2 + 1] | 0;
    for (let t = start; t < start + count; t++) yield t;
  }
}

/**
 * Build a flat list of triangles ready for STL serialization.
 * Each entry stores its three vertex positions and the normal to write
 * (standard STL convention: one normal per triangle, taken from vertex 0).
 */
function collectTriangles(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
  group: ReadonlyArray<number>,
  selectedFaces: ReadonlySet<number>,
): Array<{
  px0: number; py0: number; pz0: number;
  px1: number; py1: number; pz1: number;
  px2: number; py2: number; pz2: number;
  nx: number; ny: number; nz: number;
}> {
  const out: ReturnType<typeof collectTriangles> = [];
  for (const t of triangleIndicesForFaces(group, selectedFaces)) {
    const i0 = indices[t * 3] | 0;
    const i1 = indices[t * 3 + 1] | 0;
    const i2 = indices[t * 3 + 2] | 0;
    const n0 = i0 * 3;
    out.push({
      px0: positions[i0 * 3]!,     py0: positions[i0 * 3 + 1]!, pz0: positions[i0 * 3 + 2]!,
      px1: positions[i1 * 3]!,     py1: positions[i1 * 3 + 1]!, pz1: positions[i1 * 3 + 2]!,
      px2: positions[i2 * 3]!,     py2: positions[i2 * 3 + 1]!, pz2: positions[i2 * 3 + 2]!,
      nx:  normals[n0] ?? 0,        ny:  normals[n0 + 1] ?? 0,    nz:  normals[n0 + 2] ?? 0,
    });
  }
  return out;
}

/**
 * Write binary STL bytes for the selected faces (default, smaller than ASCII).
 * Always emits a valid header even when no triangles are selected.
 */
export function writeBinaryStl(input: {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  group: ReadonlyArray<number>;
  selectedFaces: ReadonlySet<number>;
  /** Optional header text (truncated to 80 bytes). */
  header?: string;
}): { bytes: Uint8Array; triangleCount: number } {
  const tris = collectTriangles(input.positions, input.normals, input.indices, input.group, input.selectedFaces);
  const HEADER_SIZE = 80;
  const COUNT_SIZE = 4;
  const TRIANGLE_SIZE = 50;
  const buf = new ArrayBuffer(HEADER_SIZE + COUNT_SIZE + Math.max(0, tris.length) * TRIANGLE_SIZE);
  const view = new DataView(buf);
  const header = input.header ?? "cfd-studio binary stl";
  for (let i = 0; i < Math.min(header.length, HEADER_SIZE); i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(HEADER_SIZE, tris.length, true);

  let offset = HEADER_SIZE + COUNT_SIZE;
  for (const t of tris) {
    view.setFloat32(offset,      t.nx, true);
    view.setFloat32(offset + 4,  t.ny, true);
    view.setFloat32(offset + 8,  t.nz, true);
    view.setFloat32(offset + 12, t.px0, true);
    view.setFloat32(offset + 16, t.py0, true);
    view.setFloat32(offset + 20, t.pz0, true);
    view.setFloat32(offset + 24, t.px1, true);
    view.setFloat32(offset + 28, t.py1, true);
    view.setFloat32(offset + 32, t.pz1, true);
    view.setFloat32(offset + 36, t.px2, true);
    view.setFloat32(offset + 40, t.py2, true);
    view.setFloat32(offset + 44, t.pz2, true);
    view.setUint16(offset + 48, 0, true); // attribute byte count
    offset += TRIANGLE_SIZE;
  }
  return { bytes: new Uint8Array(buf), triangleCount: tris.length };
}

/** Write ASCII STL (debug-friendly). */
export function writeAsciiStl(input: {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  group: ReadonlyArray<number>;
  selectedFaces: ReadonlySet<number>;
  name?: string;
}): { bytes: Uint8Array; triangleCount: number } {
  const tris = collectTriangles(input.positions, input.normals, input.indices, input.group, input.selectedFaces);
  const name = input.name ?? "cfd-studio";
  const fmt = (n: number): string => (Object.is(n, -0) ? "0" : String(n));
  const lines: string[] = [`solid ${name}`];
  for (const t of tris) {
    lines.push(`  facet normal ${fmt(t.nx)} ${fmt(t.ny)} ${fmt(t.nz)}`);
    lines.push("    outer loop");
    lines.push(`      vertex ${fmt(t.px0)} ${fmt(t.py0)} ${fmt(t.pz0)}`);
    lines.push(`      vertex ${fmt(t.px1)} ${fmt(t.py1)} ${fmt(t.pz1)}`);
    lines.push(`      vertex ${fmt(t.px2)} ${fmt(t.py2)} ${fmt(t.pz2)}`);
    lines.push("    endloop");
    lines.push("  endfacet");
  }
  lines.push(`endsolid ${name}`);
  return { bytes: new TextEncoder().encode(`${lines.join("\n")}\n`), triangleCount: tris.length };
}

/** Convenience dispatcher. */
export function exportFacesAsStl(
  input: Parameters<typeof writeBinaryStl>[0] & { format?: "binary" | "ascii"; stlName?: string },
): Uint8Array {
  if (input.format === "ascii") {
    return writeAsciiStl({ ...input, name: input.stlName }).bytes;
  }
  return writeBinaryStl({ ...input, header: input.stlName ?? "cfd-studio binary stl" }).bytes;
}

/**
 * Sum triangles across the chosen face-indices. Used to populate the patch
 * preview in the panel and to detect empty selections before export.
 */
export function countTriangles(group: ReadonlyArray<number>, selectedFaces: ReadonlySet<number>): number {
  let total = 0;
  for (let fi = 0; fi < group.length / 2; fi++) {
    if (!selectedFaces.has(fi)) continue;
    total = group[fi * 2 + 1] | 0 + total;
  }
  return total;
}

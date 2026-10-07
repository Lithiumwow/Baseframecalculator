/**
 * Extract a triangle mesh from DXF 3DFACE entities (Systemair / Geniox casing exports).
 * Coordinates remain in DXF units (typically mm), Z-up.
 */

export interface DxfMeshBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

export interface DxfCasingMesh {
  /** Flat xyz triples in mm (Z-up), 9 floats per triangle */
  positions: Float32Array
  triangleCount: number
  bounds: DxfMeshBounds
  sourceName?: string
  /**
   * DXF X (mm) that maps to analysis frame X = 0.
   * Usually the first casing module minX (same origin as section import).
   */
  frameOriginXMm?: number
  /** DXF Y (mm) centerline that maps to frame width / 2 */
  frameCenterYMm?: number
}

function flushFace(
  pts: Array<[number, number, number]>,
  out: number[]
): void {
  if (pts.length < 3) return
  const tri =
    pts.length >= 4 &&
    !(pts[2][0] === pts[3][0] && pts[2][1] === pts[3][1] && pts[2][2] === pts[3][2])
      ? [
          [pts[0], pts[1], pts[2]],
          [pts[0], pts[2], pts[3]],
        ]
      : [[pts[0], pts[1], pts[2]]]
  for (const t of tri) {
    for (const p of t) out.push(p[0], p[1], p[2])
  }
}

/** Parse 3DFACE mesh from DXF text. Returns null if no faces found. */
export function extractDxfMesh(dxfText: string, sourceName?: string): DxfCasingMesh | null {
  const lines = dxfText.split(/\r?\n/)
  const positions: number[] = []
  let cur: { type: string; coords: Record<string, number>; pts: Array<[number, number, number]> } | null =
    null

  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = lines[i].trim()
    const val = lines[i + 1]
    if (code === "0") {
      if (cur?.type === "3DFACE") flushFace(cur.pts.slice(0, 4), positions)
      cur = { type: val.trim(), coords: {}, pts: [] }
      continue
    }
    if (!cur || cur.type !== "3DFACE") continue
    if (["10", "11", "12", "13"].includes(code)) cur.coords["x" + code[1]] = parseFloat(val)
    if (["20", "21", "22", "23"].includes(code)) cur.coords["y" + code[1]] = parseFloat(val)
    if (["30", "31", "32", "33"].includes(code)) {
      const idx = code[1]
      const x = cur.coords["x" + idx]
      const y = cur.coords["y" + idx]
      const z = parseFloat(val)
      if ([x, y, z].every(Number.isFinite)) cur.pts.push([x, y, z])
    }
  }
  if (cur?.type === "3DFACE") flushFace(cur.pts.slice(0, 4), positions)

  if (positions.length < 9) return null

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]
    const y = positions[i + 1]
    const z = positions[i + 2]
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }

  return {
    positions: new Float32Array(positions),
    triangleCount: positions.length / 9,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
    sourceName,
  }
}

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dxfPath = path.resolve(__dirname, "../../_1 Geniox 10.dxf")
const outPath = path.resolve(__dirname, "mesh.json")

const lines = fs.readFileSync(dxfPath, "utf8").split(/\r?\n/)
const positions = []
let cur = null

for (let i = 0; i < lines.length - 1; i += 2) {
  const code = lines[i].trim()
  const val = lines[i + 1]
  if (code === "0") {
    if (cur?.type === "3DFACE" && cur.pts.length >= 3) {
      const pts = cur.pts.slice(0, 4)
      // triangulate quad if needed
      const tris =
        pts.length >= 4 &&
        !(pts[2][0] === pts[3][0] && pts[2][1] === pts[3][1] && pts[2][2] === pts[3][2])
          ? [
              [pts[0], pts[1], pts[2]],
              [pts[0], pts[2], pts[3]],
            ]
          : [[pts[0], pts[1], pts[2]]]
      for (const t of tris) {
        for (const p of t) positions.push(p[0], p[1], p[2])
      }
    }
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
if (cur?.type === "3DFACE" && cur.pts.length >= 3) {
  const pts = cur.pts.slice(0, 4)
  const tris =
    pts.length >= 4 &&
    !(pts[2][0] === pts[3][0] && pts[2][1] === pts[3][1] && pts[2][2] === pts[3][2])
      ? [
          [pts[0], pts[1], pts[2]],
          [pts[0], pts[2], pts[3]],
        ]
      : [[pts[0], pts[1], pts[2]]]
  for (const t of tris) {
    for (const p of t) positions.push(p[0], p[1], p[2])
  }
}

let minX = Infinity,
  maxX = -Infinity,
  minY = Infinity,
  maxY = -Infinity,
  minZ = Infinity,
  maxZ = -Infinity
for (let i = 0; i < positions.length; i += 3) {
  minX = Math.min(minX, positions[i])
  maxX = Math.max(maxX, positions[i])
  minY = Math.min(minY, positions[i + 1])
  maxY = Math.max(maxY, positions[i + 1])
  minZ = Math.min(minZ, positions[i + 2])
  maxZ = Math.max(maxZ, positions[i + 2])
}

const mesh = {
  source: "_1 Geniox 10.dxf",
  units: "mm",
  triangleCount: positions.length / 9,
  bounds: { minX, maxX, minY, maxY, minZ, maxZ },
  positions,
}

fs.writeFileSync(outPath, JSON.stringify(mesh))
console.log("Wrote", outPath, "triangles=", mesh.triangleCount, "bytes=", fs.statSync(outPath).size)

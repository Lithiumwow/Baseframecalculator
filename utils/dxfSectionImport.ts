/**
 * Import casing-level sections from Systemair / Geniox 3D DXF exports.
 *
 * These files are mesh exports (3DFACE + POLYLINE), not layout drawings.
 * Section bays are inferred from large vertical module rectangles (side panels).
 * Weights are not present — sections are created empty for later weight import.
 */

import { getGenioxFrameWidth, parseGenioxTypeFromText, type GenioxType } from "./genioxDimensions"
import type { WeightImportData, WeightImportSection } from "./weightImport"

export interface DxfModuleBox {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
  lengthMm: number
  layer: string
}

export interface DxfSectionImportResult {
  frameLengthMm: number
  frameWidthMm: number
  genioxType: GenioxType | null
  description: string | null
  modules: DxfModuleBox[]
  sections: WeightImportSection[]
  importData: WeightImportData
  warnings: string[]
  /** Overall mesh bounding box size (mm) */
  meshSizeMm: { x: number; y: number; z: number }
  /** DXF X (mm) that maps to analysis frame X = 0. Left end of the mesh. */
  frameOriginXMm: number
}

interface PolyVertex {
  x: number
  y: number
  z: number
}

function roundMm(v: number): number {
  return Math.round(v * 10) / 10
}

function unitsToMm(value: number, insUnits: number): number {
  // AutoCAD $INSUNITS: 1=inches, 4=mm, 6=meters
  if (insUnits === 1) return value * 25.4
  if (insUnits === 6) return value * 1000
  return value
}

/**
 * Parse a Systemair-style Geniox DXF and extract casing module sections.
 */
export function parseDxfSections(dxfText: string): DxfSectionImportResult {
  const lines = dxfText.split(/\r?\n/)
  const warnings: string[] = []

  let insUnits = 4
  const metaStrings: string[] = []
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity

  const moduleCandidates: DxfModuleBox[] = []

  let sectionName = ""
  let inPoly = false
  let polyLayer = ""
  let verts: PolyVertex[] = []
  let expectingHeaderVar: string | null = null

  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = lines[i].trim()
    const val = lines[i + 1]

    if (code === "0" && val.trim() === "SECTION") {
      sectionName = ""
      continue
    }
    if (code === "2" && sectionName === "") {
      sectionName = val.trim()
      continue
    }
    if (code === "0" && val.trim() === "ENDSEC") {
      sectionName = ""
      continue
    }

    if (code === "9" && val.trim().startsWith("$")) {
      expectingHeaderVar = val.trim()
      continue
    }
    if (expectingHeaderVar === "$INSUNITS" && code === "70") {
      insUnits = parseInt(val.trim(), 10) || 4
      expectingHeaderVar = null
      continue
    }
    if (expectingHeaderVar && (code === "70" || code === "40" || code === "10")) {
      expectingHeaderVar = null
    }

    if (code === "1000") {
      metaStrings.push(val.trim())
    }

    // Track extents from coordinate codes
    if (["10", "11", "12", "13"].includes(code)) {
      const n = parseFloat(val)
      if (Number.isFinite(n)) {
        minX = Math.min(minX, n)
        maxX = Math.max(maxX, n)
      }
    }
    if (["20", "21", "22", "23"].includes(code)) {
      const n = parseFloat(val)
      if (Number.isFinite(n)) {
        minY = Math.min(minY, n)
        maxY = Math.max(maxY, n)
      }
    }
    if (["30", "31", "32", "33"].includes(code)) {
      const n = parseFloat(val)
      if (Number.isFinite(n)) {
        minZ = Math.min(minZ, n)
        maxZ = Math.max(maxZ, n)
      }
    }

    if (code === "0") {
      const type = val.trim()
      if (type === "POLYLINE") {
        inPoly = true
        polyLayer = ""
        verts = []
      } else if (type === "VERTEX" && inPoly) {
        verts.push({ x: NaN, y: NaN, z: 0 })
      } else if (type === "SEQEND" && inPoly) {
        const box = boxFromVertices(verts, polyLayer)
        if (box && isCasingModuleBox(box)) {
          moduleCandidates.push(box)
        }
        inPoly = false
      }
      continue
    }

    if (!inPoly) continue
    if (code === "8" && !polyLayer) polyLayer = val.trim()
    if (verts.length === 0) continue
    const last = verts[verts.length - 1]
    if (code === "10") last.x = parseFloat(val)
    if (code === "20") last.y = parseFloat(val)
    if (code === "30") last.z = parseFloat(val)
  }

  if (!Number.isFinite(minX)) {
    throw new Error("DXF contains no geometric coordinates")
  }

  const toMm = (v: number) => unitsToMm(v, insUnits)

  const modulesMm = selectCasingModules(
    moduleCandidates.map((m) => ({
      ...m,
      minX: toMm(m.minX),
      maxX: toMm(m.maxX),
      minY: toMm(m.minY),
      maxY: toMm(m.maxY),
      minZ: toMm(m.minZ),
      maxZ: toMm(m.maxZ),
      lengthMm: toMm(m.lengthMm),
    }))
  )

  const descMeta = metaStrings.find((s) => s.startsWith("U.DESC="))
  const description = descMeta ? descMeta.slice("U.DESC=".length).trim() || null : null
  const genioxType =
    parseGenioxTypeFromText(description || "") ||
    parseGenioxTypeFromText(metaStrings.join(" "))

  const meshSizeMm = {
    x: roundMm(toMm(maxX - minX)),
    y: roundMm(toMm(maxY - minY)),
    z: roundMm(toMm(maxZ - minZ)),
  }

  if (modulesMm.length === 0) {
    throw new Error(
      "No casing module sections found. This importer expects a Systemair/Geniox 3D DXF with vertical module rectangles."
    )
  }

  const meshMinX = toMm(minX)
  const meshMaxX = toMm(maxX)
  const sections = sectionsAlongMesh(modulesMm, meshMinX, meshMaxX)
  const frameLengthMm = roundMm(sections[sections.length - 1].endPosition || 0)
  const frameOriginXMm = roundMm(meshMinX)
  let frameWidthMm = genioxType ? getGenioxFrameWidth(genioxType) : roundMm(meshSizeMm.y)

  if (!genioxType) {
    warnings.push("Could not read Geniox type from DXF metadata; frame width uses mesh Y extent.")
  }
  warnings.push(
    "DXF sections follow the casing blocks along the unit. Upload the submittal PDF to fill weights (inches or millimetres)."
  )

  const importData: WeightImportData = {
    frameDimensions: {
      length: frameLengthMm,
      width: frameWidthMm,
      units: "mm",
    },
    sections,
  }

  return {
    frameLengthMm,
    frameWidthMm,
    genioxType,
    description,
    modules: modulesMm,
    sections,
    importData,
    warnings,
    meshSizeMm,
    frameOriginXMm,
  }
}

/**
 * Place sections on the full mesh.
 * A short bay between two longer full-height bays stays inside the middle section
 * when a separate end block continues past the last tall side panel (the stepped
 * module on Geniox layouts). Otherwise each tall side panel is its own section.
 */
function sectionsAlongMesh(
  modules: DxfModuleBox[],
  meshMinX: number,
  meshMaxX: number
): WeightImportSection[] {
  const last = modules[modules.length - 1]
  const overhang = meshMaxX - last.maxX
  const hasTrailingBlock = overhang > 120
  const empty = (start: number, end: number, index: number): WeightImportSection => {
    const s = roundMm(start)
    const e = roundMm(end)
    return {
      name: `Section ${index + 1}`,
      startPosition: s,
      endPosition: e,
      length: roundMm(e - s),
      casingWeight: 0,
      casingWeightUnit: "kg",
      baseframeWeight: 0,
      baseframeWeightUnit: "kg",
      roofWeight: 0,
      roofWeightUnit: "kg",
    }
  }

  const cuts: number[] = [meshMinX]
  if (modules.length >= 3 && hasTrailingBlock) {
    cuts.push((modules[0].maxX + modules[1].minX) / 2)
    cuts.push(last.maxX + Math.min(50, overhang * 0.08))
  } else {
    for (let i = 0; i < modules.length - 1; i++) {
      cuts.push((modules[i].maxX + modules[i + 1].minX) / 2)
    }
    if (hasTrailingBlock) cuts.push(last.maxX + Math.min(50, overhang * 0.08))
  }
  cuts.push(meshMaxX)

  const origin = cuts[0]
  return cuts.slice(0, -1).map((start, i) => empty(start - origin, cuts[i + 1] - origin, i))
}

function boxFromVertices(verts: PolyVertex[], layer: string): DxfModuleBox | null {
  const valid = verts.filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y))
  if (valid.length < 4) return null

  const xs = valid.map((v) => v.x)
  const ys = valid.map((v) => v.y)
  const zs = valid.map((v) => (Number.isFinite(v.z) ? v.z : 0))
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  const lengthMm = maxX - minX

  return { minX, maxX, minY, maxY, minZ, maxZ, lengthMm, layer }
}

/** Vertical side-panel rectangles that mark casing modules along unit length. */
function isCasingModuleBox(box: DxfModuleBox): boolean {
  const dx = box.maxX - box.minX
  const dy = Math.abs(box.maxY - box.minY)
  const dz = Math.abs(box.maxZ - box.minZ)

  // Module length along X, thin in Y (vertical XZ plane), tall in Z
  if (dx < 200) return false
  if (dy > 5) return false
  if (dz < 200) return false
  return true
}

function dedupeModules(modules: DxfModuleBox[]): DxfModuleBox[] {
  const out: DxfModuleBox[] = []
  for (const m of modules) {
    const dup = out.find(
      (o) =>
        Math.abs(o.minX - m.minX) < 1 &&
        Math.abs(o.maxX - m.maxX) < 1 &&
        Math.abs(o.minZ - m.minZ) < 1
    )
    if (!dup) out.push(m)
  }
  return out
}

/**
 * Keep primary casing side-panels; drop nested duct/detail boxes (often SYSTEMAIR3).
 */
function selectCasingModules(modules: DxfModuleBox[]): DxfModuleBox[] {
  const unique = dedupeModules(modules)
  if (unique.length === 0) return []

  const maxDz = Math.max(...unique.map((m) => Math.abs(m.maxZ - m.minZ)))
  const tallEnough = unique.filter((m) => Math.abs(m.maxZ - m.minZ) >= maxDz * 0.6)

  // Prefer the layer with the most tall modules (typically SYSTEMAIR1)
  const layerCounts = new Map<string, number>()
  for (const m of tallEnough) {
    layerCounts.set(m.layer, (layerCounts.get(m.layer) || 0) + 1)
  }
  let preferredLayer = tallEnough[0]?.layer || ""
  let bestCount = 0
  for (const [layer, count] of layerCounts) {
    if (count > bestCount) {
      bestCount = count
      preferredLayer = layer
    }
  }

  const onPreferred = tallEnough.filter((m) => m.layer === preferredLayer)
  const pool = onPreferred.length > 0 ? onPreferred : tallEnough

  // Drop modules nested inside a longer neighbor along X
  const sorted = [...pool].sort((a, b) => a.minX - b.minX || b.lengthMm - a.lengthMm)
  const kept: DxfModuleBox[] = []
  for (const m of sorted) {
    const nested = kept.some(
      (k) => m.minX >= k.minX - 1 && m.maxX <= k.maxX + 1 && m.lengthMm < k.lengthMm - 1
    )
    if (!nested) kept.push(m)
  }

  return kept.sort((a, b) => a.minX - b.minX)
}

/** Read a DXF File (browser) as text. */
export async function readDxfFile(file: File): Promise<string> {
  return file.text()
}

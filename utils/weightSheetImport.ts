/**
 * Build complete WeightImportData JSON from weight table + layout sheet OCR.
 */

import type { WeightImportData, WeightImportSection, WeightImportComponent } from "./weightImport"
import { getGenioxFrameWidth } from "./genioxDimensions"
import type { ParsedLayout } from "./layoutOcr"
import { INCH_TO_MM, inchesToMm } from "./layoutOcr"
import { parseLengthFromText } from "./lengthUnits"
import {
  parseWeightTableFromRawText,
  isEmptyWeightTable,
  mergeWeightTableWithLayout,
  type ParsedWeightTable,
  inferCasingLengthsIn,
  ensureComponentsFromRawText,
} from "./weightTableParser"
import { processWeightTableImage } from "./ocr"
import { processLayoutImage } from "./layoutOcr"
import { calculateCOG, buildCOGItemsFromImport, type COGResult } from "./cogCalculation"
import type { Section, Load } from "../types"
import { convertImportedSections, convertImportedComponents } from "./weightImport"
import {
  splitSegmentsByCasingSections,
  matchComponentsToSegments,
  inferKindFromWeightName,
  layoutTypeLabel,
} from "./layoutSymbols"

export interface ParsedWeightRow {
  sectionNo: number
  sectionCode: string
  functionCode: string
  functionWeight: number
  sectionWeight: number
}

export type { ParsedWeightTable }

export interface SheetImportResult {
  importData: WeightImportData
  json: string
  cog: COGResult
  frameLength: number
  frameWidth: number
  totalRoofWeight: number
  totalRoofWeightUnit: "lbs" | "kg"
  sections: Section[]
  loads: Load[]
}

const SKIP_COMPONENTS = new Set<string>() // all components become distributed loads

/**
 * Parse structured rows from weight table OCR CSV text.
 */
export function parseWeightTableStructured(tableCsv: string): ParsedWeightTable {
  const lines = tableCsv.split("\n").filter((l) => l.trim())
  const rows: ParsedWeightRow[] = []
  let currentSectionNo = 0
  let weightUnit: "lbs" | "kg" = "lbs"

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (i === 0 && line.toLowerCase().includes("lb")) weightUnit = "lbs"
    if (i === 0 && line.toLowerCase().includes("kg") && !line.toLowerCase().includes("lb")) {
      weightUnit = "kg"
    }
    if (line.toLowerCase().includes("section no")) continue

    const parts = line.split(",").map((p) => p.trim())
    if (parts.length < 2) continue

    const sectionNoVal = parseInt(parts[0] || "0", 10)
    if (sectionNoVal > 0) currentSectionNo = sectionNoVal

    rows.push({
      sectionNo: currentSectionNo,
      sectionCode: parts[1] || "",
      functionCode: parts[2] || "",
      functionWeight: parseFloat((parts[3] || "0").replace(/[^\d.]/g, "")) || 0,
      sectionWeight: parseFloat((parts[4] || "0").replace(/[^\d.]/g, "")) || 0,
    })
  }

  const casingSections: ParsedWeightTable["casingSections"] = []
  let baseframeLengthIn = 0
  let baseframeWeightLb = 0
  let otherComponentsLb = 0
  let unitTotalLb = 0

  let currentCasing: ParsedWeightTable["casingSections"][0] | null = null

  for (const row of rows) {
    const code = row.sectionCode.toLowerCase()
    const func = row.functionCode.toLowerCase()

    if (code.includes("casing length")) {
      const lengthMatch = row.sectionCode.match(/(\d+(?:\.\d+)?)\s*(?:in|mm)/i)
      let lengthIn = 0
      if (lengthMatch) {
        const parsed = parseLengthFromText(lengthMatch[0])
        lengthIn = parsed?.inches ?? 0
      } else {
        const parsed = parseLengthFromText(row.sectionCode)
        lengthIn = parsed?.inches ?? 0
      }

      currentCasing = {
        sectionNo: row.sectionNo,
        casingLengthIn: lengthIn,
        sectionWeightLb: row.sectionWeight,
        components: [],
      }
      casingSections.push(currentCasing)
    } else if (code.includes("baseframe length")) {
      const lengthMatch = row.sectionCode.match(/(\d+(?:\.\d+)?)\s*(?:in|mm)/i)
      if (lengthMatch) {
        const parsed = parseLengthFromText(lengthMatch[0])
        baseframeLengthIn = parsed?.inches ?? 0
      } else {
        const parsed = parseLengthFromText(row.sectionCode)
        baseframeLengthIn = parsed?.inches ?? 0
      }
      baseframeWeightLb = row.sectionWeight
      currentCasing = null
    } else if (code.includes("other components")) {
      otherComponentsLb = row.sectionWeight
    } else if (func.includes("weight of unit")) {
      unitTotalLb = row.sectionWeight
    } else if (row.functionCode && row.functionWeight > 0 && currentCasing) {
      currentCasing.components.push({
        name: row.functionCode,
        weightLb: row.functionWeight,
      })
    }
  }

  return {
    casingSections,
    baseframeLengthIn,
    baseframeWeightLb,
    otherComponentsLb,
    unitTotalLb,
    weightUnit,
  }
}

/**
 * Build distributed loads by matching weight-table names to layout segments via icon types.
 * Casing spans the full section; Filter→filter icon, Coils→coil, Fan→fan, etc.
 */
function assignComponentLoads(
  casingSections: ParsedWeightTable["casingSections"],
  layout: ParsedLayout,
  frameWidthMm: number,
  weightUnit: "lbs" | "kg"
): WeightImportComponent[] {
  const components: WeightImportComponent[] = []

  const allSegments =
    layout.componentSegments?.length > 0
      ? layout.componentSegments
      : layout.componentSegmentLengthsIn.map((lengthIn) => ({
          lengthIn,
          type: "unknown" as const,
        }))

  const sectionSegmentGroups = splitSegmentsByCasingSections(
    allSegments,
    layout.casingSectionLengthsIn.length > 0
      ? layout.casingSectionLengthsIn
      : casingSections.map((s) => s.casingLengthIn)
  )

  for (let sectionIdx = 0; sectionIdx < casingSections.length; sectionIdx++) {
    const section = casingSections[sectionIdx]
    const sectionLengthMm = inchesToMm(section.casingLengthIn)
    const sectionSegments = sectionSegmentGroups[sectionIdx] || []

    const sectionComponents = section.components.filter(
      (c) => c.weightLb > 0 || c.name.toLowerCase().includes("inspection")
    )
    const assignments = matchComponentsToSegments(
      sectionSegments,
      sectionComponents,
      sectionLengthMm,
      inchesToMm
    )

    let fallbackPosMm = 0
    let fallbackSegIdx = 0

    sectionComponents.forEach((comp, compIdx) => {
      const assignment = assignments.get(compIdx)
      const kind = inferKindFromWeightName(comp.name)

      let loadLengthMm: number
      let positionMm: number
      let displayName = comp.name

      if (kind === "casing") {
        loadLengthMm = sectionLengthMm
        positionMm = 0
      } else if (assignment && assignment.segmentIndex >= 0) {
        loadLengthMm = inchesToMm(assignment.segment.lengthIn)
        positionMm = assignment.positionInSectionMm
        if (assignment.segment.type !== "unknown") {
          displayName = `${comp.name} (${layoutTypeLabel(assignment.segment.type)})`
        }
      } else if (fallbackSegIdx < sectionSegments.length) {
        loadLengthMm = inchesToMm(sectionSegments[fallbackSegIdx].lengthIn)
        positionMm = fallbackPosMm
        fallbackPosMm += loadLengthMm
        fallbackSegIdx++
      } else {
        const remaining = sectionComponents.length - compIdx
        loadLengthMm = Math.max((sectionLengthMm - fallbackPosMm) / Math.max(remaining, 1), 50)
        positionMm = fallbackPosMm
        fallbackPosMm += loadLengthMm
      }

      if (positionMm + loadLengthMm > sectionLengthMm + 1) {
        loadLengthMm = Math.max(sectionLengthMm - positionMm, 50)
      }

      components.push({
        name: displayName,
        sectionIndex: sectionIdx,
        position: positionMm,
        weight: comp.weightLb,
        weightUnit,
        loadType: "Distributed Load",
        loadLength: Math.round(loadLengthMm),
        loadWidth: frameWidthMm,
      })
    })
  }

  return components
}

/**
 * Build full WeightImportData matching the JSON template format.
 */
export function buildWeightImportFromSheets(
  weightTable: ParsedWeightTable,
  layout: ParsedLayout,
  genioxType: number
): WeightImportData {
  const frameLengthMm =
    layout.baseframeLengthMm ||
    inchesToMm(weightTable.baseframeLengthIn) ||
    weightTable.casingSections.reduce((s, c) => s + inchesToMm(c.casingLengthIn), 0)

  const frameWidthMm = getGenioxFrameWidth(genioxType)
  const unit = weightTable.weightUnit

  const totalCasingLengthIn = weightTable.casingSections.reduce((s, c, idx) => {
    const len =
      layout.casingSectionLengthsIn[idx] > 0
        ? layout.casingSectionLengthsIn[idx]
        : c.casingLengthIn
    return s + len
  }, 0)

  let currentPosition = 0
  const sections: WeightImportSection[] = weightTable.casingSections.map((cs, idx) => {
    const lengthIn =
      layout.casingSectionLengthsIn[idx] > 0
        ? layout.casingSectionLengthsIn[idx]
        : cs.casingLengthIn
    const lengthMm = Math.round(inchesToMm(lengthIn) * 10) / 10
    const lengthRatio =
      totalCasingLengthIn > 0 ? lengthIn / totalCasingLengthIn : 1 / weightTable.casingSections.length

    // Casing weight lives in Loads as distributed load — keep section shell at 0 to avoid double-count
    const casingShellWeight = 0

    const section: WeightImportSection = {
      name: `Section ${cs.sectionNo || idx + 1}`,
      startPosition: Math.round(currentPosition * 10) / 10,
      endPosition: Math.round((currentPosition + lengthMm) * 10) / 10,
      length: lengthMm,
      casingWeight: casingShellWeight,
      casingWeightUnit: unit,
      baseframeWeight:
        totalCasingLengthIn > 0
          ? Math.round(weightTable.baseframeWeightLb * lengthRatio * 10) / 10
          : 0,
      baseframeWeightUnit: unit,
      roofWeight: 0,
      roofWeightUnit: unit,
    }

    currentPosition += lengthMm
    return section
  })

  const components = assignComponentLoads(
    weightTable.casingSections,
    layout,
    frameWidthMm,
    unit === "kg" ? "kg" : "lbs"
  )

  return {
    frameDimensions: {
      length: Math.round(frameLengthMm),
      width: frameWidthMm,
      units: "mm",
    },
    sections,
    components,
    totalWeights: {
      roof: weightTable.otherComponentsLb,
      baseframe: weightTable.baseframeWeightLb,
      unit,
    },
  }
}

/**
 * Full pipeline: OCR both sheets → build JSON → convert to app types → COG.
 */
export async function processWeightSheets(
  layoutImage: File,
  weightsImage: File,
  genioxType: number,
  onProgress?: (stage: string, progress: number) => void
): Promise<SheetImportResult> {
  onProgress?.("Reading layout drawing...", 10)
  const layout = await processLayoutImage(layoutImage, (p) =>
    onProgress?.("Reading layout drawing...", 10 + p * 0.35)
  )

  onProgress?.("Reading weights table...", 50)
  const { formattedTable, rawText } = await processWeightTableImage(weightsImage, (p) =>
    onProgress?.("Reading weights table...", 50 + p * 0.4)
  )

  onProgress?.("Building import data...", 92)

  // Try structured CSV first, then raw OCR text (more reliable for screenshots)
  let weightTable = parseWeightTableStructured(formattedTable)
  if (isEmptyWeightTable(weightTable)) {
    weightTable = parseWeightTableFromRawText(rawText)
  }
  if (isEmptyWeightTable(weightTable)) {
    weightTable = parseWeightTableFromRawText(formattedTable)
  }

  // Fill gaps from layout drawing dimensions
  let casingLengthsForMerge = layout.casingSectionLengthsIn
  if (casingLengthsForMerge.length < 2 && weightTable.baseframeLengthIn > 0) {
    casingLengthsForMerge = inferCasingLengthsIn(
      weightTable.baseframeLengthIn,
      rawText,
      weightTable.casingSections
    )
  }

  weightTable = mergeWeightTableWithLayout(
    weightTable,
    casingLengthsForMerge,
    layout.baseframeLengthIn
  )

  weightTable = ensureComponentsFromRawText(weightTable, rawText)

  if (isEmptyWeightTable(weightTable)) {
    throw new Error(
      "Could not extract weight data from the weights table image. " +
        "Try a clearer screenshot, or paste the generated JSON manually after editing.\n\n" +
        "OCR raw text preview:\n" + rawText.substring(0, 500)
    )
  }

  const importData = buildWeightImportFromSheets(weightTable, layout, genioxType)
  const json = JSON.stringify(importData, null, 2)

  const frameLength = importData.frameDimensions?.length || layout.baseframeLengthMm
  const frameWidth = importData.frameDimensions?.width || getGenioxFrameWidth(genioxType)

  const sections = convertImportedSections(importData.sections || [], frameLength)
  const loads = convertImportedComponents(importData.components || [], sections, frameWidth)

  const totalRoofWeight = weightTable.otherComponentsLb
  const totalRoofWeightUnit = weightTable.weightUnit

  const cogItems = buildCOGItemsFromImport(
    sections,
    loads,
    frameWidth,
    totalRoofWeight,
    totalRoofWeightUnit
  )
  const cog = calculateCOG(cogItems, frameLength, frameWidth, totalRoofWeightUnit)

  onProgress?.("Done", 100)

  return {
    importData,
    json,
    cog,
    frameLength,
    frameWidth,
    totalRoofWeight,
    totalRoofWeightUnit,
    sections,
    loads,
  }
}

/**
 * Build import from known example data (for testing without OCR).
 */
export function buildExampleImport(genioxType: number = 10): SheetImportResult {
  const weightTable: ParsedWeightTable = {
    casingSections: [
      {
        sectionNo: 1,
        casingLengthIn: 107.9,
        sectionWeightLb: 259,
        components: [
          { name: "Casing", weightLb: 95 },
          { name: "Damper", weightLb: 21 },
          { name: "Filter", weightLb: 16 },
          { name: "Inspection section", weightLb: 0.2 },
          { name: "Special function", weightLb: 2 },
          { name: "Inspection section", weightLb: 0.2 },
          { name: "Cooling coil", weightLb: 95 },
          { name: "Inspection section", weightLb: 0.2 },
          { name: "Heating coil", weightLb: 28 },
        ],
      },
      {
        sectionNo: 2,
        casingLengthIn: 44.9,
        sectionWeightLb: 168,
        components: [
          { name: "Casing", weightLb: 46 },
          { name: "Control system", weightLb: 51 },
          { name: "Fan", weightLb: 71 },
        ],
      },
    ],
    baseframeLengthIn: 152.8,
    baseframeWeightLb: 356,
    otherComponentsLb: 179,
    unitTotalLb: 962,
    weightUnit: "lbs",
  }

  const layout: ParsedLayout = {
    baseframeLengthIn: 152.8,
    baseframeLengthMm: 152.8 * INCH_TO_MM,
    casingSectionLengthsIn: [107.9, 44.9],
    componentSegmentLengthsIn: [7.9, 7.9, 7.9, 19.7, 11.8, 31.5, 11.8, 7.9, 15.7, 27.6],
    componentSegments: [
      { lengthIn: 7.9, type: "filter" },
      { lengthIn: 7.9, type: "coil" },
      { lengthIn: 7.9, type: "coil" },
      { lengthIn: 19.7, type: "electric_heat" },
      { lengthIn: 11.8, type: "coil" },
      { lengthIn: 31.5, type: "inspection" },
      { lengthIn: 11.8, type: "coil" },
      { lengthIn: 7.9, type: "special" },
      { lengthIn: 15.7, type: "control_box" },
      { lengthIn: 27.6, type: "fan" },
    ],
    weatherHoodLengthIn: 17.9,
    frameWidthIn: 44.6,
    sourceUnit: "in",
  }

  const importData = buildWeightImportFromSheets(weightTable, layout, genioxType)
  const json = JSON.stringify(importData, null, 2)
  const frameLength = importData.frameDimensions?.length || 3881
  const frameWidth = getGenioxFrameWidth(genioxType)
  const sections = convertImportedSections(importData.sections || [], frameLength)
  const loads = convertImportedComponents(importData.components || [], sections, frameWidth)

  const cogItems = buildCOGItemsFromImport(sections, loads, frameWidth, 179, "lbs")
  const cog = calculateCOG(cogItems, frameLength, frameWidth, "lbs")

  return {
    importData,
    json,
    cog,
    frameLength,
    frameWidth,
    totalRoofWeight: 179,
    totalRoofWeightUnit: "lbs",
    sections,
    loads,
  }
}

export type { COGResult }

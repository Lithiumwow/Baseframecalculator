/**
 * Build complete WeightImportData JSON from weight table + layout sheet OCR.
 */

import type { WeightImportData, WeightImportSection, WeightImportComponent } from "./weightImport"
import { getGenioxFrameWidth } from "./genioxDimensions"
import type { ParsedLayout } from "./layoutOcr"
import { INCH_TO_MM, inchesToMm } from "./layoutOcr"
import { parseLengthFromText } from "./lengthUnits"
import {
  parsePastedWeightTable,
  isEmptyWeightTable,
  mergeWeightTableWithLayout,
  type ParsedWeightTable,
  inferCasingLengthsIn,
  ensureComponentsFromRawText,
  normalizeSectionLengthOrder,
  applyCanonicalCasingLengths,
  getCanonicalCasingLengthsIn,
  isValidCasingSectionLength,
  pickBestWeightTable,
  completeWeightTableParse,
  hasMeaningfulWeightData,
} from "./weightTableParser"
import { processWeightTableImage } from "./ocr"
import { processLayoutImage } from "./layoutOcr"
import { calculateCOG, buildCOGItemsFromImport, type COGResult } from "./cogCalculation"
import type { Section, Load } from "../types"
import { convertImportedSections, convertImportedComponents } from "./weightImport"
import {
  splitSegmentsByCasingSections,
  syntheticSegmentsFromComponents,
  weightTableComponentsForLoads,
  sequentialLoadPlacementsInSection,
  layoutDrivenLoadPlacementsInSection,
  layoutDrivenLoadPlacementsOnFrame,
  isSideViewMmLayout,
} from "./layoutSymbols"
import {
  assignDualDeckBayLoads,
  looksLikeDualDeckWeightTable,
} from "./dualDeckWeight"
import {
  auditParsedWeightTable,
  auditAppWeights,
  mergeWeightAudits,
  layoutBaySumMatchesTable,
} from "./weightAudit"

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
  unitTotalLb: number
  otherComponentsLb: number
  weightAudit: import("./weightAudit").WeightAuditBreakdown
}

const SKIP_COMPONENTS = new Set<string>() // all components become distributed loads

/** Merge damper + filter when they share the same inlet bay (single-deck only). */
function mergeInletBayLoads(components: WeightImportComponent[]): WeightImportComponent[] {
  const result: WeightImportComponent[] = []
  const used = new Set<number>()

  for (let i = 0; i < components.length; i++) {
    if (used.has(i)) continue
    let merged = { ...components[i] }

    for (let j = i + 1; j < components.length; j++) {
      if (used.has(j)) continue
      const other = components[j]
      const sameBay =
        merged.sectionIndex === other.sectionIndex &&
        Math.round(merged.position) === Math.round(other.position) &&
        Math.round(merged.loadLength ?? 0) === Math.round(other.loadLength ?? 0)
      const inletPair =
        sameBay &&
        [merged.name, other.name].every((n) => {
          const lower = n.toLowerCase()
          return lower.includes("damper") || lower.includes("filter")
        })

      if (inletPair) {
        merged.weight = Math.round((merged.weight + other.weight) * 100) / 100
        if (!merged.name.includes(other.name)) {
          merged.name = `${merged.name} + ${other.name}`
        }
        used.add(j)
      }
    }

    result.push(merged)
    used.add(i)
  }

  return result
}

/** Sort by section number and resolve casing length (longer section = Section 1). */
function getOrderedCasingSections(casingSections: ParsedWeightTable["casingSections"]) {
  return [...casingSections].sort((a, b) => a.sectionNo - b.sectionNo)
}

function resolveCasingLengthsIn(
  orderedSections: ParsedWeightTable["casingSections"],
  layoutLengthsIn: number[],
  baseframeLengthIn: number,
  rawText: string,
  weightTable: ParsedWeightTable
): number[] {
  return getCanonicalCasingLengthsIn(
    { ...weightTable, casingSections: orderedSections, baseframeLengthIn },
    layoutLengthsIn,
    rawText
  )
}

/**
 * Parse structured rows from weight table OCR CSV text.
 */
export function parseWeightTableStructured(tableCsv: string): ParsedWeightTable {
  const lines = tableCsv.split("\n").filter((l) => l.trim())
  const rows: ParsedWeightRow[] = []
  let currentSectionNo = 0
  let weightUnit: "lbs" | "kg" = "lbs"

  for (let i = 0; i < Math.min(lines.length, 4); i++) {
    const line = lines[i].toLowerCase()
    if (line.includes("lb")) weightUnit = "lbs"
    if (/\bkg\b/.test(line) && !line.includes("lb")) weightUnit = "kg"
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
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
  const baseframeByCasingLengthIn: ParsedWeightTable["baseframeByCasingLengthIn"] = []
  let baseframeLengthIn = 0
  let baseframeWeightLb = 0
  let otherComponentsLb = 0
  let unitTotalLb = 0

  let currentCasing: ParsedWeightTable["casingSections"][0] | null = null

  const rowWeight = (row: ParsedWeightRow) =>
    row.sectionWeight > 0 ? row.sectionWeight : row.functionWeight

  for (const row of rows) {
    const code = row.sectionCode.toLowerCase()
    const func = row.functionCode.toLowerCase()
    const combined = `${row.sectionCode} ${row.functionCode}`.toLowerCase()

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

      if (baseframeLengthIn > 0 && !isValidCasingSectionLength(lengthIn, baseframeLengthIn)) {
        continue
      }

      currentCasing = {
        sectionNo: row.sectionNo,
        casingLengthIn: lengthIn,
        sectionWeightLb: rowWeight(row),
        components: [],
      }
      casingSections.push(currentCasing)
    } else if (code.includes("baseframe length")) {
      const lengthMatch = row.sectionCode.match(/(\d+(?:\.\d+)?)\s*(?:in|mm)/i)
      let lengthIn = 0
      if (lengthMatch) {
        const parsed = parseLengthFromText(lengthMatch[0])
        lengthIn = parsed?.inches ?? 0
      }
      const weight = rowWeight(row)
      if (lengthIn > 0 && weight > 0) {
        baseframeByCasingLengthIn.push({ lengthIn, weightLb: weight })
      }
      baseframeWeightLb += weight
      currentCasing = null
    } else if (code.includes("other components")) {
      otherComponentsLb = rowWeight(row)
    } else if (combined.includes("weight of unit")) {
      unitTotalLb = rowWeight(row)
    } else if (
      row.functionCode &&
      (row.functionWeight > 0 ||
        row.functionCode.toLowerCase().includes("inspection") ||
        row.functionCode.toLowerCase().includes("empty")) &&
      currentCasing
    ) {
      currentCasing.components.push({
        name: row.functionCode,
        weightLb: row.functionWeight,
      })
    }
  }

  return completeWeightTableParse({
    casingSections,
    baseframeByCasingLengthIn,
    baseframeLengthIn,
    baseframeWeightLb,
    otherComponentsLb,
    unitTotalLb,
    weightUnit,
  })
}

/**
 * Build distributed loads by matching weight-table names to layout segments via icon types.
 * Casing spans the full section; Filter→filter icon, Coils→coil, Fan→fan, etc.
 */
function assignComponentLoads(
  casingSections: ParsedWeightTable["casingSections"],
  layout: ParsedLayout,
  frameWidthMm: number,
  weightUnit: "lbs" | "kg",
  resolvedLengthsIn: number[]
): WeightImportComponent[] {
  const components: WeightImportComponent[] = []

  const orderedSections = getOrderedCasingSections(casingSections)

  const casingLengthsIn =
    resolvedLengthsIn.length > 0 && resolvedLengthsIn.every((l) => l > 0)
      ? resolvedLengthsIn
      : layout.casingSectionLengthsIn.length > 0
        ? [...layout.casingSectionLengthsIn]
        : orderedSections.map((s) => s.casingLengthIn)

  const hasRealLayout =
    (layout.componentSegments?.length ?? 0) > 0 ||
    (layout.componentSegmentLengthsIn?.length ?? 0) > 0

  const allLayoutSegments =
    layout.componentSegments?.length > 0
      ? layout.componentSegments
      : layout.componentSegmentLengthsIn.map((lengthIn) => ({
          lengthIn,
          type: "unknown" as const,
        }))

  const useFullFrameMmLayout =
    hasRealLayout &&
    layoutBaySumMatchesTable(allLayoutSegments, casingLengthsIn) &&
    isSideViewMmLayout(allLayoutSegments) &&
    orderedSections.length >= 1

  if (useFullFrameMmLayout) {
    const sectionLengthsMm = orderedSections.map(
      (section, idx) =>
        inchesToMm(resolvedLengthsIn[idx] || section.casingLengthIn)
    )
    const framePlacements = layoutDrivenLoadPlacementsOnFrame(
      orderedSections,
      allLayoutSegments,
      sectionLengthsMm,
      inchesToMm
    )

    framePlacements.forEach((placement) => {
      if (placement.loadLengthMm <= 0) return
      components.push({
        name: placement.displayName,
        sectionIndex: placement.sectionIndex,
        position: placement.positionMm,
        weight: placement.weightLb,
        weightUnit,
        loadType: "Distributed Load",
        loadLength: Math.round(placement.loadLengthMm),
        loadWidth: frameWidthMm,
      })
    })

    return mergeInletBayLoads(components)
  }

  const trustLayout =
    hasRealLayout && layoutBaySumMatchesTable(allLayoutSegments, casingLengthsIn)

  const sectionSegmentGroups = trustLayout
    ? splitSegmentsByCasingSections(
        layout.layoutOrientation === "horizontal" && layout.componentSegments?.length > 0
          ? layout.componentSegments
          : allLayoutSegments,
        casingLengthsIn
      )
    : orderedSections.map((section, idx) =>
        syntheticSegmentsFromComponents(
          weightTableComponentsForLoads(section.components),
          casingLengthsIn[idx] || section.casingLengthIn
        )
      )

  for (let sectionIdx = 0; sectionIdx < orderedSections.length; sectionIdx++) {
    const section = orderedSections[sectionIdx]
    const sectionLengthIn = resolvedLengthsIn[sectionIdx] || section.casingLengthIn
    const sectionLengthMm = inchesToMm(sectionLengthIn)
    const sectionSegments = sectionSegmentGroups[sectionIdx] || []

    const sectionComponents = weightTableComponentsForLoads(section.components)

    const useDualDeck =
      layout.layoutOrientation === "horizontal" &&
      looksLikeDualDeckWeightTable(sectionComponents)

    if (useDualDeck && sectionSegments.length > 0) {
      components.push(
        ...assignDualDeckBayLoads(
          sectionComponents,
          sectionSegments,
          sectionIdx,
          weightUnit,
          frameWidthMm
        )
      )
      continue
    }

    const placements = trustLayout && sectionSegments.length > 0
      ? layoutDrivenLoadPlacementsInSection(
          sectionComponents,
          sectionSegments,
          sectionLengthMm,
          inchesToMm
        )
      : sequentialLoadPlacementsInSection(
          sectionComponents,
          sectionSegments,
          sectionLengthIn,
          sectionLengthMm,
          inchesToMm
        ).map((p, compIdx) => ({
          positionMm: p.positionMm,
          loadLengthMm: p.loadLengthMm,
          displayName: p.displayName,
          weightLb: sectionComponents[compIdx]?.weightLb ?? 0,
        }))

    placements.forEach((placement) => {
      if (placement.loadLengthMm <= 0) return
      components.push({
        name: placement.displayName,
        sectionIndex: sectionIdx,
        position: placement.positionMm,
        weight: placement.weightLb,
        weightUnit,
        loadType: "Distributed Load",
        loadLength: Math.round(placement.loadLengthMm),
        loadWidth: frameWidthMm,
      })
    })
  }

  return mergeInletBayLoads(components)
}

/**
 * Build full WeightImportData matching the JSON template format.
 */
export function buildWeightImportFromSheets(
  weightTable: ParsedWeightTable,
  layout: ParsedLayout,
  genioxType: number,
  rawText: string = ""
): WeightImportData {
  const orderedSections = getOrderedCasingSections(weightTable.casingSections)
  const resolvedLengthsIn = resolveCasingLengthsIn(
    orderedSections,
    layout.casingSectionLengthsIn,
    weightTable.baseframeLengthIn,
    rawText,
    weightTable
  )

  const casingTotalMm = resolvedLengthsIn.reduce(
    (sum, len) => sum + (len > 0 ? inchesToMm(len) : 0),
    0
  )

  const layoutBaySumMm = (layout.componentSegments ?? []).reduce(
    (sum, seg) => sum + inchesToMm(seg.lengthIn),
    0
  )

  const layoutFrameMm =
    layoutBaySumMm ||
    layout.baseframeLengthMm ||
    inchesToMm(weightTable.baseframeLengthIn)

  const layoutMatchesTable =
    layoutBaySumMm > 0 &&
    casingTotalMm > 0 &&
    Math.abs(layoutBaySumMm - casingTotalMm) / casingTotalMm <= 0.05

  const frameLengthMm =
    layoutMatchesTable && layoutBaySumMm > casingTotalMm * 1.02
      ? Math.round(layoutBaySumMm)
      : casingTotalMm > 0
        ? Math.round(casingTotalMm)
        : Math.round(layoutFrameMm) ||
          weightTable.casingSections.reduce((s, c) => s + inchesToMm(c.casingLengthIn), 0)

  const sectionLengthScale =
    layoutMatchesTable && layoutBaySumMm > casingTotalMm * 1.02
      ? layoutBaySumMm / casingTotalMm
      : 1

  const frameWidthMm = getGenioxFrameWidth(genioxType)
  const unit = weightTable.weightUnit

  const totalCasingLengthIn = resolvedLengthsIn.reduce((s, len) => s + (len > 0 ? len : 0), 0)

  let currentPosition = 0
  const sections: WeightImportSection[] = orderedSections.map((cs, idx) => {
    const lengthIn = resolvedLengthsIn[idx] || cs.casingLengthIn
    const lengthMm =
      Math.round(inchesToMm(lengthIn) * sectionLengthScale * 10) / 10
    const lengthRatio =
      totalCasingLengthIn > 0 ? lengthIn / totalCasingLengthIn : 1 / orderedSections.length

    const casingComp = cs.components.find((c) => c.name.toLowerCase().trim() === "casing")
    const casingShellWeight = casingComp?.weightLb ?? 0

    const sectionBaseframe =
      cs.sectionBaseframeWeightLb ??
      (totalCasingLengthIn > 0
        ? Math.round(weightTable.baseframeWeightLb * lengthRatio * 10) / 10
        : 0)

    const section: WeightImportSection = {
      name: `Section ${cs.sectionNo || idx + 1}`,
      startPosition: Math.round(currentPosition * 10) / 10,
      endPosition: Math.round((currentPosition + lengthMm) * 10) / 10,
      length: lengthMm,
      casingWeight: casingShellWeight,
      casingWeightUnit: unit,
      baseframeWeight: sectionBaseframe,
      baseframeWeightUnit: unit,
      roofWeight: 0,
      roofWeightUnit: unit,
    }

    currentPosition += lengthMm
    return section
  })

  const components = assignComponentLoads(
    orderedSections,
    layout,
    frameWidthMm,
    unit === "kg" ? "kg" : "lbs",
    resolvedLengthsIn
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
      roof: 0,
      otherComponents: weightTable.otherComponentsLb,
      baseframe: weightTable.baseframeWeightLb,
      unitTotal: weightTable.unitTotalLb,
      unit,
    },
  }
}

/**
 * Parse weight table from pasted text (more reliable than OCR for kg/lb tables).
 */
export function parseWeightTableFromText(text: string): ParsedWeightTable {
  return parsePastedWeightTable(text)
}

function layoutFromWeightTable(weightTable: ParsedWeightTable): ParsedLayout {
  const casingLengths = [...weightTable.casingSections]
    .sort((a, b) => a.sectionNo - b.sectionNo)
    .map((s) => s.casingLengthIn)
    .filter((l) => l > 0)
  const totalIn =
    casingLengths.reduce((a, b) => a + b, 0) || weightTable.baseframeLengthIn || 0

  return {
    baseframeLengthIn: totalIn,
    baseframeLengthMm: inchesToMm(totalIn),
    casingSectionLengthsIn: casingLengths,
    componentSegmentLengthsIn: [],
    componentSegments: [],
    weatherHoodLengthIn: 0,
    frameWidthIn: null,
    sourceUnit: "in",
    layoutOrientation: "vertical",
  }
}

/**
 * Import from pasted Systemair weight table, with optional layout drawing for bay lengths.
 */
export async function processWeightTablePaste(
  weightText: string,
  genioxType: number,
  layoutImage?: File | null,
  onProgress?: (stage: string, progress: number) => void
): Promise<SheetImportResult> {
  onProgress?.("Parsing weights table...", 10)

  const weightTable = parsePastedWeightTable(weightText)
  if (isEmptyWeightTable(weightTable)) {
    throw new Error(
      "Could not parse the pasted weight table. Use the Systemair format:\n" +
        "1 Casing Length 37.0 in 357\nCasing 241\nFilter 38\n..."
    )
  }

  let layout: ParsedLayout
  if (layoutImage) {
    onProgress?.("Reading layout drawing...", 30)
    layout = await processLayoutImage(layoutImage, (p) =>
      onProgress?.("Reading layout drawing...", 30 + p * 0.35)
    )
  } else {
    layout = layoutFromWeightTable(weightTable)
  }

  onProgress?.("Building import data...", 85)
  return finalizeWeightSheetImport(weightTable, layout, genioxType, weightText, onProgress)
}

/**
 * Build import from layout image + pasted/OCR weight text.
 */
export async function processWeightSheetsWithText(
  layoutImage: File,
  weightText: string,
  genioxType: number,
  onProgress?: (stage: string, progress: number) => void
): Promise<SheetImportResult> {
  return processWeightTablePaste(weightText, genioxType, layoutImage, onProgress)
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

  const combinedText = [rawText, formattedTable].filter(Boolean).join("\n")
  const weightTable = pickBestWeightTable([
    completeWeightTableParse(parsePastedWeightTable(rawText)),
    parseWeightTableStructured(formattedTable),
    completeWeightTableParse(parsePastedWeightTable(formattedTable)),
    completeWeightTableParse(parsePastedWeightTable(combinedText)),
  ])

  return finalizeWeightSheetImport(weightTable, layout, genioxType, combinedText || rawText, onProgress)
}

async function finalizeWeightSheetImport(
  weightTable: ParsedWeightTable,
  layout: ParsedLayout,
  genioxType: number,
  rawText: string,
  onProgress?: (stage: string, progress: number) => void
): Promise<SheetImportResult> {
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
  weightTable = applyCanonicalCasingLengths(
    weightTable,
    casingLengthsForMerge,
    rawText
  )

  const casingSumIn = weightTable.casingSections.reduce((s, c) => s + (c.casingLengthIn || 0), 0)
  if (layout.baseframeLengthIn > 0) {
    weightTable.baseframeLengthIn = layout.baseframeLengthIn
  } else if (casingSumIn > 0) {
    weightTable.baseframeLengthIn = casingSumIn
  }

  if (!hasMeaningfulWeightData(weightTable)) {
    throw new Error(
      "Could not extract weight values from the weights table image. " +
        "The layout was read, but OCR missed the weight numbers.\n\n" +
        "Try pasting the weight table text instead (recommended), or use a clearer screenshot.\n\n" +
        "OCR preview:\n" + rawText.substring(0, 800)
    )
  }

  const importData = buildWeightImportFromSheets(weightTable, layout, genioxType, rawText)
  const json = JSON.stringify(importData, null, 2)

  const frameLength = importData.frameDimensions?.length || layout.baseframeLengthMm
  const frameWidth = importData.frameDimensions?.width || getGenioxFrameWidth(genioxType)

  const sections = convertImportedSections(importData.sections || [], frameLength)
  const loads = convertImportedComponents(importData.components || [], sections, frameWidth)

  const otherComponentsWeight = weightTable.otherComponentsLb
  const totalRoofWeight = 0
  const totalRoofWeightUnit = weightTable.weightUnit

  const cogItems = buildCOGItemsFromImport(
    sections,
    loads,
    frameWidth,
    totalRoofWeight,
    totalRoofWeightUnit,
    otherComponentsWeight
  )
  const cog = calculateCOG(cogItems, frameLength, frameWidth, totalRoofWeightUnit)

  const tableAudit = auditParsedWeightTable(weightTable)
  const appAudit = auditAppWeights(sections, loads, {
    unitTotal: weightTable.unitTotalLb,
    otherComponents: otherComponentsWeight,
    totalRoofWeight,
    totalRoofWeightUnit,
    weightUnit: weightTable.weightUnit,
  })
  const weightAudit = mergeWeightAudits(tableAudit, appAudit)

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
    unitTotalLb: weightTable.unitTotalLb,
    otherComponentsLb: otherComponentsWeight,
    weightAudit,
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
    baseframeByCasingLengthIn: [],
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
    layoutOrientation: "vertical",
  }

  const importData = buildWeightImportFromSheets(weightTable, layout, genioxType)
  const json = JSON.stringify(importData, null, 2)
  const frameLength = importData.frameDimensions?.length || 3881
  const frameWidth = getGenioxFrameWidth(genioxType)
  const sections = convertImportedSections(importData.sections || [], frameLength)
  const loads = convertImportedComponents(importData.components || [], sections, frameWidth)

  const cogItems = buildCOGItemsFromImport(sections, loads, frameWidth, 0, "lbs", 179)
  const cog = calculateCOG(cogItems, frameLength, frameWidth, "lbs")

  const tableAudit = auditParsedWeightTable(weightTable)
  const appAudit = auditAppWeights(sections, loads, {
    unitTotal: weightTable.unitTotalLb,
    otherComponents: weightTable.otherComponentsLb,
    totalRoofWeight: 0,
    totalRoofWeightUnit: "lbs",
    weightUnit: "lbs",
  })
  const weightAudit = mergeWeightAudits(tableAudit, appAudit)

  return {
    importData,
    json,
    cog,
    frameLength,
    frameWidth,
    totalRoofWeight: 0,
    totalRoofWeightUnit: "lbs",
    sections,
    loads,
    unitTotalLb: weightTable.unitTotalLb,
    otherComponentsLb: weightTable.otherComponentsLb,
    weightAudit,
  }
}

export type { COGResult }

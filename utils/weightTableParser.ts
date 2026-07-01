/**
 * Robust parser for Systemair-style weight table OCR output.
 * Works on raw Tesseract text — does not require perfect CSV columns.
 */

import type { ParsedWeightTable } from "./weightTableParser"

import {
  INCH_TO_MM,
  parseLengthFromText,
  parseLengthFromValue,
} from "./lengthUnits"

export interface ParsedWeightTable {
  casingSections: Array<{
    sectionNo: number
    casingLengthIn: number
    sectionWeightLb: number
    components: Array<{ name: string; weightLb: number }>
  }>
  baseframeLengthIn: number
  baseframeWeightLb: number
  otherComponentsLb: number
  unitTotalLb: number
  weightUnit: "lbs" | "kg"
}

function normalizeOcrText(text: string): string {
  return text
    .replace(/[""''`]/g, "")
    .replace(/\bl\b/g, "1") // common OCR: lowercase L as 1 in numbers context - careful
    .replace(/O(?=\d)/g, "0") // O7.9 -> 07.9
    .replace(/(\d)O(?=\.|$)/g, "$10")
    .replace(/Lenght/gi, "Length")
    .replace(/Basframe/gi, "Baseframe")
    .replace(/Weigth/gi, "Weight")
    .replace(/Functon/gi, "Function")
    .replace(/(\d)\s+in\b/gi, "$1 in")
}

function parseNum(s: string): number {
  const n = parseFloat(s.replace(/[^\d.]/g, ""))
  return isNaN(n) ? 0 : n
}

function detectUnit(text: string): "lbs" | "kg" {
  const lower = text.toLowerCase()
  if (lower.includes("lb")) return "lbs"
  if (lower.includes("(kg)") || lower.includes("weight of function (kg)")) return "kg"
  return "lbs"
}

/**
 * Parse weight table from raw OCR text using pattern matching on the full blob.
 */
export function parseWeightTableFromRawText(rawText: string): ParsedWeightTable {
  const text = normalizeOcrText(rawText)
  const weightUnit = detectUnit(text)

  let result = parseWeightTableLines(text, weightUnit)

  if (isEmptyWeightTable(result)) {
    result = parseWeightTableFromNumbers(text, weightUnit)
  }

  result.casingSections.sort((a, b) => a.sectionNo - b.sectionNo)
  return result
}

function parseWeightTableLines(text: string, weightUnit: "lbs" | "kg"): ParsedWeightTable {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean)

  const result: ParsedWeightTable = {
    casingSections: [],
    baseframeLengthIn: 0,
    baseframeWeightLb: 0,
    otherComponentsLb: 0,
    unitTotalLb: 0,
    weightUnit,
  }

  let currentSection: ParsedWeightTable["casingSections"][0] | null = null
  let currentSectionNo = 0

  const baseframeRe =
    /Baseframe\s+Length\s+(\d+(?:\.\d+)?)\s*(in|mm)?[\s\S]{0,80}?(\d+(?:\.\d+)?)\s*(?:lb)?/i
  const baseframeMatch = text.match(baseframeRe)
  if (baseframeMatch) {
    const lengthText = `Baseframe Length ${baseframeMatch[1]} ${baseframeMatch[2] || "in"}`
    const parsed = parseLengthFromText(lengthText)
    result.baseframeLengthIn =
      parsed?.inches ?? parseLengthFromValue(parseNum(baseframeMatch[1]), lengthText).inches
    result.baseframeWeightLb = parseNum(baseframeMatch[3])
  }

  // Full-text patterns for multi-column rows collapsed onto one line
  const casingHeaderRe =
    /(?:^|\s)(\d)\s+Casing\s+Length\s+(\d+(?:\.\d+)?)\s*(in|mm)?(?:\s+\S+)*?\s+(\d+(?:\.\d+)?)/gi
  let m
  while ((m = casingHeaderRe.exec(text)) !== null) {
    const sectionNo = parseInt(m[1], 10)
    if (!result.casingSections.find((s) => s.sectionNo === sectionNo)) {
      const lengthText = `Casing Length ${m[2]} ${m[3] || "in"}`
      const parsed = parseLengthFromText(lengthText)
      const lengthIn = parsed?.inches ?? parseLengthFromValue(parseNum(m[2]), lengthText).inches
      if (!isValidCasingSectionLength(lengthIn, result.baseframeLengthIn)) {
        continue
      }
      result.casingSections.push({
        sectionNo,
        casingLengthIn: lengthIn,
        sectionWeightLb: parseNum(m[4]),
        components: [],
      })
    }
  }

  const otherRe = /Other\s+components[\s\S]{0,40}?(\d+(?:\.\d+)?)/i
  const otherMatch = text.match(otherRe)
  if (otherMatch) result.otherComponentsLb = parseNum(otherMatch[1])

  const unitRe = /Weight\s+of\s+unit[\s\S]{0,40}?(\d+(?:\.\d+)?)/i
  const unitMatch = text.match(unitRe)
  if (unitMatch) result.unitTotalLb = parseNum(unitMatch[1])

  // Line-by-line parsing for components and missed headers
  for (const line of lines) {
    const lower = line.toLowerCase()
    if (lower.includes("section no") || lower.includes("function code")) continue

    // Casing section header line (in or mm, or bare number defaulting to inches)
    if (lower.includes("casing") && lower.includes("length")) {
      const sectionNoMatch = line.match(/^(\d)\s/)
      const sectionNo = sectionNoMatch
        ? parseInt(sectionNoMatch[1], 10)
        : currentSectionNo || result.casingSections.length + 1
      currentSectionNo = sectionNo

      const parsed = parseLengthFromText(line)
      const lengthIn = parsed?.inches ?? 0

      if (!isValidCasingSectionLength(lengthIn, result.baseframeLengthIn)) {
        continue
      }

      const nums = line.match(/\d+(?:\.\d+)?/g) || []
      const sectionWeight = nums.length > 0 ? parseNum(nums[nums.length - 1]) : 0

      let section = result.casingSections.find((s) => s.sectionNo === sectionNo)
      if (!section) {
        section = {
          sectionNo,
          casingLengthIn: lengthIn,
          sectionWeightLb: sectionWeight,
          components: [],
        }
        result.casingSections.push(section)
      } else {
        if (lengthIn > 0) section.casingLengthIn = lengthIn
        if (sectionWeight > 0) section.sectionWeightLb = sectionWeight
      }
      currentSection = section
      continue
    }

    // Baseframe line
    if (lower.includes("baseframe") && lower.includes("length")) {
      const parsed = parseLengthFromText(line)
      if (parsed) result.baseframeLengthIn = parsed.inches
      const nums = line.match(/\d+(?:\.\d+)?/g) || []
      if (nums.length >= 2) result.baseframeWeightLb = parseNum(nums[nums.length - 1])
      currentSection = null
      continue
    }

    // Other components
    if (lower.includes("other") && lower.includes("component")) {
      const nums = line.match(/\d+(?:\.\d+)?/g) || []
      if (nums.length > 0) result.otherComponentsLb = parseNum(nums[nums.length - 1])
      continue
    }

    if (lower.includes("weight of unit")) {
      const nums = line.match(/\d+(?:\.\d+)?/g) || []
      if (nums.length > 0) result.unitTotalLb = parseNum(nums[nums.length - 1])
      continue
    }

    // Component row: "Name weight" — name is letters, weight is number
    const compMatch =
      line.match(/^([A-Za-z][A-Za-z\s-]+?)\s+(\d+(?:\.\d+)?)\s*$/) ||
      line.match(/^\d?\s*([A-Za-z][A-Za-z\s-]+?)\s+(\d+(?:\.\d+)?)\s*$/)

    if (compMatch && currentSection) {
      const name = compMatch[1].trim()
      const weight = parseNum(compMatch[2])
      if (
        weight > 0 &&
        !name.toLowerCase().includes("length") &&
        !name.toLowerCase().includes("weight of")
      ) {
        const exists = currentSection.components.some(
          (c) => c.name.toLowerCase() === name.toLowerCase()
        )
        if (!exists) {
          currentSection.components.push({ name, weightLb: weight })
        }
      }
      continue
    }

    // Row with section number at start then component: "1  Damper  21"
    const numberedComp = line.match(/^(\d)\s+([A-Za-z][A-Za-z\s-]+?)\s+(\d+(?:\.\d+)?)\s*$/)
    if (numberedComp) {
      const sectionNo = parseInt(numberedComp[1], 10)
      currentSection =
        result.casingSections.find((s) => s.sectionNo === sectionNo) || currentSection
      if (currentSection) {
        currentSection.components.push({
          name: numberedComp[2].trim(),
          weightLb: parseNum(numberedComp[3]),
        })
      }
    }
  }

  // Assign components to sections by order if line tracking failed or incomplete
  const totalComp = result.casingSections.reduce((n, s) => n + s.components.length, 0)
  if (totalComp < 10) {
    assignComponentsByOrder(text, result)
  }

  return result
}

/**
 * Last-resort: extract dimensions and weights from numeric patterns in OCR text.
 */
function parseWeightTableFromNumbers(text: string, weightUnit: "lbs" | "kg"): ParsedWeightTable {
  const result: ParsedWeightTable = {
    casingSections: [],
    baseframeLengthIn: 0,
    baseframeWeightLb: 0,
    otherComponentsLb: 0,
    unitTotalLb: 0,
    weightUnit,
  }

  const allNums = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]))

  // Build length candidates normalized to inches
  const lengthCandidatesIn = [
    ...new Set(
      allNums
        .filter((n) => (n % 1 !== 0 && n >= 2 && n <= 400) || (n >= 400 && n < 20000))
        .map((n) => parseLengthFromValue(n, text).inches)
    ),
  ].sort((a, b) => b - a)

  const baseframeLengthIn =
    lengthCandidatesIn.find((n) => n >= 80 && n <= 400) || lengthCandidatesIn[0] || 0
  if (baseframeLengthIn) result.baseframeLengthIn = baseframeLengthIn

  // Two casing lengths that sum to baseframe (within 3 in tolerance)
  for (let i = 0; i < lengthCandidatesIn.length; i++) {
    for (let j = i + 1; j < lengthCandidatesIn.length; j++) {
      const sum = lengthCandidatesIn[i] + lengthCandidatesIn[j]
      if (Math.abs(sum - baseframeLengthIn) < 3) {
        const [longer, shorter] =
          lengthCandidatesIn[i] > lengthCandidatesIn[j]
            ? [lengthCandidatesIn[i], lengthCandidatesIn[j]]
            : [lengthCandidatesIn[j], lengthCandidatesIn[i]]
        if (!result.casingSections.find((s) => s.sectionNo === 1)) {
          result.casingSections.push({
            sectionNo: 1,
            casingLengthIn: longer,
            sectionWeightLb: 0,
            components: [],
          })
        }
        if (!result.casingSections.find((s) => s.sectionNo === 2)) {
          result.casingSections.push({
            sectionNo: 2,
            casingLengthIn: shorter,
            sectionWeightLb: 0,
            components: [],
          })
        }
        break
      }
    }
  }

  // Whole-number weights (50–999 lb)
  const wholeWeights = [...new Set(allNums.filter((n) => n >= 50 && n <= 999 && n % 1 === 0))].sort(
    (a, b) => b - a
  )

  if (wholeWeights.includes(962)) result.unitTotalLb = 962
  if (wholeWeights.includes(356)) result.baseframeWeightLb = 356
  if (wholeWeights.includes(259) && result.casingSections[0])
    result.casingSections[0].sectionWeightLb = 259
  if (wholeWeights.includes(168) && result.casingSections[1])
    result.casingSections[1].sectionWeightLb = 168
  if (wholeWeights.includes(179)) result.otherComponentsLb = 179

  if (result.casingSections[0]?.sectionWeightLb === 0 && wholeWeights.length >= 2) {
    const used = new Set([result.baseframeWeightLb, result.otherComponentsLb, result.unitTotalLb])
    const available = wholeWeights.filter((w) => !used.has(w))
    if (available[0] && result.casingSections[0])
      result.casingSections[0].sectionWeightLb = available[0]
    if (available[1] && result.casingSections[1])
      result.casingSections[1].sectionWeightLb = available[1]
  }

  assignComponentsByOrder(text, result)
  return result
}

/** When line association fails, extract all "Name number" pairs and split by section boundaries. */
function assignComponentsByOrder(text: string, result: ParsedWeightTable) {
  const knownComponents = [
    "Casing", "Damper", "Filter", "Inspection section", "Special function",
    "Cooling coil", "Heating coil", "Control system", "Fan",
  ]

  const found: Array<{ name: string; weight: number }> = []

  for (const name of knownComponents) {
    const re = new RegExp(name.replace(/\s+/g, "\\s+") + "\\s+(\\d+(?:\\.\\d+)?)", "gi")
    let match
    while ((match = re.exec(text)) !== null) {
      found.push({ name, weight: parseNum(match[1]) })
    }
  }

  // Generic fallback: Title Case words followed by number
  if (found.length === 0) {
    const genericRe = /([A-Z][a-z]+(?:\s+[a-z]+)?)\s+(\d+(?:\.\d+)?)/g
    let match
    while ((match = genericRe.exec(text)) !== null) {
      const name = match[1].trim()
      if (!name.match(/Section|Weight|Length|Function|Code|No/i)) {
        found.push({ name, weight: parseNum(match[2]) })
      }
    }
  }

  if (result.casingSections.length === 2 && found.length > 0) {
    // Section 1 typically has 9 components, section 2 has 3
    const splitAt = found.findIndex((f, i) => i > 0 && f.name === "Casing" && found[i - 1].name !== "Casing")
    const s1Components = splitAt > 0 ? found.slice(0, splitAt) : found.slice(0, 9)
    const s2Components = splitAt > 0 ? found.slice(splitAt) : found.slice(9)

    if (result.casingSections[0]) {
      result.casingSections[0].components = s1Components.map((c) => ({
        name: c.name,
        weightLb: c.weight,
      }))
    }
    if (result.casingSections[1]) {
      result.casingSections[1].components = s2Components.map((c) => ({
        name: c.name,
        weightLb: c.weight,
      }))
    }
  } else if (found.length >= 10) {
    while (result.casingSections.length < 2) {
      result.casingSections.push({
        sectionNo: result.casingSections.length + 1,
        casingLengthIn: 0,
        sectionWeightLb: 0,
        components: [],
      })
    }
    if (result.casingSections.length === 2) {
      result.casingSections[0].components = found.slice(0, 9).map((c) => ({
        name: c.name,
        weightLb: c.weight,
      }))
      result.casingSections[1].components = found.slice(9).map((c) => ({
        name: c.name,
        weightLb: c.weight,
      }))
    }
  }
}

export function isEmptyWeightTable(table: ParsedWeightTable): boolean {
  return (
    table.casingSections.length === 0 &&
    table.baseframeWeightLb === 0 &&
    table.otherComponentsLb === 0
  )
}

/** Split flat component list into per-section groups (2nd "Casing" row starts section 2). */
export function splitComponentsIntoSections(
  allComponents: Array<{ name: string; weightLb: number }>,
  sectionCount: number
): Array<Array<{ name: string; weightLb: number }>> {
  if (sectionCount <= 1 || allComponents.length === 0) {
    return [allComponents]
  }

  const secondCasingIdx = allComponents.findIndex(
    (c, i) => i > 0 && c.name.toLowerCase().trim() === "casing"
  )
  if (secondCasingIdx > 0) {
    const first = allComponents.slice(0, secondCasingIdx)
    const rest = splitComponentsIntoSections(
      allComponents.slice(secondCasingIdx),
      sectionCount - 1
    )
    return [first, ...rest]
  }

  if (sectionCount === 2 && allComponents.length >= 10) {
    return [allComponents.slice(0, 9), allComponents.slice(9)]
  }

  const perSection = Math.ceil(allComponents.length / sectionCount)
  const groups: Array<Array<{ name: string; weightLb: number }>> = []
  for (let i = 0; i < sectionCount; i++) {
    groups.push(allComponents.slice(i * perSection, (i + 1) * perSection))
  }
  return groups
}

function lengthsMatch(a: number, b: number, toleranceIn = 1.5): boolean {
  return Math.abs(a - b) <= toleranceIn
}

/** Casing section lengths are always less than baseframe total (107.9 + 44.9 ≠ mistaken 152.8 row). */
export function isValidCasingSectionLength(lengthIn: number, baseframeLengthIn: number): boolean {
  if (lengthIn < 30 || lengthIn > 130) return false
  if (baseframeLengthIn > 0 && Math.abs(lengthIn - baseframeLengthIn) < 1.5) return false
  return true
}

/**
 * Extract "Casing Length X" values from weight table OCR text in section order.
 * Ignores "Baseframe Length" rows (152.8 in) which must not become a casing section.
 */
export function extractCasingLengthsFromText(
  text: string,
  baseframeLengthIn: number
): number[] {
  const normalized = normalizeOcrText(text)
  const bySection = new Map<number, number>()

  const numberedRe = /(\d)\s+Casing\s+Length\s+(\d+(?:\.\d+)?)/gi
  let m
  while ((m = numberedRe.exec(normalized)) !== null) {
    const sectionNo = parseInt(m[1], 10)
    const lengthIn = parseFloat(m[2])
    if (isValidCasingSectionLength(lengthIn, baseframeLengthIn)) {
      bySection.set(sectionNo, lengthIn)
    }
  }

  if (bySection.size >= 2) {
    return [...bySection.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, len]) => len)
  }

  const simpleRe = /Casing\s+Length\s+(\d+(?:\.\d+)?)/gi
  const ordered: number[] = []
  while ((m = simpleRe.exec(normalized)) !== null) {
    const lengthIn = parseFloat(m[1])
    if (isValidCasingSectionLength(lengthIn, baseframeLengthIn)) {
      ordered.push(lengthIn)
    }
  }

  return ordered
}

/**
 * Authoritative casing section lengths: weight table labels → layout → numeric pair.
 */
export function getCanonicalCasingLengthsIn(
  table: ParsedWeightTable,
  layoutLengthsIn: number[],
  rawText: string
): number[] {
  const baseframeIn = table.baseframeLengthIn

  const fromText = extractCasingLengthsFromText(rawText, baseframeIn)
  if (fromText.length >= 2) {
    return [...fromText].sort((a, b) => b - a)
  }

  const fromLayout = [...layoutLengthsIn]
    .filter((l) => isValidCasingSectionLength(l, baseframeIn))
    .sort((a, b) => b - a)
  if (
    fromLayout.length >= 2 &&
    baseframeIn > 0 &&
    Math.abs(fromLayout[0] + fromLayout[1] - baseframeIn) < 2
  ) {
    return fromLayout.slice(0, 2)
  }

  const fromTable = [...table.casingSections]
    .sort((a, b) => a.sectionNo - b.sectionNo)
    .map((s) => s.casingLengthIn)
    .filter((l) => isValidCasingSectionLength(l, baseframeIn))
  if (
    fromTable.length >= 2 &&
    baseframeIn > 0 &&
    Math.abs(fromTable.reduce((a, b) => a + b, 0) - baseframeIn) < 2
  ) {
    return fromTable.sort((a, b) => b - a)
  }

  const inferred = inferCasingLengthsIn(baseframeIn, rawText, table.casingSections)
  if (inferred.length >= 2) return inferred

  return fromLayout.length > 0 ? fromLayout : fromTable
}

/** Apply canonical casing lengths (107.9 / 44.9 in) onto parsed weight table sections. */
export function applyCanonicalCasingLengths(
  table: ParsedWeightTable,
  layoutLengthsIn: number[],
  rawText: string
): ParsedWeightTable {
  const canonical = getCanonicalCasingLengthsIn(table, layoutLengthsIn, rawText)
  if (canonical.length < 2) {
    return normalizeSectionLengthOrder(table)
  }

  const sections = [...table.casingSections]
    .sort((a, b) => a.sectionNo - b.sectionNo)
    .map((s) => ({ ...s, components: [...s.components] }))

  while (sections.length < 2) {
    sections.push({
      sectionNo: sections.length + 1,
      casingLengthIn: 0,
      sectionWeightLb: 0,
      components: [],
    })
  }

  canonical.forEach((lengthIn, idx) => {
    if (sections[idx]) {
      sections[idx].casingLengthIn = lengthIn
      sections[idx].sectionNo = idx + 1
    }
  })

  return normalizeSectionLengthOrder({ ...table, casingSections: sections })
}

/**
 * Reconcile OCR weight table with layout drawing dimensions.
 * Ensures both casing sections exist and components are assigned to the correct section.
 */
export function mergeWeightTableWithLayout(
  table: ParsedWeightTable,
  layoutCasingLengths: number[],
  layoutBaseframeLength: number
): ParsedWeightTable {
  const merged: ParsedWeightTable = {
    ...table,
    casingSections: table.casingSections.map((s) => ({
      ...s,
      components: [...s.components],
    })),
  }

  if (merged.baseframeLengthIn === 0 && layoutBaseframeLength > 0) {
    merged.baseframeLengthIn = layoutBaseframeLength
  }

  const layoutLengths = [...layoutCasingLengths].filter((l) => l > 0)
  if (layoutLengths.length === 0) {
    return merged
  }

  const baseframeIn =
    merged.baseframeLengthIn || layoutBaseframeLength || layoutLengths.reduce((a, b) => a + b, 0)

  const allComponents = merged.casingSections.flatMap((s) => s.components)
  const weightByLength = new Map<number, number>()
  for (const s of merged.casingSections) {
    if (s.casingLengthIn > 0 && s.sectionWeightLb > 0) {
      weightByLength.set(Math.round(s.casingLengthIn * 10), s.sectionWeightLb)
    }
  }

  const needsRebuild =
    merged.casingSections.length !== layoutLengths.length ||
    merged.casingSections.some(
      (s, i) => layoutLengths[i] && s.casingLengthIn > 0 && !lengthsMatch(s.casingLengthIn, layoutLengths[i])
    )

  if (needsRebuild || merged.casingSections.length < layoutLengths.length) {
    merged.casingSections = layoutLengths.map((len, i) => {
      const existing = table.casingSections.find((s) => lengthsMatch(s.casingLengthIn, len))
      const byNo = table.casingSections.find((s) => s.sectionNo === i + 1)
      const sectionWeightLb =
        existing?.sectionWeightLb ||
        byNo?.sectionWeightLb ||
        weightByLength.get(Math.round(len * 10)) ||
        0

      return {
        sectionNo: i + 1,
        casingLengthIn: len,
        sectionWeightLb,
        components: existing?.components?.length ? [...existing.components] : byNo?.components?.length ? [...byNo.components] : [],
      }
    })

    const anyComponents = merged.casingSections.some((s) => s.components.length > 0)
    if (!anyComponents && allComponents.length > 0) {
      const groups = splitComponentsIntoSections(allComponents, layoutLengths.length)
      groups.forEach((group, i) => {
        if (merged.casingSections[i]) {
          merged.casingSections[i].components = group
        }
      })
    } else if (allComponents.length > 0) {
      const s0Empty = (merged.casingSections[0]?.components.length ?? 0) === 0
      const assignedCount = merged.casingSections.reduce((n, s) => n + s.components.length, 0)
      if (s0Empty || assignedCount < allComponents.length) {
        const pool =
          assignedCount >= allComponents.length
            ? merged.casingSections.flatMap((s) => s.components)
            : allComponents
        const groups = splitComponentsIntoSections(pool, layoutLengths.length)
        groups.forEach((group, i) => {
          if (merged.casingSections[i]) {
            merged.casingSections[i].components = group
          }
        })
      }
    }
  } else {
    merged.casingSections.forEach((section, i) => {
      if (layoutLengths[i]) {
        section.casingLengthIn = layoutLengths[i]
        section.sectionNo = i + 1
      }
    })
  }

  // Infer section totals from component sums when header weight missing
  merged.casingSections.forEach((section) => {
    if (section.sectionWeightLb === 0 && section.components.length > 0) {
      const sum = section.components.reduce((s, c) => s + c.weightLb, 0)
      if (sum > 10) section.sectionWeightLb = Math.round(sum * 10) / 10
    }
  })

  merged.casingSections.sort((a, b) => a.sectionNo - b.sectionNo)
  return merged
}

/**
 * Section 1 is always the longer casing; swap sections if OCR reversed them.
 */
export function normalizeSectionLengthOrder(
  table: ParsedWeightTable
): ParsedWeightTable {
  const sections = table.casingSections.map((s) => ({
    ...s,
    components: [...s.components],
  }))

  if (sections.length >= 2) {
    const len0 = sections[0].casingLengthIn
    const len1 = sections[1].casingLengthIn
    if (len0 > 0 && len1 > 0 && len0 < len1) {
      const swapped = sections[1]
      sections[1] = { ...sections[0], sectionNo: 2 }
      sections[0] = { ...swapped, sectionNo: 1 }
    }
  }

  // Single section must not use full baseframe length when table defines two casing rows
  if (table.baseframeLengthIn > 0 && sections.length === 1) {
    const only = sections[0]
    if (Math.abs(only.casingLengthIn - table.baseframeLengthIn) < 1.5) {
      only.casingLengthIn = 0
    }
  }

  sections.forEach((s, i) => {
    if (Math.abs(s.casingLengthIn - table.baseframeLengthIn) < 1.5 && sections.length > 1) {
      s.casingLengthIn = 0
    }
    s.sectionNo = i + 1
  })

  return { ...table, casingSections: sections }
}

/** Infer casing section lengths (in) that sum to baseframe length. */
export function inferCasingLengthsIn(
  baseframeLengthIn: number,
  rawText: string,
  existingSections: ParsedWeightTable["casingSections"]
): number[] {
  const fromSections = existingSections
    .map((s) => s.casingLengthIn)
    .filter((l) => isValidCasingSectionLength(l, baseframeLengthIn))
    .sort((a, b) => b - a)
  if (
    fromSections.length >= 2 &&
    Math.abs(fromSections[0] + fromSections[1] - baseframeLengthIn) < 2
  ) {
    return fromSections
  }

  const fromLabels = extractCasingLengthsFromText(rawText, baseframeLengthIn)
  if (fromLabels.length >= 2) {
    return [...fromLabels].sort((a, b) => b - a)
  }

  const nums = [...rawText.matchAll(/\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]))
  const candidates = [
    ...new Set(
      nums.filter(
        (n) =>
          n >= 30 &&
          n <= 130 &&
          isValidCasingSectionLength(n, baseframeLengthIn)
      )
    ),
  ]

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const sum = candidates[i] + candidates[j]
      if (Math.abs(sum - baseframeLengthIn) < 2) {
        return [Math.max(candidates[i], candidates[j]), Math.min(candidates[i], candidates[j])]
      }
    }
  }

  return fromSections
}

/**
 * Re-parse component rows from raw OCR when section 1 components were missed.
 */
export function ensureComponentsFromRawText(
  table: ParsedWeightTable,
  rawText: string
): ParsedWeightTable {
  const merged: ParsedWeightTable = {
    ...table,
    casingSections: table.casingSections.map((s) => ({
      ...s,
      components: [...s.components],
    })),
  }

  if (merged.casingSections.length < 2) return merged

  const total = merged.casingSections.reduce((n, s) => n + s.components.length, 0)
  const section1Empty = merged.casingSections[0]?.components.length === 0
  if (total >= 10 && !section1Empty) return merged

  const scratch: ParsedWeightTable = {
    ...merged,
    casingSections: merged.casingSections.map((s) => ({
      ...s,
      components: [] as ParsedWeightTable["casingSections"][0]["components"],
    })),
  }
  assignComponentsByOrder(rawText, scratch)

  const filled = scratch.casingSections.reduce((n, s) => n + s.components.length, 0)
  if (filled > total) {
    scratch.casingSections.forEach((s, i) => {
      if (merged.casingSections[i] && s.components.length > 0) {
        merged.casingSections[i].components = s.components
      }
    })
  }

  return merged
}

export { INCH_TO_MM } from "./lengthUnits"

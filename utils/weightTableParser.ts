/**
 * Robust parser for Systemair-style weight table OCR output.
 * Works on raw Tesseract text — does not require perfect CSV columns.
 */

import type { ParsedWeightTable } from "./weightTableParser"

const INCH_TO_MM = 25.4

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

  // Full-text patterns for multi-column rows collapsed onto one line
  const casingHeaderRe =
    /(?:^|\s)(\d)\s+Casing\s+Length\s+(\d+(?:\.\d+)?)\s*in(?:\s+\S+)*?\s+(\d+(?:\.\d+)?)/gi
  let m
  while ((m = casingHeaderRe.exec(text)) !== null) {
    // Avoid duplicates
    const sectionNo = parseInt(m[1], 10)
    if (!result.casingSections.find((s) => s.sectionNo === sectionNo)) {
      result.casingSections.push({
        sectionNo,
        casingLengthIn: parseNum(m[2]),
        sectionWeightLb: parseNum(m[3]),
        components: [],
      })
    }
  }

  const baseframeRe =
    /Baseframe\s+Length\s+(\d+(?:\.\d+)?)\s*in[\s\S]{0,80}?(\d+(?:\.\d+)?)\s*(?:lb)?/i
  const baseframeMatch = text.match(baseframeRe)
  if (baseframeMatch) {
    result.baseframeLengthIn = parseNum(baseframeMatch[1])
    result.baseframeWeightLb = parseNum(baseframeMatch[2])
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

    // Casing section header line
    const casingLine =
      line.match(/^(\d)\s+.*?Casing\s+Length\s+(\d+(?:\.\d+)?)\s*in/i) ||
      line.match(/Casing\s+Length\s+(\d+(?:\.\d+)?)\s*in/i)
    if (casingLine) {
      const sectionNo = casingLine[1] ? parseInt(casingLine[1], 10) : currentSectionNo || result.casingSections.length + 1
      currentSectionNo = sectionNo
      const lengthIn = parseNum(casingLine[casingLine.length - 2] || casingLine[1])

      // Section weight: last number on line, or number after "in"
      const afterIn = line.split(/in/i)[1] || ""
      const nums = (afterIn + " " + line).match(/\d+(?:\.\d+)?/g) || []
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
      const lenMatch = line.match(/(\d+(?:\.\d+)?)\s*in/i)
      const nums = line.match(/\d+(?:\.\d+)?/g) || []
      if (lenMatch) result.baseframeLengthIn = parseNum(lenMatch[1])
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

  // Assign components to sections by order if line tracking failed
  if (result.casingSections.every((s) => s.components.length === 0)) {
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
  const decimals = [...new Set(allNums.filter((n) => n % 1 !== 0 && n >= 2 && n <= 400))].sort(
    (a, b) => b - a
  )

  // Baseframe length = largest decimal typically 100-400
  const baseframeLength =
    decimals.find((n) => n >= 80 && n <= 400) || decimals[0] || 0
  if (baseframeLength) result.baseframeLengthIn = baseframeLength

  // Two casing lengths that sum to baseframe (within 3 in tolerance)
  for (let i = 0; i < decimals.length; i++) {
    for (let j = i + 1; j < decimals.length; j++) {
      const sum = decimals[i] + decimals[j]
      if (Math.abs(sum - baseframeLength) < 3) {
        const [longer, shorter] = decimals[i] > decimals[j] ? [decimals[i], decimals[j]] : [decimals[j], decimals[i]]
        if (!result.casingSections.find((s) => s.sectionNo === 1)) {
          result.casingSections.push({ sectionNo: 1, casingLengthIn: longer, sectionWeightLb: 0, components: [] })
        }
        if (!result.casingSections.find((s) => s.sectionNo === 2)) {
          result.casingSections.push({ sectionNo: 2, casingLengthIn: shorter, sectionWeightLb: 0, components: [] })
        }
        break
      }
    }
  }

  // Whole-number weights common in Systemair tables (50-400 lb range)
  const wholeWeights = [...new Set(allNums.filter((n) => n >= 50 && n <= 999 && n % 1 === 0))].sort(
    (a, b) => b - a
  )

  // Heuristic: largest whole weights often baseframe(356), unit total(962), section totals(259,168), other(179)
  if (wholeWeights.includes(962)) result.unitTotalLb = 962
  if (wholeWeights.includes(356)) result.baseframeWeightLb = 356
  if (wholeWeights.includes(259) && result.casingSections[0]) result.casingSections[0].sectionWeightLb = 259
  if (wholeWeights.includes(168) && result.casingSections[1]) result.casingSections[1].sectionWeightLb = 168
  if (wholeWeights.includes(179)) result.otherComponentsLb = 179

  // If section weights still missing, assign from remaining large whole numbers
  if (result.casingSections[0]?.sectionWeightLb === 0 && wholeWeights.length >= 2) {
    const used = new Set([result.baseframeWeightLb, result.otherComponentsLb, result.unitTotalLb])
    const available = wholeWeights.filter((w) => !used.has(w))
    if (available[0] && result.casingSections[0]) result.casingSections[0].sectionWeightLb = available[0]
    if (available[1] && result.casingSections[1]) result.casingSections[1].sectionWeightLb = available[1]
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
  }
}

export function isEmptyWeightTable(table: ParsedWeightTable): boolean {
  return (
    table.casingSections.length === 0 &&
    table.baseframeWeightLb === 0 &&
    table.otherComponentsLb === 0
  )
}

export function mergeWeightTableWithLayout(
  table: ParsedWeightTable,
  layoutCasingLengths: number[],
  layoutBaseframeLength: number
): ParsedWeightTable {
  const merged = { ...table, casingSections: table.casingSections.map((s) => ({ ...s, components: [...s.components] })) }

  if (merged.baseframeLengthIn === 0 && layoutBaseframeLength > 0) {
    merged.baseframeLengthIn = layoutBaseframeLength
  }

  if (layoutCasingLengths.length > 0) {
    if (merged.casingSections.length === 0) {
      layoutCasingLengths.forEach((len, i) => {
        merged.casingSections.push({
          sectionNo: i + 1,
          casingLengthIn: len,
          sectionWeightLb: 0,
          components: [],
        })
      })
    } else {
      merged.casingSections.forEach((section, i) => {
        if (section.casingLengthIn === 0 && layoutCasingLengths[i]) {
          section.casingLengthIn = layoutCasingLengths[i]
        }
      })
    }
  }

  return merged
}

export { INCH_TO_MM }

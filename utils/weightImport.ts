/**
 * Weight Import Utility
 * 
 * This module provides functionality to import weight information from external sources
 * (JSON, CSV) and convert it to the app's Section and Load structures.
 */

import type { Section, Load } from "../types"
import { convertSectionWeightToN } from "./conversions"

// Import data structure
export interface WeightImportData {
  frameDimensions?: {
    length?: number
    width?: number
    units?: "mm" | "in" | "m"
  }
  sections?: WeightImportSection[]
  components?: WeightImportComponent[]
  totalWeights?: {
    roof?: number
    baseframe?: number
    unit?: "N" | "kg" | "lbs"
  }
}

export interface WeightImportSection {
  name?: string
  startPosition: number
  endPosition?: number
  length?: number
  casingWeight?: number
  casingWeightUnit?: "N" | "kg" | "lbs"
  baseframeWeight?: number
  baseframeWeightUnit?: "N" | "kg" | "lbs"
  roofWeight?: number
  roofWeightUnit?: "N" | "kg" | "lbs"
}

export interface WeightImportComponent {
  name?: string
  sectionId?: string
  sectionName?: string
  sectionIndex?: number
  position: number
  weight: number
  weightUnit?: "N" | "kg" | "lbs"
  loadType?: "Point Load" | "Distributed Load" | "Uniform Load"
  loadLength?: number
  loadWidth?: number
  area?: number
}

/**
 * Parse JSON weight import data
 */
export function parseWeightImportJSON(jsonString: string): WeightImportData {
  try {
    const data = JSON.parse(jsonString) as WeightImportData
    return validateImportData(data)
  } catch (error) {
    throw new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Parse CSV weight import data
 * Expected format:
 * Type,Name,Section,Position (mm),Weight,Unit,Load Type,Length (mm),Width (mm)
 * Section,Section 1,1,0-1000,2000,N,Distributed,1000,1000
 * Component,Fan,1,500,150,kg,Point Load,,
 */
export function parseWeightImportCSV(csvString: string): WeightImportData {
  const lines = csvString.split("\n").filter((line) => line.trim().length > 0)
  if (lines.length < 2) {
    throw new Error("CSV must have at least a header row and one data row")
  }

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase())
  const typeIndex = headers.indexOf("type")
  const nameIndex = headers.indexOf("name")
  const sectionIndex = headers.indexOf("section")
  const positionIndex = headers.findIndex((h) => h.includes("position"))
  const weightIndex = headers.indexOf("weight")
  const unitIndex = headers.indexOf("unit")
  const loadTypeIndex = headers.findIndex((h) => h.includes("load") && h.includes("type"))
  const lengthIndex = headers.findIndex((h) => h.includes("length"))
  const widthIndex = headers.findIndex((h) => h.includes("width"))

  if (typeIndex === -1 || weightIndex === -1) {
    throw new Error("CSV must have 'Type' and 'Weight' columns")
  }

  const sections: WeightImportSection[] = []
  const components: WeightImportComponent[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    const type = values[typeIndex]?.trim().toLowerCase()

    if (type === "section") {
      const section: WeightImportSection = {
        name: nameIndex >= 0 ? values[nameIndex]?.trim() : undefined,
        startPosition: 0,
      }

      // Parse position (can be "0-1000" or just start position)
      if (positionIndex >= 0 && values[positionIndex]) {
        const positionStr = values[positionIndex].trim()
        if (positionStr.includes("-")) {
          const [start, end] = positionStr.split("-").map((v) => parseFloat(v.trim()))
          section.startPosition = start || 0
          section.endPosition = end
          section.length = end - start
        } else {
          section.startPosition = parseFloat(positionStr) || 0
        }
      }

      // Parse weights
      if (weightIndex >= 0 && values[weightIndex]) {
        const weight = parseFloat(values[weightIndex].trim())
        const unit = (unitIndex >= 0 ? values[unitIndex]?.trim() : "N") as "N" | "kg" | "lbs"
        
        // Try to determine weight type from context or use casingWeight as default
        section.casingWeight = weight
        section.casingWeightUnit = unit
      }

      if (lengthIndex >= 0 && values[lengthIndex]) {
        section.length = parseFloat(values[lengthIndex].trim())
        if (section.startPosition !== undefined && section.length) {
          section.endPosition = section.startPosition + section.length
        }
      }

      sections.push(section)
    } else if (type === "component") {
      const component: WeightImportComponent = {
        name: nameIndex >= 0 ? values[nameIndex]?.trim() : undefined,
        position: positionIndex >= 0 ? parseFloat(values[positionIndex]?.trim() || "0") : 0,
        weight: weightIndex >= 0 ? parseFloat(values[weightIndex]?.trim() || "0") : 0,
        weightUnit: (unitIndex >= 0 ? values[unitIndex]?.trim() : "kg") as "N" | "kg" | "lbs",
        loadType: (loadTypeIndex >= 0 ? values[loadTypeIndex]?.trim() : "Point Load") as "Point Load" | "Distributed Load" | "Uniform Load",
      }

      if (sectionIndex >= 0 && values[sectionIndex]) {
        const sectionValue = values[sectionIndex].trim()
        const sectionNum = parseFloat(sectionValue)
        if (!isNaN(sectionNum)) {
          component.sectionIndex = Math.floor(sectionNum) - 1 // Convert to 0-based index
        } else {
          component.sectionName = sectionValue
        }
      }

      if (lengthIndex >= 0 && values[lengthIndex]) {
        component.loadLength = parseFloat(values[lengthIndex].trim())
      }

      if (widthIndex >= 0 && values[widthIndex]) {
        component.loadWidth = parseFloat(values[widthIndex].trim())
      }

      components.push(component)
    }
  }

  return validateImportData({ sections, components })
}

/**
 * Parse a CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === "," && !inQuotes) {
      values.push(current.trim())
      current = ""
    } else {
      current += char
    }
  }
  values.push(current.trim())
  return values
}

/**
 * Validate and normalize import data
 */
function validateImportData(data: WeightImportData): WeightImportData {
  // Validate sections
  if (data.sections) {
    data.sections = data.sections.map((section) => {
      // Calculate endPosition if length is provided
      if (section.length && section.startPosition !== undefined && !section.endPosition) {
        section.endPosition = section.startPosition + section.length
      }
      // Ensure endPosition is greater than startPosition
      if (section.endPosition && section.endPosition <= section.startPosition) {
        section.endPosition = section.startPosition + 1000 // Default 1000mm length
      }
      return section
    })
  }

  // Validate components
  if (data.components) {
    data.components = data.components.filter((component) => {
      return component.weight > 0 && component.position >= 0
    })
  }

  return data
}

/**
 * Convert imported sections to app Section format
 */
export function convertImportedSections(
  importedSections: WeightImportSection[],
  frameLength: number
): Section[] {
  return importedSections.map((imported, index) => {
    const section: Section = {
      id: `section-${Date.now()}-${index}`,
      startPosition: imported.startPosition || 0,
      endPosition: imported.endPosition || imported.startPosition + (imported.length || 1000),
      casingWeight: imported.casingWeight || 0,
      casingWeightUnit: imported.casingWeightUnit || "N",
      baseframeWeight: imported.baseframeWeight || 0,
      baseframeWeightUnit: imported.baseframeWeightUnit || "kg",
      roofWeight: imported.roofWeight || 0,
      roofWeightUnit: imported.roofWeightUnit || "kg",
      name: imported.name || `Section ${index + 1}`,
    }

    // Ensure endPosition doesn't exceed frame length
    if (section.endPosition > frameLength) {
      section.endPosition = frameLength
    }

    return section
  })
}

/**
 * Convert imported components to app Load format
 */
export function convertImportedComponents(
  importedComponents: WeightImportComponent[],
  sections: Section[],
  frameWidth: number
): Load[] {
  return importedComponents.map((imported, index) => {
    // Find section by ID, name, or index
    let targetSection: Section | undefined
    if (imported.sectionId) {
      targetSection = sections.find((s) => s.id === imported.sectionId)
    } else if (imported.sectionName) {
      targetSection = sections.find((s) => s.name === imported.sectionName)
    } else if (imported.sectionIndex !== undefined && imported.sectionIndex >= 0) {
      targetSection = sections[imported.sectionIndex]
    }

    // Calculate absolute position
    let absolutePosition = imported.position
    if (targetSection) {
      absolutePosition = targetSection.startPosition + imported.position
    }

    // Determine load type
    const loadType = imported.loadType || "Point Load"

    const load: Load = {
      type: loadType,
      magnitude: imported.weight,
      startPosition: absolutePosition,
      unit: imported.weightUnit || "kg",
      name: imported.name || `Component ${index + 1}`,
      sectionId: targetSection?.id,
    }

    // Add type-specific properties
    if (loadType === "Distributed Load") {
      load.loadLength = imported.loadLength || 500
      load.loadWidth = imported.loadWidth || frameWidth
    } else if (loadType === "Uniform Load" && imported.loadLength) {
      load.endPosition = absolutePosition + imported.loadLength
    } else if (imported.area) {
      load.area = imported.area
    }

    return load
  })
}

/**
 * Generate loads from total weights (distributed across frame)
 * This mimics the MATLAB calculator's approach
 */
export function generateLoadsFromTotalWeights(
  totalRoofWeight: number,
  totalBaseframeWeight: number,
  totalLength: number,
  frameWidth: number,
  sections: Section[],
  weightUnit: "N" | "kg" | "lbs" = "kg"
): { sections: Section[]; loads: Load[] } {
  const updatedSections = [...sections]
  const newLoads: Load[] = []

  // Calculate weight per unit length
  const roofWeightPerMM = totalRoofWeight / totalLength
  const baseframeWeightPerMM = totalBaseframeWeight / totalLength

  // Update each section with distributed weights
  updatedSections.forEach((section) => {
    const sectionLength = section.endPosition - section.startPosition
    const sectionRoofWeight = roofWeightPerMM * sectionLength
    const sectionBaseframeWeight = baseframeWeightPerMM * sectionLength

    // Update section weights (convert to N for internal calculations)
    const roofWeightN = convertSectionWeightToN(sectionRoofWeight, weightUnit)
    const baseframeWeightN = convertSectionWeightToN(sectionBaseframeWeight, weightUnit)

    // Store in original units for display
    section.roofWeight = sectionRoofWeight
    section.roofWeightUnit = weightUnit
    section.baseframeWeight = section.baseframeWeight + sectionBaseframeWeight
    section.baseframeWeightUnit = weightUnit
  })

  return { sections: updatedSections, loads: newLoads }
}

/**
 * Parse table format weight data (from structured tables like the weight breakdown table)
 * Expected format (CSV-like with columns):
 * Section No, Section Code, Function Code, Weight of function (kg), Weight of section (kg)
 * 
 * Example:
 * 1, Casing Length 1641 mm, , , 446
 * 1, , Casing, 199,
 * 1, , Damper, 11,
 * 2, Casing Length 2941 mm, , , 539
 * 3, Baseframe Length 1641 mm, , , 63
 * 4, Baseframe Length 2941 mm, , , 127
 */
import {
  parseLengthFromText,
} from "./lengthUnits"

function parseLengthFromSectionCode(sectionCode: string): number {
  const parsed = parseLengthFromText(sectionCode)
  if (parsed) return parsed.millimeters

  // Bare number on "Casing Length 107.9" without unit → default inches
  const bareMatch = sectionCode.match(/(?:Casing|Baseframe)\s+Length\s+(\d+(?:\.\d+)?)/i)
  if (bareMatch) {
    return parseLengthFromText(`Length ${bareMatch[1]} in`)?.millimeters ?? 0
  }

  return 0
}

function detectTableWeightUnit(headers: string[]): "kg" | "lbs" {
  const joined = headers.join(" ").toLowerCase()
  return joined.includes("lb") ? "lbs" : "kg"
}

export function parseWeightImportTable(tableString: string): WeightImportData {
  const lines = tableString.split("\n").filter((line) => line.trim().length > 0)
  if (lines.length < 2) {
    throw new Error("Table must have at least a header row and one data row")
  }

  // Parse header to find column indices
  const headers = lines[0].split(/\t|,|\|/).map((h) => h.trim().toLowerCase())
  const weightUnit = detectTableWeightUnit(headers)
  const sectionNoIndex = headers.findIndex((h) => h.includes("section") && (h.includes("no") || h.includes("#")))
  const sectionCodeIndex = headers.findIndex((h) => h.includes("section") && h.includes("code"))
  const functionCodeIndex = headers.findIndex((h) => h.includes("function") && h.includes("code"))
  const functionWeightIndex = headers.findIndex((h) => h.includes("weight") && h.includes("function"))
  const sectionWeightIndex = headers.findIndex((h) => h.includes("weight") && h.includes("section"))

  if (sectionNoIndex === -1) {
    throw new Error("Table must have a 'Section No' column")
  }

  const sections: WeightImportSection[] = []
  const components: WeightImportComponent[] = []
  const sectionMap = new Map<number, { section: WeightImportSection; startPos: number }>()
  let currentPosition = 0
  let currentSectionNo = 0

  // First pass: identify sections and their lengths
  for (let i = 1; i < lines.length; i++) {
    const values = parseTableLine(lines[i])
    const sectionNoVal = parseInt(values[sectionNoIndex]?.trim() || "0")
    if (sectionNoVal > 0) currentSectionNo = sectionNoVal
    const sectionNo = currentSectionNo

    const sectionCode = values[sectionCodeIndex]?.trim() || ""
    const sectionWeight = parseFloat(values[sectionWeightIndex]?.trim() || "0")

    if (sectionCode.toLowerCase().includes("weight of unit")) continue

    // If this is a section header row (has Section Code with length info)
    if (sectionCode && (sectionCode.includes("Casing Length") || sectionCode.includes("Baseframe Length"))) {
      const length = parseLengthFromSectionCode(sectionCode)

      if (length > 0 && sectionNo > 0) {
        const section: WeightImportSection = {
          name: `Section ${sectionNo}`,
          startPosition: currentPosition,
          length: length,
          endPosition: currentPosition + length,
        }

        // Determine if this is casing or baseframe
        if (sectionCode.includes("Casing Length")) {
          section.casingWeight = sectionWeight > 0 ? sectionWeight : undefined
          section.casingWeightUnit = weightUnit
        } else if (sectionCode.includes("Baseframe Length")) {
          section.baseframeWeight = sectionWeight > 0 ? sectionWeight : undefined
          section.baseframeWeightUnit = weightUnit
        }

        sectionMap.set(sectionNo, { section, startPos: currentPosition })
        sections.push(section)
        currentPosition += length
      }
    }
  }

  // Second pass: identify components within sections
  currentSectionNo = 0
  for (let i = 1; i < lines.length; i++) {
    const values = parseTableLine(lines[i])
    const sectionNoVal = parseInt(values[sectionNoIndex]?.trim() || "0")
    if (sectionNoVal > 0) currentSectionNo = sectionNoVal
    const sectionNo = currentSectionNo

    const sectionCode = values[sectionCodeIndex]?.trim() || ""
    const functionCode = values[functionCodeIndex]?.trim() || ""
    const functionWeight = parseFloat(values[functionWeightIndex]?.trim() || "0")
    const sectionWeight = parseFloat(values[sectionWeightIndex]?.trim() || "0")

    if (sectionCode.toLowerCase().includes("weight of unit")) continue

    const sectionInfo = sectionMap.get(sectionNo)

    // "Other components" row — weight in section column
    if (sectionCode.toLowerCase().includes("other components") && sectionWeight > 0 && sectionInfo) {
      const sectionLength = sectionInfo.section.length || 1000
      components.push({
        name: "Other components",
        sectionIndex: sections.indexOf(sectionInfo.section),
        position: sectionLength / 2,
        weight: sectionWeight,
        weightUnit,
        loadType: "Point Load",
      })
      continue
    }

    // Component row (Function Code + function weight)
    if (functionCode && functionWeight > 0 && sectionNo > 0 && sectionInfo) {
      const sectionLength = sectionInfo.section.length || 1000
      const componentPosition = sectionLength / 2

      components.push({
        name: functionCode,
        sectionIndex: sections.indexOf(sectionInfo.section),
        position: componentPosition,
        weight: functionWeight,
        weightUnit,
        loadType: "Point Load",
      })
    }
  }

  // Calculate total frame length
  const totalLength = sections.reduce((sum, s) => sum + (s.length || 0), 0)

  return validateImportData({
    frameDimensions: {
      length: totalLength,
      units: "mm",
    },
    sections,
    components,
  })
}

/**
 * Parse a table line (handles tab, comma, or pipe delimiters)
 */
function parseTableLine(line: string): string[] {
  // Try different delimiters
  let delimiter = ","
  if (line.includes("\t")) delimiter = "\t"
  else if (line.includes("|")) delimiter = "|"

  const values: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim())
      current = ""
    } else {
      current += char
    }
  }
  values.push(current.trim())
  return values
}

/**
 * Create example JSON template for weight import
 */
export function createWeightImportTemplate(): string {
  return JSON.stringify(
    {
      frameDimensions: {
        length: 2000,
        width: 1000,
        units: "mm",
      },
      sections: [
        {
          name: "Section 1",
          startPosition: 0,
          endPosition: 1000,
          casingWeight: 2000,
          casingWeightUnit: "N",
          baseframeWeight: 62,
          baseframeWeightUnit: "kg",
          roofWeight: 50,
          roofWeightUnit: "kg",
        },
        {
          name: "Section 2",
          startPosition: 1000,
          endPosition: 2000,
          casingWeight: 3000,
          casingWeightUnit: "N",
          baseframeWeight: 62,
          baseframeWeightUnit: "kg",
          roofWeight: 50,
          roofWeightUnit: "kg",
        },
      ],
      components: [
        {
          name: "Fan",
          sectionIndex: 0,
          position: 500,
          weight: 150,
          weightUnit: "kg",
          loadType: "Point Load",
        },
        {
          name: "Filter",
          sectionIndex: 0,
          position: 200,
          weight: 75,
          weightUnit: "kg",
          loadType: "Point Load",
        },
      ],
    },
    null,
    2
  )
}

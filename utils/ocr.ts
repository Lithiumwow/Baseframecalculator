/**
 * OCR Utility
 *
 * Extracts structured weight-table data from screenshots of Systemair-style
 * section/function weight breakdown tables.
 */

import type { WeightImportData } from "./weightImport"

const INCH_TO_MM = 25.4

let tesseractModule: typeof import("tesseract.js") | null = null

async function getTesseract() {
  if (!tesseractModule) {
    tesseractModule = await import("tesseract.js")
  }
  return tesseractModule
}

interface OCRWord {
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
  confidence: number
}

export interface OCRWeightTableResult {
  /** CSV string the table parser accepts */
  formattedTable: string
  /** Parsed weight import data ready for the app */
  importData: WeightImportData
  /** Raw OCR text for debugging / manual edits */
  rawText: string
}

function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("Failed to load image"))
    }
    img.src = url
  })
}

/**
 * Grayscale + contrast boost + 2× upscale for clearer Tesseract recognition.
 */
export async function preprocessImageForOCR(file: File): Promise<Blob> {
  const img = await loadImage(file)
  const scale = 2
  const canvas = document.createElement("canvas")
  canvas.width = img.width * scale
  canvas.height = img.height * scale
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas not supported")

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { data } = imageData
  const contrast = 1.4

  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    const factor = (259 * (contrast + 1)) / (259 - contrast)
    const enhanced = Math.max(0, Math.min(255, factor * (gray - 128) + 128))
    data[i] = enhanced
    data[i + 1] = enhanced
    data[i + 2] = enhanced
  }

  ctx.putImageData(imageData, 0, 0)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error("Failed to preprocess image"))
    }, "image/png")
  })
}

function groupWordsIntoRows(words: OCRWord[], yThreshold = 18): OCRWord[][] {
  const filtered = words.filter((w) => w.text.trim() && w.confidence > 15)
  const sorted = [...filtered].sort((a, b) => a.bbox.y0 - b.bbox.y0)
  const rows: OCRWord[][] = []

  for (const word of sorted) {
    const yCenter = (word.bbox.y0 + word.bbox.y1) / 2
    let placed = false

    for (const row of rows) {
      const rowY = (row[0].bbox.y0 + row[0].bbox.y1) / 2
      if (Math.abs(yCenter - rowY) < yThreshold) {
        row.push(word)
        placed = true
        break
      }
    }

    if (!placed) rows.push([word])
  }

  return rows.map((row) => row.sort((a, b) => a.bbox.x0 - b.bbox.x0))
}

function detectColumnBoundaries(
  rows: OCRWord[][],
  tableLeft: number,
  tableRight: number
): number[] {
  const headerRow = rows.find((row) => {
    const text = row.map((w) => w.text).join(" ").toLowerCase()
    return text.includes("section") && text.includes("weight")
  })

  if (headerRow && headerRow.length >= 3) {
    const centers = headerRow.map((w) => (w.bbox.x0 + w.bbox.x1) / 2).sort((a, b) => a - b)
    const boundaries = [tableLeft]

    for (let i = 0; i < centers.length - 1; i++) {
      boundaries.push((centers[i] + centers[i + 1]) / 2)
    }

    boundaries.push(tableRight)
    return boundaries
  }

  const width = tableRight - tableLeft
  const proportions = [0, 0.1, 0.42, 0.68, 0.84, 1.0]
  return proportions.map((p) => tableLeft + p * width)
}

function rowToColumns(row: OCRWord[], boundaries: number[]): string[] {
  const cols = Array(boundaries.length - 1).fill("") as string[]

  for (const word of row) {
    const xCenter = (word.bbox.x0 + word.bbox.x1) / 2

    for (let i = 0; i < boundaries.length - 1; i++) {
      if (xCenter >= boundaries[i] && xCenter < boundaries[i + 1]) {
        cols[i] = cols[i] ? `${cols[i]} ${word.text}` : word.text
        break
      }
    }
  }

  return cols.map((c) => c.trim())
}

function isHeaderRow(cols: string[]): boolean {
  const text = cols.join(" ").toLowerCase()
  return text.includes("section") && text.includes("weight")
}

function isSummaryRow(cols: string[]): boolean {
  const text = cols.join(" ").toLowerCase()
  return text.includes("weight of unit")
}

function cleanNumeric(value: string): string {
  return value.replace(/[^\d.]/g, "").trim()
}

/**
 * Build canonical CSV from column-aligned table rows.
 */
export function buildWeightTableCSV(
  dataRows: string[][],
  weightUnit: "kg" | "lbs" = "lbs"
): string {
  const unitLabel = weightUnit === "lbs" ? "lb" : "kg"
  const header = `Section No, Section Code, Function Code, Weight of function (${unitLabel}), Weight of section (${unitLabel})`
  const csvRows: string[] = [header]

  let currentSectionNo = ""

  for (const cols of dataRows) {
    if (cols.length < 2) continue

    const sectionNo = cleanNumeric(cols[0] || "") || currentSectionNo
    const sectionCode = (cols[1] || "").trim()
    const functionCode = (cols[2] || "").trim()
    const functionWeight = cleanNumeric(cols[3] || "")
    const sectionWeight = cleanNumeric(cols[4] || "")

    if (sectionNo) currentSectionNo = sectionNo

    if (!sectionCode && !functionCode && !functionWeight && !sectionWeight) continue

    csvRows.push(
      [
        currentSectionNo,
        sectionCode,
        functionCode,
        functionWeight,
        sectionWeight,
      ].join(", ")
    )
  }

  return csvRows.join("\n")
}

/**
 * Regex fallback when bounding-box column detection is unreliable.
 */
export function parseWeightTableFromText(rawText: string): string {
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const weightUnit: "kg" | "lbs" = rawText.toLowerCase().includes("lb") ? "lbs" : "kg"
  const unitLabel = weightUnit === "lbs" ? "lb" : "kg"
  const header = `Section No, Section Code, Function Code, Weight of function (${unitLabel}), Weight of section (${unitLabel})`
  const csvRows: string[] = [header]

  let currentSectionNo = ""

  const sectionHeaderRe =
    /^(?:(\d+)\s+)?((?:Casing|Baseframe)\s+Length\s+[\d.]+\s*(?:in|mm)(?:\s*ch(?:es)?)?)\s*(\d+(?:\.\d+)?)?/i
  const componentRe = /^([A-Za-z][A-Za-z\s-]+?)\s+(\d+(?:\.\d+)?)\s*$/i
  const otherComponentsRe = /^Other\s+components\s+(\d+(?:\.\d+)?)/i

  for (const line of lines) {
    const lower = line.toLowerCase()
    if (lower.includes("section no") || lower.includes("function code")) continue
    if (lower.includes("weight of unit")) continue

    const sectionMatch = line.match(sectionHeaderRe)
    if (sectionMatch) {
      if (sectionMatch[1]) currentSectionNo = sectionMatch[1]
      csvRows.push(
        [
          currentSectionNo,
          sectionMatch[2].trim(),
          "",
          "",
          sectionMatch[3] || "",
        ].join(", ")
      )
      continue
    }

    const otherMatch = line.match(otherComponentsRe)
    if (otherMatch) {
      csvRows.push(
        [currentSectionNo, "Other components", "", "", otherMatch[1]].join(", ")
      )
      continue
    }

    const componentMatch = line.match(componentRe)
    if (componentMatch && !componentMatch[1].toLowerCase().includes("length")) {
      csvRows.push(
        [
          currentSectionNo,
          "",
          componentMatch[1].trim(),
          componentMatch[2],
          "",
        ].join(", ")
      )
    }
  }

  return csvRows.join("\n")
}

function detectWeightUnitFromRows(rows: OCRWord[][]): "kg" | "lbs" {
  for (const row of rows) {
    const text = row.map((w) => w.text).join(" ").toLowerCase()
    if (text.includes("section") && text.includes("weight")) {
      return text.includes("lb") ? "lbs" : "kg"
    }
  }
  return "lbs"
}

function rowsFromBoundingBoxes(words: OCRWord[]): { dataRows: string[][]; weightUnit: "kg" | "lbs" } {
  if (words.length === 0) return { dataRows: [], weightUnit: "lbs" }

  const wordRows = groupWordsIntoRows(words)
  const weightUnit = detectWeightUnitFromRows(wordRows)
  const tableLeft = Math.min(...words.map((w) => w.bbox.x0))
  const tableRight = Math.max(...words.map((w) => w.bbox.x1))
  const boundaries = detectColumnBoundaries(wordRows, tableLeft, tableRight)

  const dataRows: string[][] = []

  for (const row of wordRows) {
    const cols = rowToColumns(row, boundaries)
    if (isHeaderRow(cols) || isSummaryRow(cols)) continue
    if (cols.every((c) => !c)) continue
    dataRows.push(cols)
  }

  return { dataRows, weightUnit }
}

/**
 * Extract text from an image using OCR with table-friendly settings.
 */
export async function extractTextFromImage(
  imageFile: File | Blob,
  onProgress?: (progress: number) => void
): Promise<{ text: string; words: OCRWord[] }> {
  let worker: Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>> | null = null

  try {
    if (onProgress) onProgress(1)

    const Tesseract = await getTesseract()
    const { createWorker, PSM } = Tesseract

    if (onProgress) onProgress(5)

    worker = await createWorker("eng", 1, {
      logger: (m) => {
        if (!onProgress) return
        if (m.status === "loading tesseract core") onProgress(10)
        else if (m.status === "initializing tesseract") onProgress(20)
        else if (m.status === "loading language traineddata") onProgress(30)
        else if (m.status === "initializing api") onProgress(40)
        else if (m.status === "recognizing text") {
          onProgress(40 + Math.round(m.progress * 50))
        }
      },
    })

    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: "1",
    })

    if (onProgress) onProgress(50)

    const recognitionPromise = worker.recognize(imageFile)
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("OCR timeout after 90 seconds")), 90000)
    )

    const { data } = await Promise.race([recognitionPromise, timeoutPromise])

    const words: OCRWord[] = (data.words || []).map((w) => ({
      text: w.text,
      bbox: w.bbox,
      confidence: w.confidence,
    }))

    // Combine line texts when word-level data is sparse
    const lineTexts = (data.lines || []).map((l) => l.text).filter(Boolean)
    const text =
      data.text?.trim() ||
      (lineTexts.length > 0 ? lineTexts.join("\n") : "")

    if (onProgress) onProgress(95)
    return { text, words, lineTexts }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    throw new Error(`OCR failed: ${errorMessage}`)
  } finally {
    if (worker) {
      try {
        await worker.terminate()
      } catch {
        // ignore termination errors
      }
    }
  }
}

/**
 * Full pipeline: preprocess image → OCR → structure → parse.
 */
export async function processWeightTableImage(
  imageFile: File,
  onProgress?: (progress: number) => void
): Promise<OCRWeightTableResult> {
  if (onProgress) onProgress(2)
  const preprocessed = await preprocessImageForOCR(imageFile)

  const { text: rawText, words, lineTexts } = await extractTextFromImage(preprocessed, (p) => {
    if (onProgress) onProgress(5 + Math.round(p * 0.9))
  })

  // Prefer line-joined text for table parsing when available
  const ocrBlob = lineTexts.length > 2 ? lineTexts.join("\n") : rawText

  let dataRows = rowsFromBoundingBoxes(words)
  let formattedTable: string

  if (dataRows.dataRows.length >= 2) {
    formattedTable = buildWeightTableCSV(dataRows.dataRows, dataRows.weightUnit)
  } else {
    formattedTable = parseWeightTableFromText(ocrBlob)
  }

  if (formattedTable.split("\n").length < 3) {
    formattedTable = parseWeightTableFromText(ocrBlob)
  }

  // Don't call parseWeightImportTable here — sheet import uses weightTableParser instead
  if (onProgress) onProgress(100)

  return { formattedTable, importData: { sections: [], components: [] } as WeightImportData, rawText: ocrBlob }
}

/** @deprecated Use processWeightTableImage for structured results */
export async function processImageWithOCR(
  imageFile: File,
  onProgress?: (progress: number) => void
): Promise<string> {
  const result = await processWeightTableImage(imageFile, onProgress)
  return result.formattedTable
}

export { INCH_TO_MM }

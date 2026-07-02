import type { jsPDF } from "jspdf"

export const NOTO_SANS_FAMILY = '"Noto Sans", sans-serif'
export const PDF_FONT_NAME = "NotoSans"

type FontCache = {
  regular?: string
  bold?: string
}

const fontCache: FontCache = {}
let canvasFontsReady: Promise<void> | null = null

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ""
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function loadFontBase64(path: string): Promise<string> {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`Failed to load font: ${path}`)
  }
  return arrayBufferToBase64(await response.arrayBuffer())
}

/** Ensure Noto Sans is available for canvas and SVG text rendering. */
export async function ensureNotoSansForCanvas(): Promise<void> {
  if (canvasFontsReady) return canvasFontsReady

  canvasFontsReady = (async () => {
    await document.fonts.ready

    const checks = [
      document.fonts.check('400 12px "Noto Sans"'),
      document.fonts.check('700 12px "Noto Sans"'),
    ]
    if (checks.every(Boolean)) return

    const [regularData, boldData] = await Promise.all([
      fetch("/fonts/NotoSans-Regular.ttf").then((r) => r.arrayBuffer()),
      fetch("/fonts/NotoSans-Bold.ttf").then((r) => r.arrayBuffer()),
    ])

    const regular = new FontFace("Noto Sans", regularData, { weight: "400", style: "normal" })
    const bold = new FontFace("Noto Sans", boldData, { weight: "700", style: "normal" })

    await Promise.all([regular.load(), bold.load()])
    document.fonts.add(regular)
    document.fonts.add(bold)
    await document.fonts.ready
  })()

  return canvasFontsReady
}

/** Register Noto Sans TTF files with a jsPDF instance. */
export async function registerNotoSansPdfFonts(pdf: jsPDF): Promise<void> {
  if (!fontCache.regular) {
    fontCache.regular = await loadFontBase64("/fonts/NotoSans-Regular.ttf")
    fontCache.bold = await loadFontBase64("/fonts/NotoSans-Bold.ttf")
  }

  pdf.addFileToVFS("NotoSans-Regular.ttf", fontCache.regular)
  pdf.addFileToVFS("NotoSans-Bold.ttf", fontCache.bold!)
  pdf.addFont("NotoSans-Regular.ttf", PDF_FONT_NAME, "normal")
  pdf.addFont("NotoSans-Bold.ttf", PDF_FONT_NAME, "bold")
  pdf.addFont("NotoSans-Regular.ttf", PDF_FONT_NAME, "italic")
  pdf.setFont(PDF_FONT_NAME, "normal")
}

export type PdfFontStyle = "normal" | "bold" | "italic"

export function setPdfFont(pdf: jsPDF, style: PdfFontStyle = "normal"): void {
  pdf.setFont(PDF_FONT_NAME, style)
}

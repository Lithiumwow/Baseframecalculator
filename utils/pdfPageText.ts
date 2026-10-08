/**
 * Read text from each page of a Systemair submittal PDF.
 * These files have a real text layer, in inches or millimetres.
 */

export async function extractPdfPageTexts(data: ArrayBuffer): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf")
  const pdf = await getDocumentProxy(new Uint8Array(data))
  const extracted = await extractText(pdf, { mergePages: false })
  const pages = Array.isArray(extracted.text) ? extracted.text : [extracted.text]
  return pages.map((page) => (Array.isArray(page) ? page.join("\n") : String(page ?? "")))
}

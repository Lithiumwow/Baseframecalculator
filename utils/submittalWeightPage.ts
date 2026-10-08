/**
 * Find the Systemair submittal page that lists section and component weights.
 * That page is usually last, and the same table is published in inches/lb or mm/kg.
 */

export interface SubmittalWeightPage {
  pageNumber: number
  text: string
  unit: "lbs" | "kg" | "unknown"
}

export function findSubmittalWeightPage(pages: string[]): SubmittalWeightPage {
  let best: { pageNumber: number; text: string; score: number } | null = null

  pages.forEach((raw, index) => {
    const text = (raw || "").replace(/\u0000/g, "")
    const lower = text.toLowerCase()
    const casingHits = lower.match(/casing\s+length/g)?.length ?? 0
    let score = casingHits * 30
    if (/weight of unit/.test(lower)) score += 40
    if (/weight of section|weight of function/.test(lower)) score += 20
    if (/baseframe\s+length/.test(lower)) score += 15
    if (/\b(kg|lb|lbs)\b/.test(lower)) score += 5
    // The weights page sits toward the end. A small bonus breaks ties.
    score += (index + 1) * 0.25
    if (casingHits === 0) score = Math.min(score, 12)

    if (!best || score > best.score) {
      best = { pageNumber: index + 1, text, score }
    }
  })

  if (!best || best.score < 50 || !/casing\s+length/i.test(best.text)) {
    throw new Error(
      "Could not find a weights page in this PDF. Look for the page titled Weights, with Casing Length rows, usually at the end of the submittal."
    )
  }

  const lower = best.text.toLowerCase()
  const unit: SubmittalWeightPage["unit"] = /\bkg\b/.test(lower)
    ? "kg"
    : /\blbs?\b/.test(lower)
      ? "lbs"
      : "unknown"

  return { pageNumber: best.pageNumber, text: best.text, unit }
}

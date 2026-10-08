/**
 * SystemairCAD project file (.DVF).
 * Casing sections are article codes GXCS-{size}-0-{lengthMm}-…
 * The file does not store them in airflow order; pair them with the DXF or the weights page for order.
 */

export interface DvfModuleInfo {
  casingLengthsMm: number[]
  baseframeHeightMm: number | null
  baseframeLengthMm: number | null
  articleCodes: string[]
}

function latin1(bytes: Uint8Array): string {
  let text = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    text += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return text
}

export function parseSystemairDvf(bytes: Uint8Array): DvfModuleInfo {
  const text = latin1(bytes)
  const articleCodes = text.match(/GX[A-Z]{1,3}-\d[\w./-]*/g) ?? []
  const casingLengthsMm: number[] = []
  for (const match of text.matchAll(/GXCS-\d+-\d+-(\d+)-/g)) {
    const lengthMm = parseInt(match[1], 10)
    if (lengthMm >= 200 && lengthMm <= 6000) casingLengthsMm.push(lengthMm)
  }
  const base = text.match(/GXZ-\d+-\d+-(\d+)-(\d+)/)
  if (casingLengthsMm.length === 0) {
    throw new Error(
      "This DVF has no GXCS casing sections. Export the unit from SystemairCAD and upload that project file."
    )
  }
  return {
    casingLengthsMm,
    baseframeHeightMm: base ? parseInt(base[1], 10) : null,
    baseframeLengthMm: base ? parseInt(base[2], 10) : null,
    articleCodes,
  }
}

/** Pick the DVF length order that best matches the DXF section lengths. */
export function orderLengthsToDxf(lengthsMm: number[], geometricMm: number[]): number[] {
  if (lengthsMm.length <= 1 || geometricMm.length === 0) return [...lengthsMm]
  if (lengthsMm.length > 7) return [...lengthsMm]

  let best = [...lengthsMm]
  let bestScore = Number.POSITIVE_INFINITY
  const used = new Array(lengthsMm.length).fill(false)
  const current: number[] = []

  const walk = () => {
    if (current.length === lengthsMm.length) {
      let score = Math.abs(lengthsMm.length - geometricMm.length) * 400
      const n = Math.min(current.length, geometricMm.length)
      for (let i = 0; i < n; i++) score += Math.abs(current[i] - geometricMm[i])
      if (score < bestScore) {
        bestScore = score
        best = [...current]
      }
      return
    }
    for (let i = 0; i < lengthsMm.length; i++) {
      if (used[i]) continue
      used[i] = true
      current.push(lengthsMm[i])
      walk()
      current.pop()
      used[i] = false
    }
  }
  walk()
  return best
}

export function sameLengthSet(a: number[], b: number[], toleranceMm = 4): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort((x, y) => x - y)
  const right = [...b].sort((x, y) => x - y)
  return left.every((value, i) => Math.abs(value - right[i]) <= toleranceMm)
}

export function sectionsFromLengthsMm(
  lengthsMm: number[],
  meshLengthMm: number,
  frameWidthMm: number
): import("./weightImport").WeightImportData {
  const sum = lengthsMm.reduce((total, length) => total + length, 0)
  const scale = sum > 0 && Math.abs(meshLengthMm - sum) / sum <= 0.03 ? meshLengthMm / sum : 1
  let cursor = 0
  const sections = lengthsMm.map((lengthMm, index) => {
    const length = Math.round(lengthMm * scale * 10) / 10
    const startPosition = Math.round(cursor * 10) / 10
    cursor += length
    const endPosition =
      index === lengthsMm.length - 1 && scale !== 1
        ? Math.round(meshLengthMm * 10) / 10
        : Math.round(cursor * 10) / 10
    return {
      name: `Section ${index + 1}`,
      startPosition,
      endPosition,
      length: Math.round((endPosition - startPosition) * 10) / 10,
      casingWeight: 0,
      casingWeightUnit: "kg" as const,
      baseframeWeight: 0,
      baseframeWeightUnit: "kg" as const,
      roofWeight: 0,
      roofWeightUnit: "kg" as const,
    }
  })
  return {
    frameDimensions: {
      length: sections[sections.length - 1]?.endPosition ?? meshLengthMm,
      width: frameWidthMm,
      units: "mm",
    },
    sections,
  }
}

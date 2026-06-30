/** Geniox unit types and corresponding frame widths (mm). Pattern: type × 100 + 82 */
export const GENIOX_TYPES = [10, 11, 12, 14, 16, 18, 20, 22, 24, 27, 29, 31, 35, 38, 41] as const

export type GenioxType = (typeof GENIOX_TYPES)[number]

export function getGenioxFrameWidth(type: number): number {
  return type * 100 + 82
}

export function isValidGenioxType(type: number): type is GenioxType {
  return GENIOX_TYPES.includes(type as GenioxType)
}

export function parseGenioxTypeFromText(text: string): GenioxType | null {
  const match = text.match(/geniox\s*(\d{2})/i)
  if (match) {
    const type = parseInt(match[1], 10)
    return isValidGenioxType(type) ? type : null
  }
  return null
}

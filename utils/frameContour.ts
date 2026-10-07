/**
 * Map bending-moment samples along frame length to 0–1 contour intensity.
 */

export interface ContourSample {
  xMm: number
  intensity: number
}

export function buildMomentContour(
  bendingMomentData: Array<{ x: number; y: number | null }>,
  frameLengthMm: number,
  samples: number = 48,
  /** Optional fallback peaks when moment diagram is empty (xMm, relative weight) */
  loadPeaks: Array<{ xMm: number; weight: number }> = []
): ContourSample[] {
  if (frameLengthMm <= 0) return []

  const momentPoints = bendingMomentData.filter(
    (p): p is { x: number; y: number } => p.y != null && Number.isFinite(p.y)
  )
  const maxAbs = momentPoints.reduce((m, p) => Math.max(m, Math.abs(p.y)), 0)
  const useMoment = maxAbs > 0 && momentPoints.length > 0
  const maxPeak = loadPeaks.reduce((m, p) => Math.max(m, p.weight), 0)

  const out: ContourSample[] = []
  for (let i = 0; i < samples; i++) {
    const xMm = (frameLengthMm * i) / (samples - 1)
    let intensity = 0
    if (useMoment) {
      let best = momentPoints[0]
      let bestD = Math.abs(best.x - xMm)
      for (const p of momentPoints) {
        const d = Math.abs(p.x - xMm)
        if (d < bestD) {
          best = p
          bestD = d
        }
      }
      intensity = Math.min(1, Math.abs(best.y) / maxAbs)
    } else if (maxPeak > 0) {
      // Soft falloff from each load/section weight center
      let sum = 0
      const sigma = Math.max(frameLengthMm * 0.08, 80)
      for (const peak of loadPeaks) {
        const dx = (xMm - peak.xMm) / sigma
        sum += (peak.weight / maxPeak) * Math.exp(-dx * dx)
      }
      intensity = Math.min(1, sum)
    }
    out.push({ xMm, intensity })
  }
  return out
}

/** Blue → green → yellow → red */
export function intensityToRgb(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t))
  const stops: Array<[number, [number, number, number]]> = [
    [0, [29, 78, 216]],
    [0.35, [34, 197, 94]],
    [0.65, [234, 179, 8]],
    [1, [239, 68, 68]],
  ]
  let i = 0
  while (i < stops.length - 2 && x > stops[i + 1][0]) i++
  const a = stops[i]
  const b = stops[i + 1]
  const u = (x - a[0]) / (b[0] - a[0] || 1)
  return [
    Math.round(a[1][0] + (b[1][0] - a[1][0]) * u),
    Math.round(a[1][1] + (b[1][1] - a[1][1]) * u),
    Math.round(a[1][2] + (b[1][2] - a[1][2]) * u),
  ]
}

export function rgbCss(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

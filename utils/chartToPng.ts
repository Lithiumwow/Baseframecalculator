import { ensureNotoSansForCanvas, NOTO_SANS_FAMILY } from "./notoFonts"

export interface ChartPoint {
  x: number
  y: number
}

export interface AreaChartRenderOptions {
  width?: number
  height?: number
  xLabel?: string
  yLabel?: string
  color?: string
  fillOpacity?: number
  scale?: number
}

function formatTick(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 10000) return `${(value / 1000).toFixed(0)}k`
  if (abs >= 1000) return `${(value / 1000).toFixed(1)}k`
  if (abs >= 100) return value.toFixed(0)
  if (abs >= 10) return value.toFixed(1)
  if (abs >= 1) return value.toFixed(2)
  return value.toFixed(3)
}

function niceStep(range: number, targetTicks: number): number {
  if (range <= 0) return 1
  const rough = range / targetTicks
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)))
  const normalized = rough / magnitude
  let step = magnitude
  if (normalized <= 1) step = magnitude
  else if (normalized <= 2) step = 2 * magnitude
  else if (normalized <= 5) step = 5 * magnitude
  else step = 10 * magnitude
  return step
}

function buildTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min]
  const step = niceStep(max - min, count)
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 0.001; v += step) {
    ticks.push(Number(v.toFixed(10)))
  }
  if (ticks.length === 0) ticks.push(min, max)
  return ticks
}

/** Render an area chart directly to a PNG data URL (no DOM / Recharts dependency). */
export async function renderAreaChartToPng(
  data: ChartPoint[],
  options: AreaChartRenderOptions = {},
): Promise<string> {
  await ensureNotoSansForCanvas()
  const fontFamily = NOTO_SANS_FAMILY
  const width = options.width ?? 900
  const height = options.height ?? 320
  const scale = options.scale ?? 2
  const color = options.color ?? "#4f46e5"
  const fillOpacity = options.fillOpacity ?? 0.25

  const canvas = document.createElement("canvas")
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not create chart canvas context")

  ctx.scale(scale, scale)
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, width, height)

  const margin = { top: 24, right: 24, bottom: 52, left: 68 }
  const plotW = width - margin.left - margin.right
  const plotH = height - margin.top - margin.bottom

  if (data.length === 0) {
    ctx.fillStyle = "#6b7280"
    ctx.font = `14px ${fontFamily}`
    ctx.textAlign = "center"
    ctx.fillText("No diagram data available", width / 2, height / 2)
    return canvas.toDataURL("image/png", 1)
  }

  const xs = data.map((d) => d.x)
  const ys = data.map((d) => d.y)
  let yMin = Math.min(0, ...ys)
  let yMax = Math.max(0, ...ys)
  if (yMin === yMax) {
    yMin -= 1
    yMax += 1
  }
  const yPad = (yMax - yMin) * 0.08
  yMin -= yPad
  yMax += yPad

  const xMin = xs[0]
  const xMax = xs[xs.length - 1]
  const xRange = xMax - xMin || 1
  const yRange = yMax - yMin || 1

  const toX = (x: number) => margin.left + ((x - xMin) / xRange) * plotW
  const toY = (y: number) => margin.top + plotH - ((y - yMin) / yRange) * plotH

  // Grid + Y ticks
  ctx.strokeStyle = "#e5e7eb"
  ctx.lineWidth = 1
  ctx.fillStyle = "#374151"
  ctx.font = `11px ${fontFamily}`
  ctx.textAlign = "right"
  ctx.textBaseline = "middle"

  for (const tick of buildTicks(yMin, yMax)) {
    const y = toY(tick)
    ctx.beginPath()
    ctx.moveTo(margin.left, y)
    ctx.lineTo(margin.left + plotW, y)
    ctx.stroke()
    ctx.fillText(formatTick(tick), margin.left - 8, y)
  }

  // X ticks
  ctx.textAlign = "center"
  ctx.textBaseline = "top"
  for (const tick of buildTicks(xMin, xMax)) {
    const x = toX(tick)
    ctx.beginPath()
    ctx.moveTo(x, margin.top)
    ctx.lineTo(x, margin.top + plotH)
    ctx.stroke()
    ctx.fillText(formatTick(tick), x, margin.top + plotH + 8)
  }

  // Plot border
  ctx.strokeStyle = "#9ca3af"
  ctx.lineWidth = 1
  ctx.strokeRect(margin.left, margin.top, plotW, plotH)

  // Zero reference line
  if (yMin < 0 && yMax > 0) {
    const zeroY = toY(0)
    ctx.strokeStyle = "#111827"
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(margin.left, zeroY)
    ctx.lineTo(margin.left + plotW, zeroY)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Area fill + line
  ctx.beginPath()
  data.forEach((point, index) => {
    const x = toX(point.x)
    const y = toY(point.y)
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  const baselineY = toY(0)
  ctx.lineTo(toX(data[data.length - 1].x), baselineY)
  ctx.lineTo(toX(data[0].x), baselineY)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.globalAlpha = fillOpacity
  ctx.fill()
  ctx.globalAlpha = 1

  ctx.beginPath()
  data.forEach((point, index) => {
    const x = toX(point.x)
    const y = toY(point.y)
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.stroke()

  // Axis labels
  ctx.fillStyle = "#111827"
  ctx.font = `12px ${fontFamily}`
  if (options.xLabel) {
    ctx.textAlign = "center"
    ctx.textBaseline = "alphabetic"
    ctx.fillText(options.xLabel, margin.left + plotW / 2, height - 10)
  }
  if (options.yLabel) {
    ctx.save()
    ctx.translate(16, margin.top + plotH / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = "center"
    ctx.textBaseline = "alphabetic"
    ctx.fillText(options.yLabel, 0, 0)
    ctx.restore()
  }

  return canvas.toDataURL("image/png", 1)
}

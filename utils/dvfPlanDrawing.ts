/**
 * Dimensioned plan PDF from a SystemairCAD .DVF.
 * Section order should already match the DXF or the weights page.
 * This is a layout built from the module codes, not a plot file from SystemairCAD.
 */

import { getGenioxFrameWidth } from "./genioxDimensions"
import type { DvfModuleInfo } from "./dvfModules"

export interface DvfLengthPart {
  code: string
  label: string
  lengthMm: number
}

export interface DvfPlanModel {
  plantNo: string | null
  genioxSize: number
  widthMm: number
  sectionLengthsMm: number[]
  /** Bays packed into each section, in order. */
  bays: DvfLengthPart[][]
  modules: string[]
}

function latin1(bytes: Uint8Array): string {
  let text = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    text += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return text
}

function labelFor(code: string): string {
  if (code.startsWith("DOOR")) return "Door"
  if (code.startsWith("PANEL")) return "Panel"
  if (code.startsWith("GXI")) return "Inspection"
  if (code.startsWith("GXA")) return "Damper"
  if (code.startsWith("GXF")) return "Filter"
  if (code.startsWith("GXE")) return "Fan"
  if (code.startsWith("GXK")) return "Coil"
  if (code.startsWith("GXZ")) return "Baseframe"
  return code.split("-")[0]
}

export function collectDvfLengthParts(bytes: Uint8Array): DvfLengthPart[] {
  const text = latin1(bytes)
  const parts: DvfLengthPart[] = []
  const add = (code: string, lengthMm: number) => {
    if (lengthMm < 50 || lengthMm > 5000) return
    parts.push({ code, label: labelFor(code), lengthMm })
  }
  for (const match of text.matchAll(/DOOR-\d+-(\d+)-[\d-]+/g)) add(match[0], parseInt(match[1], 10))
  for (const match of text.matchAll(/PANEL-\d+-(\d+)-[\d-]+/g)) add(match[0], parseInt(match[1], 10))
  for (const match of text.matchAll(/GXI-\d+-\d+-(\d+)-[\d-]+/g)) add(match[0], parseInt(match[1], 10))
  return parts
}

function bestSubset(parts: DvfLengthPart[], targetMm: number): DvfLengthPart[] {
  let best: DvfLengthPart[] = []
  let bestDelta = targetMm
  const current: DvfLengthPart[] = []

  const walk = (index: number, sum: number) => {
    const delta = Math.abs(targetMm - sum)
    if (sum > 0 && delta < bestDelta && sum <= targetMm + 80) {
      bestDelta = delta
      best = [...current]
    }
    if (index >= parts.length || sum > targetMm + 80) return
    current.push(parts[index])
    walk(index + 1, sum + parts[index].lengthMm)
    current.pop()
    walk(index + 1, sum)
  }
  walk(0, 0)
  return best
}

export function buildDvfPlanModel(
  bytes: Uint8Array,
  info: DvfModuleInfo,
  sectionLengthsMm: number[],
  genioxSize: number
): DvfPlanModel {
  const text = latin1(bytes)
  const plant = text.match(/GX\d{2}[A-Z0-9]{8,}/)
  let pool = collectDvfLengthParts(bytes)
  const bays: DvfLengthPart[][] = []

  const order = sectionLengthsMm
    .map((lengthMm, index) => ({ lengthMm, index }))
    .sort((a, b) => b.lengthMm - a.lengthMm)

  const assigned: DvfLengthPart[][] = sectionLengthsMm.map(() => [])
  for (const section of order) {
    const chosen = bestSubset(pool, section.lengthMm)
    assigned[section.index] = chosen
    const used = new Set(chosen)
    pool = pool.filter((part) => !used.has(part))
  }

  if (pool.length > 0) {
    let slackIndex = 0
    let slack = -1
    assigned.forEach((bay, index) => {
      const used = bay.reduce((sum, part) => sum + part.lengthMm, 0)
      const room = sectionLengthsMm[index] - used
      if (room > slack) {
        slack = room
        slackIndex = index
      }
    })
    assigned[slackIndex].push(...pool)
  }

  const modules = (text.match(/GX[A-Z]{1,3}-\d[\w./-]*/g) ?? []).filter(
    (code, index, all) => all.indexOf(code) === index && !code.startsWith("GXCS")
  )

  return {
    plantNo: plant ? plant[0] : null,
    genioxSize,
    widthMm: getGenioxFrameWidth(genioxSize),
    sectionLengthsMm,
    bays: assigned,
    modules,
  }
}

export async function downloadDvfPlanPdf(model: DvfPlanModel): Promise<void> {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" })
  const pageW = 420
  const margin = 16
  const total = model.sectionLengthsMm.reduce((sum, length) => sum + length, 0) || 1

  doc.setFont("helvetica", "bold")
  doc.setFontSize(16)
  doc.text(`Geniox ${model.genioxSize} plan`, margin, 16)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.text(
    [
      model.plantNo ? `Plant ${model.plantNo}` : "SystemairCAD DVF",
      `${Math.round(total)} mm × ${Math.round(model.widthMm)} mm`,
      `Baseframe width ${Math.round(model.widthMm)} mm`,
    ].join("   ·   "),
    margin,
    24
  )

  const planX = margin
  const planY = 36
  const planW = pageW - margin * 2
  const planH = 70
  const scale = planW / total

  doc.setDrawColor(30, 41, 59)
  doc.setLineWidth(0.4)
  doc.rect(planX, planY, planW, planH)

  let cursor = 0
  model.sectionLengthsMm.forEach((lengthMm, index) => {
    const x = planX + cursor * scale
    const w = lengthMm * scale
    if (index > 0) {
      doc.setDrawColor(15, 23, 42)
      doc.line(x, planY, x, planY + planH)
    }
    doc.setFont("helvetica", "bold")
    doc.setFontSize(11)
    doc.text(`Section ${index + 1}`, x + w / 2, planY + 10, { align: "center" })
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.text(`${Math.round(lengthMm)} mm`, x + w / 2, planY + 16, { align: "center" })

    let bayCursor = 0
    const bays = model.bays[index] ?? []
    const baySum = bays.reduce((sum, bay) => sum + bay.lengthMm, 0) || 1
    const fit = baySum > lengthMm ? lengthMm / baySum : 1
    for (const bay of bays) {
      const bayLen = bay.lengthMm * fit
      const bx = x + (bayCursor / lengthMm) * w
      const bw = (bayLen / lengthMm) * w
      doc.setDrawColor(100, 116, 139)
      doc.setLineWidth(0.15)
      doc.rect(bx + 1, planY + 22, Math.max(0, bw - 2), planH - 30)
      doc.setFontSize(8)
      doc.text(`${bay.label} ${Math.round(bay.lengthMm)}`, bx + bw / 2, planY + 22 + (planH - 30) / 2, {
        align: "center",
      })
      bayCursor += bayLen
    }

    const dimY = planY + planH + 8
    doc.setDrawColor(30, 41, 59)
    doc.setLineWidth(0.2)
    doc.line(x, dimY, x + w, dimY)
    doc.line(x, dimY - 2, x, dimY + 2)
    doc.line(x + w, dimY - 2, x + w, dimY + 2)
    doc.setFontSize(8)
    doc.text(`${Math.round(lengthMm)}`, x + w / 2, dimY + 5, { align: "center" })
    cursor += lengthMm
  })

  const overallY = planY + planH + 18
  doc.setFontSize(9)
  doc.text(`Overall ${Math.round(total)} mm`, planX + planW / 2, overallY, { align: "center" })
  doc.text(`${Math.round(model.widthMm)} mm`, planX - 2, planY + planH / 2, { align: "center", angle: 90 })

  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.text("Modules in the DVF", margin, overallY + 14)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  const lines = model.modules.length > 0 ? model.modules : ["No extra module codes"]
  const columns = 3
  const colW = (pageW - margin * 2) / columns
  lines.slice(0, 36).forEach((code, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    doc.text(code, margin + col * colW, overallY + 20 + row * 4.5)
  })

  doc.setFontSize(8)
  doc.setTextColor(100)
  doc.text(
    "Plan built from SystemairCAD DVF module codes (GXCS, DOOR, PANEL, GXI). It is not a SystemairCAD plot file.",
    margin,
    290
  )

  const name = model.plantNo ? `${model.plantNo}-plan.pdf` : `geniox-${model.genioxSize}-plan.pdf`
  doc.save(name)
}

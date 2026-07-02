/**
 * Export a session snapshot for debugging — paste into Cursor to review inputs vs outputs.
 */

import type { Section, Load, Results } from "../types"
import type { COGResult } from "./cogCalculation"
import type { WeightAuditBreakdown } from "./weightAudit"

export interface SessionLogPayload {
  exportedAt: string
  app: {
    name: string
    version: string
  }
  inputs: {
    analysisType: string
    genioxType: string
    frameLengthMm: number
    frameWidthMm: number
    beamCrossSection: string
    material: string
    beamProfile: {
      width: number
      height: number
      flangeWidth: number
      flangeThickness: number
      webThickness: number
      diameter: number
      beamDensity: number
    }
    totalRoofWeight: number
    totalRoofWeightUnit: string
    otherComponentsLb: number
    unitTotalLb: number
    sections: Section[]
    loads: Load[]
  }
  weightAudit: WeightAuditBreakdown | null
  outputs: {
    results: Results
    cog: COGResult | null
    cornerReactions: Results["cornerReactions"]
    totalAppliedLoadN: number
  }
  importJson?: string
  notes: string[]
}

export function buildSessionLog(payload: Omit<SessionLogPayload, "exportedAt" | "app">): SessionLogPayload {
  return {
    exportedAt: new Date().toISOString(),
    app: {
      name: "Baseframe Calculator Load App",
      version: "0.1.0",
    },
    ...payload,
  }
}

export function downloadSessionLog(log: SessionLogPayload, filename?: string): void {
  const json = JSON.stringify(log, null, 2)
  const blob = new Blob([json], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const name =
    filename ||
    `baseframe-session-log_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function sessionLogSummary(log: SessionLogPayload): string {
  const wu = log.weightAudit?.weightUnit === "kg" ? "kg" : "lb"
  const lines = [
    `# Baseframe Calculator Session Log`,
    `Exported: ${log.exportedAt}`,
    ``,
    `## Configuration`,
    `- Analysis: ${log.inputs.analysisType}`,
    `- Geniox: ${log.inputs.genioxType}`,
    `- Frame: ${log.inputs.frameLengthMm} × ${log.inputs.frameWidthMm} mm`,
    `- Weight of unit (table): ${log.inputs.unitTotalLb} ${wu}`,
    ``,
  ]

  if (log.weightAudit) {
    const a = log.weightAudit
    lines.push(
      `## Weight balance`,
      `- Table computed: ${a.tableComputedTotal.toFixed(1)} ${wu}`,
      `- App computed: ${a.appComputedTotal.toFixed(1)} ${wu}`,
      `- Unit total: ${a.unitTotal} ${wu}`,
      `- Delta: ${a.delta > 0 ? "+" : ""}${a.delta.toFixed(1)} ${wu}`,
      `- Balanced: ${a.balanced ? "YES" : "NO"}`,
      ...(a.warnings.length > 0 ? a.warnings.map((w) => `- ⚠ ${w}`) : []),
      ``
    )
  }

  lines.push(
    `## Results`,
    `- Total applied load: ${log.outputs.totalAppliedLoadN.toFixed(0)} N`,
    `- Max corner reaction: ${log.outputs.results.cornerReactionForce.toFixed(0)} N`,
    `- R1=${log.outputs.cornerReactions.R1.toFixed(0)} R2=${log.outputs.cornerReactions.R2.toFixed(0)} R3=${log.outputs.cornerReactions.R3.toFixed(0)} R4=${log.outputs.cornerReactions.R4.toFixed(0)} N`,
    `- COG X: ${log.outputs.cog?.cogX.toFixed(0) ?? "—"} mm`,
    `- COG Y: ${log.outputs.cog?.cogY.toFixed(0) ?? "—"} mm`,
    ``,
    `Paste the full JSON file in Cursor for detailed section/load breakdown.`
  )

  return lines.join("\n")
}

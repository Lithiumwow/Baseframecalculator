/**
 * Verify that parsed / applied weights sum to "Weight of unit" from the Systemair table.
 */

import type { Section, Load } from "../types"
import type { ParsedWeightTable } from "./weightTableParser"
import { getDistributedLoadTotalWeightN, nToLbs } from "./conversions"

export interface WeightAuditBreakdown {
  /** Sum of all component rows in the weight table (includes Casing rows) */
  tableComponentLb: number
  tableBaseframeLb: number
  tableOtherLb: number
  tableComputedLb: number
  unitTotalLb: number
  /** From app sections + loads after import */
  appComponentLoadsLb: number
  appCasingLb: number
  appBaseframeLb: number
  appRoofLb: number
  appOtherLb: number
  appComputedLb: number
  deltaLb: number
  deltaPercent: number
  /** Within 1 lb or 0.5% of unit total */
  balanced: boolean
  warnings: string[]
}

const LB_TOLERANCE = 1.5
const PCT_TOLERANCE = 0.005

function toLbs(weight: number, unit: "N" | "kg" | "lbs"): number {
  if (unit === "lbs") return weight
  if (unit === "kg") return weight * 2.20462
  return nToLbs(weight)
}

/** Audit raw parsed weight table against Weight of unit. */
export function auditParsedWeightTable(table: ParsedWeightTable): WeightAuditBreakdown {
  const warnings: string[] = []

  let tableComponentLb = 0
  for (const section of table.casingSections) {
    for (const comp of section.components) {
      tableComponentLb += comp.weightLb
    }
  }

  const tableBaseframeLb = table.baseframeWeightLb
  const tableOtherLb = table.otherComponentsLb
  const tableComputedLb = tableComponentLb + tableBaseframeLb + tableOtherLb
  const unitTotalLb = table.unitTotalLb

  if (unitTotalLb <= 0) {
    warnings.push('No "Weight of unit" found in the weight table.')
  }

  if (table.casingSections.length === 0) {
    warnings.push("No casing sections parsed from the weight table.")
  }

  const deltaLb = tableComputedLb - unitTotalLb
  const deltaPercent = unitTotalLb > 0 ? Math.abs(deltaLb) / unitTotalLb : 0
  const balanced =
    unitTotalLb > 0 &&
    Math.abs(deltaLb) <= LB_TOLERANCE &&
    deltaPercent <= PCT_TOLERANCE

  if (unitTotalLb > 0 && !balanced) {
    warnings.push(
      `Parsed table sum (${tableComputedLb.toFixed(1)} lb) ≠ Weight of unit (${unitTotalLb} lb). Difference: ${deltaLb > 0 ? "+" : ""}${deltaLb.toFixed(1)} lb.`
    )
  }

  return {
    tableComponentLb,
    tableBaseframeLb,
    tableOtherLb,
    tableComputedLb,
    unitTotalLb,
    appComponentLoadsLb: 0,
    appCasingLb: 0,
    appBaseframeLb: 0,
    appRoofLb: 0,
    appOtherLb: 0,
    appComputedLb: 0,
    deltaLb,
    deltaPercent,
    balanced,
    warnings,
  }
}

/** Audit calculator state (sections + loads) against expected unit total. */
export function auditAppWeights(
  sections: Section[],
  loads: Load[],
  options: {
    unitTotalLb: number
    otherComponentsLb: number
    totalRoofWeight: number
    totalRoofWeightUnit: "N" | "kg" | "lbs"
    weightUnit?: "lbs" | "kg"
  }
): WeightAuditBreakdown {
  const warnings: string[] = []
  const weightUnit = options.weightUnit || "lbs"

  let appCasingLb = 0
  let appBaseframeLb = 0
  let appRoofLb = 0

  for (const section of sections) {
    appCasingLb += toLbs(section.casingWeight || 0, section.casingWeightUnit || weightUnit)
    appBaseframeLb += toLbs(
      section.baseframeWeight || 0,
      section.baseframeWeightUnit || weightUnit
    )
    appRoofLb += toLbs(section.roofWeight || 0, section.roofWeightUnit || weightUnit)
  }

  if (options.totalRoofWeight > 0) {
    appRoofLb = toLbs(options.totalRoofWeight, options.totalRoofWeightUnit)
  }

  let appComponentLoadsLb = 0
  for (const load of loads) {
    appComponentLoadsLb += nToLbs(getDistributedLoadTotalWeightN(load))
  }

  const appOtherLb = options.otherComponentsLb
  const appComputedLb =
    appComponentLoadsLb + appCasingLb + appBaseframeLb + appRoofLb + appOtherLb

  const unitTotalLb = options.unitTotalLb
  const deltaLb = appComputedLb - unitTotalLb
  const deltaPercent = unitTotalLb > 0 ? Math.abs(deltaLb) / unitTotalLb : 0
  const balanced =
    unitTotalLb > 0 &&
    Math.abs(deltaLb) <= LB_TOLERANCE &&
    deltaPercent <= PCT_TOLERANCE

  if (unitTotalLb > 0 && !balanced) {
    warnings.push(
      `Calculator total (${appComputedLb.toFixed(1)} lb) ≠ Weight of unit (${unitTotalLb} lb). Difference: ${deltaLb > 0 ? "+" : ""}${deltaLb.toFixed(1)} lb. Check import, missing sections, or duplicate weights.`
    )
  }

  if (appOtherLb <= 0 && unitTotalLb > 0 && Math.abs(appComputedLb - unitTotalLb) > LB_TOLERANCE) {
    const gap = unitTotalLb - appComputedLb
    if (gap > 0 && gap < 500) {
      warnings.push(
        `Calculator total is ${gap.toFixed(0)} lb short of Weight of unit — check "Other components" and baseframe rows.`
      )
    }
  }

  return {
    tableComponentLb: 0,
    tableBaseframeLb: 0,
    tableOtherLb: 0,
    tableComputedLb: 0,
    unitTotalLb,
    appComponentLoadsLb,
    appCasingLb,
    appBaseframeLb,
    appRoofLb,
    appOtherLb,
    appComputedLb,
    deltaLb,
    deltaPercent,
    balanced,
    warnings,
  }
}

/** Merge table audit + app audit for display. */
export function mergeWeightAudits(
  tableAudit: WeightAuditBreakdown,
  appAudit: WeightAuditBreakdown
): WeightAuditBreakdown {
  return {
    ...tableAudit,
    appComponentLoadsLb: appAudit.appComponentLoadsLb,
    appCasingLb: appAudit.appCasingLb,
    appBaseframeLb: appAudit.appBaseframeLb,
    appRoofLb: appAudit.appRoofLb,
    appOtherLb: appAudit.appOtherLb,
    appComputedLb: appAudit.appComputedLb,
    deltaLb: appAudit.deltaLb,
    deltaPercent: appAudit.deltaPercent,
    balanced: tableAudit.balanced && appAudit.balanced,
    warnings: [...new Set([...tableAudit.warnings, ...appAudit.warnings])],
  }
}

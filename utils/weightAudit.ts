/**
 * Verify that parsed / applied weights sum to "Weight of unit" from the Systemair table.
 */

import type { Section, Load } from "../types"
import type { ParsedWeightTable } from "./weightTableParser"
import { getDistributedLoadTotalWeightN } from "./conversions"

export interface WeightAuditBreakdown {
  weightUnit: "kg" | "lbs"
  tableComponentTotal: number
  tableBaseframeTotal: number
  tableOtherTotal: number
  tableComputedTotal: number
  unitTotal: number
  appComponentLoadsTotal: number
  appCasingTotal: number
  appBaseframeTotal: number
  appRoofTotal: number
  appOtherTotal: number
  appComputedTotal: number
  delta: number
  deltaPercent: number
  balanced: boolean
  warnings: string[]
  /** Legacy fields (converted to lb for old UI paths) */
  tableComponentLb: number
  tableBaseframeLb: number
  tableOtherLb: number
  tableComputedLb: number
  unitTotalLb: number
  appComponentLoadsLb: number
  appCasingLb: number
  appBaseframeLb: number
  appRoofLb: number
  appOtherLb: number
  appComputedLb: number
  deltaLb: number
}

const TOLERANCE_KG = 1.5
const TOLERANCE_LB = 1.5
const PCT_TOLERANCE = 0.005

function nToKg(n: number): number {
  return n / 9.81
}

function toNativeWeight(
  weight: number,
  unit: "N" | "kg" | "lbs",
  nativeUnit: "kg" | "lbs"
): number {
  if (nativeUnit === "kg") {
    if (unit === "kg") return weight
    if (unit === "lbs") return weight / 2.20462
    return nToKg(weight)
  }
  if (unit === "lbs") return weight
  if (unit === "kg") return weight * 2.20462
  return weight * 0.224809
}

function withLegacyFields(
  audit: Omit<
    WeightAuditBreakdown,
    | "tableComponentLb"
    | "tableBaseframeLb"
    | "tableOtherLb"
    | "tableComputedLb"
    | "unitTotalLb"
    | "appComponentLoadsLb"
    | "appCasingLb"
    | "appBaseframeLb"
    | "appRoofLb"
    | "appOtherLb"
    | "appComputedLb"
    | "deltaLb"
  >,
  unit: "kg" | "lbs"
): WeightAuditBreakdown {
  const toLb = (v: number) => (unit === "kg" ? v * 2.20462 : v)
  return {
    ...audit,
    tableComponentLb: toLb(audit.tableComponentTotal),
    tableBaseframeLb: toLb(audit.tableBaseframeTotal),
    tableOtherLb: toLb(audit.tableOtherTotal),
    tableComputedLb: toLb(audit.tableComputedTotal),
    unitTotalLb: toLb(audit.unitTotal),
    appComponentLoadsLb: toLb(audit.appComponentLoadsTotal),
    appCasingLb: toLb(audit.appCasingTotal),
    appBaseframeLb: toLb(audit.appBaseframeTotal),
    appRoofLb: toLb(audit.appRoofTotal),
    appOtherLb: toLb(audit.appOtherTotal),
    appComputedLb: toLb(audit.appComputedTotal),
    deltaLb: toLb(audit.delta),
  }
}

function unitLabel(unit: "kg" | "lbs"): string {
  return unit === "kg" ? "kg" : "lb"
}

export function auditParsedWeightTable(table: ParsedWeightTable): WeightAuditBreakdown {
  const warnings: string[] = []
  const weightUnit = table.weightUnit

  let tableComponentTotal = 0
  for (const section of table.casingSections) {
    for (const comp of section.components) {
      tableComponentTotal += comp.weightLb
    }
  }

  const tableBaseframeTotal = table.baseframeWeightLb
  const tableOtherTotal = table.otherComponentsLb
  const tableComputedTotal = tableComponentTotal + tableBaseframeTotal + tableOtherTotal
  const unitTotal = table.unitTotalLb

  if (unitTotal <= 0) {
    warnings.push('No "Weight of unit" found in the weight table.')
  }

  if (table.casingSections.length === 0) {
    warnings.push("No casing sections parsed from the weight table.")
  }

  const delta = tableComputedTotal - unitTotal
  const deltaPercent = unitTotal > 0 ? Math.abs(delta) / unitTotal : 0
  const tol = weightUnit === "kg" ? TOLERANCE_KG : TOLERANCE_LB
  const balanced =
    unitTotal > 0 && Math.abs(delta) <= tol && deltaPercent <= PCT_TOLERANCE

  if (unitTotal > 0 && !balanced) {
    warnings.push(
      `Parsed table sum (${tableComputedTotal.toFixed(1)} ${unitLabel(weightUnit)}) ≠ Weight of unit (${unitTotal} ${unitLabel(weightUnit)}). Difference: ${delta > 0 ? "+" : ""}${delta.toFixed(1)} ${unitLabel(weightUnit)}.`
    )
  }

  return withLegacyFields(
    {
      weightUnit,
      tableComponentTotal,
      tableBaseframeTotal,
      tableOtherTotal,
      tableComputedTotal,
      unitTotal,
      appComponentLoadsTotal: 0,
      appCasingTotal: 0,
      appBaseframeTotal: 0,
      appRoofTotal: 0,
      appOtherTotal: 0,
      appComputedTotal: 0,
      delta,
      deltaPercent,
      balanced,
      warnings,
    },
    weightUnit
  )
}

export function auditAppWeights(
  sections: Section[],
  loads: Load[],
  options: {
    unitTotal: number
    otherComponents: number
    totalRoofWeight: number
    totalRoofWeightUnit: "N" | "kg" | "lbs"
    weightUnit: "lbs" | "kg"
  }
): WeightAuditBreakdown {
  const warnings: string[] = []
  const weightUnit = options.weightUnit

  let appCasingTotal = 0
  let appBaseframeTotal = 0
  let appRoofTotal = 0

  for (const section of sections) {
    appCasingTotal += toNativeWeight(
      section.casingWeight || 0,
      section.casingWeightUnit || weightUnit,
      weightUnit
    )
    appBaseframeTotal += toNativeWeight(
      section.baseframeWeight || 0,
      section.baseframeWeightUnit || weightUnit,
      weightUnit
    )
    appRoofTotal += toNativeWeight(
      section.roofWeight || 0,
      section.roofWeightUnit || weightUnit,
      weightUnit
    )
  }

  if (options.totalRoofWeight > 0) {
    appRoofTotal = toNativeWeight(options.totalRoofWeight, options.totalRoofWeightUnit, weightUnit)
  }

  let appComponentLoadsTotal = 0
  for (const load of loads) {
    appComponentLoadsTotal += toNativeWeight(
      getDistributedLoadTotalWeightN(load),
      "N",
      weightUnit
    )
  }

  const appOtherTotal = options.otherComponents
  const appComputedTotal =
    appComponentLoadsTotal + appCasingTotal + appBaseframeTotal + appRoofTotal + appOtherTotal

  const unitTotal = options.unitTotal
  const delta = appComputedTotal - unitTotal
  const deltaPercent = unitTotal > 0 ? Math.abs(delta) / unitTotal : 0
  const tol = weightUnit === "kg" ? TOLERANCE_KG : TOLERANCE_LB
  const balanced = unitTotal > 0 && Math.abs(delta) <= tol && deltaPercent <= PCT_TOLERANCE

  if (unitTotal > 0 && !balanced) {
    warnings.push(
      `Calculator total (${appComputedTotal.toFixed(1)} ${unitLabel(weightUnit)}) ≠ Weight of unit (${unitTotal} ${unitLabel(weightUnit)}). Difference: ${delta > 0 ? "+" : ""}${delta.toFixed(1)} ${unitLabel(weightUnit)}. Check import, missing sections, or duplicate weights.`
    )
  }

  return withLegacyFields(
    {
      weightUnit,
      tableComponentTotal: 0,
      tableBaseframeTotal: 0,
      tableOtherTotal: 0,
      tableComputedTotal: 0,
      unitTotal,
      appComponentLoadsTotal,
      appCasingTotal,
      appBaseframeTotal,
      appRoofTotal,
      appOtherTotal,
      appComputedTotal,
      delta,
      deltaPercent,
      balanced,
      warnings,
    },
    weightUnit
  )
}

export function mergeWeightAudits(
  tableAudit: WeightAuditBreakdown,
  appAudit: WeightAuditBreakdown
): WeightAuditBreakdown {
  return withLegacyFields(
    {
      weightUnit: tableAudit.weightUnit || appAudit.weightUnit,
      tableComponentTotal: tableAudit.tableComponentTotal,
      tableBaseframeTotal: tableAudit.tableBaseframeTotal,
      tableOtherTotal: tableAudit.tableOtherTotal,
      tableComputedTotal: tableAudit.tableComputedTotal,
      unitTotal: tableAudit.unitTotal || appAudit.unitTotal,
      appComponentLoadsTotal: appAudit.appComponentLoadsTotal,
      appCasingTotal: appAudit.appCasingTotal,
      appBaseframeTotal: appAudit.appBaseframeTotal,
      appRoofTotal: appAudit.appRoofTotal,
      appOtherTotal: appAudit.appOtherTotal,
      appComputedTotal: appAudit.appComputedTotal,
      delta: appAudit.delta,
      deltaPercent: appAudit.deltaPercent,
      balanced: tableAudit.balanced && appAudit.balanced,
      warnings: [...new Set([...tableAudit.warnings, ...appAudit.warnings])],
    },
    tableAudit.weightUnit || appAudit.weightUnit
  )
}

/** Layout bay chain matches weight-table casing lengths within tolerance. */
export function layoutBaySumMatchesTable(
  layoutSegments: Array<{ lengthIn: number }>,
  casingLengthsIn: number[],
  toleranceRatio = 0.05
): boolean {
  const layoutSumMm = layoutSegments.reduce((s, seg) => s + seg.lengthIn * 25.4, 0)
  const tableSumMm = casingLengthsIn.reduce((s, len) => s + len * 25.4, 0)
  if (tableSumMm <= 0 || layoutSumMm <= 0) return false
  return Math.abs(layoutSumMm - tableSumMm) / tableSumMm <= toleranceRatio
}

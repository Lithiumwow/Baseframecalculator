"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Upload, FileText, AlertCircle, CheckCircle, Download, Image as ImageIcon, Loader2 } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { Section, Load } from "../types"
import {
  parseWeightImportJSON,
  parseWeightImportCSV,
  parseWeightImportTable,
  convertImportedSections,
  convertImportedComponents,
  generateLoadsFromTotalWeights,
  createWeightImportTemplate,
  type WeightImportData,
} from "../utils/weightImport"
import { importSystemairWeightText, processWeightSheets, processWeightTablePaste, type COGResult } from "../utils/weightSheetImport"
import { isSystemairWeightTableText } from "../utils/weightTableParser"
import { calculateCOG, buildCOGItemsFromImport } from "../utils/cogCalculation"
import type { WeightAuditBreakdown } from "../utils/weightAudit"
import { parseDxfSections, readDxfFile } from "../utils/dxfSectionImport"
import { extractDxfMesh, type DxfCasingMesh } from "../utils/dxfMeshExtract"
import { extractPdfPageTexts } from "../utils/pdfPageText"
import { findSubmittalWeightPage } from "../utils/submittalWeightPage"
import {
  orderLengthsToDxf,
  parseSystemairDvf,
  sameLengthSet,
  sectionsFromLengthsMm,
} from "../utils/dvfModules"
import { buildDvfPlanModel, downloadDvfPlanPdf } from "../utils/dvfPlanDrawing"

export interface WeightImportResult {
  sections: Section[]
  loads: Load[]
  frameLength?: number
  frameWidth?: number
  genioxType?: string
  totalRoofWeight?: number
  totalRoofWeightUnit?: "N" | "kg" | "lbs"
  cog?: COGResult
  importJson?: string
  unitTotalLb?: number
  otherComponentsLb?: number
  weightAudit?: WeightAuditBreakdown
  warnings?: string[]
  /** Triangle mesh from DXF 3DFACE entities for the 3D casing view */
  casingMesh?: DxfCasingMesh | null
}

interface WeightImportDialogProps {
  onImport: (result: WeightImportResult) => void
  frameLength: number
  frameWidth: number
  genioxType: string
}

export function WeightImportDialog({
  onImport,
  frameLength,
  frameWidth,
  genioxType,
}: WeightImportDialogProps) {
  const [open, setOpen] = useState(false)
  const [importText, setImportText] = useState("")
  const [importType, setImportType] = useState<"json" | "csv" | "table" | "ocr" | "dxf">("ocr")
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<WeightImportResult | null>(null)
  const [isProcessingOCR, setIsProcessingOCR] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrStage, setOcrStage] = useState("")
  const [layoutImage, setLayoutImage] = useState<File | null>(null)
  const [weightsImage, setWeightsImage] = useState<File | null>(null)
  const [pastedWeightText, setPastedWeightText] = useState("")
  const [dxfFileName, setDxfFileName] = useState<string | null>(null)
  const [dxfText, setDxfText] = useState<string | null>(null)
  const [submittalName, setSubmittalName] = useState<string | null>(null)
  const [submittalWeightText, setSubmittalWeightText] = useState<string | null>(null)
  const [submittalPageLabel, setSubmittalPageLabel] = useState<string | null>(null)
  const [dvfName, setDvfName] = useState<string | null>(null)
  const [dvfBytes, setDvfBytes] = useState<Uint8Array | null>(null)
  const [pendingDxfMesh, setPendingDxfMesh] = useState<DxfCasingMesh | null>(null)

  const resetImportForm = () => {
    setImportText("")
    setImportType("ocr")
    setError(null)
    setPreview(null)
    setIsProcessingOCR(false)
    setOcrProgress(0)
    setOcrStage("")
    setLayoutImage(null)
    setWeightsImage(null)
    setPastedWeightText("")
    setDxfFileName(null)
    setDxfText(null)
    setSubmittalName(null)
    setSubmittalWeightText(null)
    setSubmittalPageLabel(null)
    setDvfName(null)
    setDvfBytes(null)
    setPendingDxfMesh(null)
  }

  useEffect(() => {
    if (open) {
      resetImportForm()
    }
  }, [open])

  const buildPreviewFromImportData = (
    importData: WeightImportData,
    cog?: COGResult
  ): WeightImportResult => {
    const effectiveFrameLength = importData.frameDimensions?.length || frameLength
    const effectiveFrameWidth = importData.frameDimensions?.width || frameWidth

    const sections = importData.sections
      ? convertImportedSections(importData.sections, effectiveFrameLength)
      : []

    const loads = importData.components
      ? convertImportedComponents(importData.components, sections, effectiveFrameWidth)
      : []

    let finalSections = sections
    let finalLoads = loads

    if (importData.totalWeights) {
      const sectionsAlreadyHaveBaseframe = sections.some(
        (s) => (s.baseframeWeight || 0) > 0
      )
      const { sections: updatedSections, loads: additionalLoads } = generateLoadsFromTotalWeights(
        importData.totalWeights.roof || 0,
        sectionsAlreadyHaveBaseframe ? 0 : importData.totalWeights.baseframe || 0,
        effectiveFrameLength,
        effectiveFrameWidth,
        sections,
        importData.totalWeights.unit || "kg"
      )
      finalSections = updatedSections
      finalLoads = [...loads, ...additionalLoads]
    }

    const computedCog =
      cog ||
      calculateCOG(
        buildCOGItemsFromImport(
          finalSections,
          finalLoads,
          effectiveFrameWidth,
          importData.totalWeights?.roof,
          importData.totalWeights?.unit,
          importData.totalWeights?.otherComponents
        ),
        effectiveFrameLength,
        effectiveFrameWidth,
        importData.totalWeights?.unit || "lbs"
      )

    return {
      sections: finalSections,
      loads: finalLoads,
      frameLength: effectiveFrameLength,
      frameWidth: effectiveFrameWidth,
      totalRoofWeight: importData.totalWeights?.roof ?? 0,
      totalRoofWeightUnit: importData.totalWeights?.unit,
      cog: computedCog,
      importJson: JSON.stringify(importData, null, 2),
    }
  }

  const handleSheetImport = async () => {
    if (!layoutImage) {
      setError("Please upload the layout drawing.")
      return
    }

    const weightText =
      pastedWeightText.trim() ||
      (isSystemairWeightTableText(importText) ? importText.trim() : "")

    if (!weightText && !weightsImage) {
      setError("Upload a weights table screenshot or paste the weight table text below.")
      return
    }

    setIsProcessingOCR(true)
    setOcrProgress(0)
    setError(null)
    setPreview(null)

    try {
      const result = weightText
        ? await processWeightTablePaste(
            weightText,
            parseInt(genioxType, 10),
            layoutImage,
            (stage, progress) => {
              setOcrStage(stage)
              setOcrProgress(progress)
            }
          )
        : await processWeightSheets(
            layoutImage,
            weightsImage!,
            parseInt(genioxType, 10),
            (stage, progress) => {
              setOcrStage(stage)
              setOcrProgress(progress)
            }
          )

      setImportText(result.json)
      setPreview({
        sections: result.sections,
        loads: result.loads,
        frameLength: result.frameLength,
        frameWidth: result.frameWidth,
        totalRoofWeight: result.totalRoofWeight,
        totalRoofWeightUnit: result.totalRoofWeightUnit,
        cog: result.cog,
        importJson: result.json,
        unitTotalLb: result.unitTotalLb,
        otherComponentsLb: result.otherComponentsLb,
        weightAudit: result.weightAudit,
      })
      setError(null)
    } catch (err) {
      console.error("Sheet import error:", err)
      const errorMessage = err instanceof Error ? err.message : "Failed to process sheets"
      setError(errorMessage)
      setPreview(null)
    } finally {
      setIsProcessingOCR(false)
      setOcrStage("")
    }
  }

  const composeUnitImport = async (
    dxf: string,
    fileName: string | undefined,
    weightText: string | null,
    dvf: Uint8Array | null
  ) => {
    const parsed = parseDxfSections(dxf)
    const mesh = extractDxfMesh(dxf, fileName)
    if (mesh) {
      mesh.frameOriginXMm = parsed.frameOriginXMm
      mesh.frameCenterYMm = (mesh.bounds.minY + mesh.bounds.maxY) / 2
    }
    setPendingDxfMesh(mesh)
    const meshLen = mesh ? mesh.bounds.maxX - mesh.bounds.minX : parsed.frameLengthMm
    const geometric = parsed.sections.map(
      (section) => section.length || section.endPosition - section.startPosition
    )
    const warnings = [...(parsed.warnings || [])]
    if (mesh) {
      warnings.push(
        `Casing mesh ready for 3D view: ${mesh.triangleCount.toLocaleString()} triangles (includes baseframe — parametric beams hidden).`
      )
    }

    let dvfInfo: ReturnType<typeof parseSystemairDvf> | null = null
    if (dvf) {
      dvfInfo = parseSystemairDvf(dvf)
      warnings.push(
        `DVF casing modules: ${dvfInfo.casingLengthsMm.join(" + ")} mm` +
          (dvfInfo.baseframeHeightMm != null
            ? `, baseframe height ${dvfInfo.baseframeHeightMm} mm`
            : "") +
          "."
      )
    }

    const geniox = parsed.genioxType ?? parseInt(genioxType, 10)

    if (weightText) {
      const result = await importSystemairWeightText(weightText, geniox, meshLen)
      const pdfMm = (result.importData.sections || []).map((section) =>
        Math.round(section.length || 0)
      )
      if (dvfInfo) {
        warnings.push(
          sameLengthSet(pdfMm, dvfInfo.casingLengthsMm)
            ? "PDF section lengths match the DVF casing modules."
            : `PDF lengths (${pdfMm.join(", ")} mm) differ from the DVF modules (${dvfInfo.casingLengthsMm.join(", ")} mm). The PDF order is used.`
        )
      }
      const previewResult = buildPreviewFromImportData(result.importData, result.cog)
      previewResult.sections = result.sections
      previewResult.loads = result.loads
      previewResult.frameLength = result.frameLength
      previewResult.frameWidth = result.frameWidth
      previewResult.unitTotalLb = result.unitTotalLb
      previewResult.otherComponentsLb = result.otherComponentsLb
      previewResult.weightAudit = result.weightAudit
      previewResult.casingMesh = mesh
      previewResult.genioxType = String(geniox)
      previewResult.warnings = warnings
      previewResult.importJson = result.json
      setImportText(result.json)
      setPreview(previewResult)
      return
    }

    if (dvfInfo) {
      const ordered = orderLengthsToDxf(dvfInfo.casingLengthsMm, geometric)
      const importData = sectionsFromLengthsMm(ordered, meshLen, parsed.frameWidthMm)
      warnings.push(`Section order matched to the DXF: ${ordered.join(" + ")} mm.`)
      const previewResult = buildPreviewFromImportData(importData)
      previewResult.casingMesh = mesh
      previewResult.genioxType = parsed.genioxType != null ? String(parsed.genioxType) : undefined
      previewResult.warnings = warnings
      previewResult.loads = []
      const json = JSON.stringify(importData, null, 2)
      previewResult.importJson = json
      setImportText(json)
      setPreview(previewResult)
      return
    }

    const previewResult = buildPreviewFromImportData(parsed.importData)
    previewResult.genioxType = parsed.genioxType != null ? String(parsed.genioxType) : undefined
    previewResult.warnings = warnings
    previewResult.loads = []
    previewResult.casingMesh = mesh
    const json = JSON.stringify(parsed.importData, null, 2)
    previewResult.importJson = json
    setImportText(json)
    setPreview(previewResult)
  }

  const handleDxfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      setError(null)
      setPreview(null)
      setPendingDxfMesh(null)
      setIsProcessingOCR(true)
      setOcrStage("Reading DXF...")
      setDxfFileName(file.name)
      const text = await readDxfFile(file)
      setDxfText(text)
      setOcrStage("Matching sections...")
      await composeUnitImport(text, file.name, submittalWeightText, dvfBytes)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse DXF")
      setPreview(null)
      setPendingDxfMesh(null)
    } finally {
      setIsProcessingOCR(false)
      setOcrStage("")
    }
  }

  const handleSubmittalPdf = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      setError(null)
      setIsProcessingOCR(true)
      setOcrStage("Reading submittal PDF...")
      const pages = await extractPdfPageTexts(await file.arrayBuffer())
      const page = findSubmittalWeightPage(pages)
      const label = `Weights page ${page.pageNumber} of ${pages.length} (${page.unit === "kg" ? "mm, kg" : page.unit === "lbs" ? "in, lb" : page.unit})`
      setSubmittalName(file.name)
      setSubmittalWeightText(page.text)
      setSubmittalPageLabel(label)
      if (!dxfText) {
        setError(null)
        return
      }
      setOcrStage("Applying weights to DXF sections...")
      setPreview(null)
      await composeUnitImport(dxfText, dxfFileName ?? undefined, page.text, dvfBytes)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read the submittal PDF")
    } finally {
      setIsProcessingOCR(false)
      setOcrStage("")
    }
  }

  const handleDownloadDvfPlan = async () => {
    if (!dvfBytes) return
    try {
      setError(null)
      const info = parseSystemairDvf(dvfBytes)
      const geometric =
        preview?.sections.map((section) => section.endPosition - section.startPosition) ??
        (dxfText
          ? parseDxfSections(dxfText).sections.map((section) => section.length)
          : info.casingLengthsMm)
      const ordered = orderLengthsToDxf(info.casingLengthsMm, geometric)
      const sizeCode = info.articleCodes.find((code) => code.startsWith("GXCS-"))
      const geniox = sizeCode ? parseInt(sizeCode.split("-")[1], 10) : parseInt(genioxType, 10) || 10
      const model = buildDvfPlanModel(dvfBytes, info, ordered, geniox)
      await downloadDvfPlanPdf(model)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build the plan drawing")
    }
  }

  const handleDvfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      setError(null)
      setIsProcessingOCR(true)
      setOcrStage("Reading SystemairCAD DVF...")
      const bytes = new Uint8Array(await file.arrayBuffer())
      parseSystemairDvf(bytes)
      setDvfName(file.name)
      setDvfBytes(bytes)
      if (!dxfText) return
      setPreview(null)
      await composeUnitImport(dxfText, dxfFileName ?? undefined, submittalWeightText, bytes)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read the DVF")
      setDvfBytes(null)
      setDvfName(null)
    } finally {
      setIsProcessingOCR(false)
      setOcrStage("")
    }
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.type.startsWith("image/")) {
      setError("For OCR, use the Layout and Weights upload fields below.")
      return
    }

    if (importType === "dxf" || file.name.toLowerCase().endsWith(".dxf")) {
      await handleDxfUpload(event)
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setImportText(text)
      setError(null)
      setPreview(null)
    }
    reader.readAsText(file)
  }

  const handleParse = async () => {
    try {
      setError(null)

      if (importType === "dxf") {
        if (!importText.trim()) {
          setError("Upload a .dxf file first")
          return
        }
        // importText holds generated JSON after DXF upload; re-parse that JSON
        try {
          const importData = parseWeightImportJSON(importText)
          const result = buildPreviewFromImportData(importData)
          result.loads = []
          result.casingMesh = pendingDxfMesh
          result.warnings = [
            "DXF import creates empty casing sections (geometry only). Import a weight table afterward for loads.",
          ]
          if (pendingDxfMesh) {
            result.warnings.push(
              `Casing mesh ready for 3D view: ${pendingDxfMesh.triangleCount.toLocaleString()} triangles.`
            )
          }
          setPreview(result)
        } catch {
          setPreview(buildPreviewFromDxf(importText, dxfFileName || undefined))
        }
        return
      }

      if (
        (importType === "table" || importType === "ocr") &&
        isSystemairWeightTableText(importText)
      ) {
        setIsProcessingOCR(true)
        setPreview(null)
        const result = await processWeightTablePaste(
          importText.trim(),
          parseInt(genioxType, 10),
          layoutImage,
          (stage, progress) => {
            setOcrStage(stage)
            setOcrProgress(progress)
          }
        )
        setImportText(result.json)
        setPreview({
          sections: result.sections,
          loads: result.loads,
          frameLength: result.frameLength,
          frameWidth: result.frameWidth,
          totalRoofWeight: result.totalRoofWeight,
          totalRoofWeightUnit: result.totalRoofWeightUnit,
          cog: result.cog,
          importJson: result.json,
          unitTotalLb: result.unitTotalLb,
          otherComponentsLb: result.otherComponentsLb,
          weightAudit: result.weightAudit,
        })
        return
      }

      let importData: WeightImportData

      if (importType === "json" || importType === "ocr") {
        importData = parseWeightImportJSON(importText)
      } else if (importType === "csv") {
        importData = parseWeightImportCSV(importText)
      } else {
        importData = parseWeightImportTable(importText)
      }

      setPreview(buildPreviewFromImportData(importData))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse import data")
      setPreview(null)
    } finally {
      setIsProcessingOCR(false)
      setOcrStage("")
    }
  }

  const handleApply = () => {
    if (preview) {
      onImport({
        ...preview,
        casingMesh: preview.casingMesh ?? pendingDxfMesh ?? null,
      })
      setOpen(false)
      setImportText("")
      setPreview(null)
      setPendingDxfMesh(null)
      setError(null)
      setLayoutImage(null)
      setWeightsImage(null)
      setPastedWeightText("")
    }
  }

  const handleDownloadTemplate = () => {
    const template = createWeightImportTemplate()
    const blob = new Blob([template], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "weight_import_template.json"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="flex items-center gap-2">
          <Upload className="w-4 h-4" />
          Import Weights
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Weight Information</DialogTitle>
          <DialogDescription>
            Upload layout and weights sheets to auto-fill frame dimensions, sections, component loads, and COG.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Label>Format:</Label>
            {(["json", "csv", "table", "ocr", "dxf"] as const).map((type) => (
              <Button
                key={type}
                variant={importType === type ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setImportType(type)
                  setImportText("")
                  setPreview(null)
                  setError(null)
                  setDxfFileName(null)
                }}
                className={type === "ocr" || type === "dxf" ? "flex items-center gap-1" : undefined}
              >
                {type === "ocr" && <ImageIcon className="w-4 h-4" />}
                {type === "ocr" ? "OCR Sheets" : type === "dxf" ? "DXF" : type.toUpperCase()}
              </Button>
            ))}
            <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="ml-auto">
              <Download className="w-4 h-4 mr-2" />
              Template
            </Button>
          </div>

          {importType === "dxf" && (
            <div className="space-y-4 border rounded-lg p-4 bg-gray-50">
              <p className="text-xs text-muted-foreground">
                Upload the DXF for the 3D casing. Add the SystemairCAD DVF for the real casing-module
                lengths, and the submittal PDF for weights. The weights page is found automatically, in
                inches or millimetres.
              </p>
              <div>
                <Label htmlFor="dxf-upload">DXF file</Label>
                <input
                  id="dxf-upload"
                  type="file"
                  accept=".dxf,image/vnd.dxf,application/dxf,text/plain"
                  onChange={handleDxfUpload}
                  className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {dxfFileName && (
                  <p className="text-xs text-green-600 mt-1">✓ {dxfFileName}</p>
                )}
              </div>
              <div>
                <Label htmlFor="dvf-upload">SystemairCAD DVF (module lengths)</Label>
                <input
                  id="dvf-upload"
                  type="file"
                  accept=".dvf,.DVF,application/octet-stream"
                  onChange={handleDvfUpload}
                  className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {dvfName && <p className="text-xs text-green-600 mt-1">✓ {dvfName}</p>}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={!dvfBytes}
                  onClick={handleDownloadDvfPlan}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download plan from DVF
                </Button>
              </div>
              <div>
                <Label htmlFor="submittal-pdf">Submittal PDF (weights page)</Label>
                <input
                  id="submittal-pdf"
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleSubmittalPdf}
                  className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {submittalName && (
                  <p className="text-xs text-green-600 mt-1">
                    ✓ {submittalName}
                    {submittalPageLabel ? ` — ${submittalPageLabel}` : ""}
                  </p>
                )}
              </div>
              {isProcessingOCR && (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {ocrStage || "Parsing DXF..."}
                </p>
              )}
            </div>
          )}

          {importType === "ocr" && (
            <div className="space-y-4 border rounded-lg p-4 bg-gray-50">
              <p className="text-xs text-muted-foreground">
                Geniox unit type is set in Configuration (frame width updates automatically).
              </p>
              <div>
                <Label htmlFor="layout-upload">1. Layout Drawing (dimensions &amp; sections)</Label>
                <input
                  id="layout-upload"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setLayoutImage(e.target.files?.[0] || null)}
                  className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {layoutImage && (
                  <p className="text-xs text-green-600 mt-1">✓ {layoutImage.name}</p>
                )}
              </div>

              <div>
                <Label htmlFor="weights-upload">2. Weights Table (screenshot or paste below)</Label>
                <input
                  id="weights-upload"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setWeightsImage(e.target.files?.[0] || null)}
                  className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {weightsImage && (
                  <p className="text-xs text-green-600 mt-1">✓ {weightsImage.name}</p>
                )}
              </div>

              <div>
                <Label htmlFor="pasted-weights">Or paste weight table text (recommended)</Label>
                <Textarea
                  id="pasted-weights"
                  placeholder={`Weights
Section No Section Code Weight of function Weight of section
Function Code lb lb
1 Casing Length 37.0 in 357
Casing 241
Filter 38
Pre-heater 78
2 Casing Length 56.7 in 500
...
Weight of unit 1134`}
                  value={pastedWeightText}
                  onChange={(e) => {
                    setPastedWeightText(e.target.value)
                    setImportText(e.target.value)
                  }}
                  className="mt-1 font-mono text-xs min-h-[160px]"
                />
              </div>

              <Button
                onClick={handleSheetImport}
                disabled={
                  isProcessingOCR ||
                  !layoutImage ||
                  (!weightsImage && !pastedWeightText.trim() && !isSystemairWeightTableText(importText))
                }
                className="w-full"
              >
                {isProcessingOCR ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {ocrStage || "Processing..."} {ocrProgress > 0 ? `${Math.round(ocrProgress)}%` : ""}
                  </>
                ) : (
                  <>
                    <ImageIcon className="w-4 h-4 mr-2" />
                    Extract &amp; Build Import
                  </>
                )}
              </Button>
            </div>
          )}

          {importType === "table" && (
            <div className="space-y-4 border rounded-lg p-4 bg-gray-50">
              <p className="text-xs text-muted-foreground">
                Geniox unit type is set in Configuration. Paste the Systemair weight table below and
                optionally add a layout image for accurate component bay lengths.
              </p>
              <div>
                <Label htmlFor="table-layout-upload">
                  Layout drawing (optional — for component bay lengths)
                </Label>
                <input
                  id="table-layout-upload"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setLayoutImage(e.target.files?.[0] || null)}
                  className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {layoutImage && (
                  <p className="text-xs text-green-600 mt-1">✓ {layoutImage.name}</p>
                )}
              </div>
            </div>
          )}

          {importType !== "ocr" && importType !== "dxf" && (
            <div>
              <Label htmlFor="file-upload">Upload File:</Label>
              <input
                id="file-upload"
                type="file"
                accept={
                  importType === "json" ? ".json" : importType === "csv" ? ".csv" : ".csv,.txt"
                }
                onChange={handleFileUpload}
                className="mt-2 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
            </div>
          )}

          <div>
            <Label htmlFor="import-text">
              {importType === "ocr" || importType === "dxf"
                ? "Generated JSON (editable):"
                : "Or Paste Data:"}
            </Label>
            <Textarea
              id="import-text"
              value={importText}
              onChange={(e) => {
                setImportText(e.target.value)
                setPreview(null)
                setError(null)
              }}
              placeholder={
                importType === "json"
                  ? "Paste JSON data here..."
                  : importType === "ocr"
                  ? "JSON will appear here after OCR processing..."
                  : importType === "dxf"
                  ? "JSON will appear here after DXF parsing..."
                  : importType === "table"
                  ? `Paste Systemair weight table here, e.g.:
1 Casing Length 37.0 in 357
Casing 241
Filter 38
Weight of unit 1134`
                  : "Paste table or CSV data here..."
              }
              disabled={isProcessingOCR}
              className="mt-2 font-mono text-sm"
              rows={10}
            />
          </div>

          {importType !== "ocr" && importType !== "dxf" && (
            <Button
              onClick={handleParse}
              className="w-full"
              disabled={isProcessingOCR || !importText.trim()}
            >
              <FileText className="w-4 h-4 mr-2" />
              {isProcessingOCR ? "Parsing..." : "Parse Data"}
            </Button>
          )}

          {importType === "dxf" && importText && !preview && (
            <Button onClick={handleParse} className="w-full" variant="outline">
              <FileText className="w-4 h-4 mr-2" />
              Re-parse Edited JSON
            </Button>
          )}

          {importType === "ocr" && importText && !preview && (
            <Button onClick={handleParse} className="w-full" variant="outline">
              <FileText className="w-4 h-4 mr-2" />
              Re-parse Edited JSON
            </Button>
          )}

          {importType === "ocr" && (
            <p className="text-xs text-muted-foreground">
              Layout icons map to weights: fan, electric heat, coils, control box, filter (I), inspection/empty.
            </p>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {preview && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertTitle>Preview</AlertTitle>
              <AlertDescription>
                <div className="mt-2 space-y-2 text-sm">
                  {preview.frameLength && preview.frameWidth && (
                    <div>
                      Frame: <strong>{Math.round(preview.frameLength)}</strong> mm ×{" "}
                      <strong>{Math.round(preview.frameWidth)}</strong> mm
                    </div>
                  )}
                  {preview.totalRoofWeight !== undefined && preview.totalRoofWeight > 0 && (
                    <div>
                      Roof + Weather Hood:{" "}
                      <strong>
                        {preview.totalRoofWeight} {preview.totalRoofWeightUnit || "lbs"}
                      </strong>
                    </div>
                  )}
                  <div>
                    <strong>{preview.sections.length}</strong> section(s),{" "}
                    <strong>{preview.loads.length}</strong> component load(s)
                    {preview.genioxType ? (
                      <>
                        {" "}
                        · Geniox <strong>{preview.genioxType}</strong>
                      </>
                    ) : null}
                  </div>
                  {preview.sections.length > 0 && (
                    <ul className="list-disc list-inside text-xs text-muted-foreground">
                      {preview.sections.map((s) => (
                        <li key={s.id}>
                          {s.name || "Section"}: {Math.round(s.startPosition)}–
                          {Math.round(s.endPosition)} mm (
                          {Math.round(s.endPosition - s.startPosition)} mm)
                        </li>
                      ))}
                    </ul>
                  )}
                  {preview.warnings && preview.warnings.length > 0 && (
                    <ul className="mt-1 list-disc list-inside text-xs text-amber-700">
                      {preview.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}

                  {preview.weightAudit && preview.unitTotalLb && preview.unitTotalLb > 0 && (
                    <div
                      className={`mt-2 p-2 rounded border text-xs ${
                        preview.weightAudit.balanced
                          ? "bg-green-50 border-green-200"
                          : "bg-amber-50 border-amber-200"
                      }`}
                    >
                      <div className="font-semibold">
                        Weight of unit: {preview.unitTotalLb}{" "}
                        {preview.weightAudit.weightUnit === "kg" ? "kg" : "lb"}
                        {preview.weightAudit.balanced ? " ✓ balanced" : " — check totals"}
                      </div>
                      <div>
                        Parsed: {preview.weightAudit.tableComputedTotal.toFixed(1)}{" "}
                        {preview.weightAudit.weightUnit === "kg" ? "kg" : "lb"} | App:{" "}
                        {preview.weightAudit.appComputedTotal.toFixed(1)}{" "}
                        {preview.weightAudit.weightUnit === "kg" ? "kg" : "lb"} | Δ{" "}
                        {preview.weightAudit.delta > 0 ? "+" : ""}
                        {preview.weightAudit.delta.toFixed(1)}{" "}
                        {preview.weightAudit.weightUnit === "kg" ? "kg" : "lb"}
                      </div>
                      {preview.weightAudit.warnings.map((w) => (
                        <div key={w} className="text-amber-800 mt-1">
                          {w}
                        </div>
                      ))}
                    </div>
                  )}

                  {preview.cog && (
                    <div className="mt-2 p-2 bg-blue-50 rounded border border-blue-100">
                      <div className="font-semibold text-blue-800">Center of Gravity / Mass</div>
                      <div className="text-xs mt-1 space-y-0.5">
                        <div>
                          COG X: <strong>{preview.cog.cogX.toFixed(1)} mm</strong> (
                          {(preview.cog.cogXRatio * 100).toFixed(1)}% of length)
                        </div>
                        <div>
                          COG Y: <strong>{preview.cog.cogY.toFixed(1)} mm</strong> (
                          {(preview.cog.cogYRatio * 100).toFixed(1)}% of width)
                        </div>
                        <div>
                          Total weight:{" "}
                          <strong>
                            {preview.cog.totalWeight.toFixed(1)} {preview.cog.totalWeightUnit}
                          </strong>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-2 max-h-32 overflow-y-auto text-xs space-y-1">
                    {preview.sections.map((section, idx) => (
                      <div key={idx} className="pl-2 border-l-2 border-blue-200">
                        {section.name}: {Math.round(section.startPosition)}–
                        {Math.round(section.endPosition)} mm
                        {section.casingWeight > 0 && (
                          <span className="text-gray-600">
                            {" "}
                            | Casing {section.casingWeight} {section.casingWeightUnit}
                          </span>
                        )}
                        {section.baseframeWeight > 0 && (
                          <span className="text-gray-600">
                            {" "}
                            | Baseframe {section.baseframeWeight} {section.baseframeWeightUnit}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="mt-2 max-h-40 overflow-y-auto text-xs space-y-1">
                    {preview.loads.map((load, idx) => (
                      <div key={idx} className="pl-2 border-l-2 border-green-200">
                        <strong>{load.name}</strong>
                        {load.type === "Distributed Load" ? (
                          <>
                            {" "}
                            — {load.magnitude} {load.unit || "lbs"} distributed load, start{" "}
                            {Math.round(load.startPosition)} mm, length{" "}
                            {Math.round(load.loadLength || 0)} mm
                            {load.loadWidth ? ` × ${Math.round(load.loadWidth)} mm` : ""}
                          </>
                        ) : (
                          <>
                            {" "}
                            — {load.magnitude} {load.unit} @ {Math.round(load.startPosition)} mm
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {preview && (
            <Button onClick={handleApply} className="w-full" variant="default">
              Apply Import
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

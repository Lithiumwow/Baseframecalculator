"use client"

import type React from "react"
import { useState } from "react"
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
import { processWeightSheets, type COGResult } from "../utils/weightSheetImport"
import { GENIOX_TYPES, getGenioxFrameWidth } from "../utils/genioxDimensions"
import { calculateCOG, buildCOGItemsFromImport } from "../utils/cogCalculation"

export interface WeightImportResult {
  sections: Section[]
  loads: Load[]
  frameLength?: number
  frameWidth?: number
  totalRoofWeight?: number
  totalRoofWeightUnit?: "N" | "kg" | "lbs"
  cog?: COGResult
  importJson?: string
}

interface WeightImportDialogProps {
  onImport: (result: WeightImportResult) => void
  frameLength: number
  frameWidth: number
  existingSections: Section[]
  existingLoads: Load[]
}

export function WeightImportDialog({
  onImport,
  frameLength,
  frameWidth,
  existingSections,
  existingLoads,
}: WeightImportDialogProps) {
  const [open, setOpen] = useState(false)
  const [importText, setImportText] = useState("")
  const [importType, setImportType] = useState<"json" | "csv" | "table" | "ocr">("ocr")
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<WeightImportResult | null>(null)
  const [isProcessingOCR, setIsProcessingOCR] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrStage, setOcrStage] = useState("")
  const [genioxType, setGenioxType] = useState<string>("10")
  const [layoutImage, setLayoutImage] = useState<File | null>(null)
  const [weightsImage, setWeightsImage] = useState<File | null>(null)

  const buildPreviewFromImportData = (
    importData: WeightImportData,
    cog?: COGResult
  ): WeightImportResult => {
    const effectiveFrameLength = importData.frameDimensions?.length || frameLength
    const effectiveFrameWidth = importData.frameDimensions?.width || frameWidth

    const sections = importData.sections
      ? convertImportedSections(importData.sections, effectiveFrameLength)
      : existingSections

    const loads = importData.components
      ? convertImportedComponents(importData.components, sections, effectiveFrameWidth)
      : []

    let finalSections = sections
    let finalLoads = loads

    if (importData.totalWeights) {
      const { sections: updatedSections, loads: additionalLoads } = generateLoadsFromTotalWeights(
        importData.totalWeights.roof || 0,
        importData.totalWeights.baseframe || 0,
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
          importData.totalWeights?.unit
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
      totalRoofWeight: importData.totalWeights?.roof,
      totalRoofWeightUnit: importData.totalWeights?.unit,
      cog: computedCog,
      importJson: JSON.stringify(importData, null, 2),
    }
  }

  const handleSheetImport = async () => {
    if (!layoutImage || !weightsImage) {
      setError("Please upload both the layout drawing and the weights table.")
      return
    }

    setIsProcessingOCR(true)
    setOcrProgress(0)
    setError(null)
    setPreview(null)

    try {
      const result = await processWeightSheets(
        layoutImage,
        weightsImage,
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
      })
      setError(null)
    } catch (err) {
      console.error("Sheet import error:", err)
      setError(err instanceof Error ? err.message : "Failed to process sheets")
      setPreview(null)
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

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setImportText(text)
      setError(null)
      setPreview(null)
    }
    reader.readAsText(file)
  }

  const handleParse = () => {
    try {
      setError(null)
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
    }
  }

  const handleApply = () => {
    if (preview) {
      onImport(preview)
      setOpen(false)
      setImportText("")
      setPreview(null)
      setError(null)
      setLayoutImage(null)
      setWeightsImage(null)
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
            {(["json", "csv", "table", "ocr"] as const).map((type) => (
              <Button
                key={type}
                variant={importType === type ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setImportType(type)
                  setImportText("")
                  setPreview(null)
                  setError(null)
                }}
                className={type === "ocr" ? "flex items-center gap-1" : undefined}
              >
                {type === "ocr" && <ImageIcon className="w-4 h-4" />}
                {type === "ocr" ? "OCR Sheets" : type.toUpperCase()}
              </Button>
            ))}
            <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="ml-auto">
              <Download className="w-4 h-4 mr-2" />
              Template
            </Button>
          </div>

          {importType === "ocr" && (
            <div className="space-y-4 border rounded-lg p-4 bg-gray-50">
              <div>
                <Label>Geniox Unit Type</Label>
                <Select value={genioxType} onValueChange={setGenioxType}>
                  <SelectTrigger className="mt-1 w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GENIOX_TYPES.map((type) => (
                      <SelectItem key={type} value={String(type)}>
                        Geniox {type} — {getGenioxFrameWidth(type)} mm width
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

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
                <Label htmlFor="weights-upload">2. Weights Table</Label>
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

              <Button
                onClick={handleSheetImport}
                disabled={isProcessingOCR || !layoutImage || !weightsImage}
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

          {importType !== "ocr" && (
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
              {importType === "ocr" ? "Generated JSON (editable):" : "Or Paste Data:"}
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
                  : "Paste table or CSV data here..."
              }
              disabled={isProcessingOCR}
              className="mt-2 font-mono text-sm"
              rows={10}
            />
          </div>

          {importType !== "ocr" && (
            <Button onClick={handleParse} className="w-full">
              <FileText className="w-4 h-4 mr-2" />
              Parse Data
            </Button>
          )}

          {importType === "ocr" && importText && !preview && (
            <Button onClick={handleParse} className="w-full" variant="outline">
              <FileText className="w-4 h-4 mr-2" />
              Re-parse Edited JSON
            </Button>
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
                  </div>

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

                  <div className="mt-2 max-h-32 overflow-y-auto text-xs space-y-1">
                    {preview.loads.map((load, idx) => (
                      <div key={idx} className="pl-2 border-l-2 border-green-200">
                        {load.name}: {load.magnitude} {load.unit} @ {Math.round(load.startPosition)} mm
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

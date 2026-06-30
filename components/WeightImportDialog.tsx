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
import { processWeightTableImage } from "../utils/ocr"

interface WeightImportDialogProps {
  onImport: (sections: Section[], loads: Load[]) => void
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
  const [importType, setImportType] = useState<"json" | "csv" | "table" | "ocr">("json")
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ sections: Section[]; loads: Load[] } | null>(null)
  const [isProcessingOCR, setIsProcessingOCR] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Check if it's an image file
    if (file.type.startsWith('image/')) {
      setIsProcessingOCR(true)
      setOcrProgress(0)
      setError(null)
      setPreview(null)
      
      try {
        const { formattedTable, importData } = await processWeightTableImage(file, (progress) => {
          setOcrProgress(progress)
        })

        setImportText(formattedTable)
        setImportType("table")

        const sections = importData.sections
          ? convertImportedSections(importData.sections, frameLength)
          : existingSections

        const loads = importData.components
          ? convertImportedComponents(importData.components, sections, frameWidth)
          : []

        if (importData.totalWeights) {
          const { sections: updatedSections, loads: additionalLoads } = generateLoadsFromTotalWeights(
            importData.totalWeights.roof || 0,
            importData.totalWeights.baseframe || 0,
            frameLength,
            frameWidth,
            sections,
            importData.totalWeights.unit || "kg"
          )
          setPreview({ sections: updatedSections, loads: [...loads, ...additionalLoads] })
        } else {
          setPreview({ sections, loads })
        }

        setOcrProgress(100)
        setError(null)
      } catch (err) {
        console.error('OCR processing error:', err)
        const errorMessage = err instanceof Error ? err.message : "Failed to process image with OCR"
        setError(`OCR Error: ${errorMessage}. Please check the browser console for details.`)
        setImportText("")
        setOcrProgress(0)
      } finally {
        setIsProcessingOCR(false)
      }
    } else {
      // Regular text file
      const reader = new FileReader()
      reader.onload = (e) => {
        const text = e.target?.result as string
        setImportText(text)
        setError(null)
        setPreview(null)
      }
      reader.readAsText(file)
    }
  }

  const handleParse = () => {
    try {
      setError(null)
      let importData: WeightImportData

      if (importType === "json") {
        importData = parseWeightImportJSON(importText)
      } else if (importType === "csv") {
        importData = parseWeightImportCSV(importText)
      } else if (importType === "table") {
        // Table format
        importData = parseWeightImportTable(importText)
      } else {
        // OCR format (treated as table)
        importData = parseWeightImportTable(importText)
      }

      // Convert to app formats
      const sections = importData.sections
        ? convertImportedSections(importData.sections, frameLength)
        : existingSections

      const loads = importData.components
        ? convertImportedComponents(importData.components, sections, frameWidth)
        : []

      // Handle total weights if provided
      if (importData.totalWeights) {
        const { sections: updatedSections, loads: additionalLoads } = generateLoadsFromTotalWeights(
          importData.totalWeights.roof || 0,
          importData.totalWeights.baseframe || 0,
          frameLength,
          frameWidth,
          sections,
          importData.totalWeights.unit || "kg"
        )
        setPreview({ sections: updatedSections, loads: [...loads, ...additionalLoads] })
      } else {
        setPreview({ sections, loads })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse import data")
      setPreview(null)
    }
  }

  const handleApply = () => {
    if (preview) {
      onImport(preview.sections, preview.loads)
      setOpen(false)
      setImportText("")
      setPreview(null)
      setError(null)
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
            Import weight data from JSON, CSV, table format, or extract from images using OCR to automatically populate sections and loads.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Import Type Selection */}
          <div className="flex items-center gap-4">
            <Label>Import Format:</Label>
            <Button
              variant={importType === "json" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setImportType("json")
                setImportText("")
                setPreview(null)
                setError(null)
              }}
            >
              JSON
            </Button>
            <Button
              variant={importType === "csv" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setImportType("csv")
                setImportText("")
                setPreview(null)
                setError(null)
              }}
            >
              CSV
            </Button>
            <Button
              variant={importType === "table" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setImportType("table")
                setImportText("")
                setPreview(null)
                setError(null)
              }}
            >
              Table
            </Button>
            <Button
              variant={importType === "ocr" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setImportType("ocr")
                setImportText("")
                setPreview(null)
                setError(null)
              }}
              className="flex items-center gap-1"
            >
              <ImageIcon className="w-4 h-4" />
              OCR
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="ml-auto">
              <Download className="w-4 h-4 mr-2" />
              Download Template
            </Button>
          </div>

          {/* File Upload */}
          <div>
            <Label htmlFor="file-upload">Upload File or Image:</Label>
            <div className="mt-2">
              <input
                id="file-upload"
                type="file"
                accept={
                  importType === "json" 
                    ? ".json" 
                    : importType === "csv" 
                    ? ".csv" 
                    : importType === "ocr"
                    ? "image/*"
                    : ".csv,.txt,image/*"
                }
                onChange={handleFileUpload}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              {importType === "ocr" && (
                <p className="text-xs text-gray-500 mt-1">
                  Upload a screenshot of the weight breakdown table. OCR will extract sections, components, and weights automatically.
                </p>
              )}
            </div>
            {isProcessingOCR && (
              <div className="mt-2 flex items-center gap-2 text-sm text-blue-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Reading table and parsing weights... {ocrProgress > 0 ? `${ocrProgress}%` : ""}</span>
              </div>
            )}
          </div>

          {/* Text Input */}
          <div>
            <Label htmlFor="import-text">Or Paste Data:</Label>
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
                  : importType === "csv"
                  ? "Paste CSV data here..."
                  : importType === "ocr"
                  ? "Upload an image above to extract text using OCR, or paste OCR-extracted text here..."
                  : "Paste table data here...\n\nExample:\nSection No, Section Code, Function Code, Weight of function (kg), Weight of section (kg)\n1, Casing Length 1641 mm, , , 446\n1, , Casing, 199,\n1, , Fan, 47,"
              }
              disabled={isProcessingOCR}
              className="mt-2 font-mono text-sm"
              rows={10}
            />
          </div>

          {/* Parse Button */}
          <Button onClick={handleParse} className="w-full">
            <FileText className="w-4 h-4 mr-2" />
            Parse Data
          </Button>

          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Preview */}
          {preview && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertTitle>Preview</AlertTitle>
              <AlertDescription>
                <div className="mt-2 space-y-2">
                  <div>
                    <strong>{preview.sections.length}</strong> section(s) will be imported
                  </div>
                  <div>
                    <strong>{preview.loads.length}</strong> load(s) will be imported
                  </div>
                  <div className="mt-4">
                    <div className="text-sm font-semibold mb-2">Sections:</div>
                    <div className="text-xs space-y-1 max-h-32 overflow-y-auto">
                      {preview.sections.map((section, idx) => (
                        <div key={idx} className="pl-2 border-l-2 border-blue-200">
                          {section.name}: {section.startPosition} - {section.endPosition} mm
                          {section.casingWeight > 0 && (
                            <div className="text-gray-600">
                              Casing: {section.casingWeight} {section.casingWeightUnit}
                            </div>
                          )}
                          {section.baseframeWeight > 0 && (
                            <div className="text-gray-600">
                              Baseframe: {section.baseframeWeight} {section.baseframeWeightUnit}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="text-sm font-semibold mb-2">Loads:</div>
                    <div className="text-xs space-y-1 max-h-32 overflow-y-auto">
                      {preview.loads.map((load, idx) => (
                        <div key={idx} className="pl-2 border-l-2 border-green-200">
                          {load.name || `Load ${idx + 1}`}: {load.magnitude} {load.unit} at {load.startPosition} mm
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Apply Button */}
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

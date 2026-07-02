import { NOTO_SANS_FAMILY } from "./notoFonts"

/** Clone and normalize an SVG element for export (PDF or PNG). */
export function prepareSvgClone(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement

  const width = svg.getAttribute("width")
    ? parseFloat(svg.getAttribute("width")!)
    : svg.viewBox?.baseVal?.width || svg.getBoundingClientRect().width || 500
  const height = svg.getAttribute("height")
    ? parseFloat(svg.getAttribute("height")!)
    : svg.viewBox?.baseVal?.height || svg.getBoundingClientRect().height || 300

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink")
  clone.setAttribute("width", String(width))
  clone.setAttribute("height", String(height))
  clone.setAttribute("font-family", "Noto Sans, sans-serif")
  clone.style.fontFamily = NOTO_SANS_FAMILY

  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`)
  }

  const idMap = new Map<string, string>()
  clone.querySelectorAll("[id]").forEach((node) => {
    const oldId = node.getAttribute("id")
    if (!oldId) return
    const newId = `export-${oldId}-${Math.random().toString(36).slice(2, 8)}`
    idMap.set(oldId, newId)
    node.setAttribute("id", newId)
  })

  if (idMap.size > 0) {
    clone.querySelectorAll("*").forEach((node) => {
      for (const attr of Array.from(node.attributes)) {
        if (attr.value.includes("url(#")) {
          node.setAttribute(
            attr.name,
            attr.value.replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${idMap.get(id) ?? id})`),
          )
        }
      }
    })
  }

  clone.querySelectorAll("script").forEach((script) => script.remove())
  return clone
}

async function drawSvgToCanvas(svg: SVGSVGElement, scale: number): Promise<string> {
  const width = Number(svg.getAttribute("width")) || 500
  const height = Number(svg.getAttribute("height")) || 300
  const svgData = new XMLSerializer().serializeToString(svg)
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`

  const canvas = document.createElement("canvas")
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not get canvas context")

  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  await new Promise<void>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve()
    }
    img.onerror = () => reject(new Error("Failed to load SVG image"))
    img.src = dataUrl
  })

  return canvas.toDataURL("image/png", 1)
}

/** Convert an SVG element to a PNG data URL. */
export async function svgToPngDataUrl(
  svg: SVGSVGElement,
  width: number,
  height: number,
): Promise<string> {
  const prepared = prepareSvgClone(svg)
  prepared.setAttribute("width", String(width))
  prepared.setAttribute("height", String(height))
  if (!prepared.getAttribute("viewBox")) {
    prepared.setAttribute("viewBox", `0 0 ${width} ${height}`)
  }

  try {
    return await drawSvgToCanvas(prepared, 2)
  } catch (error) {
    throw new Error(
      `SVG conversion error: ${error instanceof Error ? error.message : "Unknown error"}`,
    )
  }
}

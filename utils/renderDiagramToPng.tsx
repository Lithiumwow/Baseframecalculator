import type React from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { prepareSvgClone, svgToPngDataUrl } from "./svgToPng"

async function mountDiagram(element: React.ReactElement): Promise<SVGSVGElement> {
  const container = document.createElement("div")
  container.setAttribute("data-pdf-diagram-root", "true")
  container.style.position = "fixed"
  container.style.left = "0"
  container.style.top = "0"
  container.style.opacity = "0"
  container.style.pointerEvents = "none"
  container.style.zIndex = "-1"
  container.style.overflow = "hidden"
  container.style.background = "#ffffff"
  document.body.appendChild(container)

  const root = createRoot(container)

  try {
    flushSync(() => {
      root.render(element)
    })

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })

    const svg = container.querySelector("svg")
    if (!svg) {
      throw new Error("Diagram did not render an SVG element")
    }

    return prepareSvgClone(svg as SVGSVGElement)
  } finally {
    root.unmount()
    container.remove()
  }
}

/** Render a React SVG diagram and return a cloned, export-ready SVG element. */
export async function renderDiagramSvg(element: React.ReactElement): Promise<SVGSVGElement> {
  return mountDiagram(element)
}

/** Render a React SVG diagram off-screen and return a PNG data URL. */
export async function renderDiagramToPng(
  element: React.ReactElement,
  width: number,
  height: number,
): Promise<string> {
  const svg = await mountDiagram(element)
  const exportWidth = Number(svg.getAttribute("width")) || width
  const exportHeight = Number(svg.getAttribute("height")) || height
  return svgToPngDataUrl(svg, exportWidth, exportHeight)
}

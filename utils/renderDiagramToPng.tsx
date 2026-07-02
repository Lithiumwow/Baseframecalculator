import type React from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { svgToPngDataUrl } from "./svgToPng"

/** Render a React SVG diagram off-screen and return a PNG data URL. */
export async function renderDiagramToPng(
  element: React.ReactElement,
  width: number,
  height: number,
): Promise<string> {
  const container = document.createElement("div")
  container.setAttribute("data-pdf-diagram-root", "true")
  container.style.position = "fixed"
  container.style.left = "-10000px"
  container.style.top = "0"
  container.style.width = `${width}px`
  container.style.height = `${height}px`
  container.style.pointerEvents = "none"
  container.style.opacity = "1"
  container.style.visibility = "visible"
  document.body.appendChild(container)

  const root = createRoot(container)

  try {
    flushSync(() => {
      root.render(element)
    })

    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))

    const svg = container.querySelector("svg")
    if (!svg) {
      throw new Error("Diagram did not render an SVG element")
    }

    return await svgToPngDataUrl(svg as SVGSVGElement, width, height)
  } finally {
    root.unmount()
    container.remove()
  }
}

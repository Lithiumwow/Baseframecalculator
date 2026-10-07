"use client"

import { useEffect, useRef } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { Button } from "@/components/ui/button"
import type { Load, Section, Results } from "../types"
import { getDistributedLoadTotalWeightN, getLoadMagnitudeInN } from "../utils/conversions"
import { buildMomentContour, intensityToRgb } from "../utils/frameContour"
import type { COGResult } from "../utils/cogCalculation"
import type { DxfCasingMesh } from "../utils/dxfMeshExtract"

export interface Frame3DViewerProps {
  frameLength: number
  frameWidth: number
  sections: Section[]
  loads: Load[]
  results: Results
  bendingMomentData: Array<{ x: number; y: number | null }>
  cog?: COGResult | null
  /** DXF 3DFACE casing mesh (mm, Z-up). When set, replaces flat section boxes. */
  casingMesh?: DxfCasingMesh | null
  className?: string
}

/** Convert DXF mm Z-up positions into frame meters (Y-up): X→X, Z→Y, Y→Z. */
function dxfPositionsToFrameMeters(mesh: DxfCasingMesh, beamH: number): Float32Array {
  const { positions, bounds } = mesh
  const out = new Float32Array(positions.length)
  const s = 0.001
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = (positions[i] - bounds.minX) * s
    out[i + 1] = (positions[i + 2] - bounds.minZ) * s + beamH
    out[i + 2] = (positions[i + 1] - bounds.minY) * s
  }
  return out
}

function sampleContourIntensity(
  contour: Array<{ xMm: number; intensity: number }>,
  xMm: number
): number {
  if (!contour.length) return 0.2
  let best = contour[0]
  let bestD = Math.abs(best.xMm - xMm)
  for (let i = 1; i < contour.length; i++) {
    const d = Math.abs(contour[i].xMm - xMm)
    if (d < bestD) {
      best = contour[i]
      bestD = d
    }
  }
  return best.intensity
}

const SECTION_TINTS = [0x60a5fa, 0xfbbf24, 0x34d399, 0xf472b6, 0xa78bfa, 0xfb923c]

type ViewApi = {
  fit: () => void
  iso: () => void
  front: () => void
  top: () => void
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else if (mat) mat.dispose()
  })
}

function makeArrow(
  color: number,
  length: number,
  shaftRadius: number,
  headRadius: number,
  headLength: number
): THREE.Group {
  const g = new THREE.Group()
  const shaftLen = Math.max(0.01, length - headLength)
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLen, 10),
    new THREE.MeshLambertMaterial({ color })
  )
  shaft.position.y = shaftLen / 2
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(headRadius, headLength, 12),
    new THREE.MeshLambertMaterial({ color })
  )
  head.position.y = shaftLen + headLength / 2
  g.add(shaft, head)
  return g
}

function makeLabelSprite(text: string, color = "#0f172a", bg = "rgba(255,255,255,0.92)"): THREE.Sprite {
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")!
  const pad = 10
  ctx.font = "600 28px 'Segoe UI', sans-serif"
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2
  const h = 40
  canvas.width = w
  canvas.height = h
  ctx.font = "600 28px 'Segoe UI', sans-serif"
  ctx.fillStyle = bg
  ctx.strokeStyle = "rgba(15,23,42,0.25)"
  ctx.lineWidth = 2
  const r = 8
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.arcTo(w, 0, w, h, r)
  ctx.arcTo(w, h, 0, h, r)
  ctx.arcTo(0, h, 0, 0, r)
  ctx.arcTo(0, 0, w, 0, r)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = color
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, w / 2, h / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(material)
  const scale = 0.22
  sprite.scale.set((w / h) * scale, scale, 1)
  return sprite
}

export function Frame3DViewer({
  frameLength,
  frameWidth,
  sections,
  loads,
  results,
  bendingMomentData,
  cog,
  casingMesh,
  className,
}: Frame3DViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<ViewApi | null>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const L = Math.max(frameLength, 1) / 1000
    const W = Math.max(frameWidth, 1) / 1000
    const beamH = 0.08
    const beamT = 0.04
    const meshH =
      casingMesh != null
        ? Math.max(0.15, (casingMesh.bounds.maxZ - casingMesh.bounds.minZ) * 0.001)
        : 0
    const meshLen =
      casingMesh != null ? (casingMesh.bounds.maxX - casingMesh.bounds.minX) * 0.001 : L
    const meshWid =
      casingMesh != null ? (casingMesh.bounds.maxY - casingMesh.bounds.minY) * 0.001 : W
    const casingH = casingMesh != null ? meshH : 0.35
    const spanX = Math.max(L, meshLen)
    const spanZ = Math.max(W, meshWid)
    const contentTop = beamH + casingH + 0.55 // include load arrows
    const contentBottom = -0.45 // reactions below

    // Model built in +X/+Z space, then shifted so its center sits at world origin
    const modelCenter = new THREE.Vector3(spanX / 2, (contentTop + contentBottom) / 2, spanZ / 2)
    const size = new THREE.Vector3(spanX, contentTop - contentBottom, spanZ)
    const radius = Math.max(size.length() * 0.55, 0.4)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf3f4f6)

    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 500)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.domElement.style.width = "100%"
    renderer.domElement.style.height = "100%"
    renderer.domElement.style.display = "block"
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.rotateSpeed = 0.7
    controls.zoomSpeed = 0.85
    controls.panSpeed = 0.45
    controls.screenSpacePanning = true
    controls.enablePan = true
    controls.minDistance = radius * 0.6
    controls.maxDistance = radius * 5
    controls.maxPolarAngle = Math.PI * 0.49
    controls.minPolarAngle = 0.08
    controls.target.set(0, 0, 0)
    const maxPan = radius * 0.9
    const clampTarget = () => {
      controls.target.x = THREE.MathUtils.clamp(controls.target.x, -maxPan, maxPan)
      controls.target.y = THREE.MathUtils.clamp(controls.target.y, -maxPan * 0.5, maxPan * 0.5)
      controls.target.z = THREE.MathUtils.clamp(controls.target.z, -maxPan, maxPan)
    }
    controls.addEventListener("change", clampTarget)

    scene.add(new THREE.AmbientLight(0xffffff, 0.75))
    const key = new THREE.DirectionalLight(0xffffff, 0.9)
    key.position.set(2.5, 4, 3)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.35)
    fill.position.set(-2, 2, -2)
    scene.add(fill)

    const root = new THREE.Group()
    // Center model at origin so Fit / orbit stay framed
    root.position.set(-modelCenter.x, -modelCenter.y, -modelCenter.z)
    scene.add(root)

    const loadPeaks: Array<{ xMm: number; weight: number }> = []
    loads.forEach((load) => {
      let forceN = 0
      let xMm = load.startPosition
      if (load.type === "Distributed Load") {
        forceN = getDistributedLoadTotalWeightN(load)
        const len = load.loadLength || (load.area ? Math.sqrt(load.area) * 1000 : 0)
        xMm = load.startPosition + len / 2
      } else if (load.type === "Uniform Load" && load.endPosition != null) {
        forceN = getLoadMagnitudeInN(load) * ((load.endPosition - load.startPosition) / 1000)
        xMm = (load.startPosition + load.endPosition) / 2
      } else {
        forceN = getLoadMagnitudeInN(load)
      }
      if (forceN > 0) loadPeaks.push({ xMm, weight: forceN })
    })
    sections.forEach((section) => {
      let n = section.casingWeight || 0
      if (section.casingWeightUnit === "kg") n *= 9.81
      else if (section.casingWeightUnit === "lbs") n *= 4.44822
      if (n > 0) {
        loadPeaks.push({
          xMm: (section.startPosition + section.endPosition) / 2,
          weight: n,
        })
      }
    })

    const contour = buildMomentContour(bendingMomentData, frameLength, 40, loadPeaks)
    const segCount = Math.max(8, contour.length - 1)

    const addBeamSegment = (x0: number, x1: number, z: number, intensity: number) => {
      const len = Math.max(0.001, x1 - x0)
      const [r, g, b] = intensityToRgb(intensity)
      const mat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(r / 255, g / 255, b / 255),
      })
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, beamH, beamT), mat)
      mesh.position.set((x0 + x1) / 2, beamH / 2, z)
      root.add(mesh)
    }

    for (let i = 0; i < segCount; i++) {
      const c0 = contour[i] ?? { xMm: (frameLength * i) / segCount, intensity: 0 }
      const c1 = contour[i + 1] ?? {
        xMm: (frameLength * (i + 1)) / segCount,
        intensity: c0.intensity,
      }
      const intensity = (c0.intensity + c1.intensity) / 2
      addBeamSegment(c0.xMm / 1000, c1.xMm / 1000, beamT / 2, intensity)
      addBeamSegment(c0.xMm / 1000, c1.xMm / 1000, W - beamT / 2, intensity)
    }

    const endMat = new THREE.MeshLambertMaterial({ color: 0x64748b })
    for (const x of [beamT / 2, L - beamT / 2]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(beamT, beamH, W), endMat)
      mesh.position.set(x, beamH / 2, W / 2)
      root.add(mesh)
    }

    const crossXs = new Set<number>([0, frameLength])
    sections.forEach((s, idx) => {
      if (idx > 0) crossXs.add(s.startPosition)
      crossXs.add(s.endPosition)
    })
    ;(results.legSupportPositionsMm || []).forEach((p) => crossXs.add(p))
    const crossMat = new THREE.MeshLambertMaterial({ color: 0x475569 })
    for (const xmm of crossXs) {
      if (xmm <= 0 || xmm >= frameLength) continue
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(beamT * 0.8, beamH * 0.85, W), crossMat)
      mesh.position.set(xmm / 1000, beamH / 2, W / 2)
      root.add(mesh)
    }

    if (casingMesh && casingMesh.positions.length >= 9) {
      const worldPos = dxfPositionsToFrameMeters(casingMesh, beamH)
      const colors = new Float32Array(worldPos.length)
      for (let i = 0; i < worldPos.length; i += 9) {
        const cxMm = ((worldPos[i] + worldPos[i + 3] + worldPos[i + 6]) / 3) * 1000
        const intensity = sampleContourIntensity(contour, cxMm)
        const [r, g, b] = intensityToRgb(intensity)
        for (let v = 0; v < 3; v++) {
          const o = i + v * 3
          colors[o] = r / 255
          colors[o + 1] = g / 255
          colors[o + 2] = b / 255
        }
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute("position", new THREE.BufferAttribute(worldPos, 3))
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3))
      geo.computeVertexNormals()
      const solid = new THREE.Mesh(
        geo,
        new THREE.MeshLambertMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.88,
        })
      )
      const wire = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: 0x94a3b8,
          wireframe: true,
          transparent: true,
          opacity: 0.18,
        })
      )
      root.add(solid, wire)
    } else {
      sections.forEach((section, index) => {
        const x0 = section.startPosition / 1000
        const x1 = section.endPosition / 1000
        const len = Math.max(0.01, x1 - x0)
        const midX = (x0 + x1) / 2
        const mat = new THREE.MeshLambertMaterial({
          color: SECTION_TINTS[index % SECTION_TINTS.length],
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
        })
        const box = new THREE.Mesh(new THREE.BoxGeometry(len * 0.98, casingH, W * 0.92), mat)
        box.position.set(midX, beamH + casingH / 2, W / 2)
        root.add(box)

        const edge = new THREE.Mesh(
          new THREE.BoxGeometry(0.008, casingH * 0.95, W * 0.94),
          new THREE.MeshBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.35 })
        )
        edge.position.set(x0, beamH + casingH / 2, W / 2)
        root.add(edge)
      })
    }

    sections.forEach((section, index) => {
      const x0 = section.startPosition / 1000
      const x1 = section.endPosition / 1000
      const midX = (x0 + x1) / 2
      if (casingMesh) {
        const edge = new THREE.Mesh(
          new THREE.BoxGeometry(0.01, Math.max(0.12, casingH * 0.85), spanZ * 0.98),
          new THREE.MeshBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.28 })
        )
        edge.position.set(x0, beamH + casingH * 0.45, spanZ / 2)
        root.add(edge)
      }
      const label = makeLabelSprite(section.name || `Section ${index + 1}`)
      label.position.set(midX, beamH + casingH + 0.14, spanZ / 2)
      root.add(label)
    })

    const maxLoadN = Math.max(1, ...loadPeaks.map((p) => p.weight))

    loads.forEach((load) => {
      let forceN = 0
      let xMm = load.startPosition
      let zMm = frameWidth / 2
      let footprintLen = 0

      if (load.type === "Distributed Load") {
        forceN = getDistributedLoadTotalWeightN(load)
        const len = load.loadLength || (load.area ? Math.sqrt(load.area) * 1000 : 0)
        footprintLen = len
        xMm = load.startPosition + len / 2
      } else if (load.type === "Uniform Load" && load.endPosition != null) {
        forceN = getLoadMagnitudeInN(load) * ((load.endPosition - load.startPosition) / 1000)
        xMm = (load.startPosition + load.endPosition) / 2
      } else {
        forceN = getLoadMagnitudeInN(load)
        xMm = load.startPosition
      }

      if (forceN <= 0) return
      const scale = 0.12 + 0.35 * Math.min(1, forceN / maxLoadN)
      const arrow = makeArrow(0xef4444, scale, 0.012, 0.03, 0.05)
      arrow.rotation.x = Math.PI
      arrow.position.set(
        Math.min(L, Math.max(0, xMm / 1000)),
        beamH + casingH + scale + 0.05,
        Math.min(W, Math.max(0, zMm / 1000))
      )
      root.add(arrow)

      if (footprintLen > 0) {
        // Distributed-load plan footprint (not DXF geometry)
        const fp = new THREE.Mesh(
          new THREE.BoxGeometry(
            footprintLen / 1000,
            0.006,
            Math.min(W * 0.55, (load.loadWidth || frameWidth * 0.6) / 1000)
          ),
          new THREE.MeshBasicMaterial({
            color: 0xf87171,
            transparent: true,
            opacity: 0.28,
            depthWrite: false,
          })
        )
        fp.position.set(xMm / 1000, beamH + casingH + 0.04, W / 2)
        root.add(fp)
      }
    })

    sections.forEach((section) => {
      const unit = section.casingWeightUnit || "kg"
      let n = section.casingWeight || 0
      if (unit === "kg") n *= 9.81
      else if (unit === "lbs") n *= 4.44822
      if (n <= 0) return
      const x = (section.startPosition + section.endPosition) / 2 / 1000
      const scale = 0.08 + 0.2 * Math.min(1, n / maxLoadN)
      const arrow = makeArrow(0xf59e0b, scale, 0.01, 0.024, 0.04)
      arrow.rotation.x = Math.PI
      arrow.position.set(x, beamH + casingH + scale + 0.02, W * 0.3)
      root.add(arrow)
    })

    // Corner support reactions (gravity case) — not lifting lugs
    const R = results.cornerReactions || { R1: 0, R2: 0, R3: 0, R4: 0 }
    const maxR = Math.max(1, R.R1, R.R2, R.R3, R.R4)
    const corners = [
      { x: 0, z: 0, r: R.R1, name: "R1" },
      { x: L, z: 0, r: R.R2, name: "R2" },
      { x: 0, z: W, r: R.R3, name: "R3" },
      { x: L, z: W, r: R.R4, name: "R4" },
    ]
    corners.forEach((c) => {
      if (c.r <= 0) return
      const scale = 0.08 + 0.22 * (c.r / maxR)
      // Support reaction: pad on ground + short upward arrow (frame sitting on supports)
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.05, 0.02, 16),
        new THREE.MeshLambertMaterial({ color: 0x16a34a })
      )
      pad.position.set(c.x, -0.03, c.z)
      root.add(pad)
      const arrow = makeArrow(0x16a34a, scale, 0.01, 0.024, 0.035)
      arrow.position.set(c.x, -0.02, c.z)
      root.add(arrow)
      const tag = makeLabelSprite(c.name, "#14532d", "rgba(220,252,231,0.95)")
      tag.position.set(c.x, scale + 0.05, c.z)
      root.add(tag)
    })

    if (cog && Number.isFinite(cog.cogX) && Number.isFinite(cog.cogY)) {
      const cogMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 16, 16),
        new THREE.MeshLambertMaterial({ color: 0xf97316 })
      )
      cogMesh.position.set(cog.cogX / 1000, beamH + casingH * 0.55, cog.cogY / 1000)
      root.add(cogMesh)
    }

    const grid = new THREE.GridHelper(Math.max(L, W) * 1.4, 12, 0xcbd5e1, 0xe2e8f0)
    grid.position.set(L / 2, -0.001, W / 2)
    root.add(grid)

    const fitDistance = () => {
      const fov = THREE.MathUtils.degToRad(camera.fov)
      const aspect = Math.max(camera.aspect, 0.0001)
      // Fit bounding sphere to current viewport
      const distForHeight = radius / Math.tan(fov / 2)
      const distForWidth = radius / (Math.tan(fov / 2) * aspect)
      return Math.max(distForHeight, distForWidth) * 1.2
    }

    const setView = (direction: THREE.Vector3) => {
      controls.target.set(0, 0, 0)
      const dist = THREE.MathUtils.clamp(fitDistance(), controls.minDistance, controls.maxDistance)
      const dir = direction.clone().normalize()
      camera.up.set(0, 1, 0)
      camera.position.copy(dir.multiplyScalar(dist))
      camera.near = Math.max(0.01, dist / 100)
      camera.far = Math.max(200, dist * 40)
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
      controls.update()
      clampTarget()
    }

    const api: ViewApi = {
      fit: () => setView(new THREE.Vector3(1.1, 0.85, 1.1)),
      iso: () => setView(new THREE.Vector3(1, 0.9, 1)),
      front: () => setView(new THREE.Vector3(0.02, 0.2, 1)),
      top: () => setView(new THREE.Vector3(0.001, 1, 0.001)),
    }
    apiRef.current = api

    let didInitialFit = false
    const resize = () => {
      const w = Math.max(1, mount.clientWidth || 640)
      const h = Math.max(1, mount.clientHeight || 420)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
      if (!didInitialFit && w > 40 && h > 40) {
        didInitialFit = true
        api.fit()
      }
    }
    resize()
    // Second pass after layout settles (fixes cornered first paint)
    requestAnimationFrame(() => {
      resize()
      api.fit()
      didInitialFit = true
    })
    const ro = new ResizeObserver(() => resize())
    ro.observe(mount)

    let raf = 0
    const tick = () => {
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.removeEventListener("change", clampTarget)
      controls.dispose()
      disposeObject(root)
      renderer.dispose()
      apiRef.current = null
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [
    frameLength,
    frameWidth,
    sections,
    loads,
    results.cornerReactions,
    results.legSupportPositionsMm,
    bendingMomentData,
    cog,
    casingMesh,
  ])

  const maxMoment = results.maxBendingMoment || 0
  const runView = (name: keyof ViewApi) => apiRef.current?.[name]()
  const hasMesh = casingMesh != null && casingMesh.triangleCount > 0

  return (
    <div className={className}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="text-sm text-gray-600 max-w-xl">
          {hasMesh ? (
            <>
              DXF casing mesh ({casingMesh!.triangleCount.toLocaleString()} triangles) tinted by
              bending moment. Rails show the same contour. Red arrows = component loads (down);
              thin red pad = distributed-load footprint (not DXF). Amber = casing weight. Green =
              corner <em>support reactions</em> (up)
              {cog ? ". Orange = COG" : ""}.
            </>
          ) : (
            <>
              Parametric baseframe: rails colored by bending moment. Translucent boxes = sections
              (import a Geniox DXF to show the real casing mesh). Red arrows = loads (down); thin
              red pad = distributed-load footprint. Amber = casing weight. Green = corner{" "}
              <em>support reactions</em> (up)
              {cog ? ". Orange = COG" : ""}.
            </>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button type="button" size="sm" variant="outline" onClick={() => runView("fit")}>
              Fit
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => runView("iso")}>
              Isometric
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => runView("front")}>
              Front
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => runView("top")}>
              Top
            </Button>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <span>Low</span>
            <div
              className="h-2.5 w-28 rounded-full"
              style={{
                background: "linear-gradient(90deg,#1d4ed8,#22c55e,#eab308,#ef4444)",
              }}
            />
            <span>High |M|</span>
            {maxMoment > 0 && (
              <span className="text-gray-500 ml-1">max {maxMoment.toFixed(0)} N·m</span>
            )}
          </div>
        </div>
      </div>
      <div
        ref={mountRef}
        className="relative w-full h-[480px] rounded-lg border border-gray-200 overflow-hidden bg-gray-100 touch-none"
      />
      <p className="text-xs text-gray-500 mt-2">
        Drag to orbit · scroll to zoom · right-drag to pan (limited). Click <strong>Fit</strong> to
        re-center. Contour uses the longitudinal moment diagram from the current analysis.
      </p>
    </div>
  )
}

import type React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { HelpCircle } from "lucide-react"

export const HelpDialog: React.FC = () => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="fixed top-4 right-4 z-50 bg-transparent">
          <HelpCircle className="w-4 h-4 mr-2" />
          Help & Formulas
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Calculation Methods & Formulas</DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-[70vh] pr-4">
          <div className="space-y-6 p-4">
            <section>
              <h3 className="text-lg font-semibold mb-3">Load Types (Simple Beam)</h3>
              <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside ml-2">
                <li>
                  <strong>Point Load:</strong> concentrated force at a position
                </li>
                <li>
                  <strong>Uniform Load:</strong> intensity <em>w</em> (N/m) from start to end
                </li>
                <li>
                  <strong>Distributed Load:</strong> total weight (or pressure × footprint) spread
                  uniformly over its length — treated as a UDL segment for reactions, shear, moment,
                  and deflection
                </li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-3">Shear Force</h3>
              <p className="text-sm text-gray-600 mb-2">For simply supported beam:</p>
              <p className="text-sm font-mono bg-gray-100 p-2 rounded">
                V(x) = R₁ − ΣPᵢ − Σwᵢ·(loaded length up to x)
              </p>
              <p className="text-sm text-gray-600">
                Where R₁ = left reaction, Pᵢ = point loads, wᵢ = line-load intensity (N/m)
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-3">Bending Moment</h3>
              <p className="text-sm text-gray-600 mb-2">Section method from left support:</p>
              <p className="text-sm font-mono bg-gray-100 p-2 rounded">
                M(x) = R₁·x − ΣPᵢ·(x − aᵢ) − Σwᵢ·L_loaded·(x − centroid)
              </p>
              <p className="text-sm text-gray-600">
                Reactions use lever rule: for a load with centroid distance <em>a</em> from the left
                support and span <em>L</em>, R_left = P·(L−a)/L, R_right = P·a/L.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-3">Maximum Deflection</h3>
              <p className="text-sm text-gray-600 mb-2">
                Simple beam deflection is obtained by double-integrating M/EI along the span
                (supports enforced to zero deflection). This covers point, uniform, and distributed
                loads without assuming a single closed-form case.
              </p>
              <p className="text-sm text-gray-600 mb-1">Reference closed forms (checks):</p>
              <p className="text-sm font-mono bg-gray-100 p-2 rounded mb-2">
                Point load at midspan: δ_max = PL³/(48EI)
                <br />
                Full UDL: δ_max = 5wL⁴/(384EI)
              </p>
              <p className="text-sm text-gray-600">
                Base Frame may also use a multi-span model between leg supports for the longitudinal
                beam, plus a simplified UDL estimate on perimeter beams.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-3">Base Frame — Corner Reactions</h3>
              <p className="text-sm text-gray-600 mb-2">
                Loads are distributed to four corners (R1–R4) with the <strong>area method</strong>.
                Distributed footprints are centered on the frame width (matches the diagram).
              </p>
              <p className="text-sm font-mono bg-gray-100 p-2 rounded mb-2">
                Rᵢ = Σ(Pⱼ × Aᵢⱼ / A_total) + frame/section self-weight shares
              </p>
              <ul className="text-sm text-gray-600 list-disc list-inside ml-2 space-y-1">
                <li>R1 top-left (0, 0): A₁ = (L − x)×(W − y)</li>
                <li>R2 top-right (L, 0): A₂ = x×(W − y)</li>
                <li>R3 bottom-left (0, W): A₃ = (L − x)×y</li>
                <li>R4 bottom-right (L, W): A₄ = x×y</li>
              </ul>
              <p className="text-sm text-gray-600 mt-2">
                Equilibrium check: R1 + R2 + R3 + R4 = total vertical load.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-3">Stress Calculations</h3>

              <div className="mb-3">
                <h4 className="font-medium text-sm mb-2">Normal Stress (Bending):</h4>
                <p className="text-sm font-mono bg-gray-100 p-2 rounded mb-2">σ = M / S</p>
                <p className="text-sm text-gray-600">
                  M in N·m, S in m³ → Pa, reported in MPa.
                </p>
              </div>

              <div className="mb-3">
                <h4 className="font-medium text-sm mb-2">Shear Stress:</h4>
                <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside ml-2 mb-2">
                  <li>
                    <strong>Rectangular:</strong> τ_max = 1.5·V / A
                  </li>
                  <li>
                    <strong>Circular:</strong> τ_max = (4/3)·V / A
                  </li>
                  <li>
                    <strong>I-Beam / C-Channel:</strong> τ ≈ V / (t_w · h_web) (average web shear)
                  </li>
                </ul>
              </div>

              <div className="mb-3">
                <h4 className="font-medium text-sm mb-2">Safety Factor (governing):</h4>
                <p className="text-sm font-mono bg-gray-100 p-2 rounded mb-2">
                  SF_bending = F_y / σ
                  <br />
                  SF_shear = (F_y / √3) / τ
                  <br />
                  SF = min(SF_bending, SF_shear)
                </p>
                <p className="text-sm text-gray-600">
                  Shear yield uses the von Mises factor F_y/√3. The UI reports the governing
                  (smaller) factor and both components. This is a screening check, not a full
                  AISC/Eurocode design.
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  A safety factor ≥ 2.0 is often used as a rough structural screening threshold.
                </p>
              </div>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-3">Cross-Sectional Properties</h3>

              <div className="mb-3">
                <h4 className="font-medium text-sm mb-2">Moment of Inertia (strong axis I_xx):</h4>
                <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside ml-2">
                  <li>
                    <strong>Rectangular:</strong> I = b·h³/12
                  </li>
                  <li>
                    <strong>I-Beam / C-Channel:</strong> I = 2·I_flange + I_web (flange width b_f =
                    overall flange width including web). Strong-axis only — weak-axis / shear
                    center not modeled.
                  </li>
                  <li>
                    <strong>Circular:</strong> I = π·d⁴/64
                  </li>
                </ul>
              </div>

              <div className="mb-3">
                <h4 className="font-medium text-sm mb-2">Section Modulus:</h4>
                <p className="text-sm font-mono bg-gray-100 p-2 rounded mb-2">S = I / c</p>
                <p className="text-sm text-gray-600">
                  c = h/2 (or d/2 for circular) for extreme fiber about the strong axis.
                </p>
              </div>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-3">3D Baseframe Load View</h3>
              <p className="text-sm text-gray-600 mb-2">
                For Base Frame analysis, the 3D viewer shows a parametric steel frame (not the full
                AHU casing mesh):
              </p>
              <ul className="text-sm text-gray-600 list-disc list-inside ml-2 space-y-1">
                <li>Longitudinal rails colored by bending moment |M(x)| from your current loads</li>
                <li>Translucent boxes = casing sections</li>
                <li>Red arrows = component loads; amber = section casing weight</li>
                <li>Green arrows = corner reactions R1–R4; orange = COG</li>
              </ul>
              <p className="text-sm text-gray-600 mt-2">
                This is a screening visualization of the calculator results, not a continuum FEA
                solve.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-3">DXF Section Import</h3>
              <p className="text-sm text-gray-600">
                Systemair / Geniox 3D DXF exports can create empty casing sections from module side
                panels and set Geniox type / frame size. They do not contain component weights —
                import a weight table afterward.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-3">Units Used</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Length: millimeters (mm)</li>
                <li>• Force: Newtons (N), kilograms (kg), or pounds (lbs)</li>
                <li>• Stress: Megapascals (MPa)</li>
                <li>• Deflection: millimeters (mm)</li>
                <li>• Moment: Newton-meters (N·m)</li>
              </ul>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
